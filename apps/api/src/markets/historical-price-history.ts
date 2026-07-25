import type { MarketPlatform } from "@finepredict/shared";
import { z } from "zod";

import { ExternalServiceUnavailableError, fetchJson } from "./platform.js";

/** Public Polymarket CLOB endpoint used for batched historical prices. */
const POLYMARKET_CLOB_BASE_URL = "https://clob.polymarket.com";

/** Public Kalshi Trade API endpoint used for historical candles. */
const KALSHI_TRADE_API_BASE_URL =
  "https://external-api.kalshi.com/trade-api/v2";

/** Maximum number of output points retained for one venue series. */
export const maximumHistoricalPricePoints = 500;

/** Duration of the process-local historical price cache. */
const HISTORICAL_PRICE_CACHE_MILLISECONDS = 10 * 60 * 1_000;

/** Maximum number of Polymarket assets accepted by one batch request. */
const POLYMARKET_BATCH_SIZE = 20;

/** Raw timestamped price returned by a venue history endpoint. */
const RawPricePointSchema = z.object({
  p: z.union([z.number(), z.string()]),
  t: z.union([z.number(), z.string()]),
});

/** Polymarket batched price-history response. */
const PolymarketBatchHistorySchema = z.object({
  history: z.record(z.string(), z.array(RawPricePointSchema)),
});

/** Kalshi candle price fields used to construct a Yes-price series. */
const KalshiCandleSchema = z.object({
  end_period_ts: z.union([z.number(), z.string()]),
  price: z.object({
    close_dollars: z.union([z.number(), z.string()]).nullish(),
  }),
  yes_ask: z
    .object({
      close_dollars: z.union([z.number(), z.string()]).nullish(),
    })
    .nullish(),
});

/** Kalshi batched candle response. */
const KalshiBatchHistorySchema = z.object({
  markets: z.array(
    z.object({
      ticker: z.string().optional(),
      candlesticks: z.array(KalshiCandleSchema),
    }),
  ),
});

/** One native market identifier required to retrieve historical Yes prices. */
export interface HistoricalPriceMarketRequest {
  /** Venue owning the market. */
  readonly platform: MarketPlatform;
  /** Venue-native market or ticker identifier. */
  readonly externalId: string;
  /** Polymarket Yes token identifier, when the market is on Polymarket. */
  readonly yesTokenId?: string;
  /** Venue-reported contract start, when available. */
  readonly startDateIso?: string;
}

/** One normalized venue Yes-price point. */
export interface HistoricalPricePoint {
  /** ISO timestamp supplied by the venue. */
  readonly timestampIso: string;
  /** Venue Yes price on the product's scale-1 convention. */
  readonly yesPriceDollars: number;
}

/** Result for one requested market's public historical prices. */
export interface HistoricalPriceSeries {
  /** Requested market identity. */
  readonly market: HistoricalPriceMarketRequest;
  /** Whether the venue returned at least one usable point. */
  readonly available: boolean;
  /** Normalized, sorted, bounded price points. */
  readonly points: readonly HistoricalPricePoint[];
  /** Safe user-facing failure explanation when unavailable. */
  readonly message?: string;
}

/** Cached batch result and its local expiry. */
interface CachedHistoricalPriceBatch {
  /** Cache expiry in Unix milliseconds. */
  readonly expiresAt: number;
  /** Historical series for the requested markets. */
  readonly series: readonly HistoricalPriceSeries[];
}

/** Read-only historical market-price loader with bounded venue traffic. */
export class HistoricalMarketPriceService {
  private readonly cache = new Map<string, CachedHistoricalPriceBatch>();
  private readonly inFlight = new Map<
    string,
    Promise<readonly HistoricalPriceSeries[]>
  >();

  /**
   * Creates the historical market-price loader.
   *
   * @param fetchImplementation - HTTP implementation, injectable for tests.
   */
  public constructor(
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  /**
   * Loads full available price history for a deduplicated market set.
   *
   * @param markets - Native markets whose Yes prices should be loaded.
   * @returns One bounded series per unique requested market.
   */
  public async getHistoricalPriceSeries(
    markets: readonly HistoricalPriceMarketRequest[],
  ): Promise<readonly HistoricalPriceSeries[]> {
    const uniqueMarkets = deduplicateMarkets(markets);
    if (uniqueMarkets.length === 0) {
      return [];
    }
    const cacheKey = createBatchCacheKey(uniqueMarkets);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.series;
    }
    const existingRequest = this.inFlight.get(cacheKey);
    if (existingRequest) {
      return existingRequest;
    }
    const request = this.loadBatch(uniqueMarkets).then((series) => {
      this.cache.set(cacheKey, {
        expiresAt: Date.now() + HISTORICAL_PRICE_CACHE_MILLISECONDS,
        series,
      });
      this.inFlight.delete(cacheKey);
      return series;
    });
    this.inFlight.set(cacheKey, request);
    return request;
  }

  /**
   * Loads one venue-batched historical response per platform.
   *
   * @param markets - Unique market requests.
   * @returns Normalized series, including unavailable markets.
   */
  private async loadBatch(
    markets: readonly HistoricalPriceMarketRequest[],
  ): Promise<readonly HistoricalPriceSeries[]> {
    const grouped = new Map<MarketPlatform, HistoricalPriceMarketRequest[]>();
    for (const market of markets) {
      const group = grouped.get(market.platform) ?? [];
      group.push(market);
      grouped.set(market.platform, group);
    }
    const results = await Promise.all(
      [...grouped.entries()].map(async ([platform, platformMarkets]) => {
        try {
          return platform === "polymarket"
            ? await this.loadPolymarket(platformMarkets)
            : await this.loadKalshi(platformMarkets);
        } catch (error) {
          const message =
            error instanceof ExternalServiceUnavailableError
              ? error.message
              : `${platform} historical prices are temporarily unavailable.`;
          return platformMarkets.map((market) => ({
            market,
            available: false,
            points: [],
            message,
          }));
        }
      }),
    );
    return results.flat();
  }

  /**
   * Loads Polymarket histories in batches of at most twenty tokens.
   *
   * @param markets - Polymarket market requests.
   * @returns Normalized Polymarket histories.
   */
  private async loadPolymarket(
    markets: readonly HistoricalPriceMarketRequest[],
  ): Promise<readonly HistoricalPriceSeries[]> {
    const output = new Map<string, HistoricalPricePoint[]>();
    const fidelity = choosePolymarketFidelity(markets);
    for (const batch of chunk(markets, POLYMARKET_BATCH_SIZE)) {
      const tokenIds = batch.map((market) => market.yesTokenId);
      if (tokenIds.some((tokenId) => !tokenId)) {
        throw new Error("A Polymarket market is missing its Yes token ID.");
      }
      const response = PolymarketBatchHistorySchema.parse(
        await fetchJsonRequest(
          `${POLYMARKET_CLOB_BASE_URL}/batch-prices-history`,
          "Polymarket CLOB API",
          this.fetchImplementation,
          {
            method: "POST",
            body: JSON.stringify({
              markets: tokenIds,
              interval: "max",
              fidelity,
            }),
          },
        ),
      );
      for (const market of batch) {
        const rawPoints = response.history[market.yesTokenId ?? ""] ?? [];
        output.set(market.externalId, normalizePricePoints(rawPoints));
      }
    }
    return markets.map((market) =>
      toHistoricalSeries(market, output.get(market.externalId) ?? []),
    );
  }

  /**
   * Loads Kalshi histories with one multi-ticker candle request.
   *
   * @param markets - Kalshi market requests.
   * @returns Normalized Kalshi histories.
   */
  private async loadKalshi(
    markets: readonly HistoricalPriceMarketRequest[],
  ): Promise<readonly HistoricalPriceSeries[]> {
    const startTimestampSeconds = chooseKalshiStartTimestamp(markets);
    const endTimestampSeconds = Math.floor(Date.now() / 1_000);
    const periodInterval = chooseKalshiPeriodInterval(startTimestampSeconds);
    const response = KalshiBatchHistorySchema.parse(
      await fetchJson(
        `${KALSHI_TRADE_API_BASE_URL}/markets/candlesticks?${new URLSearchParams(
          {
            end_ts: String(endTimestampSeconds),
            include_latest_before_start: "true",
            market_tickers: markets
              .map((market) => market.externalId)
              .join(","),
            period_interval: String(periodInterval),
            start_ts: String(startTimestampSeconds),
          },
        ).toString()}`,
        "Kalshi Trade API",
        this.fetchImplementation,
      ),
    );
    const byTicker = new Map(
      response.markets.map((market, index) => [
        market.ticker ?? markets[index]?.externalId,
        normalizePricePoints(
          market.candlesticks.map((candle) => ({
            p:
              candle.price.close_dollars ?? candle.yes_ask?.close_dollars ?? "",
            t: candle.end_period_ts,
          })),
        ),
      ]),
    );
    return markets.map((market) =>
      toHistoricalSeries(market, byTicker.get(market.externalId) ?? []),
    );
  }
}

/**
 * Executes a JSON request with the same safe upstream error model as GET calls.
 *
 * @param url - External endpoint URL.
 * @param serviceName - Human-readable upstream service name.
 * @param fetchImplementation - HTTP implementation.
 * @param init - Request method and body.
 * @returns Parsed JSON response.
 */
async function fetchJsonRequest(
  url: string,
  serviceName: string,
  fetchImplementation: typeof fetch,
  init: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new ExternalServiceUnavailableError(serviceName, null, error);
  }
  if (!response.ok) {
    throw new ExternalServiceUnavailableError(serviceName, response.status);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new ExternalServiceUnavailableError(
      serviceName,
      response.status,
      error,
    );
  }
}

/**
 * Removes duplicate venue/market requests while retaining stable order.
 *
 * @param markets - Raw market requests.
 * @returns Unique market requests.
 */
function deduplicateMarkets(
  markets: readonly HistoricalPriceMarketRequest[],
): HistoricalPriceMarketRequest[] {
  const unique = new Map<string, HistoricalPriceMarketRequest>();
  for (const market of markets) {
    unique.set(`${market.platform}:${market.externalId}`, market);
  }
  return [...unique.values()];
}

/**
 * Creates a stable cache key for a batched market request.
 *
 * @param markets - Unique market requests.
 * @returns Stable cache key.
 */
function createBatchCacheKey(
  markets: readonly HistoricalPriceMarketRequest[],
): string {
  return markets
    .map(
      (market) =>
        `${market.platform}:${market.externalId}:${market.yesTokenId ?? ""}:${market.startDateIso ?? ""}`,
    )
    .sort()
    .join("|");
}

/**
 * Selects a Polymarket minute fidelity targeting roughly 500 raw points.
 *
 * @param markets - Markets sharing one batch request.
 * @returns Venue fidelity in minutes.
 */
function choosePolymarketFidelity(
  markets: readonly HistoricalPriceMarketRequest[],
): number {
  const start = earliestStartTimestampMilliseconds(markets);
  const durationMinutes = Math.max(60, (Date.now() - start) / (60 * 1_000));
  return Math.max(
    60,
    Math.ceil(durationMinutes / maximumHistoricalPricePoints),
  );
}

/**
 * Selects Kalshi's lightest useful supported candle interval.
 *
 * @param startTimestampSeconds - Earliest requested start in Unix seconds.
 * @returns Kalshi candle interval in minutes.
 */
function chooseKalshiPeriodInterval(startTimestampSeconds: number): 60 | 1440 {
  const durationDays =
    (Date.now() / 1_000 - startTimestampSeconds) / (24 * 60 * 60);
  return durationDays > 180 ? 1440 : 60;
}

/**
 * Chooses the earliest known contract start for a Kalshi range.
 *
 * @param markets - Kalshi market requests.
 * @returns Unix start timestamp, with a bounded fallback when absent.
 */
function chooseKalshiStartTimestamp(
  markets: readonly HistoricalPriceMarketRequest[],
): number {
  const start = earliestStartTimestampMilliseconds(markets);
  if (start > 0) {
    return Math.floor(start / 1_000);
  }
  return Math.floor((Date.now() - 365 * 24 * 60 * 60 * 1_000) / 1_000);
}

/**
 * Finds the earliest valid supplied market start.
 *
 * @param markets - Market requests with optional starts.
 * @returns Unix milliseconds or zero when none are valid.
 */
function earliestStartTimestampMilliseconds(
  markets: readonly HistoricalPriceMarketRequest[],
): number {
  const timestamps = markets
    .map((market) =>
      market.startDateIso ? Date.parse(market.startDateIso) : Number.NaN,
    )
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
  return timestamps.length > 0 ? Math.min(...timestamps) : 0;
}

/**
 * Converts raw venue points into sorted bounded dollar prices.
 *
 * @param points - Raw venue points.
 * @returns Normalized and downsampled price points.
 */
function normalizePricePoints(
  points: readonly { p: number | string; t: number | string }[],
): HistoricalPricePoint[] {
  const byTimestamp = new Map<string, HistoricalPricePoint>();
  for (const point of points) {
    const price = Number(point.p);
    const seconds = Number(point.t);
    const date = new Date(seconds * 1_000);
    if (
      !Number.isFinite(price) ||
      price < 0 ||
      price > 1 ||
      !Number.isFinite(seconds) ||
      Number.isNaN(date.getTime())
    ) {
      continue;
    }
    const timestampIso = date.toISOString();
    byTimestamp.set(timestampIso, {
      timestampIso,
      yesPriceDollars: price,
    });
  }
  return downsamplePoints(
    [...byTimestamp.values()].sort((left, right) =>
      left.timestampIso.localeCompare(right.timestampIso),
    ),
  );
}

/**
 * Uniformly downsamples a sorted series while retaining endpoints.
 *
 * @param points - Sorted source points.
 * @returns At most the configured maximum point count.
 */
function downsamplePoints(
  points: readonly HistoricalPricePoint[],
): HistoricalPricePoint[] {
  if (points.length <= maximumHistoricalPricePoints) {
    return [...points];
  }
  const selected: HistoricalPricePoint[] = [];
  for (let index = 0; index < maximumHistoricalPricePoints; index += 1) {
    const sourceIndex = Math.round(
      (index * (points.length - 1)) / (maximumHistoricalPricePoints - 1),
    );
    const point = points[sourceIndex];
    if (point) {
      selected.push(point);
    }
  }
  return selected;
}

/**
 * Builds the public result shape for one market.
 *
 * @param market - Requested market.
 * @param points - Normalized history points.
 * @returns Available or unavailable market series.
 */
function toHistoricalSeries(
  market: HistoricalPriceMarketRequest,
  points: readonly HistoricalPricePoint[],
): HistoricalPriceSeries {
  return points.length > 0
    ? { market, available: true, points }
    : {
        market,
        available: false,
        points: [],
        message: `${market.platform} has no usable historical prices for this market.`,
      };
}

/**
 * Splits a list into bounded non-empty chunks.
 *
 * @param values - Source values.
 * @param size - Maximum chunk size.
 * @returns Ordered chunks.
 */
function chunk<T>(values: readonly T[], size: number): readonly T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}
