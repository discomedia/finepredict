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
  ApiRequestError,
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
  it("offers API billing and highlights it after a 402 key response", async () => {
    vi.mocked(listApiKeys).mockResolvedValue([]);
    vi.mocked(listApiUsage).mockResolvedValue([]);
    vi.mocked(createApiKey).mockRejectedValue(
      new ApiRequestError(
        "An active developer API subscription is required.",
        402,
      ),
    );
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

    expect(
      await screen.findByText(/active developer api subscription is required/i),
    ).toBeInTheDocument();
    expect(
      container.querySelector(".api-billing-note.is-required"),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Set up API billing" }));
    await waitFor(() =>
      expect(createDeveloperApiCheckout).toHaveBeenCalledOnce(),
    );
  });
});
