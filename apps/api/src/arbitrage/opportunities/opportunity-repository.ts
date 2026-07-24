import { createHash, randomUUID } from "node:crypto";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  gt,
  inArray,
  lt,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import type { FinePredictDatabase } from "../../database/client.js";
import {
  arbitrageCatalogCounts,
  arbitrageKalshiFeeSchedules,
  arbitrageMarkets,
  arbitrageOpportunities,
  arbitrageOpportunityHistory,
  arbitrageScans,
  arbitrageServiceLocks,
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
  OpportunityHistoryResponse,
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
const serviceLeaseDurationMilliseconds = 15 * 60 * 1_000;
const arbitrageServiceLockName = "finepredict-arbitrage-service";
const historyMaximumResponsePoints = 10_000;

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
   * @returns Exact changed-row counts.
   */
  public async saveCatalog(
    markets: readonly NativeBinaryMarket[],
  ): Promise<CatalogPersistenceStats> {
    const existingRows = await this.database
      .select({
        venue: arbitrageMarkets.venue,
        marketId: arbitrageMarkets.marketId,
        contentHash: arbitrageMarkets.contentHash,
      })
      .from(arbitrageMarkets);
    const existingHashes = new Map(
      existingRows.map((row) => [
        `${row.venue}:${row.marketId}`,
        row.contentHash,
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
    const marketCounts = new Map<NativeBinaryMarket["venue"], number>([
      ["kalshi", 0],
      ["polymarket", 0],
    ]);
    for (const market of uniqueMarkets.values()) {
      marketCounts.set(market.venue, (marketCounts.get(market.venue) ?? 0) + 1);
    }
    let changedCountRowCount = 0;

    await this.database.transaction(async (transaction) => {
      for (const batch of chunk(changed, databaseBatchSize)) {
        await transaction
          .insert(arbitrageMarkets)
          .values(
            batch.map(({ market, contentHash }) => ({
              venue: market.venue,
              marketId: market.marketId,
              contentHash,
            })),
          )
          .onConflictDoUpdate({
            target: [arbitrageMarkets.venue, arbitrageMarkets.marketId],
            set: {
              contentHash: sql`excluded.content_hash`,
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
      const countRows = await transaction
        .insert(arbitrageCatalogCounts)
        .values(
          [...marketCounts].map(([venue, marketCount]) => ({
            venue,
            marketCount,
            updatedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: arbitrageCatalogCounts.venue,
          set: {
            marketCount: sql`excluded.market_count`,
            updatedAt: sql`excluded.updated_at`,
          },
          setWhere: ne(
            arbitrageCatalogCounts.marketCount,
            sql`excluded.market_count`,
          ),
        })
        .returning({ venue: arbitrageCatalogCounts.venue });
      changedCountRowCount = countRows.length;
    });

    return {
      changedMarketCount: changed.length,
      deletedMarketCount: staleRows.length,
      databaseWriteCount:
        changed.length + staleRows.length + changedCountRowCount,
    };
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
      const historyWriteCount = await saveHourlyHistory(
        transaction,
        result.opportunities,
      );
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
      const databaseWriteCount =
        changedOpportunityCount + deleted.length + historyWriteCount + 1;
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
      const historyWriteCount = await saveHourlyHistory(
        transaction,
        result.opportunities,
      );
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
        databaseWriteCount:
          changedOpportunityCount + deletedOpportunityCount + historyWriteCount,
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
   * Loads hourly executable prices and timeline markers for one current pair.
   *
   * @param opportunityId - Stable opportunity identifier.
   * @returns History response, or undefined when the pair is not current.
   */
  public async getOpportunityHistory(
    opportunityId: string,
  ): Promise<OpportunityHistoryResponse | undefined> {
    const [opportunityRow] = await this.database
      .select({ payload: arbitrageOpportunities.payload })
      .from(arbitrageOpportunities)
      .where(eq(arbitrageOpportunities.opportunityId, opportunityId))
      .limit(1);
    const opportunity = opportunityRow?.payload as
      ScannedOpportunity | undefined;
    if (!opportunity) {
      return undefined;
    }
    const rows = await this.database
      .select()
      .from(arbitrageOpportunityHistory)
      .where(eq(arbitrageOpportunityHistory.opportunityId, opportunityId))
      .orderBy(asc(arbitrageOpportunityHistory.observedAt))
      .limit(historyMaximumResponsePoints);
    const opportunityMarkets =
      opportunity.strategy === "cross_venue_equivalent"
        ? [opportunity.kalshi, opportunity.polymarket]
        : opportunity.legs.map((leg) => leg.market);
    const originDates = opportunityMarkets
      .map((market) => market.startDateIso)
      .filter((value): value is string => Boolean(value))
      .map((value) => new Date(value))
      .filter((value) => !Number.isNaN(value.getTime()))
      .sort((left, right) => left.getTime() - right.getTime());
    const points = rows.map((row) => ({
      opportunityId: row.opportunityId,
      observedAtIso: row.observedAt.toISOString(),
      ...(row.buyYesVenue
        ? {
            buyYesVenue: row.buyYesVenue as "kalshi" | "polymarket",
          }
        : {}),
      ...(row.buyNoVenue
        ? { buyNoVenue: row.buyNoVenue as "kalshi" | "polymarket" }
        : {}),
      ...(row.buyYesAveragePriceDollars !== null
        ? {
            buyYesAveragePriceDollars: row.buyYesAveragePriceDollars,
          }
        : {}),
      ...(row.buyNoAveragePriceDollars !== null
        ? { buyNoAveragePriceDollars: row.buyNoAveragePriceDollars }
        : {}),
      ...(Array.isArray(row.legs)
        ? {
            legs: row.legs as NonNullable<
              OpportunityHistoryResponse["points"][number]["legs"]
            >,
          }
        : {}),
      grossEdgeDollarsPerShare: row.grossEdgeDollarsPerShare,
      netEdgeDollarsPerShare: row.netEdgeDollarsPerShare,
      roiPercent100: row.roiPercent100,
    }));
    const latestPoint = points.at(-1);
    return {
      opportunityId,
      ...(originDates[0]
        ? { contractOriginAtIso: originDates[0].toISOString() }
        : {}),
      ...(points[0] ? { detectedAtIso: points[0].observedAtIso } : {}),
      ...(latestPoint
        ? { latestObservedAtIso: latestPoint.observedAtIso }
        : {}),
      points,
    };
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
        venue: arbitrageCatalogCounts.venue,
        value: arbitrageCatalogCounts.marketCount,
      })
      .from(arbitrageCatalogCounts);
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
   * Executes one scanner operation while holding a short-lived database lease.
   *
   * @param operation - Bounded discovery or price-refresh operation.
   * @returns Whether the operation acquired the shared service lease and ran.
   */
  public async runWithServiceLock(
    operation: () => Promise<void>,
  ): Promise<boolean> {
    const leaseId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + serviceLeaseDurationMilliseconds,
    );
    const [lease] = await this.database
      .insert(arbitrageServiceLocks)
      .values({
        lockName: arbitrageServiceLockName,
        leaseId,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: arbitrageServiceLocks.lockName,
        set: { leaseId, expiresAt },
        setWhere: lt(arbitrageServiceLocks.expiresAt, now),
      })
      .returning({ leaseId: arbitrageServiceLocks.leaseId });
    if (lease?.leaseId !== leaseId) {
      return false;
    }

    try {
      await operation();
      return true;
    } finally {
      await this.database
        .delete(arbitrageServiceLocks)
        .where(
          and(
            eq(arbitrageServiceLocks.lockName, arbitrageServiceLockName),
            eq(arbitrageServiceLocks.leaseId, leaseId),
          ),
        );
    }
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
      startDateIso: market.startDateIso,
      yesTokenId: market.yesTokenId,
      noTokenId: market.noTokenId,
      marketSlug: market.marketSlug,
      minimumOrderSizeShares: market.minimumOrderSizeShares,
      polymarketFeeRate: market.polymarketFeeRate,
      polymarketFeeExponent: market.polymarketFeeExponent,
      eventMutuallyExclusive: market.eventMutuallyExclusive,
      collateralReturnType: market.collateralReturnType,
      negativeRisk: market.negativeRisk,
      negativeRiskOther: market.negativeRiskOther,
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
 * Inserts only the first observation for each pair and UTC hour.
 *
 * @param database - Current database or transaction handle.
 * @param opportunities - Fresh executable observations.
 * @returns Number of newly inserted history rows.
 */
async function saveHourlyHistory(
  database: Pick<FinePredictDatabase, "insert">,
  opportunities: readonly ScannedOpportunity[],
): Promise<number> {
  if (opportunities.length === 0) {
    return 0;
  }
  const rows = opportunities.map((opportunity) => {
    const observedAt = new Date(opportunity.observedAtIso);
    const bucketAt = new Date(observedAt);
    bucketAt.setUTCMinutes(0, 0, 0);
    const legacy =
      opportunity.strategy === "cross_venue_equivalent"
        ? {
            buyYesVenue: opportunity.direction.buyYesVenue,
            buyNoVenue: opportunity.direction.buyNoVenue,
            buyYesAveragePriceDollars: opportunity.buyYesAveragePriceDollars,
            buyNoAveragePriceDollars: opportunity.buyNoAveragePriceDollars,
          }
        : {
            buyYesVenue: null,
            buyNoVenue: null,
            buyYesAveragePriceDollars: null,
            buyNoAveragePriceDollars: null,
          };
    const legs =
      opportunity.strategy === "cross_venue_equivalent"
        ? null
        : opportunity.legs.map((leg) => ({
            venue: leg.market.venue,
            marketId: leg.market.marketId,
            side: leg.side,
            averagePriceDollars: leg.averagePriceDollars,
          }));
    return {
      opportunityId: opportunity.opportunityId,
      bucketAt,
      observedAt,
      ...legacy,
      legs,
      grossEdgeDollarsPerShare:
        opportunity.grossProfitDollars / opportunity.executableShares,
      netEdgeDollarsPerShare: opportunity.netEdgeDollarsPerShare,
      roiPercent100: opportunity.roiPercent100,
    } satisfies typeof arbitrageOpportunityHistory.$inferInsert;
  });
  let insertedCount = 0;
  for (const batch of chunk(rows, databaseBatchSize)) {
    const inserted = await database
      .insert(arbitrageOpportunityHistory)
      .values(batch)
      .onConflictDoNothing({
        target: [
          arbitrageOpportunityHistory.opportunityId,
          arbitrageOpportunityHistory.bucketAt,
        ],
      })
      .returning({ opportunityId: arbitrageOpportunityHistory.opportunityId });
    insertedCount += inserted.length;
  }
  return insertedCount;
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
