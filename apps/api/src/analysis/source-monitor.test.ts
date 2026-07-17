import { describe, expect, it, vi } from "vitest";

import { checkSourceAvailability } from "./source-monitor.js";

describe("checkSourceAvailability", () => {
  it("classifies a rate-limited Chainlink-style response as access limited", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 429 }));

    await expect(
      checkSourceAvailability(
        "https://data.chain.link/streams/btc-usd",
        fetchImplementation,
      ),
    ).resolves.toBe("access_limited");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("confirms a missing source with a GET before calling it unavailable", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));

    await expect(
      checkSourceAvailability(
        "Source: https://example.com/missing",
        fetchImplementation,
      ),
    ).resolves.toBe("confirmed_unavailable");
    expect(fetchImplementation).toHaveBeenNthCalledWith(
      2,
      "https://example.com/missing",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("does not call a network error an unavailable source", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("Timed out"));

    await expect(
      checkSourceAvailability("https://example.com/data", fetchImplementation),
    ).resolves.toBe("not_checked");
  });
});
