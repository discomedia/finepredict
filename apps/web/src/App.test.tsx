import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App, isEmbedMode } from "./App.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("renders the market analysis workflow without an opaque score", () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("heading", { name: /compare the rules/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Search markets")).toBeInTheDocument();
    expect(screen.getByLabelText("Polymarket URL")).toBeInTheDocument();
    expect(screen.getByLabelText("Kalshi URL")).toBeInTheDocument();
    expect(screen.getByText("Specific warnings")).toBeInTheDocument();
    expect(
      screen.queryByText(/contract intelligence/i),
    ).not.toBeInTheDocument();
  });

  it("prefills an extension-provided market without submitting it", () => {
    const marketUrl = "https://polymarket.com/event/will-example-happen";
    render(
      <MemoryRouter
        initialEntries={[`/?marketUrl=${encodeURIComponent(marketUrl)}`]}
      >
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("Polymarket URL")).toHaveValue(marketUrl);
    expect(
      screen.getByRole("button", { name: /compare market rules/i }),
    ).toBeDisabled();
  });

  it("prefills an extension-provided comparison without submitting it", () => {
    const polymarketUrl = "https://polymarket.com/event/will-example-happen";
    const kalshiUrl = "https://kalshi.com/markets/example/example-market";
    render(
      <MemoryRouter
        initialEntries={[
          `/?marketUrl=${encodeURIComponent(polymarketUrl)}&comparisonMarketUrl=${encodeURIComponent(kalshiUrl)}`,
        ]}
      >
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("Polymarket URL")).toHaveValue(polymarketUrl);
    expect(screen.getByLabelText("Kalshi URL")).toHaveValue(kalshiUrl);
    expect(
      screen.getByRole("button", { name: /compare market rules/i }),
    ).toBeEnabled();
  });

  it("debounces discovery and prefills the venue-aligned URL fields", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/reports")) {
        return Response.json({ reports: [] });
      }
      const polymarket = {
        endDate: null,
        externalId: "condition-1",
        platform: "polymarket",
        subtitle: "Bitcoin price in 2026",
        title: "Will Bitcoin reach $100,000?",
        url: "https://polymarket.com/event/bitcoin/will-bitcoin-reach-100k",
      };
      const kalshi = {
        endDate: null,
        externalId: "KXBTC-1",
        platform: "kalshi",
        subtitle: "Bitcoin price in 2026",
        title: "$100,000 or above",
        url: "https://kalshi.com/markets/kxbtc/bitcoin/kxbtc-1",
      };
      return Response.json({
        pairs: [{ kalshi, polymarket }],
        query: "bitcoin",
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Search markets"), {
      target: { value: "bitcoin" },
    });
    const polymarketResult = await screen.findByRole("button", {
      name: /will bitcoin reach \$100,000/i,
    });
    const kalshiResult = await screen.findByRole("button", {
      name: /\$100,000 or above/i,
    });
    fireEvent.click(polymarketResult);
    fireEvent.click(kalshiResult);

    expect(screen.getByLabelText("Polymarket URL")).toHaveValue(
      "https://polymarket.com/event/bitcoin/will-bitcoin-reach-100k",
    );
    expect(screen.getByLabelText("Kalshi URL")).toHaveValue(
      "https://kalshi.com/markets/kxbtc/bitcoin/kxbtc-1",
    );
    expect(
      screen.getByRole("button", { name: /compare market rules/i }),
    ).toBeEnabled();
  });
});

describe("isEmbedMode", () => {
  it("only enables embed chrome for the explicit flag", () => {
    expect(isEmbedMode("?embed=1")).toBe(true);
    expect(isEmbedMode("?embed=0")).toBe(false);
    expect(isEmbedMode("")).toBe(false);
  });
});
