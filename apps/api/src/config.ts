import { FinePredictModelSchema } from "@finepredict/shared";
import "./load-environment.js";

/** Bounded controls for FinePredict's recurring arbitrage scanner. */
export interface ArbitrageServiceConfig {
  enabled: boolean;
  runDiscoveryOnStart: boolean;
  discoveryIntervalMs: number;
  priceRefreshIntervalMs: number;
  maximumPriceRefreshPairs: number;
  minimumSimilarityPercent100: number;
  minimumPreliminaryEdgeDollarsPerShare: number;
  minimumNetEdgeDollarsPerShare: number;
  maximumFreshBookPairs: number;
  maximumPairsPerEventPair: number;
  evaluationBudgetDollars: number;
  directBookConcurrency: number;
}

/** Runtime configuration loaded from the master environment. */
export interface AppConfig {
  adminApiKey: string;
  adminEmails: string[];
  apiKeyHashSecret: string;
  apiUrl: string;
  appUrl: string;
  arbitrage: ArbitrageServiceConfig;
  databaseUrl: string | null;
  defaultModel: "gpt-5.6-luna" | "gpt-5.6-terra" | "gpt-5.6";
  developerApiDailyLimit: number;
  discoMailApiKey: string | null;
  discoMailFromEmail: string;
  monitorDryRun: boolean;
  neonAuthBaseUrl: string | null;
  neonAuthJwksUrl: string | null;
  openAiApiKey: string | null;
  oddpoolApiKey: string | null;
  polygonRpcUrl: string | null;
  port: number;
  stripeApiMeterEventName: string | null;
  stripeApiKey: string | null;
  stripeApiPriceId: string | null;
  stripeWatchlistPriceId: string | null;
  stripeWebhookSecret: string | null;
  webOrigin: string;
}

/**
 * Loads and validates FinePredict runtime configuration.
 *
 * @param env - Environment key/value source.
 * @returns Validated runtime configuration.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(env.PORT ?? "3001");
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`FinePredict config: PORT must be a positive integer.`);
  }

  const defaultModel = FinePredictModelSchema.parse(
    env.FINEPREDICT_MODEL ?? "gpt-5.6-luna",
  );

  const developerApiDailyLimit = Number(
    env.DEVELOPER_API_DAILY_LIMIT ?? "1000",
  );
  if (!Number.isInteger(developerApiDailyLimit) || developerApiDailyLimit < 1) {
    throw new Error(
      `FinePredict config: DEVELOPER_API_DAILY_LIMIT must be a positive integer.`,
    );
  }

  const neonAuthBaseUrl =
    env.NEON_AUTH_BASE_URL?.trim().replace(/\/$/, "") || null;

  return {
    adminApiKey: env.ADMIN_API_KEY?.trim() ?? "",
    adminEmails: (env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
    apiKeyHashSecret: env.API_KEY_HASH_SECRET?.trim() ?? "",
    apiUrl: env.API_URL?.trim() || `http://localhost:${String(port)}`,
    appUrl: env.APP_URL?.trim() || "http://localhost:5173",
    arbitrage: {
      enabled: parseBooleanEnvironmentValue(
        env.ARBITRAGE_SERVICE_ENABLED,
        true,
      ),
      runDiscoveryOnStart: parseBooleanEnvironmentValue(
        env.ARBITRAGE_RUN_DISCOVERY_ON_START,
        true,
      ),
      discoveryIntervalMs:
        parseNumberInRange(
          env.ARBITRAGE_DISCOVERY_INTERVAL_MINUTES,
          60,
          1,
          1_440,
          "ARBITRAGE_DISCOVERY_INTERVAL_MINUTES",
        ) * 60_000,
      priceRefreshIntervalMs:
        parseNumberInRange(
          env.ARBITRAGE_PRICE_REFRESH_INTERVAL_SECONDS,
          300,
          10,
          86_400,
          "ARBITRAGE_PRICE_REFRESH_INTERVAL_SECONDS",
        ) * 1_000,
      maximumPriceRefreshPairs: parseIntegerInRange(
        env.ARBITRAGE_PRICE_REFRESH_MAX_PAIRS,
        24,
        1,
        100,
        "ARBITRAGE_PRICE_REFRESH_MAX_PAIRS",
      ),
      minimumSimilarityPercent100: parseNumberInRange(
        env.ARBITRAGE_MINIMUM_SIMILARITY_PERCENT100,
        75,
        0,
        100,
        "ARBITRAGE_MINIMUM_SIMILARITY_PERCENT100",
      ),
      minimumPreliminaryEdgeDollarsPerShare: parseNumberInRange(
        env.ARBITRAGE_MINIMUM_PRELIMINARY_EDGE_DOLLARS,
        0.015,
        0,
        1,
        "ARBITRAGE_MINIMUM_PRELIMINARY_EDGE_DOLLARS",
      ),
      minimumNetEdgeDollarsPerShare: parseNumberInRange(
        env.ARBITRAGE_MINIMUM_NET_EDGE_DOLLARS,
        0.03,
        0,
        1,
        "ARBITRAGE_MINIMUM_NET_EDGE_DOLLARS",
      ),
      maximumFreshBookPairs: parseIntegerInRange(
        env.ARBITRAGE_DISCOVERY_MAX_BOOK_PAIRS,
        100,
        1,
        500,
        "ARBITRAGE_DISCOVERY_MAX_BOOK_PAIRS",
      ),
      maximumPairsPerEventPair: parseIntegerInRange(
        env.ARBITRAGE_MAX_PAIRS_PER_EVENT,
        10,
        1,
        100,
        "ARBITRAGE_MAX_PAIRS_PER_EVENT",
      ),
      evaluationBudgetDollars: parseNumberInRange(
        env.ARBITRAGE_EVALUATION_BUDGET_DOLLARS,
        1_000,
        1,
        1_000_000,
        "ARBITRAGE_EVALUATION_BUDGET_DOLLARS",
      ),
      directBookConcurrency: parseIntegerInRange(
        env.ARBITRAGE_DIRECT_BOOK_CONCURRENCY,
        4,
        1,
        20,
        "ARBITRAGE_DIRECT_BOOK_CONCURRENCY",
      ),
    },
    databaseUrl: env.DATABASE_URL?.trim()
      ? normalizeDatabaseUrlSslMode(env.DATABASE_URL)
      : null,
    defaultModel,
    developerApiDailyLimit,
    discoMailApiKey: env.DISCO_MAIL_API_KEY?.trim() || null,
    discoMailFromEmail:
      env.DISCO_MAIL_FROM_EMAIL?.trim() ||
      "FinePredict <hello@fp.discomedia.co>",
    monitorDryRun: parseBooleanEnvironmentValue(env.MONITOR_DRY_RUN, true),
    neonAuthBaseUrl,
    neonAuthJwksUrl: neonAuthBaseUrl
      ? `${neonAuthBaseUrl}/.well-known/jwks.json`
      : null,
    openAiApiKey: env.OPENAI_API_KEY?.trim() || null,
    oddpoolApiKey: env.ODDPOOL_API_KEY?.trim() || null,
    polygonRpcUrl: env.POLYGON_RPC_URL?.trim() || null,
    port,
    stripeApiMeterEventName: env.STRIPE_API_METER_EVENT_NAME?.trim() || null,
    stripeApiKey: env.STRIPE_API_KEY?.trim() || null,
    stripeApiPriceId: env.STRIPE_API_PRICE_ID?.trim() || null,
    stripeWatchlistPriceId: env.STRIPE_WATCHLIST_PRICE_ID?.trim() || null,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || null,
    webOrigin: env.WEB_ORIGIN?.trim() || "http://localhost:5173",
  };
}

/**
 * Makes legacy PostgreSQL SSL modes explicit about the stronger certificate
 * verification behavior currently used by Node clients.
 *
 * @param databaseUrl - PostgreSQL connection string.
 * @returns Connection string using explicit `sslmode=verify-full`.
 */
export function normalizeDatabaseUrlSslMode(databaseUrl: string): string {
  const parsed = new URL(databaseUrl.trim());
  const sslMode = parsed.searchParams.get("sslmode");
  if (
    sslMode === "prefer" ||
    sslMode === "require" ||
    sslMode === "verify-ca"
  ) {
    parsed.searchParams.set("sslmode", "verify-full");
  }
  return parsed.toString();
}

/**
 * Parses an optional boolean environment value.
 *
 * @param value - Raw environment value.
 * @param fallback - Value used when the environment variable is absent.
 * @returns Parsed boolean value.
 */
function parseBooleanEnvironmentValue(
  value: string | undefined,
  fallback: boolean,
): boolean {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(
    `FinePredict config: boolean environment values must be true or false.`,
  );
}

/**
 * Parses a finite number inside inclusive bounds.
 *
 * @param value - Optional environment value.
 * @param fallback - Default when absent.
 * @param minimum - Inclusive minimum.
 * @param maximum - Inclusive maximum.
 * @param name - Environment name used in errors.
 * @returns Validated number.
 */
function parseNumberInRange(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const parsed = Number(value ?? String(fallback));
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `FinePredict config: ${name} must be from ${String(minimum)} to ${String(maximum)}.`,
    );
  }
  return parsed;
}

/**
 * Parses an integer inside inclusive bounds.
 *
 * @param value - Optional environment value.
 * @param fallback - Default when absent.
 * @param minimum - Inclusive minimum.
 * @param maximum - Inclusive maximum.
 * @param name - Environment name used in errors.
 * @returns Validated integer.
 */
function parseIntegerInRange(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  const parsed = parseNumberInRange(value, fallback, minimum, maximum, name);
  if (!Number.isInteger(parsed)) {
    throw new Error(`FinePredict config: ${name} must be an integer.`);
  }
  return parsed;
}
