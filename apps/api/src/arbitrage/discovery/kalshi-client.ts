import { z } from "zod";

import { fetchJson } from "../common/http.js";
import type { KalshiFeeSchedule } from "../common/types.js";

const seriesResponseSchema = z.object({
  series: z.object({
    ticker: z.string(),
    fee_type: z.enum(["quadratic", "quadratic_with_maker_fees", "flat"]),
    fee_multiplier: z.coerce.number(),
    contract_terms_url: z.string().url().optional(),
  }),
});

const marketResponseSchema = z.object({
  market: z.object({
    ticker: z.string(),
    event_ticker: z.string(),
    title: z.string(),
    status: z.string(),
    volume_fp: z.coerce.number().default(0),
    liquidity_dollars: z.coerce.number().default(0),
  }),
});

const eventResponseSchema = z.object({
  event: z.object({
    event_ticker: z.string(),
    series_ticker: z.string(),
    title: z.string(),
  }),
});

/** Venue-native Kalshi metadata required to execute a discovered pair. */
export interface KalshiMarketExecutionMetadata {
  /** Kalshi binary market ticker used by the direct order-book endpoint. */
  readonly marketTicker: string;
  /** Parent event ticker used by pair-review overrides. */
  readonly eventTicker: string;
  /** Series ticker used to retrieve the current Kalshi fee schedule. */
  readonly seriesTicker: string;
  /** Current venue lifecycle status. */
  readonly status: string;
  /** Venue market title. */
  readonly title: string;
  /** Venue-reported cumulative volume. */
  readonly volume: number;
  /** Venue-reported current liquidity. */
  readonly liquidity: number;
}

/** Read-only client for Kalshi public market metadata. */
export class KalshiClient {
  private readonly baseUrl: string;
  private externalRequestCount = 0;

  /**
   * Creates a Kalshi metadata client.
   *
   * @param baseUrl - Optional production API override used in tests.
   */
  public constructor(baseUrl = "https://external-api.kalshi.com/trade-api/v2") {
    this.baseUrl = `${baseUrl.replace(/\/$/u, "")}/`;
  }

  /**
   * Gets the current fee schedule for a Kalshi market series.
   *
   * @param seriesTicker - Venue-native series ticker.
   * @returns Fee type and multiplier used for conservative taker fees.
   */
  public async getFeeSchedule(
    seriesTicker: string,
  ): Promise<KalshiFeeSchedule> {
    const url = new URL(
      `series/${encodeURIComponent(seriesTicker)}`,
      this.baseUrl,
    );
    this.externalRequestCount += 1;
    const parsed = seriesResponseSchema.parse(
      await fetchJson(url, undefined, "Kalshi API"),
    );
    return {
      feeType: parsed.series.fee_type,
      feeMultiplier: parsed.series.fee_multiplier,
      seriesTicker: parsed.series.ticker,
      ...(parsed.series.contract_terms_url
        ? { contractTermsUrl: parsed.series.contract_terms_url }
        : {}),
    };
  }

  /**
   * Resolves a Kalshi market ticker into the native IDs required for direct execution.
   *
   * @param marketTicker - Kalshi ticker supplied by a candidate source.
   * @returns Native market, event, series, and display metadata.
   */
  public async getMarketExecutionMetadata(
    marketTicker: string,
  ): Promise<KalshiMarketExecutionMetadata> {
    const marketUrl = new URL(
      `markets/${encodeURIComponent(marketTicker)}`,
      this.baseUrl,
    );
    this.externalRequestCount += 1;
    const market = marketResponseSchema.parse(
      await fetchJson(marketUrl, undefined, "Kalshi market API"),
    ).market;
    const eventUrl = new URL(
      `events/${encodeURIComponent(market.event_ticker)}`,
      this.baseUrl,
    );
    this.externalRequestCount += 1;
    const event = eventResponseSchema.parse(
      await fetchJson(eventUrl, undefined, "Kalshi event API"),
    ).event;
    return {
      marketTicker: market.ticker,
      eventTicker: event.event_ticker,
      seriesTicker: event.series_ticker,
      status: market.status,
      title: market.title,
      volume: market.volume_fp,
      liquidity: market.liquidity_dollars,
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
}
