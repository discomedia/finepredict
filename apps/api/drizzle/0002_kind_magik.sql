ALTER TABLE "dispute_events" ADD COLUMN "transaction_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "dispute_events_transaction_unique" ON "dispute_events" USING btree ("dispute_case_id","event_type","transaction_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "dispute_sources_transaction_unique" ON "dispute_sources" USING btree ("dispute_case_id","label","transaction_hash");