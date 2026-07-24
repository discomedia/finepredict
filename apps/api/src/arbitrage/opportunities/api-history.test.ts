import { describe, expect, it } from "vitest";

import { buildApiHistory } from "./api-history.js";
import type { HistoricalMarketPriceService } from "../../markets/historical-price-history.js";
import type { CrossVenueScannedOpportunity } from "./types.js";

/** Creates a compact native market fixture for API-history math. */
function nativeMarket(
  venue: "kalshi" | "polymarket",
  marketId: string,
): CrossVenueScannedOpportunity["kalshi"] {
  return {
    venue,
    marketId,
    eventId: `${marketId}-event`,
    question: "Will the fixture happen?",
    description: "Fixture settlement rules.",
    category: "test",
    status: "active",
    minimumOrderSizeShares: 1,
    volume: 0,
    liquidity: 0,
    startDateIso: "2026-07-01T00:00:00.000Z",
    ...(venue === "polymarket"
      ? { yesTokenId: `${marketId}-yes`, noTokenId: `${marketId}-no` }
      : {}),
  };
}

/** Creates a direction-specific cross-venue opportunity fixture. */
function opportunityFixture(): CrossVenueScannedOpportunity {
  return {
    opportunityId: "pair-api-history",
    strategy: "cross_venue_equivalent",
    status: "actionable",
    category: "test",
    matchConfidence: "verified",
    relationship: "pure_arbitrage",
    settlementRisks: [],
    kalshi: nativeMarket("kalshi", "KX-1"),
    polymarket: nativeMarket("polymarket", "PM-1"),
    direction: { buyYesVenue: "kalshi", buyNoVenue: "polymarket" },
    executableShares: 1,
    buyYesAveragePriceDollars: 0.4,
    buyNoAveragePriceDollars: 0.5,
    grossCostDollars: 0.9,
    feesDollars: 0,
    grossProfitDollars: 0.1,
    netProfitDollars: 0.1,
    conditionalNetProfitDollars: 0.1,
    worstCaseSettlementDivergenceLossDollars: 0,
    netEdgeDollarsPerShare: 0.1,
    roiPercent100: 11.11,
    observedAtIso: "2026-07-24T00:00:00.000Z",
    similarityPercent100: 100,
    matchReasons: ["Fixture"],
  };
}

describe("buildApiHistory", () => {
  it("uses the current direction and clips API points at detection", async () => {
    const priceService = {
      getHistoricalPriceSeries: async () => [
        {
          market: {
            platform: "kalshi" as const,
            externalId: "KX-1",
            startDateIso: "2026-07-01T00:00:00.000Z",
          },
          available: true,
          points: [
            {
              timestampIso: "2026-07-23T00:00:00.000Z",
              yesPriceDollars: 0.4,
            },
            {
              timestampIso: "2026-07-24T01:00:00.000Z",
              yesPriceDollars: 0.2,
            },
          ],
        },
        {
          market: {
            platform: "polymarket" as const,
            externalId: "PM-1",
            yesTokenId: "PM-1-yes",
            startDateIso: "2026-07-01T00:00:00.000Z",
          },
          available: true,
          points: [
            {
              timestampIso: "2026-07-23T00:00:00.000Z",
              yesPriceDollars: 0.5,
            },
            {
              timestampIso: "2026-07-24T01:00:00.000Z",
              yesPriceDollars: 0.7,
            },
          ],
        },
      ],
    } as unknown as HistoricalMarketPriceService;

    const result = await buildApiHistory(
      opportunityFixture(),
      "2026-07-24T00:00:00.000Z",
      priceService,
    );

    expect(result).toMatchObject({
      availability: "available",
      sourceDirection: {
        buyYesVenue: "kalshi",
        buyNoVenue: "polymarket",
      },
      points: [
        {
          observedAtIso: "2026-07-23T00:00:00.000Z",
          buyYesAveragePriceDollars: 0.4,
          buyNoAveragePriceDollars: 0.5,
          indicativeGrossEdgeDollarsPerShare: 0.1,
        },
      ],
    });
  });
});
