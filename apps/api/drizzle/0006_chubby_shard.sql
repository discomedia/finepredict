CREATE TABLE "arbitrage_markets" (
	"venue" text NOT NULL,
	"market_id" text NOT NULL,
	"event_id" text NOT NULL,
	"category" text NOT NULL,
	"source_updated_at" timestamp with time zone,
	"refreshed_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "arbitrage_markets_primary" PRIMARY KEY("venue","market_id")
);
--> statement-breakpoint
CREATE TABLE "arbitrage_opportunities" (
	"opportunity_id" text PRIMARY KEY NOT NULL,
	"strategy" text NOT NULL,
	"status" text NOT NULL,
	"relationship" text NOT NULL,
	"category" text NOT NULL,
	"net_edge_dollars_per_share" double precision NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"scan_id" text NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arbitrage_scans" (
	"scan_id" text PRIMARY KEY NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"market_count" integer NOT NULL,
	"lexical_candidate_count" integer NOT NULL,
	"fresh_book_candidate_count" integer NOT NULL,
	"failed_candidate_count" integer NOT NULL,
	"external_request_count" integer NOT NULL,
	"database_write_count" integer NOT NULL,
	"opportunity_count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arbitrage_service_runs" (
	"run_id" text PRIMARY KEY NOT NULL,
	"job_type" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"external_request_count" integer NOT NULL,
	"database_write_count" integer NOT NULL,
	"candidate_count" integer NOT NULL,
	"opportunity_count" integer NOT NULL,
	"error_message" text
);
--> statement-breakpoint
CREATE INDEX "arbitrage_markets_category_idx" ON "arbitrage_markets" USING btree ("category","venue");--> statement-breakpoint
CREATE INDEX "arbitrage_opportunities_list_idx" ON "arbitrage_opportunities" USING btree ("strategy","status","category","net_edge_dollars_per_share");--> statement-breakpoint
CREATE INDEX "arbitrage_opportunities_relationship_idx" ON "arbitrage_opportunities" USING btree ("relationship","status","net_edge_dollars_per_share");--> statement-breakpoint
CREATE INDEX "arbitrage_service_runs_latest_idx" ON "arbitrage_service_runs" USING btree ("job_type","started_at");