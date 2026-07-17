import { z } from "zod";

/** Prediction-market platforms supported by the initial FinePredict release. */
export const MarketPlatformSchema = z.enum(["polymarket", "kalshi"]);

/** Supported prediction-market platform. */
export type MarketPlatform = z.infer<typeof MarketPlatformSchema>;

/** FinePredict model choices exposed to administrators. */
export const FinePredictModelSchema = z.enum([
  "gpt-5.6-luna",
  "gpt-5.6-terra",
  "gpt-5.6",
]);

/** OpenAI model selectable in system settings. */
export type FinePredictModel = z.infer<typeof FinePredictModelSchema>;

/** Finding severity used instead of an opaque aggregate risk score. */
export const FindingSeveritySchema = z.enum(["info", "warning", "high"]);

/** Severity of a specific, verifiable contract finding. */
export type FindingSeverity = z.infer<typeof FindingSeveritySchema>;

/** A normalized market contract captured from an upstream platform. */
export const MarketContractSchema = z.object({
  platform: MarketPlatformSchema,
  externalId: z.string().min(1),
  url: z.url(),
  title: z.string().min(1),
  rulesText: z.string().min(1),
  resolutionSource: z.string().nullable(),
  startDate: z.string().datetime().nullable(),
  endDate: z.string().datetime().nullable(),
  status: z.string().min(1),
  result: z.string().nullable().optional(),
  disputeState: z.string().nullable().optional(),
  settlementTimestamp: z.string().datetime().nullable().optional(),
  platformQuestionId: z.string().nullable().optional(),
  platformCreatorAddress: z.string().nullable().optional(),
  fetchedAt: z.string().datetime(),
});

/** Normalized market contract captured from Polymarket or Kalshi. */
export type MarketContract = z.infer<typeof MarketContractSchema>;

/** A deterministic warning or clarification with verbatim supporting text. */
export const ContractFindingSchema = z.object({
  id: z.string().min(1),
  checkId: z.string().min(1),
  severity: FindingSeveritySchema,
  title: z.string().min(1),
  explanation: z.string().min(1),
  quote: z.string().min(1),
  llmExplained: z.boolean(),
});

/** Specific contract-language finding shown to the user. */
export type ContractFinding = z.infer<typeof ContractFindingSchema>;

/** Plain-English contract explanation anchored to original wording. */
export const ContractSummarySchema = z.object({
  plainEnglish: z.string().min(1),
  supportingQuote: z.string().min(1),
});

/** User-facing contract summary and its exact supporting quote. */
export type ContractSummary = z.infer<typeof ContractSummarySchema>;

/** A timestamped, immutable copy of market terms. */
export const MarketSnapshotSchema = z.object({
  id: z.string().uuid(),
  capturedAt: z.string().datetime(),
  contentHash: z.string().min(1),
  title: z.string().min(1),
  rulesText: z.string().min(1),
  resolutionSource: z.string().nullable(),
  endDate: z.string().datetime().nullable(),
  changedFromPrevious: z.boolean(),
  diffLines: z.array(z.string()),
});

/** Immutable market-rules snapshot. */
export type MarketSnapshot = z.infer<typeof MarketSnapshotSchema>;

/** Reachability result for an automated resolution-source check. */
export const SourceAvailabilitySchema = z.enum([
  "available",
  "confirmed_unavailable",
  "unavailable",
  "access_limited",
  "not_checked",
]);

/** Automated resolution-source reachability state. */
export type SourceAvailability = z.infer<typeof SourceAvailabilitySchema>;

/** One market and all analysis rendered in a report. */
export const AnalysedMarketSchema = z.object({
  contract: MarketContractSchema,
  summary: ContractSummarySchema,
  findings: z.array(ContractFindingSchema),
  snapshots: z.array(MarketSnapshotSchema),
  sourceAvailability: SourceAvailabilitySchema,
});

/** Analyzed market including snapshot history and source state. */
export type AnalysedMarket = z.infer<typeof AnalysedMarketSchema>;

/** A single row in the cross-market comparison. */
export const ComparisonRowSchema = z.object({
  term: z.string().min(1),
  left: z.string().min(1),
  right: z.string().min(1),
  equivalent: z.boolean(),
});

/** Cross-market comparison row. */
export type ComparisonRow = z.infer<typeof ComparisonRowSchema>;

/** Contract-equivalence conclusion for a two-market report. */
export const MarketComparisonSchema = z.object({
  rows: z.array(ComparisonRowSchema),
  equivalentTrade: z.boolean(),
  conclusion: z.string().min(1),
});

/** Comparison of two contracts and whether they describe the same trade. */
export type MarketComparison = z.infer<typeof MarketComparisonSchema>;

/** Public FinePredict report returned by the API. */
export const FinePredictReportSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  markets: z.array(AnalysedMarketSchema).min(1).max(2),
  comparison: MarketComparisonSchema.nullable(),
  modelUsed: FinePredictModelSchema.nullable(),
  shareUrl: z.string().min(1),
});

/** Shareable FinePredict report. */
export type FinePredictReport = z.infer<typeof FinePredictReportSchema>;

/** Request body for creating a report from one or two market URLs. */
export const CreateReportRequestSchema = z.object({
  urls: z.array(z.url()).min(1).max(2),
});

/** Validated report-creation input. */
export type CreateReportRequest = z.infer<typeof CreateReportRequestSchema>;

/** Public, non-secret system settings. */
export const PublicSettingsSchema = z.object({
  model: FinePredictModelSchema,
  availableModels: z.array(FinePredictModelSchema),
});

/** Public system settings used by the settings page. */
export type PublicSettings = z.infer<typeof PublicSettingsSchema>;

/** Admin-only system-settings update. */
export const UpdateSettingsRequestSchema = z.object({
  model: FinePredictModelSchema,
});

/** Validated admin system-settings update. */
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>;

/** FinePredict account roles used for authorization. */
export const UserRoleSchema = z.enum(["user", "admin"]);

/** Role assigned to an authenticated FinePredict user. */
export type UserRole = z.infer<typeof UserRoleSchema>;

/** Public account information returned with the current session. */
export const AccountUserSchema = z.object({
  id: z.string().min(1),
  email: z.email(),
  name: z.string().min(1),
  role: UserRoleSchema,
});

/** Authenticated FinePredict account. */
export type AccountUser = z.infer<typeof AccountUserSchema>;

/** Subscription states relevant to product access. */
export const SubscriptionStatusSchema = z.enum([
  "inactive",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
]);

/** FinePredict subscription state. */
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;

/** Billing and entitlement summary for an account. */
export const SubscriptionSummarySchema = z.object({
  status: SubscriptionStatusSchema,
  entitled: z.boolean(),
  currentPeriodEnd: z.string().datetime().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  activeMarketLimit: z.number().int().positive(),
  providerConfigured: z.boolean(),
});

/** Subscription and watchlist entitlement summary. */
export type SubscriptionSummary = z.infer<typeof SubscriptionSummarySchema>;

/** One market followed by a user's watchlist. */
export const WatchlistMarketSchema = z.object({
  id: z.string().uuid(),
  platform: MarketPlatformSchema,
  externalId: z.string().min(1),
  marketUrl: z.url(),
  title: z.string().min(1),
  active: z.boolean(),
  addedAt: z.string().datetime(),
});

/** Market attached to a watchlist. */
export type WatchlistMarket = z.infer<typeof WatchlistMarketSchema>;

/** A named collection of monitored prediction markets. */
export const WatchlistSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
  createdAt: z.string().datetime(),
  markets: z.array(WatchlistMarketSchema),
});

/** User-owned watchlist. */
export type Watchlist = z.infer<typeof WatchlistSchema>;

/** Request body for creating a watchlist. */
export const CreateWatchlistRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
});

/** Validated watchlist-creation input. */
export type CreateWatchlistRequest = z.infer<
  typeof CreateWatchlistRequestSchema
>;

/** Request body for adding a market to a watchlist. */
export const AddWatchlistMarketRequestSchema = z.object({
  url: z.url(),
});

/** Validated input for a watched market. */
export type AddWatchlistMarketRequest = z.infer<
  typeof AddWatchlistMarketRequestSchema
>;

/** FinePredict lifecycle states that retain the raw platform state separately. */
export const NormalizedLifecycleStateSchema = z.enum([
  "open",
  "inactive",
  "closed",
  "determined",
  "disputed",
  "amended",
  "finalized",
  "unknown",
]);

/** Cross-platform FinePredict lifecycle state. */
export type NormalizedLifecycleState = z.infer<
  typeof NormalizedLifecycleStateSchema
>;

/** Lightweight state captured on each monitoring pass. */
export const MarketObservationSchema = z.object({
  id: z.string().uuid(),
  platform: MarketPlatformSchema,
  externalId: z.string().min(1),
  observedAt: z.string().datetime(),
  title: z.string().min(1),
  rulesHash: z.string().min(1),
  deadline: z.string().datetime().nullable(),
  resolutionSource: z.string().nullable(),
  sourceAvailability: SourceAvailabilitySchema,
  rawPlatformState: z.string().min(1),
  normalizedState: NormalizedLifecycleStateSchema,
  result: z.string().nullable(),
  disputeState: z.string().nullable(),
  settlementTimestamp: z.string().datetime().nullable(),
  snapshotId: z.string().uuid().nullable(),
});

/** Normalized observation of a watched market. */
export type MarketObservation = z.infer<typeof MarketObservationSchema>;

/** Monitoring events exposed to watchlist owners. */
export const AlertEventTypeSchema = z.enum([
  "rules_changed",
  "title_changed",
  "deadline_changed",
  "deadline_extended",
  "postponement_detected",
  "resolution_source_changed",
  "source_degraded",
  "source_recovered",
  "lifecycle_disputed",
  "lifecycle_amended",
  "lifecycle_determined",
  "lifecycle_finalized",
]);

/** Type of a concrete monitoring alert. */
export type AlertEventType = z.infer<typeof AlertEventTypeSchema>;

/** In-app notification generated by monitoring. */
export const AlertEventSchema = z.object({
  id: z.string().uuid(),
  type: AlertEventTypeSchema,
  title: z.string().min(1),
  detail: z.string().min(1),
  marketUrl: z.url(),
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
});

/** Concrete in-app monitoring notification. */
export type AlertEvent = z.infer<typeof AlertEventSchema>;

/** Editorial publication states for imported dispute cases. */
export const DisputeReviewStatusSchema = z.enum([
  "pending_review",
  "published",
  "rejected",
]);

/** Review state of a historical dispute case. */
export type DisputeReviewStatus = z.infer<typeof DisputeReviewStatusSchema>;

/** Exact source citation attached to a dispute case. */
export const DisputeSourceSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1),
  url: z.url(),
  quotedText: z.string().min(1).nullable(),
  transactionHash: z.string().nullable(),
});

/** Citation preserving a dispute source or transaction. */
export type DisputeSource = z.infer<typeof DisputeSourceSchema>;

/** One platform lifecycle event in a dispute case. */
export const DisputeEventSchema = z.object({
  id: z.string().uuid(),
  eventType: z.string().min(1),
  rawPlatformState: z.string().min(1),
  occurredAt: z.string().datetime(),
  detail: z.string().nullable(),
  transactionHash: z.string().nullable().optional(),
});

/** Historical lifecycle transition within a dispute. */
export type DisputeEvent = z.infer<typeof DisputeEventSchema>;

/** Reviewed historical dispute and its exact supporting material. */
export const DisputeCaseSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1),
  platform: MarketPlatformSchema,
  externalId: z.string().min(1),
  title: z.string().min(1),
  marketUrl: z.url(),
  archivedRules: z.string().min(1),
  disputedWording: z.string().min(1),
  outcome: z.string().nullable(),
  reviewStatus: DisputeReviewStatusSchema,
  wordingTags: z.array(z.string().min(1)),
  checkIds: z.array(z.string().min(1)),
  publishedAt: z.string().datetime().nullable(),
  sources: z.array(DisputeSourceSchema),
  events: z.array(DisputeEventSchema),
  matchReasons: z.array(z.string().min(1)).optional(),
});

/** Published or reviewable historical dispute case. */
export type DisputeCase = z.infer<typeof DisputeCaseSchema>;

/** API-key scopes supported by the versioned developer API. */
export const ApiKeyScopeSchema = z.enum([
  "reports:read",
  "reports:write",
  "markets:read",
  "disputes:read",
]);

/** Authorization scope attached to a developer API key. */
export type ApiKeyScope = z.infer<typeof ApiKeyScopeSchema>;

/** Safe API-key metadata that never includes the secret. */
export const ApiKeySummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
  prefix: z.string().min(1),
  scopes: z.array(ApiKeyScopeSchema),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
});

/** Developer API-key metadata. */
export type ApiKeySummary = z.infer<typeof ApiKeySummarySchema>;

/** Request body for creating a developer API key. */
export const CreateApiKeyRequestSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(ApiKeyScopeSchema).min(1),
});

/** Validated developer API-key creation input. */
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequestSchema>;

/** Daily developer API usage summary. */
export const UsageSummarySchema = z.object({
  date: z.string().date(),
  billableUnits: z.number().int().nonnegative(),
  reportedToStripeAt: z.string().datetime().nullable(),
});

/** One daily developer API usage aggregate. */
export type UsageSummary = z.infer<typeof UsageSummarySchema>;

/** Structured versioned-API error response. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    requestId: z.string().min(1),
  }),
});

/** Structured developer API failure. */
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Creates a paginated response schema for a typed item schema. */
export const createPaginatedResponseSchema = <T extends z.ZodType>(
  itemSchema: T,
) =>
  z.object({
    items: z.array(itemSchema),
    nextCursor: z.string().nullable(),
  });
