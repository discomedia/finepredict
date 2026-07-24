/** A supported prediction-market venue. */
export type Venue = "kalshi" | "polymarket";

/** A side of a binary prediction market. */
export type OutcomeSide = "yes" | "no";

/** The confidence assigned to an automatically or manually matched market pair. */
export type MatchConfidence = "verified" | "probable" | "possible";

/** The fee structure reported by Kalshi for a market series. */
export type KalshiFeeType = "quadratic" | "quadratic_with_maker_fees" | "flat";

/** A normalized market returned by Oddpool search. */
export interface SearchMarket {
  /** Venue-native market identifier. */
  readonly marketId: string;
  /** Venue on which the market trades. */
  readonly exchange: Venue;
  /** Venue-native series identifier, when available. */
  readonly seriesId?: string;
  /** Binary proposition shown to traders. */
  readonly question: string;
  /** Market category, when supplied. */
  readonly category?: string;
  /** Current market status. */
  readonly status: string;
  /** Lifetime volume in venue units. */
  readonly volume: number;
  /** Current reported liquidity in venue units. */
  readonly liquidity: number;
  /** Parent event identifier. */
  readonly eventId: string;
  /** Parent event title. */
  readonly eventTitle: string;
  /** Human-readable Polymarket slug, when supplied. */
  readonly slug?: string;
}

/** An outcome normalized by Oddpool across one or more venues. */
export interface OddpoolMatchedOutcome {
  /** Stable outcome key inside the matched feed event. */
  readonly outcomeKey: string;
  /** Human-readable canonical outcome label. */
  readonly label: string;
  /** Venues configured for this normalized outcome. */
  readonly venues: readonly Venue[];
}

/** A canonical event matched by Oddpool across prediction-market venues. */
export interface OddpoolMatchedEvent {
  /** Stable feed event key used by Oddpool channels. */
  readonly eventKey: string;
  /** Oddpool's normalized event title. */
  readonly title: string;
  /** Feed vertical that supplied the match. */
  readonly feed: "macro" | "crypto";
  /** Oddpool event classification such as `fomc` or `btc_15m`. */
  readonly eventType: string;
  /** Calendar date associated with the event. */
  readonly eventDate: string;
  /** Expected release or resolution timestamp, when supplied. */
  readonly releaseAtIso?: string;
  /** Venues configured for the normalized event. */
  readonly venues: readonly Venue[];
  /** Canonical outcomes configured for the event. */
  readonly outcomes: readonly OddpoolMatchedOutcome[];
}

/** A venue-native event returned by Oddpool event search. */
export interface SearchEvent {
  /** Venue-native event identifier. */
  readonly eventId: string;
  /** Venue on which the event trades. */
  readonly exchange: Venue;
  /** Venue-native parent series identifier, when supplied. */
  readonly seriesId?: string;
  /** Event title shown to traders. */
  readonly title: string;
  /** Current event status. */
  readonly status: string;
  /** Number of child markets under the event. */
  readonly marketCount: number;
  /** Aggregate child-market volume. */
  readonly totalVolume: number;
}

/** An automatically or manually identified cross-venue market pair. */
export interface MarketPair {
  /** Stable identifier derived from both venue-native market identifiers. */
  readonly pairId: string;
  /** Kalshi side of the pair. */
  readonly kalshi: SearchMarket;
  /** Polymarket side of the pair. */
  readonly polymarket: SearchMarket;
  /** Text-and-structure similarity on a scale of 0 to 100. */
  readonly similarityPercent100: number;
  /** Match confidence used to separate strict from provisional findings. */
  readonly confidence: MatchConfidence;
  /** Human-readable reasons supporting or limiting the match. */
  readonly matchReasons: readonly string[];
  /** Discovery surface that identified the cross-venue relationship. */
  readonly discoverySource?:
    "oddpool_catalog" | "text_similarity" | "manual_override" | "pmxt";
  /** Oddpool canonical event key when the feed catalog supplied the match. */
  readonly oddpoolEventKey?: string;
  /** Oddpool canonical outcome key when the feed catalog supplied the match. */
  readonly oddpoolOutcomeKey?: string;
}

/** Why a discovered cross-venue relationship was or was not analyzed. */
export type PairDiscoveryDisposition = "eligible" | "rejected" | "unresolved";

/** Auditable record retained for every high-signal common-market discovery. */
export interface PairDiscoveryRecord {
  /** Discovery surface that proposed the relationship. */
  readonly source:
    "oddpool_catalog" | "text_similarity" | "manual_override" | "pmxt";
  /** Whether the relationship can proceed to historical profitability analysis. */
  readonly disposition: PairDiscoveryDisposition;
  /** Human-readable explanation of the disposition. */
  readonly reason: string;
  /** Oddpool canonical event key, when applicable. */
  readonly oddpoolEventKey?: string;
  /** Oddpool canonical event title, when applicable. */
  readonly oddpoolEventTitle?: string;
  /** Oddpool canonical outcome key, when applicable. */
  readonly oddpoolOutcomeKey?: string;
  /** Oddpool canonical outcome label, when applicable. */
  readonly oddpoolOutcomeLabel?: string;
  /** Resolved pair when both venue-native market identifiers were found. */
  readonly pair?: MarketPair;
}

/** Recall and eligibility counters for the common-market discovery stage. */
export interface PairDiscoverySummary {
  /** Oddpool feed events configured on both target venues. */
  readonly oddpoolCrossVenueEventCount: number;
  /** Oddpool outcomes configured on both target venues. */
  readonly oddpoolCrossVenueOutcomeCount: number;
  /** Catalog events selected for venue-native identifier resolution. */
  readonly oddpoolEventsResolvedCount: number;
  /** High-signal cross-venue relationships retained before eligibility filtering. */
  readonly discoveredPairCount: number;
  /** Relationships eligible for historical profitability analysis. */
  readonly eligiblePairCount: number;
  /** Relationships blocked by an explicit review or structural mismatch. */
  readonly rejectedPairCount: number;
  /** Canonical relationships whose venue-native identifiers could not be resolved. */
  readonly unresolvedPairCount: number;
  /** Detailed discovery audit records. */
  readonly records: readonly PairDiscoveryRecord[];
}

/** Reviewed relationship classes used by exact and event-family decisions. */
export type PairRelationshipClassification =
  "pure_arbitrage" | "near_arbitrage" | "relative_value" | "mismatch";

/** A manually reviewed pair override. */
export interface PairOverride {
  /** Kalshi market ticker, or `*` when event identifiers scope the review. */
  readonly kalshiMarketId: string;
  /** Polymarket condition identifier, or `*` when event identifiers scope the review. */
  readonly polymarketMarketId: string;
  /** Optional Kalshi event identifier for a family-level review. */
  readonly kalshiEventId?: string;
  /** Optional Polymarket event identifier for a family-level review. */
  readonly polymarketEventId?: string;
  /** Whether settlement equivalence was manually verified. */
  readonly verified: boolean;
  /** Reviewed relationship class; omitted legacy rejections remain mismatches. */
  readonly classification?: PairRelationshipClassification;
  /** Concrete ways the venue settlements can diverge. */
  readonly settlementRisks?: readonly string[];
  /** Review note explaining the equivalence or rejection. */
  readonly note: string;
}

/** A single price level available to buy an outcome. */
export interface AskLevel {
  /** Price per share, between zero and one dollars. */
  readonly priceDollars: number;
  /** Available share count at this level. */
  readonly sizeShares: number;
}

/** A normalized full-depth snapshot for both binary outcomes. */
export interface BinaryOrderBookSnapshot {
  /** Venue-native market identifier. */
  readonly marketId: string;
  /** Snapshot timestamp in Unix milliseconds. */
  readonly timestampMs: number;
  /** Ask ladder for buying YES. */
  readonly yesAsks: readonly AskLevel[];
  /** Ask ladder for buying NO. */
  readonly noAsks: readonly AskLevel[];
}

/** Kalshi fee configuration for a series. */
export interface KalshiFeeSchedule {
  /** Fee calculation family. */
  readonly feeType: KalshiFeeType;
  /** Venue-supplied multiplier applied to the fee formula. */
  readonly feeMultiplier: number;
  /** Source series ticker. */
  readonly seriesTicker: string;
  /** Authoritative series contract-terms document when supplied. */
  readonly contractTermsUrl?: string;
}

/** Polymarket market metadata needed to analyze books and fees. */
export interface PolymarketMarketDetails {
  /** Condition identifier used by Oddpool and the CLOB. */
  readonly conditionId: string;
  /** Token identifier representing YES. */
  readonly yesTokenId: string;
  /** Token identifier representing NO. */
  readonly noTokenId: string;
  /** Full settlement description. */
  readonly description: string;
  /** Resolution timestamp, when supplied. */
  readonly endDateIso?: string;
  /** Market tags used to infer the documented taker-fee category. */
  readonly tags: readonly string[];
  /** Minimum supported order size in shares. */
  readonly minimumOrderSizeShares: number;
  /** Venue-reported taker fee coefficient for this market. */
  readonly takerFeeRate?: number;
  /** Venue-reported exponent applied to p x (1-p). */
  readonly takerFeeExponent?: number;
}

/** Fee inputs for one venue leg. */
export interface LegFeeModel {
  /** Venue whose fee schedule applies. */
  readonly venue: Venue;
  /** Kalshi series schedule when the venue is Kalshi. */
  readonly kalshiSchedule?: KalshiFeeSchedule;
  /** Polymarket taker coefficient in the documented fee formula. */
  readonly polymarketTakerFeeRate?: number;
  /** Polymarket exponent applied to the price curve; defaults to one. */
  readonly polymarketFeeExponent?: number;
}

/** A direction for a paired cross-venue arbitrage trade. */
export interface ArbitrageDirection {
  /** Venue on which YES would be bought. */
  readonly buyYesVenue: Venue;
  /** Venue on which NO would be bought. */
  readonly buyNoVenue: Venue;
}

/** A fee-aware, size-aware opportunity observed at aligned historical snapshots. */
export interface ArbitrageOpportunity {
  /** Matched market-pair identifier. */
  readonly pairId: string;
  /** Pair match confidence. */
  readonly matchConfidence: MatchConfidence;
  /** Kalshi proposition. */
  readonly kalshiQuestion: string;
  /** Polymarket proposition. */
  readonly polymarketQuestion: string;
  /** Snapshot time used for the opportunity. */
  readonly observedAtIso: string;
  /** Absolute difference between venue snapshot times. */
  readonly snapshotDifferenceSeconds: number;
  /** Paired trade direction. */
  readonly direction: ArbitrageDirection;
  /** Equal number of YES and NO shares modeled. */
  readonly shares: number;
  /** Gross purchase cost before fees. */
  readonly grossCostDollars: number;
  /** Average executable YES-leg price across the selected depth. */
  readonly buyYesAveragePriceDollars: number;
  /** Average executable NO-leg price across the selected depth. */
  readonly buyNoAveragePriceDollars: number;
  /** Modeled fee charged on the YES leg. */
  readonly buyYesFeeDollars: number;
  /** Modeled fee charged on the NO leg. */
  readonly buyNoFeeDollars: number;
  /** Estimated taker fees across both legs. */
  readonly feesDollars: number;
  /** Gross locked payout less purchase cost, before fees. */
  readonly grossProfitDollars: number;
  /** Locked payout less purchase cost and modeled fees. */
  readonly netProfitDollars: number;
  /** Net return divided by cash outlay, on a scale of 100. */
  readonly roiPercent100: number;
  /** Cash budget requested for the paired position. */
  readonly budgetDollars: number;
}

/** Deterministic classification of the profitability evidence in one run. */
export type ProfitabilityStatus =
  | "strict_opportunity_detected"
  | "provisional_signals_only"
  | "no_positive_observations";

/** Aggregated profitability evidence for one candidate market pair. */
export interface PairProfitabilitySummary {
  /** Stable cross-venue pair identifier. */
  readonly pairId: string;
  /** Pair verification level used to determine execution safety. */
  readonly matchConfidence: MatchConfidence;
  /** Kalshi proposition included in the candidate pair. */
  readonly kalshiQuestion: string;
  /** Polymarket proposition included in the candidate pair. */
  readonly polymarketQuestion: string;
  /** Number of aligned snapshots with positive modeled net profit. */
  readonly positiveObservationCount: number;
  /** Earliest positive observation timestamp, when one exists. */
  readonly firstPositiveObservedAtIso?: string;
  /** Latest positive observation timestamp, when one exists. */
  readonly lastPositiveObservedAtIso?: string;
  /** Highest modeled net profit among the pair's positive observations. */
  readonly bestNetProfitDollars?: number;
  /** Mean modeled net profit across the pair's positive observations. */
  readonly averageNetProfitDollars?: number;
  /** Median modeled net profit across the pair's positive observations. */
  readonly medianNetProfitDollars?: number;
  /** Lowest still-positive modeled net profit observed for the pair. */
  readonly minimumPositiveNetProfitDollars?: number;
  /** Highest modeled return on cash outlay on a scale of 100. */
  readonly bestRoiPercent100?: number;
  /** Mean modeled return on cash outlay on a scale of 100. */
  readonly averageRoiPercent100?: number;
  /** Highest-profit individual observation for audit and strategy explanation. */
  readonly bestOpportunity?: ArbitrageOpportunity;
}

/** Deterministic profitability analysis produced before any LLM interpretation. */
export interface ProfitabilityAnalysis {
  /** Overall state derived from verification status and positive observations. */
  readonly status: ProfitabilityStatus;
  /** Candidate pairs evaluated during the run. */
  readonly candidatePairCount: number;
  /** Candidate pairs with at least one positive fee-aware observation. */
  readonly positivePairCount: number;
  /** All positive aligned historical observations. */
  readonly totalPositiveObservationCount: number;
  /** Positive observations whose pair has passed manual settlement review. */
  readonly strictPositiveObservationCount: number;
  /** Positive observations whose pair has not passed settlement review. */
  readonly provisionalPositiveObservationCount: number;
  /** Best observation on a manually verified equivalent pair, when available. */
  readonly bestStrictOpportunity?: ArbitrageOpportunity;
  /** Best observation on an unverified pair, when available. */
  readonly bestProvisionalOpportunity?: ArbitrageOpportunity;
  /** Per-pair profitability summaries, including pairs with no positive rows. */
  readonly pairSummaries: readonly PairProfitabilitySummary[];
  /** Deterministic reader-facing conclusion that the LLM may explain but not override. */
  readonly conclusion: string;
}

/** Allowed non-execution recommendations from the strategy explanation layer. */
export type TradingStrategyRecommendation =
  "no_trade" | "manual_review" | "paper_trade_candidate";

/** Structured trading-strategy interpretation generated from reviewed run metrics. */
export interface TradingStrategyExplanation {
  /** Short answer-first description of the run's trading implication. */
  readonly headline: string;
  /** Safest next action allowed by the deterministic evidence. */
  readonly recommendation: TradingStrategyRecommendation;
  /** Explanation of potential profitability without summing repeated snapshots. */
  readonly profitabilityAssessment: string;
  /** Plain-language strategy implied by the evidence, including staying flat when required. */
  readonly strategyDescription: string;
  /** Concrete observations supporting the recommendation. */
  readonly evidence: readonly string[];
  /** Material market, settlement, fill, latency, and model risks. */
  readonly riskFactors: readonly string[];
  /** Bounded research or paper-trading steps that follow from the result. */
  readonly nextSteps: readonly string[];
}

/** Auditable token and cost receipt for the strategy-explanation LLM call. */
export interface StrategyLlmUsage {
  /** LLM provider reported by `@discomedia/utils`. */
  readonly provider: string;
  /** Model identifier reported by `@discomedia/utils`. */
  readonly model: string;
  /** Input tokens billed for the explanation. */
  readonly promptTokens: number;
  /** Output tokens billed for the explanation. */
  readonly completionTokens: number;
  /** Reasoning tokens reported by the provider, when applicable. */
  readonly reasoningTokens: number;
  /** Cached input tokens reported by the provider, when applicable. */
  readonly cacheHitTokens: number;
  /** Cache-write tokens reported by the provider, when applicable. */
  readonly cacheWriteTokens: number;
  /** Estimated provider cost in dollars. */
  readonly estimatedCostDollars: number;
}

/** LLM-authored strategy explanation and its usage receipt. */
export interface TradingStrategyAnalysis {
  /** Structured explanation constrained by deterministic profitability status. */
  readonly explanation: TradingStrategyExplanation;
  /** Usage and estimated cost returned by the shared LLM package. */
  readonly usage: StrategyLlmUsage;
}

/** Summary counters and findings emitted by one discovery run. */
export interface DiscoveryRunResult {
  /** Run identifier based on the UTC start time. */
  readonly runId: string;
  /** ISO start of the analyzed window. */
  readonly windowStartIso: string;
  /** ISO end of the analyzed window. */
  readonly windowEndIso: string;
  /** Sampling granularity requested from Oddpool. */
  readonly granularity: "1m" | "5m";
  /** Paired cash budget. */
  readonly budgetDollars: number;
  /** Search terms sent to Oddpool. */
  readonly searchQueries: readonly string[];
  /** Number of unique markets returned by search. */
  readonly marketCount: number;
  /** Recall and eligibility evidence from Oddpool-native and text discovery. */
  readonly pairDiscovery: PairDiscoverySummary;
  /** Candidate market pairs found. */
  readonly pairs: readonly MarketPair[];
  /** Fee-aware positive opportunities. */
  readonly opportunities: readonly ArbitrageOpportunity[];
  /** Deterministic profitability aggregation used as the reporting source of truth. */
  readonly profitabilityAnalysis: ProfitabilityAnalysis;
  /** Optional LLM explanation; absent only when no explainer was configured or it failed. */
  readonly tradingStrategyAnalysis?: TradingStrategyAnalysis;
  /** Warnings that materially limit interpretation. */
  readonly warnings: readonly string[];
  /** Number of Oddpool requests consumed by the run. */
  readonly oddpoolRequestCount: number;
}
