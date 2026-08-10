import { describe, expect, it } from "vitest";

import { loadConfig, normalizeDatabaseUrlSslMode } from "./config.js";

describe("FinePredict configuration", () => {
  it("makes legacy PostgreSQL SSL verification behavior explicit", () => {
    expect(
      normalizeDatabaseUrlSslMode(
        "postgresql://user:secret@example.com/database?sslmode=require",
      ),
    ).toBe("postgresql://user:secret@example.com/database?sslmode=verify-full");
  });

  it("retains strict arbitrage network and cadence defaults", () => {
    const config = loadConfig({});

    expect(config.arbitrage).toMatchObject({
      enabled: true,
      runDiscoveryOnStart: true,
      discoveryIntervalMs: 3_600_000,
      priceRefreshIntervalMs: 3_600_000,
      maximumPriceRefreshPairs: 24,
      maximumFreshBookPairs: 100,
      minimumNetEdgeDollarsPerShare: 0.03,
    });
  });
});
