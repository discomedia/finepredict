CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";--> statement-breakpoint
CREATE TABLE "arbitrage_catalog_counts" (
	"venue" text PRIMARY KEY NOT NULL,
	"market_count" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
INSERT INTO "arbitrage_catalog_counts" ("venue", "market_count", "updated_at")
SELECT "venue", count(*)::integer, now()
FROM "arbitrage_markets"
GROUP BY "venue"
ON CONFLICT ("venue") DO UPDATE
SET "market_count" = excluded."market_count",
	"updated_at" = excluded."updated_at";
