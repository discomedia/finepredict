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
      screen.getByRole("heading", { name: /the odds look equal/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Market URL")).toBeInTheDocument();
    expect(screen.getByText("No mystery scores")).toBeInTheDocument();
  });
});
