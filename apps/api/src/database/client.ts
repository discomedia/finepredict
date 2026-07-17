import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { databaseSchema } from "./schema.js";

/** Drizzle database client used by the persistence repository. */
export type FinePredictDatabase = ReturnType<typeof createDatabase>;

/**
 * Creates a Neon-compatible Postgres client without eagerly opening a socket.
 *
 * @param databaseUrl - Neon pooled Postgres connection string.
 * @returns Typed Drizzle database client.
 */
export function createDatabase(databaseUrl: string) {
  const sql = postgres(databaseUrl, {
    max: 3,
    idle_timeout: 10,
    connect_timeout: 10,
  });
  return drizzle(sql, { schema: databaseSchema });
}
