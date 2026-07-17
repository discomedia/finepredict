CREATE TABLE "market_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"source_url" text NOT NULL,
	"title" text NOT NULL,
	"rules_text" text NOT NULL,
	"resolution_source" text,
	"end_date" timestamp with time zone,
	"content_hash" text NOT NULL,
	"diff_lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"payload" jsonb NOT NULL,
	"model_used" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "market_snapshots_contract_idx" ON "market_snapshots" USING btree ("platform","external_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_slug_unique" ON "reports" USING btree ("slug");