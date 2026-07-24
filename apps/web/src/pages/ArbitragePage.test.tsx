import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArbitragePage } from "./ArbitragePage.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ArbitragePage", () => {
  it("renders reviewed post-fee opportunity economics", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = String(input);
        if (url.includes("/api/arbitrage/opportunities?")) {
          return Response.json({
            filters: {
              reviewedOnly: true,
              minimumNetEdgeDollarsPerShare: 0.03,
              limit: 100,
              offset: 0,
            },
            count: 1,
            opportunities: [opportunityFixture()],
          });
        }
        if (url.endsWith("/api/arbitrage/summary")) {
          return Response.json({
            kalshiMarketCount: 50_000,
            polymarketMarketCount: 20_000,
            opportunityCount: 1,
            lastScanAtIso: "2026-07-24T00:00:00.000Z",
          });
        }
        if (url.endsWith("/api/arbitrage/status")) {
          return Response.json({
            running: true,
            discoveryIntervalSeconds: 3_600,
            priceRefreshIntervalSeconds: 300,
            maximumPriceRefreshPairs: 24,
            connectedClientCount: 1,
            lastPriceRefreshRun: {
              runId: "refresh-1",
              jobType: "price_refresh",
              status: "completed",
              startedAtIso: "2026-07-24T00:00:00.000Z",
              completedAtIso: "2026-07-24T00:00:01.000Z",
              externalRequestCount: 25,
              databaseWriteCount: 26,
              candidateCount: 24,
              opportunityCount: 1,
            },
          });
        }
        if (url.endsWith("/api/arbitrage/categories")) {
          return Response.json({ categories: ["entertainment"] });
        }
        return Response.json(
          { error: "Unexpected test URL." },
          { status: 404 },
        );
      }),
    );

    render(<ArbitragePage />);

    expect(
      await screen.findByRole("heading", { name: "Executable opportunities" }),
    ).toBeInTheDocument();
    expect(screen.getByText("5.0¢")).toBeInTheDocument();
    expect(screen.getByText("3.0¢")).toBeInTheDocument();
    expect(screen.getByText("$0.30")).toBeInTheDocument();
    expect(screen.getByText("70,000")).toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();
    expect(
      screen.getByText(/featured appearance differs/i),
    ).toBeInTheDocument();
  });
});

/** Minimal EventSource replacement used by the jsdom test. */
class FakeEventSource {
  /**
   * Creates a no-op event stream.
   *
   * @param _url - Ignored stream URL.
   */
  public constructor(_url: string) {}

  /**
   * Retains the EventSource listener API without emitting network events.
   *
   * @param _type - Event name.
   * @param _listener - Event callback.
   * @returns Nothing.
   */
  public addEventListener(
    _type: string,
    _listener: EventListenerOrEventListenerObject,
  ): void {}

  /**
   * Closes the no-op stream.
   *
   * @returns Nothing.
   */
  public close(): void {}
}

/**
 * Creates one compact API opportunity.
 *
 * @returns Schema-valid dashboard fixture.
 */
function opportunityFixture() {
  const market = {
    eventId: "event-1",
    eventTitle: "Billboard number-one song",
    category: "entertainment",
    status: "active",
    volume: 100,
    liquidity: 10,
  };
  return {
    opportunityId: "pair-1",
    strategy: "cross_venue_equivalent",
    status: "basis_opportunity",
    category: "entertainment",
    matchConfidence: "probable",
    relationship: "near_arbitrage",
    settlementRisks: ["Featured appearance differs between settlement rules."],
    kalshi: {
      ...market,
      venue: "kalshi",
      marketId: "KXTEST",
      question: "Will Artist have a number-one hit?",
      marketUrl: "https://kalshi.com/markets/test/test",
      outcomeLabel: "Artist",
      settlementRulesUrl: "https://example.com/rules.pdf",
    },
    polymarket: {
      ...market,
      venue: "polymarket",
      marketId: "0xtest",
      question: "Will Artist have a Billboard number-one song?",
      marketUrl: "https://polymarket.com/event/test",
      outcomeLabel: "Artist",
    },
    direction: {
      buyYesVenue: "kalshi",
      buyNoVenue: "polymarket",
    },
    executableShares: 10,
    buyYesAveragePriceDollars: 0.4,
    buyNoAveragePriceDollars: 0.55,
    grossEdgeDollarsPerShare: 0.05,
    feeDollarsPerShare: 0.02,
    grossProfitDollars: 0.5,
    feesDollars: 0.2,
    netProfitDollars: 0.3,
    conditionalNetProfitDollars: 0.3,
    worstCaseSettlementDivergenceLossDollars: 9.7,
    breakEvenAdverseDivergenceProbabilityPercent100: 3,
    netEdgeDollarsPerShare: 0.03,
    roiPercent100: 3.09,
    observedAtIso: "2026-07-24T00:00:00.000Z",
    similarityPercent100: 90,
  };
}
