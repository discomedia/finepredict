import { describe, expect, it } from "vitest";

import type {
  EquivalentContractCandidate,
  NativeBinaryMarket,
} from "./types.js";
import {
  detectCompoundUpperBoundCandidates,
  detectDominanceCandidates,
  detectRoutedMultiOutcomeCandidates,
  detectVenueMutuallyExclusiveCandidates,
} from "./portfolio-candidate-detectors.js";

/**
 * Creates one concise native market fixture.
 *
 * @param overrides - Fields changed by the test.
 * @returns Complete native market.
 */
function market(
  overrides: Partial<NativeBinaryMarket> &
    Pick<NativeBinaryMarket, "venue" | "marketId" | "eventId" | "question">,
): NativeBinaryMarket {
  return {
    description: overrides.question,
    category: "politics",
    status: "active",
    minimumOrderSizeShares: 1,
    volume: 0,
    liquidity: 0,
    ...overrides,
  };
}

describe("portfolio candidate detectors", () => {
  it("proves a same-event monotone threshold implication", () => {
    const rules = (value: number) =>
      `If the close price is above ${value} USD, then the market resolves to Yes.`;
    const candidates = detectDominanceCandidates([
      market({
        venue: "kalshi",
        marketId: "HIGH",
        eventId: "PRICE",
        question: "Will the close price be above 100 USD?",
        description: rules(100),
        catalogNoAskDollars: 0.2,
      }),
      market({
        venue: "kalshi",
        marketId: "LOW",
        eventId: "PRICE",
        question: "Will the close price be above 90 USD?",
        description: rules(90),
        catalogYesAskDollars: 0.7,
      }),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      strategy: "threshold_deadline_dominance",
      proofKind: "threshold_implication",
      minimumPayoutDollarsPerShare: 1,
    });
    expect(
      candidates[0]?.legs.map((leg) => [leg.market.marketId, leg.side]),
    ).toEqual([
      ["HIGH", "no"],
      ["LOW", "yes"],
    ]);
  });

  it("routes mutually exclusive matched outcomes only with venue proof flags", () => {
    const buildMatch = (
      outcome: string,
      kalshiNo: number,
      polymarketNo: number,
    ): EquivalentContractCandidate => ({
      pairId: outcome,
      kalshi: market({
        venue: "kalshi",
        marketId: `K-${outcome}`,
        eventId: "K-EVENT",
        question: outcome,
        outcomeLabel: outcome,
        eventMutuallyExclusive: true,
        catalogNoAskDollars: kalshiNo,
      }),
      polymarket: market({
        venue: "polymarket",
        marketId: `P-${outcome}`,
        eventId: "p-event",
        question: outcome,
        outcomeLabel: outcome,
        negativeRisk: true,
        catalogNoAskDollars: polymarketNo,
      }),
      similarityPercent100: 100,
      preliminaryGrossEdgeDollarsPerShare: 0,
      preliminaryDirection: {
        buyYesVenue: "kalshi",
        buyNoVenue: "polymarket",
      },
      matchReasons: ["Exact outcome label"],
      relationship: "pure_arbitrage",
      settlementRisks: [],
    });
    const candidates = detectRoutedMultiOutcomeCandidates([
      buildMatch("Democratic", 0.7, 0.61),
      buildMatch("Republican", 0.31, 0.4),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.legs.map((leg) => leg.market.marketId)).toEqual([
      "P-Democratic",
      "K-Republican",
    ]);
    expect(candidates[0]?.preliminaryGrossEdgeDollarsPerShare).toBeCloseTo(
      0.08,
    );

    const reroutedCandidates = detectRoutedMultiOutcomeCandidates([
      buildMatch("Democratic", 0.6, 0.61),
      buildMatch("Republican", 0.4, 0.31),
    ]);
    expect(
      reroutedCandidates[0]?.legs.map((leg) => leg.market.marketId),
    ).toEqual(["K-Democratic", "P-Republican"]);
    expect(reroutedCandidates[0]?.opportunityId).toBe(
      candidates[0]?.opportunityId,
    );
  });

  it("builds a Yes basket only from a verified standard complete outcome set", () => {
    const markets = [
      market({
        venue: "polymarket",
        marketId: "A",
        eventId: "WINNER",
        question: "Will A win?",
        outcomeLabel: "A",
        negativeRisk: true,
        negativeRiskAugmented: false,
        eventOutcomeSetComplete: true,
        catalogYesAskDollars: 0.4,
      }),
      market({
        venue: "polymarket",
        marketId: "B",
        eventId: "WINNER",
        question: "Will B win?",
        outcomeLabel: "B",
        negativeRisk: true,
        negativeRiskAugmented: false,
        eventOutcomeSetComplete: true,
        catalogYesAskDollars: 0.5,
      }),
    ];

    const candidates = detectVenueMutuallyExclusiveCandidates(markets);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      strategy: "routed_multi_outcome",
      proofKind: "exhaustive_outcome_pool",
      minimumPayoutDollarsPerShare: 1,
    });
    expect(candidates[0]?.preliminaryGrossEdgeDollarsPerShare).toBeCloseTo(0.1);
    expect(candidates[0]?.legs.every((leg) => leg.side === "yes")).toBe(true);
    expect(
      detectVenueMutuallyExclusiveCandidates(
        markets.map((item) => ({
          ...item,
          negativeRiskAugmented: true,
          eventOutcomeSetComplete: false,
        })),
      ),
    ).toEqual([]);
  });

  it("proves monotone implications across provider event records", () => {
    const rules = (value: number) =>
      `If the close price is above ${value} USD, then the market resolves to Yes.`;
    const candidates = detectDominanceCandidates([
      market({
        venue: "kalshi",
        marketId: "HIGH",
        eventId: "PRICE-HIGH",
        question: "Will the close price be above 100 USD?",
        description: rules(100),
        catalogNoAskDollars: 0.2,
      }),
      market({
        venue: "kalshi",
        marketId: "LOW",
        eventId: "PRICE-LOW",
        question: "Will the close price be above 90 USD?",
        description: rules(90),
        catalogYesAskDollars: 0.7,
      }),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.proofKind).toBe("threshold_implication");
  });

  it("finds only explicit compound rules containing a constituent verbatim", () => {
    const componentRules =
      "This market resolves Yes if Republicans control the House.";
    const component = market({
      venue: "polymarket",
      marketId: "HOUSE",
      eventId: "house-winner",
      question: "Which party controls the House?",
      outcomeLabel: "Republican",
      description: componentRules,
      catalogYesAskDollars: 0.15,
    });
    const compound = market({
      venue: "polymarket",
      marketId: "COMPOUND",
      eventId: "compound",
      question: "Will ACA credits lapse and Republican win the House?",
      description: `This market resolves according to the combined outcome (https://polymarket.com/event/house-winner?).\n${componentRules}`,
      catalogNoAskDollars: 0.82,
    });

    expect(
      detectCompoundUpperBoundCandidates([component, compound]),
    ).toHaveLength(1);
    expect(
      detectCompoundUpperBoundCandidates([
        component,
        { ...compound, description: "Will both events occur?" },
      ]),
    ).toHaveLength(0);
  });
});
