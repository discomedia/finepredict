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
  createApiKey,
  createDeveloperApiCheckout,
  listApiKeys,
  listApiUsage,
} from "../api.js";
import { DeveloperPage } from "./DeveloperPage.js";

vi.mock("../api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api.js")>();
  return {
    ...actual,
    createApiKey: vi.fn(),
    createDeveloperApiCheckout: vi.fn(),
    listApiKeys: vi.fn(),
    listApiUsage: vi.fn(),
    revokeApiKey: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DeveloperPage", () => {
  it("creates a free API key and offers a paid limit upgrade", async () => {
    vi.mocked(listApiKeys).mockResolvedValue([]);
    vi.mocked(listApiUsage).mockResolvedValue([]);
    vi.mocked(createApiKey).mockResolvedValue({
      apiKey: {
        createdAt: "2026-07-18T00:00:00.000Z",
        id: "0f5fb707-9a6f-4a47-913c-4439e81561a8",
        lastUsedAt: null,
        name: "Production",
        prefix: "fp_live_test",
        revokedAt: null,
        scopes: ["reports:read"],
      },
      secret: "fp_live_test_secret",
    });
    vi.mocked(createDeveloperApiCheckout).mockRejectedValue(
      new Error("Checkout unavailable in test."),
    );
    const { container } = render(
      <MemoryRouter>
        <DeveloperPage />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "Create API key" });
    fireEvent.change(screen.getByLabelText("Key name"), {
      target: { value: "Production" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));

    expect(await screen.findByText("fp_live_test_secret")).toBeInTheDocument();
    expect(container.querySelector(".api-billing-note")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Upgrade API limits" }));
    await waitFor(() =>
      expect(createDeveloperApiCheckout).toHaveBeenCalledOnce(),
    );
  });
});
