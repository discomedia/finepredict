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
      requestStartedAtMilliseconds.push(Date.now());
      const url = new URL(String(input));
      const platform = url.searchParams.get("exchange");
      expect(url.pathname).toBe("/search/markets");
      expect(url.searchParams.get("q")).toBe("bitcoin");
      expect(url.searchParams.get("sort_by")).toBe("relevance");
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
              question: "Will Bitcoin reach $100,000 in July?",
              series_id: null,
              slug: "will-bitcoin-reach-100k-in-july",
              status: "active",
            },
          ])
        : jsonResponse([
            {
              category: "Crypto",
              event_id: "KXBTC-26JUL",
              event_title: "Bitcoin price in July",
              exchange: "kalshi",
              market_id: "KXBTC-26JUL-B100000",
              question: "Will Bitcoin be above $100,000?",
              series_id: "KXBTC",
              slug: null,
              status: "active",
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
      url: "https://kalshi.com/markets/kxbtc/bitcoin-price-in-july/kxbtc-26jul-b100000",
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(
      (requestStartedAtMilliseconds[1] ?? 0) -
        (requestStartedAtMilliseconds[0] ?? 0),
    ).toBeGreaterThanOrEqual(190);
  });

  it("caches identical venue queries to conserve the monthly quota", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse([]));
    const service = new MarketSearchService(
      "oddpool-test-key",
      fetchImplementation,
    );

    await service.search("kalshi", "Fed rates");
    await service.search("kalshi", "fed rates");

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
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
