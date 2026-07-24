import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createArbitrageRouter } from "./router.js";
import type { ArbitrageRuntime } from "./runtime.js";
import type { ScannedOpportunity } from "./opportunities/types.js";
import type { ReportService } from "../report-service.js";

/** Narrow saved-report resolver used by the router test double. */
type ComparisonResolverFixture = (
  sourceKey: string,
  urls: readonly [string, string],
) => Promise<{
  report: { slug: string };
  reused: boolean;
}>;

describe("arbitrage API", () => {
  it("returns compact reviewed post-fee opportunities", async () => {
    const app = express();
    app.use(
      "/api/arbitrage",
      createArbitrageRouter(runtimeFixture(), reportServiceFixture()),
    );

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

  it("reuses the opportunity's saved comparison report", async () => {
    const app = express();
    const getOrCreateComparisonReport = vi.fn(async () => ({
      report: { slug: "saved-comparison" },
      reused: true,
    }));
    app.use(
      "/api/arbitrage",
      createArbitrageRouter(
        runtimeFixture(),
        reportServiceFixture(getOrCreateComparisonReport),
      ),
    );

    const response = await request(app)
      .post("/api/arbitrage/opportunities/pair-1/compare")
      .expect(200);

    expect(response.body).toEqual({
      reused: true,
      slug: "saved-comparison",
    });
    expect(getOrCreateComparisonReport).toHaveBeenCalledWith(
      "arbitrage:pair-1",
      [
        "https://kalshi.com/markets/kxtest/event-1?market_ticker=KXTEST",
        "https://polymarket.com/event/event-1/test-child",
      ],
    );
  });

  it("returns one pair's hourly spread history", async () => {
    const app = express();
    app.use(
      "/api/arbitrage",
      createArbitrageRouter(runtimeFixture(), reportServiceFixture()),
    );

    const response = await request(app).get(
      "/api/arbitrage/opportunities/pair-1/history",
    );

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      opportunityId: "pair-1",
      detectedAtIso: "2026-07-24T00:00:00.000Z",
      points: [
        {
          grossEdgeDollarsPerShare: 0.1,
          netEdgeDollarsPerShare: 0.09,
        },
      ],
    });
  });
});

/**
 * Creates an idempotent saved-report resolver for router tests.
 *
 * @param getOrCreateComparisonReport - Optional comparison resolver spy.
 * @returns Minimal report-service fixture.
 */
function reportServiceFixture(
  getOrCreateComparisonReport: ComparisonResolverFixture = async () => ({
    report: { slug: "saved-comparison" },
    reused: true,
  }),
): ReportService {
  return {
    getOrCreateComparisonReport,
  } as unknown as ReportService;
}

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
      getOpportunityHistory: async () => ({
        opportunityId: "pair-1",
        detectedAtIso: "2026-07-24T00:00:00.000Z",
        latestObservedAtIso: "2026-07-24T00:00:00.000Z",
        points: [
          {
            opportunityId: "pair-1",
            observedAtIso: "2026-07-24T00:00:00.000Z",
            buyYesVenue: "kalshi",
            buyNoVenue: "polymarket",
            buyYesAveragePriceDollars: 0.4,
            buyNoAveragePriceDollars: 0.5,
            grossEdgeDollarsPerShare: 0.1,
            netEdgeDollarsPerShare: 0.09,
            roiPercent100: 9.89,
          },
        ],
      }),
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
      marketSlug: "test-child",
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
