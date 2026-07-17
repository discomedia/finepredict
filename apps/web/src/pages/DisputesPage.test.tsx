import type { DisputeCase } from "@finepredict/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { listDisputes } from "../api.js";
import { DisputesPage } from "./DisputesPage.js";

vi.mock("../api.js", () => ({ listDisputes: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DisputesPage", () => {
  it("shows source-backed disputed wording without a risk score", async () => {
    vi.mocked(listDisputes).mockResolvedValue([EXAMPLE_DISPUTE]);
    render(
      <MemoryRouter>
        <DisputesPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Example settlement case" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/official announcement/i)).toBeInTheDocument();
    expect(screen.queryByText(/risk score/i)).not.toBeInTheDocument();
  });
});

/** Published dispute fixture with exact source evidence. */
const EXAMPLE_DISPUTE: DisputeCase = {
  archivedRules: "This market resolves Yes after an official announcement.",
  checkIds: ["announcement-vs-completion"],
  disputedWording: "official announcement",
  events: [],
  externalId: "market-1",
  id: "22bd1a32-29db-41de-9d87-bc9101014bd7",
  marketUrl: "https://polymarket.com/event/example",
  outcome: "Resolved Yes",
  platform: "polymarket",
  publishedAt: "2026-07-17T00:00:00.000Z",
  reviewStatus: "published",
  slug: "example-settlement-case",
  sources: [
    {
      id: "0f296c65-627a-44ee-a283-c6d552f0b13c",
      label: "Resolution record",
      quotedText: "The proposal was disputed.",
      transactionHash: null,
      url: "https://example.com/source",
    },
  ],
  title: "Example settlement case",
  wordingTags: ["announcement"],
};
