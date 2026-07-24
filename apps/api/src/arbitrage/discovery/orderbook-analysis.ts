import type {
  ArbitrageDirection,
  ArbitrageOpportunity,
  AskLevel,
  BinaryOrderBookSnapshot,
  LegFeeModel,
  MarketPair,
} from "../common/types.js";
import { calculateLegFillCost } from "./fees.js";

/** Inputs for evaluating one aligned snapshot pair. */
export interface EvaluateSnapshotOptions {
  /** Matched cross-venue markets. */
  readonly pair: MarketPair;
  /** Kalshi historical orderbook snapshot. */
  readonly kalshiSnapshot: BinaryOrderBookSnapshot;
  /** Polymarket historical orderbook snapshot. */
  readonly polymarketSnapshot: BinaryOrderBookSnapshot;
  /** Maximum total cash committed to both legs. */
  readonly budgetDollars: number;
  /** Kalshi taker-fee model. */
  readonly kalshiFeeModel: LegFeeModel;
  /** Polymarket taker-fee model. */
  readonly polymarketFeeModel: LegFeeModel;
  /** Polymarket minimum share order. */
  readonly minimumPolymarketOrderSizeShares: number;
}

/** Cost and profit metrics for one candidate equal-share position size. */
interface SizedPositionEvaluation {
  /** Equal shares acquired on both legs. */
  readonly shares: number;
  /** Gross acquisition cost before fees. */
  readonly grossCostDollars: number;
  /** Gross acquisition cost of the YES leg. */
  readonly buyYesGrossCostDollars: number;
  /** Gross acquisition cost of the NO leg. */
  readonly buyNoGrossCostDollars: number;
  /** Modeled fee on the YES leg. */
  readonly buyYesFeeDollars: number;
  /** Modeled fee on the NO leg. */
  readonly buyNoFeeDollars: number;
  /** Modeled taker fees across both legs. */
  readonly feesDollars: number;
  /** Gross payout edge before fees. */
  readonly grossProfitDollars: number;
  /** Net payout edge after modeled fees. */
  readonly netProfitDollars: number;
  /** Total cash committed to both legs. */
  readonly cashOutlayDollars: number;
}

/**
 * Evaluates both YES/NO venue directions for one aligned snapshot pair.
 *
 * @param options - Books, fee models, budget, and pair metadata.
 * @returns Positive net opportunities after fees and depth.
 */
export function evaluateAlignedSnapshots(
  options: EvaluateSnapshotOptions,
): readonly ArbitrageOpportunity[] {
  const directions: readonly {
    direction: ArbitrageDirection;
    yesAsks: readonly AskLevel[];
    noAsks: readonly AskLevel[];
    yesFee: LegFeeModel;
    noFee: LegFeeModel;
  }[] = [
    {
      direction: { buyYesVenue: "kalshi", buyNoVenue: "polymarket" },
      yesAsks: options.kalshiSnapshot.yesAsks,
      noAsks: options.polymarketSnapshot.noAsks,
      yesFee: options.kalshiFeeModel,
      noFee: options.polymarketFeeModel,
    },
    {
      direction: { buyYesVenue: "polymarket", buyNoVenue: "kalshi" },
      yesAsks: options.polymarketSnapshot.yesAsks,
      noAsks: options.kalshiSnapshot.noAsks,
      yesFee: options.polymarketFeeModel,
      noFee: options.kalshiFeeModel,
    },
  ];
  return directions.flatMap((candidate) => {
    const opportunity = evaluateDirection(options, candidate);
    return opportunity ? [opportunity] : [];
  });
}

/**
 * Aligns each Kalshi snapshot with the closest Polymarket snapshot inside a tolerance.
 *
 * @param kalshiSnapshots - Chronological Kalshi snapshots.
 * @param polymarketSnapshots - Chronological Polymarket snapshots.
 * @param toleranceMs - Maximum absolute timestamp difference.
 * @returns Unique closest snapshot pairs.
 */
export function alignSnapshots(
  kalshiSnapshots: readonly BinaryOrderBookSnapshot[],
  polymarketSnapshots: readonly BinaryOrderBookSnapshot[],
  toleranceMs: number,
): readonly {
  readonly kalshi: BinaryOrderBookSnapshot;
  readonly polymarket: BinaryOrderBookSnapshot;
}[] {
  const aligned: {
    kalshi: BinaryOrderBookSnapshot;
    polymarket: BinaryOrderBookSnapshot;
  }[] = [];
  let polyIndex = 0;
  const usedPolyTimestamps = new Set<number>();
  for (const kalshi of kalshiSnapshots) {
    while (
      polyIndex + 1 < polymarketSnapshots.length &&
      Math.abs(
        (polymarketSnapshots[polyIndex + 1]?.timestampMs ?? Infinity) -
          kalshi.timestampMs,
      ) <=
        Math.abs(
          (polymarketSnapshots[polyIndex]?.timestampMs ?? Infinity) -
            kalshi.timestampMs,
        )
    ) {
      polyIndex += 1;
    }
    const polymarket = polymarketSnapshots[polyIndex];
    if (
      polymarket &&
      Math.abs(polymarket.timestampMs - kalshi.timestampMs) <= toleranceMs &&
      !usedPolyTimestamps.has(polymarket.timestampMs)
    ) {
      aligned.push({ kalshi, polymarket });
      usedPolyTimestamps.add(polymarket.timestampMs);
    }
  }
  return aligned;
}

/**
 * Evaluates a single venue direction and sizes it to the budget.
 *
 * @param options - Shared snapshot evaluation inputs.
 * @param candidate - Direction-specific books and fee models.
 * @returns Positive opportunity or undefined.
 */
function evaluateDirection(
  options: EvaluateSnapshotOptions,
  candidate: {
    readonly direction: ArbitrageDirection;
    readonly yesAsks: readonly AskLevel[];
    readonly noAsks: readonly AskLevel[];
    readonly yesFee: LegFeeModel;
    readonly noFee: LegFeeModel;
  },
): ArbitrageOpportunity | undefined {
  if (candidate.yesAsks.length === 0 || candidate.noAsks.length === 0) {
    return undefined;
  }
  const availableShares = Math.min(
    sumSize(candidate.yesAsks),
    sumSize(candidate.noAsks),
  );
  const maximumAffordableShares = findMaximumAffordableShares(
    candidate,
    availableShares,
    options.budgetDollars,
  );
  const candidateShares = buildCandidateShareSizes(
    candidate.yesAsks,
    candidate.noAsks,
    options.minimumPolymarketOrderSizeShares,
    maximumAffordableShares,
  );
  const best = candidateShares
    .map((shares) => evaluateSizedPosition(candidate, shares))
    .filter(
      (evaluation) =>
        evaluation.netProfitDollars > 0 &&
        evaluation.cashOutlayDollars <= options.budgetDollars + 1e-6,
    )
    .sort((left, right) => {
      const profitDifference = right.netProfitDollars - left.netProfitDollars;
      return Math.abs(profitDifference) > 1e-9
        ? profitDifference
        : left.cashOutlayDollars - right.cashOutlayDollars;
    })[0];
  if (!best) {
    return undefined;
  }
  return {
    pairId: options.pair.pairId,
    matchConfidence: options.pair.confidence,
    kalshiQuestion: options.pair.kalshi.question,
    polymarketQuestion: options.pair.polymarket.question,
    observedAtIso: new Date(
      Math.max(
        options.kalshiSnapshot.timestampMs,
        options.polymarketSnapshot.timestampMs,
      ),
    ).toISOString(),
    snapshotDifferenceSeconds:
      Math.abs(
        options.kalshiSnapshot.timestampMs -
          options.polymarketSnapshot.timestampMs,
      ) / 1_000,
    direction: candidate.direction,
    shares: round(best.shares, 4),
    grossCostDollars: round(best.grossCostDollars, 5),
    buyYesAveragePriceDollars: round(
      best.buyYesGrossCostDollars / best.shares,
      6,
    ),
    buyNoAveragePriceDollars: round(
      best.buyNoGrossCostDollars / best.shares,
      6,
    ),
    buyYesFeeDollars: round(best.buyYesFeeDollars, 5),
    buyNoFeeDollars: round(best.buyNoFeeDollars, 5),
    feesDollars: round(best.feesDollars, 5),
    grossProfitDollars: round(best.grossProfitDollars, 5),
    netProfitDollars: round(best.netProfitDollars, 5),
    roiPercent100: round(
      (best.netProfitDollars / best.cashOutlayDollars) * 100,
      3,
    ),
    budgetDollars: options.budgetDollars,
  };
}

/**
 * Finds the maximum equal-share size whose gross cost and fees fit the budget.
 *
 * @param candidate - Direction-specific orderbooks and fee models.
 * @param availableShares - Maximum depth available on both legs.
 * @param budgetDollars - Total cash budget across both legs.
 * @returns Maximum affordable share count before cent-size flooring.
 */
function findMaximumAffordableShares(
  candidate: {
    readonly yesAsks: readonly AskLevel[];
    readonly noAsks: readonly AskLevel[];
    readonly yesFee: LegFeeModel;
    readonly noFee: LegFeeModel;
  },
  availableShares: number,
  budgetDollars: number,
): number {
  let low = 0;
  let high = availableShares;
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const midpoint = (low + high) / 2;
    const evaluation = evaluateSizedPosition(candidate, midpoint);
    if (evaluation.cashOutlayDollars <= budgetDollars) {
      low = midpoint;
    } else {
      high = midpoint;
    }
  }
  return low;
}

/**
 * Builds the orderbook breakpoints at which marginal price or affordability changes.
 *
 * @param yesAsks - Ascending YES ask ladder.
 * @param noAsks - Ascending NO ask ladder.
 * @param minimumShares - Venue minimum order size.
 * @param maximumAffordableShares - Budget-constrained maximum size.
 * @returns Sorted cent-sized candidates that can contain the maximum net profit.
 */
function buildCandidateShareSizes(
  yesAsks: readonly AskLevel[],
  noAsks: readonly AskLevel[],
  minimumShares: number,
  maximumAffordableShares: number,
): readonly number[] {
  const minimumCentShares = Math.ceil(minimumShares * 100 - 1e-9) / 100;
  const maximumCentShares =
    Math.floor(maximumAffordableShares * 100 + 1e-9) / 100;
  if (maximumCentShares < minimumCentShares || maximumCentShares <= 0) {
    return [];
  }
  const candidates = new Set<number>();
  const addCandidate = (shares: number): void => {
    const floorCentShares = Math.floor(shares * 100 + 1e-9) / 100;
    for (const adjacentShares of [
      floorCentShares - 0.01,
      floorCentShares,
      floorCentShares + 0.01,
    ]) {
      const roundedShares = round(adjacentShares, 2);
      if (
        roundedShares >= minimumCentShares &&
        roundedShares <= maximumCentShares
      ) {
        candidates.add(roundedShares);
      }
    }
  };
  addCandidate(minimumCentShares);
  addCandidate(maximumCentShares);
  for (const boundary of [
    ...cumulativeShareBoundaries(yesAsks),
    ...cumulativeShareBoundaries(noAsks),
  ]) {
    addCandidate(boundary);
  }
  return [...candidates].sort((left, right) => left - right);
}

/**
 * Calculates cumulative share counts at every ask-level boundary.
 *
 * @param asks - Ascending ask ladder.
 * @returns Cumulative depth after each level.
 */
function cumulativeShareBoundaries(
  asks: readonly AskLevel[],
): readonly number[] {
  const boundaries: number[] = [];
  let cumulativeShares = 0;
  for (const level of asks) {
    cumulativeShares += level.sizeShares;
    boundaries.push(cumulativeShares);
  }
  return boundaries;
}

/**
 * Evaluates gross cost, fees, cash outlay, and net profit at one position size.
 *
 * @param candidate - Direction-specific orderbooks and fee models.
 * @param shares - Equal shares requested on both legs.
 * @returns Complete sized-position economics, with negative infinity if depth is short.
 */
function evaluateSizedPosition(
  candidate: {
    readonly yesAsks: readonly AskLevel[];
    readonly noAsks: readonly AskLevel[];
    readonly yesFee: LegFeeModel;
    readonly noFee: LegFeeModel;
  },
  shares: number,
): SizedPositionEvaluation {
  const yes = calculateLegFillCost(candidate.yesAsks, shares, candidate.yesFee);
  const no = calculateLegFillCost(candidate.noAsks, shares, candidate.noFee);
  if (yes.sharesFilled + 1e-9 < shares || no.sharesFilled + 1e-9 < shares) {
    return {
      shares,
      grossCostDollars: Infinity,
      buyYesGrossCostDollars: Infinity,
      buyNoGrossCostDollars: Infinity,
      buyYesFeeDollars: Infinity,
      buyNoFeeDollars: Infinity,
      feesDollars: Infinity,
      grossProfitDollars: -Infinity,
      netProfitDollars: -Infinity,
      cashOutlayDollars: Infinity,
    };
  }
  const grossCostDollars = yes.grossCostDollars + no.grossCostDollars;
  const feesDollars = yes.feeDollars + no.feeDollars;
  const grossProfitDollars = shares - grossCostDollars;
  const netProfitDollars = grossProfitDollars - feesDollars;
  const cashOutlayDollars = grossCostDollars + feesDollars;
  return {
    shares,
    grossCostDollars,
    buyYesGrossCostDollars: yes.grossCostDollars,
    buyNoGrossCostDollars: no.grossCostDollars,
    buyYesFeeDollars: yes.feeDollars,
    buyNoFeeDollars: no.feeDollars,
    feesDollars,
    grossProfitDollars,
    netProfitDollars,
    cashOutlayDollars,
  };
}

/**
 * Sums available shares in a ladder.
 *
 * @param levels - Price levels.
 * @returns Total available shares.
 */
function sumSize(levels: readonly AskLevel[]): number {
  return levels.reduce((total, level) => total + level.sizeShares, 0);
}

/**
 * Rounds a number to a fixed number of decimal places.
 *
 * @param value - Value to round.
 * @param decimals - Decimal places retained.
 * @returns Rounded value.
 */
function round(value: number, decimals: number): number {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}
