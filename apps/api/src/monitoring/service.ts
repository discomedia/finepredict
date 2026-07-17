import { createHash } from "node:crypto";

import type { MarketContract, MarketObservation } from "@finepredict/shared";
import { diffLines as createLineDiff } from "diff";

import { checkSourceAvailability } from "../analysis/source-monitor.js";
import type { AppConfig } from "../config.js";
import type { EmailService } from "../integrations/email.js";
import type { BillingService } from "../integrations/billing.js";
import { log } from "../log.js";
import { fetchMarketContract } from "../markets/platform.js";
import { createMonitoringAlerts, normalizeLifecycleState } from "./diff.js";
import { PolymarketChainMonitor } from "./polymarket-chain.js";
import type { MonitorTarget } from "./store.js";
import { MonitoringStore } from "./store.js";

/** Final counters returned by an hourly monitor invocation. */
export interface MonitorResult {
  checkedCount: number;
  failedCount: number;
  retryCount: number;
}

/** Dependencies used by the short-lived monitor orchestration service. */
export interface MonitorServiceDependencies {
  billingService: BillingService;
  config: AppConfig;
  emailService: EmailService;
  fetchImplementation?: typeof fetch;
  store: MonitoringStore;
}

/** Coordinates hourly checks, snapshots, alerts, emails, and usage roll-ups. */
export class MonitorService {
  private readonly fetchImplementation: typeof fetch;
  private readonly polymarketChainMonitor: PolymarketChainMonitor | null;

  /**
   * Creates an hourly monitoring service.
   *
   * @param dependencies - Runtime configuration and adapters.
   */
  public constructor(
    private readonly dependencies: MonitorServiceDependencies,
  ) {
    this.fetchImplementation = dependencies.fetchImplementation ?? fetch;
    this.polymarketChainMonitor = dependencies.config.polygonRpcUrl
      ? new PolymarketChainMonitor(dependencies.config.polygonRpcUrl)
      : null;
  }

  /**
   * Runs one complete bounded monitoring batch.
   *
   * @returns Final checked, failed, and retry counters.
   */
  public async run(): Promise<MonitorResult> {
    const monitorRunId = await this.dependencies.store.startRun(
      this.dependencies.config.monitorDryRun,
    );
    let checkedCount = 0;
    let failedCount = 0;
    let retryCount = 0;
    let terminalError: string | null = null;
    try {
      const targets = await this.dependencies.store.listTargets();
      for (const target of targets) {
        try {
          await this.checkTarget(target, monitorRunId);
          checkedCount += 1;
        } catch (firstError) {
          retryCount += 1;
          try {
            await this.checkTarget(target, monitorRunId);
            checkedCount += 1;
          } catch (retryError) {
            failedCount += 1;
            const error = stringifyError(retryError);
            await this.saveFailureObservation(target, monitorRunId, error);
            log("MonitorService.run", `Market check failed after one retry.`, {
              error,
              firstError: stringifyError(firstError),
              marketUrl: target.marketUrl,
            });
          }
        }
      }
      if (!this.dependencies.config.monitorDryRun) {
        await this.deliverAlertEmails();
        if (new Date().getUTCHours() === 2) {
          await this.rollUpApiUsage();
        }
      }
    } catch (error) {
      terminalError = stringifyError(error);
      throw error;
    } finally {
      await this.dependencies.store.completeRun({
        checkedCount,
        error: terminalError,
        failedCount,
        monitorRunId,
        retryCount,
      });
    }
    return { checkedCount, failedCount, retryCount };
  }

  /**
   * Fetches and processes one watched market.
   *
   * @param target - Active subscribed market.
   * @param monitorRunId - Parent monitor-run ID.
   * @returns Nothing after observation and alerts are persisted.
   */
  private async checkTarget(
    target: MonitorTarget,
    monitorRunId: string,
  ): Promise<void> {
    const startedAt = performance.now();
    const [contract, previousObservations, previousRules] = await Promise.all([
      fetchMarketContract(target.marketUrl, this.fetchImplementation),
      this.dependencies.store.listRecentObservations(
        target.watchlistMarketId,
        4,
      ),
      this.dependencies.store.getLatestSnapshotRules(
        target.platform,
        target.externalId,
      ),
    ]);
    const rulesHash = hashContract(contract);
    const snapshotId = await this.dependencies.store.saveSnapshotIfChanged({
      contentHash: rulesHash,
      diffLines: previousRules
        ? createVisualDiff(previousRules, contract.rulesText)
        : [],
      endDate: contract.endDate,
      externalId: contract.externalId,
      platform: contract.platform,
      resolutionSource: contract.resolutionSource,
      rulesText: contract.rulesText,
      sourceUrl: contract.url,
      title: contract.title,
    });
    const sourceAvailability = await checkSourceAvailability(
      contract.resolutionSource,
      this.fetchImplementation,
    );
    const observation = await this.dependencies.store.saveObservation({
      deadline: contract.endDate,
      disputeState: contract.disputeState ?? null,
      durationMilliseconds: Math.round(performance.now() - startedAt),
      error: null,
      externalId: contract.externalId,
      monitorRunId,
      normalizedState: normalizeLifecycleState(
        contract.platform,
        contract.status,
      ),
      platform: contract.platform,
      rawPlatformState: contract.status,
      resolutionSource: contract.resolutionSource,
      result: contract.result ?? null,
      rulesHash,
      settlementTimestamp: contract.settlementTimestamp ?? null,
      snapshotId,
      sourceAvailability,
      title: contract.title,
      watchlistMarketId: target.watchlistMarketId,
    });
    const alerts = createMonitoringAlerts(observation, previousObservations);
    const postponementQuote = findNewPostponementLanguage(
      previousRules,
      contract.rulesText,
    );
    if (postponementQuote) {
      alerts.push({
        detail: `New postponement or rescheduling language appears in the rules: “${postponementQuote}”`,
        title: `Postponement language changed`,
        type: "postponement_detected",
      });
    }
    for (const alert of alerts) {
      await this.dependencies.store.saveAlert({
        deduplicationKey: createAlertDeduplicationKey(
          target.watchlistMarketId,
          alert.type,
          observation,
          previousObservations[0] ?? null,
        ),
        detail: alert.detail,
        eventType: alert.type,
        marketUrl: target.marketUrl,
        observationId: observation.id,
        title: `${contract.title}: ${alert.title}`,
        userId: target.userId,
        watchlistMarketId: target.watchlistMarketId,
      });
    }
    if (
      previousObservations[0]?.normalizedState !==
        observation.normalizedState &&
      ["disputed", "amended"].includes(observation.normalizedState)
    ) {
      await this.dependencies.store.importLifecycleDispute({
        externalId: contract.externalId,
        marketUrl: contract.url,
        occurredAt: observation.observedAt,
        platform: contract.platform,
        rawState: contract.status,
        rulesText: contract.rulesText,
        title: contract.title,
      });
    }
    if (
      contract.platform === "polymarket" &&
      contract.platformQuestionId &&
      this.polymarketChainMonitor
    ) {
      try {
        const chainEvents = await this.polymarketChainMonitor.listEvents(
          contract.platformQuestionId,
          contract.platformCreatorAddress ?? null,
        );
        const hasDisputeEvidence = chainEvents.some(
          (event) => event.eventType !== "uma_resolved",
        );
        if (hasDisputeEvidence) {
          for (const event of chainEvents) {
            await this.dependencies.store.importPolymarketChainEvent({
              ...event,
              externalId: contract.externalId,
              marketUrl: contract.url,
              rawState: event.rawPlatformState,
              rulesText: contract.rulesText,
              title: contract.title,
            });
          }
        }
      } catch (error) {
        log(
          "MonitorService.checkTarget",
          `Polygon evidence check failed without invalidating the market observation.`,
          {
            error: stringifyError(error),
            externalId: contract.externalId,
          },
        );
      }
    }
  }

  /**
   * Records an upstream failure without generating misleading change alerts.
   *
   * @param target - Failed monitor target.
   * @param monitorRunId - Parent monitor-run ID.
   * @param error - Failure text.
   * @returns Nothing after the lightweight failure observation is saved.
   */
  private async saveFailureObservation(
    target: MonitorTarget,
    monitorRunId: string,
    error: string,
  ): Promise<void> {
    const previous = (
      await this.dependencies.store.listRecentObservations(
        target.watchlistMarketId,
        1,
      )
    )[0];
    await this.dependencies.store.saveObservation({
      deadline: previous?.deadline ?? null,
      disputeState: previous?.disputeState ?? null,
      durationMilliseconds: 0,
      error,
      externalId: target.externalId,
      monitorRunId,
      normalizedState: previous?.normalizedState ?? "unknown",
      platform: target.platform,
      rawPlatformState: previous?.rawPlatformState ?? "unchecked",
      resolutionSource: previous?.resolutionSource ?? null,
      result: previous?.result ?? null,
      rulesHash: previous?.rulesHash ?? "fetch-failed",
      settlementTimestamp: previous?.settlementTimestamp ?? null,
      snapshotId: previous?.snapshotId ?? null,
      sourceAvailability: "not_checked",
      title: target.title,
      watchlistMarketId: target.watchlistMarketId,
    });
  }

  /**
   * Sends one email per user and leaves failed batches pending for retry.
   *
   * @returns Nothing after all current batches are attempted.
   */
  private async deliverAlertEmails(): Promise<void> {
    if (!this.dependencies.emailService.configured) {
      return;
    }
    const batches = await this.dependencies.store.listPendingAlertBatches();
    for (const batch of batches) {
      try {
        const lines = batch.alerts.map(
          (alert) => `${alert.title}\n${alert.detail}\n${alert.marketUrl}`,
        );
        const items = batch.alerts
          .map(
            (alert) =>
              `<li><strong>${escapeHtml(alert.title)}</strong><br>${escapeHtml(alert.detail)}<br><a href="${escapeHtml(alert.marketUrl)}">Open market</a></li>`,
          )
          .join("");
        await this.dependencies.emailService.send({
          html: `<p>FinePredict found ${String(batch.alerts.length)} monitored contract change${batch.alerts.length === 1 ? "" : "s"}.</p><ul>${items}</ul>`,
          idempotencyKey: `finepredict-alert-batch-${createHash("sha256").update(batch.alertIds.join(":"), "utf8").digest("hex").slice(0, 32)}`,
          subject: `${String(batch.alerts.length)} FinePredict monitoring update${batch.alerts.length === 1 ? "" : "s"}`,
          text: lines.join("\n\n"),
          to: batch.email,
        });
        await this.dependencies.store.markAlertsDelivered(batch.alertIds);
      } catch (error) {
        await this.dependencies.store.markAlertDeliveryFailed(
          batch.alertIds,
          stringifyError(error),
        );
      }
    }
  }

  /**
   * Sends yesterday's atomic usage aggregates to the configured Stripe meter.
   *
   * @returns Nothing after successful rows are marked reported.
   */
  private async rollUpApiUsage(): Promise<void> {
    if (
      !this.dependencies.billingService.developerApiConfigured ||
      !this.dependencies.config.stripeApiMeterEventName
    ) {
      return;
    }
    const rows = await this.dependencies.store.listPendingUsageRollups();
    for (const row of rows) {
      const identifier = `finepredict-api-${row.id}`;
      await this.dependencies.billingService.reportApiUsage({
        customerId: row.customerId,
        identifier,
        units: row.units,
        usageDate: row.usageDate,
      });
      await this.dependencies.store.markUsageReported(row.id, identifier);
    }
  }
}

/**
 * Hashes settlement-relevant content for change detection.
 *
 * @param contract - Fresh normalized contract.
 * @returns SHA-256 content hash.
 */
export function hashMonitoredContract(contract: MarketContract): string {
  return hashContract(contract);
}

/**
 * Hashes settlement-relevant content for change detection.
 *
 * @param contract - Fresh normalized contract.
 * @returns SHA-256 content hash.
 */
function hashContract(contract: MarketContract): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        endDate: contract.endDate,
        resolutionSource: contract.resolutionSource,
        rulesText: contract.rulesText,
        title: contract.title,
      }),
    )
    .digest("hex");
}

/**
 * Creates the human-readable added/removed lines saved with a changed snapshot.
 *
 * @param previousRules - Previous archived rules.
 * @param currentRules - Newly fetched rules.
 * @returns Bounded visual diff lines.
 */
function createVisualDiff(
  previousRules: string,
  currentRules: string,
): string[] {
  return createLineDiff(previousRules, currentRules)
    .filter((part) => part.added || part.removed)
    .flatMap((part) =>
      part.value
        .split("\n")
        .filter(Boolean)
        .map((line) => `${part.added ? "+" : "-"} ${line}`),
    )
    .slice(0, 80);
}

/**
 * Creates a stable key for logically identical monitor transitions.
 *
 * @param watchlistMarketId - Watched market identifier.
 * @param eventType - Concrete alert type.
 * @param current - Current observation.
 * @param previous - Previous observation if one exists.
 * @returns SHA-256 deduplication key.
 */
function createAlertDeduplicationKey(
  watchlistMarketId: string,
  eventType: string,
  current: MarketObservation,
  previous: MarketObservation | null,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        current: {
          deadline: current.deadline,
          normalizedState: current.normalizedState,
          resolutionSource: current.resolutionSource,
          rulesHash: current.rulesHash,
          sourceAvailability: current.sourceAvailability,
          title: current.title,
        },
        eventType,
        previous: previous
          ? {
              deadline: previous.deadline,
              normalizedState: previous.normalizedState,
              resolutionSource: previous.resolutionSource,
              rulesHash: previous.rulesHash,
              sourceAvailability: previous.sourceAvailability,
              title: previous.title,
            }
          : null,
        watchlistMarketId,
      }),
    )
    .digest("hex");
}

/**
 * Escapes untrusted values included in alert-email HTML.
 *
 * @param value - Dynamic alert text or URL.
 * @returns HTML-safe string.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Converts an unknown failure into bounded diagnostic text.
 *
 * @param error - Unknown caught value.
 * @returns Safe error string.
 */
function stringifyError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(
    0,
    2_000,
  );
}

/**
 * Finds newly introduced postponement language and returns the exact sentence.
 *
 * @param previousRules - Previously archived rules, if any.
 * @param currentRules - Current upstream rules.
 * @returns Exact new sentence or null when no relevant wording was introduced.
 */
function findNewPostponementLanguage(
  previousRules: string | null,
  currentRules: string,
): string | null {
  const pattern =
    /\b(?:postpon(?:e|ed|ement)|reschedul(?:e|ed|ing)|delay(?:ed)?)\b/i;
  if (
    previousRules === null ||
    !pattern.test(currentRules) ||
    pattern.test(previousRules)
  ) {
    return null;
  }
  return (
    currentRules
      .split(/(?<=[.!?])\s+|\n+/)
      .find((sentence) => pattern.test(sentence))
      ?.trim()
      .slice(0, 500) ?? null
  );
}
