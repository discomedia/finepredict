import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createArbitrageRouter } from "./router.js";
import type { ArbitrageRuntime } from "./runtime.js";
import type { ScannedOpportunity } from "./opportunities/types.js";

describe("arbitrage API", () => {
  it("returns compact reviewed post-fee opportunities", async () => {
    const app = express();
    app.use("/api/arbitrage", createArbitrageRouter(runtimeFixture()));

    const response = await request(app).get(
      "/api/arbitrage/opportunities?reviewedOnly=true&minimumNetEdgeCents=3",
    );

    expect(response.status).toBe(200);
    expect(response.body.count).toBe(1);
    expect(response.body.opportunities[0]).toMatchObject({
      opportunityId: "pair-1",
      relationship: "pure_arbitrage",
      grossEdgeDollarsPerShare: 0.1,
      feeDollarsPerShare: 0.01,
      netEdgeDollarsPerShare: 0.09,
      buyYesAveragePriceDollars: 0.4,
      buyNoAveragePriceDollars: 0.5,
    });
    expect(response.body.opportunities[0].kalshi.description).toBeUndefined();
  });
});

/**
 * Creates a read-only in-memory arbitrage runtime.
 *
 * @returns Runtime fixture with one reviewed opportunity.
 */
function runtimeFixture(): ArbitrageRuntime {
  const opportunity = opportunityFixture();
  return {
    repository: {
      getSummary: async () => ({
        kalshiMarketCount: 1,
        polymarketMarketCount: 1,
        opportunityCount: 1,
      }),
      listOpportunityCategories: async () => ["test"],
      listOpportunities: async () => [opportunity],
      getOpportunity: async () => opportunity,
    },
    service: {
      getStatus: () => ({
        running: true,
        discoveryIntervalSeconds: 3_600,
        priceRefreshIntervalSeconds: 300,
        maximumPriceRefreshPairs: 24,
        connectedClientCount: 0,
      }),
      subscribe: () => () => undefined,
    },
  } as unknown as ArbitrageRuntime;
}

/**
 * Creates one executable reviewed opportunity.
 *
 * @returns Complete scanner record.
 */
function opportunityFixture(): ScannedOpportunity {
  const sharedMarket = {
    eventId: "event-1",
    question: "Will the fixture happen?",
    description: "Exact settlement rules.",
    category: "test",
    status: "active",
    minimumOrderSizeShares: 1,
    catalogYesAskDollars: 0.4,
    catalogNoAskDollars: 0.5,
    volume: 0,
    liquidity: 0,
  };
  return {
    opportunityId: "pair-1",
    strategy: "cross_venue_equivalent",
    status: "actionable",
    category: "test",
    matchConfidence: "verified",
    relationship: "pure_arbitrage",
    settlementRisks: [],
    kalshi: {
      ...sharedMarket,
      venue: "kalshi",
      marketId: "KXTEST",
      seriesId: "KXTEST",
      settlementRulesUrl: "https://example.com/kalshi.pdf",
    },
    polymarket: {
      ...sharedMarket,
      venue: "polymarket",
      marketId: "0xtest",
      yesTokenId: "yes",
      noTokenId: "no",
      polymarketFeeRate: 0,
      polymarketFeeExponent: 1,
    },
    direction: {
      buyYesVenue: "kalshi",
      buyNoVenue: "polymarket",
    },
    executableShares: 10,
    buyYesAveragePriceDollars: 0.4,
    buyNoAveragePriceDollars: 0.5,
    grossCostDollars: 9,
    feesDollars: 0.1,
    grossProfitDollars: 1,
    netProfitDollars: 0.9,
    conditionalNetProfitDollars: 0.9,
    worstCaseSettlementDivergenceLossDollars: 0,
    netEdgeDollarsPerShare: 0.09,
    roiPercent100: 9.89,
    observedAtIso: "2026-07-24T00:00:00.000Z",
    similarityPercent100: 100,
    matchReasons: ["Exact fixture"],
  };
}
