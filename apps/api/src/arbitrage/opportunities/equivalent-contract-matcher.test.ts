import { describe, expect, it } from "vitest";

import { matchEquivalentContracts } from "./equivalent-contract-matcher.js";
import type { NativeBinaryMarket } from "./types.js";

/**
 * Builds one test market with executable catalog quotes.
 *
 * @param venue - Test venue.
 * @param marketId - Venue market identifier.
 * @param question - Contract proposition.
 * @param outcomeLabel - Candidate-specific child label.
 * @param eventTitle - Optional parent-event identity.
 * @param description - Optional settlement text override.
 * @returns Native binary test market.
 */
function market(
  venue: "kalshi" | "polymarket",
  marketId: string,
  question: string,
  outcomeLabel: string,
  eventTitle?: string,
  description?: string,
): NativeBinaryMarket {
  return {
    venue,
    marketId,
    eventId: `${venue}-event`,
    ...(eventTitle ? { eventTitle } : {}),
    ...(venue === "kalshi" ? { seriesId: "SERIES" } : {}),
    question,
    outcomeLabel,
    description: description ?? question,
    category: "test",
    status: "active",
    ...(venue === "polymarket"
      ? {
          yesTokenId: `${marketId}-yes`,
          noTokenId: `${marketId}-no`,
          polymarketFeeRate: 0.04,
          polymarketFeeExponent: 1,
        }
      : {}),
    minimumOrderSizeShares: venue === "polymarket" ? 5 : 1,
    catalogYesAskDollars: venue === "kalshi" ? 0.4 : 0.5,
    catalogNoAskDollars: venue === "kalshi" ? 0.62 : 0.45,
    volume: 0,
    liquidity: 0,
  };
}

describe("equivalent contract matcher", () => {
  it("finds exact candidates without requiring volume or liquidity", async () => {
    const result = await matchEquivalentContracts(
      [
        market(
          "kalshi",
          "K-1",
          "Will Pete Fry win the 2026 Vancouver mayoral election?",
          "Pete Fry",
        ),
        market(
          "polymarket",
          "P-1",
          "Will Pete Fry win the 2026 Vancouver mayoral election?",
          "Pete Fry",
        ),
      ],
      {
        minimumSimilarityPercent100: 85,
        minimumPreliminaryGrossEdgeDollarsPerShare: 0,
        maximumFreshBookPairs: 10,
        maximumPairsPerEventPair: 10,
      },
    );

    expect(result.lexicalCandidateCount).toBe(1);
    expect(result.candidates).toHaveLength(1);
  });

  it("rejects different ordinal outcomes before book requests", async () => {
    const result = await matchEquivalentContracts(
      [
        market(
          "kalshi",
          "K-2",
          "Will Renan Santos finish 2nd in the first round?",
          "Renan Santos",
        ),
        market(
          "polymarket",
          "P-2",
          "Will Renan Santos finish in third place in the first round?",
          "Renan Santos",
        ),
      ],
      {
        minimumSimilarityPercent100: 50,
        minimumPreliminaryGrossEdgeDollarsPerShare: 0,
        maximumFreshBookPairs: 10,
        maximumPairsPerEventPair: 10,
      },
    );

    expect(result.candidates).toHaveLength(0);
  });

  it("rejects subset entity names such as Milan and Inter Milan", async () => {
    const result = await matchEquivalentContracts(
      [
        market("kalshi", "K-3", "Will Milan win the 2026-27 Serie A?", "Milan"),
        market(
          "polymarket",
          "P-3",
          "Will Inter Milan win the 2026-27 Serie A?",
          "Inter Milan",
        ),
      ],
      {
        minimumSimilarityPercent100: 50,
        minimumPreliminaryGrossEdgeDollarsPerShare: 0,
        maximumFreshBookPairs: 10,
        maximumPairsPerEventPair: 10,
      },
    );

    expect(result.candidates).toHaveLength(0);
  });

  it("rejects reviewed event families without consuming the shortlist", async () => {
    const kalshi = market(
      "kalshi",
      "K-4",
      "Will Canada participate in Eurovision 2027?",
      "Canada",
    );
    const polymarket = market(
      "polymarket",
      "P-4",
      "Will Canada participate in Eurovision 2027?",
      "Canada",
    );
    const result = await matchEquivalentContracts([kalshi, polymarket], {
      minimumSimilarityPercent100: 50,
      minimumPreliminaryGrossEdgeDollarsPerShare: 0,
      maximumFreshBookPairs: 10,
      maximumPairsPerEventPair: 10,
      pairOverrides: [
        {
          kalshiMarketId: "*",
          polymarketMarketId: "*",
          kalshiEventId: kalshi.eventId,
          polymarketEventId: polymarket.eventId,
          verified: false,
          note: "Settlement mismatch",
        },
      ],
    });

    expect(result.lexicalCandidateCount).toBe(0);
    expect(result.candidates).toHaveLength(0);
  });

  it("rejects a generic market paired to one named disease", async () => {
    const result = await matchEquivalentContracts(
      [
        market("kalshi", "K-5", "Pandemic in 2026?", "In 2026"),
        market(
          "polymarket",
          "P-5",
          "Hantavirus pandemic in 2026?",
          "Hantavirus",
        ),
      ],
      {
        minimumSimilarityPercent100: 50,
        minimumPreliminaryGrossEdgeDollarsPerShare: 0,
        maximumFreshBookPairs: 10,
        maximumPairsPerEventPair: 10,
      },
    );

    expect(result.candidates).toHaveLength(0);
  });

  it("uses parent event titles to distinguish generic sports children", async () => {
    const result = await matchEquivalentContracts(
      [
        market(
          "kalshi",
          "K-6",
          "Will both teams score?",
          "Both teams score",
          "Chicago Fire FC vs Vancouver Whitecaps FC",
        ),
        market(
          "polymarket",
          "P-6",
          "Chicago Fire FC vs. Vancouver Whitecaps FC: Both Teams to Score",
          "Both teams score",
          "Chicago Fire FC vs Vancouver Whitecaps FC",
        ),
        market(
          "polymarket",
          "P-7",
          "CA Sarmiento vs. AA Argentinos Juniors: Both Teams to Score",
          "Both teams score",
          "CA Sarmiento vs AA Argentinos Juniors",
        ),
      ],
      {
        minimumSimilarityPercent100: 50,
        minimumPreliminaryGrossEdgeDollarsPerShare: 0,
        maximumFreshBookPairs: 10,
        maximumPairsPerEventPair: 10,
      },
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.polymarket.marketId).toBe("P-6");
  });

  it("rejects different baseball counting statistics", async () => {
    const result = await matchEquivalentContracts(
      [
        market(
          "kalshi",
          "K-7",
          "Will Yordan Alvarez lead Pro Baseball in home runs in 2026?",
          "Yordan Alvarez",
        ),
        market(
          "polymarket",
          "P-8",
          "Will Yordan Alvarez lead MLB in runs in 2026?",
          "Yordan Alvarez",
        ),
      ],
      {
        minimumSimilarityPercent100: 50,
        minimumPreliminaryGrossEdgeDollarsPerShare: 0,
        maximumFreshBookPairs: 10,
        maximumPairsPerEventPair: 10,
      },
    );

    expect(result.candidates).toHaveLength(0);
  });

  it("recognizes strike out phrasing as strikeouts before comparing wins", async () => {
    const result = await matchEquivalentContracts(
      [
        market(
          "kalshi",
          "K-7B",
          "Will Jacob Misiorowski lead Pro Baseball in wins for 2026?",
          "Jacob Misiorowski",
        ),
        market(
          "polymarket",
          "P-8B",
          "Will Jacob Misiorowski strike out the most batters in MLB in 2026?",
          "Jacob Misiorowski",
        ),
      ],
      {
        minimumSimilarityPercent100: 50,
        minimumPreliminaryGrossEdgeDollarsPerShare: 0,
        maximumFreshBookPairs: 10,
        maximumPairsPerEventPair: 10,
      },
    );

    expect(result.candidates).toHaveLength(0);
  });

  it("round-robins provisional categories inside the fixed book budget", async () => {
    const sportsOne = market(
      "kalshi",
      "K-DIV-1",
      "Will Alpha Player win the Golden Boot?",
      "Alpha Player",
    );
    const sportsTwo = market(
      "kalshi",
      "K-DIV-2",
      "Will Beta Player win the Golden Boot?",
      "Beta Player",
    );
    const health = market(
      "kalshi",
      "K-DIV-3",
      "Will an Ebola case be reported in Canada?",
      "Canada Ebola",
    );
    const result = await matchEquivalentContracts(
      [
        { ...sportsOne, category: "sports" },
        { ...sportsTwo, category: "sports" },
        { ...health, category: "health" },
        {
          ...market(
            "polymarket",
            "P-DIV-1",
            "Will Alpha Player win the Golden Boot?",
            "Alpha Player",
          ),
          category: "sports",
        },
        {
          ...market(
            "polymarket",
            "P-DIV-2",
            "Will Beta Player win the Golden Boot?",
            "Beta Player",
          ),
          category: "sports",
        },
        {
          ...market(
            "polymarket",
            "P-DIV-3",
            "Will an Ebola case be reported in Canada?",
            "Canada Ebola",
          ),
          category: "health",
        },
      ],
      {
        minimumSimilarityPercent100: 50,
        minimumPreliminaryGrossEdgeDollarsPerShare: 0,
        maximumFreshBookPairs: 2,
        maximumPairsPerEventPair: 10,
      },
    );

    expect(
      new Set(result.candidates.map((candidate) => candidate.kalshi.category)),
    ).toEqual(new Set(["sports", "health"]));
  });

  it("retains settlement-risk signals for election versus sworn-in clauses", async () => {
    const question = "Will the Republican Party win the WA-05 House seat?";
    const result = await matchEquivalentContracts(
      [
        market(
          "kalshi",
          "K-8",
          question,
          "Republican",
          "WA-05 House winner",
          "Pays for the first person sworn in, including a temporary replacement.",
        ),
        market(
          "polymarket",
          "P-9",
          question,
          "Republican",
          "WA-05 House winner",
          "Pays according to the candidate who wins the election.",
        ),
      ],
      {
        minimumSimilarityPercent100: 50,
        minimumPreliminaryGrossEdgeDollarsPerShare: 0,
        maximumFreshBookPairs: 10,
        maximumPairsPerEventPair: 10,
      },
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.relationship).toBe("unreviewed");
    expect(result.candidates[0]?.settlementRisks).toContain(
      "One venue conditions settlement on taking office or being sworn in",
    );
  });

  it("retains settlement-risk signals for split versus one-winner payouts", async () => {
    const question = "Will Maine have the closest Senate race in 2026?";
    const result = await matchEquivalentContracts(
      [
        market(
          "kalshi",
          "K-9",
          question,
          "Maine",
          "Closest Senate race",
          "Tied options split the payout equally.",
        ),
        market(
          "polymarket",
          "P-10",
          question,
          "Maine",
          "Closest Senate race",
          "A tie resolves to the state whose name comes first alphabetically.",
        ),
      ],
      {
        minimumSimilarityPercent100: 50,
        minimumPreliminaryGrossEdgeDollarsPerShare: 0,
        maximumFreshBookPairs: 10,
        maximumPairsPerEventPair: 10,
      },
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.settlementRisks).toContain(
      "One venue permits a split payout while the other uses a single winner",
    );
  });

  it("publishes reviewed low-probability divergence as near arbitrage", async () => {
    const kalshi = market(
      "kalshi",
      "K-10",
      "Will the Republican Party win the WA-05 House seat?",
      "Republican Party",
      "WA-05 House winner",
      "Pays for the party of the member sworn in.",
    );
    const polymarket = market(
      "polymarket",
      "P-11",
      "Will the Republican Party win the WA-05 House seat?",
      "Republican Party",
      "WA-05 House winner",
      "Pays for the party of the election winner.",
    );
    const result = await matchEquivalentContracts([kalshi, polymarket], {
      minimumSimilarityPercent100: 85,
      minimumPreliminaryGrossEdgeDollarsPerShare: 0,
      maximumFreshBookPairs: 10,
      maximumPairsPerEventPair: 10,
      pairOverrides: [
        {
          kalshiMarketId: "*",
          polymarketMarketId: "*",
          kalshiEventId: kalshi.eventId,
          polymarketEventId: polymarket.eventId,
          verified: false,
          classification: "near_arbitrage",
          settlementRisks: [
            "Election winner can differ from the member sworn in",
          ],
          note: "Reviewed basis risk",
        },
      ],
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.relationship).toBe("near_arbitrage");
    expect(result.candidates[0]?.settlementRisks).toEqual([
      "Election winner can differ from the member sworn in",
    ]);
  });

  it("aligns tightly bounded spelling aliases in child outcome names", async () => {
    const result = await matchEquivalentContracts(
      [
        market(
          "kalshi",
          "K-11",
          "Who will be the next Prime Minister of Israel?",
          "Gadi Eisenkot",
          "Next Israel Prime Minister",
        ),
        market(
          "polymarket",
          "P-12",
          "Who will be the next Prime Minister of Israel?",
          "Gadi Eizenkot",
          "Next Israel Prime Minister",
        ),
      ],
      {
        minimumSimilarityPercent100: 50,
        minimumPreliminaryGrossEdgeDollarsPerShare: 0,
        maximumFreshBookPairs: 10,
        maximumPairsPerEventPair: 10,
      },
    );

    expect(result.candidates).toHaveLength(1);
  });

  it("rejects different party-control assignments in child labels", async () => {
    const result = await matchEquivalentContracts(
      [
        market(
          "kalshi",
          "K-12",
          "Who will control Congress after the 2026 midterms?",
          "D-House, D-Senate",
          "2026 balance of power",
        ),
        market(
          "polymarket",
          "P-13",
          "Who will control Congress after the 2026 midterms?",
          "D Senate, R House",
          "2026 balance of power",
        ),
      ],
      {
        minimumSimilarityPercent100: 50,
        minimumPreliminaryGrossEdgeDollarsPerShare: 0,
        maximumFreshBookPairs: 10,
        maximumPairsPerEventPair: 10,
      },
    );

    expect(result.candidates).toHaveLength(0);
  });

  it("rejects different baseball statistics even when the player aligns", async () => {
    const result = await matchEquivalentContracts(
      [
        market(
          "kalshi",
          "K-13",
          "Will Jacob Misiorowski lead Pro Baseball in wins for the 2026 regular season?",
          "Jacob Misiorowski",
        ),
        market(
          "polymarket",
          "P-14",
          "Will Jacob Misiorowski lead MLB in strikeouts for the 2026 regular season?",
          "Jacob Misiorowski",
        ),
      ],
      {
        minimumSimilarityPercent100: 50,
        minimumPreliminaryGrossEdgeDollarsPerShare: 0,
        maximumFreshBookPairs: 10,
        maximumPairsPerEventPair: 10,
      },
    );

    expect(result.candidates).toHaveLength(0);
  });

  it("rejects presidential versus vice-presidential nominee markets", async () => {
    const result = await matchEquivalentContracts(
      [
        market(
          "kalshi",
          "K-14",
          "Will J.D. Vance be the 2028 Republican presidential nominee?",
          "J.D. Vance",
        ),
        market(
          "polymarket",
          "P-15",
          "Will J.D. Vance be the 2028 Republican vice-presidential nominee?",
          "J.D. Vance",
        ),
      ],
      {
        minimumSimilarityPercent100: 50,
        minimumPreliminaryGrossEdgeDollarsPerShare: 0,
        maximumFreshBookPairs: 10,
        maximumPairsPerEventPair: 10,
      },
    );

    expect(result.candidates).toHaveLength(0);
  });

  it("rejects album versus song achievements", async () => {
    const result = await matchEquivalentContracts(
      [
        market(
          "kalshi",
          "K-15",
          "Will Mariah Carey have a number one album in 2026?",
          "Mariah Carey",
        ),
        market(
          "polymarket",
          "P-16",
          "Will Mariah Carey have a number one song in 2026?",
          "Mariah Carey",
        ),
      ],
      {
        minimumSimilarityPercent100: 50,
        minimumPreliminaryGrossEdgeDollarsPerShare: 0,
        maximumFreshBookPairs: 10,
        maximumPairsPerEventPair: 10,
      },
    );

    expect(result.candidates).toHaveLength(0);
  });

  it("rejects weekly versus end-of-month AI rankings", async () => {
    const result = await matchEquivalentContracts(
      [
        market(
          "kalshi",
          "K-16",
          "Will Alibaba be the best Chinese AI company this week?",
          "Alibaba",
        ),
        market(
          "polymarket",
          "P-17",
          "Will Alibaba have the best Chinese AI model at the end of July?",
          "Alibaba",
        ),
      ],
      {
        minimumSimilarityPercent100: 50,
        minimumPreliminaryGrossEdgeDollarsPerShare: 0,
        maximumFreshBookPairs: 10,
        maximumPairsPerEventPair: 10,
      },
    );

    expect(result.candidates).toHaveLength(0);
  });

  it("rejects different IPO companies despite a shared underwriter", async () => {
    const result = await matchEquivalentContracts(
      [
        market(
          "kalshi",
          "K-17",
          "Will Morgan Stanley underwrite the Anthropic IPO?",
          "Morgan Stanley",
        ),
        market(
          "polymarket",
          "P-18",
          "Will Morgan Stanley underwrite the OpenAI IPO?",
          "Morgan Stanley",
        ),
      ],
      {
        minimumSimilarityPercent100: 50,
        minimumPreliminaryGrossEdgeDollarsPerShare: 0,
        maximumFreshBookPairs: 10,
        maximumPairsPerEventPair: 10,
      },
    );

    expect(result.candidates).toHaveLength(0);
  });

  it("rejects inverted party-to-chamber assignments in questions", async () => {
    const result = await matchEquivalentContracts(
      [
        market(
          "kalshi",
          "K-18",
          "Will House Control be Republican and Senate Control be Democratic?",
          "",
        ),
        market(
          "polymarket",
          "P-19",
          "Will Republicans control the Senate and Democrats control the House?",
          "",
        ),
      ],
      {
        minimumSimilarityPercent100: 50,
        minimumPreliminaryGrossEdgeDollarsPerShare: 0,
        maximumFreshBookPairs: 10,
        maximumPairsPerEventPair: 10,
      },
    );

    expect(result.candidates).toHaveLength(0);
  });

  it("rejects Tour de France overall versus white-jersey winners", async () => {
    const result = await matchEquivalentContracts(
      [
        market(
          "kalshi",
          "K-19",
          "Will Paul Seixas win the 2026 Tour de France?",
          "Paul Seixas",
        ),
        market(
          "polymarket",
          "P-20",
          "Will Paul Seixas win the White Jersey at the 2026 Tour de France?",
          "Paul Seixas",
        ),
      ],
      {
        minimumSimilarityPercent100: 50,
        minimumPreliminaryGrossEdgeDollarsPerShare: 0,
        maximumFreshBookPairs: 10,
        maximumPairsPerEventPair: 10,
      },
    );

    expect(result.candidates).toHaveLength(0);
  });

  it("yields to pending API work during a large catalog match", async () => {
    let pendingTurnRan = false;
    setImmediate(() => {
      pendingTurnRan = true;
    });

    await matchEquivalentContracts(
      [
        ...Array.from({ length: 201 }, (_, index) =>
          market(
            "kalshi",
            `K-YIELD-${index}`,
            "Will the shared candidate win the shared election?",
            "Shared candidate",
          ),
        ),
        market(
          "polymarket",
          "P-YIELD",
          "Will the shared candidate win the shared election?",
          "Shared candidate",
        ),
      ],
      {
        minimumSimilarityPercent100: 50,
        minimumPreliminaryGrossEdgeDollarsPerShare: 0,
        maximumFreshBookPairs: 10,
        maximumPairsPerEventPair: 10,
      },
    );

    expect(pendingTurnRan).toBe(true);
  });
});
