/** Production FinePredict analysis entry point. */
export const FINEPREDICT_ANALYZE_URL = "https://finepredict.netlify.app/";

/**
 * Determines whether a URL is a supported market contract page.
 *
 * @param value - Absolute URL to inspect.
 * @returns True for Polymarket event pages and Kalshi market pages.
 */
export function isSupportedMarketUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const isPolymarket =
      (hostname === "polymarket.com" || hostname.endsWith(".polymarket.com")) &&
      url.pathname.startsWith("/event/");
    const isKalshi =
      (hostname === "kalshi.com" || hostname.endsWith(".kalshi.com")) &&
      url.pathname.startsWith("/markets/");
    return url.protocol === "https:" && (isPolymarket || isKalshi);
  } catch {
    return false;
  }
}

/**
 * Builds a FinePredict URL with a market URL prefilled but not submitted.
 *
 * @param marketUrl - Supported prediction-market contract URL.
 * @returns FinePredict analysis-entry URL.
 */
export function buildFinePredictAnalysisUrl(marketUrl: string): string {
  const destination = new URL(FINEPREDICT_ANALYZE_URL);
  destination.searchParams.set("marketUrl", marketUrl);
  return destination.toString();
}
