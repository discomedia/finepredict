import { describe, expect, it } from "vitest";

import {
  detectPlatform,
  ExternalServiceUnavailableError,
  extractNamedResolutionSource,
  extractPathValue,
  fetchJson,
  UnsupportedMarketUrlError,
} from "./platform.js";

describe("market URL parsing", () => {
  it("detects both supported platforms", () => {
    expect(detectPlatform("https://polymarket.com/event/example")).toBe(
      "polymarket",
    );
    expect(detectPlatform("https://kalshi.com/markets/KXEXAMPLE/example")).toBe(
      "kalshi",
    );
  });

  it("rejects unsupported hosts", () => {
    expect(() => detectPlatform("https://example.com/market/test")).toThrow(
      UnsupportedMarketUrlError,
    );
  });

  it("extracts URL identifiers after the expected path segment", () => {
    expect(
      extractPathValue(
        new URL("https://kalshi.com/markets/KXEXAMPLE/description"),
        "markets",
      ),
    ).toBe("KXEXAMPLE");
  });

  it("extracts a primary resolution source from full rule prose", () => {
    expect(
      extractNamedResolutionSource(
        "The primary resolution source for this market will be official information from the Government of Ethiopia; however, reporting may also be used.",
      ),
    ).toBe("official information from the Government of Ethiopia");
  });

  it("identifies an upstream HTTP failure as an external service outage", async () => {
    const fetchImplementation = (async () =>
      Response.json(
        { error: { code: "service_unavailable" } },
        { status: 503 },
      )) as typeof fetch;

    await expect(
      fetchJson(
        "https://external-api.kalshi.com/trade-api/v2/markets/example",
        "Kalshi",
        fetchImplementation,
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ExternalServiceUnavailableError>>({
        code: "EXTERNAL_SERVICE_UNAVAILABLE",
        responseStatus: 503,
        serviceName: "Kalshi",
        upstreamStatus: 503,
      }),
    );
  });
});
