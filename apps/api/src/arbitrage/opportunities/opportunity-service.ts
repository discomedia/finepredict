import { log } from "../common/log.js";
import type {
  OpportunityPriceRefreshResult,
  OpportunityScanResult,
  OpportunityScanOptions,
  OpportunityServiceJobType,
  OpportunityServiceRun,
  OpportunityServiceStatus,
  OpportunityServiceUpdate,
} from "./types.js";

/** Public scanner surface required by the periodic coordinator. */
export interface OpportunityServiceScanner {
  /**
   * Reconciles current native catalogs.
   *
   * @returns Catalog, request, and write counts.
   */
  readonly refreshCatalog: () => Promise<{
    readonly requestCount: number;
    readonly kalshiMarketCount: number;
    readonly polymarketMarketCount: number;
    readonly changedMarketCount: number;
    readonly deletedMarketCount: number;
    readonly databaseWriteCount: number;
  }>;
  /**
   * Runs deterministic discovery and direct-book analysis.
   *
   * @param options - Bounded scan controls.
   * @returns Published discovery scan.
   */
  readonly scan: (
    options: OpportunityScanOptions,
  ) => Promise<OpportunityScanResult>;
  /**
   * Reprices currently tracked priority rows.
   *
   * @param options - Economics and request controls.
   * @param maximumOpportunityCount - Hard pair cap.
   * @returns Price refresh result.
   */
  readonly refreshPrices: (
    options: OpportunityScanOptions,
    maximumOpportunityCount: number,
  ) => Promise<OpportunityPriceRefreshResult>;
}

/** Durable run-metric surface required by the periodic coordinator. */
export interface OpportunityServiceRepository {
  /**
   * Loads the latest run for one job kind.
   *
   * @param jobType - Discovery or price refresh.
   * @returns Latest run when present.
   */
  readonly getLatestServiceRun: (
    jobType: OpportunityServiceJobType,
  ) => Promise<OpportunityServiceRun | undefined>;
  /**
   * Persists one running, completed, or failed job row.
   *
   * @param run - Current run metrics.
   * @returns Durable row-write count.
   */
  readonly saveServiceRun: (run: OpportunityServiceRun) => Promise<number>;
  /**
   * Runs one operation under the database-wide scanner advisory lock.
   *
   * @param operation - Bounded scanner operation.
   * @returns True when the lock was acquired and the operation ran.
   */
  readonly runWithServiceLock: (
    operation: () => Promise<void>,
  ) => Promise<boolean>;
}

/** Scheduler controls for the recurring opportunity service. */
export interface OpportunityServiceOptions {
  /** Native catalog and direct-book scanner. */
  readonly scanner: OpportunityServiceScanner;
  /** Durable current-state repository. */
  readonly repository: OpportunityServiceRepository;
  /** Full catalog rediscovery interval. */
  readonly discoveryIntervalMs: number;
  /** Current-opportunity direct-price refresh interval. */
  readonly priceRefreshIntervalMs: number;
  /** Maximum current pairs repriced per price-only cycle. */
  readonly maximumPriceRefreshPairs: number;
  /** Shared deterministic matching and economics controls. */
  readonly scanOptions: OpportunityScanOptions;
}

/** Metrics returned by one scheduler operation before run-row accounting. */
interface CompletedJobMetrics {
  /** Public venue requests used by the operation. */
  readonly externalRequestCount: number;
  /** Durable product-state writes used by the operation. */
  readonly databaseWriteCount: number;
  /** Direct-price candidates considered. */
  readonly candidateCount: number;
  /** Positive post-fee rows published. */
  readonly opportunityCount: number;
}

/** Listener receiving lightweight dashboard invalidation events. */
export type OpportunityServiceListener = (
  update: OpportunityServiceUpdate,
) => void;

/** Periodic catalog-discovery and direct-price refresh coordinator. */
export class OpportunityService {
  private readonly scanner: OpportunityServiceScanner;
  private readonly repository: OpportunityServiceRepository;
  private readonly discoveryIntervalMs: number;
  private readonly priceRefreshIntervalMs: number;
  private readonly maximumPriceRefreshPairs: number;
  private readonly scanOptions: OpportunityScanOptions;
  private readonly listeners = new Set<OpportunityServiceListener>();
  private discoveryTimer: NodeJS.Timeout | undefined;
  private priceRefreshTimer: NodeJS.Timeout | undefined;
  private running = false;
  private activeJob: OpportunityServiceJobType | undefined;
  private lastDiscoveryRun: OpportunityServiceRun | undefined;
  private lastPriceRefreshRun: OpportunityServiceRun | undefined;
  private activeRunPromise: Promise<void> | undefined;

  /**
   * Creates a recurring opportunity service without starting timers.
   *
   * @param options - Scanner, repository, cadences, and hard request bounds.
   */
  public constructor(options: OpportunityServiceOptions) {
    assertPositiveInterval(options.discoveryIntervalMs, "discoveryIntervalMs");
    assertPositiveInterval(
      options.priceRefreshIntervalMs,
      "priceRefreshIntervalMs",
    );
    if (
      !Number.isInteger(options.maximumPriceRefreshPairs) ||
      options.maximumPriceRefreshPairs < 1
    ) {
      throw new Error("maximumPriceRefreshPairs must be a positive integer");
    }
    this.scanner = options.scanner;
    this.repository = options.repository;
    this.discoveryIntervalMs = options.discoveryIntervalMs;
    this.priceRefreshIntervalMs = options.priceRefreshIntervalMs;
    this.maximumPriceRefreshPairs = options.maximumPriceRefreshPairs;
    this.scanOptions = options.scanOptions;
  }

  /**
   * Starts periodic timers and optionally queues a full discovery immediately.
   *
   * @param runImmediately - Whether to queue discovery on service start.
   * @returns Nothing after timers are active.
   */
  public async start(runImmediately = true): Promise<void> {
    if (this.running) {
      return;
    }
    [this.lastDiscoveryRun, this.lastPriceRefreshRun] = await Promise.all([
      this.repository.getLatestServiceRun("discovery"),
      this.repository.getLatestServiceRun("price_refresh"),
    ]);
    this.running = true;
    this.discoveryTimer = setInterval(() => {
      void this.runDiscoveryNow();
    }, this.discoveryIntervalMs);
    this.priceRefreshTimer = setInterval(() => {
      void this.runPriceRefreshNow();
    }, this.priceRefreshIntervalMs);
    this.emit({ type: "status", emittedAtIso: new Date().toISOString() });
    if (runImmediately) {
      void this.runDiscoveryNow();
    }
  }

  /**
   * Stops future jobs without interrupting an active safe read-only run.
   *
   * @returns Nothing.
   */
  public stop(): void {
    this.running = false;
    if (this.discoveryTimer) {
      clearInterval(this.discoveryTimer);
      this.discoveryTimer = undefined;
    }
    if (this.priceRefreshTimer) {
      clearInterval(this.priceRefreshTimer);
      this.priceRefreshTimer = undefined;
    }
    this.emit({ type: "status", emittedAtIso: new Date().toISOString() });
  }

  /**
   * Runs one full catalog reconciliation and bounded fresh-book discovery.
   * A concurrent scheduler job causes a safe no-op.
   *
   * @returns Nothing after completion or a concurrency skip.
   */
  public async runDiscoveryNow(): Promise<void> {
    await this.runExclusiveJob("discovery", async () => {
      const catalog = await this.scanner.refreshCatalog();
      const scan = await this.scanner.scan(this.scanOptions);
      return {
        externalRequestCount: catalog.requestCount + scan.externalRequestCount,
        databaseWriteCount:
          catalog.databaseWriteCount + scan.databaseWriteCount,
        candidateCount: scan.freshBookCandidateCount,
        opportunityCount: scan.opportunities.length,
      };
    });
  }

  /**
   * Reprices a small priority set using direct books only. A concurrent
   * discovery or price job causes a safe no-op.
   *
   * @returns Nothing after completion or a concurrency skip.
   */
  public async runPriceRefreshNow(): Promise<void> {
    await this.runExclusiveJob("price_refresh", async () => {
      const result = await this.scanner.refreshPrices(
        this.scanOptions,
        this.maximumPriceRefreshPairs,
      );
      return {
        externalRequestCount: result.externalRequestCount,
        databaseWriteCount: result.databaseWriteCount,
        candidateCount: result.attemptedOpportunityCount,
        opportunityCount: result.updatedOpportunityCount,
      };
    });
  }

  /**
   * Waits for the current job, if any. Intended for graceful shutdown and
   * deterministic integration tests.
   *
   * @returns Nothing after the active job settles.
   */
  public async waitForIdle(): Promise<void> {
    await this.activeRunPromise;
  }

  /**
   * Returns scheduler state and persisted last-run metrics.
   *
   * @returns Current service status.
   */
  public getStatus(): OpportunityServiceStatus {
    return {
      running: this.running,
      ...(this.activeJob ? { activeJob: this.activeJob } : {}),
      discoveryIntervalSeconds: this.discoveryIntervalMs / 1_000,
      priceRefreshIntervalSeconds: this.priceRefreshIntervalMs / 1_000,
      maximumPriceRefreshPairs: this.maximumPriceRefreshPairs,
      ...(this.lastDiscoveryRun
        ? { lastDiscoveryRun: this.lastDiscoveryRun }
        : {}),
      ...(this.lastPriceRefreshRun
        ? { lastPriceRefreshRun: this.lastPriceRefreshRun }
        : {}),
      connectedClientCount: this.listeners.size,
    };
  }

  /**
   * Subscribes one API client to lightweight update events.
   *
   * @param listener - Event callback.
   * @returns Unsubscribe callback.
   */
  public subscribe(listener: OpportunityServiceListener): () => void {
    this.listeners.add(listener);
    this.emit({ type: "status", emittedAtIso: new Date().toISOString() });
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Runs one job under the global scheduler lock and persists cost metrics.
   *
   * @param jobType - Discovery or price refresh.
   * @param operation - Bounded read-only market operation.
   * @returns Nothing after completion or a concurrency skip.
   */
  private async runExclusiveJob(
    jobType: OpportunityServiceJobType,
    operation: () => Promise<CompletedJobMetrics>,
  ): Promise<void> {
    if (this.activeJob) {
      log(
        "info",
        "OpportunityService.runExclusiveJob",
        `Skipped ${jobType} because ${this.activeJob} is still running`,
      );
      return;
    }
    this.activeJob = jobType;
    const promise = this.repository
      .runWithServiceLock(() => this.executeJob(jobType, operation))
      .then((acquired) => {
        if (!acquired) {
          log(
            "info",
            "OpportunityService.runExclusiveJob",
            `Skipped ${jobType} because another process holds the scanner lock`,
          );
          this.activeJob = undefined;
          this.emit({
            type: "status",
            jobType,
            emittedAtIso: new Date().toISOString(),
          });
        }
      });
    this.activeRunPromise = promise;
    await promise;
    if (this.activeRunPromise === promise) {
      this.activeRunPromise = undefined;
    }
  }

  /**
   * Executes one locked job and records both success and safe failure states.
   *
   * @param jobType - Discovery or price refresh.
   * @param operation - Bounded market operation.
   * @returns Nothing after run metrics and update events are published.
   */
  private async executeJob(
    jobType: OpportunityServiceJobType,
    operation: () => Promise<CompletedJobMetrics>,
  ): Promise<void> {
    const startedAtIso = new Date().toISOString();
    const runId = `${jobType}-${startedAtIso
      .replaceAll(":", "-")
      .replace(".", "-")}`;
    const runningRun: OpportunityServiceRun = {
      runId,
      jobType,
      status: "running",
      startedAtIso,
      externalRequestCount: 0,
      databaseWriteCount: 1,
      candidateCount: 0,
      opportunityCount: 0,
    };
    await this.repository.saveServiceRun(runningRun);
    this.setLastRun(runningRun);
    this.emit({
      type: "status",
      jobType,
      emittedAtIso: new Date().toISOString(),
    });
    try {
      const metrics = await operation();
      const completedRun: OpportunityServiceRun = {
        ...runningRun,
        status: "completed",
        completedAtIso: new Date().toISOString(),
        externalRequestCount: metrics.externalRequestCount,
        databaseWriteCount: metrics.databaseWriteCount + 2,
        candidateCount: metrics.candidateCount,
        opportunityCount: metrics.opportunityCount,
      };
      await this.repository.saveServiceRun(completedRun);
      this.setLastRun(completedRun);
      log(
        "info",
        "OpportunityService.executeJob",
        `${jobType} completed with ${completedRun.externalRequestCount} public requests, ${completedRun.databaseWriteCount} durable writes, and ${completedRun.opportunityCount} positive rows`,
      );
      this.emit({
        type: "opportunities",
        jobType,
        emittedAtIso: new Date().toISOString(),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const failedRun: OpportunityServiceRun = {
        ...runningRun,
        status: "failed",
        completedAtIso: new Date().toISOString(),
        databaseWriteCount: 2,
        errorMessage: message.slice(0, 1_000),
      };
      await this.repository.saveServiceRun(failedRun);
      this.setLastRun(failedRun);
      log("error", "OpportunityService.executeJob", `${jobType}: ${message}`);
    } finally {
      this.activeJob = undefined;
      this.emit({
        type: "status",
        jobType,
        emittedAtIso: new Date().toISOString(),
      });
    }
  }

  /**
   * Updates the in-memory latest run for one job kind.
   *
   * @param run - Persisted service run.
   * @returns Nothing.
   */
  private setLastRun(run: OpportunityServiceRun): void {
    if (run.jobType === "discovery") {
      this.lastDiscoveryRun = run;
    } else {
      this.lastPriceRefreshRun = run;
    }
  }

  /**
   * Delivers one update to all connected listeners without allowing a broken
   * client to interrupt scheduler work.
   *
   * @param update - Lightweight invalidation event.
   * @returns Nothing.
   */
  private emit(update: OpportunityServiceUpdate): void {
    for (const listener of this.listeners) {
      try {
        listener(update);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log("warn", "OpportunityService.emit", message);
      }
    }
  }
}

/**
 * Validates one scheduler interval.
 *
 * @param value - Interval in milliseconds.
 * @param name - Configuration field name.
 * @returns Nothing when valid.
 */
function assertPositiveInterval(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`${name} must be a positive duration`);
  }
}
