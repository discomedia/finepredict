import { z } from "zod";

import { log } from "./log.js";

/** Maximum time allowed for each external API request. */
const API_REQUEST_TIMEOUT_MILLISECONDS = 15_000;

/** Maximum upstream response text included in a failed probe log. */
const MAXIMUM_RESPONSE_PREVIEW_LENGTH = 240;

/** One public market API probe definition. */
interface MarketApiProbeDefinition<MarketList> {
  detailResponseSchema: z.ZodType;
  getDetailUrl: (marketList: MarketList) => string;
  listResponseSchema: z.ZodType<MarketList>;
  listUrl: string;
  serviceName: string;
}

/** Result of one public market API list-and-detail probe. */
interface MarketApiProbeResult {
  detailUrl: string | null;
  durationMilliseconds: number;
  error: string | null;
  listUrl: string;
  ok: boolean;
  serviceName: string;
  status: number | null;
}

/** Kalshi list payload needed to select one active market. */
const KalshiMarketListSchema = z.object({
  markets: z
    .array(
      z.object({
        ticker: z.string().min(1),
      }),
    )
    .min(1),
});

/** Kalshi detail payload needed to prove the market route is functional. */
const KalshiMarketDetailSchema = z.object({
  market: z.object({
    ticker: z.string().min(1),
  }),
});

/** Polymarket list payload needed to select one active market. */
const PolymarketMarketListSchema = z
  .array(
    z.object({
      slug: z.string().min(1),
    }),
  )
  .min(1);

/** Polymarket detail payload needed to prove the market route is functional. */
const PolymarketMarketDetailSchema = z.object({
  slug: z.string().min(1),
});

/** Credential-free public market API checks run by the CLI. */
const MARKET_API_PROBES = [
  {
    detailResponseSchema: KalshiMarketDetailSchema,
    getDetailUrl: (marketList: z.infer<typeof KalshiMarketListSchema>) =>
      `https://external-api.kalshi.com/trade-api/v2/markets/${encodeURIComponent(marketList.markets[0]?.ticker ?? "")}`,
    listResponseSchema: KalshiMarketListSchema,
    listUrl:
      "https://external-api.kalshi.com/trade-api/v2/markets?limit=1&status=open",
    serviceName: "Kalshi",
  },
  {
    detailResponseSchema: PolymarketMarketDetailSchema,
    getDetailUrl: (marketList: z.infer<typeof PolymarketMarketListSchema>) =>
      `https://gamma-api.polymarket.com/markets/slug/${encodeURIComponent(marketList[0]?.slug ?? "")}`,
    listResponseSchema: PolymarketMarketListSchema,
    listUrl:
      "https://gamma-api.polymarket.com/markets?limit=1&active=true&closed=false",
    serviceName: "Polymarket",
  },
] as const;

/**
 * Fetches and validates both the list and detail route for one market API.
 *
 * @param probe - Typed public API definition.
 * @param fetchImplementation - HTTP implementation, injectable for tests.
 * @returns Availability result with timing and failure context.
 */
async function checkMarketApi<MarketList>(
  probe: MarketApiProbeDefinition<MarketList>,
  fetchImplementation: typeof fetch = fetch,
): Promise<MarketApiProbeResult> {
  const startedAtMilliseconds = Date.now();
  let detailUrl: string | null = null;
  try {
    const listResponse = await fetchImplementation(probe.listUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MILLISECONDS),
    });
    if (!listResponse.ok) {
      return createFailedProbeResult(
        probe,
        listResponse.status,
        await readResponsePreview(listResponse),
        startedAtMilliseconds,
        detailUrl,
      );
    }
    const marketList = probe.listResponseSchema.parse(
      await listResponse.json(),
    );
    detailUrl = probe.getDetailUrl(marketList);
    const detailResponse = await fetchImplementation(detailUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(API_REQUEST_TIMEOUT_MILLISECONDS),
    });
    if (!detailResponse.ok) {
      return createFailedProbeResult(
        probe,
        detailResponse.status,
        await readResponsePreview(detailResponse),
        startedAtMilliseconds,
        detailUrl,
      );
    }
    probe.detailResponseSchema.parse(await detailResponse.json());
    return {
      detailUrl,
      durationMilliseconds: Date.now() - startedAtMilliseconds,
      error: null,
      listUrl: probe.listUrl,
      ok: true,
      serviceName: probe.serviceName,
      status: detailResponse.status,
    };
  } catch (error) {
    return createFailedProbeResult(
      probe,
      null,
      error instanceof Error ? error.message : String(error),
      startedAtMilliseconds,
      detailUrl,
    );
  }
}

/**
 * Creates a consistently shaped failed API probe.
 *
 * @param probe - Public API definition being checked.
 * @param status - HTTP status when the service returned a response.
 * @param error - Safe response preview or caught error message.
 * @param startedAtMilliseconds - Probe start time used to calculate duration.
 * @param detailUrl - Detail route if the list request succeeded.
 * @returns Failed probe result.
 */
function createFailedProbeResult<MarketList>(
  probe: MarketApiProbeDefinition<MarketList>,
  status: number | null,
  error: string,
  startedAtMilliseconds: number,
  detailUrl: string | null,
): MarketApiProbeResult {
  return {
    detailUrl,
    durationMilliseconds: Date.now() - startedAtMilliseconds,
    error,
    listUrl: probe.listUrl,
    ok: false,
    serviceName: probe.serviceName,
    status,
  };
}

/**
 * Reads a bounded upstream error response for diagnostics.
 *
 * @param response - Failed external API response.
 * @returns Trimmed response text that is safe for one structured log entry.
 */
async function readResponsePreview(response: Response): Promise<string> {
  const responseText = await response.text();
  return (
    responseText.trim().slice(0, MAXIMUM_RESPONSE_PREVIEW_LENGTH) ||
    response.statusText ||
    `HTTP ${response.status}`
  );
}

/**
 * Runs both public API checks and sets a failing process exit code when needed.
 *
 * @returns Promise resolved after all results are logged.
 */
async function main(): Promise<void> {
  const results = await Promise.all([
    checkMarketApi(MARKET_API_PROBES[0]),
    checkMarketApi(MARKET_API_PROBES[1]),
  ]);
  for (const result of results) {
    log(
      "marketApiCheck",
      result.ok
        ? `${result.serviceName} public API is working.`
        : `${result.serviceName} public API is unavailable.`,
      {
        detailUrl: result.detailUrl,
        durationMilliseconds: result.durationMilliseconds,
        error: result.error,
        listUrl: result.listUrl,
        status: result.status,
      },
    );
  }
  const successfulProbeCount = results.filter((result) => result.ok).length;
  log("marketApiCheck", "Public market API check completed.", {
    available: successfulProbeCount,
    total: results.length,
  });
  if (successfulProbeCount !== results.length) {
    process.exitCode = 1;
  }
}

await main();
