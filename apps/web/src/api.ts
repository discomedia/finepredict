import {
  FinePredictReportSchema,
  PublicSettingsSchema,
  type CreateReportRequest,
  type FinePredictModel,
  type FinePredictReport,
  type PublicSettings,
} from "@finepredict/shared";
import { z } from "zod";

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001"
).replace(/\/$/, "");

/** Recent report card returned by the public listing endpoint. */
export interface RecentReport {
  createdAt: string;
  marketCount: number;
  slug: string;
  titles: string[];
}

/** Recent-report API response schema. */
const RecentReportsResponseSchema = z.object({
  reports: z.array(
    z.object({
      createdAt: z.string().datetime(),
      marketCount: z.number().int().positive(),
      slug: z.string(),
      titles: z.array(z.string()),
    }),
  ),
});

/**
 * Creates a new FinePredict report.
 *
 * @param input - One or two supported market URLs.
 * @returns Created shareable report.
 */
export async function createReport(
  input: CreateReportRequest,
): Promise<FinePredictReport> {
  return FinePredictReportSchema.parse(
    await requestJson("/api/reports", {
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
  );
}

/**
 * Loads an existing report by public slug.
 *
 * @param slug - Public report slug.
 * @returns Shareable report.
 */
export async function getReport(slug: string): Promise<FinePredictReport> {
  return FinePredictReportSchema.parse(
    await requestJson(`/api/reports/${encodeURIComponent(slug)}`),
  );
}

/**
 * Lists recent reports for discovery on the home page.
 *
 * @returns Recent public report cards.
 */
export async function listRecentReports(): Promise<RecentReport[]> {
  return RecentReportsResponseSchema.parse(await requestJson("/api/reports"))
    .reports;
}

/**
 * Loads the administrator-selectable model setting.
 *
 * @returns Public settings and valid choices.
 */
export async function getSettings(): Promise<PublicSettings> {
  return PublicSettingsSchema.parse(await requestJson("/api/settings"));
}

/**
 * Updates the model setting using a server-validated administrator key.
 *
 * @param model - New model choice.
 * @param adminApiKey - Server-side administrator key supplied by the operator.
 * @returns Updated public settings.
 */
export async function updateSettings(
  model: FinePredictModel,
  adminApiKey: string,
): Promise<PublicSettings> {
  return PublicSettingsSchema.parse(
    await requestJson("/api/settings", {
      body: JSON.stringify({ model }),
      headers: {
        "Content-Type": "application/json",
        "x-admin-api-key": adminApiKey,
      },
      method: "PUT",
    }),
  );
}

/**
 * Performs an API request and extracts a safe human-readable error.
 *
 * @param path - API path relative to the configured backend.
 * @param init - Standard fetch options.
 * @returns Parsed JSON response.
 */
async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `Request failed with status ${response.status}.`;
    throw new Error(message);
  }
  return payload;
}
