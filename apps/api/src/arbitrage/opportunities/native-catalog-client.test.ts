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
});

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
