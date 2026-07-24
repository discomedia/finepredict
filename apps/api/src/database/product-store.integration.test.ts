import type { MarketContract } from "@finepredict/shared";
import { eq, inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import "../load-environment.js";
import { MonitoringStore } from "../monitoring/store.js";
import { loadConfig, normalizeDatabaseUrlSslMode } from "../config.js";
import { ReportService } from "../report-service.js";
import { createDatabaseResources } from "./client.js";
import { ProductStore } from "./product-store.js";
import { NeonReportStore } from "./store.js";
import {
  authUsers,
  marketSnapshots,
  monitorRuns,
  reports,
  stripeWebhookEvents,
} from "./schema.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error(
    `FinePredict integration tests: DATABASE_URL is required in the root .env.`,
  );
}
const normalizedDatabaseUrl = normalizeDatabaseUrlSslMode(databaseUrl);
const resources = createDatabaseResources(normalizedDatabaseUrl);
const userId = crypto.randomUUID();
const freeUserId = crypto.randomUUID();
const externalId = `integration-market-${crypto.randomUUID()}`;
const stripeCustomerId = `cus_${crypto.randomUUID().replaceAll("-", "")}`;

describe("Neon product persistence", () => {
  const productStore = new ProductStore(resources.database);
  const monitoringStore = new MonitoringStore(resources.database);
  const snapshotIds = new Set<string>();
  let monitorRunId: string | null = null;
  let stripeEventId: string | null = null;
  let watchlistMarketId = "";
  let comparisonReportSlug: string | null = null;

  beforeAll(async () => {
    await migrate(resources.database, { migrationsFolder: "./drizzle" });
    await resources.database.insert(authUsers).values([
      {
        email: `${userId}@example.com`,
        emailVerified: true,
        id: userId,
        name: "Integration User",
      },
      {
        email: `${freeUserId}@example.com`,
        emailVerified: true,
        id: freeUserId,
        name: "Free Integration User",
      },
    ]);
    await productStore.applyStripeSubscriptionUpdate({
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date("2026-08-18T00:00:00.000Z"),
      product: "watchlists",
      status: "active",
      stripeCustomerId,
      stripeSubscriptionId: `sub_watchlists_${crypto.randomUUID()}`,
      userId,
    });
    await productStore.applyStripeSubscriptionUpdate({
      cancelAtPeriodEnd: false,
      currentPeriodEnd: new Date("2026-08-18T00:00:00.000Z"),
      product: "developer_api",
      status: "active",
      stripeCustomerId,
      stripeSubscriptionId: `sub_api_${crypto.randomUUID()}`,
      userId,
    });
  });

  afterAll(async () => {
    try {
      await resources.database
        .delete(authUsers)
        .where(inArray(authUsers.id, [userId, freeUserId]));
      if (monitorRunId) {
        await resources.database
          .delete(monitorRuns)
          .where(eq(monitorRuns.id, monitorRunId));
      }
      for (const snapshotId of snapshotIds) {
        await resources.database
          .delete(marketSnapshots)
          .where(eq(marketSnapshots.id, snapshotId));
      }
      if (stripeEventId) {
        await resources.database
          .delete(stripeWebhookEvents)
          .where(eq(stripeWebhookEvents.eventId, stripeEventId));
      }
      if (comparisonReportSlug) {
        await resources.database
          .delete(reports)
          .where(eq(reports.slug, comparisonReportSlug));
      }
    } finally {
      await resources.close();
    }
  });

  it("enforces entitlement while creating watchlists and monitored markets", async () => {
    const watchlist = await productStore.createWatchlist(userId, "Research");
    const contract: MarketContract = {
      disputeState: null,
      endDate: "2026-12-31T23:59:00.000Z",
      externalId,
      fetchedAt: new Date().toISOString(),
      platform: "polymarket",
      resolutionSource: "https://example.com/source",
      result: null,
      rulesText: "Resolves Yes according to the official source.",
      settlementTimestamp: null,
      startDate: null,
      status: "active",
      title: "Integration market",
      url: `https://polymarket.com/event/${externalId}`,
    };
    watchlistMarketId = await productStore.addWatchlistMarket(
      userId,
      watchlist.id,
      contract,
    );

    const lists = await productStore.listWatchlists(userId);
    expect(lists[0]?.markets).toHaveLength(1);

    const freeWatchlist = await productStore.createWatchlist(
      freeUserId,
      "Free research",
    );
    await expect(
      productStore.addWatchlistMarket(freeUserId, freeWatchlist.id, contract),
    ).rejects.toThrow(/subscription is required/);
  });

  it("saves snapshots only for settlement-relevant changes", async () => {
    const base = {
      contentHash: "hash-one",
      diffLines: [],
      endDate: "2026-12-31T23:59:00.000Z",
      externalId,
      platform: "polymarket" as const,
      resolutionSource: "https://example.com/source",
      rulesText: "Original rules",
      sourceUrl: "https://polymarket.com/event/integration-market",
      title: "Integration market",
    };
    const firstId = await monitoringStore.saveSnapshotIfChanged(base);
    if (firstId) {
      snapshotIds.add(firstId);
    }
    const unchangedId = await monitoringStore.saveSnapshotIfChanged(base);
    const changedId = await monitoringStore.saveSnapshotIfChanged({
      ...base,
      contentHash: "hash-two",
      diffLines: ["- Original rules", "+ Revised rules"],
      rulesText: "Revised rules",
    });
    if (changedId) {
      snapshotIds.add(changedId);
    }

    expect(unchangedId).toBe(firstId);
    expect(changedId).not.toBe(firstId);
  });

  it("reuses a comparison report by durable source key", async () => {
    const fetchImplementation = createComparisonFetch();
    const sourceKey = `integration-comparison-${crypto.randomUUID()}`;
    const firstService = new ReportService({
      config: loadConfig({ WEB_ORIGIN: "http://localhost:5173" }),
      fetchImplementation,
      store: new NeonReportStore(resources.database),
    });
    const urls = [
      "https://kalshi.com/markets/kxtest/example?market_ticker=KXTEST-26",
      "https://polymarket.com/event/example/example-happens",
    ] as const;

    const first = await firstService.getOrCreateComparisonReport(
      sourceKey,
      urls,
    );
    comparisonReportSlug = first.report.slug;
    const requestsAfterFirstAnalysis = fetchImplementation.mock.calls.length;
    const secondService = new ReportService({
      config: loadConfig({ WEB_ORIGIN: "http://localhost:5173" }),
      fetchImplementation,
      store: new NeonReportStore(resources.database),
    });
    const second = await secondService.getOrCreateComparisonReport(
      sourceKey,
      urls,
    );

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.report.slug).toBe(first.report.slug);
    expect(fetchImplementation).toHaveBeenCalledTimes(
      requestsAfterFirstAnalysis,
    );
  });

  it("deduplicates alerts and Stripe webhook claims", async () => {
    monitorRunId = await monitoringStore.startRun(true);
    const observation = await monitoringStore.saveObservation({
      deadline: null,
      disputeState: null,
      durationMilliseconds: 12,
      error: null,
      externalId,
      monitorRunId,
      normalizedState: "open",
      platform: "polymarket",
      rawPlatformState: "active",
      resolutionSource: null,
      result: null,
      rulesHash: "hash-two",
      settlementTimestamp: null,
      snapshotId: null,
      sourceAvailability: "not_checked",
      title: "Integration market",
      watchlistMarketId,
    });
    const alertInput = {
      deduplicationKey: `integration-${crypto.randomUUID()}`,
      detail: "Exact source changed.",
      eventType: "resolution_source_changed" as const,
      marketUrl: `https://polymarket.com/event/${externalId}`,
      observationId: observation.id,
      title: "Resolution source changed",
      userId,
      watchlistMarketId,
    };
    expect(await monitoringStore.saveAlert(alertInput)).toBe(true);
    expect(await monitoringStore.saveAlert(alertInput)).toBe(false);

    stripeEventId = `evt_${crypto.randomUUID()}`;
    const claims = await Promise.all([
      productStore.claimStripeWebhook(stripeEventId, "test.event"),
      productStore.claimStripeWebhook(stripeEventId, "test.event"),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("atomically enforces developer API daily quotas", async () => {
    const apiHash = crypto.randomUUID().replaceAll("-", "");
    const apiKey = await productStore.createApiKey({
      hash: apiHash,
      name: "Integration",
      prefix: "fp_live_test…",
      scopes: ["reports:read"],
      userId,
    });
    const verified = await productStore.findApiKeyByHash(apiHash);
    expect(verified?.apiKeyId).toBe(apiKey.id);
    const keyRecord = {
      apiKeyId: apiKey.id,
      developerApiEntitled: true,
      scopes: apiKey.scopes,
      stripeCustomerId,
      userId,
    };
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        productStore.consumeApiUnit(keyRecord, 5),
      ),
    );
    expect(results.filter((value) => value.allowed)).toHaveLength(5);
  });

  it("allows free API keys with account-wide minute and daily limits", async () => {
    const firstHash = crypto.randomUUID().replaceAll("-", "");
    const secondHash = crypto.randomUUID().replaceAll("-", "");
    await productStore.createApiKey({
      hash: firstHash,
      name: "Free one",
      prefix: "fp_live_free_one…",
      scopes: ["reports:read"],
      userId: freeUserId,
    });
    await productStore.createApiKey({
      hash: secondHash,
      name: "Free two",
      prefix: "fp_live_free_two…",
      scopes: ["reports:read"],
      userId: freeUserId,
    });
    const firstKey = await productStore.findApiKeyByHash(firstHash);
    const secondKey = await productStore.findApiKeyByHash(secondHash);
    expect(firstKey?.developerApiEntitled).toBe(false);
    expect(secondKey?.developerApiEntitled).toBe(false);
    if (!firstKey || !secondKey) {
      throw new Error(`Free API keys were not available after creation.`);
    }

    const start = new Date("2026-07-18T00:00:05.000Z");
    const first = await productStore.consumeApiUnit(firstKey, 1000, start);
    const sameMinute = await productStore.consumeApiUnit(
      secondKey,
      1000,
      new Date(start.getTime() + 30_000),
    );
    expect(first.allowed).toBe(true);
    expect(sameMinute).toMatchObject({ allowed: false, reason: "minute" });

    for (let minute = 1; minute < 10; minute += 1) {
      const result = await productStore.consumeApiUnit(
        minute % 2 === 0 ? firstKey : secondKey,
        1000,
        new Date(start.getTime() + minute * 60_000),
      );
      expect(result.allowed).toBe(true);
    }
    const dailyLimit = await productStore.consumeApiUnit(
      firstKey,
      1000,
      new Date(start.getTime() + 10 * 60_000),
    );
    expect(dailyLimit).toMatchObject({ allowed: false, reason: "daily" });
    await expect(productStore.listUsage(freeUserId)).resolves.toEqual([
      {
        billableUnits: 10,
        date: "2026-07-18",
        reportedToStripeAt: null,
      },
    ]);
    await expect(productStore.listApiKeys(freeUserId)).resolves.toHaveLength(2);
    await expect(
      productStore.revokeApiKey(freeUserId, secondKey.apiKeyId),
    ).resolves.toBe(true);
    await expect(productStore.findApiKeyByHash(secondHash)).resolves.toBeNull();
  }, 15_000);

  it("permits only one advisory-locked monitor owner", async () => {
    const pool = new Pool({
      connectionString: normalizedDatabaseUrl,
      max: 2,
    });
    const first = await pool.connect();
    const second = await pool.connect();
    const lockName = `finepredict-integration-${crypto.randomUUID()}`;
    try {
      await Promise.all([first.query("begin"), second.query("begin")]);
      const firstResult = await first.query<{ acquired: boolean }>(
        `select pg_try_advisory_xact_lock(hashtext($1)) as acquired`,
        [lockName],
      );
      const secondResult = await second.query<{ acquired: boolean }>(
        `select pg_try_advisory_xact_lock(hashtext($1)) as acquired`,
        [lockName],
      );
      expect(firstResult.rows[0]?.acquired).toBe(true);
      expect(secondResult.rows[0]?.acquired).toBe(false);
    } finally {
      await Promise.all([
        first.query("rollback").catch(() => undefined),
        second.query("rollback").catch(() => undefined),
      ]);
      first.release();
      second.release();
      await pool.end();
    }
  });
});

/**
 * Creates deterministic public contract responses for durable report reuse.
 *
 * @returns Instrumented fetch implementation for one Kalshi/Polymarket pair.
 */
function createComparisonFetch(): ReturnType<typeof vi.fn<typeof fetch>> {
  return vi.fn<typeof fetch>(async (input: string | URL | Request) => {
    const url = String(input);
    if (
      url === "https://external-api.kalshi.com/trade-api/v2/markets/KXTEST-26"
    ) {
      return Response.json({
        market: {
          close_time: "2026-12-31T22:00:00Z",
          event_ticker: "KXTEST",
          open_time: "2026-01-01T00:00:00Z",
          rules_primary: "This market resolves Yes if the example happens.",
          status: "open",
          ticker: "KXTEST-26",
          title: "Will the example happen?",
        },
      });
    }
    if (
      url === "https://gamma-api.polymarket.com/markets/slug/example-happens"
    ) {
      return Response.json({
        active: true,
        closed: false,
        description: "This market resolves Yes if the example happens.",
        endDate: "2026-12-31T22:00:00Z",
        id: "poly-test",
        question: "Will the example happen?",
        slug: "example-happens",
      });
    }
    return new Response(null, { status: 404 });
  });
}
