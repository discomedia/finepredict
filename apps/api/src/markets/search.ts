import {
  MarketSearchResponseSchema,
  type MarketPlatform,
  type MarketSearchResponse,
  type MarketSearchResult,
} from "@finepredict/shared";
import { z } from "zod";

import { log } from "../log.js";

/** Oddpool REST API base URL. */
const ODDPOOL_API_BASE_URL = "https://api.oddpool.com";

/** Maximum Oddpool rows requested before the visible result cap is applied. */
const ODDPOOL_SEARCH_LIMIT = 20;

/** Maximum visible matches returned for one venue. */
const MARKET_SEARCH_RESULT_LIMIT = 8;

/** Conservative request spacing below the Pro tier's 10 requests per second. */
const ODDPOOL_MINIMUM_REQUEST_INTERVAL_MILLISECONDS = 200;

/** Duration for which an identical venue/query result remains fresh. */
const MARKET_SEARCH_CACHE_TTL_MILLISECONDS = 5 * 60 * 1_000;

/** Maximum distinct search entries retained in process memory. */
const MARKET_SEARCH_MAXIMUM_CACHE_ENTRIES = 200;

/** Maximum automatic retries after an Oddpool rate-limit response. */
const ODDPOOL_MAXIMUM_RATE_LIMIT_RETRIES = 2;

/** Longest Retry-After delay accepted from an upstream response. */
const ODDPOOL_MAXIMUM_RETRY_DELAY_MILLISECONDS = 30_000;

/** Oddpool market fields required for a selectable FinePredict result. */
const OddpoolMarketSchema = z.object({
  category: z.string().nullish(),
  event_id: z.string().nullish(),
  event_title: z.string().nullish(),
  exchange: z.string(),
  market_id: z.string(),
  question: z.string(),
  series_id: z.string().nullish(),
  slug: z.string().nullish(),
  status: z.string(),
});

/** Bare array returned by Oddpool market search. */
const OddpoolMarketSearchResponseSchema = z.array(OddpoolMarketSchema);

/** One validated Oddpool market-search row. */
type OddpoolMarket = z.infer<typeof OddpoolMarketSchema>;

/** Cached search result and its load time. */
interface SearchCacheEntry {
  loadedAtMilliseconds: number;
  results: readonly MarketSearchResult[];
}

/** Error raised when Oddpool-backed search cannot be used safely. */
export class MarketSearchUnavailableError extends Error {
  /**
   * Creates a safe public market-search failure.
   *
   * @param message - User-facing failure description.
   * @param status - Appropriate HTTP response status.
   */
  public constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "MarketSearchUnavailableError";
  }
}

/** Quota-aware Oddpool market discovery for FinePredict's supported venues. */
export class MarketSearchService {
  private readonly searchCache = new Map<string, SearchCacheEntry>();
  private readonly searchesInProgress = new Map<
    string,
    Promise<readonly MarketSearchResult[]>
  >();
  private requestGate: Promise<void> = Promise.resolve();
  private lastRequestStartedAtMilliseconds = 0;

  /**
   * Creates a public market-search service.
   *
   * @param oddpoolApiKey - Oddpool credential kept exclusively on the server.
   * @param fetchImplementation - HTTP implementation, injectable for tests.
   */
  public constructor(
    private readonly oddpoolApiKey: string | null,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  /**
   * Searches one supported venue through Oddpool and returns ranked matches.
   *
   * @param platform - Venue to search.
   * @param query - User-entered term containing at least three characters.
   * @returns Ranked active market matches.
   */
  public async search(
    platform: MarketPlatform,
    query: string,
  ): Promise<MarketSearchResponse> {
    if (!this.oddpoolApiKey) {
      throw new MarketSearchUnavailableError(
        `Market search is not configured. Add ODDPOOL_API_KEY to the server environment.`,
        503,
      );
    }
    const normalizedQuery = query.trim();
    const cacheKey = `${platform}:${normalizedQuery.toLowerCase()}`;
    const results = await this.getSearchResults(
      cacheKey,
      platform,
      normalizedQuery,
    );
    return MarketSearchResponseSchema.parse({
      platform,
      query: normalizedQuery,
      results,
    });
  }

  /**
   * Returns a fresh cached result or coalesces the same in-flight search.
   *
   * @param cacheKey - Normalized venue and query cache identifier.
   * @param platform - Venue filter sent to Oddpool.
   * @param query - Trimmed user search phrase.
   * @returns Ranked venue results.
   */
  private async getSearchResults(
    cacheKey: string,
    platform: MarketPlatform,
    query: string,
  ): Promise<readonly MarketSearchResult[]> {
    const cached = this.searchCache.get(cacheKey);
    if (
      cached &&
      Date.now() - cached.loadedAtMilliseconds <
        MARKET_SEARCH_CACHE_TTL_MILLISECONDS
    ) {
      return cached.results;
    }
    const inProgress = this.searchesInProgress.get(cacheKey);
    if (inProgress) {
      return inProgress;
    }
    const search = this.searchOddpool(platform, query)
      .then((results) => {
        this.storeCacheEntry(cacheKey, results);
        return results;
      })
      .finally(() => {
        this.searchesInProgress.delete(cacheKey);
      });
    this.searchesInProgress.set(cacheKey, search);
    return search;
  }

  /**
   * Calls Oddpool full-text market search for one venue.
   *
   * @param platform - Venue filter sent to Oddpool.
   * @param query - Trimmed user search phrase.
   * @returns Selectable FinePredict market results in Oddpool rank order.
   */
  private async searchOddpool(
    platform: MarketPlatform,
    query: string,
  ): Promise<MarketSearchResult[]> {
    const url = new URL("/search/markets", ODDPOOL_API_BASE_URL);
    url.searchParams.set("exchange", platform);
    url.searchParams.set("limit", String(ODDPOOL_SEARCH_LIMIT));
    url.searchParams.set("q", query);
    url.searchParams.set("sort_by", "relevance");
    url.searchParams.set("status", "active");
    const rows = OddpoolMarketSearchResponseSchema.parse(
      await this.fetchOddpoolJson(url),
    );
    return rows
      .filter(
        (row): row is OddpoolMarket & { exchange: MarketPlatform } =>
          row.exchange === platform,
      )
      .map(normalizeOddpoolMarket)
      .slice(0, MARKET_SEARCH_RESULT_LIMIT);
  }

  /**
   * Performs one authenticated Oddpool request with spacing and 429 retries.
   *
   * @param url - Oddpool search URL without credentials.
   * @returns Parsed JSON response.
   */
  private async fetchOddpoolJson(url: URL): Promise<unknown> {
    for (
      let attempt = 0;
      attempt <= ODDPOOL_MAXIMUM_RATE_LIMIT_RETRIES;
      attempt += 1
    ) {
      await this.waitForRequestSlot();
      const response = await this.fetchImplementation(url, {
        headers: {
          Accept: "application/json",
          "X-API-Key": this.oddpoolApiKey ?? "",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 429) {
        if (attempt === ODDPOOL_MAXIMUM_RATE_LIMIT_RETRIES) {
          throw new MarketSearchUnavailableError(
            `Market search is temporarily rate limited. Please try again shortly.`,
            503,
          );
        }
        const retryDelayMilliseconds = parseRetryAfterMilliseconds(
          response.headers.get("retry-after"),
        );
        log(
          "MarketSearchService.fetchOddpoolJson",
          "Oddpool rate limited market search; waiting before retry.",
          { attempt: attempt + 1, retryDelayMilliseconds },
        );
        await delay(retryDelayMilliseconds);
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        throw new MarketSearchUnavailableError(
          `Market search authentication failed. Check ODDPOOL_API_KEY.`,
          503,
        );
      }
      if (!response.ok) {
        throw new MarketSearchUnavailableError(
          `Oddpool market search returned ${response.status} ${response.statusText}.`,
          502,
        );
      }
      return response.json();
    }
    throw new MarketSearchUnavailableError(
      `Market search could not complete.`,
      503,
    );
  }

  /**
   * Reserves the next global request start while staying below the Pro limit.
   *
   * @returns Promise resolved when this request may start.
   */
  private async waitForRequestSlot(): Promise<void> {
    const previousGate = this.requestGate;
    let releaseGate: (() => void) | undefined;
    this.requestGate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    await previousGate;
    try {
      const waitMilliseconds = Math.max(
        0,
        ODDPOOL_MINIMUM_REQUEST_INTERVAL_MILLISECONDS -
          (Date.now() - this.lastRequestStartedAtMilliseconds),
      );
      if (waitMilliseconds > 0) {
        await delay(waitMilliseconds);
      }
      this.lastRequestStartedAtMilliseconds = Date.now();
    } finally {
      releaseGate?.();
    }
  }

  /**
   * Stores one result while bounding process-memory cache growth.
   *
   * @param cacheKey - Normalized venue and query cache identifier.
   * @param results - Successful normalized results.
   * @returns Nothing.
   */
  private storeCacheEntry(
    cacheKey: string,
    results: readonly MarketSearchResult[],
  ): void {
    if (this.searchCache.size >= MARKET_SEARCH_MAXIMUM_CACHE_ENTRIES) {
      const oldestKey = this.searchCache.keys().next().value;
      if (typeof oldestKey === "string") {
        this.searchCache.delete(oldestKey);
      }
    }
    this.searchCache.set(cacheKey, {
      loadedAtMilliseconds: Date.now(),
      results,
    });
  }
}

/**
 * Converts one Oddpool row into a URL accepted by the report analyzer.
 *
 * @param row - Validated active Oddpool market.
 * @returns Selectable FinePredict market result.
 */
function normalizeOddpoolMarket(
  row: OddpoolMarket & { exchange: MarketPlatform },
): MarketSearchResult {
  const eventTitle = row.event_title?.trim();
  const category = row.category?.trim();
  const subtitleParts = [
    eventTitle && eventTitle !== row.question.trim() ? eventTitle : null,
    row.exchange === "kalshi" ? row.market_id : category,
  ].filter((value): value is string => Boolean(value));
  return {
    endDate: null,
    externalId: row.market_id,
    platform: row.exchange,
    subtitle: subtitleParts.join(" · ") || null,
    title: row.question.trim(),
    url:
      row.exchange === "polymarket"
        ? createPolymarketUrl(row)
        : createKalshiUrl(row),
  };
}

/**
 * Builds the public nested route for one Polymarket child market.
 *
 * @param row - Oddpool Polymarket market row.
 * @returns Public Polymarket URL.
 */
function createPolymarketUrl(row: OddpoolMarket): string {
  const eventSlug = row.event_id?.trim() || row.slug?.trim();
  const marketSlug = row.slug?.trim();
  if (!eventSlug) {
    throw new MarketSearchUnavailableError(
      `Oddpool returned a Polymarket result without a public slug.`,
      502,
    );
  }
  return marketSlug && marketSlug !== eventSlug
    ? `https://polymarket.com/event/${encodeURIComponent(eventSlug)}/${encodeURIComponent(marketSlug)}`
    : `https://polymarket.com/event/${encodeURIComponent(eventSlug)}`;
}

/**
 * Builds a Kalshi route whose terminal market ticker is directly analyzable.
 *
 * @param row - Oddpool Kalshi market row.
 * @returns Public Kalshi URL.
 */
function createKalshiUrl(row: OddpoolMarket): string {
  const seriesId = row.series_id?.trim() || row.event_id?.trim() || "market";
  const eventSlug = slugify(row.event_title?.trim() || row.question.trim());
  return `https://kalshi.com/markets/${seriesId.toLowerCase()}/${eventSlug}/${row.market_id.toLowerCase()}`;
}

/**
 * Converts display text into a stable lowercase URL segment.
 *
 * @param value - Event title or fallback identifier.
 * @returns URL-safe slug.
 */
function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Interprets Oddpool's Retry-After header with a conservative fallback.
 *
 * @param value - Raw Retry-After seconds or HTTP date.
 * @returns Bounded wait duration in milliseconds.
 */
function parseRetryAfterMilliseconds(value: string | null): number {
  const seconds = Number(value);
  const requestedMilliseconds = Number.isFinite(seconds)
    ? seconds * 1_000
    : Math.max(0, new Date(value ?? "").getTime() - Date.now());
  const fallbackMilliseconds = 1_000;
  return Math.min(
    ODDPOOL_MAXIMUM_RETRY_DELAY_MILLISECONDS,
    requestedMilliseconds > 0 ? requestedMilliseconds : fallbackMilliseconds,
  );
}

/**
 * Waits without blocking the Node.js event loop.
 *
 * @param milliseconds - Delay duration.
 * @returns Promise resolved after the delay.
 */
function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
