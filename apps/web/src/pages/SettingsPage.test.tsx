import type { DisputeCase } from "@finepredict/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getCurrentAccount,
  getSettings,
  listAdminDisputes,
  reviewAdminDispute,
} from "../api.js";
import { SettingsPage } from "./SettingsPage.js";

vi.mock("../api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api.js")>();
  return {
    ...actual,
    getCurrentAccount: vi.fn(),
    getSettings: vi.fn(),
    listAdminDisputes: vi.fn(),
    reviewAdminDispute: vi.fn(),
    updateSettings: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SettingsPage", () => {
  it("uses an admin session and publishes preserved dispute data without an API-key input", async () => {
    vi.mocked(getCurrentAccount).mockResolvedValue({
      email: "admin@example.com",
      id: "admin-1",
      name: "Administrator",
      role: "admin",
    });
    vi.mocked(getSettings).mockResolvedValue({
      availableModels: ["gpt-5.6-luna"],
      model: "gpt-5.6-luna",
    });
    vi.mocked(listAdminDisputes).mockResolvedValue([PENDING_DISPUTE]);
    vi.mocked(reviewAdminDispute).mockResolvedValue({
      ...PENDING_DISPUTE,
      reviewStatus: "published",
    });
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("heading", { name: "Pending source dispute" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/administrator api key/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/emergency automation/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() =>
      expect(reviewAdminDispute).toHaveBeenCalledWith(
        PENDING_DISPUTE,
        "published",
      ),
    );
    expect(
      screen.getByText("No dispute cases are awaiting review."),
    ).toBeInTheDocument();
  });
});

/** Pending administrator dispute fixture with one preserved source. */
const PENDING_DISPUTE: DisputeCase = {
  archivedRules: "The named source determines settlement.",
  checkIds: ["source-unavailable"],
  disputedWording: "if the source becomes unavailable",
  events: [],
  externalId: "market-1",
  id: "22bd1a32-29db-41de-9d87-bc9101014bd7",
  marketUrl: "https://polymarket.com/event/example",
  outcome: null,
  platform: "polymarket",
  publishedAt: null,
  reviewStatus: "pending_review",
  slug: "pending-source-dispute",
  sources: [
    {
      id: "0f296c65-627a-44ee-a283-c6d552f0b13c",
      label: "Platform resolution record",
      quotedText: "The source did not publish the measurement.",
      transactionHash: null,
      url: "https://example.com/source",
    },
  ],
  title: "Pending source dispute",
  wordingTags: ["source unavailable"],
};
