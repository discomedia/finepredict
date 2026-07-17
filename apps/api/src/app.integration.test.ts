import { describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { MemoryReportStore } from "./database/store.js";

/** Integration-test runtime configuration. */
const TEST_CONFIG = loadConfig({
  ADMIN_API_KEY: "integration-admin-key",
  PORT: "3001",
  WEB_ORIGIN: "http://localhost:5173",
});

/**
 * Creates a deterministic public-API fetch fake for a Polymarket event.
 *
 * @returns Fetch implementation suitable for ReportService integration tests.
 */
function createMarketFetch(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/markets/slug/")) {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
      });
    }
    if (url.includes("/events/slug/")) {
      return new Response(
        JSON.stringify({
          active: true,
          closed: false,
          description:
            "This market resolves Yes if the company officially launches the product before December 31, 2026 at 5 p.m. ET.",
          endDate: "2026-12-31T22:00:00.000Z",
          id: "pm-event-1",
          resolutionSource: "https://data.chain.link/streams/btc-usd",
          title: "Will the company launch the product?",
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );
    }
    if (url === "https://data.chain.link/streams/btc-usd") {
      return new Response(null, { status: 429 });
    }
    return new Response(null, { status: 404 });
  }) as typeof fetch;
}

describe("FinePredict API integration", () => {
  it("creates, snapshots, and reloads a public report", async () => {
    const app = createApp({
      config: TEST_CONFIG,
      fetchImplementation: createMarketFetch(),
      store: new MemoryReportStore(),
    });
    const createResponse = await request(app)
      .post("/api/reports")
      .send({ urls: ["https://polymarket.com/event/example"] })
      .expect(201);
    expect(createResponse.body.markets[0].snapshots).toHaveLength(1);
    expect(createResponse.body.markets[0].findings.length).toBeGreaterThan(0);
    expect(createResponse.body.markets[0].sourceAvailability).toBe(
      "access_limited",
    );

    const loadResponse = await request(app)
      .get(`/api/reports/${String(createResponse.body.slug)}`)
      .expect(200);
    expect(loadResponse.body.id).toBe(createResponse.body.id);
  });

  it("requires the administrator key before changing the model", async () => {
    const app = createApp({
      config: TEST_CONFIG,
      store: new MemoryReportStore(),
    });
    await request(app)
      .put("/api/settings")
      .send({ model: "gpt-5.6-terra" })
      .expect(403);
    const response = await request(app)
      .put("/api/settings")
      .set("x-admin-api-key", TEST_CONFIG.adminApiKey)
      .send({ model: "gpt-5.6-terra" })
      .expect(200);
    expect(response.body.model).toBe("gpt-5.6-terra");
  });

  it("keeps the liveness endpoint independent of report storage", async () => {
    const app = createApp({
      config: TEST_CONFIG,
      store: new MemoryReportStore(),
    });
    await request(app).get("/api/health/live").expect(200, { ok: true });
  });
});
