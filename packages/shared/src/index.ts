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

/** One market and all analysis rendered in a report. */
export const AnalysedMarketSchema = z.object({
  contract: MarketContractSchema,
  summary: ContractSummarySchema,
  findings: z.array(ContractFindingSchema),
  snapshots: z.array(MarketSnapshotSchema),
  sourceAvailability: z.enum(["available", "unavailable", "not_checked"]),
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
