import type { MarketObservation } from "@finepredict/shared";
import { describe, expect, it } from "vitest";

import { createMonitoringAlerts, normalizeLifecycleState } from "./diff.js";

/**
 * Creates a complete observation fixture with focused overrides.
 *
 * @param overrides - Fields changed for the current test.
 * @returns Valid observation fixture.
 */
function observation(
  overrides: Partial<MarketObservation> = {},
): MarketObservation {
  return {
    deadline: "2026-12-31T23:59:00.000Z",
    disputeState: null,
    externalId: "market-1",
    id: crypto.randomUUID(),
    normalizedState: "open",
    observedAt: new Date().toISOString(),
    platform: "kalshi",
    rawPlatformState: "active",
    resolutionSource: "Company filing",
    result: null,
    rulesHash: "hash-a",
    settlementTimestamp: null,
    snapshotId: null,
    sourceAvailability: "available",
    title: "Will it happen?",
    ...overrides,
  };
}

describe("monitoring diffs", () => {
  it("retains platform-specific raw states while mapping lifecycle values", () => {
    expect(normalizeLifecycleState("kalshi", "amended")).toBe("amended");
    expect(normalizeLifecycleState("polymarket", "challenged")).toBe(
      "disputed",
    );
    expect(normalizeLifecycleState("polymarket", "unexpected-state")).toBe(
      "unknown",
    );
  });

  it("reports concrete rule, deadline, source, and lifecycle changes", () => {
    const previous = observation();
    const current = observation({
      deadline: "2027-01-05T23:59:00.000Z",
      normalizedState: "disputed",
      rawPlatformState: "disputed",
      resolutionSource: "SEC filing",
      rulesHash: "hash-b",
    });

    expect(
      createMonitoringAlerts(current, [previous]).map((item) => item.type),
    ).toEqual([
      "rules_changed",
      "deadline_extended",
      "resolution_source_changed",
      "lifecycle_disputed",
    ]);
  });

  it("waits for three limited checks before alerting and reports recovery", () => {
    const limited = observation({ sourceAvailability: "access_limited" });
    expect(
      createMonitoringAlerts(limited, [limited]).some(
        (item) => item.type === "source_degraded",
      ),
    ).toBe(false);
    expect(
      createMonitoringAlerts(limited, [limited, limited]).some(
        (item) => item.type === "source_degraded",
      ),
    ).toBe(true);
    expect(
      createMonitoringAlerts(observation(), [limited, limited, limited]).some(
        (item) => item.type === "source_recovered",
      ),
    ).toBe(true);
  });
});
