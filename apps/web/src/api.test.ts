import { afterEach, describe, expect, it, vi } from "vitest";

import { getNeonAuthToken, requestNeonMagicLink } from "./auth.js";

import {
  createDeveloperApiCheckout,
  getCurrentAccount,
  getMarketStatus,
  getRelatedDisputes,
  listWatchlists,
  requestMagicLink,
  searchMarkets,
  updateSettings,
} from "./api.js";

vi.mock("./auth.js", () => ({
  getNeonAuthToken: vi.fn(),
  requestNeonMagicLink: vi.fn(),
  signOutNeonAccount: vi.fn(),
}));

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("authenticated API client", () => {
  it("sends a Neon Auth bearer token with account requests", async () => {
    vi.mocked(getNeonAuthToken).mockResolvedValue("neon-access-token");
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
    const requestInit = fetchMock.mock.calls[0]?.[1];
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:3001/api/me");
    expect(new Headers(requestInit?.headers).get("authorization")).toBe(
      "Bearer neon-access-token",
    );
  });

  it("requests the exact Neon Auth magic-link callback", async () => {
    await requestMagicLink(
      "trader@example.com",
      "https://finepredict.netlify.app/account",
    );

    expect(requestNeonMagicLink).toHaveBeenCalledWith(
      "trader@example.com",
      "https://finepredict.netlify.app/account",
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
    vi.mocked(getNeonAuthToken).mockResolvedValue("neon-access-token");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ url: "https://checkout.stripe.com/api-session" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(createDeveloperApiCheckout()).resolves.toBe(
      "https://checkout.stripe.com/api-session",
    );
    const requestInit = fetchMock.mock.calls[0]?.[1];
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:3001/api/billing/api-checkout",
    );
    expect(requestInit?.method).toBe("POST");
    expect(new Headers(requestInit?.headers).get("authorization")).toBe(
      "Bearer neon-access-token",
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
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://localhost:3001/api/markets/polymarket/btc%20market/status",
      "http://localhost:3001/api/reports/btc%20report/related-disputes",
    ]);
    expect(getNeonAuthToken).not.toHaveBeenCalled();
  });

  it("searches one venue with an encoded public query", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        platform: "kalshi",
        query: "Fed rates",
        results: [
          {
            endDate: null,
            externalId: "KXFED-26JUL-H0",
            platform: "kalshi",
            subtitle: "Fed decision",
            title: "Will the Fed hold rates?",
            url: "https://kalshi.com/markets/kxfed/fed-decision/kxfed-26jul-h0",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchMarkets("kalshi", "Fed rates")).resolves.toHaveLength(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:3001/api/markets/search?platform=kalshi&query=Fed+rates",
    );
    expect(getNeonAuthToken).not.toHaveBeenCalled();
  });

  it("does not attach a bearer token when no Neon session exists", async () => {
    vi.mocked(getNeonAuthToken).mockResolvedValue(null);
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

    await getCurrentAccount();

    const requestInit = fetchMock.mock.calls[0]?.[1];
    expect(new Headers(requestInit?.headers).has("authorization")).toBe(false);
  });

  it("updates settings with the administrator bearer token", async () => {
    vi.mocked(getNeonAuthToken).mockResolvedValue("neon-admin-token");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        availableModels: ["gpt-5.6-luna"],
        model: "gpt-5.6-luna",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await updateSettings("gpt-5.6-luna");
    const requestInit = fetchMock.mock.calls[0]?.[1];
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:3001/api/settings",
    );
    expect(requestInit?.method).toBe("PUT");
    expect(new Headers(requestInit?.headers).get("authorization")).toBe(
      "Bearer neon-admin-token",
    );
    expect(new Headers(requestInit?.headers).get("content-type")).toBe(
      "application/json",
    );
  });
});
