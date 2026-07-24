import { describe, expect, it } from "vitest";

import {
  calculateLegFillCost,
  calculateLevelFee,
  inferPolymarketTakerFeeRate,
} from "./fees.js";

describe("fee calculations", () => {
  it("uses Kalshi's quadratic taker formula and cent rounding", () => {
    const fee = calculateLevelFee(10, 0.5, {
      venue: "kalshi",
      kalshiSchedule: {
        feeType: "quadratic",
        feeMultiplier: 1,
        seriesTicker: "KXTEST",
      },
    });
    expect(fee).toBe(0.18);
  });

  it("uses Polymarket's category coefficient and five-place rounding", () => {
    const fee = calculateLevelFee(10, 0.5, {
      venue: "polymarket",
      polymarketTakerFeeRate: 0.04,
    });
    expect(fee).toBe(0.1);
  });

  it("applies the venue-reported Polymarket fee exponent", () => {
    const fee = calculateLevelFee(100, 0.5, {
      venue: "polymarket",
      polymarketTakerFeeRate: 0.04,
      polymarketFeeExponent: 2,
    });
    expect(fee).toBe(0.25);
  });

  it("walks multiple price levels without exceeding displayed size", () => {
    const result = calculateLegFillCost(
      [
        { priceDollars: 0.2, sizeShares: 2 },
        { priceDollars: 0.25, sizeShares: 3 },
      ],
      4,
      { venue: "polymarket", polymarketTakerFeeRate: 0 },
    );
    expect(result.sharesFilled).toBe(4);
    expect(result.grossCostDollars).toBeCloseTo(0.9);
  });

  it("defaults unknown Polymarket categories to the maximum rate", () => {
    expect(inferPolymarketTakerFeeRate(["Unclassified"])).toBe(0.07);
    expect(inferPolymarketTakerFeeRate(["Geopolitics"])).toBe(0);
  });
});
