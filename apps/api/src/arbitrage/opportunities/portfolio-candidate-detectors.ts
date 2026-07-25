import { createHash } from "node:crypto";

import type {
  EquivalentContractCandidate,
  NativeBinaryMarket,
  PortfolioCandidate,
  PortfolioCandidateLeg,
} from "./types.js";

const proofVersion = "portfolio-proof-v2";
const maximumCandidatesPerFamily = 2;
const maximumOutcomePoolLegs = 24;

/** Result of every deterministic portfolio detector over one catalog snapshot. */
export interface PortfolioDetectionResult {
  /** Proof-backed candidates before the shared direct-book shortlist. */
  readonly candidates: readonly PortfolioCandidate[];
  /** Candidate counts retained by implemented strategy. */
  readonly countsByStrategy: Readonly<
    Record<PortfolioCandidate["strategy"], number>
  >;
}

/** Parsed comparable monotone proposition. */
interface MonotoneProposition {
  /** Proof family. */
  readonly kind: "threshold" | "deadline";
  /** Comparable scalar; dollars/bps retain their source unit. */
  readonly value: number;
  /** Whether a larger scalar makes the proposition stricter. */
  readonly largerIsStricter: boolean;
  /** Exact normalized rule skeleton with only the scalar removed. */
  readonly signature: string;
}

/**
 * Runs all currently viable portfolio detectors without network access.
 *
 * @param markets - One shared current native catalog.
 * @param equivalentCandidates - Existing cross-venue child matches.
 * @returns Deduplicated proof-backed candidates and audit counts.
 */
export function detectPortfolioCandidates(
  markets: readonly NativeBinaryMarket[],
  equivalentCandidates: readonly EquivalentContractCandidate[],
): PortfolioDetectionResult {
  const routed = detectRoutedMultiOutcomeCandidates(equivalentCandidates);
  const venuePools = detectVenueMutuallyExclusiveCandidates(markets);
  const dominance = detectDominanceCandidates(markets);
  const compound = detectCompoundUpperBoundCandidates(markets);
  const candidates = [
    ...new Map(
      [...routed, ...venuePools, ...dominance, ...compound].map((candidate) => [
        candidate.opportunityId,
        candidate,
      ]),
    ).values(),
  ].sort(comparePreliminaryEdge);
  return {
    candidates,
    countsByStrategy: {
      routed_multi_outcome: routed.length + venuePools.length,
      threshold_deadline_dominance: dominance.length,
      compound_upper_bound: compound.length,
    },
  };
}

/**
 * Builds cross-venue NO baskets from complete one-to-one matched mutex groups.
 *
 * @param matches - Existing deterministic child-market matches.
 * @returns Routed candidates using the cheapest catalog route for each outcome.
 */
export function detectRoutedMultiOutcomeCandidates(
  matches: readonly EquivalentContractCandidate[],
): readonly PortfolioCandidate[] {
  const groups = groupBy(
    matches.filter(
      (match) =>
        isVenueProvenMutex(match.kalshi) &&
        isVenueProvenMutex(match.polymarket) &&
        Boolean(match.kalshi.outcomeLabel) &&
        Boolean(match.polymarket.outcomeLabel),
    ),
    (match) => `${match.kalshi.eventId}:${match.polymarket.eventId}`,
  );
  const candidates: PortfolioCandidate[] = [];
  for (const family of groups.values()) {
    const kalshiEventSize = family.filter(
      (match, index, values) =>
        values.findIndex(
          (candidate) => candidate.kalshi.marketId === match.kalshi.marketId,
        ) === index,
    ).length;
    const polymarketEventSize = family.filter(
      (match, index, values) =>
        values.findIndex(
          (candidate) =>
            candidate.polymarket.marketId === match.polymarket.marketId,
        ) === index,
    ).length;
    if (
      family.length < 2 ||
      family.length !== kalshiEventSize ||
      family.length !== polymarketEventSize ||
      family.length > 24
    ) {
      continue;
    }
    const outcomeKeys = family.map((match) =>
      normalizeOutcomeKey(match.kalshi.outcomeLabel ?? ""),
    );
    if (
      new Set(outcomeKeys).size !== family.length ||
      family.some(
        (match, index) =>
          normalizeOutcomeKey(match.polymarket.outcomeLabel ?? "") !==
          outcomeKeys[index],
      )
    ) {
      continue;
    }
    const legs = family.map((match, index) => {
      const kalshiCost = match.kalshi.catalogNoAskDollars ?? Infinity;
      const polymarketCost = match.polymarket.catalogNoAskDollars ?? Infinity;
      const market =
        kalshiCost <= polymarketCost ? match.kalshi : match.polymarket;
      return {
        market,
        side: "no" as const,
        outcomeKey: outcomeKeys[index] ?? market.marketId,
      };
    });
    if (legs.some((leg) => !Number.isFinite(catalogAsk(leg)))) {
      continue;
    }
    const minimumPayoutDollarsPerShare = legs.length - 1;
    const preliminaryGrossEdgeDollarsPerShare =
      minimumPayoutDollarsPerShare -
      legs.reduce((total, leg) => total + catalogAsk(leg), 0);
    if (preliminaryGrossEdgeDollarsPerShare <= 0) {
      continue;
    }
    const relationship = family.every(
      (match) => match.relationship === "pure_arbitrage",
    )
      ? "pure_arbitrage"
      : "unreviewed";
    candidates.push({
      opportunityId: createRoutedPoolId(family, outcomeKeys),
      strategy: "routed_multi_outcome",
      title:
        family[0]?.kalshi.eventTitle ??
        family[0]?.polymarket.eventTitle ??
        "Routed mutually exclusive outcomes",
      category: family[0]?.kalshi.category ?? "other",
      proofKind: "mutually_exclusive_pool",
      proofSummary: `At most one of ${legs.length} matched outcomes can settle Yes, so buying No on every outcome pays at least $${minimumPayoutDollarsPerShare.toFixed(2)} per bundle.`,
      proofVersion,
      legs,
      minimumPayoutDollarsPerShare,
      preliminaryGrossEdgeDollarsPerShare,
      relationship,
      settlementRisks:
        relationship === "pure_arbitrage"
          ? []
          : ["Cross-venue outcome equivalence has not been manually verified."],
      matchReasons: family.flatMap((match) => match.matchReasons).slice(0, 8),
      similarityPercent100: Math.min(
        ...family.map((match) => match.similarityPercent100),
      ),
    });
  }
  return candidates.sort(comparePreliminaryEdge).slice(0, 6);
}

/**
 * Builds Yes baskets from complete standard Polymarket outcome sets.
 *
 * @param markets - Shared current native catalog.
 * @returns Highest-edge event pools using only provider-proven relationships.
 */
export function detectVenueMutuallyExclusiveCandidates(
  markets: readonly NativeBinaryMarket[],
): readonly PortfolioCandidate[] {
  const families = groupBy(
    markets.filter(isVenueProvenMutex),
    (market) => `${market.venue}:${market.eventId}`,
  );
  const candidates: PortfolioCandidate[] = [];
  for (const family of families.values()) {
    const first = family[0];
    if (!first) {
      continue;
    }
    if (
      family.length > maximumOutcomePoolLegs ||
      family.some(
        (market) =>
          market.venue !== "polymarket" ||
          market.negativeRisk !== true ||
          market.negativeRiskAugmented !== false ||
          market.eventOutcomeSetComplete !== true ||
          market.catalogYesAskDollars === undefined,
      )
    ) {
      continue;
    }
    const exhaustiveLegs = [...family]
      .sort((left, right) =>
        left.marketId.localeCompare(right.marketId, "en-US"),
      )
      .map((market) => ({
        market,
        side: "yes" as const,
        outcomeKey: normalizeOutcomeKey(market.outcomeLabel ?? market.question),
      }));
    const exhaustiveEdgeDollarsPerShare =
      1 - exhaustiveLegs.reduce((total, leg) => total + catalogAsk(leg), 0);
    if (exhaustiveEdgeDollarsPerShare <= 0) {
      continue;
    }
    candidates.push({
      opportunityId: createPortfolioId(
        "routed_multi_outcome",
        "exhaustive_outcome_pool",
        exhaustiveLegs,
      ),
      strategy: "routed_multi_outcome",
      title: first.eventTitle ?? first.question,
      category: first.category,
      proofKind: "exhaustive_outcome_pool",
      proofSummary: `Polymarket confirms this standard negative-risk event contains exactly these ${exhaustiveLegs.length} active outcomes, so buying Yes on every outcome pays exactly $1.00 per bundle.`,
      proofVersion,
      legs: exhaustiveLegs,
      minimumPayoutDollarsPerShare: 1,
      preliminaryGrossEdgeDollarsPerShare: exhaustiveEdgeDollarsPerShare,
      relationship: "pure_arbitrage",
      settlementRisks: [],
      matchReasons: [
        "Polymarket explicitly marks the parent event as standard negative risk.",
        "The full provider event has no inactive or omitted child markets.",
        "Augmented negative-risk events and hidden placeholders are excluded.",
      ],
      similarityPercent100: 100,
    });
  }
  return candidates.sort(comparePreliminaryEdge).slice(0, 24);
}

/**
 * Finds same-event threshold and terminal-deadline implications.
 *
 * @param markets - Shared native catalog.
 * @returns Bounded candidates selected with a linear family sweep.
 */
export function detectDominanceCandidates(
  markets: readonly NativeBinaryMarket[],
): readonly PortfolioCandidate[] {
  const parsed = markets.flatMap((market) => {
    const proposition = parseMonotoneProposition(market);
    return proposition ? [{ market, proposition }] : [];
  });
  const families = groupBy(
    parsed,
    ({ market, proposition }) =>
      `${market.venue}:${proposition.kind}:${proposition.signature}:${proposition.largerIsStricter}`,
  );
  const candidates: PortfolioCandidate[] = [];
  for (const family of families.values()) {
    const ordered = [...family].sort(
      (left, right) => left.proposition.value - right.proposition.value,
    );
    const familyCandidates: PortfolioCandidate[] = [];
    for (let index = 0; index < ordered.length; index += 1) {
      const current = ordered[index];
      if (!current) {
        continue;
      }
      const possible = current.proposition.largerIsStricter
        ? ordered.slice(0, index)
        : ordered.slice(index + 1);
      const permissive = possible
        .filter((item) => item.proposition.value !== current.proposition.value)
        .sort(
          (left, right) =>
            (left.market.catalogYesAskDollars ?? Infinity) -
            (right.market.catalogYesAskDollars ?? Infinity),
        )[0];
      if (!permissive) {
        continue;
      }
      const restrictive = current;
      if (
        !restrictive ||
        restrictive.market.marketId === permissive.market.marketId
      ) {
        continue;
      }
      const legs: readonly PortfolioCandidateLeg[] = [
        {
          market: restrictive.market,
          side: "no",
          outcomeKey: "restrictive",
        },
        {
          market: permissive.market,
          side: "yes",
          outcomeKey: "permissive",
        },
      ];
      const preliminaryGrossEdgeDollarsPerShare =
        1 - legs.reduce((total, leg) => total + catalogAsk(leg), 0);
      if (preliminaryGrossEdgeDollarsPerShare <= 0) {
        continue;
      }
      const proofKind =
        restrictive.proposition.kind === "deadline"
          ? "deadline_implication"
          : "threshold_implication";
      familyCandidates.push({
        opportunityId: createPortfolioId(
          "threshold_deadline_dominance",
          proofKind,
          legs,
        ),
        strategy: "threshold_deadline_dominance",
        title: restrictive.market.eventTitle ?? restrictive.market.question,
        category: restrictive.market.category,
        proofKind,
        proofSummary: `"${restrictive.market.question}" implies "${permissive.market.question}"; No on the restrictive contract plus Yes on the permissive contract pays at least $1.00.`,
        proofVersion,
        legs,
        minimumPayoutDollarsPerShare: 1,
        preliminaryGrossEdgeDollarsPerShare,
        relationship: "pure_arbitrage",
        settlementRisks: [],
        matchReasons: [
          "Same venue with archived rule text matching except for one monotone scalar.",
          "Archived rule skeletons differ only by a monotone threshold or terminal deadline.",
        ],
        similarityPercent100: 100,
      });
    }
    candidates.push(
      ...familyCandidates
        .sort(comparePreliminaryEdge)
        .slice(0, maximumCandidatesPerFamily),
    );
  }
  return candidates.sort(comparePreliminaryEdge).slice(0, 24);
}

/**
 * Finds explicit Polymarket compounds whose archived rules contain a live
 * constituent contract verbatim.
 *
 * @param markets - Shared native catalog.
 * @returns Proven two-leg compound upper-bound candidates.
 */
export function detectCompoundUpperBoundCandidates(
  markets: readonly NativeBinaryMarket[],
): readonly PortfolioCandidate[] {
  const byEvent = groupBy(
    markets.filter((market) => market.venue === "polymarket"),
    (market) => market.eventId,
  );
  const candidates: PortfolioCandidate[] = [];
  for (const compound of markets) {
    if (
      compound.venue !== "polymarket" ||
      !/combined outcome/iu.test(compound.description)
    ) {
      continue;
    }
    const linkedSlugs = [
      ...compound.description.matchAll(
        /polymarket\.com\/event\/([^?)\s/]+)/giu,
      ),
    ].flatMap((match) => (match[1] ? [match[1]] : []));
    for (const slug of linkedSlugs) {
      for (const component of byEvent.get(slug) ?? []) {
        const label = normalizeOutcomeKey(component.outcomeLabel ?? "");
        if (
          !component.description.trim() ||
          !compound.description.includes(component.description.trim()) ||
          label.length < 3 ||
          !normalizeOutcomeKey(compound.question).includes(label)
        ) {
          continue;
        }
        const legs: readonly PortfolioCandidateLeg[] = [
          { market: compound, side: "no", outcomeKey: "compound" },
          { market: component, side: "yes", outcomeKey: label },
        ];
        const preliminaryGrossEdgeDollarsPerShare =
          1 - legs.reduce((total, leg) => total + catalogAsk(leg), 0);
        if (preliminaryGrossEdgeDollarsPerShare <= 0) {
          continue;
        }
        candidates.push({
          opportunityId: createPortfolioId(
            "compound_upper_bound",
            "compound_implies_component",
            legs,
          ),
          strategy: "compound_upper_bound",
          title: compound.question,
          category: compound.category,
          proofKind: "compound_implies_component",
          proofSummary: `The archived compound rules contain the "${component.outcomeLabel ?? component.question}" constituent rules verbatim, so the compound implies the constituent.`,
          proofVersion,
          legs,
          minimumPayoutDollarsPerShare: 1,
          preliminaryGrossEdgeDollarsPerShare,
          relationship: "pure_arbitrage",
          settlementRisks: [],
          matchReasons: [
            "Explicit combined-outcome declaration.",
            "Linked active constituent event.",
            "Constituent archived rules are an exact substring of the compound rules.",
          ],
          similarityPercent100: 100,
        });
      }
    }
  }
  return candidates.sort(comparePreliminaryEdge).slice(0, 8);
}

/**
 * Parses safe same-family thresholds or terminal occurrence deadlines.
 *
 * @param market - Native contract and archived rules.
 * @returns Comparable proposition, or undefined for ambiguous text.
 */
function parseMonotoneProposition(
  market: NativeBinaryMarket,
): MonotoneProposition | undefined {
  const source = `${market.question}\n${market.description}`;
  const thresholdPattern =
    /\b(at least|above|greater than|over|below|less than|under|at most)\s+\$?(\d+(?:\.\d+)?)\s*(%|percent|bps?|basis points?|dollars?|usd|inches?|degrees?)?/giu;
  const thresholdMatches = [...source.matchAll(thresholdPattern)];
  const thresholdValues = new Set(thresholdMatches.map((match) => match[2]));
  const thresholdDirections = new Set(
    thresholdMatches.map((match) =>
      ["at least", "above", "greater than", "over"].includes(
        match[1]?.toLocaleLowerCase("en-US") ?? "",
      )
        ? "upper"
        : "lower",
    ),
  );
  if (
    thresholdMatches.length > 0 &&
    thresholdValues.size === 1 &&
    thresholdDirections.size === 1
  ) {
    const match = thresholdMatches[0];
    const relation = match?.[1]?.toLocaleLowerCase("en-US") ?? "";
    const value = Number(match?.[2]);
    const unit = (match?.[3] ?? "").toLocaleLowerCase("en-US");
    const largerIsStricter = [
      "at least",
      "above",
      "greater than",
      "over",
    ].includes(relation);
    return {
      kind: "threshold",
      value,
      largerIsStricter,
      signature: normalizeProofSkeleton(
        source.replace(
          thresholdPattern,
          (_full, parsedRelation: string, _value: string, parsedUnit = "") =>
            `${parsedRelation.toLocaleLowerCase("en-US")} <value> ${String(parsedUnit).toLocaleLowerCase("en-US")}`,
        ),
      ),
    };
  }
  const deadlineMatches = [
    ...source.matchAll(
      /\b(by|before)\s+((?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,\s*|\s+)\d{4})\b/giu,
    ),
  ];
  const deadlineValues = new Set(deadlineMatches.map((match) => match[2]));
  if (deadlineMatches.length > 0 && deadlineValues.size === 1) {
    const match = deadlineMatches[0];
    const value = Date.parse(match?.[2] ?? "");
    if (
      Number.isFinite(value) &&
      /\b(?:occur|announce|reach|visit|meet|sign|release|retire|leave|confirm|review)\b/iu.test(
        source,
      )
    ) {
      return {
        kind: "deadline",
        value,
        largerIsStricter: false,
        signature: normalizeProofSkeleton(
          source.replace(
            /\b(by|before)\s+((?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,\s*|\s+)\d{4})\b/giu,
            (_full, connector: string) =>
              `${connector.toLocaleLowerCase("en-US")} <deadline>`,
          ),
        ),
      };
    }
  }
  return undefined;
}

/**
 * Returns whether provider metadata proves at-most-one settlement.
 *
 * @param market - Native market.
 * @returns True only for explicit venue flags.
 */
function isVenueProvenMutex(market: NativeBinaryMarket): boolean {
  return market.eventMutuallyExclusive === true || market.negativeRisk === true;
}

/**
 * Returns the catalog ask for one candidate leg.
 *
 * @param leg - Candidate market and purchased side.
 * @returns Ask price or positive infinity when unavailable.
 */
function catalogAsk(leg: PortfolioCandidateLeg): number {
  return leg.side === "yes"
    ? (leg.market.catalogYesAskDollars ?? Infinity)
    : (leg.market.catalogNoAskDollars ?? Infinity);
}

/**
 * Creates an ID for a routed pool that survives a cheapest-venue route change.
 *
 * @param family - One-to-one cross-venue outcome matches.
 * @param outcomeKeys - Canonical outcome identities.
 * @returns Short SHA-256 identifier.
 */
function createRoutedPoolId(
  family: readonly EquivalentContractCandidate[],
  outcomeKeys: readonly string[],
): string {
  const first = family[0];
  const identity = [
    "routed_multi_outcome",
    "mutually_exclusive_pool",
    `kalshi:${first?.kalshi.eventId ?? ""}`,
    `polymarket:${first?.polymarket.eventId ?? ""}`,
    ...[...outcomeKeys].sort(),
  ].join("|");
  return createHash("sha256").update(identity).digest("hex").slice(0, 20);
}

/**
 * Creates an ID stable for a fixed set of portfolio legs.
 *
 * @param strategy - Producing strategy.
 * @param proofKind - Deterministic proof family.
 * @param legs - Canonical outcome legs.
 * @returns Short SHA-256 identifier.
 */
function createPortfolioId(
  strategy: PortfolioCandidate["strategy"],
  proofKind: PortfolioCandidate["proofKind"],
  legs: readonly PortfolioCandidateLeg[],
): string {
  const identity = [
    strategy,
    proofKind,
    ...legs
      .map((leg) => `${leg.outcomeKey}:${leg.side}:${leg.market.marketId}`)
      .sort(),
  ].join("|");
  return createHash("sha256").update(identity).digest("hex").slice(0, 20);
}

/**
 * Normalizes an outcome label for exact one-to-one alignment.
 *
 * @param value - Venue label or question.
 * @returns Lowercase alphanumeric identity.
 */
function normalizeOutcomeKey(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9.%]+/gu, " ")
    .trim();
}

/**
 * Normalizes archived rules while preserving every non-scalar clause.
 *
 * @param value - Rules with one parsed scalar replaced.
 * @returns Exact comparison signature.
 */
function normalizeProofSkeleton(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Groups values by a deterministic string key.
 *
 * @param values - Input values.
 * @param getKey - Key selector.
 * @returns Ordered groups.
 */
function groupBy<T>(
  values: readonly T[],
  getKey: (value: T) => string,
): ReadonlyMap<string, readonly T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = getKey(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

/**
 * Sorts the highest preliminary edge first.
 *
 * @param left - First candidate.
 * @param right - Second candidate.
 * @returns Numeric sort order.
 */
function comparePreliminaryEdge(
  left: PortfolioCandidate,
  right: PortfolioCandidate,
): number {
  return (
    right.preliminaryGrossEdgeDollarsPerShare -
    left.preliminaryGrossEdgeDollarsPerShare
  );
}
