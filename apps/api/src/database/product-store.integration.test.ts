import type { MarketContract } from "@finepredict/shared";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MonitoringStore } from "../monitoring/store.js";
import { createDatabaseResources } from "./client.js";
import { ProductStore } from "./product-store.js";
import { authUsers, subscriptions } from "./schema.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const integrationSuite = databaseUrl ? describe : describe.skip;
const resources = databaseUrl ? createDatabaseResources(databaseUrl) : null;
const userId = `integration-${crypto.randomUUID()}`;

integrationSuite("Neon product persistence", () => {
  if (!resources || !databaseUrl) {
    return;
  }
  const productStore = new ProductStore(resources.database);
  const monitoringStore = new MonitoringStore(resources.database);
  let watchlistMarketId = "";

  beforeAll(async () => {
    await migrate(resources.database, { migrationsFolder: "./drizzle" });
    await resources.database.insert(authUsers).values({
      email: `${userId}@example.com`,
      id: userId,
      name: "Integration User",
    });
    await resources.database.insert(subscriptions).values([
      { product: "watchlists", status: "active", userId },
      {
        product: "developer_api",
        status: "active",
        stripeCustomerId: `cus_${crypto.randomUUID().replaceAll("-", "")}`,
        userId,
      },
    ]);
  });

  afterAll(async () => {
    await resources.database.delete(authUsers).where(eq(authUsers.id, userId));
    await resources.close();
  });

  it("enforces entitlement while creating watchlists and monitored markets", async () => {
    const watchlist = await productStore.createWatchlist(userId, "Research");
    const contract: MarketContract = {
      disputeState: null,
      endDate: "2026-12-31T23:59:00.000Z",
      externalId: "integration-market",
      fetchedAt: new Date().toISOString(),
      platform: "polymarket",
      resolutionSource: "https://example.com/source",
      result: null,
      rulesText: "Resolves Yes according to the official source.",
      settlementTimestamp: null,
      startDate: null,
      status: "active",
      title: "Integration market",
      url: "https://polymarket.com/event/integration-market",
    };
    watchlistMarketId = await productStore.addWatchlistMarket(
      userId,
      watchlist.id,
      contract,
    );

    const lists = await productStore.listWatchlists(userId);
    expect(lists[0]?.markets).toHaveLength(1);
  });

  it("saves snapshots only for settlement-relevant changes", async () => {
    const base = {
      contentHash: "hash-one",
      diffLines: [],
      endDate: "2026-12-31T23:59:00.000Z",
      externalId: "integration-market",
      platform: "polymarket" as const,
      resolutionSource: "https://example.com/source",
      rulesText: "Original rules",
      sourceUrl: "https://polymarket.com/event/integration-market",
      title: "Integration market",
    };
    const firstId = await monitoringStore.saveSnapshotIfChanged(base);
    const unchangedId = await monitoringStore.saveSnapshotIfChanged(base);
    const changedId = await monitoringStore.saveSnapshotIfChanged({
      ...base,
      contentHash: "hash-two",
      diffLines: ["- Original rules", "+ Revised rules"],
      rulesText: "Revised rules",
    });

    expect(unchangedId).toBe(firstId);
    expect(changedId).not.toBe(firstId);
  });

  it("deduplicates alerts and Stripe webhook claims", async () => {
    const monitorRunId = await monitoringStore.startRun(true);
    const observation = await monitoringStore.saveObservation({
      deadline: null,
      disputeState: null,
      durationMilliseconds: 12,
      error: null,
      externalId: "integration-market",
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
      marketUrl: "https://polymarket.com/event/integration-market",
      observationId: observation.id,
      title: "Resolution source changed",
      userId,
      watchlistMarketId,
    };
    expect(await monitoringStore.saveAlert(alertInput)).toBe(true);
    expect(await monitoringStore.saveAlert(alertInput)).toBe(false);

    const eventId = `evt_${crypto.randomUUID()}`;
    const claims = await Promise.all([
      productStore.claimStripeWebhook(eventId, "test.event"),
      productStore.claimStripeWebhook(eventId, "test.event"),
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
      scopes: apiKey.scopes,
      stripeCustomerId: null,
      userId,
    };
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        productStore.consumeApiUnit(keyRecord, 5),
      ),
    );
    expect(results.filter((value) => value !== null)).toHaveLength(5);
  });

  it("permits only one advisory-locked monitor owner", async () => {
    const pool = new Pool({ connectionString: databaseUrl, max: 2 });
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
