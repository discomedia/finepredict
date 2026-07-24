import { describe, expect, it, vi } from "vitest";

import { loadConfig } from "./config.js";
import { MemoryReportStore } from "./database/store.js";
import { ReportService } from "./report-service.js";

describe("ReportService comparison reuse", () => {
  it("analyzes one source-key pair once and reuses its saved report", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(
      async (input: string | URL | Request) => {
        const url = String(input);
        if (
          url ===
          "https://external-api.kalshi.com/trade-api/v2/markets/KXTEST-26"
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
          url ===
          "https://gamma-api.polymarket.com/markets/slug/example-happens"
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
      },
    );
    const service = new ReportService({
      config: loadConfig({ WEB_ORIGIN: "http://localhost:5173" }),
      fetchImplementation,
      store: new MemoryReportStore(),
    });
    const urls = [
      "https://kalshi.com/markets/kxtest/example/kxtest-26",
      "https://polymarket.com/event/example/example-happens",
    ] as const;

    const first = await service.getOrCreateComparisonReport(
      "arbitrage:pair-1",
      urls,
    );
    const requestCountAfterFirstAnalysis =
      fetchImplementation.mock.calls.length;
    const second = await service.getOrCreateComparisonReport(
      "arbitrage:pair-1",
      urls,
    );

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.report.slug).toBe(first.report.slug);
    expect(fetchImplementation).toHaveBeenCalledTimes(
      requestCountAfterFirstAnalysis,
    );
  });
});
