import { MarketContractSchema, type MarketContract } from "@finepredict/shared";
import { z } from "zod";

import {
  extractNamedResolutionSource,
  extractPathValue,
  fetchJson,
  UnsupportedMarketUrlError,
} from "./platform.js";

/** Polymarket market fields used by FinePredict. */
const PolymarketMarketSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  question: z.string().nullish(),
  slug: z.string().nullish(),
  description: z.string().nullish(),
  resolutionSource: z.string().nullish(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  active: z.boolean().nullish(),
  closed: z.boolean().nullish(),
  umaResolutionStatus: z.string().nullish(),
  resolutionStatus: z.string().nullish(),
  resolvedAt: z.string().nullish(),
  questionID: z.string().nullish(),
  createdBy: z.string().nullish(),
});

/** Polymarket event fields used by FinePredict. */
const PolymarketEventSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string().nullish(),
  slug: z.string().nullish(),
  description: z.string().nullish(),
  resolutionSource: z.string().nullish(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  active: z.boolean().nullish(),
  closed: z.boolean().nullish(),
  umaResolutionStatus: z.string().nullish(),
  resolutionStatus: z.string().nullish(),
  resolvedAt: z.string().nullish(),
  questionID: z.string().nullish(),
  createdBy: z.string().nullish(),
  markets: z.array(PolymarketMarketSchema).nullish(),
});

/** Polymarket event response used internally during normalization. */
type PolymarketEvent = z.infer<typeof PolymarketEventSchema>;

/** Polymarket market response used internally during normalization. */
type PolymarketMarket = z.infer<typeof PolymarketMarketSchema>;

/**
 * Fetches a Polymarket event or market using the documented public Gamma API.
 *
 * @param marketUrl - Public Polymarket event URL.
 * @param fetchImplementation - HTTP implementation, injectable for tests.
 * @returns Normalized market contract.
 */
export async function fetchPolymarketContract(
  marketUrl: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<MarketContract> {
  const url = new URL(marketUrl);
  const eventSlug = extractPathValue(url, "event");
  const marketSlug = extractNestedMarketSlug(url);
  const encodedMarketSlug = encodeURIComponent(marketSlug ?? eventSlug);

  const marketResponse = await tryFetchJson(
    `https://gamma-api.polymarket.com/markets/slug/${encodedMarketSlug}`,
    fetchImplementation,
  );
  if (marketResponse !== null) {
    const market = PolymarketMarketSchema.parse(marketResponse);
    return normalizePolymarketMarket(market, marketUrl);
  }

  const eventResponse = await fetchJson(
    `https://gamma-api.polymarket.com/events/slug/${encodeURIComponent(eventSlug)}`,
    "Polymarket Gamma API",
    fetchImplementation,
  );
  const event = PolymarketEventSchema.parse(eventResponse);
  return normalizePolymarketEvent(event, marketUrl);
}

/**
 * Reads a child-market slug from Polymarket's event/market nested route.
 *
 * @param url - Parsed public Polymarket URL.
 * @returns Child-market slug or null for an event-only route.
 */
function extractNestedMarketSlug(url: URL): string | null {
  const segments = url.pathname.split("/").filter(Boolean);
  const eventIndex = segments.findIndex(
    (segment) => segment.toLowerCase() === "event",
  );
  return segments[eventIndex + 2]?.trim() || null;
}

/**
 * Attempts a public JSON request and treats only 404 as a miss.
 *
 * @param url - Gamma API URL.
 * @param fetchImplementation - HTTP implementation.
 * @returns Parsed JSON or null when the resource does not exist.
 */
async function tryFetchJson(
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
      `FinePredict Polymarket Gamma API: ${response.status} ${response.statusText}.`,
    );
  }
  return response.json();
}

/**
 * Converts a single Gamma market into the shared contract shape.
 *
 * @param market - Parsed Gamma market.
 * @param marketUrl - Original user URL.
 * @returns Normalized market contract.
 */
function normalizePolymarketMarket(
  market: PolymarketMarket,
  marketUrl: string,
): MarketContract {
  const title = market.question?.trim();
  const rulesText = market.description?.trim();
  if (!title || !rulesText) {
    throw new UnsupportedMarketUrlError(
      `This Polymarket URL did not expose a title and full rules text.`,
    );
  }
  return MarketContractSchema.parse({
    endDate: toIsoDate(market.endDate),
    externalId: market.id,
    fetchedAt: new Date().toISOString(),
    platform: "polymarket",
    platformCreatorAddress: market.createdBy?.trim() || null,
    platformQuestionId: market.questionID?.trim() || null,
    resolutionSource:
      market.resolutionSource?.trim() ||
      extractNamedResolutionSource(rulesText),
    result: null,
    rulesText,
    settlementTimestamp: toIsoDate(market.resolvedAt),
    startDate: toIsoDate(market.startDate),
    status:
      market.umaResolutionStatus?.trim() ||
      market.resolutionStatus?.trim() ||
      (market.closed ? "closed" : market.active ? "active" : "inactive"),
    disputeState: polymarketDisputeState(
      market.umaResolutionStatus ?? market.resolutionStatus,
    ),
    title,
    url: marketUrl,
  });
}

/**
 * Converts an event-level Gamma response into one analyzable contract document.
 *
 * @param event - Parsed Gamma event.
 * @param marketUrl - Original user URL.
 * @returns Normalized event-level contract.
 */
function normalizePolymarketEvent(
  event: PolymarketEvent,
  marketUrl: string,
): MarketContract {
  const title = event.title?.trim();
  const marketRules = (event.markets ?? [])
    .map((market) => market.description?.trim())
    .filter((rules): rules is string => Boolean(rules));
  const rulesParts = [event.description?.trim(), ...marketRules].filter(
    (rules): rules is string => Boolean(rules),
  );
  const rulesText = [...new Set(rulesParts)].join("\n\n");
  if (!title || !rulesText) {
    throw new UnsupportedMarketUrlError(
      `This Polymarket event did not expose a title and full rules text.`,
    );
  }
  return MarketContractSchema.parse({
    endDate: toIsoDate(event.endDate),
    externalId: event.id,
    fetchedAt: new Date().toISOString(),
    platform: "polymarket",
    platformCreatorAddress:
      event.createdBy?.trim() ||
      event.markets?.find((market) => market.createdBy?.trim())?.createdBy ||
      null,
    platformQuestionId:
      event.questionID?.trim() ||
      event.markets?.find((market) => market.questionID?.trim())?.questionID ||
      null,
    resolutionSource:
      event.resolutionSource?.trim() ||
      event.markets?.find((market) => market.resolutionSource?.trim())
        ?.resolutionSource ||
      extractNamedResolutionSource(rulesText),
    result: null,
    rulesText,
    settlementTimestamp: toIsoDate(event.resolvedAt),
    startDate: toIsoDate(event.startDate),
    status:
      event.umaResolutionStatus?.trim() ||
      event.resolutionStatus?.trim() ||
      (event.closed ? "closed" : event.active ? "active" : "inactive"),
    disputeState: polymarketDisputeState(
      event.umaResolutionStatus ?? event.resolutionStatus,
    ),
    title,
    url: marketUrl,
  });
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
 * Preserves Polymarket UMA proposal states relevant to dispute monitoring.
 *
 * @param state - Raw Gamma/UMA resolution state.
 * @returns Raw dispute state or null for ordinary lifecycle values.
 */
function polymarketDisputeState(
  state: string | null | undefined,
): string | null {
  const normalized = state?.trim().toLowerCase();
  return normalized &&
    ["proposed", "challenged", "disputed", "dvm", "clarified"].includes(
      normalized,
    )
    ? state?.trim() || null
    : null;
}
