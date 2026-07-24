import { log } from "../common/log.js";
import type {
  KalshiFeeSchedule,
  MarketPair,
  PairOverride,
  PolymarketMarketDetails,
  SearchMarket,
} from "../common/types.js";
import { KalshiClient } from "../discovery/kalshi-client.js";
import { findPairOverride } from "../discovery/matching.js";
import { evaluateAlignedSnapshots } from "../discovery/orderbook-analysis.js";
import { DirectMarketDataClient } from "../market-data/direct-market-data-client.js";
import type { DirectPairContext } from "../market-data/types.js";
import { matchEquivalentContracts } from "./equivalent-contract-matcher.js";
import { NativeCatalogClient } from "./native-catalog-client.js";
import { OpportunityRepository } from "./opportunity-repository.js";
import type {
  EquivalentContractCandidate,
  NativeBinaryMarket,
  OpportunityScanOptions,
  OpportunityScanResult,
  OpportunityPriceRefreshResult,
  ScannedOpportunity,
} from "./types.js";

const feeScheduleCacheTtlMs = 24 * 60 * 60 * 1_000;

/** Prepared candidate fields shared by batched market-data evaluation. */
interface PreparedCandidate {
  /** Original deterministic candidate. */
  readonly candidate: EquivalentContractCandidate;
  /** Shared reviewed pair representation. */
  readonly pair: MarketPair;
  /** Public direct-book request context. */
  readonly context: DirectPairContext;
  /** Kalshi fee-series identifier. */
  readonly seriesId: string;
}

/** Outcome of one bounded batched candidate evaluation. */
interface CandidateEvaluationBatch {
  /** Positive post-fee opportunities. */
  readonly opportunities: readonly ScannedOpportunity[];
  /** Candidate IDs whose venue or metadata request failed. */
  readonly failedCandidateIds: ReadonlySet<string>;
  /** Public HTTP requests consumed by books and fee schedules. */
  readonly externalRequestCount: number;
}

/** Dependencies accepted by the native opportunity scanner. */
export interface OpportunityScannerDependencies {
  /** Public native catalog client. */
  readonly catalogClient: NativeCatalogClient;
  /** Current catalog/opportunity repository. */
  readonly repository: OpportunityRepository;
  /** Direct public venue order-book client. */
  readonly directMarketDataClient: DirectMarketDataClient;
  /** Public Kalshi metadata and fee client. */
  readonly kalshiClient: KalshiClient;
  /** Current manual settlement review registry. */
  readonly pairOverrides: readonly PairOverride[];
}

/** Conservative economics for one reviewed settlement-divergence scenario. */
export interface BasisRiskEconomics {
  /** Profit when the shared core proposition settles identically. */
  readonly conditionalNetProfitDollars: number;
  /** Loss when adverse divergence makes both purchased outcomes lose. */
  readonly worstCaseSettlementDivergenceLossDollars: number;
  /** Divergence probability that reduces expected profit to zero. */
  readonly breakEvenAdverseDivergenceProbabilityPercent100?: number;
}

/** Service coordinating cheap catalog discovery and bounded direct-book checks. */
export class OpportunityScanner {
  private readonly catalogClient: NativeCatalogClient;
  private readonly repository: OpportunityRepository;
  private readonly directMarketDataClient: DirectMarketDataClient;
  private readonly kalshiClient: KalshiClient;
  private readonly pairOverrides: readonly PairOverride[];
  private readonly feeScheduleCache = new Map<
    string,
    {
      readonly schedule: KalshiFeeSchedule;
      readonly expiresAtMs: number;
    }
  >();

  /**
   * Creates a native opportunity scanner.
   *
   * @param dependencies - Public clients, repository, and review registry.
   */
  public constructor(dependencies: OpportunityScannerDependencies) {
    this.catalogClient = dependencies.catalogClient;
    this.repository = dependencies.repository;
    this.directMarketDataClient = dependencies.directMarketDataClient;
    this.kalshiClient = dependencies.kalshiClient;
    this.pairOverrides = dependencies.pairOverrides;
  }

  /**
   * Refreshes and atomically persists both native catalogs.
   *
   * @returns Public request and retained-market counts.
   */
  public async refreshCatalog(): Promise<{
    readonly requestCount: number;
    readonly kalshiMarketCount: number;
    readonly polymarketMarketCount: number;
    readonly changedMarketCount: number;
    readonly deletedMarketCount: number;
    readonly databaseWriteCount: number;
  }> {
    const result = await this.catalogClient.refresh();
    const refreshedAtIso = new Date().toISOString();
    const persistence = await this.repository.saveCatalog(
      result.markets,
      refreshedAtIso,
    );
    log(
      "info",
      "OpportunityScanner.refreshCatalog",
      `Stored ${result.kalshiMarketCount} Kalshi and ${result.polymarketMarketCount} Polymarket binary markets using ${result.requestCount} public requests`,
    );
    return {
      requestCount: result.requestCount,
      kalshiMarketCount: result.kalshiMarketCount,
      polymarketMarketCount: result.polymarketMarketCount,
      ...persistence,
    };
  }

  /**
   * Runs deterministic matching against the stored catalog, then requests fresh
   * books only for the bounded shortlist.
   *
   * @param options - Matching, network, edge, and evaluation-budget controls.
   * @returns Complete scan counters and post-fee opportunities.
   */
  public async scan(
    options: OpportunityScanOptions,
  ): Promise<OpportunityScanResult> {
    const scanId = new Date()
      .toISOString()
      .replaceAll(":", "-")
      .replace(".", "-");
    const markets = await this.repository.loadCatalog();
    const matching = matchEquivalentContracts(markets, {
      minimumSimilarityPercent100: options.minimumSimilarityPercent100,
      minimumPreliminaryGrossEdgeDollarsPerShare:
        options.minimumPreliminaryGrossEdgeDollarsPerShare,
      maximumFreshBookPairs: options.maximumFreshBookPairs,
      maximumPairsPerEventPair: options.maximumPairsPerEventPair,
      pairOverrides: this.pairOverrides,
    });
    const evaluation = await this.evaluateCandidates(
      matching.candidates,
      options,
    );
    const opportunities = [...evaluation.opportunities].sort(
      (left, right) =>
        right.netEdgeDollarsPerShare - left.netEdgeDollarsPerShare,
    );
    const resultBeforePersistence: OpportunityScanResult = {
      scanId,
      marketCount: markets.length,
      lexicalCandidateCount: matching.lexicalCandidateCount,
      freshBookCandidateCount: matching.candidates.length,
      failedCandidateCount: evaluation.failedCandidateIds.size,
      externalRequestCount: evaluation.externalRequestCount,
      databaseWriteCount: 0,
      opportunities,
    };
    const persistence = await this.repository.saveScan(resultBeforePersistence);
    return {
      ...resultBeforePersistence,
      databaseWriteCount: persistence.databaseWriteCount,
    };
  }

  /**
   * Reprices a bounded priority set without refreshing or rewriting the native
   * catalog. Failed pairs retain their prior observation.
   *
   * @param options - Fee, depth, concurrency, and publication controls.
   * @param maximumOpportunityCount - Maximum stored pairs to refresh.
   * @returns Price-only refresh metrics and fresh positive rows.
   */
  public async refreshPrices(
    options: OpportunityScanOptions,
    maximumOpportunityCount: number,
  ): Promise<OpportunityPriceRefreshResult> {
    const refreshId = new Date()
      .toISOString()
      .replaceAll(":", "-")
      .replace(".", "-");
    const current = await this.repository.listPriceRefreshCandidates(
      maximumOpportunityCount,
    );
    const candidates = current.map(toEquivalentCandidate);
    const evaluation = await this.evaluateCandidates(candidates, options);
    const attemptedOpportunityIds = candidates.map(
      (candidate) => candidate.pairId,
    );
    const removedOpportunityCount = attemptedOpportunityIds.filter(
      (opportunityId) =>
        !evaluation.failedCandidateIds.has(opportunityId) &&
        !evaluation.opportunities.some(
          (opportunity) => opportunity.opportunityId === opportunityId,
        ),
    ).length;
    const resultBeforePersistence: OpportunityPriceRefreshResult = {
      refreshId,
      attemptedOpportunityCount: candidates.length,
      updatedOpportunityCount: evaluation.opportunities.length,
      removedOpportunityCount,
      failedOpportunityCount: evaluation.failedCandidateIds.size,
      externalRequestCount: evaluation.externalRequestCount,
      databaseWriteCount: 0,
      opportunities: evaluation.opportunities,
    };
    const persistence = await this.repository.savePriceRefresh(
      resultBeforePersistence,
      attemptedOpportunityIds,
      evaluation.failedCandidateIds,
    );
    return {
      ...resultBeforePersistence,
      databaseWriteCount: persistence.databaseWriteCount,
    };
  }

  /**
   * Evaluates candidates with one Polymarket batch request, bounded Kalshi
   * concurrency, and a 24-hour fee-schedule cache.
   *
   * @param candidates - Deterministic or previously persisted candidates.
   * @param options - Fee, depth, concurrency, and threshold controls.
   * @returns Positive opportunities, safe failures, and request usage.
   */
  private async evaluateCandidates(
    candidates: readonly EquivalentContractCandidate[],
    options: OpportunityScanOptions,
  ): Promise<CandidateEvaluationBatch> {
    if (candidates.length === 0) {
      return {
        opportunities: [],
        failedCandidateIds: new Set(),
        externalRequestCount: 0,
      };
    }
    const directRequestsBefore = this.directMarketDataClient.requestCount;
    const kalshiRequestsBefore = this.kalshiClient.requestCount;
    const failedCandidateIds = new Set<string>();
    const prepared: PreparedCandidate[] = [];
    for (const candidate of candidates) {
      try {
        const pair = buildMarketPair(candidate, this.pairOverrides);
        const seriesId = candidate.kalshi.seriesId;
        if (!seriesId) {
          throw new Error(
            `Kalshi series is missing for ${candidate.kalshi.marketId}`,
          );
        }
        prepared.push({
          candidate,
          pair,
          context: {
            pair,
            polymarketDetails: buildPolymarketDetails(candidate.polymarket),
          },
          seriesId,
        });
      } catch (error: unknown) {
        failedCandidateIds.add(candidate.pairId);
        logCandidateFailure(candidate.pairId, error);
      }
    }
    const feePromisesBySeries = new Map<string, Promise<KalshiFeeSchedule>>();
    for (const item of prepared) {
      if (!feePromisesBySeries.has(item.seriesId)) {
        feePromisesBySeries.set(
          item.seriesId,
          this.getCachedFeeSchedule(item.seriesId),
        );
      }
    }
    const [directBatch, feeResults] = await Promise.all([
      this.directMarketDataClient.getPairSnapshots(
        prepared.map((item) => item.context),
        options.directBookConcurrency,
      ),
      Promise.all(
        [...feePromisesBySeries].map(async ([seriesId, promise]) => {
          try {
            return {
              seriesId,
              schedule: await promise,
            };
          } catch (error: unknown) {
            return {
              seriesId,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }),
      ),
    ]);
    const feeScheduleBySeries = new Map<string, KalshiFeeSchedule>();
    const feeErrorBySeries = new Map<string, string>();
    for (const result of feeResults) {
      if (result.schedule) {
        feeScheduleBySeries.set(result.seriesId, result.schedule);
      } else {
        feeErrorBySeries.set(
          result.seriesId,
          result.error ?? "Unknown Kalshi fee-schedule failure",
        );
      }
    }
    const opportunities: ScannedOpportunity[] = [];
    for (const item of prepared) {
      const directError = directBatch.errorsByPairId.get(item.candidate.pairId);
      const feeError = feeErrorBySeries.get(item.seriesId);
      const snapshot = directBatch.snapshotsByPairId.get(item.candidate.pairId);
      const feeSchedule = feeScheduleBySeries.get(item.seriesId);
      if (directError || feeError || !snapshot || !feeSchedule) {
        failedCandidateIds.add(item.candidate.pairId);
        logCandidateFailure(
          item.candidate.pairId,
          directError ??
            feeError ??
            "Required direct-book metadata was missing",
        );
        continue;
      }
      const opportunity = this.evaluateCandidateSnapshot(
        item,
        snapshot,
        feeSchedule,
        options,
      );
      if (opportunity) {
        opportunities.push(opportunity);
      }
    }
    return {
      opportunities: opportunities.sort(
        (left, right) =>
          right.netEdgeDollarsPerShare - left.netEdgeDollarsPerShare,
      ),
      failedCandidateIds,
      externalRequestCount:
        this.directMarketDataClient.requestCount -
        directRequestsBefore +
        this.kalshiClient.requestCount -
        kalshiRequestsBefore,
    };
  }

  /**
   * Evaluates one already-collected direct snapshot with current fee metadata.
   *
   * @param prepared - Candidate, pair, and direct metadata.
   * @param snapshot - Batched direct venue order books.
   * @param kalshiFeeSchedule - Current or safely cached Kalshi series fees.
   * @param options - Budget and publication threshold.
   * @returns Positive post-fee opportunity when available.
   */
  private evaluateCandidateSnapshot(
    prepared: PreparedCandidate,
    snapshot: Awaited<ReturnType<DirectMarketDataClient["getPairSnapshot"]>>,
    kalshiFeeSchedule: KalshiFeeSchedule,
    options: OpportunityScanOptions,
  ): ScannedOpportunity | undefined {
    const { candidate, pair, context } = prepared;
    const polymarketDetails = context.polymarketDetails;
    const evaluated = [
      ...evaluateAlignedSnapshots({
        pair,
        kalshiSnapshot: snapshot.kalshi,
        polymarketSnapshot: snapshot.polymarket,
        budgetDollars: options.evaluationBudgetDollars,
        kalshiFeeModel: {
          venue: "kalshi",
          kalshiSchedule: kalshiFeeSchedule,
        },
        polymarketFeeModel: {
          venue: "polymarket",
          polymarketTakerFeeRate: polymarketDetails.takerFeeRate ?? 0,
          polymarketFeeExponent: polymarketDetails.takerFeeExponent ?? 1,
        },
        minimumPolymarketOrderSizeShares:
          polymarketDetails.minimumOrderSizeShares,
      }),
    ].sort((left, right) => right.netProfitDollars - left.netProfitDollars)[0];
    if (!evaluated) {
      return undefined;
    }
    const netEdgeDollarsPerShare =
      evaluated.netProfitDollars / evaluated.shares;
    const thresholdMet =
      netEdgeDollarsPerShare >= options.minimumNetEdgeDollarsPerShare;
    const status = thresholdMet
      ? candidate.relationship === "pure_arbitrage"
        ? "actionable"
        : candidate.relationship === "near_arbitrage"
          ? "basis_opportunity"
          : candidate.relationship === "relative_value"
            ? "relative_value"
            : "review_required"
      : "below_threshold";
    const basisRiskEconomics = calculateBasisRiskEconomics(
      evaluated.netProfitDollars,
      evaluated.grossCostDollars,
      evaluated.feesDollars,
      candidate.relationship !== "pure_arbitrage",
    );
    return {
      opportunityId: candidate.pairId,
      strategy: "cross_venue_equivalent",
      status,
      category: candidate.kalshi.category,
      matchConfidence: pair.confidence,
      relationship: candidate.relationship,
      settlementRisks: candidate.settlementRisks,
      kalshi: {
        ...candidate.kalshi,
        ...(kalshiFeeSchedule.contractTermsUrl
          ? { settlementRulesUrl: kalshiFeeSchedule.contractTermsUrl }
          : {}),
      },
      polymarket: candidate.polymarket,
      direction: evaluated.direction,
      executableShares: evaluated.shares,
      buyYesAveragePriceDollars: evaluated.buyYesAveragePriceDollars,
      buyNoAveragePriceDollars: evaluated.buyNoAveragePriceDollars,
      grossCostDollars: evaluated.grossCostDollars,
      feesDollars: evaluated.feesDollars,
      grossProfitDollars: evaluated.grossProfitDollars,
      netProfitDollars: evaluated.netProfitDollars,
      ...basisRiskEconomics,
      netEdgeDollarsPerShare,
      roiPercent100: evaluated.roiPercent100,
      observedAtIso: evaluated.observedAtIso,
      similarityPercent100: candidate.similarityPercent100,
      matchReasons: pair.matchReasons,
    };
  }

  /**
   * Loads one Kalshi series schedule with a bounded in-memory TTL.
   *
   * @param seriesId - Kalshi series ticker.
   * @returns Current fee schedule.
   */
  private async getCachedFeeSchedule(
    seriesId: string,
  ): Promise<KalshiFeeSchedule> {
    const cached = this.feeScheduleCache.get(seriesId);
    if (cached && cached.expiresAtMs > Date.now()) {
      return cached.schedule;
    }
    const schedule = await this.kalshiClient.getFeeSchedule(seriesId);
    this.feeScheduleCache.set(seriesId, {
      schedule,
      expiresAtMs: Date.now() + feeScheduleCacheTtlMs,
    });
    return schedule;
  }
}

/**
 * Calculates expected-value break-even math for the conservative scenario in
 * which a settlement-rule divergence makes both purchased outcomes lose.
 *
 * @param netProfitDollars - Post-fee profit under identical settlement.
 * @param grossCostDollars - Cash paid for both contract legs before fees.
 * @param feesDollars - Venue fees for both legs.
 * @param hasSettlementDivergenceRisk - Whether the relationship is not pure.
 * @returns Conditional profit, conservative loss, and break-even probability.
 */
export function calculateBasisRiskEconomics(
  netProfitDollars: number,
  grossCostDollars: number,
  feesDollars: number,
  hasSettlementDivergenceRisk: boolean,
): BasisRiskEconomics {
  if (!hasSettlementDivergenceRisk) {
    return {
      conditionalNetProfitDollars: netProfitDollars,
      worstCaseSettlementDivergenceLossDollars: 0,
    };
  }
  const worstCaseSettlementDivergenceLossDollars =
    grossCostDollars + feesDollars;
  const breakEvenDenominator =
    netProfitDollars + worstCaseSettlementDivergenceLossDollars;
  return {
    conditionalNetProfitDollars: netProfitDollars,
    worstCaseSettlementDivergenceLossDollars,
    breakEvenAdverseDivergenceProbabilityPercent100:
      breakEvenDenominator > 0
        ? (netProfitDollars / breakEvenDenominator) * 100
        : 0,
  };
}

/**
 * Converts a native candidate into the existing venue-neutral pair type.
 *
 * @param candidate - Native equivalent-contract candidate.
 * @param overrides - Current exact/family review registry.
 * @returns Pair with manual verification applied.
 */
function buildMarketPair(
  candidate: EquivalentContractCandidate,
  overrides: readonly PairOverride[],
): MarketPair {
  const kalshi = toSearchMarket(candidate.kalshi);
  const polymarket = toSearchMarket(candidate.polymarket);
  const override = findPairOverride(overrides, kalshi, polymarket);
  if (
    override &&
    !override.verified &&
    (override.classification === undefined ||
      override.classification === "mismatch")
  ) {
    throw new Error(`Pair is manually rejected: ${override.note}`);
  }
  const confidence =
    candidate.relationship === "pure_arbitrage"
      ? "verified"
      : candidate.relationship === "near_arbitrage"
        ? "probable"
        : candidate.relationship === "relative_value"
          ? "possible"
          : candidate.similarityPercent100 >= 90
            ? "probable"
            : "possible";
  return {
    pairId: candidate.pairId,
    kalshi,
    polymarket,
    similarityPercent100:
      candidate.relationship === "pure_arbitrage"
        ? 100
        : candidate.similarityPercent100,
    confidence,
    matchReasons: override
      ? [
          ...candidate.matchReasons,
          `Manual ${candidate.relationship} review: ${override.note}`,
        ]
      : candidate.matchReasons,
    discoverySource: override ? "manual_override" : "text_similarity",
  };
}

/**
 * Converts native catalog metadata to the shared search-market shape.
 *
 * @param market - Native market.
 * @returns Search-market representation.
 */
function toSearchMarket(market: NativeBinaryMarket): SearchMarket {
  return {
    marketId: market.marketId,
    exchange: market.venue,
    ...(market.seriesId ? { seriesId: market.seriesId } : {}),
    question: market.question,
    category: market.category,
    status: market.status,
    volume: market.volume,
    liquidity: market.liquidity,
    eventId: market.eventId,
    eventTitle: market.eventTitle ?? market.question,
  };
}

/**
 * Builds direct-book Polymarket metadata from the Gamma catalog row.
 *
 * @param market - Polymarket native market.
 * @returns Direct-book and fee metadata.
 */
function buildPolymarketDetails(
  market: NativeBinaryMarket,
): PolymarketMarketDetails {
  if (
    market.venue !== "polymarket" ||
    !market.yesTokenId ||
    !market.noTokenId ||
    market.polymarketFeeRate === undefined ||
    market.polymarketFeeExponent === undefined
  ) {
    throw new Error(`Incomplete Polymarket metadata for ${market.marketId}`);
  }
  return {
    conditionId: market.marketId,
    yesTokenId: market.yesTokenId,
    noTokenId: market.noTokenId,
    description: market.description,
    ...(market.endDateIso ? { endDateIso: market.endDateIso } : {}),
    tags: [market.category],
    minimumOrderSizeShares: market.minimumOrderSizeShares,
    takerFeeRate: market.polymarketFeeRate,
    takerFeeExponent: market.polymarketFeeExponent,
  };
}

/**
 * Converts a stored opportunity back into a deterministic candidate for
 * price-only refreshes without repeating catalog matching.
 *
 * @param opportunity - Current persisted opportunity.
 * @returns Candidate retaining its reviewed relationship and match evidence.
 */
function toEquivalentCandidate(
  opportunity: ScannedOpportunity,
): EquivalentContractCandidate {
  return {
    pairId: opportunity.opportunityId,
    kalshi: opportunity.kalshi,
    polymarket: opportunity.polymarket,
    similarityPercent100: opportunity.similarityPercent100,
    preliminaryGrossEdgeDollarsPerShare:
      opportunity.grossProfitDollars / opportunity.executableShares,
    preliminaryDirection: opportunity.direction,
    matchReasons: opportunity.matchReasons,
    relationship: opportunity.relationship,
    settlementRisks: opportunity.settlementRisks,
  };
}

/**
 * Logs one safe candidate failure with consistent service context.
 *
 * @param pairId - Stable pair identifier.
 * @param error - Error or safe message.
 * @returns Nothing.
 */
function logCandidateFailure(pairId: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  log(
    "warn",
    "OpportunityScanner.evaluateCandidates",
    `Retained or skipped ${pairId} after request failure: ${message}`,
  );
}
