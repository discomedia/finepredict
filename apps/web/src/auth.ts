import { z } from "zod";

/** Managed Neon Auth URL injected into the Vite client build. */
const NEON_AUTH_BASE_URL =
  import.meta.env.VITE_NEON_AUTH_URL?.trim().replace(/\/$/, "") ?? "";

/** JWT response returned by the managed token endpoint. */
const NeonAuthTokenResponseSchema = z.object({ token: z.string().min(1) });

/**
 * Requests a managed Neon Auth magic link.
 *
 * @param email - Account email address.
 * @param callbackUrl - FinePredict URL opened after authentication.
 * @returns Nothing after Neon Auth accepts the delivery request.
 */
export async function requestNeonMagicLink(
  email: string,
  callbackUrl: string,
): Promise<void> {
  await requestNeonAuth("/sign-in/magic-link", {
    body: JSON.stringify({ callbackURL: callbackUrl, email }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

/**
 * Retrieves a short-lived Neon Auth JWT for the FinePredict API.
 *
 * @returns JWT string, or null when no managed session exists.
 */
export async function getNeonAuthToken(): Promise<string | null> {
  if (!NEON_AUTH_BASE_URL) {
    return null;
  }
  const response = await fetch(`${NEON_AUTH_BASE_URL}/token`, {
    credentials: "include",
  }).catch(() => null);
  if (!response?.ok) {
    return null;
  }
  const payload = NeonAuthTokenResponseSchema.safeParse(
    await response.json().catch(() => null),
  );
  return payload.success ? payload.data.token : null;
}

/**
 * Ends the managed Neon Auth browser session.
 *
 * @returns Nothing after Neon Auth clears its session.
 */
export async function signOutNeonAccount(): Promise<void> {
  if (!NEON_AUTH_BASE_URL) {
    return;
  }
  await requestNeonAuth("/sign-out", { method: "POST" });
}

/**
 * Performs a credentialed request against the branch-specific Auth service.
 *
 * @param path - Managed Auth path beginning with a slash.
 * @param init - Standard fetch configuration.
 * @returns Accepted HTTP response.
 */
async function requestNeonAuth(
  path: string,
  init: RequestInit,
): Promise<Response> {
  if (!NEON_AUTH_BASE_URL) {
    throw new Error(`FinePredict account access is not configured.`);
  }
  const response = await fetch(`${NEON_AUTH_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new Error(extractNeonAuthError(payload, response.status));
  }
  return response;
}

/**
 * Extracts a safe managed-auth error message without trusting its shape.
 *
 * @param payload - Unknown JSON response body.
 * @param status - HTTP response status used by the fallback.
 * @returns User-safe error message.
 */
function extractNeonAuthError(payload: unknown, status: number): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "message" in payload &&
    typeof payload.message === "string"
  ) {
    return payload.message;
  }
  return `Neon Auth request failed with status ${String(status)}.`;
}
