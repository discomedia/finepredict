import type {
  AskLevel,
  BinaryOrderBookSnapshot,
  LegFeeModel,
} from "../common/types.js";
import { calculateLegFillCost } from "../discovery/fees.js";
import { createDirectMarketKey } from "../market-data/direct-market-data-client.js";
import type { PortfolioCandidate, ScannedPortfolioLeg } from "./types.js";

/** Complete profitable fill for one deterministic portfolio. */
export interface PortfolioEvaluation {
  /** Equal shares acquired on every leg. */
  readonly shares: number;
  /** Filled legs with price and fee attribution. */
  readonly legs: readonly ScannedPortfolioLeg[];
  /** Gross acquisition cost. */
  readonly grossCostDollars: number;
  /** Total modeled venue fees. */
  readonly feesDollars: number;
  /** Guaranteed profit before fees. */
  readonly grossProfitDollars: number;
  /** Guaranteed profit after fees. */
  readonly netProfitDollars: number;
  /** Return on cash outlay on a scale of 100. */
  readonly roiPercent100: number;
  /** Latest source observation timestamp. */
  readonly observedAtIso: string;
}

/** Inputs shared by the N-leg depth evaluator. */
export interface EvaluatePortfolioOptions {
  /** Proof-backed candidate. */
  readonly candidate: PortfolioCandidate;
  /** Scan-wide deduplicated books. */
  readonly snapshotsByMarketKey: ReadonlyMap<string, BinaryOrderBookSnapshot>;
  /** Venue fee models keyed by `venue:marketId`. */
  readonly feeModelsByMarketKey: ReadonlyMap<string, LegFeeModel>;
  /** Maximum cash outlay. */
  readonly budgetDollars: number;
}

/**
 * Sizes an equal-share guaranteed-payoff portfolio through full ask depth.
 *
 * @param options - Candidate, shared books, fees, and budget.
 * @returns Maximum-profit positive fill, or undefined.
 */
export function evaluatePortfolio(
  options: EvaluatePortfolioOptions,
): PortfolioEvaluation | undefined {
  const prepared = options.candidate.legs.flatMap((leg) => {
    const key = createDirectMarketKey(leg.market.venue, leg.market.marketId);
    const snapshot = options.snapshotsByMarketKey.get(key);
    const feeModel = options.feeModelsByMarketKey.get(key);
    if (!snapshot || !feeModel) {
      return [];
    }
    const asks = leg.side === "yes" ? snapshot.yesAsks : snapshot.noAsks;
    return [{ leg, snapshot, feeModel, asks }];
  });
  if (
    prepared.length !== options.candidate.legs.length ||
    prepared.some((item) => item.asks.length === 0)
  ) {
    return undefined;
  }
  const availableShares = Math.min(
    ...prepared.map((item) =>
      item.asks.reduce((total, level) => total + level.sizeShares, 0),
    ),
  );
  const maximumAffordableShares = findMaximumAffordableShares(
    prepared,
    availableShares,
    options.budgetDollars,
  );
  const minimumShares = Math.max(
    ...prepared.map((item) => item.leg.market.minimumOrderSizeShares),
  );
  const candidateSizes = buildCandidateSizes(
    prepared.map((item) => item.asks),
    minimumShares,
    maximumAffordableShares,
  );
  return candidateSizes
    .map((shares) =>
      evaluateSize(options.candidate, prepared, shares, options.budgetDollars),
    )
    .filter((value): value is PortfolioEvaluation => value !== undefined)
    .sort((left, right) => right.netProfitDollars - left.netProfitDollars)[0];
}

/**
 * Evaluates one equal-share bundle size.
 *
 * @param candidate - Proof-backed portfolio.
 * @param prepared - Books and fee models for every leg.
 * @param shares - Equal requested shares.
 * @param budgetDollars - Maximum cash outlay.
 * @returns Positive evaluation, or undefined.
 */
function evaluateSize(
  candidate: PortfolioCandidate,
  prepared: readonly {
    readonly leg: PortfolioCandidate["legs"][number];
    readonly snapshot: BinaryOrderBookSnapshot;
    readonly feeModel: LegFeeModel;
    readonly asks: readonly AskLevel[];
  }[],
  shares: number,
  budgetDollars: number,
): PortfolioEvaluation | undefined {
  const fills = prepared.map((item) => ({
    item,
    fill: calculateLegFillCost(item.asks, shares, item.feeModel),
  }));
  if (fills.some(({ fill }) => fill.sharesFilled + 1e-9 < shares)) {
    return undefined;
  }
  const grossCostDollars = fills.reduce(
    (total, { fill }) => total + fill.grossCostDollars,
    0,
  );
  const feesDollars = fills.reduce(
    (total, { fill }) => total + fill.feeDollars,
    0,
  );
  const cashOutlayDollars = grossCostDollars + feesDollars;
  const grossProfitDollars =
    candidate.minimumPayoutDollarsPerShare * shares - grossCostDollars;
  const netProfitDollars = grossProfitDollars - feesDollars;
  if (netProfitDollars <= 0 || cashOutlayDollars > budgetDollars + 1e-6) {
    return undefined;
  }
  return {
    shares: round(shares, 4),
    legs: fills.map(({ item, fill }) => ({
      ...item.leg,
      shares: round(shares, 4),
      averagePriceDollars: round(fill.grossCostDollars / shares, 6),
      feeDollars: round(fill.feeDollars, 5),
    })),
    grossCostDollars: round(grossCostDollars, 5),
    feesDollars: round(feesDollars, 5),
    grossProfitDollars: round(grossProfitDollars, 5),
    netProfitDollars: round(netProfitDollars, 5),
    roiPercent100: round((netProfitDollars / cashOutlayDollars) * 100, 3),
    observedAtIso: new Date(
      Math.max(...prepared.map((item) => item.snapshot.timestampMs)),
    ).toISOString(),
  };
}

/**
 * Finds the largest bundle size inside the cash budget.
 *
 * @param prepared - Books and fees.
 * @param availableShares - Common available depth.
 * @param budgetDollars - Cash budget.
 * @returns Approximate affordable shares.
 */
function findMaximumAffordableShares(
  prepared: readonly {
    readonly asks: readonly AskLevel[];
    readonly feeModel: LegFeeModel;
  }[],
  availableShares: number,
  budgetDollars: number,
): number {
  let low = 0;
  let high = availableShares;
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const midpoint = (low + high) / 2;
    const cost = prepared.reduce((total, item) => {
      const fill = calculateLegFillCost(item.asks, midpoint, item.feeModel);
      return total + fill.grossCostDollars + fill.feeDollars;
    }, 0);
    if (cost <= budgetDollars) {
      low = midpoint;
    } else {
      high = midpoint;
    }
  }
  return low;
}

/**
 * Builds cent-share candidates at every marginal-depth boundary.
 *
 * @param ladders - Every purchased ask ladder.
 * @param minimumShares - Largest venue minimum.
 * @param maximumShares - Budget-constrained maximum.
 * @returns Sorted candidate sizes.
 */
function buildCandidateSizes(
  ladders: readonly (readonly AskLevel[])[],
  minimumShares: number,
  maximumShares: number,
): readonly number[] {
  const minimum = Math.ceil(minimumShares * 100 - 1e-9) / 100;
  const maximum = Math.floor(maximumShares * 100 + 1e-9) / 100;
  if (maximum < minimum || maximum <= 0) {
    return [];
  }
  const candidates = new Set<number>([minimum, maximum]);
  for (const ladder of ladders) {
    let cumulative = 0;
    for (const level of ladder) {
      cumulative += level.sizeShares;
      for (const adjacent of [
        cumulative - 0.01,
        cumulative,
        cumulative + 0.01,
      ]) {
        const value = round(adjacent, 2);
        if (value >= minimum && value <= maximum) {
          candidates.add(value);
        }
      }
    }
  }
  return [...candidates].sort((left, right) => left - right);
}

/**
 * Rounds a value for stable persisted economics.
 *
 * @param value - Numeric value.
 * @param decimals - Decimal places retained.
 * @returns Rounded number.
 */
function round(value: number, decimals: number): number {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}
