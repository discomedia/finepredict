import { createHash } from "node:crypto";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  gt,
  inArray,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import type { FinePredictDatabase } from "../../database/client.js";
import {
  arbitrageKalshiFeeSchedules,
  arbitrageMarkets,
  arbitrageOpportunities,
  arbitrageScans,
  arbitrageServiceRuns,
} from "../../database/schema.js";
import type { KalshiFeeSchedule } from "../common/types.js";
import type {
  NativeBinaryMarket,
  OpportunityListFilters,
  OpportunityPriceRefreshResult,
  OpportunityScanResult,
  OpportunityServiceJobType,
  OpportunityServiceRun,
  ScannedOpportunity,
} from "./types.js";

/** Aggregate catalog and opportunity counters exposed to API clients. */
export interface OpportunityRepositorySummary {
  /** Stored active Kalshi contracts. */
  readonly kalshiMarketCount: number;
  /** Stored active Polymarket contracts. */
  readonly polymarketMarketCount: number;
  /** Stored current opportunity records. */
  readonly opportunityCount: number;
  /** Most recent completed scan timestamp. */
  readonly lastScanAtIso?: string;
}

/** Durable writes used to reconcile one complete catalog snapshot. */
export interface CatalogPersistenceStats {
  /** Inserted or materially changed market rows. */
  readonly changedMarketCount: number;
  /** Markets removed because they no longer appear in the active catalog. */
  readonly deletedMarketCount: number;
  /** Total durable market-row writes. */
  readonly databaseWriteCount: number;
}

/** Durable writes used to publish one discovery or price scan. */
export interface OpportunityPersistenceStats {
  /** Inserted or updated current opportunity rows. */
  readonly changedOpportunityCount: number;
  /** Current opportunity rows removed by this publication. */
  readonly deletedOpportunityCount: number;
  /** Total durable opportunity and scan-metadata writes. */
  readonly databaseWriteCount: number;
}

/** One unexpired Kalshi fee schedule loaded from durable storage. */
export interface DurableKalshiFeeSchedule {
  /** Current venue fee configuration. */
  readonly schedule: KalshiFeeSchedule;
  /** UTC cache-expiry timestamp. */
  readonly expiresAtIso: string;
}

/** Maximum values placed in one Postgres insert statement. */
const databaseBatchSize = 500;

/** Postgres-backed catalog and current-opportunity store. */
export class OpportunityRepository {
  /**
   * Creates the arbitrage repository.
   *
   * @param database - FinePredict's shared typed Postgres client.
   */
  public constructor(private readonly database: FinePredictDatabase) {}

  /**
   * Reconciles a complete catalog while writing only inserted, changed, or
   * removed contracts.
   *
   * @param markets - Complete active catalog refresh.
   * @param refreshedAtIso - Refresh completion timestamp.
   * @returns Exact changed-row counts.
   */
  public async saveCatalog(
    markets: readonly NativeBinaryMarket[],
    refreshedAtIso: string,
  ): Promise<CatalogPersistenceStats> {
    const existingRows = await this.database
      .select({
        venue: arbitrageMarkets.venue,
        marketId: arbitrageMarkets.marketId,
        payload: arbitrageMarkets.payload,
      })
      .from(arbitrageMarkets);
    const existingHashes = new Map(
      existingRows.map((row) => [
        `${row.venue}:${row.marketId}`,
        createStableMarketHash(row.payload as NativeBinaryMarket),
      ]),
    );
    const uniqueMarkets = new Map(
      markets.map((market) => [`${market.venue}:${market.marketId}`, market]),
    );
    const changed = [...uniqueMarkets.entries()]
      .map(([identity, market]) => ({
        identity,
        market,
        contentHash: createStableMarketHash(market),
      }))
      .filter(
        ({ identity, contentHash }) =>
          existingHashes.get(identity) !== contentHash,
      );
    const staleRows = existingRows.filter(
      (row) => !uniqueMarkets.has(`${row.venue}:${row.marketId}`),
    );
    const refreshedAt = new Date(refreshedAtIso);

    await this.database.transaction(async (transaction) => {
      for (const batch of chunk(changed, databaseBatchSize)) {
        await transaction
          .insert(arbitrageMarkets)
          .values(
            batch.map(({ market, contentHash }) => ({
              venue: market.venue,
              marketId: market.marketId,
              eventId: market.eventId,
              category: market.category,
              sourceUpdatedAt: parseOptionalDate(market.sourceUpdatedAtIso),
              refreshedAt,
              contentHash,
              payload: market,
            })),
          )
          .onConflictDoUpdate({
            target: [arbitrageMarkets.venue, arbitrageMarkets.marketId],
            set: {
              eventId: sql`excluded.event_id`,
              category: sql`excluded.category`,
              sourceUpdatedAt: sql`excluded.source_updated_at`,
              refreshedAt: sql`excluded.refreshed_at`,
              contentHash: sql`excluded.content_hash`,
              payload: sql`excluded.payload`,
            },
          });
      }
      for (const batch of chunk(staleRows, databaseBatchSize)) {
        const identities = batch.map((row) =>
          and(
            eq(arbitrageMarkets.venue, row.venue),
            eq(arbitrageMarkets.marketId, row.marketId),
          ),
        );
        const condition = or(...identities);
        if (condition) {
          await transaction.delete(arbitrageMarkets).where(condition);
        }
      }
    });

    return {
      changedMarketCount: changed.length,
      deletedMarketCount: staleRows.length,
      databaseWriteCount: changed.length + staleRows.length,
    };
  }

  /**
   * Loads the complete current native catalog.
   *
   * @returns Parsed catalog rows.
   */
  public async loadCatalog(): Promise<readonly NativeBinaryMarket[]> {
    const rows = await this.database
      .select({ payload: arbitrageMarkets.payload })
      .from(arbitrageMarkets)
      .orderBy(asc(arbitrageMarkets.venue), asc(arbitrageMarkets.marketId));
    return rows.map((row) => row.payload as NativeBinaryMarket);
  }

  /**
   * Loads unexpired Kalshi fee schedules for the requested series.
   *
   * @param seriesTickers - Unique Kalshi series identifiers.
   * @param nowIso - UTC timestamp used for expiry filtering.
   * @returns Valid durable schedules keyed by series ticker.
   */
  public async getValidKalshiFeeSchedules(
    seriesTickers: readonly string[],
    nowIso: string,
  ): Promise<ReadonlyMap<string, DurableKalshiFeeSchedule>> {
    if (seriesTickers.length === 0) {
      return new Map();
    }
    const rows = await this.database
      .select({
        seriesTicker: arbitrageKalshiFeeSchedules.seriesTicker,
        expiresAt: arbitrageKalshiFeeSchedules.expiresAt,
        payload: arbitrageKalshiFeeSchedules.payload,
      })
      .from(arbitrageKalshiFeeSchedules)
      .where(
        and(
          inArray(arbitrageKalshiFeeSchedules.seriesTicker, seriesTickers),
          gt(arbitrageKalshiFeeSchedules.expiresAt, new Date(nowIso)),
        ),
      );
    return new Map(
      rows.map((row) => [
        row.seriesTicker,
        {
          schedule: row.payload as KalshiFeeSchedule,
          expiresAtIso: row.expiresAt.toISOString(),
        },
      ]),
    );
  }

  /**
   * Upserts newly fetched Kalshi fee schedules with one shared expiry.
   *
   * @param schedules - Successfully fetched venue fee schedules.
   * @param fetchedAtIso - UTC retrieval timestamp.
   * @param expiresAtIso - UTC cache-expiry timestamp.
   * @returns Exact number of durable rows written.
   */
  public async saveKalshiFeeSchedules(
    schedules: readonly KalshiFeeSchedule[],
    fetchedAtIso: string,
    expiresAtIso: string,
  ): Promise<number> {
    if (schedules.length === 0) {
      return 0;
    }
    let databaseWriteCount = 0;
    for (const batch of chunk(schedules, databaseBatchSize)) {
      const rows = await this.database
        .insert(arbitrageKalshiFeeSchedules)
        .values(
          batch.map((schedule) => ({
            seriesTicker: schedule.seriesTicker,
            fetchedAt: new Date(fetchedAtIso),
            expiresAt: new Date(expiresAtIso),
            payload: schedule,
          })),
        )
        .onConflictDoUpdate({
          target: arbitrageKalshiFeeSchedules.seriesTicker,
          set: {
            fetchedAt: sql`excluded.fetched_at`,
            expiresAt: sql`excluded.expires_at`,
            payload: sql`excluded.payload`,
          },
        })
        .returning({
          seriesTicker: arbitrageKalshiFeeSchedules.seriesTicker,
        });
      databaseWriteCount += rows.length;
    }
    return databaseWriteCount;
  }

  /**
   * Atomically replaces current opportunity rows, retaining previously
   * published rows whose fresh venue requests failed.
   *
   * @param result - Completed bounded scan.
   * @param failedOpportunityIds - Candidate IDs whose existing rows must remain.
   * @returns Exact durable row-write counts.
   */
  public async saveScan(
    result: OpportunityScanResult,
    failedOpportunityIds: ReadonlySet<string> = new Set(),
  ): Promise<OpportunityPersistenceStats> {
    return this.database.transaction(async (transaction) => {
      let changedOpportunityCount = 0;
      for (const batch of chunk(result.opportunities, databaseBatchSize)) {
        const rows = await transaction
          .insert(arbitrageOpportunities)
          .values(
            batch.map((opportunity) =>
              toOpportunityRow(opportunity, result.scanId),
            ),
          )
          .onConflictDoUpdate({
            target: arbitrageOpportunities.opportunityId,
            set: opportunityConflictUpdate(),
          })
          .returning({
            opportunityId: arbitrageOpportunities.opportunityId,
          });
        changedOpportunityCount += rows.length;
      }
      const deletionConditions: SQL[] = [
        ne(arbitrageOpportunities.scanId, result.scanId),
      ];
      if (failedOpportunityIds.size > 0) {
        deletionConditions.push(
          notInArray(arbitrageOpportunities.opportunityId, [
            ...failedOpportunityIds,
          ]),
        );
      }
      const deleted = await transaction
        .delete(arbitrageOpportunities)
        .where(and(...deletionConditions))
        .returning({ opportunityId: arbitrageOpportunities.opportunityId });
      const databaseWriteCount = changedOpportunityCount + deleted.length + 1;
      await transaction.insert(arbitrageScans).values({
        scanId: result.scanId,
        completedAt: new Date(),
        marketCount: result.marketCount,
        lexicalCandidateCount: result.lexicalCandidateCount,
        freshBookCandidateCount: result.freshBookCandidateCount,
        failedCandidateCount: result.failedCandidateCount,
        externalRequestCount: result.externalRequestCount,
        databaseWriteCount,
        opportunityCount: result.opportunities.length,
      });
      return {
        changedOpportunityCount,
        deletedOpportunityCount: deleted.length,
        databaseWriteCount,
      };
    });
  }

  /**
   * Updates only the bounded opportunities attempted by a price refresh.
   *
   * @param result - Completed bounded price refresh.
   * @param attemptedOpportunityIds - Every pair selected for direct books.
   * @param failedOpportunityIds - Selected pairs whose requests failed.
   * @returns Exact durable current-row write counts.
   */
  public async savePriceRefresh(
    result: OpportunityPriceRefreshResult,
    attemptedOpportunityIds: readonly string[],
    failedOpportunityIds: ReadonlySet<string>,
  ): Promise<OpportunityPersistenceStats> {
    return this.database.transaction(async (transaction) => {
      let changedOpportunityCount = 0;
      for (const batch of chunk(result.opportunities, databaseBatchSize)) {
        const rows = await transaction
          .insert(arbitrageOpportunities)
          .values(
            batch.map((opportunity) =>
              toOpportunityRow(opportunity, result.refreshId),
            ),
          )
          .onConflictDoUpdate({
            target: arbitrageOpportunities.opportunityId,
            set: opportunityConflictUpdate(),
          })
          .returning({
            opportunityId: arbitrageOpportunities.opportunityId,
          });
        changedOpportunityCount += rows.length;
      }
      const updatedIds = new Set(
        result.opportunities.map((opportunity) => opportunity.opportunityId),
      );
      const removableIds = attemptedOpportunityIds.filter(
        (opportunityId) =>
          !failedOpportunityIds.has(opportunityId) &&
          !updatedIds.has(opportunityId),
      );
      let deletedOpportunityCount = 0;
      for (const batch of chunk(removableIds, databaseBatchSize)) {
        const rows = await transaction
          .delete(arbitrageOpportunities)
          .where(inArray(arbitrageOpportunities.opportunityId, batch))
          .returning({
            opportunityId: arbitrageOpportunities.opportunityId,
          });
        deletedOpportunityCount += rows.length;
      }
      return {
        changedOpportunityCount,
        deletedOpportunityCount,
        databaseWriteCount: changedOpportunityCount + deletedOpportunityCount,
      };
    });
  }

  /**
   * Lists current opportunities with SQL-level filtering and pagination.
   *
   * @param filters - API filters.
   * @returns Matching opportunity rows ordered by post-fee edge.
   */
  public async listOpportunities(
    filters: OpportunityListFilters,
  ): Promise<readonly ScannedOpportunity[]> {
    const conditions: SQL[] = [];
    if (filters.strategy) {
      conditions.push(eq(arbitrageOpportunities.strategy, filters.strategy));
    }
    if (filters.category) {
      conditions.push(eq(arbitrageOpportunities.category, filters.category));
    }
    if (filters.status) {
      conditions.push(eq(arbitrageOpportunities.status, filters.status));
    }
    if (filters.relationship) {
      conditions.push(
        eq(arbitrageOpportunities.relationship, filters.relationship),
      );
    }
    if (filters.reviewedOnly) {
      conditions.push(ne(arbitrageOpportunities.relationship, "unreviewed"));
    }
    if (filters.minimumNetEdgeDollarsPerShare !== undefined) {
      conditions.push(
        gte(
          arbitrageOpportunities.netEdgeDollarsPerShare,
          filters.minimumNetEdgeDollarsPerShare,
        ),
      );
    }
    const rows = await this.database
      .select({ payload: arbitrageOpportunities.payload })
      .from(arbitrageOpportunities)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(
        desc(arbitrageOpportunities.netEdgeDollarsPerShare),
        desc(arbitrageOpportunities.observedAt),
      )
      .limit(filters.limit)
      .offset(filters.offset);
    return rows.map((row) => row.payload as ScannedOpportunity);
  }

  /**
   * Loads one opportunity by stable identifier.
   *
   * @param opportunityId - Stable opportunity identifier.
   * @returns Parsed opportunity when present.
   */
  public async getOpportunity(
    opportunityId: string,
  ): Promise<ScannedOpportunity | undefined> {
    const [row] = await this.database
      .select({ payload: arbitrageOpportunities.payload })
      .from(arbitrageOpportunities)
      .where(eq(arbitrageOpportunities.opportunityId, opportunityId))
      .limit(1);
    return row?.payload as ScannedOpportunity | undefined;
  }

  /**
   * Lists categories currently represented by scanned opportunities.
   *
   * @returns Alphabetical category keys.
   */
  public async listOpportunityCategories(): Promise<readonly string[]> {
    const rows = await this.database
      .selectDistinct({ category: arbitrageOpportunities.category })
      .from(arbitrageOpportunities)
      .orderBy(asc(arbitrageOpportunities.category));
    return rows.map((row) => row.category);
  }

  /**
   * Selects a bounded live-price set, prioritizing reviewed relationships.
   *
   * @param limit - Maximum current rows to reprice.
   * @returns Stored opportunities ordered by publication value.
   */
  public async listPriceRefreshCandidates(
    limit: number,
  ): Promise<readonly ScannedOpportunity[]> {
    const rows = await this.database
      .select({ payload: arbitrageOpportunities.payload })
      .from(arbitrageOpportunities)
      .orderBy(
        sql`case ${arbitrageOpportunities.relationship}
          when 'pure_arbitrage' then 4
          when 'near_arbitrage' then 3
          when 'relative_value' then 2
          else 1 end desc`,
        desc(arbitrageOpportunities.netEdgeDollarsPerShare),
        desc(arbitrageOpportunities.observedAt),
      )
      .limit(limit);
    return rows.map((row) => row.payload as ScannedOpportunity);
  }

  /**
   * Inserts or updates one service-run status row.
   *
   * @param run - Current metrics and completion state.
   * @returns Number of durable rows written.
   */
  public async saveServiceRun(run: OpportunityServiceRun): Promise<number> {
    const rows = await this.database
      .insert(arbitrageServiceRuns)
      .values(toServiceRunRow(run))
      .onConflictDoUpdate({
        target: arbitrageServiceRuns.runId,
        set: {
          status: run.status,
          completedAt: parseOptionalDate(run.completedAtIso),
          externalRequestCount: run.externalRequestCount,
          databaseWriteCount: run.databaseWriteCount,
          candidateCount: run.candidateCount,
          opportunityCount: run.opportunityCount,
          errorMessage: run.errorMessage ?? null,
        },
      })
      .returning({ runId: arbitrageServiceRuns.runId });
    return rows.length;
  }

  /**
   * Loads the most recent persisted run for one scheduler job.
   *
   * @param jobType - Discovery or price refresh.
   * @returns Latest run when present.
   */
  public async getLatestServiceRun(
    jobType: OpportunityServiceJobType,
  ): Promise<OpportunityServiceRun | undefined> {
    const [row] = await this.database
      .select()
      .from(arbitrageServiceRuns)
      .where(eq(arbitrageServiceRuns.jobType, jobType))
      .orderBy(desc(arbitrageServiceRuns.startedAt))
      .limit(1);
    return row ? fromServiceRunRow(row) : undefined;
  }

  /**
   * Returns cheap aggregate counts for health and frontend context.
   *
   * @returns Current catalog/opportunity summary.
   */
  public async getSummary(): Promise<OpportunityRepositorySummary> {
    const marketCounts = await this.database
      .select({
        venue: arbitrageMarkets.venue,
        value: count(),
      })
      .from(arbitrageMarkets)
      .groupBy(arbitrageMarkets.venue);
    const [opportunityCount] = await this.database
      .select({ value: count() })
      .from(arbitrageOpportunities);
    const [lastScan] = await this.database
      .select({ completedAt: arbitrageScans.completedAt })
      .from(arbitrageScans)
      .orderBy(desc(arbitrageScans.completedAt))
      .limit(1);
    return {
      kalshiMarketCount:
        marketCounts.find((row) => row.venue === "kalshi")?.value ?? 0,
      polymarketMarketCount:
        marketCounts.find((row) => row.venue === "polymarket")?.value ?? 0,
      opportunityCount: opportunityCount?.value ?? 0,
      ...(lastScan
        ? { lastScanAtIso: lastScan.completedAt.toISOString() }
        : {}),
    };
  }

  /**
   * Executes one scanner operation while holding a cross-process advisory lock.
   *
   * @param operation - Bounded discovery or price-refresh operation.
   * @returns Operation result, or undefined when another process holds the lock.
   */
  public async runWithServiceLock(
    operation: () => Promise<void>,
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const result = await transaction.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(
          hashtext('finepredict-arbitrage-service')
        ) as locked`,
      );
      if (!result[0]?.locked) {
        return false;
      }
      await operation();
      return true;
    });
  }
}

/**
 * Builds a deterministic content digest used to skip unchanged catalog rows.
 *
 * @param payload - Serialized market payload.
 * @returns SHA-256 hexadecimal digest.
 */
function createContentHash(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Hashes only catalog fields that affect identity, matching, fees, or
 * settlement. Fast-moving top quotes and display counters remain in the
 * in-memory discovery snapshot and do not force hourly database rewrites.
 *
 * @param market - Complete current venue market.
 * @returns SHA-256 digest for stable matching content.
 */
function createStableMarketHash(market: NativeBinaryMarket): string {
  return createContentHash(
    JSON.stringify({
      venue: market.venue,
      marketId: market.marketId,
      eventId: market.eventId,
      eventTitle: market.eventTitle,
      seriesId: market.seriesId,
      question: market.question,
      outcomeLabel: market.outcomeLabel,
      description: market.description,
      settlementRulesUrl: market.settlementRulesUrl,
      category: market.category,
      status: market.status,
      endDateIso: market.endDateIso,
      yesTokenId: market.yesTokenId,
      noTokenId: market.noTokenId,
      minimumOrderSizeShares: market.minimumOrderSizeShares,
      polymarketFeeRate: market.polymarketFeeRate,
      polymarketFeeExponent: market.polymarketFeeExponent,
    }),
  );
}

/**
 * Splits a list into bounded database batches.
 *
 * @param values - Source values.
 * @param size - Maximum values per batch.
 * @returns Ordered non-empty chunks.
 */
function chunk<T>(values: readonly T[], size: number): readonly T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

/**
 * Parses an optional ISO timestamp for database persistence.
 *
 * @param value - Optional ISO timestamp.
 * @returns Date or null.
 */
function parseOptionalDate(value: string | undefined): Date | null {
  return value ? new Date(value) : null;
}

/**
 * Converts an opportunity into its indexed Postgres row.
 *
 * @param opportunity - Full scanner record.
 * @param scanId - Discovery or price-refresh identifier.
 * @returns Insertable opportunity fields.
 */
function toOpportunityRow(
  opportunity: ScannedOpportunity,
  scanId: string,
): typeof arbitrageOpportunities.$inferInsert {
  return {
    opportunityId: opportunity.opportunityId,
    strategy: opportunity.strategy,
    status: opportunity.status,
    relationship: opportunity.relationship,
    category: opportunity.category,
    netEdgeDollarsPerShare: opportunity.netEdgeDollarsPerShare,
    observedAt: new Date(opportunity.observedAtIso),
    scanId,
    payload: opportunity,
  };
}

/**
 * Builds the shared upsert assignments for current opportunities.
 *
 * @returns Drizzle conflict-update fields.
 */
function opportunityConflictUpdate() {
  return {
    strategy: sql`excluded.strategy`,
    status: sql`excluded.status`,
    relationship: sql`excluded.relationship`,
    category: sql`excluded.category`,
    netEdgeDollarsPerShare: sql`excluded.net_edge_dollars_per_share`,
    observedAt: sql`excluded.observed_at`,
    scanId: sql`excluded.scan_id`,
    payload: sql`excluded.payload`,
  };
}

/**
 * Converts a service run to an insertable database row.
 *
 * @param run - Domain run record.
 * @returns Insertable service-run fields.
 */
function toServiceRunRow(
  run: OpportunityServiceRun,
): typeof arbitrageServiceRuns.$inferInsert {
  return {
    runId: run.runId,
    jobType: run.jobType,
    status: run.status,
    startedAt: new Date(run.startedAtIso),
    completedAt: parseOptionalDate(run.completedAtIso),
    externalRequestCount: run.externalRequestCount,
    databaseWriteCount: run.databaseWriteCount,
    candidateCount: run.candidateCount,
    opportunityCount: run.opportunityCount,
    errorMessage: run.errorMessage ?? null,
  };
}

/**
 * Converts a database service run into the public domain shape.
 *
 * @param row - Stored service-run row.
 * @returns Public run metrics.
 */
function fromServiceRunRow(
  row: typeof arbitrageServiceRuns.$inferSelect,
): OpportunityServiceRun {
  return {
    runId: row.runId,
    jobType: row.jobType as OpportunityServiceJobType,
    status: row.status as OpportunityServiceRun["status"],
    startedAtIso: row.startedAt.toISOString(),
    ...(row.completedAt
      ? { completedAtIso: row.completedAt.toISOString() }
      : {}),
    externalRequestCount: row.externalRequestCount,
    databaseWriteCount: row.databaseWriteCount,
    candidateCount: row.candidateCount,
    opportunityCount: row.opportunityCount,
    ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
  };
}
