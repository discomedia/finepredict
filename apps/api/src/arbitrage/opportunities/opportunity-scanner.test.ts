import { describe, expect, it } from "vitest";

import { calculateBasisRiskEconomics } from "./opportunity-scanner.js";

describe("opportunity basis-risk economics", () => {
  it("calculates the adverse-divergence break-even probability", () => {
    const economics = calculateBasisRiskEconomics(4.17, 94.5, 1.33, true);

    expect(economics.conditionalNetProfitDollars).toBe(4.17);
    expect(economics.worstCaseSettlementDivergenceLossDollars).toBeCloseTo(
      95.83,
      10,
    );
    expect(
      economics.breakEvenAdverseDivergenceProbabilityPercent100,
    ).toBeCloseTo(4.17, 10);
  });

  it("does not assign settlement-divergence loss to pure arbitrage", () => {
    const economics = calculateBasisRiskEconomics(3, 96, 1, false);

    expect(economics.worstCaseSettlementDivergenceLossDollars).toBe(0);
    expect(
      economics.breakEvenAdverseDivergenceProbabilityPercent100,
    ).toBeUndefined();
  });
});
