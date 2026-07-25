import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { ArbitragePage } from "./ArbitragePage.js";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
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
            count: 2,
            opportunities: [opportunityFixture(), secondOpportunityFixture()],
          });
        }
        if (url.endsWith("/api/arbitrage/opportunities/pair-1/history")) {
          return Response.json({
            opportunityId: "pair-1",
            contractOriginAtIso: "2026-07-23T00:00:00.000Z",
            detectedAtIso: "2026-07-24T00:00:00.000Z",
            latestObservedAtIso: "2026-07-24T01:00:00.000Z",
            apiHistory: {
              availability: "available",
              fetchedAtIso: "2026-07-24T02:00:00.000Z",
              sourceDirection: {
                buyYesVenue: "kalshi",
                buyNoVenue: "polymarket",
              },
              message: null,
              points: [
                {
                  observedAtIso: "2026-07-23T12:00:00.000Z",
                  buyYesVenue: "kalshi",
                  buyNoVenue: "polymarket",
                  buyYesAveragePriceDollars: 0.35,
                  buyNoAveragePriceDollars: 0.52,
                  indicativeGrossEdgeDollarsPerShare: 0.13,
                },
              ],
            },
            points: [
              {
                opportunityId: "pair-1",
                observedAtIso: "2026-07-24T00:00:00.000Z",
                buyYesVenue: "kalshi",
                buyNoVenue: "polymarket",
                buyYesAveragePriceDollars: 0.4,
                buyNoAveragePriceDollars: 0.5,
                grossEdgeDollarsPerShare: 0.1,
                netEdgeDollarsPerShare: 0.09,
                roiPercent100: 9.89,
              },
              {
                opportunityId: "pair-1",
                observedAtIso: "2026-07-24T01:00:00.000Z",
                buyYesVenue: "kalshi",
                buyNoVenue: "polymarket",
                buyYesAveragePriceDollars: 0.43,
                buyNoAveragePriceDollars: 0.55,
                grossEdgeDollarsPerShare: 0.02,
                netEdgeDollarsPerShare: 0.01,
                roiPercent100: 1,
              },
            ],
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

    renderArbitragePage();

    expect(
      await screen.findByRole("heading", { name: "Executable opportunities" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Arbitrage Opportunities" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Executable prediction market arbitrage opportunities, post fees",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("5.0¢")).toBeInTheDocument();
    expect(screen.getByText("3.0¢")).toBeInTheDocument();
    expect(screen.getByText("$0.30")).toBeInTheDocument();
    expect(screen.getByText("70,000")).toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Strategy" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Outcome pools" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/featured appearance differs/i)).toHaveLength(2);
    expect(screen.getAllByText(/Dec 31, 2026/)).toHaveLength(2);

    const grossSortButton = screen.getByRole("button", { name: /Gross/i });
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Artist");
    fireEvent.click(grossSortButton);
    expect(grossSortButton.closest("th")).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(screen.getAllByRole("row")[1]).toHaveTextContent("Beta contract");
    for (const heading of [
      "Contracts",
      "Trade",
      "Gross",
      "Fees",
      "Net",
      "Depth profit",
      "Expiry date",
      "Updated",
    ]) {
      expect(
        screen.getByRole("button", { name: new RegExp(heading, "i") }),
      ).toBeInTheDocument();
    }
    fireEvent.click(screen.getAllByRole("button", { name: "History" })[1]!);
    expect(await screen.findByText("Spread history")).toBeInTheDocument();
    expect(screen.getByText("First detection")).toBeInTheDocument();
    expect(screen.getByText(/Time — Browser local \(/)).toBeInTheDocument();
    const timezoneSelect = screen.getByRole("combobox", {
      name: "History chart time zone",
    });
    fireEvent.change(timezoneSelect, { target: { value: "UTC" } });
    expect(screen.getByText("Time — UTC")).toBeInTheDocument();
    expect(
      window.localStorage.getItem("finepredict.arbitrage.historyTimezone"),
    ).toBe("UTC");
    const hitArea = screen.getByLabelText(
      "Move across the chart to inspect prices and spreads",
    );
    vi.spyOn(hitArea, "getBoundingClientRect").mockReturnValue({
      bottom: 390,
      height: 390,
      left: 0,
      right: 980,
      top: 0,
      width: 980,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.pointerMove(hitArea, { clientX: 100, clientY: 100 });
    expect(screen.getByText("Indicative API history")).toBeInTheDocument();
  });

  it("shows comparison progress and navigates to the reusable report", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    let resolveComparison: ((response: Response) => void) | undefined;
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
            kalshiMarketCount: 1,
            polymarketMarketCount: 1,
            opportunityCount: 1,
          });
        }
        if (url.endsWith("/api/arbitrage/status")) {
          return Response.json({
            running: true,
            discoveryIntervalSeconds: 3_600,
            priceRefreshIntervalSeconds: 300,
            maximumPriceRefreshPairs: 24,
            connectedClientCount: 0,
          });
        }
        if (url.endsWith("/api/arbitrage/categories")) {
          return Response.json({ categories: [] });
        }
        if (url.endsWith("/api/arbitrage/opportunities/pair-1/compare")) {
          return new Promise<Response>((resolvePromise) => {
            resolveComparison = resolvePromise;
          });
        }
        return Response.json({ error: "Unexpected URL." }, { status: 404 });
      }),
    );
    renderArbitragePage();
    const compareButton = await screen.findByRole("button", {
      name: "Compare",
    });

    fireEvent.click(compareButton);

    expect(
      screen.getByText("Fetching current contract terms…"),
    ).toBeInTheDocument();
    resolveComparison?.(
      Response.json({ reused: true, slug: "saved-comparison" }),
    );
    expect(
      await screen.findByText("Saved comparison report"),
    ).toBeInTheDocument();
    expect(
      window.sessionStorage.getItem("finepredict:arbitrage-comparison:pair-1"),
    ).toBe("saved-comparison");
  });
});

/**
 * Renders the page with its report-navigation destination.
 *
 * @returns Testing Library render result.
 */
function renderArbitragePage() {
  return render(
    <MemoryRouter initialEntries={["/arbitrage"]}>
      <Routes>
        <Route path="/arbitrage" element={<ArbitragePage />} />
        <Route
          path="/reports/:slug"
          element={<div>Saved comparison report</div>}
        />
      </Routes>
    </MemoryRouter>,
  );
}

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
      endDateIso: "2026-12-31T22:00:00.000Z",
    },
    polymarket: {
      ...market,
      venue: "polymarket",
      marketId: "0xtest",
      question: "Will Artist have a Billboard number-one song?",
      marketUrl: "https://polymarket.com/event/test",
      outcomeLabel: "Artist",
      endDateIso: "2027-01-31T22:00:00.000Z",
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

/**
 * Creates a second opportunity whose gross and net rankings differ.
 *
 * @returns Schema-valid dashboard fixture.
 */
function secondOpportunityFixture() {
  const first = opportunityFixture();
  return {
    ...first,
    opportunityId: "pair-2",
    grossEdgeDollarsPerShare: 0.09,
    feeDollarsPerShare: 0.08,
    netEdgeDollarsPerShare: 0.01,
    netProfitDollars: 0.1,
    kalshi: {
      ...first.kalshi,
      marketId: "KXTEST2",
      outcomeLabel: "Beta contract",
    },
    polymarket: {
      ...first.polymarket,
      marketId: "0xtest2",
      outcomeLabel: "Beta contract",
    },
  };
}
