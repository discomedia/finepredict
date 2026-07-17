import type {
  AlertEvent,
  ApiKeyScope,
  ApiKeySummary,
  DisputeCase,
  MarketObservation,
  MarketContract,
  SubscriptionSummary,
  UsageSummary,
  Watchlist,
} from "@finepredict/shared";
import {
  AlertEventSchema,
  ApiKeyScopeSchema,
  DisputeCaseSchema,
  MarketObservationSchema,
  SubscriptionStatusSchema,
} from "@finepredict/shared";
import { and, count, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";

import type { StripeSubscriptionUpdate } from "../integrations/billing.js";
import type { FinePredictDatabase } from "./client.js";
import {
  alertEvents,
  apiIdempotency,
  apiKeys,
  apiUsageDaily,
  authUsers,
  disputeCases,
  disputeEvents,
  disputeSources,
  marketObservations,
  stripeWebhookEvents,
  subscriptions,
  watchlistMarkets,
  watchlists,
} from "./schema.js";

/** Maximum active markets included with the watchlist subscription. */
export const ACTIVE_MARKET_LIMIT = 25;

/** Billing identifiers needed for Checkout, portal, and usage reporting. */
export interface BillingIdentity {
  stripeCustomerId: string | null;
}

/** API key details returned after bearer authentication. */
export interface VerifiedApiKeyRecord {
  apiKeyId: string;
  scopes: ApiKeyScope[];
  stripeCustomerId: string | null;
  userId: string;
}

/** Cached response associated with a developer idempotency key. */
export interface IdempotentApiResponse {
  requestHash: string;
  responseBody: unknown;
  responseStatus: number;
}

/** Input for an administrator-reviewed dispute case. */
export interface SaveDisputeCaseInput {
  archivedRules: string;
  checkIds: string[];
  disputedWording: string;
  externalId: string;
  marketUrl: string;
  outcome: string | null;
  platform: "polymarket" | "kalshi";
  reviewStatus: "pending_review" | "published" | "rejected";
  slug: string;
  sourceLabel: string;
  sourceQuote: string | null;
  sourceUrl: string;
  title: string;
  transactionHash: string | null;
  wordingTags: string[];
}

/** Neon persistence for account, billing, watchlist, dispute, and API features. */
export class ProductStore {
  /**
   * Creates a product-feature store.
   *
   * @param database - Typed Drizzle database client.
   */
  public constructor(private readonly database: FinePredictDatabase) {}

  /**
   * Returns the user's current subscription entitlement.
   *
   * @param userId - Authenticated user ID.
   * @param providerConfigured - Whether Stripe checkout can be used.
   * @returns Subscription summary with the fixed market limit.
   */
  public async getSubscriptionSummary(
    userId: string,
    providerConfigured: boolean,
  ): Promise<SubscriptionSummary> {
    const [row] = await this.database
      .select()
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.product, "watchlists"),
        ),
      )
      .limit(1);
    const status = SubscriptionStatusSchema.parse(row?.status ?? "inactive");
    return {
      activeMarketLimit: ACTIVE_MARKET_LIMIT,
      cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? false,
      currentPeriodEnd: row?.currentPeriodEnd?.toISOString() ?? null,
      entitled: isSubscriptionEntitled(status),
      providerConfigured,
      status,
    };
  }

  /**
   * Returns Stripe billing identifiers for an account.
   *
   * @param userId - Authenticated user ID.
   * @returns Existing Stripe customer identity.
   */
  public async getBillingIdentity(userId: string): Promise<BillingIdentity> {
    const [row] = await this.database
      .select({ stripeCustomerId: subscriptions.stripeCustomerId })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .limit(1);
    return { stripeCustomerId: row?.stripeCustomerId ?? null };
  }

  /**
   * Applies a verified Stripe subscription event to local entitlements.
   *
   * @param update - Verified Stripe subscription state.
   * @returns Nothing after the entitlement is persisted.
   */
  public async applyStripeSubscriptionUpdate(
    update: StripeSubscriptionUpdate,
  ): Promise<void> {
    let userId = update.userId;
    if (!userId) {
      const [existing] = await this.database
        .select({ userId: subscriptions.userId })
        .from(subscriptions)
        .where(eq(subscriptions.stripeCustomerId, update.stripeCustomerId))
        .limit(1);
      userId = existing?.userId ?? null;
    }
    if (!userId) {
      throw new Error(
        `FinePredict billing: Stripe subscription has no FinePredict user mapping.`,
      );
    }
    await this.database
      .insert(subscriptions)
      .values({
        cancelAtPeriodEnd: update.cancelAtPeriodEnd,
        currentPeriodEnd: update.currentPeriodEnd,
        status: update.status,
        product: update.product,
        stripeCustomerId: update.stripeCustomerId,
        stripeSubscriptionId: update.stripeSubscriptionId,
        userId,
      })
      .onConflictDoUpdate({
        target: [subscriptions.userId, subscriptions.product],
        set: {
          cancelAtPeriodEnd: update.cancelAtPeriodEnd,
          currentPeriodEnd: update.currentPeriodEnd,
          status: update.status,
          stripeCustomerId: update.stripeCustomerId,
          stripeSubscriptionId: update.stripeSubscriptionId,
          updatedAt: new Date(),
        },
      });
  }

  /**
   * Checks whether an account has an active metered developer API subscription.
   *
   * @param userId - Authenticated account ID.
   * @returns True when the separate API subscription is entitled.
   */
  public async isDeveloperApiEntitled(userId: string): Promise<boolean> {
    const [row] = await this.database
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.userId, userId),
          eq(subscriptions.product, "developer_api"),
        ),
      )
      .limit(1);
    return row ? isSubscriptionEntitled(row.status) : false;
  }

  /**
   * Claims a Stripe webhook ID exactly once.
   *
   * @param eventId - Stripe event ID.
   * @param eventType - Stripe event type.
   * @returns True when this process claimed the event.
   */
  public async claimStripeWebhook(
    eventId: string,
    eventType: string,
  ): Promise<boolean> {
    const rows = await this.database
      .insert(stripeWebhookEvents)
      .values({ eventId, eventType })
      .onConflictDoNothing()
      .returning({ eventId: stripeWebhookEvents.eventId });
    return rows.length === 1;
  }

  /**
   * Releases a claimed webhook after processing fails so Stripe can retry it.
   *
   * @param eventId - Stripe event identifier.
   * @returns Nothing after deleting the incomplete claim.
   */
  public async releaseStripeWebhook(eventId: string): Promise<void> {
    await this.database
      .delete(stripeWebhookEvents)
      .where(eq(stripeWebhookEvents.eventId, eventId));
  }

  /**
   * Lists all watchlists and their markets for an account.
   *
   * @param userId - Authenticated user ID.
   * @returns User watchlists ordered newest first.
   */
  public async listWatchlists(userId: string): Promise<Watchlist[]> {
    const listRows = await this.database
      .select()
      .from(watchlists)
      .where(eq(watchlists.userId, userId))
      .orderBy(desc(watchlists.createdAt));
    if (listRows.length === 0) {
      return [];
    }
    const marketRows = await this.database
      .select()
      .from(watchlistMarkets)
      .where(
        inArray(
          watchlistMarkets.watchlistId,
          listRows.map((row) => row.id),
        ),
      )
      .orderBy(desc(watchlistMarkets.addedAt));
    return listRows.map((list) => ({
      createdAt: list.createdAt.toISOString(),
      id: list.id,
      markets: marketRows
        .filter((market) => market.watchlistId === list.id)
        .map((market) => ({
          active: market.active,
          addedAt: market.addedAt.toISOString(),
          externalId: market.externalId,
          id: market.id,
          marketUrl: market.marketUrl,
          platform: market.platform === "kalshi" ? "kalshi" : "polymarket",
          title: market.title,
        })),
      name: list.name,
    }));
  }

  /**
   * Creates a named user watchlist.
   *
   * @param userId - Authenticated user ID.
   * @param name - Display name.
   * @returns Created watchlist.
   */
  public async createWatchlist(
    userId: string,
    name: string,
  ): Promise<Watchlist> {
    const [row] = await this.database
      .insert(watchlists)
      .values({ name, userId })
      .returning();
    if (!row) {
      throw new Error(`FinePredict watchlists: insert returned no row.`);
    }
    return {
      createdAt: row.createdAt.toISOString(),
      id: row.id,
      markets: [],
      name: row.name,
    };
  }

  /**
   * Adds one active market while atomically enforcing paid entitlement and limit.
   *
   * @param userId - Authenticated owner ID.
   * @param watchlistId - Target watchlist ID.
   * @param contract - Freshly fetched normalized market contract.
   * @returns Created market identifier.
   */
  public async addWatchlistMarket(
    userId: string,
    watchlistId: string,
    contract: MarketContract,
  ): Promise<string> {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`watchlist-limit:${userId}`}))`,
      );
      const [list] = await transaction
        .select({ id: watchlists.id })
        .from(watchlists)
        .where(
          and(eq(watchlists.id, watchlistId), eq(watchlists.userId, userId)),
        )
        .limit(1);
      if (!list) {
        throw new ProductAccessError(404, `Watchlist not found.`);
      }
      const [subscription] = await transaction
        .select({ status: subscriptions.status })
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId))
        .limit(1);
      if (!subscription || !isSubscriptionEntitled(subscription.status)) {
        throw new ProductAccessError(
          402,
          `An active FinePredict subscription is required for monitoring.`,
        );
      }
      const [activeCount] = await transaction
        .select({ value: count() })
        .from(watchlistMarkets)
        .innerJoin(watchlists, eq(watchlistMarkets.watchlistId, watchlists.id))
        .where(
          and(eq(watchlists.userId, userId), eq(watchlistMarkets.active, true)),
        );
      if ((activeCount?.value ?? 0) >= ACTIVE_MARKET_LIMIT) {
        throw new ProductAccessError(
          409,
          `Paid accounts can monitor up to ${String(ACTIVE_MARKET_LIMIT)} active markets.`,
        );
      }
      const [row] = await transaction
        .insert(watchlistMarkets)
        .values({
          externalId: contract.externalId,
          marketUrl: contract.url,
          platform: contract.platform,
          title: contract.title,
          watchlistId,
        })
        .onConflictDoUpdate({
          target: [
            watchlistMarkets.watchlistId,
            watchlistMarkets.platform,
            watchlistMarkets.externalId,
          ],
          set: {
            active: true,
            marketUrl: contract.url,
            title: contract.title,
          },
        })
        .returning({ id: watchlistMarkets.id });
      if (!row) {
        throw new Error(
          `FinePredict watchlists: market insert returned no row.`,
        );
      }
      return row.id;
    });
  }

  /**
   * Deactivates a watched market without deleting its observation history.
   *
   * @param userId - Authenticated owner ID.
   * @param marketId - Watchlist-market identifier.
   * @returns True when a market was deactivated.
   */
  public async deactivateWatchlistMarket(
    userId: string,
    marketId: string,
  ): Promise<boolean> {
    const rows = await this.database
      .update(watchlistMarkets)
      .set({ active: false })
      .from(watchlists)
      .where(
        and(
          eq(watchlistMarkets.id, marketId),
          eq(watchlistMarkets.watchlistId, watchlists.id),
          eq(watchlists.userId, userId),
        ),
      )
      .returning({ id: watchlistMarkets.id });
    return rows.length === 1;
  }

  /**
   * Lists in-app monitoring notifications for an account.
   *
   * @param userId - Authenticated owner ID.
   * @param limit - Maximum returned alerts.
   * @returns Alerts ordered newest first.
   */
  public async listAlerts(userId: string, limit = 100): Promise<AlertEvent[]> {
    const rows = await this.database
      .select()
      .from(alertEvents)
      .where(eq(alertEvents.userId, userId))
      .orderBy(desc(alertEvents.createdAt))
      .limit(limit);
    return rows.map((row) =>
      AlertEventSchema.parse({
        createdAt: row.createdAt.toISOString(),
        detail: row.detail,
        id: row.id,
        marketUrl: row.marketUrl,
        readAt: row.readAt?.toISOString() ?? null,
        title: row.title,
        type: row.eventType,
      }),
    );
  }

  /**
   * Marks one notification read when it belongs to the current account.
   *
   * @param userId - Authenticated owner ID.
   * @param alertId - Alert identifier.
   * @returns True when an alert was updated.
   */
  public async markAlertRead(
    userId: string,
    alertId: string,
  ): Promise<boolean> {
    const rows = await this.database
      .update(alertEvents)
      .set({ readAt: new Date() })
      .where(and(eq(alertEvents.id, alertId), eq(alertEvents.userId, userId)))
      .returning({ id: alertEvents.id });
    return rows.length === 1;
  }

  /**
   * Returns the latest live observation for a platform contract.
   *
   * @param platform - Supported market platform.
   * @param externalId - Platform market identifier.
   * @returns Latest normalized observation or null.
   */
  public async getLatestMarketObservation(
    platform: "polymarket" | "kalshi",
    externalId: string,
  ): Promise<MarketObservation | null> {
    const [row] = await this.database
      .select()
      .from(marketObservations)
      .where(
        and(
          eq(marketObservations.platform, platform),
          eq(marketObservations.externalId, externalId),
        ),
      )
      .orderBy(desc(marketObservations.observedAt))
      .limit(1);
    return row
      ? MarketObservationSchema.parse({
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
        })
      : null;
  }

  /**
   * Lists published dispute cases or the administrator review queue.
   *
   * @param includeUnreviewed - Whether pending/rejected rows may be returned.
   * @returns Dispute cases with sources and lifecycle events.
   */
  public async listDisputeCases(
    includeUnreviewed = false,
  ): Promise<DisputeCase[]> {
    const rows = await this.database
      .select()
      .from(disputeCases)
      .where(
        includeUnreviewed
          ? sql`true`
          : eq(disputeCases.reviewStatus, "published"),
      )
      .orderBy(desc(disputeCases.publishedAt), desc(disputeCases.createdAt))
      .limit(100);
    return this.hydrateDisputeCases(rows);
  }

  /**
   * Loads one dispute case by public slug.
   *
   * @param slug - Stable case slug.
   * @param includeUnreviewed - Whether administrators may see unpublished rows.
   * @returns Hydrated dispute case or null.
   */
  public async getDisputeCase(
    slug: string,
    includeUnreviewed = false,
  ): Promise<DisputeCase | null> {
    const rows = await this.database
      .select()
      .from(disputeCases)
      .where(
        and(
          eq(disputeCases.slug, slug),
          includeUnreviewed
            ? sql`true`
            : eq(disputeCases.reviewStatus, "published"),
        ),
      )
      .limit(1);
    const hydrated = await this.hydrateDisputeCases(rows);
    return hydrated[0] ?? null;
  }

  /**
   * Saves or updates an imported dispute and its exact citation.
   *
   * @param input - Reviewed or pending dispute material.
   * @returns Hydrated saved dispute case.
   */
  public async saveDisputeCase(
    input: SaveDisputeCaseInput,
  ): Promise<DisputeCase> {
    const searchDocument = [
      input.title,
      input.disputedWording,
      ...input.wordingTags,
      ...input.checkIds,
    ].join(" ");
    const [row] = await this.database
      .insert(disputeCases)
      .values({
        archivedRules: input.archivedRules,
        checkIds: input.checkIds,
        disputedWording: input.disputedWording,
        externalId: input.externalId,
        marketUrl: input.marketUrl,
        outcome: input.outcome,
        platform: input.platform,
        publishedAt:
          input.reviewStatus === "published" ? new Date() : undefined,
        reviewStatus: input.reviewStatus,
        searchDocument,
        slug: input.slug,
        title: input.title,
        wordingTags: input.wordingTags,
      })
      .onConflictDoUpdate({
        target: [disputeCases.platform, disputeCases.externalId],
        set: {
          archivedRules: input.archivedRules,
          checkIds: input.checkIds,
          disputedWording: input.disputedWording,
          marketUrl: input.marketUrl,
          outcome: input.outcome,
          publishedAt: input.reviewStatus === "published" ? new Date() : null,
          reviewStatus: input.reviewStatus,
          searchDocument,
          slug: input.slug,
          title: input.title,
          updatedAt: new Date(),
          wordingTags: input.wordingTags,
        },
      })
      .returning();
    if (!row) {
      throw new Error(`FinePredict disputes: case upsert returned no row.`);
    }
    await this.database.insert(disputeSources).values({
      disputeCaseId: row.id,
      label: input.sourceLabel,
      quotedText: input.sourceQuote,
      transactionHash: input.transactionHash,
      url: input.sourceUrl,
    });
    const [hydrated] = await this.hydrateDisputeCases([row]);
    if (!hydrated) {
      throw new Error(`FinePredict disputes: saved case could not be loaded.`);
    }
    return hydrated;
  }

  /**
   * Returns deterministic related cases with plain-language match reasons.
   *
   * @param checkIds - Deterministic finding identifiers from a report.
   * @param wordingTags - Normalized terms present in report wording.
   * @returns Related published cases without a similarity score.
   */
  public async findRelatedDisputes(
    checkIds: string[],
    wordingTags: string[],
  ): Promise<DisputeCase[]> {
    const searchTerms = [...checkIds, ...wordingTags].filter(Boolean);
    const rows = await this.database
      .select()
      .from(disputeCases)
      .where(
        and(
          eq(disputeCases.reviewStatus, "published"),
          searchTerms.length > 0
            ? sql`to_tsvector('english', ${disputeCases.searchDocument}) @@ websearch_to_tsquery('english', ${searchTerms.join(" OR ")})`
            : sql`false`,
        ),
      )
      .orderBy(desc(disputeCases.publishedAt))
      .limit(25);
    const cases = await this.hydrateDisputeCases(rows);
    return cases
      .map((item) => {
        const matchingChecks = item.checkIds.filter((value) =>
          checkIds.includes(value),
        );
        const matchingTags = item.wordingTags.filter((value) =>
          wordingTags.includes(value),
        );
        const matchReasons = [
          ...matchingChecks.map(
            (value) => `Same deterministic warning: ${value}.`,
          ),
          ...matchingTags.map((value) => `Shared wording term: ${value}.`),
        ];
        return { ...item, matchReasons };
      })
      .filter((item) => (item.matchReasons?.length ?? 0) > 0)
      .slice(0, 5);
  }

  /**
   * Persists a newly generated hashed API key.
   *
   * @param input - Safe API key metadata and hash.
   * @returns Safe key summary.
   */
  public async createApiKey(input: {
    hash: string;
    name: string;
    prefix: string;
    scopes: ApiKeyScope[];
    userId: string;
  }): Promise<ApiKeySummary> {
    const [row] = await this.database
      .insert(apiKeys)
      .values({
        name: input.name,
        prefix: input.prefix,
        scopes: input.scopes,
        secretHash: input.hash,
        userId: input.userId,
      })
      .returning();
    if (!row) {
      throw new Error(`FinePredict developer API: key insert returned no row.`);
    }
    return mapApiKeySummary(row);
  }

  /**
   * Lists safe API-key metadata for an account.
   *
   * @param userId - Authenticated account ID.
   * @returns API key summaries ordered newest first.
   */
  public async listApiKeys(userId: string): Promise<ApiKeySummary[]> {
    const rows = await this.database
      .select()
      .from(apiKeys)
      .where(eq(apiKeys.userId, userId))
      .orderBy(desc(apiKeys.createdAt));
    return rows.map(mapApiKeySummary);
  }

  /**
   * Revokes an API key owned by the authenticated account.
   *
   * @param userId - Authenticated owner ID.
   * @param apiKeyId - API key identifier.
   * @returns True when a live key was revoked.
   */
  public async revokeApiKey(
    userId: string,
    apiKeyId: string,
  ): Promise<boolean> {
    const rows = await this.database
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(apiKeys.id, apiKeyId),
          eq(apiKeys.userId, userId),
          isNull(apiKeys.revokedAt),
        ),
      )
      .returning({ id: apiKeys.id });
    return rows.length === 1;
  }

  /**
   * Finds an active API key by HMAC and updates its last-used timestamp.
   *
   * @param secretHash - HMAC of the presented bearer token.
   * @returns Authorized key details or null.
   */
  public async findApiKeyByHash(
    secretHash: string,
  ): Promise<VerifiedApiKeyRecord | null> {
    const [row] = await this.database
      .select({
        apiKeyId: apiKeys.id,
        scopes: apiKeys.scopes,
        stripeCustomerId: subscriptions.stripeCustomerId,
        userId: apiKeys.userId,
      })
      .from(apiKeys)
      .innerJoin(
        subscriptions,
        and(
          eq(apiKeys.userId, subscriptions.userId),
          eq(subscriptions.product, "developer_api"),
        ),
      )
      .where(
        and(
          eq(apiKeys.secretHash, secretHash),
          isNull(apiKeys.revokedAt),
          inArray(subscriptions.status, ["active", "trialing"]),
        ),
      )
      .limit(1);
    if (!row) {
      return null;
    }
    await this.database
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, row.apiKeyId));
    return {
      apiKeyId: row.apiKeyId,
      scopes: ApiKeyScopeSchema.array().parse(row.scopes),
      stripeCustomerId: row.stripeCustomerId,
      userId: row.userId,
    };
  }

  /**
   * Atomically consumes one daily API unit up to the configured quota.
   *
   * @param key - Authorized API key details.
   * @param limit - Maximum units allowed per UTC day.
   * @returns Updated usage or null when quota is exhausted.
   */
  public async consumeApiUnit(
    key: VerifiedApiKeyRecord,
    limit: number,
  ): Promise<number | null> {
    const usageDate = new Date().toISOString().slice(0, 10);
    const rows = await this.database
      .insert(apiUsageDaily)
      .values({
        apiKeyId: key.apiKeyId,
        billableUnits: 1,
        usageDate,
        userId: key.userId,
      })
      .onConflictDoUpdate({
        target: [apiUsageDaily.apiKeyId, apiUsageDaily.usageDate],
        set: { billableUnits: sql`${apiUsageDaily.billableUnits} + 1` },
        setWhere: lt(apiUsageDaily.billableUnits, limit),
      })
      .returning({ billableUnits: apiUsageDaily.billableUnits });
    return rows[0]?.billableUnits ?? null;
  }

  /**
   * Lists daily usage for an authenticated account.
   *
   * @param userId - Authenticated account ID.
   * @returns Most recent daily usage aggregates.
   */
  public async listUsage(userId: string): Promise<UsageSummary[]> {
    const rows = await this.database
      .select()
      .from(apiUsageDaily)
      .where(eq(apiUsageDaily.userId, userId))
      .orderBy(desc(apiUsageDaily.usageDate))
      .limit(90);
    return rows.map((row) => ({
      billableUnits: row.billableUnits,
      date: row.usageDate,
      reportedToStripeAt: row.reportedToStripeAt?.toISOString() ?? null,
    }));
  }

  /**
   * Loads a cached versioned-API response by idempotency key.
   *
   * @param apiKeyId - Authorized API key ID.
   * @param idempotencyKey - Caller-provided stable operation key.
   * @returns Cached response or null.
   */
  public async getIdempotentResponse(
    apiKeyId: string,
    idempotencyKey: string,
  ): Promise<IdempotentApiResponse | null> {
    const [row] = await this.database
      .select()
      .from(apiIdempotency)
      .where(
        and(
          eq(apiIdempotency.apiKeyId, apiKeyId),
          eq(apiIdempotency.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return row
      ? {
          requestHash: row.requestHash,
          responseBody: row.responseBody,
          responseStatus: row.responseStatus,
        }
      : null;
  }

  /**
   * Persists a developer API response for safe retries.
   *
   * @param input - API key, request hash, status, and response payload.
   * @returns Nothing after persistence.
   */
  public async saveIdempotentResponse(input: {
    apiKeyId: string;
    idempotencyKey: string;
    requestHash: string;
    responseBody: unknown;
    responseStatus: number;
  }): Promise<void> {
    await this.database
      .insert(apiIdempotency)
      .values(input)
      .onConflictDoNothing();
  }

  /**
   * Returns the email address associated with an account.
   *
   * @param userId - Better Auth user ID.
   * @returns Account email or null.
   */
  public async getUserEmail(userId: string): Promise<string | null> {
    const [row] = await this.database
      .select({ email: authUsers.email })
      .from(authUsers)
      .where(eq(authUsers.id, userId))
      .limit(1);
    return row?.email ?? null;
  }

  /**
   * Hydrates dispute rows with exact sources and lifecycle events.
   *
   * @param rows - Selected dispute-case table rows.
   * @returns Fully hydrated dispute cases.
   */
  private async hydrateDisputeCases(
    rows: (typeof disputeCases.$inferSelect)[],
  ): Promise<DisputeCase[]> {
    if (rows.length === 0) {
      return [];
    }
    const caseIds = rows.map((row) => row.id);
    const [sources, events] = await Promise.all([
      this.database
        .select()
        .from(disputeSources)
        .where(inArray(disputeSources.disputeCaseId, caseIds)),
      this.database
        .select()
        .from(disputeEvents)
        .where(inArray(disputeEvents.disputeCaseId, caseIds))
        .orderBy(disputeEvents.occurredAt),
    ]);
    return rows.map((row) =>
      DisputeCaseSchema.parse({
        archivedRules: row.archivedRules,
        checkIds: row.checkIds,
        disputedWording: row.disputedWording,
        events: events
          .filter((event) => event.disputeCaseId === row.id)
          .map((event) => ({
            detail: event.detail,
            eventType: event.eventType,
            id: event.id,
            occurredAt: event.occurredAt.toISOString(),
            rawPlatformState: event.rawPlatformState,
            transactionHash: event.transactionHash,
          })),
        externalId: row.externalId,
        id: row.id,
        marketUrl: row.marketUrl,
        outcome: row.outcome,
        platform: row.platform,
        publishedAt: row.publishedAt?.toISOString() ?? null,
        reviewStatus: row.reviewStatus,
        slug: row.slug,
        sources: sources
          .filter((source) => source.disputeCaseId === row.id)
          .map((source) => ({
            id: source.id,
            label: source.label,
            quotedText: source.quotedText,
            transactionHash: source.transactionHash,
            url: source.url,
          })),
        title: row.title,
        wordingTags: row.wordingTags,
      }),
    );
  }
}

/** HTTP-safe application error for entitlement and ownership failures. */
export class ProductAccessError extends Error {
  /**
   * Creates a product access error.
   *
   * @param status - HTTP response status.
   * @param message - Safe user-facing explanation.
   */
  public constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ProductAccessError";
  }
}

/**
 * Determines whether a subscription state grants watchlist access.
 *
 * @param status - Stripe-compatible subscription state.
 * @returns True for active and trialing subscriptions.
 */
export function isSubscriptionEntitled(status: string): boolean {
  return status === "active" || status === "trialing";
}

/**
 * Converts an API-key database row into safe public metadata.
 *
 * @param row - Selected API-key row.
 * @returns API key without its hash or secret.
 */
function mapApiKeySummary(row: typeof apiKeys.$inferSelect): ApiKeySummary {
  return {
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    name: row.name,
    prefix: row.prefix,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    scopes: ApiKeyScopeSchema.array().parse(row.scopes),
  };
}
