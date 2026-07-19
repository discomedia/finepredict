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

/** Maximum Oddpool rows requested before FinePredict applies its local rank. */
const ODDPOOL_SEARCH_LIMIT = 50;

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

/** Public Kalshi Trade API base URL used to enrich terse search rows. */
const KALSHI_TRADE_API_BASE_URL =
  "https://external-api.kalshi.com/trade-api/v2";

/** Penalty applied for each result already selected from the same event. */
const REPEATED_EVENT_SCORE_PENALTY = 120;

/** Oddpool market fields required for a selectable FinePredict result. */
const OddpoolMarketSchema = z.object({
  category: z.string().nullish(),
  event_id: z.string().nullish(),
  event_title: z.string().nullish(),
  exchange: z.string(),
  market_id: z.string(),
  liquidity: z.coerce.number().nullish(),
  question: z.string(),
  series_id: z.string().nullish(),
  slug: z.string().nullish(),
  status: z.string(),
  volume: z.coerce.number().nullish(),
});

/** Bare array returned by Oddpool market search. */
const OddpoolMarketSearchResponseSchema = z.array(OddpoolMarketSchema);

/** One validated Oddpool market-search row. */
type OddpoolMarket = z.infer<typeof OddpoolMarketSchema>;

/** Kalshi fields that distinguish one outcome inside a multi-market event. */
const KalshiSearchMarketSchema = z.object({
  close_time: z.string().nullish(),
  expected_expiration_time: z.string().nullish(),
  status: z.string().nullish(),
  subtitle: z.string().nullish(),
  ticker: z.string(),
  yes_sub_title: z.string().nullish(),
});

/** Public Kalshi batch-market response. */
const KalshiSearchMarketsResponseSchema = z.object({
  markets: z.array(KalshiSearchMarketSchema),
});

/** One public Kalshi market used to improve search-result display text. */
type KalshiSearchMarket = z.infer<typeof KalshiSearchMarketSchema>;

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
   * @returns Selectable FinePredict market results in local relevance order.
   */
  private async searchOddpool(
    platform: MarketPlatform,
    query: string,
  ): Promise<MarketSearchResult[]> {
    const sortModes = ["relevance", "volume"] as const;
    const responses = await Promise.all(
      sortModes.map(async (sortMode) => {
        const url = new URL("/search/markets", ODDPOOL_API_BASE_URL);
        url.searchParams.set("exchange", platform);
        url.searchParams.set("limit", String(ODDPOOL_SEARCH_LIMIT));
        url.searchParams.set("q", query);
        url.searchParams.set("sort_by", sortMode);
        url.searchParams.set("status", "active");
        return OddpoolMarketSearchResponseSchema.parse(
          await this.fetchOddpoolJson(url),
        );
      }),
    );
    const rows = [
      ...new Map(
        responses
          .flat()
          .map((row) => [`${row.exchange}:${row.market_id}`, row]),
      ).values(),
    ];
    const matchingRows = rows.filter(
      (row): row is OddpoolMarket & { exchange: MarketPlatform } =>
        row.exchange === platform,
    );
    const kalshiMarkets =
      platform === "kalshi"
        ? await this.fetchKalshiSearchMarkets(
            matchingRows.map((row) => row.market_id),
          )
        : new Map<string, KalshiSearchMarket>();
    const currentlyAvailableRows = matchingRows.filter((row) => {
      const status = kalshiMarkets
        .get(row.market_id.toUpperCase())
        ?.status?.toLowerCase();
      return status !== "closed" && status !== "settled";
    });
    const rankedRows = rankOddpoolMarkets(
      currentlyAvailableRows,
      query,
      kalshiMarkets,
    );
    return rankedRows.map((row) =>
      normalizeOddpoolMarket(
        row,
        kalshiMarkets.get(row.market_id.toUpperCase()),
      ),
    );
  }

  /**
   * Loads outcome labels for Kalshi candidates in one public API request.
   *
   * Search remains usable with Oddpool's fallback text if Kalshi enrichment is
   * temporarily unavailable.
   *
   * @param tickers - Exact Kalshi market tickers selected by local ranking.
   * @returns Kalshi markets keyed by uppercase ticker.
   */
  private async fetchKalshiSearchMarkets(
    tickers: readonly string[],
  ): Promise<Map<string, KalshiSearchMarket>> {
    if (tickers.length === 0) {
      return new Map();
    }
    const url = new URL("/trade-api/v2/markets", KALSHI_TRADE_API_BASE_URL);
    url.searchParams.set("limit", String(tickers.length));
    url.searchParams.set("tickers", tickers.join(","));
    try {
      const response = await this.fetchImplementation(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new Error(
          `Kalshi market enrichment returned ${response.status} ${response.statusText}.`,
        );
      }
      const parsed = KalshiSearchMarketsResponseSchema.parse(
        await response.json(),
      );
      return new Map(
        parsed.markets.map((market) => [market.ticker.toUpperCase(), market]),
      );
    } catch (error) {
      log(
        "MarketSearchService.fetchKalshiSearchMarkets",
        "Kalshi search-result enrichment failed; using Oddpool display text.",
        { error: error instanceof Error ? error.message : String(error) },
      );
      return new Map();
    }
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
  kalshiMarket?: KalshiSearchMarket,
): MarketSearchResult {
  const eventTitle = row.event_title?.trim();
  const category = row.category?.trim();
  const question = row.question.trim();
  const kalshiOutcomeLabel = getKalshiOutcomeLabel(kalshiMarket);
  const title = kalshiOutcomeLabel ?? question;
  const subtitleParts =
    row.exchange === "kalshi"
      ? [eventTitle && eventTitle !== title ? eventTitle : null]
      : [eventTitle && eventTitle !== question ? eventTitle : null, category];
  return {
    endDate:
      kalshiMarket?.expected_expiration_time ??
      kalshiMarket?.close_time ??
      null,
    externalId: row.market_id,
    platform: row.exchange,
    subtitle:
      subtitleParts
        .filter((value): value is string => Boolean(value))
        .join(" · ") || null,
    title,
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
  const url = new URL(
    `https://kalshi.com/markets/${seriesId.toLowerCase()}/${eventSlug}/${row.market_id.toLowerCase()}`,
  );
  url.searchParams.set("market_ticker", row.market_id);
  return url.toString();
}

/**
 * Returns the human outcome label that Kalshi omits from Oddpool search rows.
 *
 * @param market - Optional public Kalshi market detail.
 * @returns Specific outcome label, or null when only generic text is available.
 */
function getKalshiOutcomeLabel(
  market: KalshiSearchMarket | undefined,
): string | null {
  const candidates = [market?.yes_sub_title, market?.subtitle];
  return (
    candidates
      .map((candidate) => candidate?.trim())
      .find(
        (candidate): candidate is string =>
          typeof candidate === "string" &&
          candidate.length > 0 &&
          !/^(?:yes|no)$/i.test(candidate),
      ) ?? null
  );
}

/**
 * Ranks Oddpool candidates by complete text coverage, field relevance, market
 * activity, and result diversity.
 *
 * @param rows - Active candidates already filtered to one venue.
 * @param query - User search phrase.
 * @param kalshiMarkets - Optional outcome labels keyed by market ticker.
 * @returns At most eight intelligently ranked candidates.
 */
function rankOddpoolMarkets(
  rows: readonly (OddpoolMarket & { exchange: MarketPlatform })[],
  query: string,
  kalshiMarkets: ReadonlyMap<string, KalshiSearchMarket> = new Map(),
): Array<OddpoolMarket & { exchange: MarketPlatform }> {
  const scoredRows = rows
    .map((row) => ({
      row,
      score: calculateMarketSearchScore(
        row,
        query,
        kalshiMarkets.get(row.market_id.toUpperCase()),
      ),
    }))
    .sort((left, right) => right.score - left.score);
  const selectedRows: Array<OddpoolMarket & { exchange: MarketPlatform }> = [];
  const eventCounts = new Map<string, number>();
  const remainingRows = [...scoredRows];
  while (
    selectedRows.length < MARKET_SEARCH_RESULT_LIMIT &&
    remainingRows.length > 0
  ) {
    let bestIndex = 0;
    let bestAdjustedScore = Number.NEGATIVE_INFINITY;
    remainingRows.forEach((candidate, index) => {
      const eventKey = getOddpoolEventKey(candidate.row);
      const adjustedScore =
        candidate.score -
        (eventCounts.get(eventKey) ?? 0) * REPEATED_EVENT_SCORE_PENALTY;
      if (adjustedScore > bestAdjustedScore) {
        bestIndex = index;
        bestAdjustedScore = adjustedScore;
      }
    });
    const [selected] = remainingRows.splice(bestIndex, 1);
    if (!selected) {
      break;
    }
    selectedRows.push(selected.row);
    const eventKey = getOddpoolEventKey(selected.row);
    eventCounts.set(eventKey, (eventCounts.get(eventKey) ?? 0) + 1);
  }
  return selectedRows;
}

/**
 * Calculates a deterministic match score with text relevance dominating the
 * logarithmic popularity contribution.
 *
 * @param row - Oddpool market candidate.
 * @param query - User search phrase.
 * @param kalshiMarket - Optional Kalshi outcome detail.
 * @returns Comparable score where larger values are better matches.
 */
function calculateMarketSearchScore(
  row: OddpoolMarket,
  query: string,
  kalshiMarket?: KalshiSearchMarket,
): number {
  const queryTokens = tokenizeSearchText(query);
  const questionTokens = tokenizeSearchText(row.question);
  const eventTokens = tokenizeSearchText(row.event_title ?? "");
  const outcomeTokens = tokenizeSearchText(
    getKalshiOutcomeLabel(kalshiMarket) ?? "",
  );
  const allTokens = new Set([
    ...questionTokens,
    ...eventTokens,
    ...outcomeTokens,
    ...tokenizeSearchText(row.category ?? ""),
    ...tokenizeSearchText(row.market_id),
  ]);
  const matchedTokens = queryTokens.filter((token) => allTokens.has(token));
  const denominator = Math.max(1, queryTokens.length);
  const tokenCoverageScore = (matchedTokens.length / denominator) * 1_000;
  const questionCoverageScore =
    (queryTokens.filter((token) => questionTokens.includes(token)).length /
      denominator) *
    150;
  const eventCoverageScore =
    (queryTokens.filter((token) => eventTokens.includes(token)).length /
      denominator) *
    180;
  const outcomeCoverageScore =
    (queryTokens.filter((token) => outcomeTokens.includes(token)).length /
      denominator) *
    200;
  const normalizedQuery = queryTokens.join(" ");
  const normalizedQuestion = questionTokens.join(" ");
  const normalizedEvent = eventTokens.join(" ");
  const phraseScore =
    (normalizedQuery && normalizedQuestion.includes(normalizedQuery)
      ? 120
      : 0) +
    (normalizedQuery && normalizedEvent.includes(normalizedQuery) ? 100 : 0);
  const volumeScore = Math.log10(1 + Math.max(0, row.volume ?? 0)) * 20;
  const liquidityScore = Math.log10(1 + Math.max(0, row.liquidity ?? 0)) * 10;
  return (
    tokenCoverageScore +
    questionCoverageScore +
    eventCoverageScore +
    outcomeCoverageScore +
    phraseScore +
    volumeScore +
    liquidityScore
  );
}

/** Month and domain aliases used to match equivalent market wording. */
const SEARCH_TOKEN_ALIASES: Readonly<Record<string, string>> = {
  apr: "april",
  aug: "august",
  btc: "bitcoin",
  dec: "december",
  federal: "fed",
  feb: "february",
  jan: "january",
  jul: "july",
  jun: "june",
  mar: "march",
  nov: "november",
  oct: "october",
  sep: "september",
  sept: "september",
};

/**
 * Converts search text to comparable tokens, including number formatting,
 * common month abbreviations, BTC, and simple plural variants.
 *
 * @param value - User query or market field.
 * @returns Normalized tokens in source order.
 */
function tokenizeSearchText(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/(?<=\d),(?=\d)/g, "")
    .split(/[^a-z0-9.]+/)
    .filter(Boolean)
    .map((token) => SEARCH_TOKEN_ALIASES[token] ?? token)
    .map((token) =>
      token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token,
    );
}

/**
 * Produces a stable key for diversity penalties across one event's outcomes.
 *
 * @param row - Oddpool market candidate.
 * @returns Event identifier with a readable fallback.
 */
function getOddpoolEventKey(row: OddpoolMarket): string {
  return row.event_id?.trim() || row.event_title?.trim() || row.question.trim();
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
