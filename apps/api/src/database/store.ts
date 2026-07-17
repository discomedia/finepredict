import type {
  FinePredictModel,
  FinePredictReport,
  MarketPlatform,
  MarketSnapshot,
} from "@finepredict/shared";
import {
  FinePredictModelSchema,
  FinePredictReportSchema,
} from "@finepredict/shared";
import { and, desc, eq } from "drizzle-orm";

import type { FinePredictDatabase } from "./client.js";
import { marketSnapshots, reports, systemSettings } from "./schema.js";

/** Data required to persist a new immutable rules snapshot. */
export interface SaveSnapshotInput {
  contentHash: string;
  diffLines: string[];
  endDate: string | null;
  externalId: string;
  platform: MarketPlatform;
  reportId: string;
  resolutionSource: string | null;
  rulesText: string;
  sourceUrl: string;
  title: string;
}

/** Summary card for a recent public report. */
export interface ReportListItem {
  createdAt: string;
  marketCount: number;
  slug: string;
  titles: string[];
}

/** Persistence operations needed by the FinePredict application service. */
export interface ReportStore {
  getReport(slug: string): Promise<FinePredictReport | null>;
  getSettingsModel(fallback: FinePredictModel): Promise<FinePredictModel>;
  listRecentReports(limit: number): Promise<ReportListItem[]>;
  listSnapshots(
    platform: MarketPlatform,
    externalId: string,
    limit: number,
  ): Promise<MarketSnapshot[]>;
  saveReport(report: FinePredictReport): Promise<void>;
  saveSnapshot(input: SaveSnapshotInput): Promise<MarketSnapshot>;
  updateSettingsModel(model: FinePredictModel): Promise<void>;
}

/** Neon-backed implementation of report and snapshot persistence. */
export class NeonReportStore implements ReportStore {
  /**
   * Creates a Neon report store.
   *
   * @param database - Typed Drizzle database client.
   */
  public constructor(private readonly database: FinePredictDatabase) {}

  /** @inheritdoc */
  public async getReport(slug: string): Promise<FinePredictReport | null> {
    const [row] = await this.database
      .select({ payload: reports.payload })
      .from(reports)
      .where(eq(reports.slug, slug))
      .limit(1);
    return row ? FinePredictReportSchema.parse(row.payload) : null;
  }

  /** @inheritdoc */
  public async getSettingsModel(
    fallback: FinePredictModel,
  ): Promise<FinePredictModel> {
    const [row] = await this.database
      .select({ model: systemSettings.model })
      .from(systemSettings)
      .where(eq(systemSettings.id, "global"))
      .limit(1);
    return row ? FinePredictModelSchema.parse(row.model) : fallback;
  }

  /** @inheritdoc */
  public async listRecentReports(limit: number): Promise<ReportListItem[]> {
    const rows = await this.database
      .select({ payload: reports.payload })
      .from(reports)
      .orderBy(desc(reports.createdAt))
      .limit(limit);
    return rows.map((row) => {
      const report = FinePredictReportSchema.parse(row.payload);
      return {
        createdAt: report.createdAt,
        marketCount: report.markets.length,
        slug: report.slug,
        titles: report.markets.map((market) => market.contract.title),
      };
    });
  }

  /** @inheritdoc */
  public async listSnapshots(
    platform: MarketPlatform,
    externalId: string,
    limit: number,
  ): Promise<MarketSnapshot[]> {
    const rows = await this.database
      .select()
      .from(marketSnapshots)
      .where(
        and(
          eq(marketSnapshots.platform, platform),
          eq(marketSnapshots.externalId, externalId),
        ),
      )
      .orderBy(desc(marketSnapshots.capturedAt))
      .limit(limit);
    return rows.map((row) => ({
      capturedAt: row.capturedAt.toISOString(),
      changedFromPrevious:
        Array.isArray(row.diffLines) && row.diffLines.length > 0,
      contentHash: row.contentHash,
      diffLines: Array.isArray(row.diffLines)
        ? row.diffLines.filter(
            (line): line is string => typeof line === "string",
          )
        : [],
      endDate: row.endDate?.toISOString() ?? null,
      id: row.id,
      resolutionSource: row.resolutionSource,
      rulesText: row.rulesText,
      title: row.title,
    }));
  }

  /** @inheritdoc */
  public async saveReport(report: FinePredictReport): Promise<void> {
    await this.database.insert(reports).values({
      id: report.id,
      slug: report.slug,
      payload: report,
      modelUsed: report.modelUsed,
      createdAt: new Date(report.createdAt),
      updatedAt: new Date(report.updatedAt),
    });
  }

  /** @inheritdoc */
  public async saveSnapshot(input: SaveSnapshotInput): Promise<MarketSnapshot> {
    const [row] = await this.database
      .insert(marketSnapshots)
      .values({
        contentHash: input.contentHash,
        diffLines: input.diffLines,
        endDate: input.endDate ? new Date(input.endDate) : null,
        externalId: input.externalId,
        platform: input.platform,
        reportId: input.reportId,
        resolutionSource: input.resolutionSource,
        rulesText: input.rulesText,
        sourceUrl: input.sourceUrl,
        title: input.title,
      })
      .returning();
    if (!row) {
      throw new Error(`FinePredict store: snapshot insert returned no row.`);
    }
    return {
      capturedAt: row.capturedAt.toISOString(),
      changedFromPrevious: input.diffLines.length > 0,
      contentHash: row.contentHash,
      diffLines: input.diffLines,
      endDate: row.endDate?.toISOString() ?? null,
      id: row.id,
      resolutionSource: row.resolutionSource,
      rulesText: row.rulesText,
      title: row.title,
    };
  }

  /** @inheritdoc */
  public async updateSettingsModel(model: FinePredictModel): Promise<void> {
    await this.database
      .insert(systemSettings)
      .values({ id: "global", model })
      .onConflictDoUpdate({
        target: systemSettings.id,
        set: { model, updatedAt: new Date() },
      });
  }
}

/** In-memory persistence used by tests and credential-free local previews. */
export class MemoryReportStore implements ReportStore {
  private readonly reportsBySlug = new Map<string, FinePredictReport>();
  private readonly snapshotsByContract = new Map<string, MarketSnapshot[]>();
  private settingsModel: FinePredictModel | null = null;

  /** @inheritdoc */
  public async getReport(slug: string): Promise<FinePredictReport | null> {
    return this.reportsBySlug.get(slug) ?? null;
  }

  /** @inheritdoc */
  public async getSettingsModel(
    fallback: FinePredictModel,
  ): Promise<FinePredictModel> {
    return this.settingsModel ?? fallback;
  }

  /** @inheritdoc */
  public async listRecentReports(limit: number): Promise<ReportListItem[]> {
    return [...this.reportsBySlug.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map((report) => ({
        createdAt: report.createdAt,
        marketCount: report.markets.length,
        slug: report.slug,
        titles: report.markets.map((market) => market.contract.title),
      }));
  }

  /** @inheritdoc */
  public async listSnapshots(
    platform: MarketPlatform,
    externalId: string,
    limit: number,
  ): Promise<MarketSnapshot[]> {
    return (
      this.snapshotsByContract.get(`${platform}:${externalId}`) ?? []
    ).slice(0, limit);
  }

  /** @inheritdoc */
  public async saveReport(report: FinePredictReport): Promise<void> {
    this.reportsBySlug.set(report.slug, report);
  }

  /** @inheritdoc */
  public async saveSnapshot(input: SaveSnapshotInput): Promise<MarketSnapshot> {
    const snapshot: MarketSnapshot = {
      capturedAt: new Date().toISOString(),
      changedFromPrevious: input.diffLines.length > 0,
      contentHash: input.contentHash,
      diffLines: input.diffLines,
      endDate: input.endDate,
      id: crypto.randomUUID(),
      resolutionSource: input.resolutionSource,
      rulesText: input.rulesText,
      title: input.title,
    };
    const key = `${input.platform}:${input.externalId}`;
    this.snapshotsByContract.set(key, [
      snapshot,
      ...(this.snapshotsByContract.get(key) ?? []),
    ]);
    return snapshot;
  }

  /** @inheritdoc */
  public async updateSettingsModel(model: FinePredictModel): Promise<void> {
    this.settingsModel = model;
  }
}
