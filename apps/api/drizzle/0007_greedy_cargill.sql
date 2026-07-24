CREATE TABLE "arbitrage_kalshi_fee_schedules" (
	"series_ticker" text PRIMARY KEY NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "arbitrage_kalshi_fee_schedules_expiry_idx" ON "arbitrage_kalshi_fee_schedules" USING btree ("expires_at");