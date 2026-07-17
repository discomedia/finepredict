import type { MarketContract } from "@finepredict/shared";
import { describe, expect, it } from "vitest";

import { compareContracts } from "./comparison.js";

/**
 * Creates a contract fixture for comparison tests.
 *
 * @param overrides - Fields that differ from the baseline fixture.
 * @returns Complete normalized contract.
 */
function createContract(overrides: Partial<MarketContract>): MarketContract {
  return {
    endDate: "2026-12-31T22:00:00.000Z",
    externalId: "one",
    fetchedAt: "2026-07-17T00:00:00.000Z",
    platform: "polymarket",
    resolutionSource: "Company statement",
    rulesText:
      "This market resolves Yes if the company publicly announces the transaction by December 31 at 5 p.m. ET.",
    startDate: null,
    status: "active",
    title: "Will the company announce the transaction?",
    url: "https://polymarket.com/event/one",
    ...overrides,
  };
}

describe("compareContracts", () => {
  it("rejects equivalence when the triggering event differs", () => {
    const comparison = compareContracts(
      createContract({}),
      createContract({
        externalId: "two",
        platform: "kalshi",
        resolutionSource: "SEC filing",
        rulesText:
          "This market resolves Yes if the transaction is completed by December 31 at 5 p.m. ET according to an SEC filing.",
        url: "https://kalshi.com/markets/two",
      }),
    );
    expect(comparison.equivalentTrade).toBe(false);
    expect(comparison.conclusion).toContain("No.");
    expect(
      comparison.rows.find((row) => row.term === "Deadline")?.left,
    ).toContain("5 p.m. ET");
  });

  it("formats metadata deadlines with an Eastern Time abbreviation", () => {
    const comparison = compareContracts(
      createContract({
        endDate: "2026-07-19T14:00:00.000Z",
        rulesText: "This contract has standard settlement terms.",
      }),
      createContract({
        endDate: "2026-07-19T14:00:00.000Z",
        externalId: "two",
        rulesText: "This contract has standard settlement terms.",
      }),
    );

    const deadline = comparison.rows.find(
      (row) => row.term === "Deadline",
    )?.left;
    expect(deadline).toContain("Jul 19, 2026");
    expect(deadline).toContain("EDT");
  });
});
