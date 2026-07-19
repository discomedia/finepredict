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

  it("debounces discovery and prefills the venue-aligned URL fields", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/reports")) {
        return Response.json({ reports: [] });
      }
      const platform = new URL(url).searchParams.get("platform");
      return Response.json({
        platform,
        query: "bitcoin",
        results: [
          {
            endDate: null,
            externalId: platform === "polymarket" ? "condition-1" : "KXBTC-1",
            platform,
            subtitle: "Bitcoin event",
            title:
              platform === "polymarket"
                ? "Will Bitcoin reach $100,000?"
                : "Will Bitcoin close above $100,000?",
            url:
              platform === "polymarket"
                ? "https://polymarket.com/event/bitcoin/will-bitcoin-reach-100k"
                : "https://kalshi.com/markets/kxbtc/bitcoin/kxbtc-1",
          },
        ],
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
      name: /will bitcoin close above \$100,000/i,
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
