import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Persisted shareable reports and their fully rendered payloads. */
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    payload: jsonb("payload").notNull(),
    modelUsed: text("model_used"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("reports_slug_unique").on(table.slug)],
);

/** Immutable copies of rules observed at a specific point in time. */
export const marketSnapshots = pgTable(
  "market_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id"),
    platform: text("platform").notNull(),
    externalId: text("external_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    title: text("title").notNull(),
    rulesText: text("rules_text").notNull(),
    resolutionSource: text("resolution_source"),
    endDate: timestamp("end_date", { withTimezone: true }),
    contentHash: text("content_hash").notNull(),
    diffLines: jsonb("diff_lines")
      .notNull()
      .default(sql`'[]'::jsonb`),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("market_snapshots_contract_idx").on(
      table.platform,
      table.externalId,
      table.capturedAt,
    ),
  ],
);

/** Administrator-controlled global product settings. */
export const systemSettings = pgTable("system_settings", {
  id: text("id").primaryKey(),
  model: text("model").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Database schema exported for Drizzle client construction. */
export const databaseSchema = {
  marketSnapshots,
  reports,
  systemSettings,
};
