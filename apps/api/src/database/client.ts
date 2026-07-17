import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { databaseSchema } from "./schema.js";

/** Drizzle database client used by the persistence repository. */
export type FinePredictDatabase = ReturnType<typeof createDrizzleDatabase>;

/** Database and underlying connection resources for short-lived processes. */
export interface DatabaseResources {
  database: FinePredictDatabase;
  close: () => Promise<void>;
}

/**
 * Creates a Neon-compatible Postgres client without eagerly opening a socket.
 *
 * @param databaseUrl - Neon pooled Postgres connection string.
 * @returns Typed Drizzle database client.
 */
export function createDatabase(databaseUrl: string) {
  return createDatabaseResources(databaseUrl).database;
}

/**
 * Creates a database client together with an explicit close operation.
 *
 * @param databaseUrl - Neon pooled Postgres connection string.
 * @returns Drizzle database and close operation for cron jobs.
 */
export function createDatabaseResources(
  databaseUrl: string,
): DatabaseResources {
  const sql = postgres(databaseUrl, {
    max: 3,
    idle_timeout: 10,
    connect_timeout: 10,
  });
  return {
    database: createDrizzleDatabase(sql),
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}

/**
 * Applies the FinePredict schema to a postgres.js client.
 *
 * @param sqlClient - Configured postgres.js client.
 * @returns Typed Drizzle client.
 */
function createDrizzleDatabase(sqlClient: postgres.Sql) {
  return drizzle(sqlClient, { schema: databaseSchema });
}
