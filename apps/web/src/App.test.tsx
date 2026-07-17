import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { App, isEmbedMode } from "./App.js";

afterEach(cleanup);

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
    expect(screen.getByLabelText("Primary contract")).toBeInTheDocument();
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
    expect(screen.getByLabelText("Primary contract")).toHaveValue(marketUrl);
    expect(
      screen.getByRole("button", { name: /analyze fine print/i }),
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
