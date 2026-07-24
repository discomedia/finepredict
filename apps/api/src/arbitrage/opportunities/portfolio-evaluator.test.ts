import { describe, expect, it } from "vitest";

import type { BinaryOrderBookSnapshot, LegFeeModel } from "../common/types.js";
import type { NativeBinaryMarket, PortfolioCandidate } from "./types.js";
import { evaluatePortfolio } from "./portfolio-evaluator.js";

/**
 * Creates a Polymarket leg fixture.
 *
 * @param marketId - Stable market identifier.
 * @returns Native market.
 */
function market(marketId: string): NativeBinaryMarket {
  return {
    venue: "polymarket",
    marketId,
    eventId: "event",
    question: marketId,
    description: marketId,
    category: "politics",
    status: "active",
    minimumOrderSizeShares: 1,
    polymarketFeeRate: 0,
    polymarketFeeExponent: 1,
    volume: 0,
    liquidity: 0,
  };
}

describe("evaluatePortfolio", () => {
  it("sizes every leg equally and computes the guaranteed lower-bound payout", () => {
    const markets = [market("A"), market("B")];
    const candidate: PortfolioCandidate = {
      opportunityId: "pool",
      strategy: "routed_multi_outcome",
      title: "Pool",
      category: "politics",
      proofKind: "mutually_exclusive_pool",
      proofSummary: "At most one outcome settles Yes.",
      proofVersion: "test",
      legs: markets.map((item) => ({
        market: item,
        side: "no" as const,
        outcomeKey: item.marketId,
      })),
      minimumPayoutDollarsPerShare: 1,
      preliminaryGrossEdgeDollarsPerShare: 0.08,
      relationship: "pure_arbitrage",
      settlementRisks: [],
      matchReasons: [],
      similarityPercent100: 100,
    };
    const snapshots = new Map<string, BinaryOrderBookSnapshot>(
      markets.map((item, index) => [
        `polymarket:${item.marketId}`,
        {
          marketId: item.marketId,
          timestampMs: 1_700_000_000_000,
          yesAsks: [],
          noAsks: [
            {
              priceDollars: index === 0 ? 0.61 : 0.31,
              sizeShares: 100,
            },
          ],
        },
      ]),
    );
    const fees = new Map<string, LegFeeModel>(
      markets.map((item) => [
        `polymarket:${item.marketId}`,
        { venue: "polymarket", polymarketTakerFeeRate: 0 },
      ]),
    );

    const result = evaluatePortfolio({
      candidate,
      snapshotsByMarketKey: snapshots,
      feeModelsByMarketKey: fees,
      budgetDollars: 92,
    });

    expect(result?.shares).toBe(100);
    expect(result?.grossProfitDollars).toBe(8);
    expect(result?.netProfitDollars).toBe(8);
  });

  it("evaluates marginal depth boundaries independently for every leg", () => {
    const markets = [market("A"), market("B")];
    const candidate: PortfolioCandidate = {
      opportunityId: "depth-pool",
      strategy: "routed_multi_outcome",
      title: "Depth pool",
      category: "politics",
      proofKind: "mutually_exclusive_pool",
      proofSummary: "At most one outcome settles Yes.",
      proofVersion: "test",
      legs: markets.map((item) => ({
        market: item,
        side: "no" as const,
        outcomeKey: item.marketId,
      })),
      minimumPayoutDollarsPerShare: 1,
      preliminaryGrossEdgeDollarsPerShare: 0.4,
      relationship: "pure_arbitrage",
      settlementRisks: [],
      matchReasons: [],
      similarityPercent100: 100,
    };
    const snapshots = new Map<string, BinaryOrderBookSnapshot>([
      [
        "polymarket:A",
        {
          marketId: "A",
          timestampMs: 1_700_000_000_000,
          yesAsks: [],
          noAsks: [{ priceDollars: 0.3, sizeShares: 100 }],
        },
      ],
      [
        "polymarket:B",
        {
          marketId: "B",
          timestampMs: 1_700_000_000_000,
          yesAsks: [],
          noAsks: [
            { priceDollars: 0.3, sizeShares: 5 },
            { priceDollars: 0.9, sizeShares: 95 },
          ],
        },
      ],
    ]);
    const fees = new Map<string, LegFeeModel>(
      markets.map((item) => [
        `polymarket:${item.marketId}`,
        { venue: "polymarket", polymarketTakerFeeRate: 0 },
      ]),
    );

    const result = evaluatePortfolio({
      candidate,
      snapshotsByMarketKey: snapshots,
      feeModelsByMarketKey: fees,
      budgetDollars: 1_000,
    });

    expect(result?.shares).toBe(5);
    expect(result?.netProfitDollars).toBe(2);
  });
});
