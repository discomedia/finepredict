import { afterEach, describe, expect, it, vi } from "vitest";

import { KalshiRequestScheduler } from "../discovery/kalshi-request-scheduler.js";
import { NativeCatalogClient } from "./native-catalog-client.js";

describe("native catalog client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shares Kalshi pacing with requests made after catalog pagination", async () => {
    const kalshiRequestUrls: string[] = [];
    const requestedWaitsMs: number[] = [];
    const kalshiRequestScheduler = new KalshiRequestScheduler({
      minimumRequestStartSpacingMs: 200,
      waitImplementation: async (delayMs) => {
        requestedWaitsMs.push(delayMs);
      },
      fetchImplementation: async (input) => {
        const url = String(input);
        kalshiRequestUrls.push(url);
        return jsonResponse(
          url.includes("/events")
            ? { cursor: "", events: [] }
            : { cursor: "", markets: [] },
        );
      },
    });
    const polymarketFetch = vi.fn(async () =>
      jsonResponse({ markets: [], next_cursor: "" }),
    );
    vi.stubGlobal("fetch", polymarketFetch);
    const client = new NativeCatalogClient({
      kalshiBaseUrl: "https://kalshi.example",
      polymarketGammaBaseUrl: "https://polymarket.example",
      kalshiRequestScheduler,
    });

    const result = await client.refresh();
    await kalshiRequestScheduler.requestJson(
      "https://kalshi.example/trade-api/v2/market/orderbook",
      "Kalshi orderbook API",
      () => undefined,
    );

    expect(result.requestCount).toBe(3);
    expect(kalshiRequestUrls).toHaveLength(3);
    expect(kalshiRequestUrls.at(-1)).toContain("/orderbook");
    expect(requestedWaitsMs).toHaveLength(2);
    expect(requestedWaitsMs.every((delayMs) => delayMs > 0)).toBe(true);
    expect(polymarketFetch).toHaveBeenCalledTimes(1);
  });

  it("marks a catalog-positive standard outcome set complete in one batch", async () => {
    const kalshiRequestScheduler = new KalshiRequestScheduler({
      waitImplementation: async () => undefined,
      fetchImplementation: async (input) =>
        jsonResponse(
          String(input).includes("/events")
            ? { cursor: "", events: [] }
            : { cursor: "", markets: [] },
        ),
    });
    const polymarketMarkets = [
      polymarketMarket("CONDITION-A", "TOKEN-A-YES", "TOKEN-A-NO", 0.4),
      polymarketMarket("CONDITION-B", "TOKEN-B-YES", "TOKEN-B-NO", 0.5),
    ];
    const polymarketFetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return url.includes("/events?")
        ? jsonResponse([
            {
              id: "123",
              negRisk: true,
              enableNegRisk: true,
              negRiskAugmented: false,
              markets: polymarketMarkets.map((market) => ({
                conditionId: market.conditionId,
                active: true,
                closed: false,
                acceptingOrders: true,
                enableOrderBook: true,
              })),
            },
          ])
        : jsonResponse({ markets: polymarketMarkets, next_cursor: "" });
    });
    vi.stubGlobal("fetch", polymarketFetch);
    const client = new NativeCatalogClient({
      kalshiBaseUrl: "https://kalshi.example",
      polymarketGammaBaseUrl: "https://polymarket.example",
      kalshiRequestScheduler,
    });

    const result = await client.refresh();

    expect(result.requestCount).toBe(4);
    expect(result.markets).toHaveLength(2);
    expect(
      result.markets.every(
        (market) =>
          market.providerEventId === "123" &&
          market.negativeRiskAugmented === false &&
          market.eventOutcomeSetComplete === true,
      ),
    ).toBe(true);
    expect(
      polymarketFetch.mock.calls.filter(([input]) =>
        String(input).includes("/events?"),
      ),
    ).toHaveLength(1);
  });

  it("rejects a set when the provider event contains an omitted child", async () => {
    const kalshiRequestScheduler = new KalshiRequestScheduler({
      waitImplementation: async () => undefined,
      fetchImplementation: async (input) =>
        jsonResponse(
          String(input).includes("/events")
            ? { cursor: "", events: [] }
            : { cursor: "", markets: [] },
        ),
    });
    const polymarketMarkets = [
      polymarketMarket("CONDITION-A", "TOKEN-A-YES", "TOKEN-A-NO", 0.4),
      polymarketMarket("CONDITION-B", "TOKEN-B-YES", "TOKEN-B-NO", 0.5),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input).includes("/events?")
          ? jsonResponse([
              {
                id: "123",
                negRisk: true,
                enableNegRisk: true,
                negRiskAugmented: false,
                markets: [
                  ...polymarketMarkets.map((market) => ({
                    conditionId: market.conditionId,
                    active: true,
                    closed: false,
                    acceptingOrders: true,
                    enableOrderBook: true,
                  })),
                  {
                    conditionId: "HIDDEN-CONDITION",
                    active: false,
                    closed: true,
                    acceptingOrders: false,
                    enableOrderBook: true,
                  },
                ],
              },
            ])
          : jsonResponse({ markets: polymarketMarkets, next_cursor: "" }),
      ),
    );
    const client = new NativeCatalogClient({
      kalshiBaseUrl: "https://kalshi.example",
      polymarketGammaBaseUrl: "https://polymarket.example",
      kalshiRequestScheduler,
    });

    const result = await client.refresh();

    expect(
      result.markets.every(
        (market) => market.eventOutcomeSetComplete === undefined,
      ),
    ).toBe(true);
  });
});

/**
 * Creates one active binary Gamma market in a standard negative-risk event.
 *
 * @param conditionId - Venue condition identifier.
 * @param yesTokenId - YES CLOB token identifier.
 * @param noTokenId - NO CLOB token identifier.
 * @param bestAsk - Catalog YES ask.
 * @returns Gamma market fixture.
 */
function polymarketMarket(
  conditionId: string,
  yesTokenId: string,
  noTokenId: string,
  bestAsk: number,
): Record<string, unknown> {
  return {
    conditionId,
    question: `Will ${conditionId} win?`,
    slug: conditionId.toLocaleLowerCase("en-US"),
    active: true,
    closed: false,
    enableOrderBook: true,
    acceptingOrders: true,
    outcomes: JSON.stringify(["Yes", "No"]),
    clobTokenIds: JSON.stringify([yesTokenId, noTokenId]),
    bestAsk,
    bestBid: 1 - bestAsk - 0.01,
    negRisk: true,
    events: [
      {
        id: "123",
        slug: "complete-event",
        title: "Complete event",
        negRisk: true,
        enableNegRisk: true,
        negRiskAugmented: false,
      },
    ],
  };
}

/**
 * Creates one successful JSON response for a request fixture.
 *
 * @param body - Serializable response value.
 * @returns Successful fetch response.
 */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
