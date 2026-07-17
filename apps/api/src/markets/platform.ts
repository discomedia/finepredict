import type { MarketContract, MarketPlatform } from "@finepredict/shared";

/** Error thrown when a URL is valid but not a supported market URL. */
export class UnsupportedMarketUrlError extends Error {
  /**
   * Creates an unsupported URL error.
   *
   * @param message - Actionable URL validation message.
   */
  public constructor(message: string) {
    super(message);
    this.name = "UnsupportedMarketUrlError";
  }
}

/**
 * Determines which supported platform owns a market URL.
 *
 * @param marketUrl - User-provided prediction-market URL.
 * @returns Supported market platform.
 */
export function detectPlatform(marketUrl: string): MarketPlatform {
  const url = new URL(marketUrl);
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (hostname === "polymarket.com") {
    return "polymarket";
  }
  if (hostname === "kalshi.com") {
    return "kalshi";
  }
  throw new UnsupportedMarketUrlError(
    `FinePredict currently supports polymarket.com and kalshi.com URLs.`,
  );
}

/**
 * Fetches and normalizes a market contract from its public URL.
 *
 * @param marketUrl - Polymarket or Kalshi market URL.
 * @param fetchImplementation - HTTP implementation, injectable for tests.
 * @returns Normalized contract suitable for deterministic analysis.
 */
export async function fetchMarketContract(
  marketUrl: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<MarketContract> {
  const platform = detectPlatform(marketUrl);
  if (platform === "polymarket") {
    const { fetchPolymarketContract } = await import("./polymarket.js");
    return fetchPolymarketContract(marketUrl, fetchImplementation);
  }
  const { fetchKalshiContract } = await import("./kalshi.js");
  return fetchKalshiContract(marketUrl, fetchImplementation);
}

/**
 * Extracts a non-empty path segment immediately following a named segment.
 *
 * @param url - Parsed URL.
 * @param segmentName - Segment whose successor should be returned.
 * @returns Decoded successor segment.
 */
export function extractPathValue(url: URL, segmentName: string): string {
  const segments = url.pathname.split("/").filter(Boolean);
  const segmentIndex = segments.findIndex(
    (segment) => segment.toLowerCase() === segmentName.toLowerCase(),
  );
  const value = segments[segmentIndex + 1];
  if (!value) {
    throw new UnsupportedMarketUrlError(
      `The URL must include a ${segmentName} identifier.`,
    );
  }
  return decodeURIComponent(value);
}

/**
 * Fetches JSON and converts upstream failures into actionable errors.
 *
 * @param url - Public platform API URL.
 * @param serviceName - Upstream service label for diagnostics.
 * @param fetchImplementation - HTTP implementation.
 * @returns Parsed unknown JSON value.
 */
export async function fetchJson(
  url: string,
  serviceName: string,
  fetchImplementation: typeof fetch,
): Promise<unknown> {
  const response = await fetchImplementation(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(
      `FinePredict ${serviceName}: ${response.status} ${response.statusText} for ${url}.`,
    );
  }
  return response.json();
}

/**
 * Extracts a named resolution source from common settlement-rule constructions.
 *
 * @param rulesText - Full visible market rules.
 * @returns Exact named source phrase or null when no source is identified.
 */
export function extractNamedResolutionSource(rulesText: string): string | null {
  const patterns = [
    /(?:primary\s+)?resolution source(?:\s+for\s+this\s+market)?\s+(?:is|will be|shall be)\s+([^.;\n]{3,200})/i,
    /(?:according to|as reported by|based on|source(?:d)? from)\s+([^.;\n]{3,160})/i,
  ];
  for (const pattern of patterns) {
    const source = rulesText.match(pattern)?.[1]?.trim();
    if (source) {
      return source;
    }
  }
  return null;
}
