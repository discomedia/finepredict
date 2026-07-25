import { describe, expect, it } from "vitest";

import {
  HistoricalMarketPriceService,
  type HistoricalPriceMarketRequest,
} from "./historical-price-history.js";

/** Creates a successful JSON response for an upstream fixture. */
function jsonResponse(body: unknown): Response {
  return Response.json(body);
}

/** Creates the two native markets used by the batch fixtures. */
function marketRequests(): readonly HistoricalPriceMarketRequest[] {
  return [
    {
      platform: "polymarket",
      externalId: "PM-1",
      yesTokenId: "PM-YES-1",
      startDateIso: "2026-07-01T00:00:00.000Z",
    },
    {
      platform: "kalshi",
      externalId: "KX-1",
      startDateIso: "2026-07-01T00:00:00.000Z",
    },
  ];
}

describe("HistoricalMarketPriceService", () => {
  it("batches one request per venue and reuses the ten-minute cache", async () => {
    const requests: { url: string; method: string; body: string }[] = [];
    const fetchImplementation = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      requests.push({
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : "",
      });
      if (url.includes("batch-prices-history")) {
        return jsonResponse({
          history: {
            "PM-YES-1": [
              { p: "0.42", t: 1_783_353_600 },
              { p: "0.47", t: 1_783_440_000 },
            ],
          },
        });
      }
      return jsonResponse({
        markets: [
          {
            candlesticks: [
              {
                end_period_ts: 1_783_353_600,
                price: {},
                yes_ask: { close_dollars: "0.51" },
              },
            ],
          },
        ],
      });
    }) as typeof fetch;
    const service = new HistoricalMarketPriceService(fetchImplementation);

    const first = await service.getHistoricalPriceSeries(marketRequests());
    const second = await service.getHistoricalPriceSeries(marketRequests());

    expect(requests).toHaveLength(2);
    expect(
      requests.find((request) => request.method === "POST")?.body,
    ).toContain("PM-YES-1");
    expect(first).toMatchObject([
      {
        market: { externalId: "PM-1" },
        available: true,
        points: [{ yesPriceDollars: 0.42 }, { yesPriceDollars: 0.47 }],
      },
      {
        market: { externalId: "KX-1" },
        available: true,
        points: [{ yesPriceDollars: 0.51 }],
      },
    ]);
    expect(second).toEqual(first);
  });

  it("bounds a large venue history to 500 points", async () => {
    const fetchImplementation = (async () =>
      jsonResponse({
        history: {
          "PM-YES-1": Array.from({ length: 650 }, (_, index) => ({
            p: 0.2 + (index % 50) / 500,
            t: 1_700_000_000 + index * 3_600,
          })),
        },
      })) as typeof fetch;
    const service = new HistoricalMarketPriceService(fetchImplementation);

    const [series] = await service.getHistoricalPriceSeries([
      {
        platform: "polymarket",
        externalId: "PM-1",
        yesTokenId: "PM-YES-1",
      },
    ]);

    expect(series?.points).toHaveLength(500);
    expect(series?.points[0]?.timestampIso).toBe(
      new Date(1_700_000_000 * 1_000).toISOString(),
    );
  });

  it("retains partial venue availability instead of failing the batch", async () => {
    const fetchImplementation = (async (input: string | URL | Request) => {
      if (String(input).includes("batch-prices-history")) {
        return new Response(null, { status: 503, statusText: "Unavailable" });
      }
      return jsonResponse({
        markets: [
          {
            candlesticks: [
              {
                end_period_ts: 1_783_353_600,
                price: {},
                yes_ask: { close_dollars: "0.51" },
              },
            ],
          },
        ],
      });
    }) as typeof fetch;
    const service = new HistoricalMarketPriceService(fetchImplementation);

    const result = await service.getHistoricalPriceSeries(marketRequests());

    expect(result.map((series) => series.available)).toEqual([false, true]);
  });
});
