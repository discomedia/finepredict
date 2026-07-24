import { z } from "zod";

import { HttpServiceError } from "../common/http.js";
import { KalshiRequestScheduler } from "../discovery/kalshi-request-scheduler.js";
import type {
  NativeBinaryMarket,
  NativeCatalogRefreshResult,
} from "./types.js";

const kalshiMarketSchema = z.object({
  ticker: z.string(),
  event_ticker: z.string(),
  title: z.string(),
  yes_sub_title: z.string().default(""),
  rules_primary: z.string().default(""),
  rules_secondary: z.string().default(""),
  status: z.string(),
  open_time: z.string().optional(),
  close_time: z.string().optional(),
  updated_time: z.string().optional(),
  yes_ask_dollars: z.coerce.number().default(0),
  no_ask_dollars: z.coerce.number().default(0),
  volume_fp: z.coerce.number().default(0),
  liquidity_dollars: z.coerce.number().default(0),
});

const kalshiMarketsPageSchema = z.object({
  cursor: z.string().default(""),
  markets: z.array(kalshiMarketSchema),
});

const kalshiEventSchema = z.object({
  event_ticker: z.string(),
  series_ticker: z.string(),
  title: z.string().default(""),
  category: z.string().default("other"),
  mutually_exclusive: z.boolean().default(false),
  collateral_return_type: z.string().default(""),
});

const kalshiEventsPageSchema = z.object({
  cursor: z.string().default(""),
  events: z.array(kalshiEventSchema),
});

const feeScheduleSchema = z.object({
  rate: z.coerce.number().nonnegative(),
  exponent: z.coerce.number().nonnegative().default(1),
});

const polymarketMarketSchema = z.object({
  conditionId: z.string(),
  question: z.string(),
  description: z.string().default(""),
  slug: z.string(),
  active: z.boolean(),
  closed: z.boolean(),
  enableOrderBook: z.boolean().default(false),
  acceptingOrders: z.boolean().default(false),
  outcomes: z.string().default("[]"),
  clobTokenIds: z.string().default("[]"),
  groupItemTitle: z.string().default(""),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  updatedAt: z.string().optional(),
  orderMinSize: z.coerce.number().default(0),
  bestAsk: z.coerce.number().optional(),
  bestBid: z.coerce.number().optional(),
  volumeNum: z.coerce.number().default(0),
  liquidityNum: z.coerce.number().default(0),
  feesEnabled: z.boolean().default(false),
  feeSchedule: feeScheduleSchema.optional(),
  negRisk: z.boolean().default(false),
  negRiskOther: z.boolean().default(false),
  events: z
    .array(
      z.object({
        slug: z.string(),
        title: z.string().default(""),
      }),
    )
    .default([]),
});

const polymarketKeysetPageSchema = z.object({
  markets: z.array(polymarketMarketSchema),
  next_cursor: z.string().default(""),
});

/** Options controlling a native public catalog refresh. */
export interface NativeCatalogClientOptions {
  /** Kalshi public Trade API base URL. */
  readonly kalshiBaseUrl?: string;
  /** Polymarket public Gamma API base URL. */
  readonly polymarketGammaBaseUrl?: string;
  /** Safety cap for retained Kalshi markets. */
  readonly maximumKalshiMarkets?: number;
  /** Safety cap for retained Polymarket markets. */
  readonly maximumPolymarketMarkets?: number;
  /** Shared scheduler coordinating catalog, fee, and order-book Kalshi reads. */
  readonly kalshiRequestScheduler?: KalshiRequestScheduler;
}

/** Read-only public client for the complete native venue catalogs. */
export class NativeCatalogClient {
  private readonly kalshiBaseUrl: string;
  private readonly polymarketGammaBaseUrl: string;
  private readonly maximumKalshiMarkets: number;
  private readonly maximumPolymarketMarkets: number;
  private readonly kalshiRequestScheduler: KalshiRequestScheduler;
  private requestCount = 0;
  private nextRequestStartAtMs = 0;
  private requestStartChain: Promise<void> = Promise.resolve();

  /**
   * Creates a bounded native catalog client.
   *
   * @param options - Public endpoints and hard market-count caps.
   */
  public constructor(options: NativeCatalogClientOptions = {}) {
    this.kalshiBaseUrl =
      options.kalshiBaseUrl ?? "https://external-api.kalshi.com/trade-api/v2";
    this.polymarketGammaBaseUrl =
      options.polymarketGammaBaseUrl ?? "https://gamma-api.polymarket.com";
    this.maximumKalshiMarkets = options.maximumKalshiMarkets ?? 100_000;
    this.maximumPolymarketMarkets = options.maximumPolymarketMarkets ?? 20_000;
    this.kalshiRequestScheduler =
      options.kalshiRequestScheduler ?? new KalshiRequestScheduler();
  }

  /**
   * Refreshes both active binary catalogs without using credentials or AI.
   *
   * @returns Normalized markets and exact public request counts.
   */
  public async refresh(): Promise<NativeCatalogRefreshResult> {
    this.requestCount = 0;
    const [kalshiMarkets, kalshiEvents, polymarketMarkets] = await Promise.all([
      this.getKalshiMarkets(),
      this.getKalshiEvents(),
      this.getPolymarketMarkets(),
    ]);
    const kalshiEventById = new Map(
      kalshiEvents.map((event) => [event.event_ticker, event]),
    );
    const normalizedKalshi = kalshiMarkets.map((market) =>
      normalizeKalshiMarket(market, kalshiEventById.get(market.event_ticker)),
    );
    const normalizedPolymarket = polymarketMarkets
      .map(normalizePolymarketMarket)
      .filter((market): market is NativeBinaryMarket => market !== undefined);
    return {
      markets: [...normalizedKalshi, ...normalizedPolymarket],
      requestCount: this.requestCount,
      kalshiMarketCount: normalizedKalshi.length,
      polymarketMarketCount: normalizedPolymarket.length,
    };
  }

  /**
   * Fetches all currently open non-combinatorial Kalshi markets.
   *
   * @returns Validated Kalshi market rows.
   */
  private async getKalshiMarkets(): Promise<
    readonly z.infer<typeof kalshiMarketSchema>[]
  > {
    const markets: z.infer<typeof kalshiMarketSchema>[] = [];
    let cursor = "";
    do {
      const url = new URL("/trade-api/v2/markets", this.kalshiBaseUrl);
      url.searchParams.set("status", "open");
      url.searchParams.set("limit", "1000");
      url.searchParams.set("mve_filter", "exclude");
      if (cursor) {
        url.searchParams.set("cursor", cursor);
      }
      const page = kalshiMarketsPageSchema.parse(
        await this.getKalshiJson(url, "Kalshi markets API"),
      );
      markets.push(...page.markets);
      cursor = page.cursor;
      if (markets.length >= this.maximumKalshiMarkets) {
        return markets.slice(0, this.maximumKalshiMarkets);
      }
    } while (cursor);
    return markets;
  }

  /**
   * Fetches Kalshi parent events once so categories and fee series do not need
   * one request per candidate.
   *
   * @returns Validated Kalshi event rows.
   */
  private async getKalshiEvents(): Promise<
    readonly z.infer<typeof kalshiEventSchema>[]
  > {
    const events: z.infer<typeof kalshiEventSchema>[] = [];
    let cursor = "";
    do {
      const url = new URL("/trade-api/v2/events", this.kalshiBaseUrl);
      url.searchParams.set("status", "open");
      url.searchParams.set("limit", "200");
      url.searchParams.set("with_nested_markets", "false");
      if (cursor) {
        url.searchParams.set("cursor", cursor);
      }
      const page = kalshiEventsPageSchema.parse(
        await this.getKalshiJson(url, "Kalshi events API"),
      );
      events.push(...page.events);
      cursor = page.cursor;
    } while (cursor);
    return events;
  }

  /**
   * Fetches active Polymarket markets using cursor pagination, avoiding Gamma's
   * shallow offset ceiling.
   *
   * @returns Validated Gamma market rows.
   */
  private async getPolymarketMarkets(): Promise<
    readonly z.infer<typeof polymarketMarketSchema>[]
  > {
    const markets: z.infer<typeof polymarketMarketSchema>[] = [];
    let afterCursor = "";
    do {
      const url = new URL("/markets/keyset", this.polymarketGammaBaseUrl);
      url.searchParams.set("active", "true");
      url.searchParams.set("closed", "false");
      url.searchParams.set("limit", "500");
      if (afterCursor) {
        url.searchParams.set("after_cursor", afterCursor);
      }
      const page = polymarketKeysetPageSchema.parse(
        await this.getPolymarketJson(url, "Polymarket Gamma markets API"),
      );
      markets.push(...page.markets);
      const nextCursor = page.next_cursor;
      if (
        markets.length >= this.maximumPolymarketMarkets ||
        page.markets.length === 0 ||
        !nextCursor ||
        nextCursor === afterCursor
      ) {
        return markets.slice(0, this.maximumPolymarketMarkets);
      }
      afterCursor = nextCursor;
    } while (true);
  }

  /**
   * Routes one Kalshi catalog request through the scanner-wide scheduler.
   *
   * @param url - Public Kalshi URL.
   * @param service - Service name used in errors.
   * @returns Parsed unknown JSON.
   */
  private async getKalshiJson(url: URL, service: string): Promise<unknown> {
    return this.kalshiRequestScheduler.requestJson(url, service, () => {
      this.requestCount += 1;
    });
  }

  /**
   * Counts and retries one Polymarket catalog request.
   *
   * @param url - Public venue URL.
   * @param service - Service name used in errors.
   * @returns Parsed unknown JSON.
   */
  private async getPolymarketJson(url: URL, service: string): Promise<unknown> {
    const maximumAttempts = 4;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      await this.waitForRequestSlot();
      this.requestCount += 1;
      const response = await fetch(url);
      const body = await response.text();
      if (response.ok) {
        try {
          return JSON.parse(body) as unknown;
        } catch (error: unknown) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(`${service} returned invalid JSON: ${reason}`);
        }
      }
      const retryable = [429, 502, 503, 504].includes(response.status);
      if (!retryable || attempt === maximumAttempts) {
        throw new HttpServiceError(service, response.status, body);
      }
      const retryAfterSeconds = Number(response.headers.get("retry-after"));
      const delayMs =
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds * 1_000
          : response.status === 429
            ? 2_000 * attempt
            : 500 * attempt;
      await wait(delayMs);
    }
    throw new Error(`${service} exhausted its retry budget`);
  }

  /**
   * Spaces every venue request start through one shared queue.
   *
   * @returns Nothing after the request start slot is acquired.
   */
  private async waitForRequestSlot(): Promise<void> {
    const previous = this.requestStartChain;
    let releaseSlot: (() => void) | undefined;
    this.requestStartChain = new Promise<void>((resolvePromise) => {
      releaseSlot = resolvePromise;
    });
    await previous;
    const delayMs = Math.max(0, this.nextRequestStartAtMs - Date.now());
    if (delayMs > 0) {
      await wait(delayMs);
    }
    this.nextRequestStartAtMs = Date.now() + 125;
    releaseSlot?.();
  }
}

/**
 * Normalizes one Kalshi market and attaches its already-fetched parent event.
 *
 * @param market - Venue market row.
 * @param event - Optional parent event row.
 * @returns Shared native binary-market representation.
 */
export function normalizeKalshiMarket(
  market: z.infer<typeof kalshiMarketSchema>,
  event?: z.infer<typeof kalshiEventSchema>,
): NativeBinaryMarket {
  const description = [market.rules_primary, market.rules_secondary]
    .filter(Boolean)
    .join("\n\n");
  const providerCategory = normalizeCategory(event?.category ?? "other");
  const titleCategory = classifyCategory(
    `${market.title} ${event?.title ?? ""}`,
  );
  const refinedCategories = new Set([
    "business",
    "energy",
    "health",
    "legal",
    "social_culture",
    "transportation",
  ]);
  return {
    venue: "kalshi",
    marketId: market.ticker,
    eventId: market.event_ticker,
    ...(event?.title ? { eventTitle: event.title } : {}),
    ...(event?.series_ticker ? { seriesId: event.series_ticker } : {}),
    question: market.title,
    ...(market.yes_sub_title ? { outcomeLabel: market.yes_sub_title } : {}),
    description,
    category: refinedCategories.has(titleCategory)
      ? titleCategory
      : providerCategory === "other"
        ? titleCategory
        : providerCategory,
    status: market.status,
    ...(market.open_time ? { startDateIso: market.open_time } : {}),
    ...(market.close_time ? { endDateIso: market.close_time } : {}),
    minimumOrderSizeShares: 1,
    ...(positivePrice(market.yes_ask_dollars) !== undefined
      ? { catalogYesAskDollars: market.yes_ask_dollars }
      : {}),
    ...(positivePrice(market.no_ask_dollars) !== undefined
      ? { catalogNoAskDollars: market.no_ask_dollars }
      : {}),
    volume: market.volume_fp,
    liquidity: market.liquidity_dollars,
    ...(market.updated_time ? { sourceUpdatedAtIso: market.updated_time } : {}),
    ...(event?.mutually_exclusive ? { eventMutuallyExclusive: true } : {}),
    ...(event?.collateral_return_type
      ? { collateralReturnType: event.collateral_return_type }
      : {}),
  };
}

/**
 * Normalizes one Gamma row when it is an executable YES/NO market.
 *
 * @param market - Venue market row.
 * @returns Shared representation, or undefined for non-binary/untradeable rows.
 */
export function normalizePolymarketMarket(
  market: z.infer<typeof polymarketMarketSchema>,
): NativeBinaryMarket | undefined {
  const outcomes = parseStringArray(market.outcomes);
  const tokenIds = parseStringArray(market.clobTokenIds);
  if (
    !market.active ||
    market.closed ||
    !market.acceptingOrders ||
    !market.enableOrderBook ||
    outcomes.length !== 2 ||
    outcomes[0]?.toLocaleLowerCase("en-US") !== "yes" ||
    outcomes[1]?.toLocaleLowerCase("en-US") !== "no" ||
    tokenIds.length !== 2
  ) {
    return undefined;
  }
  const event = market.events[0];
  const yesTokenId = tokenIds[0];
  const noTokenId = tokenIds[1];
  if (!yesTokenId || !noTokenId) {
    return undefined;
  }
  const feeRate = market.feesEnabled ? market.feeSchedule?.rate : 0;
  const feeExponent = market.feesEnabled ? market.feeSchedule?.exponent : 1;
  if (feeRate === undefined || feeExponent === undefined) {
    return undefined;
  }
  const catalogYesAskDollars = positivePrice(market.bestAsk);
  const catalogNoAskDollars =
    positivePrice(market.bestBid) === undefined
      ? undefined
      : 1 - (market.bestBid ?? 0);
  return {
    venue: "polymarket",
    marketId: market.conditionId,
    eventId: event?.slug ?? market.slug,
    ...(event?.title ? { eventTitle: event.title } : {}),
    question: market.question,
    ...(market.groupItemTitle
      ? { outcomeLabel: market.groupItemTitle.trim() }
      : {}),
    description: market.description,
    category: normalizeCategory(
      classifyCategory(`${market.question} ${event?.title ?? ""}`),
    ),
    status: "active",
    ...(market.startDate ? { startDateIso: market.startDate } : {}),
    ...(market.endDate ? { endDateIso: market.endDate } : {}),
    yesTokenId,
    noTokenId,
    marketSlug: market.slug,
    minimumOrderSizeShares: market.orderMinSize,
    polymarketFeeRate: feeRate,
    polymarketFeeExponent: feeExponent,
    ...(catalogYesAskDollars !== undefined ? { catalogYesAskDollars } : {}),
    ...(catalogNoAskDollars !== undefined ? { catalogNoAskDollars } : {}),
    volume: market.volumeNum,
    liquidity: market.liquidityNum,
    ...(market.updatedAt ? { sourceUpdatedAtIso: market.updatedAt } : {}),
    ...(market.negRisk ? { negativeRisk: true } : {}),
    ...(market.negRiskOther ? { negativeRiskOther: true } : {}),
  };
}

/**
 * Parses provider fields that encode string arrays as JSON text.
 *
 * @param value - JSON-encoded string array.
 * @returns Parsed strings, or an empty array for malformed input.
 */
function parseStringArray(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

/**
 * Retains only executable prices strictly inside the binary range.
 *
 * @param value - Optional provider price.
 * @returns The input price when executable.
 */
function positivePrice(value: number | undefined): number | undefined {
  return value !== undefined && value > 0 && value < 1 ? value : undefined;
}

/**
 * Maps venue-specific category text to stable lowercase API keys.
 *
 * @param value - Provider or deterministic category.
 * @returns Lowercase underscore-separated key.
 */
function normalizeCategory(value: string): string {
  const normalized =
    value
      .toLocaleLowerCase("en-US")
      .replace(/[^a-z0-9]+/gu, "_")
      .replace(/^_+|_+$/gu, "") || "other";
  const aliases = new Map<string, string>([
    ["climate_and_weather", "weather_climate"],
    ["financials", "finance"],
    ["science_and_technology", "technology_science"],
  ]);
  return aliases.get(normalized) ?? normalized;
}

/**
 * Assigns a broad category without AI when a venue omits one.
 *
 * @param text - Market and event title text.
 * @returns Stable human-readable category.
 */
function classifyCategory(text: string): string {
  const normalized = text.toLocaleLowerCase("en-US");
  const rules: readonly [string, RegExp][] = [
    [
      "sports",
      /\b(?:nba|nfl|nhl|mlb|soccer|football|tennis|golf|champion|league|cup)\b/u,
    ],
    [
      "politics",
      /\b(?:election|president|prime minister|governor|senate|congress|vote|nominee)\b/u,
    ],
    [
      "economics",
      /\b(?:fed|inflation|cpi|gdp|economy|unemployment|interest rate)\b/u,
    ],
    [
      "finance",
      /\b(?:bitcoin|ethereum|crypto|stock|s&p|nasdaq|gold|oil|price)\b/u,
    ],
    [
      "weather_climate",
      /\b(?:weather|temperature|hottest|rain|snow|hurricane|climate)\b/u,
    ],
    [
      "health",
      /\b(?:disease|case|infection|virus|vaccine|fda|health|ebola|covid|flu)\b/u,
    ],
    [
      "transportation",
      /\b(?:airline|airport|flight|vehicle|car|rail|train|shipping)\b/u,
    ],
    [
      "energy",
      /\b(?:electricity|natural gas|nuclear|solar|wind power|energy)\b/u,
    ],
    [
      "business",
      /\b(?:company|ipo|merger|acquisition|bankruptcy|ceo|revenue|earnings)\b/u,
    ],
    [
      "technology_science",
      /\b(?:ai|spacex|rocket|launch|openai|apple|google|microsoft|model|science)\b/u,
    ],
    [
      "entertainment",
      /\b(?:oscar|academy award|album|movie|film|actor|grammy|television)\b/u,
    ],
    [
      "world",
      /\b(?:war|ceasefire|israel|iran|ukraine|russia|china|nato|united nations)\b/u,
    ],
    [
      "legal",
      /\b(?:court|supreme court|lawsuit|indict|convict|pardon|legal)\b/u,
    ],
    [
      "social_culture",
      /\b(?:pope|religion|social media|population|marriage|birth)\b/u,
    ],
  ];
  return rules.find(([, pattern]) => pattern.test(normalized))?.[0] ?? "other";
}

/**
 * Waits for a bounded retry or request-spacing delay.
 *
 * @param delayMs - Delay in milliseconds.
 * @returns Promise resolved after the delay.
 */
function wait(delayMs: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
}
