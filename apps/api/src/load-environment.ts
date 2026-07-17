import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config as loadDotenv } from "dotenv";

/**
 * Loads the repository's single master .env when it exists in local development.
 * Hosted environments continue to use variables injected by the platform.
 *
 * @returns Nothing.
 */
export function loadMasterEnvironment(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
  ];
  const envPath = candidates.find((candidate) => existsSync(candidate));
  if (envPath) {
    loadDotenv({ path: envPath });
  }
}

loadMasterEnvironment();
