CREATE TABLE "arbitrage_service_locks" (
	"lock_name" text PRIMARY KEY NOT NULL,
	"lease_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
