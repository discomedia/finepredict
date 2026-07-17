import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { App } from "./App.js";

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
});
