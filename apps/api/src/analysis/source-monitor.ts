import type { SourceAvailability } from "@finepredict/shared";

/** HTTP statuses which confirm that a source URL no longer exists. */
const CONFIRMED_UNAVAILABLE_STATUSES = new Set([404, 410]);

/** HTTP statuses which show that an automated source check was blocked. */
const ACCESS_LIMITED_STATUSES = new Set([401, 403, 429]);

/**
 * Checks a directly named source URL without attempting to infer unnamed sites.
 *
 * @param resolutionSource - Source metadata extracted from the contract.
 * @param fetchImplementation - HTTP implementation, injectable for tests.
 * @returns Reachability state for directly linked sources.
 */
export async function checkSourceAvailability(
  resolutionSource: string | null,
  fetchImplementation: typeof fetch = fetch,
): Promise<SourceAvailability> {
  if (!resolutionSource) {
    return "not_checked";
  }
  const urlMatch = resolutionSource.match(/https?:\/\/[^\s)\]}]+/i);
  if (!urlMatch?.[0]) {
    return "not_checked";
  }
  try {
    const response = await fetchImplementation(urlMatch[0], {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    if (response.ok) {
      return "available";
    }
    if (ACCESS_LIMITED_STATUSES.has(response.status)) {
      return "access_limited";
    }
    if (CONFIRMED_UNAVAILABLE_STATUSES.has(response.status)) {
      return confirmSourceUnavailable(urlMatch[0], fetchImplementation);
    }
    return "not_checked";
  } catch {
    return "not_checked";
  }
}

/**
 * Confirms a missing HEAD response with a small GET request because some sites
 * do not implement HEAD correctly.
 *
 * @param sourceUrl - Direct resolution-source URL.
 * @param fetchImplementation - HTTP implementation, injectable for tests.
 * @returns Confirmed source reachability state.
 */
async function confirmSourceUnavailable(
  sourceUrl: string,
  fetchImplementation: typeof fetch,
): Promise<SourceAvailability> {
  try {
    const response = await fetchImplementation(sourceUrl, {
      headers: { Range: "bytes=0-0" },
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(8_000),
    });
    if (response.ok) {
      return "available";
    }
    if (ACCESS_LIMITED_STATUSES.has(response.status)) {
      return "access_limited";
    }
    return CONFIRMED_UNAVAILABLE_STATUSES.has(response.status)
      ? "confirmed_unavailable"
      : "not_checked";
  } catch {
    return "not_checked";
  }
}
