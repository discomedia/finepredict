import {
  AccountUserSchema,
  AlertEventSchema,
  ApiKeyScopeSchema,
  ApiKeySummarySchema,
  DisputeCaseSchema,
  FinePredictReportSchema,
  MarketObservationSchema,
  MarketPairSearchResponseSchema,
  MarketSearchResponseSchema,
  PublicSettingsSchema,
  SubscriptionSummarySchema,
  UsageSummarySchema,
  WatchlistSchema,
  type AccountUser,
  type AlertEvent,
  type ApiKeyScope,
  type ApiKeySummary,
  type CreateReportRequest,
  type DisputeCase,
  type FinePredictModel,
  type FinePredictReport,
  type MarketObservation,
  type MarketPlatform,
  type MarketSearchPair,
  type MarketSearchResult,
  type PublicSettings,
  type SubscriptionSummary,
  type UsageSummary,
  type Watchlist,
} from "@finepredict/shared";
import { z } from "zod";

import {
  getNeonAuthToken,
  requestNeonMagicLink,
  signOutNeonAccount,
} from "./auth.js";

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001"
).replace(/\/$/, "");

/** API request failure with its HTTP status retained for page routing. */
export class ApiRequestError extends Error {
  /**
   * Creates a typed API failure.
   *
   * @param message - Safe server or fallback error message.
   * @param status - HTTP response status.
   */
  public constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/**
 * Tests whether an API failure requires a new account session.
 *
 * @param error - Unknown caught value.
 * @returns True for an authenticated endpoint's 401 response.
 */
export function isAuthenticationError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 401;
}

/** Recent report card returned by the public listing endpoint. */
export interface RecentReport {
  createdAt: string;
  marketCount: number;
  slug: string;
  titles: string[];
}

/** Recent-report API response schema. */
const RecentReportsResponseSchema = z.object({
  reports: z.array(
    z.object({
      createdAt: z.string().datetime(),
      marketCount: z.number().int().positive(),
      slug: z.string(),
      titles: z.array(z.string()),
    }),
  ),
});

/** Authenticated account response schema. */
const AccountResponseSchema = z.object({ user: AccountUserSchema });

/** Authenticated watchlist response schema. */
const WatchlistsResponseSchema = z.object({
  watchlists: z.array(WatchlistSchema),
});

/** Authenticated notification response schema. */
const NotificationsResponseSchema = z.object({
  notifications: z.array(AlertEventSchema),
});

/** Public dispute-list response schema. */
const DisputesResponseSchema = z.object({
  disputes: z.array(DisputeCaseSchema),
});

/** Authenticated API-key response schema. */
const ApiKeysResponseSchema = z.object({
  apiKeys: z.array(ApiKeySummarySchema),
});

/** One-time API-key creation response schema. */
const CreatedApiKeyResponseSchema = z.object({
  apiKey: ApiKeySummarySchema,
  secret: z.string().min(1),
});

/** Authenticated API usage response schema. */
const ApiUsageResponseSchema = z.object({
  usage: z.array(UsageSummarySchema),
});

/** Redirect URL response returned by Stripe session endpoints. */
const RedirectResponseSchema = z.object({ url: z.url() });

/** Latest normalized market-monitoring response schema. */
const MarketStatusResponseSchema = z.object({
  observation: MarketObservationSchema.nullable(),
});

/**
 * Creates a new FinePredict report.
 *
 * @param input - One or two supported market URLs.
 * @returns Created shareable report.
 */
export async function createReport(
  input: CreateReportRequest,
): Promise<FinePredictReport> {
  return FinePredictReportSchema.parse(
    await requestJson("/api/reports", {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

/**
 * Loads an existing report by public slug.
 *
 * @param slug - Public report slug.
 * @returns Shareable report.
 */
export async function getReport(slug: string): Promise<FinePredictReport> {
  return FinePredictReportSchema.parse(
    await requestJson(`/api/reports/${encodeURIComponent(slug)}`),
  );
}

/**
 * Lists recent reports for discovery on the home page.
 *
 * @returns Recent public report cards.
 */
export async function listRecentReports(): Promise<RecentReport[]> {
  return RecentReportsResponseSchema.parse(await requestJson("/api/reports"))
    .reports;
}

/**
 * Searches active markets on one public venue.
 *
 * @param platform - Polymarket or Kalshi.
 * @param query - User-entered term containing at least three characters.
 * @param signal - Optional cancellation signal for superseded searches.
 * @returns Ranked selectable market matches.
 */
export async function searchMarkets(
  platform: MarketPlatform,
  query: string,
  signal?: AbortSignal,
): Promise<MarketSearchResult[]> {
  const searchParameters = new URLSearchParams({ platform, query });
  return MarketSearchResponseSchema.parse(
    await requestJson(`/api/markets/search?${searchParameters.toString()}`, {
      ...(signal ? { signal } : {}),
    }),
  ).results;
}

/**
 * Searches for semantically aligned Polymarket and Kalshi market pairs.
 *
 * @param query - User-entered term containing at least three characters.
 * @param signal - Optional cancellation signal for superseded searches.
 * @returns Ranked selectable cross-venue pairs.
 */
export async function searchMarketPairs(
  query: string,
  signal?: AbortSignal,
): Promise<MarketSearchPair[]> {
  const searchParameters = new URLSearchParams({ query });
  return MarketPairSearchResponseSchema.parse(
    await requestJson(
      `/api/markets/search-pairs?${searchParameters.toString()}`,
      {
        ...(signal ? { signal } : {}),
      },
    ),
  ).pairs;
}

/**
 * Loads the administrator-selectable model setting.
 *
 * @returns Public settings and valid choices.
 */
export async function getSettings(): Promise<PublicSettings> {
  return PublicSettingsSchema.parse(await requestJson("/api/settings"));
}

/**
 * Updates the model setting using the authenticated administrator session.
 *
 * @param model - New model choice.
 * @returns Updated public settings.
 */
export async function updateSettings(
  model: FinePredictModel,
): Promise<PublicSettings> {
  return PublicSettingsSchema.parse(
    await requestJson("/api/settings", {
      body: JSON.stringify({ model }),
      headers: { "Content-Type": "application/json" },
      method: "PUT",
    }),
  );
}

/**
 * Lists all dispute cases for administrator review.
 *
 * @returns Published, pending, and rejected dispute cases.
 */
export async function listAdminDisputes(): Promise<DisputeCase[]> {
  return DisputesResponseSchema.parse(await requestJson("/api/admin/disputes"))
    .disputes;
}

/**
 * Saves an administrator review decision using preserved case evidence.
 *
 * @param dispute - Existing dispute case returned by the administrator queue.
 * @param reviewStatus - Publish or reject decision.
 * @returns Updated dispute case.
 */
export async function reviewAdminDispute(
  dispute: DisputeCase,
  reviewStatus: "published" | "rejected",
): Promise<DisputeCase> {
  const source = dispute.sources[0];
  if (!source) {
    throw new Error(
      `This dispute has no preserved source and cannot be reviewed safely.`,
    );
  }
  return DisputeCaseSchema.parse(
    await requestJson("/api/admin/disputes", {
      body: JSON.stringify({
        archivedRules: dispute.archivedRules,
        checkIds: dispute.checkIds,
        disputedWording: dispute.disputedWording,
        externalId: dispute.externalId,
        marketUrl: dispute.marketUrl,
        outcome: dispute.outcome,
        platform: dispute.platform,
        reviewStatus,
        slug: dispute.slug,
        sourceLabel: source.label,
        sourceQuote: source.quotedText,
        sourceUrl: source.url,
        title: dispute.title,
        transactionHash: source.transactionHash,
        wordingTags: dispute.wordingTags,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

/**
 * Requests a one-time managed Neon Auth sign-in link.
 *
 * @param email - Account email address.
 * @param callbackUrl - FinePredict URL opened after authentication.
 * @returns Promise resolved after the email request is accepted.
 */
export async function requestMagicLink(
  email: string,
  callbackUrl: string,
): Promise<void> {
  await requestNeonMagicLink(email, callbackUrl);
}

/**
 * Ends the current managed Neon Auth session.
 *
 * @returns Promise resolved after the managed browser session ends.
 */
export async function signOutAccount(): Promise<void> {
  await signOutNeonAccount();
}

/**
 * Loads the current Neon Auth account.
 *
 * @returns Authenticated account details.
 */
export async function getCurrentAccount(): Promise<AccountUser> {
  return AccountResponseSchema.parse(await requestJson("/api/me")).user;
}

/**
 * Loads subscription and watchlist entitlements for the current account.
 *
 * @returns Current subscription summary.
 */
export async function getSubscription(): Promise<SubscriptionSummary> {
  return SubscriptionSummarySchema.parse(
    await requestJson("/api/me/subscription"),
  );
}

/**
 * Starts Stripe Checkout for the watchlist subscription.
 *
 * @returns Stripe-hosted Checkout URL.
 */
export async function createBillingCheckout(): Promise<string> {
  return RedirectResponseSchema.parse(
    await requestJson("/api/billing/checkout", { method: "POST" }),
  ).url;
}

/**
 * Starts a Stripe customer-portal session.
 *
 * @returns Stripe-hosted customer portal URL.
 */
export async function createBillingPortal(): Promise<string> {
  return RedirectResponseSchema.parse(
    await requestJson("/api/billing/portal", { method: "POST" }),
  ).url;
}

/**
 * Starts Stripe Checkout for metered developer API access.
 *
 * @returns Stripe-hosted developer API Checkout URL.
 */
export async function createDeveloperApiCheckout(): Promise<string> {
  return RedirectResponseSchema.parse(
    await requestJson("/api/billing/api-checkout", { method: "POST" }),
  ).url;
}

/**
 * Lists watchlists owned by the current account.
 *
 * @returns Watchlists with monitored markets.
 */
export async function listWatchlists(): Promise<Watchlist[]> {
  return WatchlistsResponseSchema.parse(await requestJson("/api/me/watchlists"))
    .watchlists;
}

/**
 * Creates a named watchlist.
 *
 * @param name - User-visible watchlist name.
 * @returns Created empty watchlist.
 */
export async function createWatchlist(name: string): Promise<Watchlist> {
  return WatchlistSchema.parse(
    await requestJson("/api/me/watchlists", {
      body: JSON.stringify({ name }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

/**
 * Adds one supported market URL to a watchlist.
 *
 * @param watchlistId - Target watchlist ID.
 * @param url - Polymarket or Kalshi market URL.
 * @returns Created watchlist-market ID.
 */
export async function addWatchlistMarket(
  watchlistId: string,
  url: string,
): Promise<string> {
  const response = z.object({ id: z.string().uuid() }).parse(
    await requestJson(
      `/api/me/watchlists/${encodeURIComponent(watchlistId)}/markets`,
      {
        body: JSON.stringify({ url }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    ),
  );
  return response.id;
}

/**
 * Stops monitoring one watchlist market.
 *
 * @param marketId - Watchlist-market ID.
 * @returns Promise resolved after removal.
 */
export async function removeWatchlistMarket(marketId: string): Promise<void> {
  await requestJson(
    `/api/me/watchlist-markets/${encodeURIComponent(marketId)}`,
    { method: "DELETE" },
  );
}

/**
 * Lists monitoring notifications for the current account.
 *
 * @returns Notifications ordered by the backend.
 */
export async function listNotifications(): Promise<AlertEvent[]> {
  return NotificationsResponseSchema.parse(
    await requestJson("/api/me/notifications"),
  ).notifications;
}

/**
 * Marks one monitoring notification as read.
 *
 * @param notificationId - Notification ID.
 * @returns Promise resolved after the update.
 */
export async function markNotificationRead(
  notificationId: string,
): Promise<void> {
  await requestJson(
    `/api/me/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: "POST" },
  );
}

/**
 * Lists published historical dispute cases.
 *
 * @returns Published disputes with source evidence.
 */
export async function listDisputes(): Promise<DisputeCase[]> {
  return DisputesResponseSchema.parse(await requestJson("/api/disputes"))
    .disputes;
}

/**
 * Loads one published dispute case.
 *
 * @param slug - Public dispute slug.
 * @returns Published dispute case.
 */
export async function getDispute(slug: string): Promise<DisputeCase> {
  return DisputeCaseSchema.parse(
    await requestJson(`/api/disputes/${encodeURIComponent(slug)}`),
  );
}

/**
 * Loads the latest monitoring observation for a market.
 *
 * @param platform - Supported prediction-market venue.
 * @param externalId - Venue-specific market identifier.
 * @returns Latest observation or null before the first monitoring pass.
 */
export async function getMarketStatus(
  platform: MarketPlatform,
  externalId: string,
): Promise<MarketObservation | null> {
  return MarketStatusResponseSchema.parse(
    await requestJson(
      `/api/markets/${encodeURIComponent(platform)}/${encodeURIComponent(externalId)}/status`,
    ),
  ).observation;
}

/**
 * Lists deterministic historical dispute matches for a report.
 *
 * @param slug - Public report slug.
 * @returns Published disputes with exact match reasons.
 */
export async function getRelatedDisputes(slug: string): Promise<DisputeCase[]> {
  return DisputesResponseSchema.parse(
    await requestJson(
      `/api/reports/${encodeURIComponent(slug)}/related-disputes`,
    ),
  ).disputes;
}

/**
 * Lists API-key metadata for the current account.
 *
 * @returns Safe API-key summaries without secrets.
 */
export async function listApiKeys(): Promise<ApiKeySummary[]> {
  return ApiKeysResponseSchema.parse(await requestJson("/api/me/api-keys"))
    .apiKeys;
}

/** Newly created API key and its one-time secret. */
export interface CreatedApiKey {
  apiKey: ApiKeySummary;
  secret: string;
}

/**
 * Creates one developer API key.
 *
 * @param name - User-visible key name.
 * @param scopes - Explicit permissions attached to the key.
 * @returns Key metadata and one-time secret.
 */
export async function createApiKey(
  name: string,
  scopes: ApiKeyScope[],
): Promise<CreatedApiKey> {
  return CreatedApiKeyResponseSchema.parse(
    await requestJson("/api/me/api-keys", {
      body: JSON.stringify({
        name,
        scopes: ApiKeyScopeSchema.array().parse(scopes),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

/**
 * Revokes one developer API key.
 *
 * @param apiKeyId - API-key ID.
 * @returns Promise resolved after revocation.
 */
export async function revokeApiKey(apiKeyId: string): Promise<void> {
  await requestJson(`/api/me/api-keys/${encodeURIComponent(apiKeyId)}`, {
    method: "DELETE",
  });
}

/**
 * Lists daily metered developer API usage.
 *
 * @returns Daily usage aggregates.
 */
export async function listApiUsage(): Promise<UsageSummary[]> {
  return ApiUsageResponseSchema.parse(await requestJson("/api/me/api-usage"))
    .usage;
}

/**
 * Returns the absolute URL for a public API endpoint.
 *
 * @param path - API path beginning with a slash.
 * @returns Absolute configured API URL.
 */
export function getPublicApiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

/**
 * Performs an API request and extracts a safe human-readable error.
 *
 * @param path - API path relative to the configured backend.
 * @param init - Standard fetch options.
 * @returns Parsed JSON response.
 */
async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const headers = new Headers(init?.headers);
  if (requiresAccountToken(path, init?.method)) {
    const token = await getNeonAuthToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `Request failed with status ${response.status}.`;
    throw new ApiRequestError(message, response.status);
  }
  return payload;
}

/**
 * Identifies API routes that require a managed Neon Auth JWT.
 *
 * @param path - API path relative to the backend.
 * @param method - Optional request method.
 * @returns True when the request should carry an account token.
 */
function requiresAccountToken(
  path: string,
  method: string | undefined,
): boolean {
  return (
    path.startsWith("/api/me") ||
    path.startsWith("/api/billing") ||
    path.startsWith("/api/admin") ||
    (path === "/api/settings" && (method ?? "GET") !== "GET")
  );
}
