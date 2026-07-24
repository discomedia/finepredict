import { readFile } from "node:fs/promises";

import { z } from "zod";

import type { AppConfig } from "../config.js";
import type { FinePredictDatabase } from "../database/client.js";
import type { PairOverride } from "./common/types.js";
import { KalshiClient } from "./discovery/kalshi-client.js";
import { KalshiRequestScheduler } from "./discovery/kalshi-request-scheduler.js";
import { DirectMarketDataClient } from "./market-data/direct-market-data-client.js";
import { NativeCatalogClient } from "./opportunities/native-catalog-client.js";
import { OpportunityRepository } from "./opportunities/opportunity-repository.js";
import { OpportunityScanner } from "./opportunities/opportunity-scanner.js";
import { OpportunityService } from "./opportunities/opportunity-service.js";

const pairOverrideSchema = z.object({
  kalshiMarketId: z.string().min(1),
  polymarketMarketId: z.string().min(1),
  kalshiEventId: z.string().min(1).optional(),
  polymarketEventId: z.string().min(1).optional(),
  verified: z.boolean(),
  classification: z
    .enum(["pure_arbitrage", "near_arbitrage", "relative_value", "mismatch"])
    .optional(),
  settlementRisks: z.array(z.string().min(1)).optional(),
  note: z.string().min(1),
});

/** FinePredict arbitrage components shared by HTTP and recurring jobs. */
export interface ArbitrageRuntime {
  /** Postgres-backed catalog and opportunity repository. */
  readonly repository: OpportunityRepository;
  /** Periodic discovery and repricing coordinator. */
  readonly service: OpportunityService;
}

/**
 * Builds FinePredict's read-only arbitrage scanner around the shared database.
 *
 * @param config - Validated application and scanner controls.
 * @param database - FinePredict Postgres client.
 * @returns Configured repository and recurring service.
 */
export async function createArbitrageRuntime(
  config: AppConfig,
  database: FinePredictDatabase,
): Promise<ArbitrageRuntime> {
  const repository = new OpportunityRepository(database);
  const kalshiRequestScheduler = new KalshiRequestScheduler();
  const scanner = new OpportunityScanner({
    catalogClient: new NativeCatalogClient({
      kalshiRequestScheduler,
    }),
    repository,
    directMarketDataClient: new DirectMarketDataClient({
      kalshiRequestScheduler,
    }),
    kalshiClient: new KalshiClient({
      requestScheduler: kalshiRequestScheduler,
    }),
    pairOverrides: await loadPairOverrides(),
  });
  return {
    repository,
    service: new OpportunityService({
      scanner,
      repository,
      discoveryIntervalMs: config.arbitrage.discoveryIntervalMs,
      priceRefreshIntervalMs: config.arbitrage.priceRefreshIntervalMs,
      maximumPriceRefreshPairs: config.arbitrage.maximumPriceRefreshPairs,
      scanOptions: {
        minimumSimilarityPercent100:
          config.arbitrage.minimumSimilarityPercent100,
        minimumPreliminaryGrossEdgeDollarsPerShare:
          config.arbitrage.minimumPreliminaryEdgeDollarsPerShare,
        minimumNetEdgeDollarsPerShare:
          config.arbitrage.minimumNetEdgeDollarsPerShare,
        maximumFreshBookPairs: config.arbitrage.maximumFreshBookPairs,
        maximumPairsPerEventPair: config.arbitrage.maximumPairsPerEventPair,
        evaluationBudgetDollars: config.arbitrage.evaluationBudgetDollars,
        directBookConcurrency: config.arbitrage.directBookConcurrency,
      },
    }),
  };
}

/**
 * Loads the checked-in deterministic settlement-review registry.
 *
 * @returns Validated pair overrides.
 */
async function loadPairOverrides(): Promise<readonly PairOverride[]> {
  const overridesUrl = new URL(
    "../../../../config/arbitrage-pair-overrides.json",
    import.meta.url,
  );
  const raw = JSON.parse(await readFile(overridesUrl, "utf8")) as unknown;
  return z
    .array(pairOverrideSchema)
    .parse(raw)
    .map((override) => ({
      kalshiMarketId: override.kalshiMarketId,
      polymarketMarketId: override.polymarketMarketId,
      verified: override.verified,
      note: override.note,
      ...(override.kalshiEventId
        ? { kalshiEventId: override.kalshiEventId }
        : {}),
      ...(override.polymarketEventId
        ? { polymarketEventId: override.polymarketEventId }
        : {}),
      ...(override.classification
        ? { classification: override.classification }
        : {}),
      ...(override.settlementRisks
        ? { settlementRisks: override.settlementRisks }
        : {}),
    }));
}
