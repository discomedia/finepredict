import { createHash } from "node:crypto";

import type {
  MarketPair,
  MatchConfidence,
  PairDiscoveryRecord,
  PairOverride,
  SearchMarket,
} from "../common/types.js";

const stopWords = new Set([
  "a",
  "after",
  "an",
  "and",
  "at",
  "be",
  "before",
  "by",
  "do",
  "does",
  "for",
  "from",
  "happen",
  "in",
  "is",
  "it",
  "market",
  "nam",
  "nhl",
  "of",
  "on",
  "or",
  "the",
  "there",
  "to",
  "will",
  "with",
  "yes",
]);

const directionWords = new Set(["decrease", "increase", "lose", "win"]);

const scopeWords = new Set([
  "afc",
  "emergency",
  "conference",
  "division",
  "meeting",
  "nfc",
  "primary",
  "quarterfinal",
  "regular",
  "round",
  "runoff",
  "scheduled",
  "semifinal",
  "special",
]);

const mutuallyExclusiveTokenGroups: readonly ReadonlySet<string>[] = [
  new Set(["man", "woman"]),
  new Set(["men", "women"]),
  new Set(["male", "female"]),
  new Set(["boy", "girl"]),
  new Set(["headline", "core"]),
];

/** Logical connector that changes a proposition's truth conditions. */
export type LogicalOperator = "and" | "or";

/** Numeric comparison relation attached to a market threshold. */
export type ThresholdRelation =
  "at_least" | "at_most" | "greater_than" | "less_than" | "between" | "exact";

const genericMarketTokens = new Set([
  "award",
  "baseball",
  "basketball",
  "best",
  "candidate",
  "champion",
  "event",
  "espy",
  "final",
  "football",
  "happen",
  "hockey",
  "match",
  "player",
  "price",
  "rate",
  "team",
  "tenni",
  "tournament",
  "win",
  "winner",
  "worldcup",
]);

/** Text representation used by deterministic matching. */
export interface NormalizedMarketText {
  /** Informative normalized terms. */
  readonly tokens: ReadonlySet<string>;
  /** Numbers whose mismatch can change the proposition. */
  readonly numbers: ReadonlySet<string>;
  /** Directional terms whose mismatch reverses or changes a threshold. */
  readonly directions: ReadonlySet<string>;
  /** Whether explicit negation appears. */
  readonly hasNegation: boolean;
  /** Non-generic terms used to prevent entity substitutions. */
  readonly distinctiveTokens: ReadonlySet<string>;
  /** Competition stages or scopes that must agree exactly. */
  readonly scopeTokens: ReadonlySet<string>;
  /** Boolean connectors whose mismatch changes compound propositions. */
  readonly logicalOperators: ReadonlySet<LogicalOperator>;
  /** Numeric comparison semantics such as exact, at least, or below. */
  readonly thresholdRelations: ReadonlySet<ThresholdRelation>;
}

/** Options controlling deterministic candidate matching. */
export interface MatchMarketsOptions {
  /** Minimum score retained as a possible match. */
  readonly minimumSimilarityPercent100?: number;
  /** Manually reviewed equivalence overrides. */
  readonly overrides?: readonly PairOverride[];
  /** Maximum returned candidate pairs. */
  readonly maximumPairs?: number;
  /** Optional audit sink for high-signal pairs blocked by an explicit review. */
  readonly onRejectedPair?: (record: PairDiscoveryRecord) => void;
}

/**
 * Normalizes a market proposition for deterministic comparison.
 *
 * @param text - Market question and optional event title.
 * @returns Tokens, numbers, direction terms, and negation marker.
 */
export function normalizeMarketText(text: string): NormalizedMarketText {
  const canonical = text
    .toLocaleLowerCase("en-US")
    .replace(/\b20(\d{2})-(\d{2})\b/gu, "20$2")
    .replace(/federal reserve/gu, "fed")
    .replace(/united states|u\.s\./gu, "us")
    .replace(/donald j\. trump|donald trump/gu, "trump")
    .replace(/interest rates?/gu, "rate")
    .replace(/pro baseball|major league baseball/gu, "mlb")
    .replace(/world cup/gu, "worldcup")
    .replace(/\b(\d+(?:\.\d+)?)\s*bps?\b/gu, " $1 ")
    .replace(/&/gu, " and ")
    .replace(/\+/gu, " plus ")
    .replace(/[^a-z0-9.%<>=-]+/gu, " ")
    .trim();
  const rawTokens = canonical.split(/\s+/u).filter(Boolean);
  const tokens = new Set<string>();
  const numbers = new Set<string>();
  const directions = new Set<string>();
  let hasNegation = false;
  for (const rawToken of rawTokens) {
    const token = stemToken(rawToken);
    if (/^\d+(?:\.\d+)?%?$/u.test(token)) {
      numbers.add(token);
      tokens.add(token);
      continue;
    }
    if (token === "no" || token === "not" || token === "never") {
      hasNegation = true;
      continue;
    }
    if (directionWords.has(token)) {
      directions.add(token);
    }
    if (!stopWords.has(token) && token.length > 1) {
      tokens.add(token);
    }
  }
  const distinctiveTokens = new Set(
    [...tokens].filter(
      (token) =>
        !genericMarketTokens.has(token) &&
        !directionWords.has(token) &&
        !numbers.has(token),
    ),
  );
  const scopeTokens = new Set(
    [...tokens].filter((token) => scopeWords.has(token)),
  );
  const logicalOperators = extractLogicalOperators(canonical);
  const thresholdRelations = extractThresholdRelations(canonical);
  return {
    tokens,
    numbers,
    directions,
    hasNegation,
    distinctiveTokens,
    scopeTokens,
    logicalOperators,
    thresholdRelations,
  };
}

/**
 * Finds plausible equivalent binary markets across Kalshi and Polymarket.
 *
 * @param markets - Deduplicated markets from Oddpool search.
 * @param options - Thresholds, overrides, and result cap.
 * @returns Ranked cross-venue candidate pairs.
 */
export function matchMarkets(
  markets: readonly SearchMarket[],
  options: MatchMarketsOptions = {},
): readonly MarketPair[] {
  const minimumSimilarityPercent100 = options.minimumSimilarityPercent100 ?? 68;
  const maximumPairs = options.maximumPairs ?? 20;
  const kalshi = markets.filter((market) => market.exchange === "kalshi");
  const polymarket = markets.filter(
    (market) => market.exchange === "polymarket",
  );
  const normalizedPoly = new Map(
    polymarket.map((market) => [
      market.marketId,
      normalizeSearchMarket(market),
    ]),
  );
  const polyByToken = buildTokenIndex(polymarket, normalizedPoly);
  const pairs = new Map<string, MarketPair>();

  for (const kalshiMarket of kalshi) {
    const left = normalizeSearchMarket(kalshiMarket);
    const candidateIds = new Set<string>();
    for (const token of left.tokens) {
      for (const id of polyByToken.get(token) ?? []) {
        candidateIds.add(id);
      }
    }
    for (const polymarketId of candidateIds) {
      const polymarketMarket = polymarket.find(
        (market) => market.marketId === polymarketId,
      );
      const right = normalizedPoly.get(polymarketId);
      if (!polymarketMarket || !right) {
        continue;
      }
      const override = findPairOverride(
        options.overrides ?? [],
        kalshiMarket,
        polymarketMarket,
      );
      const comparison = compareNormalizedText(left, right);
      if (override && !override.verified) {
        const exactMarketReview =
          override.kalshiMarketId !== "*" &&
          override.polymarketMarketId !== "*";
        if (
          exactMarketReview ||
          comparison.scorePercent100 >= minimumSimilarityPercent100
        ) {
          const pairId = createPairId(
            kalshiMarket.marketId,
            polymarketMarket.marketId,
          );
          options.onRejectedPair?.({
            source: "manual_override",
            disposition: "rejected",
            reason: override.note,
            pair: {
              pairId,
              kalshi: kalshiMarket,
              polymarket: polymarketMarket,
              similarityPercent100: comparison.scorePercent100,
              confidence: "possible",
              matchReasons: [`Manual rejection: ${override.note}`],
              discoverySource: "manual_override",
            },
          });
        }
        continue;
      }
      if (
        !override &&
        comparison.scorePercent100 < minimumSimilarityPercent100
      ) {
        continue;
      }
      const confidence: MatchConfidence = override
        ? "verified"
        : comparison.scorePercent100 >= 82
          ? "probable"
          : "possible";
      const pairId = createPairId(
        kalshiMarket.marketId,
        polymarketMarket.marketId,
      );
      pairs.set(pairId, {
        pairId,
        kalshi: kalshiMarket,
        polymarket: polymarketMarket,
        similarityPercent100: override ? 100 : comparison.scorePercent100,
        confidence,
        matchReasons: override
          ? [`Manual review: ${override.note}`]
          : comparison.reasons,
        discoverySource: override ? "manual_override" : "text_similarity",
      });
    }
  }

  for (const override of options.overrides ?? []) {
    if (
      !override.verified ||
      override.kalshiMarketId === "*" ||
      override.polymarketMarketId === "*"
    ) {
      continue;
    }
    const kalshiMarket = kalshi.find(
      (market) => market.marketId === override.kalshiMarketId,
    );
    const polymarketMarket = polymarket.find(
      (market) => market.marketId === override.polymarketMarketId,
    );
    if (!kalshiMarket || !polymarketMarket) {
      continue;
    }
    const pairId = createPairId(
      kalshiMarket.marketId,
      polymarketMarket.marketId,
    );
    pairs.set(pairId, {
      pairId,
      kalshi: kalshiMarket,
      polymarket: polymarketMarket,
      similarityPercent100: 100,
      confidence: "verified",
      matchReasons: [`Manual review: ${override.note}`],
      discoverySource: "manual_override",
    });
  }

  const ranked = [...pairs.values()].sort((left, right) => {
    const confidenceDelta =
      confidenceRank(right.confidence) - confidenceRank(left.confidence);
    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }
    const similarityDelta =
      right.similarityPercent100 - left.similarityPercent100;
    if (similarityDelta !== 0) {
      return similarityDelta;
    }
    return (
      right.kalshi.volume +
      right.polymarket.volume -
      (left.kalshi.volume + left.polymarket.volume)
    );
  });
  const selected: MarketPair[] = [];
  const eventPairCounts = new Map<string, number>();
  for (const pair of ranked) {
    const eventPairKey = `${pair.kalshi.eventId}:${pair.polymarket.eventId}`;
    const count = eventPairCounts.get(eventPairKey) ?? 0;
    if (count >= 3) {
      continue;
    }
    selected.push(pair);
    eventPairCounts.set(eventPairKey, count + 1);
    if (selected.length >= maximumPairs) {
      break;
    }
  }
  return selected;
}

/**
 * Compares normalized propositions and rejects structurally incompatible pairs.
 *
 * @param left - First normalized proposition.
 * @param right - Second normalized proposition.
 * @returns Similarity score and audit reasons.
 */
export function compareNormalizedText(
  left: NormalizedMarketText,
  right: NormalizedMarketText,
): { readonly scorePercent100: number; readonly reasons: readonly string[] } {
  if (!setsEqual(left.numbers, right.numbers)) {
    return {
      scorePercent100: 0,
      reasons: ["Numeric thresholds or dates differ"],
    };
  }
  if (left.hasNegation !== right.hasNegation) {
    return { scorePercent100: 0, reasons: ["Negation differs"] };
  }
  if (!setsEqual(left.scopeTokens, right.scopeTokens)) {
    return {
      scorePercent100: 0,
      reasons: ["Competition stage or outcome scope differs"],
    };
  }
  if (!setsEqual(left.logicalOperators, right.logicalOperators)) {
    return {
      scorePercent100: 0,
      reasons: ["Compound proposition logic differs"],
    };
  }
  if (!setsEqual(left.thresholdRelations, right.thresholdRelations)) {
    return {
      scorePercent100: 0,
      reasons: ["Numeric comparison semantics differ"],
    };
  }
  if (hasMutuallyExclusiveTokens(left.tokens, right.tokens)) {
    return {
      scorePercent100: 0,
      reasons: ["Mutually exclusive entity attributes differ"],
    };
  }
  if (
    left.distinctiveTokens.size > 0 &&
    right.distinctiveTokens.size > 0 &&
    ![...left.distinctiveTokens].some((token) =>
      right.distinctiveTokens.has(token),
    )
  ) {
    return { scorePercent100: 0, reasons: ["Named entities do not overlap"] };
  }
  if (
    left.directions.size > 0 &&
    right.directions.size > 0 &&
    !setsEqual(left.directions, right.directions)
  ) {
    return {
      scorePercent100: 0,
      reasons: ["Directional or threshold language differs"],
    };
  }
  const intersection = [...left.tokens].filter((token) =>
    right.tokens.has(token),
  );
  if (intersection.length < 2) {
    return {
      scorePercent100: 0,
      reasons: ["Fewer than two informative terms overlap"],
    };
  }
  const union = new Set([...left.tokens, ...right.tokens]);
  const containment =
    intersection.length / Math.min(left.tokens.size, right.tokens.size);
  const jaccard = intersection.length / Math.max(1, union.size);
  const scorePercent100 = Math.round((0.7 * containment + 0.3 * jaccard) * 100);
  return {
    scorePercent100,
    reasons: [
      `${intersection.length} informative terms overlap`,
      "Numeric, logical, scope, and directional constraints agree",
      "Settlement rules still require review unless manually verified",
    ],
  };
}

/**
 * Extracts Boolean connectors while excluding inclusive threshold phrases.
 *
 * @param canonical - Lowercase normalized market text.
 * @returns Boolean operators that join distinct proposition clauses.
 */
function extractLogicalOperators(
  canonical: string,
): ReadonlySet<LogicalOperator> {
  const logicalText = canonical.replace(
    /\bor (?:above|below|more|fewer)\b/gu,
    " ",
  );
  const operators = new Set<LogicalOperator>();
  if (/\band\b/gu.test(logicalText)) {
    operators.add("and");
  }
  if (/\bor\b/gu.test(logicalText)) {
    operators.add("or");
  }
  return operators;
}

/**
 * Extracts hard numeric-comparison semantics from a normalized proposition.
 *
 * @param canonical - Lowercase normalized market text retaining comparison symbols.
 * @returns Threshold relations whose mismatch changes the payout set.
 */
function extractThresholdRelations(
  canonical: string,
): ReadonlySet<ThresholdRelation> {
  const relations = new Set<ThresholdRelation>();
  if (/\bbetween\b/gu.test(canonical)) {
    relations.add("between");
  }
  if (/\b(?:at least|or above|or more)\b|>=/gu.test(canonical)) {
    relations.add("at_least");
  }
  if (/\b(?:at most|or below|or fewer)\b|<=/gu.test(canonical)) {
    relations.add("at_most");
  }
  const withoutInclusivePhrases = canonical
    .replace(/\b(?:at least|or above|or more)\b/gu, " ")
    .replace(/\b(?:at most|or below|or fewer)\b/gu, " ");
  if (
    /\b(?:above|over|more than|greater than)\b|(?<![<>=])>(?!=)/gu.test(
      withoutInclusivePhrases,
    )
  ) {
    relations.add("greater_than");
  }
  if (
    /\b(?:below|under|less than|fewer than)\b|(?<![<>=])<(?!=)/gu.test(
      withoutInclusivePhrases,
    )
  ) {
    relations.add("less_than");
  }
  if (/\bexactly\b/gu.test(canonical)) {
    relations.add("exact");
  }
  const containsPercentage = /\d+(?:\.\d+)?%/gu.test(canonical);
  if (containsPercentage && relations.size === 0) {
    relations.add("exact");
  }
  return relations;
}

/**
 * Produces a stable pair identifier without exposing unwieldy venue IDs.
 *
 * @param kalshiMarketId - Kalshi market ticker.
 * @param polymarketMarketId - Polymarket condition identifier.
 * @returns Short SHA-256 based identifier.
 */
export function createPairId(
  kalshiMarketId: string,
  polymarketMarketId: string,
): string {
  return createHash("sha256")
    .update(`${kalshiMarketId}:${polymarketMarketId}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Normalizes the proposition and event title for search matching.
 *
 * @param market - Search result to normalize.
 * @returns Normalized combined text.
 */
function normalizeSearchMarket(market: SearchMarket): NormalizedMarketText {
  return normalizeMarketText(`${market.question} ${market.eventTitle}`);
}

/**
 * Indexes Polymarket markets by normalized informative token.
 *
 * @param markets - Polymarket search results.
 * @param normalized - Precomputed normalized text by market identifier.
 * @returns Token-to-market identifier map.
 */
function buildTokenIndex(
  markets: readonly SearchMarket[],
  normalized: ReadonlyMap<string, NormalizedMarketText>,
): ReadonlyMap<string, readonly string[]> {
  const index = new Map<string, string[]>();
  for (const market of markets) {
    for (const token of normalized.get(market.marketId)?.tokens ?? []) {
      const ids = index.get(token) ?? [];
      ids.push(market.marketId);
      index.set(token, ids);
    }
  }
  return index;
}

/**
 * Applies light English stemming for common market-question variants.
 *
 * @param token - Lowercase token.
 * @returns Lightly stemmed token.
 */
function stemToken(token: string): string {
  if (token.length > 5 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.length > 5 && token.endsWith("ing")) {
    return token.slice(0, -3);
  }
  if (token.length > 4 && token.endsWith("ed")) {
    return token.slice(0, -2);
  }
  if (token.length > 4 && token.endsWith("s")) {
    return token.slice(0, -1);
  }
  return token;
}

/**
 * Tests set equality.
 *
 * @param left - First string set.
 * @param right - Second string set.
 * @returns True when both sets contain exactly the same values.
 */
function setsEqual(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

/**
 * Converts match confidence to a sortable integer.
 *
 * @param confidence - Match confidence label.
 * @returns Rank where higher means more reliable.
 */
function confidenceRank(confidence: MatchConfidence): number {
  if (confidence === "verified") {
    return 3;
  }
  if (confidence === "probable") {
    return 2;
  }
  return 1;
}

/**
 * Finds an exact-market or event-family review decision for a candidate pair.
 *
 * @param overrides - Reviewed pair and family decisions.
 * @param kalshiMarket - Candidate Kalshi market.
 * @param polymarketMarket - Candidate Polymarket market.
 * @returns Matching override, when one exists.
 */
export function findPairOverride(
  overrides: readonly PairOverride[],
  kalshiMarket: SearchMarket,
  polymarketMarket: SearchMarket,
): PairOverride | undefined {
  const matching = overrides.filter(
    (override) =>
      (override.kalshiMarketId === "*" ||
        override.kalshiMarketId === kalshiMarket.marketId) &&
      (override.polymarketMarketId === "*" ||
        override.polymarketMarketId === polymarketMarket.marketId) &&
      (override.kalshiEventId === undefined ||
        override.kalshiEventId === kalshiMarket.eventId) &&
      (override.polymarketEventId === undefined ||
        override.polymarketEventId === polymarketMarket.eventId),
  );
  return (
    matching.find(
      (override) =>
        override.kalshiMarketId !== "*" && override.polymarketMarketId !== "*",
    ) ?? matching[0]
  );
}

/**
 * Detects explicit attributes that cannot describe the same outcome entity.
 *
 * @param left - First normalized token set.
 * @param right - Second normalized token set.
 * @returns True when each side contains a different member of an exclusive group.
 */
function hasMutuallyExclusiveTokens(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return mutuallyExclusiveTokenGroups.some((group) => {
    const leftMembers = [...group].filter((token) => left.has(token));
    const rightMembers = [...group].filter((token) => right.has(token));
    return (
      leftMembers.length > 0 &&
      rightMembers.length > 0 &&
      !leftMembers.some((token) => rightMembers.includes(token))
    );
  });
}
