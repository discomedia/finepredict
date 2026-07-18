CREATE TABLE "api_usage_free_minutes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"usage_minute" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "subscriptions_stripe_customer_unique";--> statement-breakpoint
ALTER TABLE "api_usage_free_minutes" ADD CONSTRAINT "api_usage_free_minutes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_usage_free_minutes_user_minute_unique" ON "api_usage_free_minutes" USING btree ("user_id","usage_minute");--> statement-breakpoint
CREATE INDEX "subscriptions_stripe_customer_idx" ON "subscriptions" USING btree ("stripe_customer_id");