import {
  ArbitrageOpportunityApiHistorySchema,
  type ArbitrageOpportunityApiHistory,
  type ArbitrageOpportunityApiHistoryPoint,
} from "@finepredict/shared";

import {
  HistoricalMarketPriceService,
  maximumHistoricalPricePoints,
  type HistoricalPriceMarketRequest,
  type HistoricalPricePoint,
  type HistoricalPriceSeries,
} from "../../markets/historical-price-history.js";
import type { NativeBinaryMarket, ScannedOpportunity } from "./types.js";

/** Maximum permitted distance between aligned venue observations. */
const MAX_ALIGNMENT_GAP_MILLISECONDS = 36 * 60 * 60 * 1_000;

/**
 * Builds an indicative pre-detection history from public venue prices.
 *
 * @param opportunity - Current scanner opportunity and its fixed direction.
 * @param detectedAtIso - First exact scanner observation timestamp, when any.
 * @param priceService - Cached batched historical-price loader.
 * @returns Validated indicative API history.
 */
export async function buildApiHistory(
  opportunity: ScannedOpportunity,
  detectedAtIso: string | undefined,
  priceService: HistoricalMarketPriceService,
): Promise<ArbitrageOpportunityApiHistory> {
  const marketRequests = getMarketRequests(opportunity);
  const series = await priceService.getHistoricalPriceSeries(marketRequests);
  const points = createIndicativePoints(opportunity, series, detectedAtIso);
  const availableCount = series.filter((item) => item.available).length;
  const availability =
    availableCount === 0
      ? "unavailable"
      : availableCount === series.length
        ? "available"
        : "partial";
  const message =
    availability === "available"
      ? null
      : availability === "partial"
        ? "Some venue history was unavailable; the indicative spread uses only aligned prices."
        : "Venue history is temporarily unavailable; exact scanner observations are still shown.";
  const sourceDirection =
    opportunity.strategy === "cross_venue_equivalent"
      ? {
          buyYesVenue: opportunity.direction.buyYesVenue,
          buyNoVenue: opportunity.direction.buyNoVenue,
        }
      : undefined;
  return ArbitrageOpportunityApiHistorySchema.parse({
    availability,
    fetchedAtIso: new Date().toISOString(),
    ...(sourceDirection ? { sourceDirection } : {}),
    message,
    points,
  });
}

/**
 * Converts native scanner market records into public-history requests.
 *
 * @param opportunity - Current scanner opportunity.
 * @returns Deduplicated native market requests.
 */
function getMarketRequests(
  opportunity: ScannedOpportunity,
): readonly HistoricalPriceMarketRequest[] {
  const markets =
    opportunity.strategy === "cross_venue_equivalent"
      ? [opportunity.kalshi, opportunity.polymarket]
      : opportunity.legs.map((leg) => leg.market);
  const unique = new Map<string, HistoricalPriceMarketRequest>();
  for (const market of markets) {
    unique.set(`${market.venue}:${market.marketId}`, {
      platform: market.venue,
      externalId: market.marketId,
      ...(market.yesTokenId ? { yesTokenId: market.yesTokenId } : {}),
      ...(market.startDateIso ? { startDateIso: market.startDateIso } : {}),
    });
  }
  return [...unique.values()];
}

/**
 * Creates aligned API-derived points and clips them before exact detection.
 *
 * @param opportunity - Current scanner opportunity.
 * @param series - Normalized public venue histories.
 * @param detectedAtIso - First exact scanner timestamp, when any.
 * @returns At most the configured API history point count.
 */
function createIndicativePoints(
  opportunity: ScannedOpportunity,
  series: readonly HistoricalPriceSeries[],
  detectedAtIso: string | undefined,
) {
  const availableSeries = series.filter(
    (item): item is HistoricalPriceSeries & { available: true } =>
      item.available && item.points.length > 0,
  );
  if (availableSeries.length === 0) {
    return [];
  }
  const byMarket = new Map(
    availableSeries.map((item) => [marketKey(item.market), item.points]),
  );
  const timestamps = [
    ...new Set(
      availableSeries.flatMap((item) =>
        item.points.map((point) => point.timestampIso),
      ),
    ),
  ]
    .sort()
    .filter((timestamp) => {
      const detectedAtMs = detectedAtIso
        ? Date.parse(detectedAtIso)
        : Number.NaN;
      return (
        !Number.isFinite(detectedAtMs) || Date.parse(timestamp) < detectedAtMs
      );
    });
  const points: ArbitrageOpportunityApiHistoryPoint[] = timestamps.flatMap(
    (timestamp): ArbitrageOpportunityApiHistoryPoint[] => {
      const timestampMs = Date.parse(timestamp);
      return opportunity.strategy === "cross_venue_equivalent"
        ? createCrossVenuePoint(opportunity, timestamp, timestampMs, byMarket)
        : createPortfolioPoint(opportunity, timestamp, timestampMs, byMarket);
    },
  );
  return downsampleIndicativePoints(points);
}

/**
 * Calculates one cross-venue indicative point using the current direction.
 *
 * @param opportunity - Current equivalent-contract opportunity.
 * @param timestampIso - Common point timestamp.
 * @param timestampMs - Common point timestamp in milliseconds.
 * @param byMarket - Historical Yes prices indexed by market identity.
 * @returns One point or an empty result when the prices cannot align.
 */
function createCrossVenuePoint(
  opportunity: Extract<
    ScannedOpportunity,
    { strategy: "cross_venue_equivalent" }
  >,
  timestampIso: string,
  timestampMs: number,
  byMarket: ReadonlyMap<string, readonly HistoricalPricePoint[]>,
) {
  const yesMarket =
    opportunity.direction.buyYesVenue === opportunity.kalshi.venue
      ? opportunity.kalshi
      : opportunity.polymarket;
  const noMarket =
    opportunity.direction.buyNoVenue === opportunity.kalshi.venue
      ? opportunity.kalshi
      : opportunity.polymarket;
  const yesPrice = findAlignedPrice(
    byMarket.get(marketKey(yesMarket)),
    timestampMs,
  );
  const noYesPrice = findAlignedPrice(
    byMarket.get(marketKey(noMarket)),
    timestampMs,
  );
  if (yesPrice === null || noYesPrice === null) {
    return [];
  }
  const noPrice = 1 - noYesPrice;
  return [
    {
      observedAtIso: timestampIso,
      buyYesVenue: opportunity.direction.buyYesVenue,
      buyNoVenue: opportunity.direction.buyNoVenue,
      buyYesAveragePriceDollars: yesPrice,
      buyNoAveragePriceDollars: noPrice,
      indicativeGrossEdgeDollarsPerShare: roundDollars(1 - yesPrice - noPrice),
    },
  ];
}

/**
 * Calculates one portfolio indicative point from all configured legs.
 *
 * @param opportunity - Current portfolio opportunity.
 * @param timestampIso - Common point timestamp.
 * @param timestampMs - Common point timestamp in milliseconds.
 * @param byMarket - Historical Yes prices indexed by market identity.
 * @returns One point or an empty result when any leg cannot align.
 */
function createPortfolioPoint(
  opportunity: Exclude<
    ScannedOpportunity,
    { strategy: "cross_venue_equivalent" }
  >,
  timestampIso: string,
  timestampMs: number,
  byMarket: ReadonlyMap<string, readonly HistoricalPricePoint[]>,
) {
  const legs = opportunity.legs.map((leg) => {
    const yesPrice = findAlignedPrice(
      byMarket.get(marketKey(leg.market)),
      timestampMs,
    );
    return yesPrice === null
      ? null
      : {
          venue: leg.market.venue,
          marketId: leg.market.marketId,
          side: leg.side,
          averagePriceDollars: leg.side === "yes" ? yesPrice : 1 - yesPrice,
        };
  });
  if (legs.some((leg) => leg === null)) {
    return [];
  }
  const resolvedLegs = legs.filter(
    (leg): leg is NonNullable<typeof leg> => leg !== null,
  );
  return [
    {
      observedAtIso: timestampIso,
      legs: resolvedLegs,
      indicativeGrossEdgeDollarsPerShare: roundDollars(
        opportunity.minimumPayoutDollarsPerShare -
          resolvedLegs.reduce(
            (total, leg) => total + leg.averagePriceDollars,
            0,
          ),
      ),
    },
  ];
}

/**
 * Finds the nearest venue price without bridging a long missing interval.
 *
 * @param points - Sorted price series.
 * @param timestampMs - Target timestamp.
 * @returns Aligned dollar price or null.
 */
function findAlignedPrice(
  points: readonly HistoricalPricePoint[] | undefined,
  timestampMs: number,
): number | null {
  if (!points || points.length === 0) {
    return null;
  }
  let nearest = points[0]!;
  let nearestDistance = Math.abs(
    Date.parse(nearest.timestampIso) - timestampMs,
  );
  for (const point of points.slice(1)) {
    const distance = Math.abs(Date.parse(point.timestampIso) - timestampMs);
    if (distance < nearestDistance) {
      nearest = point;
      nearestDistance = distance;
    }
  }
  return nearestDistance <= MAX_ALIGNMENT_GAP_MILLISECONDS
    ? nearest.yesPriceDollars
    : null;
}

/**
 * Downsamples indicative points while preserving the available range.
 *
 * @param points - Ordered indicative points.
 * @returns At most the public response maximum.
 */
function downsampleIndicativePoints<T extends { observedAtIso: string }>(
  points: readonly T[],
): T[] {
  if (points.length <= maximumHistoricalPricePoints) {
    return [...points];
  }
  return Array.from({ length: maximumHistoricalPricePoints }, (_, index) => {
    const sourceIndex = Math.round(
      (index * (points.length - 1)) / (maximumHistoricalPricePoints - 1),
    );
    return points[sourceIndex]!;
  });
}

/**
 * Removes floating-point noise from a derived dollar spread.
 *
 * @param value - Derived dollar value.
 * @returns Rounded dollar value.
 */
function roundDollars(value: number): number {
  return Number(value.toFixed(6));
}

/**
 * Creates the stable key shared by raw and opportunity market records.
 *
 * @param market - Native market.
 * @returns Venue-prefixed market key.
 */
function marketKey(
  market:
    | NativeBinaryMarket
    | HistoricalPriceMarketRequest
    | { readonly venue: string; readonly marketId: string },
): string {
  if ("platform" in market) {
    return `${market.platform}:${market.externalId}`;
  }
  return `${market.venue}:${market.marketId}`;
}
