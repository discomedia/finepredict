import { describe, expect, it } from "vitest";

import { fetchPolymarketContract } from "./polymarket.js";

describe("fetchPolymarketContract", () => {
  it("fetches the exact child market from a nested public route", async () => {
    const requestedUrls: string[] = [];
    const fetchImplementation = (async (input: string | URL | Request) => {
      requestedUrls.push(String(input));
      return Response.json({
        active: true,
        closed: false,
        description: "This market resolves Yes according to Coinbase.",
        endDate: "2026-07-31T23:59:00Z",
        id: "market-1",
        question: "Will Bitcoin reach $100,000 in July?",
        slug: "will-bitcoin-reach-100k-in-july",
      });
    }) as typeof fetch;

    const contract = await fetchPolymarketContract(
      "https://polymarket.com/event/bitcoin-price-in-july/will-bitcoin-reach-100k-in-july",
      fetchImplementation,
    );

    expect(contract.externalId).toBe("market-1");
    expect(requestedUrls).toEqual([
      "https://gamma-api.polymarket.com/markets/slug/will-bitcoin-reach-100k-in-july",
    ]);
  });
});
