import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("managed Neon Auth browser client", () => {
  it("requests magic links and tokens from the configured branch", async () => {
    vi.stubEnv(
      "VITE_NEON_AUTH_URL",
      "https://example.neonauth.example/neondb/auth",
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ status: true }))
      .mockResolvedValueOnce(Response.json({ token: "signed-neon-jwt" }));
    vi.stubGlobal("fetch", fetchMock);
    const { getNeonAuthToken, requestNeonMagicLink } =
      await import("./auth.js");

    await requestNeonMagicLink(
      "trader@example.com",
      "https://finepredict.netlify.app/account",
    );
    await expect(getNeonAuthToken()).resolves.toBe("signed-neon-jwt");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://example.neonauth.example/neondb/auth/sign-in/magic-link",
      {
        body: JSON.stringify({
          callbackURL: "https://finepredict.netlify.app/account",
          email: "trader@example.com",
        }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://example.neonauth.example/neondb/auth/token",
      { credentials: "include" },
    );
  });

  it("returns no token when the managed session is absent", async () => {
    vi.stubEnv(
      "VITE_NEON_AUTH_URL",
      "https://example.neonauth.example/neondb/auth",
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json({ message: "Unauthorized" }, { status: 401 }),
        ),
    );
    const { getNeonAuthToken } = await import("./auth.js");

    await expect(getNeonAuthToken()).resolves.toBeNull();
  });
});
