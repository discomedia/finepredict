import { describe, expect, it, vi } from "vitest";

import { MarketSearchService, MarketSearchUnavailableError } from "./search.js";

/**
 * Creates a successful JSON response.
 *
 * @param body - Response payload.
 * @returns HTTP JSON response.
 */
function jsonResponse(body: unknown): Response {
  return Response.json(body, { status: 200 });
}

describe("MarketSearchService", () => {
  it("searches Oddpool by venue and maps exact market URLs", async () => {
    const requestStartedAtMilliseconds: number[] = [];
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "external-api.kalshi.com") {
        expect(url.searchParams.get("tickers")).toBe("KXBTC-26JUL-B100000");
        expect(new Headers(init?.headers).has("x-api-key")).toBe(false);
        return jsonResponse({
          cursor: "",
          markets: [
            {
              close_time: "2026-07-31T20:00:00Z",
              expected_expiration_time: "2026-07-31T20:05:00Z",
              subtitle: "$100,000 or above",
              ticker: "KXBTC-26JUL-B100000",
              yes_sub_title: "$100,000 or above",
            },
          ],
        });
      }
      requestStartedAtMilliseconds.push(Date.now());
      const platform = url.searchParams.get("exchange");
      expect(url.pathname).toBe("/search/markets");
      expect(url.searchParams.get("q")).toBe("bitcoin");
      expect(["relevance", "volume"]).toContain(
        url.searchParams.get("sort_by"),
      );
      expect(url.searchParams.get("limit")).toBe("50");
      expect(new Headers(init?.headers).get("x-api-key")).toBe(
        "oddpool-test-key",
      );
      return platform === "polymarket"
        ? jsonResponse([
            {
              category: "Crypto",
              event_id: "bitcoin-price-in-july",
              event_title: "Bitcoin price in July",
              exchange: "polymarket",
              market_id: "condition-1",
              liquidity: 75_000,
              question: "Will Bitcoin reach $100,000 in July?",
              series_id: null,
              slug: "will-bitcoin-reach-100k-in-july",
              status: "active",
              volume: 100_000,
            },
          ])
        : jsonResponse([
            {
              category: "Crypto",
              event_id: "KXBTC-26JUL",
              event_title: "Bitcoin price in July",
              exchange: "kalshi",
              liquidity: 50_000,
              market_id: "KXBTC-26JUL-B100000",
              question: "Will Bitcoin be above $100,000?",
              series_id: "KXBTC",
              slug: null,
              status: "active",
              volume: 80_000,
            },
          ]);
    });
    const service = new MarketSearchService(
      "oddpool-test-key",
      fetchImplementation,
    );

    const polymarket = await service.search("polymarket", "bitcoin");
    const kalshi = await service.search("kalshi", "bitcoin");

    expect(polymarket.results[0]?.url).toBe(
      "https://polymarket.com/event/bitcoin-price-in-july/will-bitcoin-reach-100k-in-july",
    );
    expect(kalshi.results[0]).toMatchObject({
      externalId: "KXBTC-26JUL-B100000",
      title: "$100,000 or above",
      subtitle: "Bitcoin price in July",
      url: "https://kalshi.com/markets/kxbtc/bitcoin-price-in-july/kxbtc-26jul-b100000?market_ticker=KXBTC-26JUL-B100000",
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(5);
    for (
      let index = 1;
      index < requestStartedAtMilliseconds.length;
      index += 1
    ) {
      expect(
        (requestStartedAtMilliseconds[index] ?? 0) -
          (requestStartedAtMilliseconds[index - 1] ?? 0),
      ).toBeGreaterThanOrEqual(190);
    }
  });

  it("keeps complete keyword matches ahead of higher-volume incidental matches", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "external-api.kalshi.com") {
        return jsonResponse({ markets: [], cursor: "" });
      }
      return jsonResponse([
        {
          category: "Politics",
          event_id: "KXTRUMPSAY-26SEP",
          event_title: "What will Trump say?",
          exchange: "kalshi",
          liquidity: 1_000_000,
          market_id: "KXTRUMPSAY-26SEP-RATE",
          question: "Will Trump say Fed rate?",
          series_id: "KXTRUMPSAY",
          slug: null,
          status: "active",
          volume: 10_000_000,
        },
        {
          category: "Economics",
          event_id: "KXFED-26SEP",
          event_title: "Fed funds rate after Sep 2026 meeting?",
          exchange: "kalshi",
          liquidity: 5_000,
          market_id: "KXFED-26SEP-T3.25",
          question:
            "Will the federal funds rate be above 3.25% after the September meeting?",
          series_id: "KXFED",
          slug: null,
          status: "active",
          volume: 5_000,
        },
      ]);
    });
    const service = new MarketSearchService(
      "oddpool-test-key",
      fetchImplementation,
    );

    const response = await service.search("kalshi", "fed rate september");

    expect(response.results.map((result) => result.externalId)).toEqual([
      "KXFED-26SEP-T3.25",
      "KXTRUMPSAY-26SEP-RATE",
    ]);
  });

  it("uses Kalshi outcome labels when ranking a specific strike search", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "external-api.kalshi.com") {
        return jsonResponse({
          cursor: "",
          markets: [
            {
              status: "open",
              subtitle: "$60,000 or above",
              ticker: "KXBTCD-26JUL24-T59999.99",
              yes_sub_title: "$60,000 or above",
            },
            {
              status: "open",
              subtitle: "$65,000 or above",
              ticker: "KXBTCD-26JUL24-T64999.99",
              yes_sub_title: "$65,000 or above",
            },
          ],
        });
      }
      return jsonResponse([
        {
          event_id: "KXBTCD-26JUL24",
          event_title: "BTC price on Jul 24, 2026?",
          exchange: "kalshi",
          liquidity: 100_000,
          market_id: "KXBTCD-26JUL24-T59999.99",
          question: "Bitcoin price on Jul 24, 2026?",
          series_id: "KXBTCD",
          status: "active",
          volume: 100_000,
        },
        {
          event_id: "KXBTCD-26JUL24",
          event_title: "BTC price on Jul 24, 2026?",
          exchange: "kalshi",
          liquidity: 0,
          market_id: "KXBTCD-26JUL24-T64999.99",
          question: "Bitcoin price on Jul 24, 2026?",
          series_id: "KXBTCD",
          status: "active",
          volume: 0,
        },
      ]);
    });
    const service = new MarketSearchService(
      "oddpool-test-key",
      fetchImplementation,
    );

    const response = await service.search("kalshi", "bitcoin 65000");

    expect(response.results[0]).toMatchObject({
      externalId: "KXBTCD-26JUL24-T64999.99",
      title: "$65,000 or above",
    });
  });

  it("caches identical venue queries to conserve the monthly quota", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => jsonResponse([]));
    const service = new MarketSearchService(
      "oddpool-test-key",
      fetchImplementation,
    );

    await service.search("kalshi", "Fed rates");
    await service.search("kalshi", "fed rates");

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("fails safely when the server credential is absent", async () => {
    const service = new MarketSearchService(null);

    await expect(service.search("kalshi", "bitcoin")).rejects.toEqual(
      expect.objectContaining<Partial<MarketSearchUnavailableError>>({
        status: 503,
      }),
    );
  });
});
