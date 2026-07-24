import { log } from "../log.js";
import type postgres from "postgres";

const expectedIdempotentMigrationNoticeCodes = new Set(["42P06", "42P07"]);

/**
 * Identifies expected notices emitted by Drizzle's idempotent bookkeeping DDL.
 *
 * @param code - Optional Postgres SQLSTATE code.
 * @returns Whether the notice should be suppressed.
 */
export function shouldSuppressMigrationNotice(
  code: string | undefined,
): boolean {
  return code !== undefined && expectedIdempotentMigrationNoticeCodes.has(code);
}

/**
 * Suppresses expected duplicate-object migration notices and logs all others.
 *
 * @param notice - Notice emitted by the postgres.js client.
 * @returns Nothing.
 */
export function handleMigrationNotice(notice: postgres.Notice): void {
  if (shouldSuppressMigrationNotice(notice.code)) {
    return;
  }
  log("database.runMigrations", "Postgres migration notice.", {
    code: notice.code,
    severity: notice.severity,
    noticeMessage:
      notice.message ?? notice.message_primary ?? "Unspecified Postgres notice",
  });
}
