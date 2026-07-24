import { z } from "zod";

import { fetchJson } from "../common/http.js";
import type {
  AskLevel,
  BinaryOrderBookSnapshot,
  PolymarketMarketDetails,
} from "../common/types.js";
import type {
  DirectPairContext,
  DirectPairSnapshot,
  PairMarketDataSource,
} from "./types.js";

const fixedPointLevelSchema = z.tuple([
  z.coerce.number().min(0).max(1),
  z.coerce.number().positive(),
]);

const kalshiOrderBookSchema = z.object({
  orderbook_fp: z.object({
    yes_dollars: z.array(fixedPointLevelSchema).default([]),
    no_dollars: z.array(fixedPointLevelSchema).default([]),
  }),
});

const polymarketLevelSchema = z.object({
  price: z.coerce.number().min(0).max(1),
  size: z.coerce.number().positive(),
});

const polymarketOrderBookSchema = z.object({
  market: z.string(),
  asset_id: z.string(),
  timestamp: z.union([z.string(), z.number()]),
  asks: z.array(polymarketLevelSchema).default([]),
});
const polymarketOrderBooksSchema = z.array(polymarketOrderBookSchema);

/** Results from one bounded batch of direct cross-venue order-book requests. */
export interface DirectPairSnapshotBatch {
  /** Successfully collected pair snapshots keyed by stable pair ID. */
  readonly snapshotsByPairId: ReadonlyMap<string, DirectPairSnapshot>;
  /** Safe per-pair failure messages keyed by stable pair ID. */
  readonly errorsByPairId: ReadonlyMap<string, string>;
  /** External HTTP requests consumed by this batch. */
  readonly requestCount: number;
}

/** Configuration for direct public order-book requests. */
export interface DirectMarketDataClientOptions {
  /** Kalshi trade API base URL. */
  readonly kalshiBaseUrl?: string;
  /** Polymarket CLOB API base URL. */
  readonly polymarketBaseUrl?: string;
}

/** Direct read-only REST client used as the paper engine's price source. */
export class DirectMarketDataClient implements PairMarketDataSource {
  private readonly kalshiBaseUrl: string;
  private readonly polymarketBaseUrl: string;
  private externalRequestCount = 0;

  /**
   * Creates a direct venue market-data client.
   *
   * @param options - Optional venue base URLs used by tests and sandboxes.
   */
  public constructor(options: DirectMarketDataClientOptions = {}) {
    this.kalshiBaseUrl =
      options.kalshiBaseUrl ?? "https://external-api.kalshi.com/trade-api/v2";
    this.polymarketBaseUrl =
      options.polymarketBaseUrl ?? "https://clob.polymarket.com";
  }

  /**
   * Gets fresh direct books for a complete cross-venue pair.
   *
   * @param context - Pair and Polymarket outcome-token identifiers.
   * @returns Normalized Kalshi and Polymarket binary ask ladders.
   */
  public async getPairSnapshot(
    context: DirectPairContext,
  ): Promise<DirectPairSnapshot> {
    const startedAtMs = Date.now();
    const [kalshi, polymarket] = await Promise.all([
      this.getKalshiBinaryOrderBook(context.pair.kalshi.marketId),
      this.getPolymarketBinaryOrderBook(context.polymarketDetails),
    ]);
    const collectedAtMs = Date.now();
    return {
      pair: context.pair,
      kalshi,
      polymarket,
      collectedAtMs,
      collectionDurationMs: collectedAtMs - startedAtMs,
    };
  }

  /**
   * Gets many pair snapshots while batching all Polymarket token books into as
   * few requests as possible and bounding Kalshi request concurrency.
   *
   * @param contexts - Unique cross-venue pairs to collect.
   * @param kalshiConcurrency - Maximum simultaneous Kalshi order-book calls.
   * @returns Successful snapshots, per-pair errors, and exact request count.
   */
  public async getPairSnapshots(
    contexts: readonly DirectPairContext[],
    kalshiConcurrency: number,
  ): Promise<DirectPairSnapshotBatch> {
    if (!Number.isInteger(kalshiConcurrency) || kalshiConcurrency < 1) {
      throw new Error("kalshiConcurrency must be a positive integer");
    }
    const startedAtMs = Date.now();
    const requestCountBefore = this.externalRequestCount;
    const errorsByPairId = new Map<string, string>();
    const uniqueDetails = [
      ...new Map(
        contexts.map((context) => [
          context.polymarketDetails.conditionId,
          context.polymarketDetails,
        ]),
      ).values(),
    ];
    let polymarketByConditionId: ReadonlyMap<string, BinaryOrderBookSnapshot>;
    try {
      polymarketByConditionId =
        await this.getPolymarketBinaryOrderBooks(uniqueDetails);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      for (const context of contexts) {
        errorsByPairId.set(context.pair.pairId, message);
      }
      return {
        snapshotsByPairId: new Map(),
        errorsByPairId,
        requestCount: this.externalRequestCount - requestCountBefore,
      };
    }
    const uniqueKalshiMarketIds = [
      ...new Set(contexts.map((context) => context.pair.kalshi.marketId)),
    ];
    const kalshiResults = await mapWithConcurrency(
      uniqueKalshiMarketIds,
      kalshiConcurrency,
      async (marketId) => {
        try {
          return {
            marketId,
            snapshot: await this.getKalshiBinaryOrderBook(marketId),
          };
        } catch (error: unknown) {
          return {
            marketId,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
    const kalshiByMarketId = new Map<string, BinaryOrderBookSnapshot>();
    const kalshiErrorsByMarketId = new Map<string, string>();
    for (const result of kalshiResults) {
      if (result.snapshot) {
        kalshiByMarketId.set(result.marketId, result.snapshot);
      } else {
        kalshiErrorsByMarketId.set(
          result.marketId,
          result.error ?? "Unknown Kalshi order-book failure",
        );
      }
    }
    const snapshotsByPairId = new Map<string, DirectPairSnapshot>();
    for (const context of contexts) {
      const kalshi = kalshiByMarketId.get(context.pair.kalshi.marketId);
      const polymarket = polymarketByConditionId.get(
        context.polymarketDetails.conditionId,
      );
      if (!kalshi) {
        errorsByPairId.set(
          context.pair.pairId,
          kalshiErrorsByMarketId.get(context.pair.kalshi.marketId) ??
            "Kalshi order book was missing from the batch",
        );
        continue;
      }
      if (!polymarket) {
        errorsByPairId.set(
          context.pair.pairId,
          `Polymarket order book was missing for ${context.polymarketDetails.conditionId}`,
        );
        continue;
      }
      const collectedAtMs = Date.now();
      snapshotsByPairId.set(context.pair.pairId, {
        pair: context.pair,
        kalshi,
        polymarket,
        collectedAtMs,
        collectionDurationMs: collectedAtMs - startedAtMs,
      });
    }
    return {
      snapshotsByPairId,
      errorsByPairId,
      requestCount: this.externalRequestCount - requestCountBefore,
    };
  }

  /**
   * Returns the total public requests made by this client instance.
   *
   * @returns Monotonic external request count.
   */
  public get requestCount(): number {
    return this.externalRequestCount;
  }

  /**
   * Gets Kalshi bids and converts their binary complements into executable asks.
   *
   * @param marketTicker - Kalshi market ticker.
   * @returns Normalized YES and NO ask ladders.
   */
  public async getKalshiBinaryOrderBook(
    marketTicker: string,
  ): Promise<BinaryOrderBookSnapshot> {
    const url = new URL(
      `/trade-api/v2/markets/${encodeURIComponent(marketTicker)}/orderbook`,
      this.kalshiBaseUrl,
    );
    url.searchParams.set("depth", "0");
    this.externalRequestCount += 1;
    const parsed = kalshiOrderBookSchema.parse(
      await fetchJson(url, undefined, "Kalshi orderbook API"),
    );
    return {
      marketId: marketTicker,
      timestampMs: Date.now(),
      yesAsks: bidsToComplementaryAsks(parsed.orderbook_fp.no_dollars),
      noAsks: bidsToComplementaryAsks(parsed.orderbook_fp.yes_dollars),
    };
  }

  /**
   * Gets both Polymarket outcome-token books without inferring one from the other.
   *
   * @param details - Condition and YES/NO token identifiers.
   * @returns Normalized YES and NO ask ladders.
   */
  public async getPolymarketBinaryOrderBook(
    details: PolymarketMarketDetails,
  ): Promise<BinaryOrderBookSnapshot> {
    const [yesBook, noBook] = await Promise.all([
      this.getPolymarketTokenBook(details.yesTokenId),
      this.getPolymarketTokenBook(details.noTokenId),
    ]);
    if (
      yesBook.market !== details.conditionId ||
      noBook.market !== details.conditionId
    ) {
      throw new Error(
        `Polymarket token books did not match condition ${details.conditionId}`,
      );
    }
    return {
      marketId: details.conditionId,
      timestampMs: Math.max(
        parseProviderTimestampMs(yesBook.timestamp),
        parseProviderTimestampMs(noBook.timestamp),
      ),
      yesAsks: normalizeAskLevels(yesBook.asks),
      noAsks: normalizeAskLevels(noBook.asks),
    };
  }

  /**
   * Gets many Polymarket binary order books through the public batch endpoint.
   * The provider accepts at most 500 token IDs per call, so requests are
   * chunked deterministically.
   *
   * @param details - Conditions and their YES/NO token identifiers.
   * @returns Binary books keyed by condition ID.
   */
  public async getPolymarketBinaryOrderBooks(
    details: readonly PolymarketMarketDetails[],
  ): Promise<ReadonlyMap<string, BinaryOrderBookSnapshot>> {
    const tokenIds = [
      ...new Set(
        details.flatMap((detail) => [detail.yesTokenId, detail.noTokenId]),
      ),
    ];
    const rawByTokenId = new Map<
      string,
      z.infer<typeof polymarketOrderBookSchema>
    >();
    for (let index = 0; index < tokenIds.length; index += 500) {
      const chunk = tokenIds.slice(index, index + 500);
      const url = new URL("/books", this.polymarketBaseUrl);
      this.externalRequestCount += 1;
      const parsed = polymarketOrderBooksSchema.parse(
        await fetchJson(
          url,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(
              chunk.map((tokenId) => ({ token_id: tokenId })),
            ),
          },
          "Polymarket batch orderbook API",
        ),
      );
      for (const book of parsed) {
        rawByTokenId.set(book.asset_id, book);
      }
    }
    const booksByConditionId = new Map<string, BinaryOrderBookSnapshot>();
    for (const detail of details) {
      const yesBook = rawByTokenId.get(detail.yesTokenId);
      const noBook = rawByTokenId.get(detail.noTokenId);
      if (!yesBook || !noBook) {
        throw new Error(
          `Polymarket batch omitted tokens for ${detail.conditionId}`,
        );
      }
      if (
        yesBook.market !== detail.conditionId ||
        noBook.market !== detail.conditionId
      ) {
        throw new Error(
          `Polymarket token books did not match condition ${detail.conditionId}`,
        );
      }
      booksByConditionId.set(detail.conditionId, {
        marketId: detail.conditionId,
        timestampMs: Math.max(
          parseProviderTimestampMs(yesBook.timestamp),
          parseProviderTimestampMs(noBook.timestamp),
        ),
        yesAsks: normalizeAskLevels(yesBook.asks),
        noAsks: normalizeAskLevels(noBook.asks),
      });
    }
    return booksByConditionId;
  }

  /**
   * Gets one Polymarket token order book.
   *
   * @param tokenId - Polymarket outcome token identifier.
   * @returns Validated raw token-book fields needed for normalization.
   */
  private async getPolymarketTokenBook(
    tokenId: string,
  ): Promise<z.infer<typeof polymarketOrderBookSchema>> {
    const url = new URL("/book", this.polymarketBaseUrl);
    url.searchParams.set("token_id", tokenId);
    this.externalRequestCount += 1;
    const parsed = polymarketOrderBookSchema.parse(
      await fetchJson(url, undefined, "Polymarket orderbook API"),
    );
    if (parsed.asset_id !== tokenId) {
      throw new Error(
        `Polymarket returned token ${parsed.asset_id} for ${tokenId}`,
      );
    }
    return parsed;
  }
}

/**
 * Maps values with a strict worker bound while preserving input order.
 *
 * @param values - Source values.
 * @param concurrency - Maximum workers.
 * @param mapper - Async mapping function.
 * @returns Ordered mapped results.
 */
async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<readonly R[]> {
  const results: R[] = new Array(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        const value = values[index];
        if (value !== undefined) {
          results[index] = await mapper(value);
        }
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/**
 * Converts binary outcome bids into asks for the complementary outcome.
 *
 * @param bids - Fixed-point price and quantity bid levels.
 * @returns Ascending complementary ask ladder.
 */
export function bidsToComplementaryAsks(
  bids: readonly (readonly [number, number])[],
): readonly AskLevel[] {
  return bids
    .map(([priceDollars, sizeShares]) => ({
      priceDollars: round(1 - priceDollars, 4),
      sizeShares,
    }))
    .sort((left, right) => left.priceDollars - right.priceDollars);
}

/**
 * Parses provider timestamps supplied as milliseconds, seconds, or ISO strings.
 *
 * @param value - Provider timestamp value.
 * @returns Unix timestamp in milliseconds.
 */
export function parseProviderTimestampMs(value: string | number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(numeric)) {
    return numeric < 100_000_000_000 ? numeric * 1_000 : numeric;
  }
  const parsed = Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid provider timestamp ${String(value)}`);
  }
  return parsed;
}

/**
 * Sorts raw ask levels and maps them to the shared representation.
 *
 * @param asks - Polymarket price and quantity objects.
 * @returns Ascending normalized ask ladder.
 */
function normalizeAskLevels(
  asks: readonly { readonly price: number; readonly size: number }[],
): readonly AskLevel[] {
  return asks
    .map((ask) => ({
      priceDollars: ask.price,
      sizeShares: ask.size,
    }))
    .sort((left, right) => left.priceDollars - right.priceDollars);
}

/**
 * Rounds a number for stable market-data normalization.
 *
 * @param value - Numeric value.
 * @param decimals - Decimal places retained.
 * @returns Rounded numeric value.
 */
function round(value: number, decimals: number): number {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}
