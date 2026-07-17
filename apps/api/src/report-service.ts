import { createHash } from "node:crypto";

import type {
  AnalysedMarket,
  FinePredictModel,
  FinePredictReport,
  MarketContract,
} from "@finepredict/shared";
import { diffLines as createLineDiff } from "diff";

import { compareContracts } from "./analysis/comparison.js";
import { runDeterministicChecks } from "./analysis/deterministic-checks.js";
import {
  createDeterministicSummary,
  explainContractWithLlm,
} from "./analysis/llm-explainer.js";
import { checkSourceAvailability } from "./analysis/source-monitor.js";
import type { AppConfig } from "./config.js";
import type { ReportListItem, ReportStore } from "./database/store.js";
import { log } from "./log.js";
import { fetchMarketContract } from "./markets/platform.js";

/** Injectable dependencies for the report orchestration service. */
export interface ReportServiceDependencies {
  config: AppConfig;
  fetchImplementation?: typeof fetch;
  store: ReportStore;
}

/** Coordinates extraction, analysis, LLM explanation, snapshots, and reports. */
export class ReportService {
  private readonly fetchImplementation: typeof fetch;

  /**
   * Creates the report orchestration service.
   *
   * @param dependencies - Persistence, runtime config, and optional HTTP client.
   */
  public constructor(private readonly dependencies: ReportServiceDependencies) {
    this.fetchImplementation = dependencies.fetchImplementation ?? fetch;
  }

  /**
   * Creates and permanently snapshots a report for one or two market URLs.
   *
   * @param urls - One or two supported market URLs.
   * @returns Complete shareable report.
   */
  public async createReport(urls: string[]): Promise<FinePredictReport> {
    const contracts = await Promise.all(
      urls.map((url) => fetchMarketContract(url, this.fetchImplementation)),
    );
    const model = await this.dependencies.store.getSettingsModel(
      this.dependencies.config.defaultModel,
    );
    const reportId = crypto.randomUUID();
    const slug = createReportSlug(contracts);
    const markets = await Promise.all(
      contracts.map((contract) =>
        this.analyseAndSnapshotContract(contract, reportId, model),
      ),
    );
    const now = new Date().toISOString();
    const modelUsed = this.dependencies.config.openAiApiKey ? model : null;
    const report: FinePredictReport = {
      comparison:
        contracts.length === 2 && contracts[0] && contracts[1]
          ? compareContracts(contracts[0], contracts[1])
          : null,
      createdAt: now,
      id: reportId,
      markets,
      modelUsed,
      shareUrl: `${this.dependencies.config.webOrigin.replace(/\/$/, "")}/reports/${slug}`,
      slug,
      updatedAt: now,
    };
    await this.dependencies.store.saveReport(report);
    log("ReportService.createReport", "Created FinePredict report.", {
      marketCount: markets.length,
      modelUsed,
      reportId,
      slug,
    });
    return report;
  }

  /**
   * Gets an existing public report by share slug.
   *
   * @param slug - Public report identifier.
   * @returns Report or null when not found.
   */
  public async getReport(slug: string): Promise<FinePredictReport | null> {
    return this.dependencies.store.getReport(slug);
  }

  /**
   * Lists recent public report cards.
   *
   * @param limit - Maximum cards to return.
   * @returns Recent report summaries.
   */
  public async listRecentReports(limit = 8): Promise<ReportListItem[]> {
    return this.dependencies.store.listRecentReports(limit);
  }

  /**
   * Runs analysis and saves an immutable snapshot for one contract.
   *
   * @param contract - Normalized upstream contract.
   * @param reportId - Parent report identifier.
   * @param model - Current administrator-selected model.
   * @returns Fully analyzed market.
   */
  private async analyseAndSnapshotContract(
    contract: MarketContract,
    reportId: string,
    model: FinePredictModel,
  ): Promise<AnalysedMarket> {
    const deterministicFindings = runDeterministicChecks(contract);
    let findings = deterministicFindings;
    let summary = createDeterministicSummary(contract);
    if (this.dependencies.config.openAiApiKey) {
      try {
        const explanation = await explainContractWithLlm(
          contract,
          deterministicFindings,
          model,
          this.dependencies.config.openAiApiKey,
        );
        findings = explanation.findings;
        summary = explanation.summary;
      } catch (error) {
        log(
          "ReportService.analyseAndSnapshotContract",
          "LLM explanation failed; retained deterministic analysis.",
          {
            error: error instanceof Error ? error.message : String(error),
            externalId: contract.externalId,
            platform: contract.platform,
          },
        );
      }
    }

    const priorSnapshots = await this.dependencies.store.listSnapshots(
      contract.platform,
      contract.externalId,
      1,
    );
    const previous = priorSnapshots[0];
    const diffLines = previous
      ? formatDiff(previous.rulesText, contract.rulesText)
      : [];
    await this.dependencies.store.saveSnapshot({
      contentHash: hashContract(contract),
      diffLines,
      endDate: contract.endDate,
      externalId: contract.externalId,
      platform: contract.platform,
      reportId,
      resolutionSource: contract.resolutionSource,
      rulesText: contract.rulesText,
      sourceUrl: contract.url,
      title: contract.title,
    });
    const snapshots = await this.dependencies.store.listSnapshots(
      contract.platform,
      contract.externalId,
      10,
    );
    const sourceAvailability = await checkSourceAvailability(
      contract.resolutionSource,
      this.fetchImplementation,
    );
    return {
      contract,
      findings,
      snapshots,
      sourceAvailability,
      summary,
    };
  }
}

/**
 * Creates a stable content hash covering every settlement-relevant field.
 *
 * @param contract - Normalized market contract.
 * @returns SHA-256 content hash.
 */
function hashContract(contract: MarketContract): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        endDate: contract.endDate,
        resolutionSource: contract.resolutionSource,
        rulesText: contract.rulesText,
        title: contract.title,
      }),
    )
    .digest("hex");
}

/**
 * Creates a compact human-readable line diff between snapshots.
 *
 * @param previousRules - Previously archived rules.
 * @param currentRules - Newly fetched rules.
 * @returns Added and removed lines with visible prefixes.
 */
function formatDiff(previousRules: string, currentRules: string): string[] {
  return createLineDiff(previousRules, currentRules)
    .filter((part) => part.added || part.removed)
    .flatMap((part) =>
      part.value
        .split("\n")
        .filter(Boolean)
        .map((line) => `${part.added ? "+" : "-"} ${line}`),
    )
    .slice(0, 80);
}

/**
 * Creates a readable collision-resistant public report slug.
 *
 * @param contracts - Contracts in the report.
 * @returns URL-safe report slug.
 */
function createReportSlug(contracts: MarketContract[]): string {
  const readable = contracts
    .map((contract) => contract.title)
    .join(" vs ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 54);
  return `${readable || "market-report"}-${crypto.randomUUID().slice(0, 8)}`;
}
