import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MarketPair } from "../common/types.js";
import { DirectMarketDataClient } from "./direct-market-data-client.js";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    response.setHeader("content-type", "application/json");
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/trade-api/v2/markets/KXTEST/orderbook") {
      response.end(
        JSON.stringify({
          orderbook_fp: {
            yes_dollars: [["0.2000", "8.00"]],
            no_dollars: [["0.7000", "6.00"]],
          },
        }),
      );
      return;
    }
    if (url.pathname === "/trade-api/v2/markets/KXTEST2/orderbook") {
      response.end(
        JSON.stringify({
          orderbook_fp: {
            yes_dollars: [["0.3000", "8.00"]],
            no_dollars: [["0.6000", "6.00"]],
          },
        }),
      );
      return;
    }
    if (request.method === "POST" && url.pathname === "/books") {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk: string) => {
        body += chunk;
      });
      request.on("end", () => {
        const requested = JSON.parse(body) as {
          readonly token_id: string;
        }[];
        response.end(
          JSON.stringify(
            requested.map(({ token_id }) => ({
              market: token_id.startsWith("second") ? "0xdef" : "0xabc",
              asset_id: token_id,
              timestamp: "1700000000010",
              asks: [
                {
                  price: token_id.includes("yes") ? "0.55" : "0.45",
                  size: "9",
                },
              ],
            })),
          ),
        );
      });
      return;
    }
    if (
      url.pathname === "/book" &&
      url.searchParams.get("token_id") === "yes-token"
    ) {
      response.end(
        JSON.stringify({
          market: "0xabc",
          asset_id: "yes-token",
          timestamp: "1700000000000",
          asks: [{ price: "0.55", size: "7" }],
        }),
      );
      return;
    }
    if (
      url.pathname === "/book" &&
      url.searchParams.get("token_id") === "no-token"
    ) {
      response.end(
        JSON.stringify({
          market: "0xabc",
          asset_id: "no-token",
          timestamp: "1700000000010",
          asks: [{ price: "0.45", size: "9" }],
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  });
  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test HTTP server did not expose a TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.close((error) => {
      if (error) {
        rejectPromise(error);
      } else {
        resolvePromise();
      }
    });
  });
});

/**
 * Creates a verified pair fixture for direct API normalization.
 *
 * @returns Verified cross-venue pair.
 */
function pairFixture(
  pairId = "pair",
  kalshiMarketId = "KXTEST",
  polymarketMarketId = "0xabc",
): MarketPair {
  return {
    pairId,
    kalshi: {
      marketId: kalshiMarketId,
      exchange: "kalshi",
      seriesId: "KXTEST",
      question: "Will it happen?",
      status: "active",
      volume: 10,
      liquidity: 10,
      eventId: "KX-EVENT",
      eventTitle: "Test",
    },
    polymarket: {
      marketId: polymarketMarketId,
      exchange: "polymarket",
      question: "Will it happen?",
      status: "active",
      volume: 10,
      liquidity: 10,
      eventId: "POLY-EVENT",
      eventTitle: "Test",
    },
    similarityPercent100: 100,
    confidence: "verified",
    matchReasons: ["Reviewed"],
  };
}

describe("direct venue market data", () => {
  it("reads both venue books and normalizes complementary Kalshi asks", async () => {
    const client = new DirectMarketDataClient({
      kalshiBaseUrl: baseUrl,
      polymarketBaseUrl: baseUrl,
    });
    const snapshot = await client.getPairSnapshot({
      pair: pairFixture(),
      polymarketDetails: {
        conditionId: "0xabc",
        yesTokenId: "yes-token",
        noTokenId: "no-token",
        description: "Fixture",
        tags: [],
        minimumOrderSizeShares: 5,
      },
    });
    expect(snapshot.kalshi.yesAsks[0]).toEqual({
      priceDollars: 0.3,
      sizeShares: 6,
    });
    expect(snapshot.kalshi.noAsks[0]).toEqual({
      priceDollars: 0.8,
      sizeShares: 8,
    });
    expect(snapshot.polymarket.yesAsks[0]?.priceDollars).toBe(0.55);
    expect(snapshot.polymarket.noAsks[0]?.priceDollars).toBe(0.45);
  });

  it("batches Polymarket books so two pairs use three HTTP requests", async () => {
    const client = new DirectMarketDataClient({
      kalshiBaseUrl: baseUrl,
      polymarketBaseUrl: baseUrl,
    });
    const contexts = [
      {
        pair: pairFixture(),
        polymarketDetails: {
          conditionId: "0xabc",
          yesTokenId: "yes-token",
          noTokenId: "no-token",
          description: "Fixture",
          tags: [],
          minimumOrderSizeShares: 5,
        },
      },
      {
        pair: pairFixture("pair-2", "KXTEST2", "0xdef"),
        polymarketDetails: {
          conditionId: "0xdef",
          yesTokenId: "second-yes-token",
          noTokenId: "second-no-token",
          description: "Second fixture",
          tags: [],
          minimumOrderSizeShares: 5,
        },
      },
    ];

    const batch = await client.getPairSnapshots(contexts, 2);

    expect(batch.snapshotsByPairId.size).toBe(2);
    expect(batch.errorsByPairId.size).toBe(0);
    expect(batch.requestCount).toBe(3);
    expect(client.requestCount).toBe(3);
  });
});
