import type { AskLevel, LegFeeModel } from "../common/types.js";

/** Cost and fee result for filling one venue leg. */
export interface LegFillCost {
  /** Requested shares actually available in the ladder. */
  readonly sharesFilled: number;
  /** Gross price times shares. */
  readonly grossCostDollars: number;
  /** Conservative modeled taker fee. */
  readonly feeDollars: number;
}

/**
 * Infers the documented Polymarket taker-fee coefficient from market tags.
 * Unknown categories use the maximum documented coefficient to avoid false positives.
 *
 * @param tags - CLOB market tags.
 * @returns Fee coefficient used in fee = shares x rate x price x (1-price).
 */
export function inferPolymarketTakerFeeRate(tags: readonly string[]): number {
  const normalized = tags.map((tag) => tag.toLocaleLowerCase("en-US"));
  if (
    normalized.some(
      (tag) =>
        tag.includes("crypto") ||
        tag.includes("bitcoin") ||
        tag.includes("ethereum"),
    )
  ) {
    return 0.07;
  }
  if (normalized.some((tag) => tag.includes("sport"))) {
    return 0.05;
  }
  if (
    normalized.some(
      (tag) => tag.includes("geopolitic") || tag.includes("world event"),
    )
  ) {
    return 0;
  }
  if (
    normalized.some(
      (tag) =>
        tag.includes("finance") ||
        tag.includes("politic") ||
        tag.includes("mention") ||
        tag.includes("tech"),
    )
  ) {
    return 0.04;
  }
  if (
    normalized.some(
      (tag) =>
        tag.includes("economic") ||
        tag.includes("culture") ||
        tag.includes("weather"),
    )
  ) {
    return 0.05;
  }
  return 0.07;
}

/**
 * Computes gross cost and conservative taker fees through an ask ladder.
 *
 * @param asks - Ascending ask price levels.
 * @param requestedShares - Desired number of shares.
 * @param feeModel - Venue-specific fee inputs.
 * @returns Filled size, gross cost, and fees.
 */
export function calculateLegFillCost(
  asks: readonly AskLevel[],
  requestedShares: number,
  feeModel: LegFeeModel,
): LegFillCost {
  let remainingShares = requestedShares;
  let sharesFilled = 0;
  let grossCostDollars = 0;
  let feeDollars = 0;
  for (const level of asks) {
    if (remainingShares <= 1e-9) {
      break;
    }
    const levelShares = Math.min(remainingShares, level.sizeShares);
    sharesFilled += levelShares;
    remainingShares -= levelShares;
    grossCostDollars += levelShares * level.priceDollars;
    feeDollars += calculateLevelFee(levelShares, level.priceDollars, feeModel);
  }
  return { sharesFilled, grossCostDollars, feeDollars };
}

/**
 * Computes a venue fee for one modeled price-level fill.
 *
 * @param shares - Filled share count.
 * @param priceDollars - Fill price per share.
 * @param feeModel - Venue-specific fee inputs.
 * @returns Fee in dollars after venue precision rules.
 */
export function calculateLevelFee(
  shares: number,
  priceDollars: number,
  feeModel: LegFeeModel,
): number {
  if (feeModel.venue === "kalshi") {
    const schedule = feeModel.kalshiSchedule;
    if (!schedule) {
      throw new Error("Kalshi fee calculation requires a series fee schedule");
    }
    if (schedule.feeType === "flat") {
      throw new Error(
        `Kalshi flat fee schedule for ${schedule.seriesTicker} is not supported safely`,
      );
    }
    const rawFee =
      0.07 *
      schedule.feeMultiplier *
      shares *
      priceDollars *
      (1 - priceDollars);
    return Math.ceil(rawFee * 100 - 1e-9) / 100;
  }
  const rate = feeModel.polymarketTakerFeeRate;
  if (rate === undefined) {
    throw new Error("Polymarket fee calculation requires a taker fee rate");
  }
  const exponent = feeModel.polymarketFeeExponent ?? 1;
  const rawFee =
    shares * rate * (priceDollars * (1 - priceDollars)) ** exponent;
  return Math.round(rawFee * 100_000) / 100_000;
}
