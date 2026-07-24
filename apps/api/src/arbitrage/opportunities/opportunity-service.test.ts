import { describe, expect, it, vi } from "vitest";

import {
  OpportunityService,
  type OpportunityServiceRepository,
  type OpportunityServiceScanner,
} from "./opportunity-service.js";
import type { OpportunityScanOptions, OpportunityServiceRun } from "./types.js";

const scanOptions: OpportunityScanOptions = {
  minimumSimilarityPercent100: 75,
  minimumPreliminaryGrossEdgeDollarsPerShare: 0.015,
  minimumNetEdgeDollarsPerShare: 0.03,
  maximumFreshBookPairs: 100,
  maximumPairsPerEventPair: 10,
  evaluationBudgetDollars: 1_000,
  directBookConcurrency: 4,
};

describe("opportunity service", () => {
  it("records exact discovery request and durable-write metrics", async () => {
    const runs: OpportunityServiceRun[] = [];
    const repository = repositoryFixture(runs);
    const scanner: OpportunityServiceScanner = {
      refreshCatalog: vi.fn(async () => ({
        requestCount: 12,
        kalshiMarketCount: 40,
        polymarketMarketCount: 30,
        changedMarketCount: 3,
        deletedMarketCount: 1,
        databaseWriteCount: 4,
      })),
      scan: vi.fn(async () => ({
        scanId: "scan",
        marketCount: 70,
        lexicalCandidateCount: 15,
        freshBookCandidateCount: 8,
        failedCandidateCount: 1,
        externalRequestCount: 5,
        databaseWriteCount: 5,
        opportunities: [],
      })),
      refreshPrices: vi.fn(async () => ({
        refreshId: "refresh",
        attemptedOpportunityCount: 0,
        updatedOpportunityCount: 0,
        removedOpportunityCount: 0,
        failedOpportunityCount: 0,
        externalRequestCount: 0,
        databaseWriteCount: 0,
        opportunities: [],
      })),
    };
    const service = new OpportunityService({
      scanner,
      repository,
      discoveryIntervalMs: 60_000,
      priceRefreshIntervalMs: 5_000,
      maximumPriceRefreshPairs: 24,
      scanOptions,
    });

    await service.start(false);
    await service.runDiscoveryNow();
    service.stop();

    expect(runs).toHaveLength(2);
    expect(runs[0]?.status).toBe("running");
    expect(runs[1]).toMatchObject({
      status: "completed",
      externalRequestCount: 17,
      databaseWriteCount: 11,
      candidateCount: 8,
      opportunityCount: 0,
    });
  });

  it("uses the configured small cap for price-only refreshes", async () => {
    const runs: OpportunityServiceRun[] = [];
    const refreshPrices = vi.fn(async () => ({
      refreshId: "refresh",
      attemptedOpportunityCount: 7,
      updatedOpportunityCount: 6,
      removedOpportunityCount: 1,
      failedOpportunityCount: 0,
      externalRequestCount: 8,
      databaseWriteCount: 7,
      opportunities: [],
    }));
    const scanner: OpportunityServiceScanner = {
      refreshCatalog: vi.fn(async () => ({
        requestCount: 0,
        kalshiMarketCount: 0,
        polymarketMarketCount: 0,
        changedMarketCount: 0,
        deletedMarketCount: 0,
        databaseWriteCount: 0,
      })),
      scan: vi.fn(async () => ({
        scanId: "scan",
        marketCount: 0,
        lexicalCandidateCount: 0,
        freshBookCandidateCount: 0,
        failedCandidateCount: 0,
        externalRequestCount: 0,
        databaseWriteCount: 0,
        opportunities: [],
      })),
      refreshPrices,
    };
    const service = new OpportunityService({
      scanner,
      repository: repositoryFixture(runs),
      discoveryIntervalMs: 60_000,
      priceRefreshIntervalMs: 5_000,
      maximumPriceRefreshPairs: 7,
      scanOptions,
    });

    await service.runPriceRefreshNow();

    expect(refreshPrices).toHaveBeenCalledWith(scanOptions, 7);
    expect(runs[1]).toMatchObject({
      status: "completed",
      externalRequestCount: 8,
      databaseWriteCount: 9,
      candidateCount: 7,
      opportunityCount: 6,
    });
  });
});

/**
 * Creates an in-memory run-metric repository.
 *
 * @param runs - Mutable audit sink.
 * @returns Service repository fixture.
 */
function repositoryFixture(
  runs: OpportunityServiceRun[],
): OpportunityServiceRepository {
  return {
    getLatestServiceRun: async () => undefined,
    saveServiceRun: async (run) => {
      runs.push(run);
      return 1;
    },
    runWithServiceLock: async (operation) => {
      await operation();
      return true;
    },
  };
}
