import type {
  BinaryOrderBookSnapshot,
  MarketPair,
  PolymarketMarketDetails,
} from "../common/types.js";

/** A normalized direct-venue snapshot for both sides of one reviewed market pair. */
export interface DirectPairSnapshot {
  /** Pair whose venue-native books were read. */
  readonly pair: MarketPair;
  /** Kalshi binary ask ladders derived from the venue's YES and NO bids. */
  readonly kalshi: BinaryOrderBookSnapshot;
  /** Polymarket YES and NO token ask ladders. */
  readonly polymarket: BinaryOrderBookSnapshot;
  /** Time at which both direct venue requests had completed. */
  readonly collectedAtMs: number;
  /** Wall-clock duration of the combined direct fetch. */
  readonly collectionDurationMs: number;
}

/** Static venue metadata required to collect and price a live market pair. */
export interface DirectPairContext {
  /** Reviewed cross-venue market pair. */
  readonly pair: MarketPair;
  /** Polymarket token identifiers and minimum order size. */
  readonly polymarketDetails: PolymarketMarketDetails;
}

/** Persisted JSONL envelope for one normalized direct pair snapshot. */
export interface RecordedPairSnapshot {
  /** Stable record discriminator for forward-compatible replay files. */
  readonly kind: "direct_pair_snapshot";
  /** ISO time at which the record was appended. */
  readonly recordedAtIso: string;
  /** Normalized direct-venue snapshot. */
  readonly snapshot: DirectPairSnapshot;
}

/** Read-only boundary for fresh direct venue market data. */
export interface PairMarketDataSource {
  /**
   * Gets a fresh normalized book snapshot for both venues.
   *
   * @param context - Venue identifiers needed for the pair.
   * @returns A direct pair snapshot suitable for sizing or simulated arrival.
   */
  getPairSnapshot(context: DirectPairContext): Promise<DirectPairSnapshot>;
}
