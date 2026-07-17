import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { requestMagicLink } from "../api.js";
import { LoginPage } from "./LoginPage.js";

vi.mock("../api.js", () => ({ requestMagicLink: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LoginPage", () => {
  it("requests a one-time email link and confirms the address", async () => {
    vi.mocked(requestMagicLink).mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "trader@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Email sign-in link" }));

    await waitFor(() =>
      expect(requestMagicLink).toHaveBeenCalledWith(
        "trader@example.com",
        `${window.location.origin}/account`,
      ),
    );
    expect(screen.getByText(/sent to trader@example.com/i)).toBeInTheDocument();
  });
});
