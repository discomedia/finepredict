import { describe, expect, it } from "vitest";

import { fetchKalshiContract } from "./kalshi.js";

/**
 * Creates a JSON response with a successful HTTP status.
 *
 * @param body - Response data to serialize.
 * @returns HTTP JSON response.
 */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
}

describe("fetchKalshiContract", () => {
  it("uses the terminal ticker in Kalshi's series, slug, and event URL route", async () => {
    const requestedUrls: string[] = [];
    const fetchImplementation = (async (input: string | URL | Request) => {
      const requestedUrl = String(input);
      requestedUrls.push(requestedUrl);
      if (requestedUrl.endsWith("/markets/KXMENWORLDCUP-26")) {
        return new Response(null, { status: 404 });
      }
      if (
        requestedUrl ===
        "https://external-api.kalshi.com/trade-api/v2/events/KXMENWORLDCUP-26?with_nested_markets=true"
      ) {
        return jsonResponse({
          event: {
            event_ticker: "KXMENWORLDCUP-26",
            markets: [
              {
                close_time: "2026-07-19T14:00:00Z",
                event_ticker: "KXMENWORLDCUP-26",
                open_time: "2025-05-15T14:00:00Z",
                rules_primary:
                  "If Spain wins the 2026 Men's World Cup, this market resolves to Yes.",
                status: "open",
                ticker: "KXMENWORLDCUP-26-ESP",
              },
            ],
            title: "Men's World Cup winner",
          },
        });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;

    const contract = await fetchKalshiContract(
      "https://kalshi.com/markets/kxmenworldcup/mens-world-cup-winner/kxmenworldcup-26",
      fetchImplementation,
    );

    expect(contract.externalId).toBe("KXMENWORLDCUP-26");
    expect(contract.title).toBe("Men's World Cup winner");
    expect(requestedUrls).toEqual([
      "https://external-api.kalshi.com/trade-api/v2/markets/KXMENWORLDCUP-26",
      "https://external-api.kalshi.com/trade-api/v2/events/KXMENWORLDCUP-26?with_nested_markets=true",
    ]);
  });
});
