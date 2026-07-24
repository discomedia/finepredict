/** Error thrown when an HTTP service returns a non-success response. */
export class HttpServiceError extends Error {
  /** HTTP response status. */
  public readonly status: number;

  /**
   * Creates an HTTP service error.
   *
   * @param service - External service name.
   * @param status - HTTP response status.
   * @param body - Truncated response body.
   */
  public constructor(service: string, status: number, body: string) {
    super(`${service} returned HTTP ${status}: ${body.slice(0, 500)}`);
    this.name = "HttpServiceError";
    this.status = status;
  }
}

/**
 * Fetches JSON and raises a typed error for non-success responses.
 *
 * @param url - Fully qualified request URL.
 * @param init - Optional fetch request configuration.
 * @param service - Service name used in errors.
 * @returns Parsed JSON with an unknown type for caller-side validation.
 */
export async function fetchJson(
  url: URL | string,
  init: RequestInit | undefined,
  service: string,
): Promise<unknown> {
  const response = await fetch(url, init);
  const body = await response.text();
  if (!response.ok) {
    throw new HttpServiceError(service, response.status, body);
  }
  try {
    return JSON.parse(body) as unknown;
  } catch (error: unknown) {
    const reason =
      error instanceof Error ? error.message : "unknown JSON error";
    throw new Error(`${service} returned invalid JSON: ${reason}`);
  }
}
