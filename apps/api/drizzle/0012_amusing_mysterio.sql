DROP INDEX "arbitrage_markets_category_idx";--> statement-breakpoint
ALTER TABLE "arbitrage_markets" DROP COLUMN "event_id";--> statement-breakpoint
ALTER TABLE "arbitrage_markets" DROP COLUMN "category";--> statement-breakpoint
ALTER TABLE "arbitrage_markets" DROP COLUMN "source_updated_at";--> statement-breakpoint
ALTER TABLE "arbitrage_markets" DROP COLUMN "refreshed_at";--> statement-breakpoint
ALTER TABLE "arbitrage_markets" DROP COLUMN "payload";