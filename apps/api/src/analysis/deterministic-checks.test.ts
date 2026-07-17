import type { MarketContract } from "@finepredict/shared";
import { describe, expect, it } from "vitest";

import {
  DETERMINISTIC_CHECK_COUNT,
  runDeterministicChecks,
} from "./deterministic-checks.js";

/** Contract fixture containing multiple settlement-sensitive phrases. */
const CONTRACT: MarketContract = {
  endDate: "2026-12-31T23:59:00.000Z",
  externalId: "example",
  fetchedAt: "2026-07-17T00:00:00.000Z",
  platform: "polymarket",
  resolutionSource: null,
  rulesText:
    "This market resolves Yes if the product is officially launched before December 31 at 11:59 p.m. Consensus of credible reporting may be used if the source is unavailable. Preliminary figures will be used and later revisions will not count.",
  startDate: null,
  status: "active",
  title: "Will the product launch before December 31?",
  url: "https://polymarket.com/event/example",
};

describe("runDeterministicChecks", () => {
  it("runs more than fifteen explicit checks", () => {
    expect(DETERMINISTIC_CHECK_COUNT).toBeGreaterThanOrEqual(15);
  });

  it("returns specific findings with exact source excerpts", () => {
    const findings = runDeterministicChecks(CONTRACT);
    expect(findings.map((finding) => finding.checkId)).toEqual(
      expect.arrayContaining([
        "missing-resolution-source",
        "subjective-fallback",
        "undefined-official-trigger",
        "timezone-ambiguity",
        "revision-treatment",
      ]),
    );
    const sourceText = `${CONTRACT.title}\n\n${CONTRACT.rulesText}`;
    expect(
      findings.every((finding) => sourceText.includes(finding.quote)),
    ).toBe(true);
  });
});
