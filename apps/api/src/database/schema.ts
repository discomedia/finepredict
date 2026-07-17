import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Persisted shareable reports and their fully rendered payloads. */
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    payload: jsonb("payload").notNull(),
    modelUsed: text("model_used"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("reports_slug_unique").on(table.slug)],
);

/** Immutable copies of rules observed at a specific point in time. */
export const marketSnapshots = pgTable(
  "market_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reportId: uuid("report_id"),
    platform: text("platform").notNull(),
    externalId: text("external_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    title: text("title").notNull(),
    rulesText: text("rules_text").notNull(),
    resolutionSource: text("resolution_source"),
    endDate: timestamp("end_date", { withTimezone: true }),
    contentHash: text("content_hash").notNull(),
    diffLines: jsonb("diff_lines")
      .notNull()
      .default(sql`'[]'::jsonb`),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("market_snapshots_contract_idx").on(
      table.platform,
      table.externalId,
      table.capturedAt,
    ),
  ],
);

/** Administrator-controlled global product settings. */
export const systemSettings = pgTable("system_settings", {
  id: text("id").primaryKey(),
  model: text("model").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Better Auth user records with a FinePredict authorization role. */
export const authUsers = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("emailVerified").notNull().default(false),
    image: text("image"),
    role: text("role").notNull().default("user"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("user_email_unique").on(table.email)],
);

/** Better Auth browser sessions stored in Neon. */
export const authSessions = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("session_token_unique").on(table.token),
    index("session_user_id_idx").on(table.userId),
  ],
);

/** Better Auth identity-provider accounts. */
export const authAccounts = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

/** Better Auth email-verification and magic-link tokens. */
export const authVerifications = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

/** Stripe-backed subscription entitlement for an account. */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    product: text("product").notNull().default("watchlists"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    status: text("status").notNull().default("inactive"),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("subscriptions_user_product_unique").on(
      table.userId,
      table.product,
    ),
    uniqueIndex("subscriptions_stripe_customer_unique").on(
      table.stripeCustomerId,
    ),
    uniqueIndex("subscriptions_stripe_subscription_unique").on(
      table.stripeSubscriptionId,
    ),
  ],
);

/** User-owned named watchlists. */
export const watchlists = pgTable(
  "watchlists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("watchlists_user_idx").on(table.userId)],
);

/** A supported market followed by one watchlist. */
export const watchlistMarkets = pgTable(
  "watchlist_markets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    watchlistId: uuid("watchlist_id")
      .notNull()
      .references(() => watchlists.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    externalId: text("external_id").notNull(),
    marketUrl: text("market_url").notNull(),
    title: text("title").notNull(),
    active: boolean("active").notNull().default(true),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("watchlist_markets_contract_unique").on(
      table.watchlistId,
      table.platform,
      table.externalId,
    ),
    index("watchlist_markets_active_idx").on(table.active),
  ],
);

/** Lightweight normalized state captured on every monitor check. */
export const marketObservations = pgTable(
  "market_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    watchlistMarketId: uuid("watchlist_market_id")
      .notNull()
      .references(() => watchlistMarkets.id, { onDelete: "cascade" }),
    monitorRunId: uuid("monitor_run_id"),
    platform: text("platform").notNull(),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    rulesHash: text("rules_hash").notNull(),
    deadline: timestamp("deadline", { withTimezone: true }),
    resolutionSource: text("resolution_source"),
    sourceAvailability: text("source_availability").notNull(),
    rawPlatformState: text("raw_platform_state").notNull(),
    normalizedState: text("normalized_state").notNull(),
    result: text("result"),
    disputeState: text("dispute_state"),
    settlementTimestamp: timestamp("settlement_timestamp", {
      withTimezone: true,
    }),
    snapshotId: uuid("snapshot_id").references(() => marketSnapshots.id, {
      onDelete: "set null",
    }),
    durationMilliseconds: integer("duration_milliseconds").notNull(),
    error: text("error"),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("market_observations_contract_idx").on(
      table.platform,
      table.externalId,
      table.observedAt,
    ),
    index("market_observations_watchlist_market_idx").on(
      table.watchlistMarketId,
      table.observedAt,
    ),
  ],
);

/** Auditable execution record for one short-lived monitor invocation. */
export const monitorRuns = pgTable("monitor_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  status: text("status").notNull().default("running"),
  dryRun: boolean("dry_run").notNull(),
  checkedCount: integer("checked_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  retryCount: integer("retry_count").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  error: text("error"),
});

/** Deduplicated in-app and email alert generated by monitoring. */
export const alertEvents = pgTable(
  "alert_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    watchlistMarketId: uuid("watchlist_market_id")
      .notNull()
      .references(() => watchlistMarkets.id, { onDelete: "cascade" }),
    observationId: uuid("observation_id").references(
      () => marketObservations.id,
      { onDelete: "set null" },
    ),
    eventType: text("event_type").notNull(),
    deduplicationKey: text("deduplication_key").notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    marketUrl: text("market_url").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
    deliveryAttempts: integer("delivery_attempts").notNull().default(0),
    lastDeliveryError: text("last_delivery_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("alert_events_deduplication_unique").on(table.deduplicationKey),
    index("alert_events_pending_email_idx").on(table.userId, table.emailSentAt),
  ],
);

/** Idempotency ledger for signed Stripe webhooks. */
export const stripeWebhookEvents = pgTable("stripe_webhook_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Imported dispute case held for editorial review before publication. */
export const disputeCases = pgTable(
  "dispute_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    platform: text("platform").notNull(),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    marketUrl: text("market_url").notNull(),
    archivedRules: text("archived_rules").notNull(),
    disputedWording: text("disputed_wording").notNull(),
    outcome: text("outcome"),
    reviewStatus: text("review_status").notNull().default("pending_review"),
    wordingTags: jsonb("wording_tags")
      .notNull()
      .default(sql`'[]'::jsonb`),
    checkIds: jsonb("check_ids")
      .notNull()
      .default(sql`'[]'::jsonb`),
    searchDocument: text("search_document").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("dispute_cases_slug_unique").on(table.slug),
    uniqueIndex("dispute_cases_contract_unique").on(
      table.platform,
      table.externalId,
    ),
    index("dispute_cases_search_idx").using(
      "gin",
      sql`to_tsvector('english', ${table.searchDocument})`,
    ),
  ],
);

/** Platform lifecycle transition attached to a dispute case. */
export const disputeEvents = pgTable(
  "dispute_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    disputeCaseId: uuid("dispute_case_id")
      .notNull()
      .references(() => disputeCases.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    rawPlatformState: text("raw_platform_state").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    detail: text("detail"),
    transactionHash: text("transaction_hash"),
  },
  (table) => [
    index("dispute_events_case_idx").on(table.disputeCaseId),
    uniqueIndex("dispute_events_transaction_unique").on(
      table.disputeCaseId,
      table.eventType,
      table.transactionHash,
    ),
  ],
);

/** Exact citation or transaction supporting a dispute case. */
export const disputeSources = pgTable(
  "dispute_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    disputeCaseId: uuid("dispute_case_id")
      .notNull()
      .references(() => disputeCases.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    url: text("url").notNull(),
    quotedText: text("quoted_text"),
    transactionHash: text("transaction_hash"),
  },
  (table) => [
    index("dispute_sources_case_idx").on(table.disputeCaseId),
    uniqueIndex("dispute_sources_transaction_unique").on(
      table.disputeCaseId,
      table.label,
      table.transactionHash,
    ),
  ],
);

/** Hashed developer API credential with one-time secret display. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    secretHash: text("secret_hash").notNull(),
    scopes: jsonb("scopes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("api_keys_secret_hash_unique").on(table.secretHash),
    index("api_keys_user_idx").on(table.userId),
    index("api_keys_prefix_idx").on(table.prefix),
  ],
);

/** Atomic daily API usage aggregate used by Stripe billing roll-ups. */
export const apiUsageDaily = pgTable(
  "api_usage_daily",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    apiKeyId: uuid("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    usageDate: date("usage_date").notNull(),
    billableUnits: integer("billable_units").notNull().default(0),
    stripeMeterEventId: text("stripe_meter_event_id"),
    reportedToStripeAt: timestamp("reported_to_stripe_at", {
      withTimezone: true,
    }),
  },
  (table) => [
    uniqueIndex("api_usage_daily_key_date_unique").on(
      table.apiKeyId,
      table.usageDate,
    ),
    index("api_usage_daily_unreported_idx").on(table.reportedToStripeAt),
  ],
);

/** Idempotent response cache for developer API report creation. */
export const apiIdempotency = pgTable(
  "api_idempotency",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    apiKeyId: uuid("api_key_id")
      .notNull()
      .references(() => apiKeys.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("api_idempotency_key_unique").on(
      table.apiKeyId,
      table.idempotencyKey,
    ),
  ],
);

/** Database schema exported for Drizzle client construction. */
export const databaseSchema = {
  alertEvents,
  apiIdempotency,
  apiKeys,
  apiUsageDaily,
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
  disputeCases,
  disputeEvents,
  disputeSources,
  marketSnapshots,
  marketObservations,
  monitorRuns,
  reports,
  stripeWebhookEvents,
  subscriptions,
  systemSettings,
  watchlistMarkets,
  watchlists,
};
