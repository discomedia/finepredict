import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import "../../load-environment.js";
import {
  createDatabaseResources,
  type FinePredictDatabase,
} from "../../database/client.js";
import {
  arbitrageKalshiFeeSchedules,
  arbitrageMarkets,
  arbitrageOpportunities,
  arbitrageOpportunityHistory,
  arbitrageScans,
  arbitrageServiceLocks,
  arbitrageServiceRuns,
} from "../../database/schema.js";
import type { KalshiFeeSchedule } from "../common/types.js";
import { OpportunityRepository } from "./opportunity-repository.js";
import type {
  NativeBinaryMarket,
  OpportunityScanResult,
  ScannedOpportunity,
} from "./types.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error(
    `FinePredict arbitrage integration tests: DATABASE_URL is required.`,
  );
}
const resources = createDatabaseResources(databaseUrl);
const rollbackMarker = new Error("rollback arbitrage integration fixture");

describe("arbitrage Postgres persistence", () => {
  beforeAll(async () => {
    await migrate(resources.database, { migrationsFolder: "./drizzle" });
  });

  afterAll(async () => {
    await resources.close();
  });

  it("skips volatile catalog rewrites and persists fee schedules", async () => {
    let writeCounts: readonly number[] = [];
    let durableFeeSchedule:
      | {
          readonly schedule: KalshiFeeSchedule;
          readonly expiresAtIso: string;
        }
      | undefined;
    let summary:
      | {
          readonly kalshiMarketCount: number;
          readonly polymarketMarketCount: number;
        }
      | undefined;
    try {
      await resources.database.transaction(async (transaction) => {
        await transaction.delete(arbitrageOpportunities);
        await transaction.delete(arbitrageOpportunityHistory);
        await transaction.delete(arbitrageScans);
        await transaction.delete(arbitrageServiceRuns);
        await transaction.delete(arbitrageServiceLocks);
        await transaction.delete(arbitrageMarkets);
        await transaction.delete(arbitrageKalshiFeeSchedules);
        const repository = new OpportunityRepository(
          transaction as unknown as FinePredictDatabase,
        );
        const markets = [
          market("kalshi", "K-INTEGRATION"),
          market("polymarket", "P-INTEGRATION"),
        ];
        const first = await repository.saveCatalog(
          markets,
          "2026-07-24T00:00:00.000Z",
        );
        const unchanged = await repository.saveCatalog(
          markets,
          "2026-07-24T01:00:00.000Z",
        );
        const volatileOnly = await repository.saveCatalog(
          [
            {
              ...markets[0]!,
              catalogYesAskDollars: 0.45,
              volume: 100,
              liquidity: 50,
              sourceUpdatedAtIso: "2026-07-24T01:59:00.000Z",
            },
            markets[1]!,
          ],
          "2026-07-24T02:00:00.000Z",
        );
        const materiallyChanged = await repository.saveCatalog(
          [
            { ...markets[0]!, question: "Will the changed fixture happen?" },
            markets[1]!,
          ],
          "2026-07-24T03:00:00.000Z",
        );
        writeCounts = [
          first.databaseWriteCount,
          unchanged.databaseWriteCount,
          volatileOnly.databaseWriteCount,
          materiallyChanged.databaseWriteCount,
        ];
        const feeSchedule: KalshiFeeSchedule = {
          feeType: "quadratic",
          feeMultiplier: 0.07,
          seriesTicker: "SERIES",
        };
        await repository.saveKalshiFeeSchedules(
          [feeSchedule],
          "2026-07-24T00:00:00.000Z",
          "2026-07-25T00:00:00.000Z",
        );
        durableFeeSchedule = (
          await repository.getValidKalshiFeeSchedules(
            ["SERIES"],
            "2026-07-24T12:00:00.000Z",
          )
        ).get("SERIES");
        summary = await repository.getSummary();
        throw rollbackMarker;
      });
    } catch (error) {
      if (error !== rollbackMarker) {
        throw error;
      }
    }

    expect(writeCounts).toEqual([2, 0, 0, 1]);
    expect(durableFeeSchedule).toEqual({
      schedule: {
        feeType: "quadratic",
        feeMultiplier: 0.07,
        seriesTicker: "SERIES",
      },
      expiresAtIso: "2026-07-25T00:00:00.000Z",
    });
    expect(summary).toMatchObject({
      kalshiMarketCount: 1,
      polymarketMarketCount: 1,
    });
  });

  it("retains a prior opportunity when its full-scan refresh fails", async () => {
    let retainedAfterFailure = false;
    let removedAfterSuccessfulAbsence = false;
    try {
      await resources.database.transaction(async (transaction) => {
        await transaction.delete(arbitrageOpportunities);
        await transaction.delete(arbitrageOpportunityHistory);
        await transaction.delete(arbitrageScans);
        const repository = new OpportunityRepository(
          transaction as unknown as FinePredictDatabase,
        );
        const opportunity = opportunityFixture();
        await repository.saveScan(scanResult("initial-scan", [opportunity]));
        await repository.saveScan(
          scanResult("failed-refresh", []),
          new Set([opportunity.opportunityId]),
        );
        retainedAfterFailure =
          (await repository.getOpportunity(opportunity.opportunityId)) !==
          undefined;
        await repository.saveScan(scanResult("successful-refresh", []));
        removedAfterSuccessfulAbsence =
          (await repository.getOpportunity(opportunity.opportunityId)) ===
          undefined;
        throw rollbackMarker;
      });
    } catch (error) {
      if (error !== rollbackMarker) {
        throw error;
      }
    }

    expect(retainedAfterFailure).toBe(true);
    expect(removedAfterSuccessfulAbsence).toBe(true);
  });

  it("does not hold a database transaction while a scanner lease is active", async () => {
    let ranOperation = false;
    let rejectedConcurrentOperation = false;
    try {
      await resources.database.transaction(async (transaction) => {
        await transaction.delete(arbitrageServiceLocks);
        const repository = new OpportunityRepository(
          transaction as unknown as FinePredictDatabase,
        );
        await transaction.insert(arbitrageServiceLocks).values({
          lockName: "finepredict-arbitrage-service",
          leaseId: "another-service",
          expiresAt: new Date(Date.now() + 60_000),
        });
        rejectedConcurrentOperation = !(await repository.runWithServiceLock(
          async () => {
            ranOperation = true;
          },
        ));
        throw rollbackMarker;
      });
    } catch (error) {
      if (error !== rollbackMarker) {
        throw error;
      }
    }

    expect(rejectedConcurrentOperation).toBe(true);
    expect(ranOperation).toBe(false);
  });

  it("deduplicates hourly observations and preserves history metadata", async () => {
    let hourlyHistory: Awaited<
      ReturnType<OpportunityRepository["getOpportunityHistory"]>
    >;
    try {
      await resources.database.transaction(async (transaction) => {
        await transaction.delete(arbitrageOpportunities);
        await transaction.delete(arbitrageOpportunityHistory);
        const repository = new OpportunityRepository(
          transaction as unknown as FinePredictDatabase,
        );
        const first = opportunityFixture();
        const second = {
          ...first,
          observedAtIso: "2026-07-24T00:45:00.000Z",
          buyYesAveragePriceDollars: 0.42,
          netEdgeDollarsPerShare: 0.07,
        };
        const third = {
          ...first,
          observedAtIso: "2026-07-24T01:05:00.000Z",
          buyYesAveragePriceDollars: 0.46,
          netEdgeDollarsPerShare: 0.03,
        };
        await repository.saveScan(scanResult("history-1", [first]));
        await repository.saveScan(scanResult("history-2", [second]));
        await repository.saveScan(scanResult("history-3", [third]));
        hourlyHistory = await repository.getOpportunityHistory(
          first.opportunityId,
        );
        throw rollbackMarker;
      });
    } catch (error) {
      if (error !== rollbackMarker) {
        throw error;
      }
    }

    expect(hourlyHistory).toMatchObject({
      opportunityId: "pair-integration",
      detectedAtIso: "2026-07-24T00:00:00.000Z",
      points: [
        { observedAtIso: "2026-07-24T00:00:00.000Z" },
        { observedAtIso: "2026-07-24T01:05:00.000Z" },
      ],
    });
  });
});

/**
 * Creates one minimal active native market.
 *
 * @param venue - Venue identifier.
 * @param marketId - Stable market identifier.
 * @returns Native market fixture.
 */
function market(
  venue: "kalshi" | "polymarket",
  marketId: string,
): NativeBinaryMarket {
  return {
    venue,
    marketId,
    eventId: `${marketId}-event`,
    ...(venue === "kalshi" ? { seriesId: "SERIES" } : {}),
    question: "Will the fixture happen?",
    description: "Exact shared rules.",
    category: "test",
    status: "active",
    ...(venue === "polymarket"
      ? {
          yesTokenId: "yes",
          noTokenId: "no",
          polymarketFeeRate: 0,
          polymarketFeeExponent: 1,
        }
      : {}),
    minimumOrderSizeShares: 1,
    catalogYesAskDollars: 0.4,
    catalogNoAskDollars: 0.6,
    volume: 0,
    liquidity: 0,
  };
}

/**
 * Creates one complete scan fixture.
 *
 * @param scanId - Stable test scan identifier.
 * @param opportunities - Positive current opportunities.
 * @returns Complete scan result.
 */
function scanResult(
  scanId: string,
  opportunities: readonly ScannedOpportunity[],
): OpportunityScanResult {
  return {
    scanId,
    marketCount: 2,
    lexicalCandidateCount: 1,
    freshBookCandidateCount: 1,
    failedCandidateCount: 0,
    externalRequestCount: 0,
    databaseWriteCount: 0,
    opportunities,
  };
}

/**
 * Creates one executable opportunity fixture.
 *
 * @returns Complete scanner record.
 */
function opportunityFixture(): ScannedOpportunity {
  const sharedMarket = {
    eventId: "event-1",
    question: "Will the fixture happen?",
    description: "Exact settlement rules.",
    category: "test",
    status: "active",
    minimumOrderSizeShares: 1,
    catalogYesAskDollars: 0.4,
    catalogNoAskDollars: 0.5,
    volume: 0,
    liquidity: 0,
  };
  return {
    opportunityId: "pair-integration",
    strategy: "cross_venue_equivalent",
    status: "actionable",
    category: "test",
    matchConfidence: "verified",
    relationship: "pure_arbitrage",
    settlementRisks: [],
    kalshi: {
      ...sharedMarket,
      venue: "kalshi",
      marketId: "KXTEST",
      seriesId: "KXTEST",
    },
    polymarket: {
      ...sharedMarket,
      venue: "polymarket",
      marketId: "0xtest",
      yesTokenId: "yes",
      noTokenId: "no",
      polymarketFeeRate: 0,
      polymarketFeeExponent: 1,
    },
    direction: {
      buyYesVenue: "kalshi",
      buyNoVenue: "polymarket",
    },
    executableShares: 10,
    buyYesAveragePriceDollars: 0.4,
    buyNoAveragePriceDollars: 0.5,
    grossCostDollars: 9,
    feesDollars: 0.1,
    grossProfitDollars: 1,
    netProfitDollars: 0.9,
    conditionalNetProfitDollars: 0.9,
    worstCaseSettlementDivergenceLossDollars: 0,
    netEdgeDollarsPerShare: 0.09,
    roiPercent100: 9.89,
    observedAtIso: "2026-07-24T00:00:00.000Z",
    similarityPercent100: 100,
    matchReasons: ["Exact fixture"],
  };
}
