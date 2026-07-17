import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Countdown, formatRemainingTime } from "./Countdown.js";

describe("formatRemainingTime", () => {
  it("shows minutes and seconds for a five-minute market", () => {
    expect(formatRemainingTime(5 * 60 * 1_000)).toBe("5m 0s");
  });

  it("uses progressively coarser units for longer contracts", () => {
    expect(formatRemainingTime(90 * 60 * 1_000)).toBe("1h 30m");
    expect(formatRemainingTime(26 * 60 * 60 * 1_000)).toBe("1d 2h");
  });
});

describe("Countdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T01:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("updates a short-market countdown every second", () => {
    render(<Countdown endDate="2026-07-17T01:05:00.000Z" />);
    expect(screen.getByText(/5m 0s remaining/)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(screen.getByText(/4m 59s remaining/)).toBeInTheDocument();
  });

  it("switches to the closed state when the deadline passes", () => {
    render(<Countdown endDate="2026-07-17T01:00:01.000Z" />);

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(screen.getByText(/platform close passed/i)).toBeInTheDocument();
  });
});
