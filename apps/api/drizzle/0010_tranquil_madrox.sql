CREATE TABLE "arbitrage_opportunity_history" (
	"opportunity_id" text NOT NULL,
	"bucket_at" timestamp with time zone NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"buy_yes_venue" text NOT NULL,
	"buy_no_venue" text NOT NULL,
	"buy_yes_average_price_dollars" double precision NOT NULL,
	"buy_no_average_price_dollars" double precision NOT NULL,
	"gross_edge_dollars_per_share" double precision NOT NULL,
	"net_edge_dollars_per_share" double precision NOT NULL,
	"roi_percent100" double precision NOT NULL,
	CONSTRAINT "arbitrage_opportunity_history_primary" PRIMARY KEY("opportunity_id","bucket_at")
);
--> statement-breakpoint
CREATE INDEX "arbitrage_opportunity_history_lookup_idx" ON "arbitrage_opportunity_history" USING btree ("opportunity_id","observed_at");