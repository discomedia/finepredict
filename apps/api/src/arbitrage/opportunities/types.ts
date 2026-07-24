import type {
  ArbitrageDirection,
  MatchConfidence,
  Venue,
} from "../common/types.js";

/** Implemented opportunity strategy identifiers exposed by the API. */
export type OpportunityStrategy = "cross_venue_equivalent";

/** Lifecycle state assigned to a scanned opportunity. */
export type OpportunityStatus =
  | "actionable"
  | "basis_opportunity"
  | "relative_value"
  | "review_required"
  | "below_threshold";

/** Settlement relationship represented by one candidate or opportunity. */
export type OpportunityRelationship =
  "pure_arbitrage" | "near_arbitrage" | "relative_value" | "unreviewed";

/** Venue-native binary contract metadata retained in the local catalog. */
export interface NativeBinaryMarket {
  /** Venue on which the contract trades. */
  readonly venue: Venue;
  /** Venue-native market or condition identifier. */
  readonly marketId: string;
  /** Venue-native parent event identifier. */
  readonly eventId: string;
  /** Human-readable parent event title used to disambiguate generic children. */
  readonly eventTitle?: string;
  /** Venue-native series identifier when the venue supplies one. */
  readonly seriesId?: string;
  /** Human-readable contract proposition. */
  readonly question: string;
  /** Candidate-specific outcome label when the parent question is generic. */
  readonly outcomeLabel?: string;
  /** Full archived settlement text. */
  readonly description: string;
  /** Authoritative venue contract-terms document when supplied. */
  readonly settlementRulesUrl?: string;
  /** Stable normalized category used by API filters. */
  readonly category: string;
  /** Venue lifecycle status. */
  readonly status: string;
  /** Venue closing or resolution timestamp when supplied. */
  readonly endDateIso?: string;
  /** YES token identifier for Polymarket. */
  readonly yesTokenId?: string;
  /** NO token identifier for Polymarket. */
  readonly noTokenId?: string;
  /** Public child-market slug for an exact Polymarket comparison URL. */
  readonly marketSlug?: string;
  /** Venue minimum order size in shares. */
  readonly minimumOrderSizeShares: number;
  /** Polymarket fee rate from the market's fee schedule. */
  readonly polymarketFeeRate?: number;
  /** Polymarket fee-curve exponent from the market's fee schedule. */
  readonly polymarketFeeExponent?: number;
  /** Current catalog YES ask, used only for cheap pre-screening. */
  readonly catalogYesAskDollars?: number;
  /** Current catalog NO ask, used only for cheap pre-screening. */
  readonly catalogNoAskDollars?: number;
  /** Venue-reported volume retained for display only. */
  readonly volume: number;
  /** Venue-reported liquidity retained for display only. */
  readonly liquidity: number;
  /** Venue source update timestamp. */
  readonly sourceUpdatedAtIso?: string;
}

/** One deterministic equivalent-contract candidate before direct-book evaluation. */
export interface EquivalentContractCandidate {
  /** Stable pair identifier. */
  readonly pairId: string;
  /** Kalshi side of the pair. */
  readonly kalshi: NativeBinaryMarket;
  /** Polymarket side of the pair. */
  readonly polymarket: NativeBinaryMarket;
  /** Deterministic lexical score on a scale of 100. */
  readonly similarityPercent100: number;
  /** Preliminary gross edge from catalog top quotes. */
  readonly preliminaryGrossEdgeDollarsPerShare: number;
  /** Direction suggested by catalog top quotes. */
  readonly preliminaryDirection: ArbitrageDirection;
  /** Deterministic reasons retained for review. */
  readonly matchReasons: readonly string[];
  /** Reviewed or provisional relationship between settlement propositions. */
  readonly relationship: OpportunityRelationship;
  /** Known clauses that can make the venue payouts diverge. */
  readonly settlementRisks: readonly string[];
}

/** Complete API-facing post-fee opportunity record. */
export interface ScannedOpportunity {
  /** Stable pair identifier. */
  readonly opportunityId: string;
  /** Strategy that produced this record. */
  readonly strategy: OpportunityStrategy;
  /** Current publication and review state. */
  readonly status: OpportunityStatus;
  /** Stable category used by API filters. */
  readonly category: string;
  /** Pair match confidence. */
  readonly matchConfidence: MatchConfidence;
  /** Settlement relationship between the two contracts. */
  readonly relationship: OpportunityRelationship;
  /** Known clauses that can make the venue payouts diverge. */
  readonly settlementRisks: readonly string[];
  /** Kalshi venue contract. */
  readonly kalshi: NativeBinaryMarket;
  /** Polymarket venue contract. */
  readonly polymarket: NativeBinaryMarket;
  /** Direction whose displayed books produce the best economics. */
  readonly direction: ArbitrageDirection;
  /** Equal shares evaluated on both legs. */
  readonly executableShares: number;
  /** Average executable price for the purchased YES leg. */
  readonly buyYesAveragePriceDollars: number;
  /** Average executable price for the purchased NO leg. */
  readonly buyNoAveragePriceDollars: number;
  /** Gross cost before venue fees. */
  readonly grossCostDollars: number;
  /** Venue fees modeled for both legs. */
  readonly feesDollars: number;
  /** Locked gross payout edge before fees. */
  readonly grossProfitDollars: number;
  /** Locked payout edge after fees. */
  readonly netProfitDollars: number;
  /** Post-fee profit if the shared core proposition settles identically. */
  readonly conditionalNetProfitDollars: number;
  /** Conservative loss if settlement divergence makes both legs lose. */
  readonly worstCaseSettlementDivergenceLossDollars: number;
  /** Adverse-divergence probability that reduces expected profit to zero. */
  readonly breakEvenAdverseDivergenceProbabilityPercent100?: number;
  /** Net profit per paired share in dollars. */
  readonly netEdgeDollarsPerShare: number;
  /** Net return on cash outlay on a scale of 100. */
  readonly roiPercent100: number;
  /** Direct-book observation timestamp. */
  readonly observedAtIso: string;
  /** Deterministic lexical score on a scale of 100. */
  readonly similarityPercent100: number;
  /** Reasons supporting or limiting settlement equivalence. */
  readonly matchReasons: readonly string[];
}

/** Compact venue leg returned by the opportunity-list endpoint. */
export interface OpportunityListMarket {
  /** Venue on which the contract trades. */
  readonly venue: Venue;
  /** Venue-native market identifier. */
  readonly marketId: string;
  /** Venue-native parent event identifier. */
  readonly eventId: string;
  /** Human-readable parent event title. */
  readonly eventTitle?: string;
  /** Human-readable contract proposition. */
  readonly question: string;
  /** Public venue page for the contract or parent event. */
  readonly marketUrl: string;
  /** Candidate-specific child outcome label. */
  readonly outcomeLabel?: string;
  /** Stable API category. */
  readonly category: string;
  /** Venue lifecycle status. */
  readonly status: string;
  /** Authoritative venue contract-terms document when supplied. */
  readonly settlementRulesUrl?: string;
  /** Venue closing or resolution timestamp when supplied. */
  readonly endDateIso?: string;
  /** Venue-reported volume retained only for display. */
  readonly volume: number;
  /** Venue-reported liquidity retained only for display. */
  readonly liquidity: number;
}

/** Compact opportunity row returned by list queries; detail retains full rules. */
export interface OpportunityListItem {
  /** Stable opportunity identifier. */
  readonly opportunityId: string;
  /** Producing strategy. */
  readonly strategy: OpportunityStrategy;
  /** Publication and review status. */
  readonly status: OpportunityStatus;
  /** Stable API category. */
  readonly category: string;
  /** Pair match confidence. */
  readonly matchConfidence: MatchConfidence;
  /** Settlement relationship between the two contracts. */
  readonly relationship: OpportunityRelationship;
  /** Known clauses that can make the venue payouts diverge. */
  readonly settlementRisks: readonly string[];
  /** Compact Kalshi leg. */
  readonly kalshi: OpportunityListMarket;
  /** Compact Polymarket leg. */
  readonly polymarket: OpportunityListMarket;
  /** Best direct-book direction. */
  readonly direction: ArbitrageDirection;
  /** Equal executable shares. */
  readonly executableShares: number;
  /** Average executable YES-leg price. */
  readonly buyYesAveragePriceDollars: number;
  /** Average executable NO-leg price. */
  readonly buyNoAveragePriceDollars: number;
  /** Gross spread per paired share before fees. */
  readonly grossEdgeDollarsPerShare: number;
  /** Modeled fees per paired share. */
  readonly feeDollarsPerShare: number;
  /** Gross profit at executable size. */
  readonly grossProfitDollars: number;
  /** Modeled fees at executable size. */
  readonly feesDollars: number;
  /** Net profit at executable size. */
  readonly netProfitDollars: number;
  /** Profit conditional on identical settlement of the shared proposition. */
  readonly conditionalNetProfitDollars: number;
  /** Conservative loss if both legs lose after settlement divergence. */
  readonly worstCaseSettlementDivergenceLossDollars: number;
  /** Break-even probability for the adverse-divergence scenario. */
  readonly breakEvenAdverseDivergenceProbabilityPercent100?: number;
  /** Net edge per paired share. */
  readonly netEdgeDollarsPerShare: number;
  /** Net return on cash outlay on a scale of 100. */
  readonly roiPercent100: number;
  /** Direct-book observation timestamp. */
  readonly observedAtIso: string;
  /** Deterministic lexical score on a scale of 100. */
  readonly similarityPercent100: number;
}

/** Summary returned after refreshing both native venue catalogs. */
export interface NativeCatalogRefreshResult {
  /** Normalized active binary contracts. */
  readonly markets: readonly NativeBinaryMarket[];
  /** Public HTTP requests consumed by the refresh. */
  readonly requestCount: number;
  /** Number of retained Kalshi contracts. */
  readonly kalshiMarketCount: number;
  /** Number of retained Polymarket contracts. */
  readonly polymarketMarketCount: number;
}

/** Bounded controls for one native opportunity scan. */
export interface OpportunityScanOptions {
  /** Minimum lexical score retained for book evaluation. */
  readonly minimumSimilarityPercent100: number;
  /** Minimum cheap gross edge retained before direct books. */
  readonly minimumPreliminaryGrossEdgeDollarsPerShare: number;
  /** Minimum direct-book post-fee edge published as actionable. */
  readonly minimumNetEdgeDollarsPerShare: number;
  /** Maximum candidates receiving fresh direct-book calls. */
  readonly maximumFreshBookPairs: number;
  /** Maximum candidates retained from one parent event pair. */
  readonly maximumPairsPerEventPair: number;
  /** Maximum cash used to measure executable depth. */
  readonly evaluationBudgetDollars: number;
  /** Number of direct-book pair evaluations allowed concurrently. */
  readonly directBookConcurrency: number;
}

/** Counts and results produced by one bounded scan. */
export interface OpportunityScanResult {
  /** UTC scan identifier. */
  readonly scanId: string;
  /** Catalog contracts considered. */
  readonly marketCount: number;
  /** Deterministic candidates before price pre-screening. */
  readonly lexicalCandidateCount: number;
  /** Candidates retained for direct venue books. */
  readonly freshBookCandidateCount: number;
  /** Direct-book candidates that failed safely. */
  readonly failedCandidateCount: number;
  /** Public venue requests used for books and fee metadata. */
  readonly externalRequestCount: number;
  /** Durable SQLite row writes used to publish this scan. */
  readonly databaseWriteCount: number;
  /** Stored post-fee results. */
  readonly opportunities: readonly ScannedOpportunity[];
}

/** Result from repricing a bounded set of currently tracked opportunities. */
export interface OpportunityPriceRefreshResult {
  /** UTC refresh identifier. */
  readonly refreshId: string;
  /** Current opportunities selected for repricing. */
  readonly attemptedOpportunityCount: number;
  /** Successfully repriced opportunities that remain positive after fees. */
  readonly updatedOpportunityCount: number;
  /** Opportunities removed because direct books no longer support positive economics. */
  readonly removedOpportunityCount: number;
  /** Opportunities retained at their prior price after a venue request failed. */
  readonly failedOpportunityCount: number;
  /** Public venue requests used for books and fee metadata. */
  readonly externalRequestCount: number;
  /** Durable SQLite row writes used to publish this refresh. */
  readonly databaseWriteCount: number;
  /** Fresh positive rows produced by the refresh. */
  readonly opportunities: readonly ScannedOpportunity[];
}

/** Filters accepted by the opportunity-list API. */
export interface OpportunityListFilters {
  /** Optional strategy restriction. */
  readonly strategy?: OpportunityStrategy;
  /** Optional exact normalized category. */
  readonly category?: string;
  /** Optional publication status. */
  readonly status?: OpportunityStatus;
  /** Optional settlement-relationship restriction. */
  readonly relationship?: OpportunityRelationship;
  /** Whether to exclude deterministic matches that still need rule review. */
  readonly reviewedOnly?: boolean;
  /** Minimum net edge in dollars per share. */
  readonly minimumNetEdgeDollarsPerShare?: number;
  /** Maximum rows returned. */
  readonly limit: number;
  /** Zero-based result offset. */
  readonly offset: number;
}

/** Periodic service job kinds persisted for health and cost reporting. */
export type OpportunityServiceJobType = "discovery" | "price_refresh";

/** Completion state of one periodic opportunity-service job. */
export type OpportunityServiceRunStatus = "running" | "completed" | "failed";

/** Persisted metrics for one bounded service job. */
export interface OpportunityServiceRun {
  /** Unique run identifier. */
  readonly runId: string;
  /** Discovery or price-only refresh. */
  readonly jobType: OpportunityServiceJobType;
  /** Current completion state. */
  readonly status: OpportunityServiceRunStatus;
  /** UTC start timestamp. */
  readonly startedAtIso: string;
  /** UTC completion timestamp when the run has ended. */
  readonly completedAtIso?: string;
  /** Public venue HTTP requests used by the run. */
  readonly externalRequestCount: number;
  /** Durable SQLite rows inserted, updated, or deleted by the run. */
  readonly databaseWriteCount: number;
  /** Number of candidates whose direct prices were considered. */
  readonly candidateCount: number;
  /** Positive post-fee opportunities published by the run. */
  readonly opportunityCount: number;
  /** Safe diagnostic retained for failed runs. */
  readonly errorMessage?: string;
}

/** Current scheduler state exposed to the API and dashboard. */
export interface OpportunityServiceStatus {
  /** Whether periodic timers are active. */
  readonly running: boolean;
  /** Whether a discovery or price job is currently executing. */
  readonly activeJob?: OpportunityServiceJobType;
  /** Configured full rediscovery interval. */
  readonly discoveryIntervalSeconds: number;
  /** Configured direct-book price refresh interval. */
  readonly priceRefreshIntervalSeconds: number;
  /** Maximum existing opportunities repriced per price cycle. */
  readonly maximumPriceRefreshPairs: number;
  /** Most recent discovery job, when one exists. */
  readonly lastDiscoveryRun?: OpportunityServiceRun;
  /** Most recent price refresh job, when one exists. */
  readonly lastPriceRefreshRun?: OpportunityServiceRun;
  /** Number of browser clients currently receiving server-sent updates. */
  readonly connectedClientCount: number;
}

/** Lightweight event emitted after service state or opportunity data changes. */
export interface OpportunityServiceUpdate {
  /** Event kind understood by dashboard clients. */
  readonly type: "status" | "opportunities";
  /** UTC event timestamp. */
  readonly emittedAtIso: string;
  /** Job responsible for the event, when applicable. */
  readonly jobType?: OpportunityServiceJobType;
}
