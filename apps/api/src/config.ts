import { FinePredictModelSchema } from "@finepredict/shared";
import "./load-environment.js";

/** Runtime configuration loaded from the master environment. */
export interface AppConfig {
  adminApiKey: string;
  adminEmails: string[];
  apiKeyHashSecret: string;
  apiUrl: string;
  appUrl: string;
  databaseUrl: string | null;
  defaultModel: "gpt-5.6-luna" | "gpt-5.6-terra" | "gpt-5.6";
  developerApiDailyLimit: number;
  discoMailApiKey: string | null;
  discoMailFromEmail: string;
  monitorDryRun: boolean;
  neonAuthBaseUrl: string | null;
  neonAuthJwksUrl: string | null;
  openAiApiKey: string | null;
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
    databaseUrl: env.DATABASE_URL?.trim() || null,
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
