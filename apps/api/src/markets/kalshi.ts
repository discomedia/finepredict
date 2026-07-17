import { MarketContractSchema, type MarketContract } from "@finepredict/shared";
import { z } from "zod";

import {
  extractNamedResolutionSource,
  extractPathValue,
  UnsupportedMarketUrlError,
} from "./platform.js";

/** Kalshi market fields used by FinePredict. */
const KalshiMarketSchema = z.object({
  ticker: z.string(),
  event_ticker: z.string().nullish(),
  title: z.string().nullish(),
  subtitle: z.string().nullish(),
  rules_primary: z.string().nullish(),
  rules_secondary: z.string().nullish(),
  early_close_condition: z.string().nullish(),
  open_time: z.string().nullish(),
  close_time: z.string().nullish(),
  expected_expiration_time: z.string().nullish(),
  status: z.string().nullish(),
  result: z.string().nullish(),
  settlement_ts: z.string().nullish(),
});

/** Kalshi single-market API response. */
const KalshiMarketResponseSchema = z.object({ market: KalshiMarketSchema });

/** Kalshi event API response. */
const KalshiEventResponseSchema = z.object({
  event: z.object({
    event_ticker: z.string(),
    title: z.string().nullish(),
    sub_title: z.string().nullish(),
    markets: z.array(KalshiMarketSchema).nullish(),
  }),
  markets: z.array(KalshiMarketSchema).nullish(),
});

/** Kalshi market response used internally during normalization. */
type KalshiMarket = z.infer<typeof KalshiMarketSchema>;

/**
 * Fetches a Kalshi market or event using the documented public trade API.
 *
 * @param marketUrl - Public Kalshi market URL.
 * @param fetchImplementation - HTTP implementation, injectable for tests.
 * @returns Normalized market contract.
 */
export async function fetchKalshiContract(
  marketUrl: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<MarketContract> {
  const url = new URL(marketUrl);
  const ticker = extractPathValue(url, "markets").toUpperCase();
  const marketResponse = await fetchKalshiJson(
    `https://api.elections.kalshi.com/trade-api/v2/markets/${encodeURIComponent(ticker)}`,
    fetchImplementation,
  );
  if (marketResponse !== null) {
    return normalizeKalshiMarket(
      KalshiMarketResponseSchema.parse(marketResponse).market,
      marketUrl,
    );
  }

  const eventResponse = await fetchKalshiJson(
    `https://api.elections.kalshi.com/trade-api/v2/events/${encodeURIComponent(ticker)}?with_nested_markets=true`,
    fetchImplementation,
  );
  if (eventResponse === null) {
    throw new UnsupportedMarketUrlError(
      `Kalshi did not recognize the ticker ${ticker} from this URL.`,
    );
  }
  const parsed = KalshiEventResponseSchema.parse(eventResponse);
  const markets = parsed.event.markets ?? parsed.markets ?? [];
  return normalizeKalshiEvent(
    parsed.event.event_ticker,
    parsed.event.title ?? parsed.event.sub_title ?? ticker,
    markets,
    marketUrl,
  );
}

/**
 * Fetches public Kalshi JSON and treats a missing ticker as a normal fallback.
 *
 * @param url - Kalshi public API URL.
 * @param fetchImplementation - HTTP implementation.
 * @returns Parsed JSON or null for a missing resource.
 */
async function fetchKalshiJson(
  url: string,
  fetchImplementation: typeof fetch,
): Promise<unknown | null> {
  const response = await fetchImplementation(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `FinePredict Kalshi API: ${response.status} ${response.statusText}.`,
    );
  }
  return response.json();
}

/**
 * Converts a single Kalshi market into the shared contract shape.
 *
 * @param market - Parsed Kalshi market.
 * @param marketUrl - Original user URL.
 * @returns Normalized market contract.
 */
function normalizeKalshiMarket(
  market: KalshiMarket,
  marketUrl: string,
): MarketContract {
  const title = market.title?.trim() || market.subtitle?.trim();
  const rulesText = joinRules(market);
  if (!title || !rulesText) {
    throw new UnsupportedMarketUrlError(
      `This Kalshi market did not expose a title and full rules text.`,
    );
  }
  return MarketContractSchema.parse({
    endDate: toIsoDate(market.expected_expiration_time ?? market.close_time),
    externalId: market.ticker,
    fetchedAt: new Date().toISOString(),
    platform: "kalshi",
    resolutionSource: extractNamedResolutionSource(rulesText),
    result: market.result?.trim() || null,
    rulesText,
    settlementTimestamp: toIsoDate(market.settlement_ts),
    startDate: toIsoDate(market.open_time),
    status: market.status?.trim() || "unknown",
    disputeState: isKalshiDisputeState(market.status) ? market.status : null,
    title,
    url: marketUrl,
  });
}

/**
 * Converts a Kalshi multi-market event into one analyzable rules document.
 *
 * @param eventTicker - Kalshi event ticker.
 * @param title - Kalshi event title.
 * @param markets - Markets nested under the event.
 * @param marketUrl - Original user URL.
 * @returns Normalized event-level contract.
 */
function normalizeKalshiEvent(
  eventTicker: string,
  title: string,
  markets: KalshiMarket[],
  marketUrl: string,
): MarketContract {
  const ruleParts = markets.map(joinRules).filter(Boolean);
  const rulesText = [...new Set(ruleParts)].join("\n\n");
  const firstMarket = markets[0];
  if (!rulesText || !firstMarket) {
    throw new UnsupportedMarketUrlError(
      `This Kalshi event did not expose market rules.`,
    );
  }
  const endDates = markets
    .map((market) =>
      toIsoDate(market.expected_expiration_time ?? market.close_time),
    )
    .filter((date): date is string => Boolean(date))
    .sort();
  return MarketContractSchema.parse({
    endDate: endDates.at(-1) ?? null,
    externalId: eventTicker,
    fetchedAt: new Date().toISOString(),
    platform: "kalshi",
    resolutionSource: extractNamedResolutionSource(rulesText),
    result: firstMarket.result?.trim() || null,
    rulesText,
    settlementTimestamp: toIsoDate(firstMarket.settlement_ts),
    startDate: toIsoDate(firstMarket.open_time),
    status: firstMarket.status?.trim() || "unknown",
    disputeState: isKalshiDisputeState(firstMarket.status)
      ? firstMarket.status
      : null,
    title: title.trim(),
    url: marketUrl,
  });
}

/**
 * Joins every settlement-relevant rules field without silently dropping text.
 *
 * @param market - Parsed Kalshi market.
 * @returns Combined rules document.
 */
function joinRules(market: KalshiMarket): string {
  return [
    market.rules_primary,
    market.rules_secondary,
    market.early_close_condition
      ? `Early close condition: ${market.early_close_condition}`
      : null,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
}

/**
 * Normalizes an optional upstream date into a valid ISO string.
 *
 * @param value - Optional upstream date value.
 * @returns ISO date or null when absent or invalid.
 */
function toIsoDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Identifies official Kalshi lifecycle values that represent a dispute change.
 *
 * @param status - Raw Kalshi lifecycle status.
 * @returns True for disputed and amended states.
 */
function isKalshiDisputeState(status: string | null | undefined): boolean {
  return status === "disputed" || status === "amended";
}
