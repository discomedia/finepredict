import type {
  AlertEventType,
  MarketObservation,
  MarketPlatform,
  SourceAvailability,
} from "@finepredict/shared";
import { MarketObservationSchema } from "@finepredict/shared";
import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";

import type { FinePredictDatabase } from "../database/client.js";
import {
  alertEvents,
  apiUsageDaily,
  authUsers,
  disputeCases,
  disputeEvents,
  disputeSources,
  marketObservations,
  marketSnapshots,
  monitorRuns,
  subscriptions,
  watchlistMarkets,
  watchlists,
} from "../database/schema.js";

/** One active subscribed market eligible for hourly monitoring. */
export interface MonitorTarget {
  externalId: string;
  marketUrl: string;
  platform: MarketPlatform;
  title: string;
  userEmail: string;
  userId: string;
  watchlistMarketId: string;
}

/** Input persisted after one upstream market check. */
export interface SaveObservationInput {
  deadline: string | null;
  disputeState: string | null;
  durationMilliseconds: number;
  error: string | null;
  externalId: string;
  monitorRunId: string;
  normalizedState: string;
  platform: MarketPlatform;
  rawPlatformState: string;
  resolutionSource: string | null;
  result: string | null;
  rulesHash: string;
  settlementTimestamp: string | null;
  snapshotId: string | null;
  sourceAvailability: SourceAvailability;
  title: string;
  watchlistMarketId: string;
}

/** Input for a deduplicated user alert. */
export interface SaveAlertInput {
  deduplicationKey: string;
  detail: string;
  eventType: AlertEventType;
  marketUrl: string;
  observationId: string;
  title: string;
  userId: string;
  watchlistMarketId: string;
}

/** One user's pending alert-email batch. */
export interface PendingAlertBatch {
  alertIds: string[];
  alerts: { detail: string; marketUrl: string; title: string }[];
  email: string;
  userId: string;
}

/** Unreported usage aggregate eligible for a Stripe meter event. */
export interface PendingUsageRollup {
  customerId: string;
  id: string;
  units: number;
  usageDate: string;
}

/** Neon persistence used by the short-lived hourly monitor. */
export class MonitoringStore {
  /**
   * Creates a monitoring persistence adapter.
   *
   * @param database - Typed Drizzle database client.
   */
  public constructor(private readonly database: FinePredictDatabase) {}

  /**
   * Starts an auditable monitor run.
   *
   * @param dryRun - Whether external alerts and billing writes are disabled.
   * @returns Monitor-run identifier.
   */
  public async startRun(dryRun: boolean): Promise<string> {
    const [row] = await this.database
      .insert(monitorRuns)
      .values({ dryRun })
      .returning({ id: monitorRuns.id });
    if (!row) {
      throw new Error(`FinePredict monitor: run insert returned no row.`);
    }
    return row.id;
  }

  /**
   * Completes an auditable monitor run.
   *
   * @param input - Final counters and failure state.
   * @returns Nothing after persistence.
   */
  public async completeRun(input: {
    checkedCount: number;
    error: string | null;
    failedCount: number;
    monitorRunId: string;
    retryCount: number;
  }): Promise<void> {
    await this.database
      .update(monitorRuns)
      .set({
        checkedCount: input.checkedCount,
        completedAt: new Date(),
        error: input.error,
        failedCount: input.failedCount,
        retryCount: input.retryCount,
        status: input.error ? "failed" : "completed",
      })
      .where(eq(monitorRuns.id, input.monitorRunId));
  }

  /**
   * Lists active markets owned by currently entitled subscribers.
   *
   * @returns Monitor targets with owner email addresses.
   */
  public async listTargets(): Promise<MonitorTarget[]> {
    const rows = await this.database
      .select({
        externalId: watchlistMarkets.externalId,
        marketUrl: watchlistMarkets.marketUrl,
        platform: watchlistMarkets.platform,
        title: watchlistMarkets.title,
        userEmail: authUsers.email,
        userId: watchlists.userId,
        watchlistMarketId: watchlistMarkets.id,
      })
      .from(watchlistMarkets)
      .innerJoin(watchlists, eq(watchlistMarkets.watchlistId, watchlists.id))
      .innerJoin(authUsers, eq(watchlists.userId, authUsers.id))
      .innerJoin(subscriptions, eq(watchlists.userId, subscriptions.userId))
      .where(
        and(
          eq(watchlistMarkets.active, true),
          eq(subscriptions.product, "watchlists"),
          inArray(subscriptions.status, ["active", "trialing"]),
        ),
      );
    return rows.map((row) => ({
      ...row,
      platform: row.platform === "kalshi" ? "kalshi" : "polymarket",
    }));
  }

  /**
   * Returns recent observations for threshold and transition checks.
   *
   * @param watchlistMarketId - Watched market identifier.
   * @param limit - Maximum prior observations.
   * @returns Observations ordered newest first.
   */
  public async listRecentObservations(
    watchlistMarketId: string,
    limit = 4,
  ): Promise<MarketObservation[]> {
    const rows = await this.database
      .select()
      .from(marketObservations)
      .where(eq(marketObservations.watchlistMarketId, watchlistMarketId))
      .orderBy(desc(marketObservations.observedAt))
      .limit(limit);
    return rows.map(mapObservation);
  }

  /**
   * Returns the latest archived rules text for visual diff generation.
   *
   * @param platform - Market platform.
   * @param externalId - Platform market identifier.
   * @returns Latest rules text or null when no snapshot exists.
   */
  public async getLatestSnapshotRules(
    platform: MarketPlatform,
    externalId: string,
  ): Promise<string | null> {
    const [row] = await this.database
      .select({ rulesText: marketSnapshots.rulesText })
      .from(marketSnapshots)
      .where(
        and(
          eq(marketSnapshots.platform, platform),
          eq(marketSnapshots.externalId, externalId),
        ),
      )
      .orderBy(desc(marketSnapshots.capturedAt))
      .limit(1);
    return row?.rulesText ?? null;
  }

  /**
   * Saves a new immutable snapshot only when content changed.
   *
   * @param input - Settlement-relevant market content.
   * @returns New snapshot ID or the latest unchanged snapshot ID.
   */
  public async saveSnapshotIfChanged(input: {
    contentHash: string;
    diffLines: string[];
    endDate: string | null;
    externalId: string;
    platform: MarketPlatform;
    resolutionSource: string | null;
    rulesText: string;
    sourceUrl: string;
    title: string;
  }): Promise<string | null> {
    const [latest] = await this.database
      .select({
        contentHash: marketSnapshots.contentHash,
        id: marketSnapshots.id,
      })
      .from(marketSnapshots)
      .where(
        and(
          eq(marketSnapshots.platform, input.platform),
          eq(marketSnapshots.externalId, input.externalId),
        ),
      )
      .orderBy(desc(marketSnapshots.capturedAt))
      .limit(1);
    if (latest?.contentHash === input.contentHash) {
      return latest.id;
    }
    const [row] = await this.database
      .insert(marketSnapshots)
      .values({
        contentHash: input.contentHash,
        diffLines: input.diffLines,
        endDate: input.endDate ? new Date(input.endDate) : null,
        externalId: input.externalId,
        platform: input.platform,
        reportId: null,
        resolutionSource: input.resolutionSource,
        rulesText: input.rulesText,
        sourceUrl: input.sourceUrl,
        title: input.title,
      })
      .returning({ id: marketSnapshots.id });
    return row?.id ?? null;
  }

  /**
   * Saves one lightweight market observation.
   *
   * @param input - Normalized observation input.
   * @returns Persisted observation.
   */
  public async saveObservation(
    input: SaveObservationInput,
  ): Promise<MarketObservation> {
    const [row] = await this.database
      .insert(marketObservations)
      .values({
        ...input,
        deadline: input.deadline ? new Date(input.deadline) : null,
        settlementTimestamp: input.settlementTimestamp
          ? new Date(input.settlementTimestamp)
          : null,
      })
      .returning();
    if (!row) {
      throw new Error(
        `FinePredict monitor: observation insert returned no row.`,
      );
    }
    return mapObservation(row);
  }

  /**
   * Saves a concrete alert once using its stable deduplication key.
   *
   * @param input - Alert evidence and owner.
   * @returns True only when a new alert was inserted.
   */
  public async saveAlert(input: SaveAlertInput): Promise<boolean> {
    const rows = await this.database
      .insert(alertEvents)
      .values(input)
      .onConflictDoNothing()
      .returning({ id: alertEvents.id });
    return rows.length === 1;
  }

  /**
   * Lists user-grouped pending alert deliveries for batched email.
   *
   * @returns Pending alert batches grouped by account.
   */
  public async listPendingAlertBatches(): Promise<PendingAlertBatch[]> {
    const rows = await this.database
      .select({
        alertId: alertEvents.id,
        detail: alertEvents.detail,
        email: authUsers.email,
        marketUrl: alertEvents.marketUrl,
        title: alertEvents.title,
        userId: alertEvents.userId,
      })
      .from(alertEvents)
      .innerJoin(authUsers, eq(alertEvents.userId, authUsers.id))
      .where(isNull(alertEvents.emailSentAt))
      .orderBy(alertEvents.createdAt)
      .limit(500);
    const byUser = new Map<string, PendingAlertBatch>();
    for (const row of rows) {
      const batch = byUser.get(row.userId) ?? {
        alertIds: [],
        alerts: [],
        email: row.email,
        userId: row.userId,
      };
      batch.alertIds.push(row.alertId);
      batch.alerts.push({
        detail: row.detail,
        marketUrl: row.marketUrl,
        title: row.title,
      });
      byUser.set(row.userId, batch);
    }
    return [...byUser.values()];
  }

  /**
   * Marks a delivered alert batch complete.
   *
   * @param alertIds - IDs successfully included in an email.
   * @returns Nothing after persistence.
   */
  public async markAlertsDelivered(alertIds: string[]): Promise<void> {
    if (alertIds.length === 0) {
      return;
    }
    await this.database
      .update(alertEvents)
      .set({ emailSentAt: new Date(), lastDeliveryError: null })
      .where(inArray(alertEvents.id, alertIds));
  }

  /**
   * Records a failed batch so it remains pending for the next hourly run.
   *
   * @param alertIds - IDs whose delivery failed.
   * @param error - Safe provider failure text.
   * @returns Nothing after persistence.
   */
  public async markAlertDeliveryFailed(
    alertIds: string[],
    error: string,
  ): Promise<void> {
    if (alertIds.length === 0) {
      return;
    }
    await this.database
      .update(alertEvents)
      .set({
        deliveryAttempts: sql`${alertEvents.deliveryAttempts} + 1`,
        lastDeliveryError: error,
      })
      .where(inArray(alertEvents.id, alertIds));
  }

  /**
   * Imports a lifecycle transition to the administrator dispute-review queue.
   *
   * @param input - Exact upstream rules and raw lifecycle evidence.
   * @returns Nothing after the pending case and event are saved.
   */
  public async importLifecycleDispute(input: {
    externalId: string;
    marketUrl: string;
    occurredAt: string;
    platform: MarketPlatform;
    rawState: string;
    rulesText: string;
    title: string;
  }): Promise<void> {
    const slug = `${input.platform}-${input.externalId}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 100);
    const [caseRow] = await this.database
      .insert(disputeCases)
      .values({
        archivedRules: input.rulesText,
        disputedWording: input.rulesText,
        externalId: input.externalId,
        marketUrl: input.marketUrl,
        platform: input.platform,
        reviewStatus: "pending_review",
        searchDocument: `${input.title} ${input.rulesText}`,
        slug,
        title: input.title,
      })
      .onConflictDoUpdate({
        target: [disputeCases.platform, disputeCases.externalId],
        set: {
          archivedRules: input.rulesText,
          marketUrl: input.marketUrl,
          title: input.title,
          updatedAt: new Date(),
        },
      })
      .returning({ id: disputeCases.id });
    if (!caseRow) {
      throw new Error(`FinePredict monitor: dispute import returned no row.`);
    }
    await Promise.all([
      this.database.insert(disputeEvents).values({
        disputeCaseId: caseRow.id,
        eventType: input.rawState,
        occurredAt: new Date(input.occurredAt),
        rawPlatformState: input.rawState,
      }),
      this.database.insert(disputeSources).values({
        disputeCaseId: caseRow.id,
        label: `Official ${input.platform} market lifecycle`,
        quotedText: input.rawState,
        url: input.marketUrl,
      }),
    ]);
  }

  /**
   * Imports one transaction-backed Polymarket UMA or clarification event.
   *
   * @param input - Exact rules, event state, transaction, and source link.
   * @returns Nothing after an idempotent pending-review import.
   */
  public async importPolymarketChainEvent(input: {
    detail: string | null;
    eventType: string;
    externalId: string;
    marketUrl: string;
    occurredAt: string;
    rawState: string;
    rulesText: string;
    sourceUrl: string;
    title: string;
    transactionHash: string;
  }): Promise<void> {
    const slug = `polymarket-${input.externalId}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 100);
    const [caseRow] = await this.database
      .insert(disputeCases)
      .values({
        archivedRules: input.rulesText,
        disputedWording: input.detail ?? input.rulesText,
        externalId: input.externalId,
        marketUrl: input.marketUrl,
        platform: "polymarket",
        reviewStatus: "pending_review",
        searchDocument: `${input.title} ${input.rulesText} ${input.detail ?? ""}`,
        slug,
        title: input.title,
      })
      .onConflictDoUpdate({
        target: [disputeCases.platform, disputeCases.externalId],
        set: {
          archivedRules: input.rulesText,
          marketUrl: input.marketUrl,
          searchDocument: `${input.title} ${input.rulesText} ${input.detail ?? ""}`,
          title: input.title,
          updatedAt: new Date(),
        },
      })
      .returning({ id: disputeCases.id });
    if (!caseRow) {
      throw new Error(`FinePredict monitor: chain import returned no case.`);
    }
    await Promise.all([
      this.database
        .insert(disputeEvents)
        .values({
          detail: input.detail,
          disputeCaseId: caseRow.id,
          eventType: input.eventType,
          occurredAt: new Date(input.occurredAt),
          rawPlatformState: input.rawState,
          transactionHash: input.transactionHash,
        })
        .onConflictDoNothing(),
      this.database
        .insert(disputeSources)
        .values({
          disputeCaseId: caseRow.id,
          label: `Polygon transaction for ${input.eventType}`,
          quotedText: input.detail,
          transactionHash: input.transactionHash,
          url: input.sourceUrl,
        })
        .onConflictDoNothing(),
    ]);
  }

  /**
   * Lists daily API usage rows ready for Stripe roll-up.
   *
   * @returns Unreported rows with a configured Stripe customer.
   */
  public async listPendingUsageRollups(): Promise<PendingUsageRollup[]> {
    const rows = await this.database
      .select({
        customerId: subscriptions.stripeCustomerId,
        id: apiUsageDaily.id,
        units: apiUsageDaily.billableUnits,
        usageDate: apiUsageDaily.usageDate,
      })
      .from(apiUsageDaily)
      .innerJoin(subscriptions, eq(apiUsageDaily.userId, subscriptions.userId))
      .where(
        and(
          isNull(apiUsageDaily.reportedToStripeAt),
          eq(subscriptions.product, "developer_api"),
          lt(apiUsageDaily.usageDate, new Date().toISOString().slice(0, 10)),
        ),
      )
      .limit(500);
    return rows.flatMap((row) =>
      row.customerId ? [{ ...row, customerId: row.customerId }] : [],
    );
  }

  /**
   * Marks a daily usage row after a successful Stripe meter event.
   *
   * @param usageId - Daily aggregate identifier.
   * @param stripeMeterEventId - Stripe idempotency identifier.
   * @returns Nothing after persistence.
   */
  public async markUsageReported(
    usageId: string,
    stripeMeterEventId: string,
  ): Promise<void> {
    await this.database
      .update(apiUsageDaily)
      .set({
        reportedToStripeAt: new Date(),
        stripeMeterEventId,
      })
      .where(eq(apiUsageDaily.id, usageId));
  }
}

/**
 * Converts a selected observation row into the shared public contract.
 *
 * @param row - Selected observation table row.
 * @returns Validated normalized observation.
 */
function mapObservation(
  row: typeof marketObservations.$inferSelect,
): MarketObservation {
  return MarketObservationSchema.parse({
    deadline: row.deadline?.toISOString() ?? null,
    disputeState: row.disputeState,
    externalId: row.externalId,
    id: row.id,
    normalizedState: row.normalizedState,
    observedAt: row.observedAt.toISOString(),
    platform: row.platform,
    rawPlatformState: row.rawPlatformState,
    resolutionSource: row.resolutionSource,
    result: row.result,
    rulesHash: row.rulesHash,
    settlementTimestamp: row.settlementTimestamp?.toISOString() ?? null,
    snapshotId: row.snapshotId,
    sourceAvailability: row.sourceAvailability,
    title: row.title,
  });
}
