import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDeveloperApiCheckout,
  getCurrentAccount,
  getMarketStatus,
  getRelatedDisputes,
  listWatchlists,
  requestMagicLink,
  updateSettings,
} from "./api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authenticated API client", () => {
  it("sends Better Auth session credentials with account requests", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        user: {
          email: "trader@example.com",
          id: "user-1",
          name: "Trader",
          role: "user",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCurrentAccount()).resolves.toMatchObject({
      email: "trader@example.com",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/me",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("posts the Better Auth magic-link callback exactly", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ status: true }));
    vi.stubGlobal("fetch", fetchMock);

    await requestMagicLink(
      "trader@example.com",
      "https://finepredict.netlify.app/account",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/auth/sign-in/magic-link",
      expect.objectContaining({
        body: JSON.stringify({
          callbackURL: "https://finepredict.netlify.app/account",
          email: "trader@example.com",
        }),
        credentials: "include",
        method: "POST",
      }),
    );
  });

  it("validates watchlist response data", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ watchlists: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listWatchlists()).resolves.toEqual([]);
  });

  it("opens separate metered developer API billing", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ url: "https://checkout.stripe.com/api-session" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createDeveloperApiCheckout()).resolves.toBe(
      "https://checkout.stripe.com/api-session",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/billing/api-checkout",
      expect.objectContaining({ credentials: "include", method: "POST" }),
    );
  });

  it("loads public monitoring and related-dispute endpoints", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ observation: null }))
      .mockResolvedValueOnce(Response.json({ disputes: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getMarketStatus("polymarket", "btc market"),
    ).resolves.toBeNull();
    await expect(getRelatedDisputes("btc report")).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://localhost:3001/api/markets/polymarket/btc%20market/status",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://localhost:3001/api/reports/btc%20report/related-disputes",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("updates settings with the administrator cookie and no browser API key", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        availableModels: ["gpt-5.6-luna"],
        model: "gpt-5.6-luna",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await updateSettings("gpt-5.6-luna");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/settings",
      expect.objectContaining({
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      }),
    );
  });
});
