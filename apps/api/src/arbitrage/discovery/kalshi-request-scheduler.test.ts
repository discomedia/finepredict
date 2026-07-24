import { describe, expect, it, vi } from "vitest";

import {
  calculateRetryDelayMs,
  KalshiRequestScheduler,
} from "./kalshi-request-scheduler.js";

describe("Kalshi request scheduler", () => {
  it("retries 429 responses with exponential backoff and exact attempt counts", async () => {
    const fetchImplementation = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: "too_many_requests", message: "too many requests" },
          }),
          { status: 429 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ orderbook_fp: {} }), { status: 200 }),
      );
    const waitImplementation = vi.fn(async () => undefined);
    const attemptListener = vi.fn();
    const scheduler = new KalshiRequestScheduler({
      minimumRequestStartSpacingMs: 0,
      maximumAttempts: 4,
      baseRetryDelayMs: 500,
      fetchImplementation,
      waitImplementation,
      randomImplementation: () => 0,
    });

    const result = await scheduler.requestJson(
      "https://example.com/orderbook",
      "Kalshi orderbook API",
      attemptListener,
    );

    expect(result).toEqual({ orderbook_fp: {} });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(attemptListener).toHaveBeenCalledTimes(2);
    expect(waitImplementation).toHaveBeenCalledWith(500);
  });

  it("caps deterministic exponential retry delay", () => {
    expect(calculateRetryDelayMs(1, 500, 0)).toBe(500);
    expect(calculateRetryDelayMs(2, 500, 0.5)).toBe(1_250);
    expect(calculateRetryDelayMs(10, 500, 1)).toBe(8_000);
  });
});
