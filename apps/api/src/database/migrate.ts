import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

import { normalizeDatabaseUrlSslMode } from "../config.js";
import { log } from "../log.js";
import "../load-environment.js";
import { handleMigrationNotice } from "./postgres-notices.js";

/**
 * Applies checked-in Drizzle migrations to the configured Neon database.
 *
 * @returns Promise that resolves after all migrations have been applied.
 */
async function runMigrations(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(`FinePredict migrations: DATABASE_URL is required.`);
  }

  const sql = postgres(normalizeDatabaseUrlSslMode(databaseUrl), {
    max: 1,
    onnotice: handleMigrationNotice,
  });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
    log("database.runMigrations", "Database migrations completed.");
  } finally {
    await sql.end();
  }
}

await runMigrations();
