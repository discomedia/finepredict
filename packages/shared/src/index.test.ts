import { describe, expect, it } from "vitest";

import {
  CreateReportRequestSchema,
  FinePredictModelSchema,
  MarketPlatformSchema,
  MarketSearchQuerySchema,
} from "./index.js";

describe("shared schemas", () => {
  it("accepts supported platforms and models", () => {
    expect(MarketPlatformSchema.parse("polymarket")).toBe("polymarket");
    expect(FinePredictModelSchema.parse("gpt-5.6-luna")).toBe("gpt-5.6-luna");
  });

  it("requires one or two valid URLs", () => {
    expect(
      CreateReportRequestSchema.parse({
        urls: ["https://polymarket.com/event/example"],
      }).urls,
    ).toHaveLength(1);
    expect(() => CreateReportRequestSchema.parse({ urls: [] })).toThrow();
  });

  it("requires at least three trimmed search characters", () => {
    expect(
      MarketSearchQuerySchema.parse({
        platform: "kalshi",
        query: "  Fed rates  ",
      }).query,
    ).toBe("Fed rates");
    expect(() =>
      MarketSearchQuerySchema.parse({ platform: "kalshi", query: "Fe" }),
    ).toThrow();
  });
});
