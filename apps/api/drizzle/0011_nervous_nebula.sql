ALTER TABLE "arbitrage_opportunity_history" ALTER COLUMN "buy_yes_venue" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "arbitrage_opportunity_history" ALTER COLUMN "buy_no_venue" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "arbitrage_opportunity_history" ALTER COLUMN "buy_yes_average_price_dollars" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "arbitrage_opportunity_history" ALTER COLUMN "buy_no_average_price_dollars" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "arbitrage_opportunity_history" ADD COLUMN "legs" jsonb;