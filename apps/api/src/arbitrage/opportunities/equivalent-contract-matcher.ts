import type {
  ArbitrageDirection,
  PairOverride,
  PairRelationshipClassification,
} from "../common/types.js";
import {
  compareNormalizedText,
  createPairId,
  normalizeMarketText,
} from "../discovery/matching.js";
import type { NormalizedMarketText } from "../discovery/matching.js";
import type {
  EquivalentContractCandidate,
  NativeBinaryMarket,
  OpportunityRelationship,
} from "./types.js";

const semanticPredicateGroups = new Map<string, string>([
  ["run", "run"],
  ["running", "run"],
  ["nominee", "nomination"],
  ["nomination", "nomination"],
  ["nominations", "nomination"],
  ["nominated", "nomination"],
  ["win", "win"],
  ["winner", "win"],
  ["ballot", "ballot"],
  ["finish", "finish"],
  ["place", "finish"],
  ["rank", "rank"],
  ["launch", "launch"],
  ["outperform", "outperform"],
  ["arrest", "arrest"],
  ["arrested", "arrest"],
  ["confirm", "confirm"],
  ["vote", "vote"],
  ["release", "release"],
  ["resign", "resign"],
  ["ceasefire", "ceasefire"],
  ["visit", "visit"],
  ["announce", "announce"],
  ["named", "named"],
  ["advisory", "travel_warning"],
  ["warning", "travel_warning"],
  ["case", "disease_case"],
  ["infection", "disease_case"],
  ["album", "album"],
  ["albums", "album"],
  ["song", "song"],
  ["songs", "song"],
  ["single", "song"],
  ["hit", "song"],
  ["pardon", "pardon"],
  ["pardoned", "pardon"],
  ["meet", "meet"],
  ["meeting", "meet"],
  ["underwrite", "underwrite"],
  ["underwriter", "underwrite"],
  ["inflation", "inflation"],
  ["unemployment", "unemployment"],
  ["coding", "coding"],
  ["nominal", "nominal"],
  ["growth", "growth"],
]);

const identityStopWords = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "before",
  "by",
  "election",
  "for",
  "from",
  "in",
  "is",
  "market",
  "no",
  "of",
  "on",
  "or",
  "the",
  "to",
  "will",
  "win",
  "winner",
  "yes",
]);

/** Controls for deterministic native-market candidate matching. */
export interface EquivalentContractMatchOptions {
  /** Minimum lexical similarity retained. */
  readonly minimumSimilarityPercent100: number;
  /** Minimum preliminary gross edge retained for direct books. */
  readonly minimumPreliminaryGrossEdgeDollarsPerShare: number;
  /** Maximum candidates receiving direct-book evaluation. */
  readonly maximumFreshBookPairs: number;
  /** Maximum retained candidates sharing one parent-event pair. */
  readonly maximumPairsPerEventPair: number;
  /** Current manual equivalence and rejection registry. */
  readonly pairOverrides?: readonly PairOverride[];
}

/** Matching counters and the bounded direct-book shortlist. */
export interface EquivalentContractMatchResult {
  /** Structurally compatible pairs before the price pre-screen. */
  readonly lexicalCandidateCount: number;
  /** Bounded candidates selected for fresh books. */
  readonly candidates: readonly EquivalentContractCandidate[];
}

/**
 * Finds equivalent-contract candidates using only deterministic text and cheap
 * catalog top quotes.
 *
 * @param markets - Normalized native venue catalogs.
 * @param options - Similarity, edge, and network-budget caps.
 * @returns Candidate count and bounded fresh-book shortlist.
 */
export function matchEquivalentContracts(
  markets: readonly NativeBinaryMarket[],
  options: EquivalentContractMatchOptions,
): EquivalentContractMatchResult {
  const kalshiMarkets = markets.filter((market) => market.venue === "kalshi");
  const polymarketMarkets = markets.filter(
    (market) => market.venue === "polymarket",
  );
  const polymarketById = new Map(
    polymarketMarkets.map((market) => [market.marketId, market]),
  );
  const normalizedPolymarket = new Map(
    polymarketMarkets.map((market) => [
      market.marketId,
      normalizeMarketText(buildMatchText(market)),
    ]),
  );
  const polymarketIdsByToken = new Map<string, string[]>();
  for (const market of polymarketMarkets) {
    for (const token of normalizedPolymarket.get(market.marketId)?.tokens ??
      []) {
      const marketIds = polymarketIdsByToken.get(token) ?? [];
      marketIds.push(market.marketId);
      polymarketIdsByToken.set(token, marketIds);
    }
  }

  const lexicalCandidates = new Map<string, EquivalentContractCandidate>();
  for (const kalshiMarket of kalshiMarkets) {
    const normalizedKalshi = normalizeMarketText(buildMatchText(kalshiMarket));
    const candidateIds = new Set<string>();
    const candidateTokens = [...normalizedKalshi.tokens]
      .map((token) => ({
        token,
        documentCount: polymarketIdsByToken.get(token)?.length ?? 0,
      }))
      .filter(({ documentCount }) => documentCount > 0 && documentCount <= 250)
      .sort((left, right) => left.documentCount - right.documentCount)
      .slice(0, 4);
    for (const { token } of candidateTokens) {
      for (const marketId of polymarketIdsByToken.get(token) ?? []) {
        candidateIds.add(marketId);
      }
    }
    for (const polymarketId of candidateIds) {
      const polymarketMarket = polymarketById.get(polymarketId);
      const normalizedPoly = normalizedPolymarket.get(polymarketId);
      if (!polymarketMarket || !normalizedPoly) {
        continue;
      }
      const override = findNativeOverride(
        options.pairOverrides ?? [],
        kalshiMarket,
        polymarketMarket,
      );
      const reviewedClassification = override
        ? classifyOverride(override)
        : undefined;
      if (reviewedClassification === "mismatch") {
        continue;
      }
      if (
        !semanticPredicatesAgree(
          kalshiMarket.question,
          polymarketMarket.question,
        ) ||
        !ordinalRanksAgree(kalshiMarket.question, polymarketMarket.question) ||
        !outcomeLabelsAgree(
          kalshiMarket.outcomeLabel,
          polymarketMarket.outcomeLabel,
        ) ||
        !distinctiveEntityCoverageAgrees(normalizedKalshi, normalizedPoly) ||
        !baseballStatisticsAgree(
          kalshiMarket.question,
          polymarketMarket.question,
        ) ||
        !officeRolesAgree(kalshiMarket.question, polymarketMarket.question) ||
        !jurisdictionsAgree(kalshiMarket.question, polymarketMarket.question) ||
        !competitionsAgree(kalshiMarket.question, polymarketMarket.question) ||
        !timeHorizonsAgree(kalshiMarket.question, polymarketMarket.question) ||
        !namedOrganizationsAgree(
          kalshiMarket.question,
          polymarketMarket.question,
        ) ||
        !cyclingClassificationsAgree(
          kalshiMarket.question,
          polymarketMarket.question,
        ) ||
        !partisanControlAssignmentsAgree(
          kalshiMarket.question,
          polymarketMarket.question,
        )
      ) {
        continue;
      }
      const comparison = compareNormalizedText(
        normalizedKalshi,
        normalizedPoly,
      );
      const eventComparison = compareNormalizedText(
        normalizeMarketText(kalshiMarket.eventTitle ?? kalshiMarket.question),
        normalizeMarketText(
          polymarketMarket.eventTitle ?? polymarketMarket.question,
        ),
      );
      const hasExplicitChildOutcomes =
        Boolean(kalshiMarket.outcomeLabel) &&
        Boolean(polymarketMarket.outcomeLabel);
      const hierarchicalScorePercent100 = hasExplicitChildOutcomes
        ? Math.round(eventComparison.scorePercent100 * 0.6 + 40)
        : 0;
      const similarityPercent100 = Math.max(
        comparison.scorePercent100,
        hasExplicitChildOutcomes ? eventComparison.scorePercent100 : 0,
        hierarchicalScorePercent100,
      );
      if (
        reviewedClassification === undefined &&
        similarityPercent100 < options.minimumSimilarityPercent100
      ) {
        continue;
      }
      const preliminary = calculatePreliminaryDirection(
        kalshiMarket,
        polymarketMarket,
      );
      if (!preliminary) {
        continue;
      }
      const pairId = createPairId(
        kalshiMarket.marketId,
        polymarketMarket.marketId,
      );
      const automaticSettlementRisks = detectSettlementRisks(
        kalshiMarket.description,
        polymarketMarket.description,
      );
      const relationship = toOpportunityRelationship(reviewedClassification);
      const settlementRisks = override
        ? (override.settlementRisks ??
          (relationship === "pure_arbitrage" ? [] : [override.note]))
        : automaticSettlementRisks;
      lexicalCandidates.set(pairId, {
        pairId,
        kalshi: kalshiMarket,
        polymarket: polymarketMarket,
        similarityPercent100:
          reviewedClassification === "pure_arbitrage" &&
          override?.kalshiMarketId !== "*" &&
          override?.polymarketMarketId !== "*"
            ? 100
            : similarityPercent100,
        preliminaryGrossEdgeDollarsPerShare:
          preliminary.grossEdgeDollarsPerShare,
        preliminaryDirection: preliminary.direction,
        matchReasons: [
          ...comparison.reasons,
          ...(similarityPercent100 > comparison.scorePercent100
            ? [
                `Parent-event plus child-outcome alignment raised the hierarchical score to ${similarityPercent100}`,
              ]
            : []),
          "Parent events align before candidate-specific child outcomes",
          ...(override ? [`Manual relationship review: ${override.note}`] : []),
          ...automaticSettlementRisks.map(
            (risk) => `Rule-risk signal: ${risk}`,
          ),
        ],
        relationship,
        settlementRisks,
      });
    }
  }

  for (const override of options.pairOverrides ?? []) {
    const reviewedClassification = classifyOverride(override);
    if (
      reviewedClassification === "mismatch" ||
      override.kalshiMarketId === "*" ||
      override.polymarketMarketId === "*"
    ) {
      continue;
    }
    const kalshiMarket = kalshiMarkets.find(
      (market) => market.marketId === override.kalshiMarketId,
    );
    const polymarketMarket = polymarketMarkets.find(
      (market) => market.marketId === override.polymarketMarketId,
    );
    if (!kalshiMarket || !polymarketMarket) {
      continue;
    }
    const preliminary = calculatePreliminaryDirection(
      kalshiMarket,
      polymarketMarket,
    );
    if (!preliminary) {
      continue;
    }
    const pairId = createPairId(
      kalshiMarket.marketId,
      polymarketMarket.marketId,
    );
    lexicalCandidates.set(pairId, {
      pairId,
      kalshi: kalshiMarket,
      polymarket: polymarketMarket,
      similarityPercent100: 100,
      preliminaryGrossEdgeDollarsPerShare: preliminary.grossEdgeDollarsPerShare,
      preliminaryDirection: preliminary.direction,
      matchReasons: [`Manual review: ${override.note}`],
      relationship: toOpportunityRelationship(reviewedClassification),
      settlementRisks:
        override.settlementRisks ??
        (reviewedClassification === "pure_arbitrage" ? [] : [override.note]),
    });
  }

  const priceEligible = [...lexicalCandidates.values()]
    .filter(
      (candidate) =>
        candidate.relationship === "pure_arbitrage" ||
        candidate.preliminaryGrossEdgeDollarsPerShare >=
          options.minimumPreliminaryGrossEdgeDollarsPerShare,
    )
    .sort((left, right) => {
      const reviewedDifference =
        relationshipPriority(right.relationship) -
        relationshipPriority(left.relationship);
      if (reviewedDifference !== 0) {
        return reviewedDifference;
      }
      const edgeDifference =
        right.preliminaryGrossEdgeDollarsPerShare -
        left.preliminaryGrossEdgeDollarsPerShare;
      return Math.abs(edgeDifference) > 1e-9
        ? edgeDifference
        : right.similarityPercent100 - left.similarityPercent100;
    });
  const reviewed = priceEligible.filter(
    (candidate) => candidate.relationship !== "unreviewed",
  );
  const provisionalByCategory = new Map<
    string,
    EquivalentContractCandidate[]
  >();
  for (const candidate of priceEligible) {
    if (candidate.relationship !== "unreviewed") {
      continue;
    }
    const queue = provisionalByCategory.get(candidate.kalshi.category) ?? [];
    queue.push(candidate);
    provisionalByCategory.set(candidate.kalshi.category, queue);
  }
  const provisionalQueues = [...provisionalByCategory.values()].sort(
    (left, right) =>
      (right[0]?.preliminaryGrossEdgeDollarsPerShare ?? 0) -
      (left[0]?.preliminaryGrossEdgeDollarsPerShare ?? 0),
  );
  const diversifiedProvisional: EquivalentContractCandidate[] = [];
  let provisionalRound = 0;
  while (provisionalQueues.some((queue) => provisionalRound < queue.length)) {
    for (const queue of provisionalQueues) {
      const candidate = queue[provisionalRound];
      if (candidate) {
        diversifiedProvisional.push(candidate);
      }
    }
    provisionalRound += 1;
  }
  const selected: EquivalentContractCandidate[] = [];
  const eventPairCounts = new Map<string, number>();
  for (const candidate of [...reviewed, ...diversifiedProvisional]) {
    const eventPair = `${candidate.kalshi.eventId}:${candidate.polymarket.eventId}`;
    const eventPairCount = eventPairCounts.get(eventPair) ?? 0;
    if (eventPairCount >= options.maximumPairsPerEventPair) {
      continue;
    }
    selected.push(candidate);
    eventPairCounts.set(eventPair, eventPairCount + 1);
    if (selected.length >= options.maximumFreshBookPairs) {
      break;
    }
  }
  return {
    lexicalCandidateCount: lexicalCandidates.size,
    candidates: selected,
  };
}

/**
 * Builds the text used for broad recall while retaining candidate outcome text.
 *
 * @param market - Native binary market.
 * @returns Combined proposition and outcome label.
 */
function buildMatchText(market: NativeBinaryMarket): string {
  return [market.eventTitle ?? "", market.question, market.outcomeLabel ?? ""]
    .filter(Boolean)
    .join(" ");
}

/**
 * Rejects pairs whose core action semantics differ, such as running versus
 * winning or winning versus appearing on a ballot.
 *
 * @param left - First proposition.
 * @param right - Second proposition.
 * @returns True when extracted predicate sets are equal.
 */
function semanticPredicatesAgree(left: string, right: string): boolean {
  const leftPredicates = extractSemanticPredicates(left);
  const rightPredicates = extractSemanticPredicates(right);
  return setsEqual(leftPredicates, rightPredicates);
}

/**
 * Rejects different ordinal outcomes such as second versus third place.
 *
 * @param left - First proposition.
 * @param right - Second proposition.
 * @returns True when explicit ordinal-rank sets agree.
 */
function ordinalRanksAgree(left: string, right: string): boolean {
  return setsEqual(extractOrdinalRanks(left), extractOrdinalRanks(right));
}

/**
 * Extracts common numeric and word ordinals used by ranked outcome markets.
 *
 * @param text - Contract proposition.
 * @returns Canonical rank numbers.
 */
function extractOrdinalRanks(text: string): ReadonlySet<string> {
  const canonical = text.toLocaleLowerCase("en-US");
  const ranks = new Set<string>();
  const patterns: readonly [string, RegExp][] = [
    ["1", /\b(?:1st|first|most|greatest|lead|leader)(?:-most)?\b/gu],
    ["2", /\b(?:2nd|second)(?:-most)?\b/gu],
    ["3", /\b(?:3rd|third)(?:-most)?\b/gu],
    ["4", /\b(?:4th|fourth)(?:-most)?\b/gu],
    ["5", /\b(?:5th|fifth)(?:-most)?\b/gu],
  ];
  for (const [rank, pattern] of patterns) {
    if (pattern.test(canonical)) {
      ranks.add(rank);
    }
  }
  return ranks;
}

/**
 * Extracts normalized action predicates from a proposition.
 *
 * @param text - Contract proposition.
 * @returns Hard semantic predicate set.
 */
function extractSemanticPredicates(text: string): ReadonlySet<string> {
  const tokens = text
    .toLocaleLowerCase("en-US")
    .replace(/\bhold(?:s|ing)?\s+(?:the\s+)?1st\s+seats?\b/gu, " win ")
    .replace(/[^a-z0-9]+/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
  const predicates = new Set<string>();
  for (const token of tokens) {
    const predicate = semanticPredicateGroups.get(token);
    if (predicate) {
      predicates.add(predicate);
    }
  }
  return predicates;
}

/**
 * Compares venue child-outcome labels to prevent different people or outcomes
 * under the same event from matching.
 *
 * @param left - Kalshi outcome label.
 * @param right - Polymarket outcome label.
 * @returns True when labels are absent or have strong token containment.
 */
function outcomeLabelsAgree(
  left: string | undefined,
  right: string | undefined,
): boolean {
  if (!left || !right) {
    return true;
  }
  const leftNumbers = outcomeLabelNumbers(left);
  const rightNumbers = outcomeLabelNumbers(right);
  if (!setsEqual(leftNumbers, rightNumbers)) {
    return false;
  }
  const leftNormalized = normalizeMarketText(left);
  const rightNormalized = normalizeMarketText(right);
  if (
    !setsEqual(
      leftNormalized.thresholdRelations,
      rightNormalized.thresholdRelations,
    ) ||
    !setsEqual(
      leftNormalized.logicalOperators,
      rightNormalized.logicalOperators,
    )
  ) {
    return false;
  }
  const leftTokens = identityTokens(left);
  const rightTokens = identityTokens(right);
  const leftParties = new Set(
    [...leftTokens].filter(
      (token) => token === "democratic" || token === "republican",
    ),
  );
  const rightParties = new Set(
    [...rightTokens].filter(
      (token) => token === "democratic" || token === "republican",
    ),
  );
  if (!setsEqual(leftParties, rightParties)) {
    return false;
  }
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return (
      leftTokens.size === 0 && rightTokens.size === 0 && leftNumbers.size > 0
    );
  }
  const unmatchedRight = new Set(rightTokens);
  let matchedCount = 0;
  for (const leftToken of leftTokens) {
    const matchingRight = [...unmatchedRight].find((rightToken) =>
      identityTokensApproximatelyEqual(leftToken, rightToken),
    );
    if (matchingRight) {
      matchedCount += 1;
      unmatchedRight.delete(matchingRight);
    }
  }
  return matchedCount / Math.max(leftTokens.size, rightTokens.size) >= 0.75;
}

/**
 * Extracts signed numeric values from a child outcome label.
 *
 * @param text - Candidate-specific child label.
 * @returns Canonical numeric strings used as hard outcome identity.
 */
function outcomeLabelNumbers(text: string): ReadonlySet<string> {
  return new Set(
    text.replace(/[−–—]/gu, "-").match(/[-+]?\d+(?:\.\d+)?%?/gu) ?? [],
  );
}

/**
 * Rejects a generic proposition paired to a specific named entity. Parent
 * markets remain eligible when the candidate outcome label supplies the entity.
 *
 * @param left - Normalized Kalshi proposition and child label.
 * @param right - Normalized Polymarket proposition and child label.
 * @returns True when both sides are either entity-specific or generic.
 */
function distinctiveEntityCoverageAgrees(
  left: NormalizedMarketText,
  right: NormalizedMarketText,
): boolean {
  return (
    (left.distinctiveTokens.size === 0) === (right.distinctiveTokens.size === 0)
  );
}

/**
 * Rejects baseball leader markets whose tracked statistics differ.
 *
 * @param left - Kalshi proposition.
 * @param right - Polymarket proposition.
 * @returns True when explicit baseball statistics are equal or absent.
 */
function baseballStatisticsAgree(left: string, right: string): boolean {
  const leftStatistic = extractBaseballStatistic(left);
  const rightStatistic = extractBaseballStatistic(right);
  return (
    leftStatistic === undefined ||
    rightStatistic === undefined ||
    leftStatistic === rightStatistic
  );
}

/**
 * Extracts common baseball counting-stat phrases in specificity order.
 *
 * @param text - Contract proposition.
 * @returns Canonical statistic when explicitly present.
 */
function extractBaseballStatistic(text: string): string | undefined {
  const canonical = text.toLocaleLowerCase("en-US");
  const statistics: readonly [string, RegExp][] = [
    ["home_runs", /\bhome runs?\b/u],
    ["runs_batted_in", /\b(?:runs batted in|rbis?)\b/u],
    ["stolen_bases", /\b(?:stolen bases?|steals?)\b/u],
    ["batting_average", /\bbatting average\b/u],
    ["on_base_plus_slugging", /\b(?:on-base plus slugging|ops)\b/u],
    ["earned_run_average", /\b(?:earned run average|era)\b/u],
    ["strikeouts", /\b(?:strikeouts?|strike out)\b/u],
    [
      "pitching_wins",
      /\b(?:pitching wins|wins for the .* regular season|in wins)\b/u,
    ],
    ["walks", /\bwalks?\b/u],
    ["doubles", /\bdoubles?\b/u],
    ["triples", /\btriples?\b/u],
    ["hits", /\bhits?\b/u],
    ["runs", /\bruns?\b/u],
  ];
  return statistics.find(([, pattern]) => pattern.test(canonical))?.[0];
}

/**
 * Detects rule clauses that can make otherwise aligned contracts settle
 * differently.
 *
 * @param leftRules - Kalshi archived settlement text.
 * @param rightRules - Polymarket archived settlement text.
 * @returns Concrete settlement-risk signals.
 */
function detectSettlementRisks(
  leftRules: string,
  rightRules: string,
): readonly string[] {
  const risks: string[] = [];
  const assumptionPattern =
    /\b(?:sworn in|swearing in|takes? office|inaugurat(?:ed|ion)|first person .* replacement)\b/iu;
  const splitPattern =
    /\b(?:proportional payout|split(?:s|ting)? (?:the )?payout|payout equally)\b|\$1\s*\/\s*n/iu;
  if (
    assumptionPattern.test(leftRules) !== assumptionPattern.test(rightRules)
  ) {
    risks.push(
      "One venue conditions settlement on taking office or being sworn in",
    );
  }
  if (splitPattern.test(leftRules) !== splitPattern.test(rightRules)) {
    risks.push(
      "One venue permits a split payout while the other uses a single winner",
    );
  }
  return risks;
}

/**
 * Normalizes identity-bearing outcome-label tokens.
 *
 * @param text - Candidate-specific label.
 * @returns Non-generic identity terms.
 */
function identityTokens(text: string): ReadonlySet<string> {
  const canonical = text
    .toLocaleLowerCase("en-US")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\b(?:first|1st)\b/gu, "1")
    .replace(/\b(?:second|2nd)\b/gu, "2")
    .replace(/\b(?:third|3rd)\b/gu, "3")
    .replace(/\b(?:fourth|4th)\b/gu, "4")
    .replace(/\b(?:fifth|5th)\b/gu, "5")
    .replace(/\bd(?=[-\s]+(?:house|senate))\b/gu, "democratic")
    .replace(/\br(?=[-\s]+(?:house|senate))\b/gu, "republican")
    .replace(/[^a-z0-9]+/gu, " ");
  return new Set(
    canonical
      .split(/\s+/u)
      .filter(
        (token) =>
          token.length > 1 &&
          !identityStopWords.has(token) &&
          !semanticPredicateGroups.has(token),
      ),
  );
}

/**
 * Rejects pairs that name different elected offices, such as presidential and
 * vice-presidential nominee markets.
 *
 * @param left - First proposition.
 * @param right - Second proposition.
 * @returns True when explicit office-role sets agree or one side is generic.
 */
function officeRolesAgree(left: string, right: string): boolean {
  const leftRoles = extractOfficeRoles(left);
  const rightRoles = extractOfficeRoles(right);
  return (
    leftRoles.size === 0 ||
    rightRoles.size === 0 ||
    setsEqual(leftRoles, rightRoles)
  );
}

/**
 * Extracts specific elected-office roles from a proposition.
 *
 * @param text - Contract proposition.
 * @returns Canonical office-role identifiers.
 */
function extractOfficeRoles(text: string): ReadonlySet<string> {
  const canonical = text.toLocaleLowerCase("en-US");
  const roles = new Set<string>();
  if (/\bvice[- ]president(?:ial)?\b/u.test(canonical)) {
    roles.add("vice_president");
  } else if (/\bpresiden(?:t(?:ial)?|cy)\b/u.test(canonical)) {
    roles.add("president");
  }
  const patterns: readonly [string, RegExp][] = [
    ["senate", /\bsenat(?:e|or|orial)\b/u],
    ["house", /\bhouse\b/u],
    ["governor", /\bgovernor\b/u],
    ["mayor", /\bmayor(?:al)?\b/u],
  ];
  for (const [role, pattern] of patterns) {
    if (pattern.test(canonical)) {
      roles.add(role);
    }
  }
  return roles;
}

/**
 * Rejects otherwise similar macro or political propositions tied to different
 * explicitly named countries.
 *
 * @param left - First proposition.
 * @param right - Second proposition.
 * @returns True when explicit jurisdiction sets agree or one side is generic.
 */
function jurisdictionsAgree(left: string, right: string): boolean {
  const leftJurisdictions = extractJurisdictions(left);
  const rightJurisdictions = extractJurisdictions(right);
  return (
    leftJurisdictions.size === 0 ||
    rightJurisdictions.size === 0 ||
    setsEqual(leftJurisdictions, rightJurisdictions)
  );
}

/**
 * Extracts common country jurisdictions from a proposition.
 *
 * @param text - Contract proposition.
 * @returns Canonical country identifiers.
 */
function extractJurisdictions(text: string): ReadonlySet<string> {
  const canonical = text.toLocaleLowerCase("en-US");
  const patterns: readonly [string, RegExp][] = [
    ["france", /\bfrance|french\b/u],
    ["germany", /\bgermany|german\b/u],
    ["italy", /\bitaly|italian\b/u],
    ["japan", /\bjapan|japanese\b/u],
    ["mexico", /\bmexico|mexican\b/u],
    ["uk", /\b(?:uk|united kingdom|british)\b/u],
    ["us", /\b(?:us|u\.s\.|united states|american)\b/u],
  ];
  return new Set(
    patterns
      .filter(([, pattern]) => pattern.test(canonical))
      .map(([jurisdiction]) => jurisdiction),
  );
}

/**
 * Rejects sports propositions that explicitly name different competitions.
 *
 * @param left - First proposition.
 * @param right - Second proposition.
 * @returns True when explicit competition sets agree or one side is generic.
 */
function competitionsAgree(left: string, right: string): boolean {
  const leftCompetitions = extractCompetitions(left);
  const rightCompetitions = extractCompetitions(right);
  return (
    leftCompetitions.size === 0 ||
    rightCompetitions.size === 0 ||
    setsEqual(leftCompetitions, rightCompetitions)
  );
}

/**
 * Rejects different explicit time granularities such as this week versus the
 * end of a month.
 *
 * @param left - First proposition.
 * @param right - Second proposition.
 * @returns True when explicit time horizons agree or one side is unspecified.
 */
function timeHorizonsAgree(left: string, right: string): boolean {
  const leftHorizons = extractTimeHorizons(left);
  const rightHorizons = extractTimeHorizons(right);
  return (
    leftHorizons.size === 0 ||
    rightHorizons.size === 0 ||
    setsEqual(leftHorizons, rightHorizons)
  );
}

/**
 * Extracts explicit relative or calendar horizon granularities.
 *
 * @param text - Contract proposition.
 * @returns Canonical time-horizon identifiers.
 */
function extractTimeHorizons(text: string): ReadonlySet<string> {
  const canonical = text.toLocaleLowerCase("en-US");
  const horizons = new Set<string>();
  const patterns: readonly [string, RegExp][] = [
    ["day", /\b(?:today|tomorrow|this day|daily)\b/u],
    ["week", /\b(?:this week|weekly)\b/u],
    [
      "month",
      /\b(?:this month|monthly|end of (?:january|february|march|april|may|june|july|august|september|october|november|december))\b/u,
    ],
    ["quarter", /\b(?:this quarter|quarterly|q[1-4])\b/u],
  ];
  for (const [horizon, pattern] of patterns) {
    if (pattern.test(canonical)) {
      horizons.add(horizon);
    }
  }
  return horizons;
}

/**
 * Rejects otherwise similar propositions that explicitly name different
 * high-signal companies or AI laboratories.
 *
 * @param left - First proposition.
 * @param right - Second proposition.
 * @returns True when explicit organization sets agree or one side is generic.
 */
function namedOrganizationsAgree(left: string, right: string): boolean {
  const leftOrganizations = extractNamedOrganizations(left);
  const rightOrganizations = extractNamedOrganizations(right);
  return (
    leftOrganizations.size === 0 ||
    rightOrganizations.size === 0 ||
    setsEqual(leftOrganizations, rightOrganizations)
  );
}

/**
 * Extracts common organizations that frequently distinguish otherwise
 * templated finance and technology markets.
 *
 * @param text - Contract proposition.
 * @returns Canonical organization identifiers.
 */
function extractNamedOrganizations(text: string): ReadonlySet<string> {
  const canonical = text.toLocaleLowerCase("en-US");
  const patterns: readonly [string, RegExp][] = [
    ["openai", /\bopenai\b/u],
    ["anthropic", /\banthropic\b/u],
    ["xai", /\bxai\b/u],
    ["meta", /\bmeta\b/u],
    ["google", /\bgoogle\b/u],
    ["microsoft", /\bmicrosoft\b/u],
    ["apple", /\bapple\b/u],
    ["amazon", /\bamazon\b/u],
    ["nvidia", /\bnvidia\b/u],
    ["tesla", /\btesla\b/u],
    ["spacex", /\bspacex\b/u],
    ["alibaba", /\balibaba\b/u],
    ["moonshot", /\bmoonshot\b/u],
    ["morgan_stanley", /\bmorgan stanley\b/u],
    ["goldman_sachs", /\bgoldman sachs\b/u],
  ];
  return new Set(
    patterns
      .filter(([, pattern]) => pattern.test(canonical))
      .map(([organization]) => organization),
  );
}

/**
 * Rejects Tour de France overall-winner markets paired with jersey-specific
 * classifications such as the young-rider white jersey.
 *
 * @param left - First proposition.
 * @param right - Second proposition.
 * @returns True when explicit cycling classifications agree.
 */
function cyclingClassificationsAgree(left: string, right: string): boolean {
  const leftClassifications = extractCyclingClassifications(left);
  const rightClassifications = extractCyclingClassifications(right);
  return (
    leftClassifications.size === 0 ||
    rightClassifications.size === 0 ||
    setsEqual(leftClassifications, rightClassifications)
  );
}

/**
 * Extracts common Tour de France classification prizes, treating a generic
 * race win as the overall/yellow-jersey classification.
 *
 * @param text - Contract proposition.
 * @returns Canonical cycling classifications.
 */
function extractCyclingClassifications(text: string): ReadonlySet<string> {
  const canonical = text.toLocaleLowerCase("en-US");
  if (!/\btour de france|jersey\b/u.test(canonical)) {
    return new Set();
  }
  const classifications = new Set<string>();
  const patterns: readonly [string, RegExp][] = [
    ["young_rider", /\b(?:white jersey|young rider)\b/u],
    ["points", /\b(?:green jersey|points classification)\b/u],
    ["mountains", /\b(?:polka dot jersey|mountains classification)\b/u],
    ["overall", /\b(?:yellow jersey|general classification|overall)\b/u],
  ];
  for (const [classification, pattern] of patterns) {
    if (pattern.test(canonical)) {
      classifications.add(classification);
    }
  }
  if (
    classifications.size === 0 &&
    /\bwin(?:s|ner)?\b.*\btour de france\b/u.test(canonical)
  ) {
    classifications.add("overall");
  }
  return classifications;
}

/**
 * Rejects compound congressional-control outcomes whose party-to-chamber
 * assignments are inverted.
 *
 * @param left - First proposition.
 * @param right - Second proposition.
 * @returns True when every explicit shared chamber has the same party.
 */
function partisanControlAssignmentsAgree(left: string, right: string): boolean {
  const leftAssignments = extractPartisanControlAssignments(left);
  const rightAssignments = extractPartisanControlAssignments(right);
  for (const chamber of ["house", "senate"] as const) {
    const leftParty = leftAssignments.get(chamber);
    const rightParty = rightAssignments.get(chamber);
    if (leftParty && rightParty && leftParty !== rightParty) {
      return false;
    }
  }
  return true;
}

/**
 * Extracts Democratic or Republican control assigned to House and Senate.
 *
 * @param text - Contract proposition.
 * @returns Chamber-to-party assignments.
 */
function extractPartisanControlAssignments(
  text: string,
): ReadonlyMap<"house" | "senate", "democratic" | "republican"> {
  const canonical = text
    .toLocaleLowerCase("en-US")
    .replace(/\brepublicans?\b/gu, "republican")
    .replace(/\bdemocrats?\b/gu, "democratic")
    .replace(/\br(?=\s+(?:house|senate))\b/gu, "republican")
    .replace(/\bd(?=\s+(?:house|senate))\b/gu, "democratic");
  const assignments = new Map<
    "house" | "senate",
    "democratic" | "republican"
  >();
  const segments = canonical.split(/\s*(?:,|;|\band\b)\s*/gu);
  for (const segment of segments) {
    const chamber = /\bhouse\b/u.test(segment)
      ? "house"
      : /\bsenate\b/u.test(segment)
        ? "senate"
        : undefined;
    const party = /\brepublican\b/u.test(segment)
      ? "republican"
      : /\bdemocratic\b/u.test(segment)
        ? "democratic"
        : undefined;
    if (chamber && party) {
      assignments.set(chamber, party);
    }
  }
  for (const chamber of ["house", "senate"] as const) {
    if (assignments.has(chamber)) {
      continue;
    }
    const partyBefore = new RegExp(
      `\\b(democratic|republican)\\b.{0,24}\\b${chamber}\\b`,
      "u",
    ).exec(canonical)?.[1];
    const chamberBefore = new RegExp(
      `\\b${chamber}\\b.{0,24}\\b(democratic|republican)\\b`,
      "u",
    ).exec(canonical)?.[1];
    const party = partyBefore ?? chamberBefore;
    if (party === "democratic" || party === "republican") {
      assignments.set(chamber, party);
    }
  }
  return assignments;
}

/**
 * Extracts common league and cup identities from a proposition.
 *
 * @param text - Contract proposition.
 * @returns Canonical competition identifiers.
 */
function extractCompetitions(text: string): ReadonlySet<string> {
  const canonical = text.toLocaleLowerCase("en-US");
  const patterns: readonly [string, RegExp][] = [
    ["bundesliga", /\bbundesliga\b/u],
    ["champions_league", /\b(?:uefa )?champions league\b/u],
    ["europa_league", /\b(?:uefa )?europa league\b/u],
    ["premier_league", /\bpremier league\b/u],
    ["serie_a", /\bserie a\b/u],
    ["la_liga", /\bla liga\b/u],
  ];
  return new Set(
    patterns
      .filter(([, pattern]) => pattern.test(canonical))
      .map(([competition]) => competition),
  );
}

/**
 * Compares identity tokens while allowing one small spelling variation, such
 * as Eisenkot versus Eizenkot.
 *
 * @param left - First normalized identity token.
 * @param right - Second normalized identity token.
 * @returns True for exact tokens or a tightly bounded edit-distance alias.
 */
function identityTokensApproximatelyEqual(
  left: string,
  right: string,
): boolean {
  if (left === right) {
    return true;
  }
  if (Math.min(left.length, right.length) < 5) {
    return false;
  }
  const maximumDistance = Math.max(left.length, right.length) >= 9 ? 2 : 1;
  return levenshteinDistanceWithin(left, right, maximumDistance);
}

/**
 * Checks whether two strings are within a maximum Levenshtein distance without
 * allocating a full edit matrix.
 *
 * @param left - First string.
 * @param right - Second string.
 * @param maximumDistance - Largest accepted edit distance.
 * @returns True when the edit distance does not exceed the bound.
 */
function levenshteinDistanceWithin(
  left: string,
  right: string,
  maximumDistance: number,
): boolean {
  if (Math.abs(left.length - right.length) > maximumDistance) {
    return false;
  }
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost =
        left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const value = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + substitutionCost,
      );
      current[rightIndex] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maximumDistance) {
      return false;
    }
    previous = current;
  }
  return (
    (previous[right.length] ?? Number.POSITIVE_INFINITY) <= maximumDistance
  );
}

/**
 * Computes the best cheap direction from catalog top quotes. These quotes only
 * prioritize direct-book requests and never establish final economics.
 *
 * @param kalshi - Kalshi candidate.
 * @param polymarket - Polymarket candidate.
 * @returns Best direction and gross edge when all four top quotes exist.
 */
function calculatePreliminaryDirection(
  kalshi: NativeBinaryMarket,
  polymarket: NativeBinaryMarket,
):
  | {
      readonly direction: ArbitrageDirection;
      readonly grossEdgeDollarsPerShare: number;
    }
  | undefined {
  const kalshiYes = kalshi.catalogYesAskDollars;
  const kalshiNo = kalshi.catalogNoAskDollars;
  const polymarketYes = polymarket.catalogYesAskDollars;
  const polymarketNo = polymarket.catalogNoAskDollars;
  if (
    kalshiYes === undefined ||
    kalshiNo === undefined ||
    polymarketYes === undefined ||
    polymarketNo === undefined
  ) {
    return undefined;
  }
  const kalshiYesCost = kalshiYes + polymarketNo;
  const polymarketYesCost = polymarketYes + kalshiNo;
  if (kalshiYesCost <= polymarketYesCost) {
    return {
      direction: { buyYesVenue: "kalshi", buyNoVenue: "polymarket" },
      grossEdgeDollarsPerShare: 1 - kalshiYesCost,
    };
  }
  return {
    direction: { buyYesVenue: "polymarket", buyNoVenue: "kalshi" },
    grossEdgeDollarsPerShare: 1 - polymarketYesCost,
  };
}

/**
 * Tests set equality.
 *
 * @param left - First set.
 * @param right - Second set.
 * @returns True when both sets contain the same strings.
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
 * Resolves the relationship encoded by a review while preserving legacy
 * `verified` decisions.
 *
 * @param override - Manual exact or event-family review.
 * @returns Explicit relationship classification.
 */
function classifyOverride(
  override: PairOverride,
): PairRelationshipClassification {
  if (override.classification) {
    return override.classification;
  }
  return override.verified ? "pure_arbitrage" : "mismatch";
}

/**
 * Converts a reviewed relationship to the opportunity-domain relationship.
 *
 * @param classification - Optional manual relationship classification.
 * @returns API-facing relationship, or unreviewed when no review exists.
 */
function toOpportunityRelationship(
  classification: PairRelationshipClassification | undefined,
): OpportunityRelationship {
  if (classification === undefined || classification === "mismatch") {
    return "unreviewed";
  }
  return classification;
}

/**
 * Ranks reviewed relationships ahead of provisional lexical candidates while
 * preserving pure-arbitrage priority.
 *
 * @param relationship - Candidate relationship.
 * @returns Numeric sort priority.
 */
function relationshipPriority(relationship: OpportunityRelationship): number {
  switch (relationship) {
    case "pure_arbitrage":
      return 4;
    case "near_arbitrage":
      return 3;
    case "relative_value":
      return 2;
    case "unreviewed":
      return 1;
  }
}

/**
 * Finds an exact or event-family review for native markets.
 *
 * @param overrides - Current review registry.
 * @param kalshi - Candidate Kalshi market.
 * @param polymarket - Candidate Polymarket market.
 * @returns Matching review when present.
 */
function findNativeOverride(
  overrides: readonly PairOverride[],
  kalshi: NativeBinaryMarket,
  polymarket: NativeBinaryMarket,
): PairOverride | undefined {
  const matching = overrides.filter(
    (override) =>
      (override.kalshiMarketId === "*" ||
        override.kalshiMarketId === kalshi.marketId) &&
      (override.polymarketMarketId === "*" ||
        override.polymarketMarketId === polymarket.marketId) &&
      (override.kalshiEventId === undefined ||
        override.kalshiEventId === kalshi.eventId) &&
      (override.polymarketEventId === undefined ||
        override.polymarketEventId === polymarket.eventId),
  );
  return (
    matching.find(
      (override) =>
        override.kalshiMarketId !== "*" && override.polymarketMarketId !== "*",
    ) ?? matching[0]
  );
}
