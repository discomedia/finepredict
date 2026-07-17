DROP INDEX "subscriptions_user_unique";--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "product" text DEFAULT 'watchlists' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_user_product_unique" ON "subscriptions" USING btree ("user_id","product");