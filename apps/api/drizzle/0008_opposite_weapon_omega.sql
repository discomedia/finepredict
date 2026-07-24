ALTER TABLE "reports" ADD COLUMN "source_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "reports_source_key_unique" ON "reports" USING btree ("source_key");