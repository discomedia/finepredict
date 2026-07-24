import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import "../../load-environment.js";
import {
  createDatabaseResources,
  type FinePredictDatabase,
} from "../../database/client.js";
import {
  arbitrageMarkets,
  arbitrageOpportunities,
  arbitrageScans,
  arbitrageServiceRuns,
} from "../../database/schema.js";
import { OpportunityRepository } from "./opportunity-repository.js";
import type { NativeBinaryMarket } from "./types.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error(
    `FinePredict arbitrage integration tests: DATABASE_URL is required.`,
  );
}
const resources = createDatabaseResources(databaseUrl);
const rollbackMarker = new Error("rollback arbitrage integration fixture");

describe("arbitrage Postgres write efficiency", () => {
  beforeAll(async () => {
    await migrate(resources.database, { migrationsFolder: "./drizzle" });
  });

  afterAll(async () => {
    await resources.close();
  });

  it("does not durably rewrite unchanged catalog rows", async () => {
    let writeCounts: readonly number[] = [];
    let summary:
      | {
          readonly kalshiMarketCount: number;
          readonly polymarketMarketCount: number;
        }
      | undefined;
    try {
      await resources.database.transaction(async (transaction) => {
        await transaction.delete(arbitrageOpportunities);
        await transaction.delete(arbitrageScans);
        await transaction.delete(arbitrageServiceRuns);
        await transaction.delete(arbitrageMarkets);
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
        const changed = await repository.saveCatalog(
          [{ ...markets[0]!, catalogYesAskDollars: 0.45 }, markets[1]!],
          "2026-07-24T02:00:00.000Z",
        );
        writeCounts = [
          first.databaseWriteCount,
          unchanged.databaseWriteCount,
          changed.databaseWriteCount,
        ];
        summary = await repository.getSummary();
        throw rollbackMarker;
      });
    } catch (error) {
      if (error !== rollbackMarker) {
        throw error;
      }
    }

    expect(writeCounts).toEqual([2, 0, 1]);
    expect(summary).toMatchObject({
      kalshiMarketCount: 1,
      polymarketMarketCount: 1,
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
