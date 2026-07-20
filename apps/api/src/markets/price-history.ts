import {
  MarketPriceSnapshotSchema,
  type MarketPlatform,
  type MarketPricePoint,
  type MarketPriceSnapshot,
} from "@finepredict/shared";
import { z } from "zod";

import { fetchJson } from "./platform.js";

/** Base URL for read-only Kalshi public market data. */
const KALSHI_TRADE_API_BASE_URL =
  "https://external-api.kalshi.com/trade-api/v2";

/** Number of milliseconds represented in the compact report chart. */
const PRICE_HISTORY_WINDOW_MILLISECONDS = 24 * 60 * 60 * 1_000;

/** Maximum chart points returned to the browser for one venue. */
const MAX_HISTORY_POINTS = 96;

/** Lifetime of a server-side price response before the venue is queried again. */
const PRICE_CACHE_MILLISECONDS = 30_000;

/** Gamma fields needed to locate Polymarket's public CLOB Yes token. */
const PolymarketPriceMarketSchema = z.object({
  clobTokenIds: z.union([z.string(), z.array(z.string())]).nullish(),
  outcomes: z.union([z.string(), z.array(z.string())]).nullish(),
});

/** Public CLOB response containing timestamped token prices. */
const PolymarketPriceHistorySchema = z.object({
  history: z.array(
    z.object({
      p: z.union([z.number(), z.string()]),
      t: z.union([z.number(), z.string()]),
    }),
  ),
});

/** Current Kalshi market fields used for the price card. */
const KalshiPriceMarketSchema = z.object({
  last_price_dollars: z.union([z.number(), z.string()]).nullish(),
});

/** Current Kalshi market response. */
const KalshiPriceMarketResponseSchema = z.object({
  market: KalshiPriceMarketSchema,
});

/** Public Kalshi candle response used for the compact history chart. */
const KalshiCandlesResponseSchema = z.object({
  markets: z.array(
    z.object({
      candlesticks: z.array(
        z.object({
          end_period_ts: z.union([z.number(), z.string()]),
          price: z.object({
            close_dollars: z.union([z.number(), z.string()]).nullish(),
          }),
        }),
      ),
    }),
  ),
});

/** Cached fresh price response with its local expiration time. */
interface CachedMarketPrice {
  expiresAt: number;
  snapshot: MarketPriceSnapshot;
}

/**
 * Loads a small read-only current-price and history payload from official venue
 * APIs. Results remain in memory briefly to keep report polling respectful of
 * public endpoint rate limits; no price history is persisted by FinePredict.
 */
export class MarketPriceHistoryService {
  private readonly cache = new Map<string, CachedMarketPrice>();
  private readonly fetchImplementation: typeof fetch;

  /**
   * Creates the public market-price service.
   *
   * @param fetchImplementation - HTTP implementation, injectable for tests.
   */
  public constructor(fetchImplementation: typeof fetch = fetch) {
    this.fetchImplementation = fetchImplementation;
  }

  /**
   * Retrieves current pricing and a one-day history for one supported market.
   *
   * @param platform - Venue that owns the requested market.
   * @param externalId - Venue-native market identifier.
   * @returns Fresh or briefly cached public price snapshot.
   */
  public async getPriceSnapshot(
    platform: MarketPlatform,
    externalId: string,
  ): Promise<MarketPriceSnapshot> {
    const cacheKey = `${platform}:${externalId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.snapshot;
    }

    const snapshot =
      platform === "polymarket"
        ? await this.getPolymarketPriceSnapshot(externalId)
        : await this.getKalshiPriceSnapshot(externalId);
    this.cache.set(cacheKey, {
      expiresAt: Date.now() + PRICE_CACHE_MILLISECONDS,
      snapshot,
    });
    return snapshot;
  }

  /**
   * Retrieves public Polymarket CLOB price history for the Yes outcome.
   *
   * @param externalId - Gamma market identifier.
   * @returns Read-only Polymarket price snapshot or a neutral unavailable state.
   */
  private async getPolymarketPriceSnapshot(
    externalId: string,
  ): Promise<MarketPriceSnapshot> {
    try {
      const market = PolymarketPriceMarketSchema.parse(
        await fetchJson(
          `https://gamma-api.polymarket.com/markets/${encodeURIComponent(externalId)}`,
          "Polymarket Gamma API",
          this.fetchImplementation,
        ),
      );
      const yesTokenId = findYesTokenId(market.clobTokenIds, market.outcomes);
      if (!yesTokenId) {
        return unavailablePriceSnapshot("polymarket", externalId);
      }
      const priceHistory = PolymarketPriceHistorySchema.parse(
        await fetchJson(
          `https://clob.polymarket.com/prices-history?${new URLSearchParams({
            fidelity: "15",
            interval: "1d",
            market: yesTokenId,
          }).toString()}`,
          "Polymarket CLOB API",
          this.fetchImplementation,
        ),
      );
      return createAvailablePriceSnapshot(
        "polymarket",
        externalId,
        normalizePriceHistory(
          priceHistory.history.map((point) => ({
            price: point.p,
            timestamp: point.t,
          })),
        ),
      );
    } catch {
      return unavailablePriceSnapshot("polymarket", externalId);
    }
  }

  /**
   * Retrieves Kalshi's latest trade price and public candle history together.
   *
   * @param externalId - Kalshi market ticker.
   * @returns Read-only Kalshi price snapshot or a neutral unavailable state.
   */
  private async getKalshiPriceSnapshot(
    externalId: string,
  ): Promise<MarketPriceSnapshot> {
    try {
      const endTimestampSeconds = Math.floor(Date.now() / 1_000);
      const startTimestampSeconds = Math.floor(
        (Date.now() - PRICE_HISTORY_WINDOW_MILLISECONDS) / 1_000,
      );
      const candleParameters = new URLSearchParams({
        end_ts: String(endTimestampSeconds),
        include_latest_before_start: "true",
        market_tickers: externalId,
        period_interval: "15",
        start_ts: String(startTimestampSeconds),
      });
      const [marketResponse, candleResponse] = await Promise.all([
        fetchJson(
          `${KALSHI_TRADE_API_BASE_URL}/markets/${encodeURIComponent(externalId)}`,
          "Kalshi Trade API",
          this.fetchImplementation,
        ),
        fetchJson(
          `${KALSHI_TRADE_API_BASE_URL}/markets/candlesticks?${candleParameters.toString()}`,
          "Kalshi Trade API",
          this.fetchImplementation,
        ),
      ]);
      const market =
        KalshiPriceMarketResponseSchema.parse(marketResponse).market;
      const candles = KalshiCandlesResponseSchema.parse(candleResponse);
      const history = normalizePriceHistory(
        (candles.markets[0]?.candlesticks ?? []).map((candle) => ({
          price: candle.price.close_dollars,
          timestamp: candle.end_period_ts,
        })),
      );
      const latestTradePrice = toPercent100(market.last_price_dollars);
      return createAvailablePriceSnapshot(
        "kalshi",
        externalId,
        history,
        latestTradePrice,
      );
    } catch {
      return unavailablePriceSnapshot("kalshi", externalId);
    }
  }
}

/**
 * Locates the Yes CLOB token from the Gamma market's parallel outcome arrays.
 *
 * @param tokenIdsValue - Gamma token IDs encoded as an array or JSON string.
 * @param outcomesValue - Gamma outcome labels encoded as an array or JSON string.
 * @returns Yes token ID, or null for non-binary and incomplete market metadata.
 */
function findYesTokenId(
  tokenIdsValue: string | string[] | null | undefined,
  outcomesValue: string | string[] | null | undefined,
): string | null {
  const tokenIds = parseStringList(tokenIdsValue);
  const outcomes = parseStringList(outcomesValue);
  const yesIndex = outcomes.findIndex(
    (outcome) => outcome.trim().toLowerCase() === "yes",
  );
  return yesIndex >= 0 ? (tokenIds[yesIndex] ?? null) : null;
}

/**
 * Parses a public API string-list field that may already be decoded.
 *
 * @param value - Potential array or JSON-encoded array from an upstream API.
 * @returns Safe non-empty string list.
 */
function parseStringList(
  value: string | string[] | null | undefined,
): string[] {
  if (Array.isArray(value)) {
    return value.filter((item) => item.trim().length > 0);
  }
  if (!value) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
      : [];
  } catch {
    return [];
  }
}

/**
 * Validates, sorts, deduplicates, and caps public time-series data.
 *
 * @param points - Raw upstream timestamp and decimal probability points.
 * @returns Safe ISO timestamp and percentage-scale chart points.
 */
function normalizePriceHistory(
  points: Array<{
    price: number | string | null | undefined;
    timestamp: number | string;
  }>,
): MarketPricePoint[] {
  const byTimestamp = new Map<string, MarketPricePoint>();
  for (const point of points) {
    const yesPricePercent100 = toPercent100(point.price);
    const timestamp = toIsoTimestamp(point.timestamp);
    if (yesPricePercent100 === null || !timestamp) {
      continue;
    }
    byTimestamp.set(timestamp, { timestamp, yesPricePercent100 });
  }
  return [...byTimestamp.values()]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .slice(-MAX_HISTORY_POINTS);
}

/**
 * Converts one decimal probability into the product's scale-100 convention.
 *
 * @param value - Upstream decimal price.
 * @returns Percentage-scale probability, or null for invalid input.
 */
function toPercent100(
  value: number | string | null | undefined,
): number | null {
  const decimal = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(decimal) || decimal < 0 || decimal > 1) {
    return null;
  }
  return Number((decimal * 100).toFixed(2));
}

/**
 * Converts upstream Unix seconds into a valid ISO timestamp.
 *
 * @param value - Unix-second timestamp from a public venue response.
 * @returns ISO timestamp, or null when invalid.
 */
function toIsoTimestamp(value: number | string): string | null {
  const seconds = typeof value === "number" ? value : Number(value);
  const date = new Date(seconds * 1_000);
  return Number.isFinite(seconds) && !Number.isNaN(date.getTime())
    ? date.toISOString()
    : null;
}

/**
 * Builds a successful snapshot, using the last chart point when no live value exists.
 *
 * @param platform - Venue that supplied public market data.
 * @param externalId - Venue-native market identifier.
 * @param history - Recent public price points.
 * @param latestYesPricePercent100 - Optional latest trade price that supersedes history.
 * @returns Validated market price snapshot.
 */
function createAvailablePriceSnapshot(
  platform: MarketPlatform,
  externalId: string,
  history: MarketPricePoint[],
  latestYesPricePercent100: number | null = null,
): MarketPriceSnapshot {
  const yesPricePercent100 =
    latestYesPricePercent100 ?? history.at(-1)?.yesPricePercent100 ?? null;
  if (yesPricePercent100 === null) {
    return unavailablePriceSnapshot(platform, externalId);
  }
  return MarketPriceSnapshotSchema.parse({
    availability: "available",
    externalId,
    fetchedAt: new Date().toISOString(),
    history,
    message: null,
    noPricePercent100: Number((100 - yesPricePercent100).toFixed(2)),
    platform,
    yesPricePercent100,
  });
}

/**
 * Builds an intentionally neutral unavailable state for a transient public-data miss.
 *
 * @param platform - Venue requested by the report.
 * @param externalId - Venue-native market identifier.
 * @returns Validated unavailable market-price snapshot.
 */
function unavailablePriceSnapshot(
  platform: MarketPlatform,
  externalId: string,
): MarketPriceSnapshot {
  return MarketPriceSnapshotSchema.parse({
    availability: "unavailable",
    externalId,
    fetchedAt: new Date().toISOString(),
    history: [],
    message: "Live price is temporarily unavailable.",
    noPricePercent100: null,
    platform,
    yesPricePercent100: null,
  });
}
