import { describe, expect, it } from "vitest";

import { MarketPriceHistoryService } from "./price-history.js";

/**
 * Creates an OK JSON response for a public API fixture.
 *
 * @param body - JSON-safe fixture body.
 * @returns Successful HTTP response.
 */
function jsonResponse(body: unknown): Response {
  return Response.json(body);
}

describe("MarketPriceHistoryService", () => {
  it("uses Polymarket's official Gamma and CLOB public endpoints", async () => {
    const requestedUrls: string[] = [];
    const fetchImplementation = (async (input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes("gamma-api.polymarket.com/markets/pm-1")) {
        return jsonResponse({
          clobTokenIds: '["yes-token", "no-token"]',
          outcomes: '["Yes", "No"]',
        });
      }
      return jsonResponse({
        history: [
          { p: "0.42", t: 1_784_678_400 },
          { p: "0.47", t: 1_784_732_400 },
        ],
      });
    }) as typeof fetch;

    const service = new MarketPriceHistoryService(fetchImplementation);
    const snapshot = await service.getPriceSnapshot("polymarket", "pm-1");

    expect(snapshot).toMatchObject({
      availability: "available",
      noPricePercent100: 53,
      yesPricePercent100: 47,
    });
    expect(snapshot.history).toHaveLength(2);
    expect(requestedUrls[1]).toContain("market=yes-token");

    await service.getPriceSnapshot("polymarket", "pm-1");
    expect(requestedUrls).toHaveLength(2);
  });

  it("uses Kalshi's public market and candle endpoints", async () => {
    const requestedUrls: string[] = [];
    const fetchImplementation = (async (input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes("/markets/KXTEST-YES")) {
        return jsonResponse({ market: { last_price_dollars: "0.61" } });
      }
      return jsonResponse({
        markets: [
          {
            candlesticks: [
              {
                end_period_ts: 1_784_678_400,
                price: { close_dollars: "0.56" },
              },
              {
                end_period_ts: 1_784_732_400,
                price: { close_dollars: "0.59" },
              },
            ],
          },
        ],
      });
    }) as typeof fetch;

    const service = new MarketPriceHistoryService(fetchImplementation);
    const snapshot = await service.getPriceSnapshot("kalshi", "KXTEST-YES");

    expect(snapshot).toMatchObject({
      availability: "available",
      noPricePercent100: 39,
      yesPricePercent100: 61,
    });
    expect(snapshot.history.map((point) => point.yesPricePercent100)).toEqual([
      56, 59,
    ]);
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls[1]).toContain("markets/candlesticks?");
  });

  it("returns neutral unavailable copy when a public venue cannot provide data", async () => {
    const fetchImplementation = (async () =>
      new Response(null, {
        status: 503,
        statusText: "Unavailable",
      })) as typeof fetch;
    const service = new MarketPriceHistoryService(fetchImplementation);

    await expect(
      service.getPriceSnapshot("kalshi", "KXOFFLINE"),
    ).resolves.toMatchObject({
      availability: "unavailable",
      history: [],
      yesPricePercent100: null,
    });
  });
});
