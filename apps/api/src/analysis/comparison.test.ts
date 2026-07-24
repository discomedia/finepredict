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

  it("accepts practically identical event contracts with paraphrased terms", () => {
    const comparison = compareContracts(
      createContract({
        endDate: "2028-01-01T00:00:00.000Z",
        rulesText: [
          "This market will resolve according to the bank that serves as the lead underwriter in the initial public offering of OpenAI.",
          "If no IPO occurs by December 31, 2027, 11:59 PM ET, this market will resolve to Other.",
          "The primary resolution source for this market will be official disclosures from OpenAI.",
          "A consensus of credible reporting may also be used.",
        ].join(" "),
        title: "Lead Bank in OpenAI's IPO?",
      }),
      createContract({
        endDate: "2028-01-01T15:00:00.000Z",
        externalId: "two",
        platform: "kalshi",
        resolutionSource: null,
        rulesText: [
          "If Goldman Sachs serves as lead-left underwriter on OpenAI's initial public offering in the United States before Jan 1, 2028, then the market resolves to Yes.",
          "If Morgan Stanley serves as lead-left underwriter on OpenAI's initial public offering in the United States before Jan 1, 2028, then the market resolves to Yes.",
          "If No Listed Underwriter serves as lead-left underwriter on OpenAI's initial public offering in the United States before Jan 1, 2028, then the market resolves to Yes.",
        ].join(" "),
        title: "Which bank will lead OpenAI's IPO?",
        url: "https://kalshi.com/markets/two",
      }),
    );

    expect(comparison.equivalentTrade).toBe(true);
    expect(comparison.conclusion).toContain("same practical outcome");
    expect(
      comparison.rows.find((row) => row.term === "Deadline")?.equivalent,
    ).toBe(true);
    expect(
      comparison.rows.find((row) => row.term === "Required event")?.equivalent,
    ).toBe(true);
    expect(
      comparison.rows.find((row) => row.term === "Resolution source")
        ?.equivalent,
    ).toBe(true);
    expect(
      comparison.rows.find((row) => row.term === "Fallback")?.equivalent,
    ).toBe(true);
  });

  it("rejects materially different deadline boundaries", () => {
    const comparison = compareContracts(
      createContract({
        rulesText:
          "This market resolves Yes if the company announces the transaction by December 31, 2026 at 5 p.m. ET.",
      }),
      createContract({
        externalId: "two",
        rulesText:
          "This market resolves Yes if the company announces the transaction before January 2, 2027.",
      }),
    );

    expect(comparison.equivalentTrade).toBe(false);
    expect(
      comparison.rows.find((row) => row.term === "Deadline")?.equivalent,
    ).toBe(false);
  });

  it("rejects explicit opposing postponement outcomes", () => {
    const comparison = compareContracts(
      createContract({
        rulesText:
          "This market resolves Yes if the company announces the transaction by December 31 at 5 p.m. ET. If the event is postponed, this market resolves to No.",
      }),
      createContract({
        externalId: "two",
        rulesText:
          "This market resolves Yes if the company announces the transaction by December 31 at 5 p.m. ET. If the event is postponed, the market remains open for the rescheduled event.",
      }),
    );

    expect(comparison.equivalentTrade).toBe(false);
    expect(
      comparison.rows.find((row) => row.term === "Postponements")?.equivalent,
    ).toBe(false);
  });
});
