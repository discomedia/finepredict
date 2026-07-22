/** Production FinePredict analysis entry point. */
export const FINEPREDICT_ANALYZE_URL = "https://finepredict.netlify.app/";

/** Query parameter used for the second contract in a comparison. */
export const FINEPREDICT_COMPARISON_URL_PARAMETER = "comparisonMarketUrl";

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
 * @param marketUrl - Primary supported prediction-market contract URL.
 * @param comparisonMarketUrl - Optional second supported contract URL.
 * @returns FinePredict analysis-entry URL.
 */
export function buildFinePredictAnalysisUrl(
  marketUrl: string,
  comparisonMarketUrl?: string,
): string {
  const destination = new URL(FINEPREDICT_ANALYZE_URL);
  destination.searchParams.set("marketUrl", marketUrl);
  if (comparisonMarketUrl) {
    destination.searchParams.set(
      FINEPREDICT_COMPARISON_URL_PARAMETER,
      comparisonMarketUrl,
    );
  }
  return destination.toString();
}

/**
 * Determines whether a URL belongs to a specific supported venue.
 *
 * @param value - Absolute market URL to inspect.
 * @param venue - Supported venue hostname to match.
 * @returns True when the URL is a supported contract on the requested venue.
 */
export function isMarketUrlForVenue(
  value: string,
  venue: "kalshi" | "polymarket",
): boolean {
  if (!isSupportedMarketUrl(value)) {
    return false;
  }
  return new URL(value).hostname.toLowerCase().endsWith(`${venue}.com`);
}
