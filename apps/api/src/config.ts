import { FinePredictModelSchema } from "@finepredict/shared";
import "./load-environment.js";

/** Runtime configuration loaded from the master environment. */
export interface AppConfig {
  adminApiKey: string;
  databaseUrl: string | null;
  defaultModel: "gpt-5.6-luna" | "gpt-5.6-terra" | "gpt-5.6";
  openAiApiKey: string | null;
  port: number;
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

  return {
    adminApiKey: env.ADMIN_API_KEY?.trim() ?? "",
    databaseUrl: env.DATABASE_URL?.trim() || null,
    defaultModel,
    openAiApiKey: env.OPENAI_API_KEY?.trim() || null,
    port,
    webOrigin: env.WEB_ORIGIN?.trim() || "http://localhost:5173",
  };
}
