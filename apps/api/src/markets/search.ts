import {
  MarketPairSearchResponseSchema,
  MarketSearchResponseSchema,
  type MarketPairSearchResponse,
  type MarketPlatform,
  type MarketSearchPair,
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

/** Maximum event pairs expanded into outcome markets for one query. */
const ODDPOOL_EVENT_PAIR_EXPANSION_LIMIT = 4;

/** Extra market-pair candidates retained before live Kalshi status filtering. */
const MARKET_PAIR_CANDIDATE_LIMIT = 20;

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

/** Oddpool event fields used to identify equivalent cross-venue events. */
const OddpoolEventSchema = z.object({
  event_id: z.string(),
  exchange: z.string(),
  market_questions: z.array(z.string()).nullish(),
  status: z.string(),
  title: z
    .string()
    .nullish()
    .transform((value) => value?.trim() ?? ""),
  total_liquidity: z.coerce.number().nullish(),
  total_volume: z.coerce.number().nullish(),
});

/** Bare array returned by Oddpool event search. */
const OddpoolEventSearchResponseSchema = z.array(OddpoolEventSchema);

/** One validated Oddpool event-search row. */
type OddpoolEvent = z.infer<typeof OddpoolEventSchema>;

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

/** Cached cross-venue pair result and its load time. */
interface PairSearchCacheEntry {
  loadedAtMilliseconds: number;
  pairs: readonly MarketSearchPair[];
}

/** One semantically scored pair of Oddpool events. */
interface ScoredEventPair {
  kalshi: OddpoolEvent;
  polymarket: OddpoolEvent;
  score: number;
}

/** One semantically scored pair of Oddpool outcome markets. */
interface ScoredMarketPair {
  eventKey: string;
  kalshi: OddpoolMarket & { exchange: "kalshi" };
  polymarket: OddpoolMarket & { exchange: "polymarket" };
  score: number;
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
  private readonly pairSearchCache = new Map<string, PairSearchCacheEntry>();
  private readonly pairSearchesInProgress = new Map<
    string,
    Promise<readonly MarketSearchPair[]>
  >();
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
   * Searches and aligns semantically equivalent markets across both venues.
   *
   * @param query - User-entered term containing at least three characters.
   * @returns Ranked cross-venue market pairs.
   */
  public async searchPairs(query: string): Promise<MarketPairSearchResponse> {
    if (!this.oddpoolApiKey) {
      throw new MarketSearchUnavailableError(
        `Market search is not configured. Add ODDPOOL_API_KEY to the server environment.`,
        503,
      );
    }
    const normalizedQuery = query.trim();
    const cacheKey = normalizedQuery.toLowerCase();
    const cached = this.pairSearchCache.get(cacheKey);
    if (
      cached &&
      Date.now() - cached.loadedAtMilliseconds <
        MARKET_SEARCH_CACHE_TTL_MILLISECONDS
    ) {
      return MarketPairSearchResponseSchema.parse({
        pairs: cached.pairs,
        query: normalizedQuery,
      });
    }
    const existingSearch = this.pairSearchesInProgress.get(cacheKey);
    const pairs =
      existingSearch ?? this.startPairSearch(cacheKey, normalizedQuery);
    return MarketPairSearchResponseSchema.parse({
      pairs: await pairs,
      query: normalizedQuery,
    });
  }

  /**
   * Starts one cacheable pair search and clears its in-flight entry afterward.
   *
   * @param cacheKey - Lowercase query cache key.
   * @param query - Trimmed user query.
   * @returns In-flight aligned market pairs.
   */
  private startPairSearch(
    cacheKey: string,
    query: string,
  ): Promise<readonly MarketSearchPair[]> {
    const search = this.searchOddpoolPairs(query)
      .then((pairs) => {
        if (this.pairSearchCache.size >= MARKET_SEARCH_MAXIMUM_CACHE_ENTRIES) {
          const oldestKey = this.pairSearchCache.keys().next().value;
          if (typeof oldestKey === "string") {
            this.pairSearchCache.delete(oldestKey);
          }
        }
        this.pairSearchCache.set(cacheKey, {
          loadedAtMilliseconds: Date.now(),
          pairs,
        });
        return pairs;
      })
      .finally(() => {
        this.pairSearchesInProgress.delete(cacheKey);
      });
    this.pairSearchesInProgress.set(cacheKey, search);
    return search;
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
   * Searches event groups first, expands the best event matches, and aligns
   * their individual outcome markets.
   *
   * @param query - Trimmed user search phrase.
   * @returns Semantically aligned selectable pairs.
   */
  private async searchOddpoolPairs(query: string): Promise<MarketSearchPair[]> {
    const [polymarketEvents, kalshiEvents] = await Promise.all([
      this.fetchOddpoolEvents("polymarket", query),
      this.fetchOddpoolEvents("kalshi", query),
    ]);
    const eventPairs = rankOddpoolEventPairs(
      polymarketEvents,
      kalshiEvents,
      query,
    );
    const expandedEventPairs = await Promise.all(
      eventPairs.map(async (eventPair) => {
        const [polymarketMarkets, kalshiMarkets] = await Promise.all([
          this.fetchOddpoolEventMarkets(
            eventPair.polymarket.event_id,
            "polymarket",
          ),
          this.fetchOddpoolEventMarkets(eventPair.kalshi.event_id, "kalshi"),
        ]);
        return rankOddpoolMarketPairs(
          eventPair,
          polymarketMarkets,
          kalshiMarkets,
          query,
        );
      }),
    );
    const selectedCandidates = selectDistinctMarketPairs(
      expandedEventPairs.flat(),
      MARKET_PAIR_CANDIDATE_LIMIT,
    );
    const kalshiDetails = await this.fetchKalshiSearchMarkets(
      selectedCandidates.map((pair) => pair.kalshi.market_id),
    );
    return selectedCandidates
      .filter((pair) => {
        const status = kalshiDetails
          .get(pair.kalshi.market_id.toUpperCase())
          ?.status?.toLowerCase();
        return status !== "closed" && status !== "settled";
      })
      .slice(0, MARKET_SEARCH_RESULT_LIMIT)
      .map((pair) => ({
        kalshi: normalizeOddpoolMarket(
          pair.kalshi,
          kalshiDetails.get(pair.kalshi.market_id.toUpperCase()),
        ),
        polymarket: normalizeOddpoolMarket(pair.polymarket),
      }));
  }

  /**
   * Searches active Oddpool event groups for one venue.
   *
   * @param platform - Venue event filter.
   * @param query - Trimmed user query.
   * @returns Validated event candidates.
   */
  private async fetchOddpoolEvents(
    platform: MarketPlatform,
    query: string,
  ): Promise<OddpoolEvent[]> {
    const url = new URL("/search/events", ODDPOOL_API_BASE_URL);
    url.searchParams.set("exchange", platform);
    url.searchParams.set("limit", String(ODDPOOL_SEARCH_LIMIT));
    url.searchParams.set("q", query);
    url.searchParams.set("sort_by", "relevance");
    url.searchParams.set("status", "active");
    return OddpoolEventSearchResponseSchema.parse(
      await this.fetchOddpoolJson(url),
    ).filter((event) => event.exchange === platform && event.title.length > 0);
  }

  /**
   * Lists all child markets under one paired Oddpool event.
   *
   * @param eventId - Venue-native event identifier.
   * @param platform - Expected venue used to reject stray rows.
   * @returns Validated event outcome markets.
   */
  private async fetchOddpoolEventMarkets(
    eventId: string,
    platform: MarketPlatform,
  ): Promise<Array<OddpoolMarket & { exchange: MarketPlatform }>> {
    const url = new URL(
      `/search/events/${encodeURIComponent(eventId)}/markets`,
      ODDPOOL_API_BASE_URL,
    );
    return OddpoolMarketSearchResponseSchema.parse(
      await this.fetchOddpoolJson(url),
    ).filter(
      (market): market is OddpoolMarket & { exchange: MarketPlatform } =>
        market.exchange === platform && market.status === "active",
    );
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
 * Selects the strongest one-to-one event matches across Polymarket and Kalshi.
 *
 * @param polymarketEvents - Polymarket event candidates.
 * @param kalshiEvents - Kalshi event candidates.
 * @param query - User search phrase.
 * @returns Best distinct event pairs to expand into child markets.
 */
function rankOddpoolEventPairs(
  polymarketEvents: readonly OddpoolEvent[],
  kalshiEvents: readonly OddpoolEvent[],
  query: string,
): ScoredEventPair[] {
  const candidates = polymarketEvents
    .flatMap((polymarket) =>
      kalshiEvents
        .filter((kalshi) => isCredibleEventPair(polymarket, kalshi, query))
        .map((kalshi) => ({
          kalshi,
          polymarket,
          score: calculateEventPairScore(polymarket, kalshi, query),
        })),
    )
    .sort((left, right) => right.score - left.score);
  const selected: ScoredEventPair[] = [];
  const usedKalshiEvents = new Set<string>();
  const usedPolymarketEvents = new Set<string>();
  for (const candidate of candidates) {
    if (
      usedKalshiEvents.has(candidate.kalshi.event_id) ||
      usedPolymarketEvents.has(candidate.polymarket.event_id)
    ) {
      continue;
    }
    selected.push(candidate);
    usedKalshiEvents.add(candidate.kalshi.event_id);
    usedPolymarketEvents.add(candidate.polymarket.event_id);
    if (selected.length >= ODDPOOL_EVENT_PAIR_EXPANSION_LIMIT) {
      break;
    }
  }
  return selected;
}

/**
 * Rejects event pairs that only share a broad query term without describing
 * the same event structure.
 *
 * @param polymarket - Polymarket event candidate.
 * @param kalshi - Kalshi event candidate.
 * @param query - User search phrase.
 * @returns True when the pair is credible enough to expand.
 */
function isCredibleEventPair(
  polymarket: OddpoolEvent,
  kalshi: OddpoolEvent,
  query: string,
): boolean {
  const queryTokens = new Set(tokenizeSearchText(query));
  const specificQueryTokens = new Set(
    [...queryTokens].filter((token) => !GENERIC_EVENT_QUERY_TOKENS.has(token)),
  );
  const requiredQueryTokens =
    specificQueryTokens.size > 0 ? specificQueryTokens : queryTokens;
  const minimumTitleCoverage = queryTokens.size <= 1 ? 1 : 0.5;
  const titleCoverage = Math.min(
    calculateTokenCoverage(tokenizeSearchText(polymarket.title), queryTokens),
    calculateTokenCoverage(tokenizeSearchText(kalshi.title), queryTokens),
  );
  return (
    titleCoverage >= minimumTitleCoverage &&
    calculateTokenCoverage(
      tokenizeSearchText(polymarket.title),
      requiredQueryTokens,
    ) > 0 &&
    calculateTokenCoverage(
      tokenizeSearchText(kalshi.title),
      requiredQueryTokens,
    ) > 0 &&
    calculateEventSemanticSimilarity(polymarket, kalshi, queryTokens) >= 0.35 &&
    calculateDateCompatibilityScore(polymarket.title, kalshi.title) > -500 &&
    calculateDateCompatibilityScore(query, polymarket.title) > -500 &&
    calculateDateCompatibilityScore(query, kalshi.title) > -500
  );
}

/** Broad query tokens that cannot establish event identity by themselves. */
const GENERIC_EVENT_QUERY_TOKENS = new Set([
  "cup",
  "fed",
  "market",
  "price",
  "rate",
  "world",
]);

/**
 * Compares event titles and their child-question vocabulary without allowing a
 * long outcome list to dilute an otherwise exact title match.
 *
 * @param polymarket - Polymarket event candidate.
 * @param kalshi - Kalshi event candidate.
 * @param queryTokens - Query tokens omitted from semantic comparison.
 * @returns Best title-only or expanded event similarity.
 */
function calculateEventSemanticSimilarity(
  polymarket: OddpoolEvent,
  kalshi: OddpoolEvent,
  queryTokens: ReadonlySet<string>,
): number {
  const titleSimilarity = calculateSetSimilarity(
    getSemanticTokenSet(polymarket.title, queryTokens),
    getSemanticTokenSet(kalshi.title, queryTokens),
  );
  const expandedSimilarity = calculateSetSimilarity(
    getSemanticTokenSet(
      `${polymarket.title} ${(polymarket.market_questions ?? []).join(" ")}`,
      queryTokens,
    ),
    getSemanticTokenSet(
      `${kalshi.title} ${(kalshi.market_questions ?? []).join(" ")}`,
      queryTokens,
    ),
  );
  return Math.max(titleSimilarity, expandedSimilarity);
}

/**
 * Scores whether two event groups describe the same real-world proposition.
 *
 * @param polymarket - Polymarket event candidate.
 * @param kalshi - Kalshi event candidate.
 * @param query - User search phrase.
 * @returns Comparable semantic event score.
 */
function calculateEventPairScore(
  polymarket: OddpoolEvent,
  kalshi: OddpoolEvent,
  query: string,
): number {
  const queryTokens = new Set(tokenizeSearchText(query));
  const polymarketTokens = getSemanticTokenSet(polymarket.title, queryTokens);
  const kalshiTokens = getSemanticTokenSet(kalshi.title, queryTokens);
  const crossSimilarity = calculateEventSemanticSimilarity(
    polymarket,
    kalshi,
    queryTokens,
  );
  const polymarketTitleQueryCoverage = calculateTokenCoverage(
    tokenizeSearchText(polymarket.title),
    queryTokens,
  );
  const kalshiTitleQueryCoverage = calculateTokenCoverage(
    tokenizeSearchText(kalshi.title),
    queryTokens,
  );
  const polymarketQueryCoverage = calculateTokenCoverage(
    tokenizeSearchText(
      `${polymarket.title} ${(polymarket.market_questions ?? []).join(" ")}`,
    ),
    queryTokens,
  );
  const kalshiQueryCoverage = calculateTokenCoverage(
    tokenizeSearchText(
      `${kalshi.title} ${(kalshi.market_questions ?? []).join(" ")}`,
    ),
    queryTokens,
  );
  const sharedTokenCount = [...polymarketTokens].filter((token) =>
    kalshiTokens.has(token),
  ).length;
  const volumeScore =
    Math.log10(
      1 +
        Math.max(0, polymarket.total_volume ?? 0) +
        Math.max(0, kalshi.total_volume ?? 0),
    ) * 8;
  const liquidityScore =
    Math.log10(
      1 +
        Math.max(0, polymarket.total_liquidity ?? 0) +
        Math.max(0, kalshi.total_liquidity ?? 0),
    ) * 4;
  const dateCompatibilityScore = calculateDateCompatibilityScore(
    polymarket.title,
    kalshi.title,
  );
  return (
    crossSimilarity * 1_000 +
    Math.min(1, sharedTokenCount / 3) * 200 +
    Math.min(polymarketTitleQueryCoverage, kalshiTitleQueryCoverage) * 1_000 +
    Math.min(polymarketQueryCoverage, kalshiQueryCoverage) * 500 +
    dateCompatibilityScore +
    volumeScore +
    liquidityScore
  );
}

/**
 * Greedily aligns distinct child outcomes within one already-matched event.
 *
 * @param eventPair - Semantically matched event groups.
 * @param polymarketMarkets - Polymarket child markets.
 * @param kalshiMarkets - Kalshi child markets.
 * @param query - User search phrase.
 * @returns Distinct outcome pairs ordered by equivalence quality.
 */
function rankOddpoolMarketPairs(
  eventPair: ScoredEventPair,
  polymarketMarkets: readonly (OddpoolMarket & {
    exchange: MarketPlatform;
  })[],
  kalshiMarkets: readonly (OddpoolMarket & {
    exchange: MarketPlatform;
  })[],
  query: string,
): ScoredMarketPair[] {
  const candidates = polymarketMarkets
    .flatMap((polymarket) =>
      kalshiMarkets
        .filter((kalshi) => isCredibleMarketPair(polymarket, kalshi, query))
        .map((kalshi) => ({
          eventKey: `${eventPair.polymarket.event_id}:${eventPair.kalshi.event_id}`,
          kalshi: kalshi as OddpoolMarket & { exchange: "kalshi" },
          polymarket: polymarket as OddpoolMarket & {
            exchange: "polymarket";
          },
          score: calculateMarketPairScore(
            polymarket,
            kalshi,
            eventPair.score,
            query,
          ),
        })),
    )
    .sort((left, right) => right.score - left.score);
  return selectDistinctMarketPairs(candidates, MARKET_SEARCH_RESULT_LIMIT);
}

/**
 * Rejects child markets whose direction, range shape, price, or explicit query
 * target differs despite belonging to otherwise similar parent events.
 *
 * @param polymarket - Polymarket child-market candidate.
 * @param kalshi - Kalshi child-market candidate.
 * @param query - User search phrase.
 * @returns True only for outcomes safe to present as equivalents.
 */
function isCredibleMarketPair(
  polymarket: OddpoolMarket,
  kalshi: OddpoolMarket,
  query: string,
): boolean {
  const polymarketDirection = getOddpoolMarketDirection(polymarket);
  const kalshiDirection = getOddpoolMarketDirection(kalshi);
  if (
    polymarketDirection !== "neutral" &&
    kalshiDirection !== "neutral" &&
    polymarketDirection !== kalshiDirection
  ) {
    return false;
  }
  const polymarketStructure = getMarketStructure(polymarket);
  const kalshiStructure = getMarketStructure(kalshi);
  if (
    polymarketStructure !== "other" &&
    kalshiStructure !== "other" &&
    polymarketStructure !== kalshiStructure
  ) {
    return false;
  }
  const polymarketNumbers = extractComparableNumbers(polymarket);
  const kalshiNumbers = extractComparableNumbers(kalshi);
  const containsCurrencyThreshold =
    polymarket.question.includes("$") || kalshi.question.includes("$");
  if (
    containsCurrencyThreshold &&
    !haveEquivalentNumberSets(polymarketNumbers, kalshiNumbers)
  ) {
    return false;
  }
  const queryNumbers = extractQueryOutcomeNumbers(query);
  return queryNumbers.every(
    (queryNumber) =>
      containsApproximatelyEqualNumber(polymarketNumbers, queryNumber) &&
      containsApproximatelyEqualNumber(kalshiNumbers, queryNumber),
  );
}

/**
 * Scores child-market equivalence using wording, threshold, and direction.
 *
 * @param polymarket - Polymarket outcome market.
 * @param kalshi - Kalshi outcome market.
 * @param eventScore - Parent event equivalence score.
 * @param query - User search phrase.
 * @returns Comparable outcome-pair score.
 */
function calculateMarketPairScore(
  polymarket: OddpoolMarket,
  kalshi: OddpoolMarket,
  eventScore: number,
  query: string,
): number {
  const ignoredTokens = new Set([
    ...tokenizeSearchText(query),
    ...tokenizeSearchText(polymarket.event_title ?? ""),
    ...tokenizeSearchText(kalshi.event_title ?? ""),
  ]);
  const polymarketTokens = getSemanticTokenSet(
    polymarket.question,
    ignoredTokens,
  );
  const kalshiTokens = getSemanticTokenSet(kalshi.question, ignoredTokens);
  const wordingScore =
    calculateSetSimilarity(polymarketTokens, kalshiTokens) * 400;
  const numericScore = calculateNumericEquivalenceScore(
    extractComparableNumbers(polymarket),
    extractComparableNumbers(kalshi),
  );
  const polymarketDirection = getOddpoolMarketDirection(polymarket);
  const kalshiDirection = getOddpoolMarketDirection(kalshi);
  const directionScore =
    polymarketDirection === kalshiDirection && polymarketDirection !== "neutral"
      ? 150
      : polymarketDirection !== "neutral" &&
          kalshiDirection !== "neutral" &&
          polymarketDirection !== kalshiDirection
        ? -450
        : 0;
  const polymarketStructure = getMarketStructure(polymarket);
  const kalshiStructure = getMarketStructure(kalshi);
  const structureScore =
    polymarketStructure === kalshiStructure
      ? 100
      : polymarketStructure === "other" || kalshiStructure === "other"
        ? 0
        : -600;
  const activityScore =
    Math.log10(
      1 + Math.max(0, polymarket.volume ?? 0) + Math.max(0, kalshi.volume ?? 0),
    ) * 6;
  return (
    eventScore +
    wordingScore +
    numericScore +
    directionScore +
    structureScore +
    activityScore
  );
}

/**
 * Selects globally distinct markets from scored pair candidates.
 *
 * @param candidates - Scored pair candidates.
 * @param limit - Maximum pairs returned.
 * @returns Highest-scoring one-to-one market pairs.
 */
function selectDistinctMarketPairs(
  candidates: readonly ScoredMarketPair[],
  limit: number,
): ScoredMarketPair[] {
  const selected: ScoredMarketPair[] = [];
  const usedKalshiMarkets = new Set<string>();
  const usedPolymarketMarkets = new Set<string>();
  for (const candidate of [...candidates].sort(
    (left, right) => right.score - left.score,
  )) {
    if (
      usedKalshiMarkets.has(candidate.kalshi.market_id) ||
      usedPolymarketMarkets.has(candidate.polymarket.market_id)
    ) {
      continue;
    }
    selected.push(candidate);
    usedKalshiMarkets.add(candidate.kalshi.market_id);
    usedPolymarketMarkets.add(candidate.polymarket.market_id);
    if (selected.length >= limit) {
      break;
    }
  }
  return selected;
}

/** Search tokens that do not distinguish prediction-market propositions. */
const SEARCH_SEMANTIC_STOP_WORDS = new Set([
  "a",
  "after",
  "at",
  "be",
  "before",
  "by",
  "for",
  "from",
  "get",
  "how",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "this",
  "to",
  "what",
  "when",
  "which",
  "who",
  "will",
]);

/**
 * Builds a meaningful token set while omitting the query and generic grammar.
 *
 * @param value - Event or market text.
 * @param ignoredTokens - Query or parent-event tokens to omit.
 * @returns Distinguishing semantic tokens.
 */
function getSemanticTokenSet(
  value: string,
  ignoredTokens: ReadonlySet<string>,
): Set<string> {
  return new Set(
    tokenizeSearchText(value).filter(
      (token) =>
        !ignoredTokens.has(token) &&
        !SEARCH_SEMANTIC_STOP_WORDS.has(token) &&
        !/^\d/.test(token),
    ),
  );
}

/**
 * Calculates Jaccard similarity for two semantic token sets.
 *
 * @param left - First token set.
 * @param right - Second token set.
 * @returns Similarity from zero to one.
 */
function calculateSetSimilarity(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) {
    return 0;
  }
  const intersectionSize = [...left].filter((token) => right.has(token)).length;
  return intersectionSize / union.size;
}

/**
 * Measures how much of a query appears in one token list.
 *
 * @param tokens - Event title and question tokens.
 * @param queryTokens - Unique normalized query tokens.
 * @returns Coverage from zero to one.
 */
function calculateTokenCoverage(
  tokens: readonly string[],
  queryTokens: ReadonlySet<string>,
): number {
  if (queryTokens.size === 0) {
    return 0;
  }
  const tokenSet = new Set(tokens);
  return (
    [...queryTokens].filter((token) => tokenSet.has(token)).length /
    queryTokens.size
  );
}

/** Month number keyed by normalized search token. */
const SEARCH_MONTH_NUMBERS: Readonly<Record<string, number>> = {
  april: 4,
  august: 8,
  december: 12,
  february: 2,
  january: 1,
  july: 7,
  june: 6,
  march: 3,
  may: 5,
  november: 11,
  october: 10,
  september: 9,
};

/** Calendar parts explicitly present in event text. */
interface SearchDateSignature {
  day: number | null;
  month: number | null;
  year: number | null;
}

/**
 * Extracts an explicitly named month, day, and year from event text.
 *
 * @param value - Event title.
 * @returns Calendar signature with absent parts represented by null.
 */
function extractSearchDateSignature(value: string): SearchDateSignature {
  const tokens = tokenizeSearchText(value);
  const monthIndex = tokens.findIndex(
    (token) => SEARCH_MONTH_NUMBERS[token] !== undefined,
  );
  const followingDay = Number(tokens[monthIndex + 1]);
  const year = tokens
    .map(Number)
    .find((candidate) => candidate >= 2000 && candidate <= 2100);
  return {
    day:
      monthIndex >= 0 &&
      Number.isInteger(followingDay) &&
      followingDay >= 1 &&
      followingDay <= 31
        ? followingDay
        : null,
    month:
      monthIndex >= 0
        ? (SEARCH_MONTH_NUMBERS[tokens[monthIndex] ?? ""] ?? null)
        : null,
    year: year ?? null,
  };
}

/**
 * Rewards matching event dates and strongly rejects explicit date conflicts.
 *
 * @param leftValue - First event title.
 * @param rightValue - Second event title.
 * @returns Date compatibility contribution to event similarity.
 */
function calculateDateCompatibilityScore(
  leftValue: string,
  rightValue: string,
): number {
  const left = extractSearchDateSignature(leftValue);
  const right = extractSearchDateSignature(rightValue);
  if (left.year && right.year && left.year !== right.year) {
    return -800;
  }
  if (left.month && right.month && left.month !== right.month) {
    return -800;
  }
  if (
    left.month &&
    right.month &&
    left.month === right.month &&
    left.day &&
    right.day &&
    left.day !== right.day
  ) {
    return -900;
  }
  if (
    left.month &&
    right.month &&
    left.month === right.month &&
    left.day &&
    right.day &&
    left.day === right.day
  ) {
    return 300;
  }
  return left.year && right.year && left.year === right.year ? 100 : 0;
}

/** Market threshold direction used to reject opposite propositions. */
type MarketDirection = "up" | "down" | "neutral";

/**
 * Extracts an above/below direction from market wording.
 *
 * @param value - Market question.
 * @returns Normalized direction or neutral.
 */
function getMarketDirection(value: string): MarketDirection {
  if (/\b(?:dip|below|less than|lower|under)\b/i.test(value)) {
    return "down";
  }
  if (/\b(?:above|at least|greater than|higher than|reach)\b/i.test(value)) {
    return "up";
  }
  return "neutral";
}

/**
 * Infers direction from question wording or Kalshi's terminal ticker code.
 *
 * @param market - Oddpool outcome market.
 * @returns Normalized threshold direction.
 */
function getOddpoolMarketDirection(market: OddpoolMarket): MarketDirection {
  const textDirection = getMarketDirection(market.question);
  if (textDirection !== "neutral") {
    return textDirection;
  }
  const finalTickerSegment = market.market_id.split("-").at(-1) ?? "";
  return market.exchange === "kalshi" && /^T\d/i.test(finalTickerSegment)
    ? "up"
    : "neutral";
}

/** Market outcome structure used to avoid aligning ranges with thresholds. */
type MarketStructure = "range" | "threshold" | "other";

/**
 * Classifies an outcome as a bounded range, one-sided threshold, or other.
 *
 * @param market - Oddpool outcome market.
 * @returns Normalized market structure.
 */
function getMarketStructure(market: OddpoolMarket): MarketStructure {
  const finalTickerSegment = market.market_id.split("-").at(-1) ?? "";
  if (
    /\b(?:between|range)\b/i.test(
      `${market.question} ${market.event_title ?? ""}`,
    ) ||
    (market.exchange === "kalshi" && /^B\d/i.test(finalTickerSegment))
  ) {
    return "range";
  }
  return getOddpoolMarketDirection(market) === "neutral"
    ? "other"
    : "threshold";
}

/**
 * Extracts outcome quantities such as prices, basis points, or goal totals.
 *
 * @param market - Oddpool child market.
 * @returns Comparable numeric outcome values.
 */
function extractComparableNumbers(market: OddpoolMarket): number[] {
  const values: number[] = [];
  for (const match of market.question.matchAll(/\$([\d,]+(?:\.\d+)?)/g)) {
    values.push(Number((match[1] ?? "").replaceAll(",", "")));
  }
  for (const match of market.question.matchAll(
    /\b(\d+(?:\.\d+)?)\s*(?:\+\s*)?(?:bps|goals?|%)/gi,
  )) {
    values.push(Number(match[1]));
  }
  if (values.length === 0 && market.exchange === "kalshi") {
    const finalSegment = market.market_id.split("-").at(-1) ?? "";
    const tickerNumber = finalSegment.match(/\d+(?:\.\d+)?/i)?.[0];
    if (tickerNumber) {
      values.push(Number(tickerNumber));
    }
  }
  return [...new Set(values.filter(Number.isFinite))];
}

/**
 * Extracts explicit outcome quantities from a user query while excluding dates.
 *
 * Bare numbers are considered outcomes only at 1,000 or above, which supports
 * price searches such as `bitcoin 72000` without treating day or year tokens as
 * market thresholds.
 *
 * @param query - User search phrase.
 * @returns Unique numeric outcome targets.
 */
function extractQueryOutcomeNumbers(query: string): number[] {
  const values = new Set<number>();
  for (const match of query.matchAll(/\$?([\d,]+(?:\.\d+)?)/g)) {
    const value = Number((match[1] ?? "").replaceAll(",", ""));
    const matchedText = match[0] ?? "";
    const followingText = query.slice(match.index + matchedText.length);
    const hasOutcomeUnit = /^\s*(?:bps|goals?|%)/i.test(followingText);
    const isBareLargeOutcome =
      !matchedText.startsWith("$") && value >= 1_000 && value > 2_100;
    if (
      Number.isFinite(value) &&
      (matchedText.startsWith("$") || hasOutcomeUnit || isBareLargeOutcome)
    ) {
      values.add(value);
    }
  }
  return [...values];
}

/**
 * Checks whether a candidate number set contains one approximately equal value.
 *
 * @param values - Candidate market quantities.
 * @param target - Desired quantity.
 * @returns True when a value differs from the target by no more than 0.1%.
 */
function containsApproximatelyEqualNumber(
  values: readonly number[],
  target: number,
): boolean {
  return values.some(
    (value) =>
      Math.abs(value - target) /
        Math.max(1, Math.abs(value), Math.abs(target)) <=
      0.001,
  );
}

/**
 * Compares complete numeric signatures instead of accepting one shared bound.
 *
 * @param leftValues - First market's quantities.
 * @param rightValues - Second market's quantities.
 * @returns True when both sets contain the same approximately equal values.
 */
function haveEquivalentNumberSets(
  leftValues: readonly number[],
  rightValues: readonly number[],
): boolean {
  return (
    leftValues.length > 0 &&
    leftValues.length === rightValues.length &&
    leftValues.every((value) =>
      containsApproximatelyEqualNumber(rightValues, value),
    ) &&
    rightValues.every((value) =>
      containsApproximatelyEqualNumber(leftValues, value),
    )
  );
}

/**
 * Scores whether two outcome quantity sets describe the same threshold.
 *
 * Kalshi frequently encodes an inclusive $130,000 threshold as $129,999.99,
 * so differences within 0.1% are treated as exact semantic matches.
 *
 * @param leftValues - Polymarket quantities.
 * @param rightValues - Kalshi quantities.
 * @returns Positive score for equivalent values and penalty for conflicts.
 */
function calculateNumericEquivalenceScore(
  leftValues: readonly number[],
  rightValues: readonly number[],
): number {
  if (leftValues.length === 0 && rightValues.length === 0) {
    return 0;
  }
  if (leftValues.length === 0 || rightValues.length === 0) {
    return -80;
  }
  let smallestRelativeDifference = Number.POSITIVE_INFINITY;
  for (const left of leftValues) {
    for (const right of rightValues) {
      const relativeDifference =
        Math.abs(left - right) / Math.max(1, Math.abs(left), Math.abs(right));
      smallestRelativeDifference = Math.min(
        smallestRelativeDifference,
        relativeDifference,
      );
    }
  }
  if (smallestRelativeDifference <= 0.001) {
    return 900;
  }
  if (smallestRelativeDifference <= 0.02) {
    return 200;
  }
  return -500;
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
  between: "range",
  btc: "bitcoin",
  dec: "december",
  federal: "fed",
  feb: "february",
  high: "above",
  higher: "above",
  hit: "above",
  jan: "january",
  jul: "july",
  jun: "june",
  mar: "march",
  nov: "november",
  oct: "october",
  reach: "above",
  reached: "above",
  score: "goal",
  scored: "goal",
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
