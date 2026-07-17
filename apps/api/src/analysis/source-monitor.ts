/** Current reachability state of a named resolution source. */
export type SourceAvailability = "available" | "unavailable" | "not_checked";

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
    return response.ok ? "available" : "unavailable";
  } catch {
    return "unavailable";
  }
}
