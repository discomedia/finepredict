# Arbitrage definitions and analysis policy

This project separates arithmetic price gaps from execution-safe arbitrage. The distinction matters because Kalshi and Polymarket can phrase similar questions while using different cutoffs, data sources, cancellation rules, or exceptional settlement procedures.

## Taxonomy

### Strict cross-venue complete-set arbitrage

Buy YES on one venue and NO on the other for the same economic proposition. If both legs fill in equal share count and both venues settle consistently, the combined position pays $1 per paired share in every binary outcome. It is strict arbitrage only when:

- the contracts are economically and legally equivalent;
- both ask ladders have sufficient depth at the modeled prices;
- purchase cost plus taker fees is below the common payout;
- venue minimum sizes and price increments are respected; and
- no unmodeled transfer, funding, or execution cost removes the edge.

### Depth-limited executable arbitrage

The strict definition above, sized through full orderbook depth. A top-of-book gap is not executable at $10 if either leg lacks sufficient quantity or the next level removes the net edge.

### Provisional cross-venue price signal

The complete-set arithmetic is positive after fees, but market equivalence comes from deterministic text matching rather than a completed settlement-rule review. The discovery report lists this as a review candidate, not risk-free profit.

### Near arbitrage

The contracts share the same ordinary settlement outcome, but a reviewed
low-probability clause can make the payouts diverge. Examples include a
different cancellation deadline, a split payout versus a tie-break, or election
winner versus the member eventually sworn in. These rows are published as
`near_arbitrage`, never as guaranteed profit.

For equal paired shares, the API reports:

- post-fee profit conditional on ordinary identical settlement;
- the conservative loss if adverse divergence makes both purchased outcomes
  lose; and
- the adverse-divergence probability that makes expected profit zero.

If conditional profit is `E` and the conservative adverse loss is `L`, the
break-even probability is `E / (E + L)`. At one paired share this normally
equals the post-fee edge in dollars; a 4.17-cent edge tolerates a 4.17%
probability of the modeled adverse divergence.

### Relative value

The propositions share an entity and economic thesis but differ materially in
scope or trigger, such as interim successor versus post-election sworn-in
officeholder. Complementary legs can still profit if the shared core outcome
settles identically, but this is a basis trade rather than arbitrage.

### Mismatch

The propositions differ in a way that invalidates the trade thesis: different
statistics, offices, competitions, entities, thresholds, or outcome
definitions. Reviewed mismatches stay in `config/pair-overrides.json` and are
excluded before direct-book requests.

### Same-venue complete set

YES and NO asks on one venue sum to less than $1 after fees. This is a valid separate category, but the current scanner is intentionally scoped to cross-venue opportunities.

## Settlement-equivalence checklist

Before adding a pair to `config/pair-overrides.json` with `verified: true`, compare:

1. The exact binary proposition and outcome orientation.
2. Measurement threshold, inclusivity, units, and rounding.
3. Event cutoff, timezone, postponement, and early-resolution rules.
4. Primary and fallback resolution sources.
5. Treatment of cancellations, replacement events, ambiguity, and unavailable data.
6. Payout behavior in exceptional or invalid-market states.

Record the review conclusion in the override `note`. Use `verified: true` only
for `pure_arbitrage`. A reviewed non-pure pair uses `verified: false` plus
`classification: "near_arbitrage"`, `"relative_value"`, or `"mismatch"` and
lists concrete `settlementRisks`. A legacy `verified: false` row without a
classification remains a hard mismatch.

### Fast-track event families

Macro releases, fixed-time price thresholds, and unambiguous winner markets are
good review priorities, but are not blanket equivalents. They may be marked
`verified: true` after an exact direct-rule comparison confirms the same event,
measurement/source, threshold and rounding, fallback/cancellation behavior, and
payout mapping. The current override registry records the rule comparison and
date for each approval. This permits paper execution now, while a future live
broker must re-fetch and compare the current rules before submission.

## Fee policy

- Kalshi quadratic taker fees use the series' live `fee_type` and `fee_multiplier`, with the documented general formula `0.07 × contracts × price × (1-price)`. The analysis rounds conservatively per modeled price-level fill.
- Kalshi `flat` series are excluded because their product-specific fee table cannot be inferred safely from the general formula alone.
- Polymarket taker fees use the current documented category coefficient in `shares × rate × price × (1-price)`. Unknown categories use the maximum documented coefficient to reduce false positives.
- Maker rebates are excluded. The discovery model assumes immediately executable taker orders.

## Historical interpretation

Oddpool historical full-depth books are sampled at 1-minute or 5-minute intervals. A displayed historical pair shows that both quotes existed near the same time; it does not prove that independent orders would have filled atomically. Snapshot tolerance, latency, partial fills, venue outages, and leg risk remain execution-layer concerns.

Authoritative references:

- [Oddpool authentication and plan access](https://docs.oddpool.com/authentication)
- [Oddpool historical Kalshi books](https://docs.oddpool.com/kalshi/orderbook)
- [Oddpool historical Polymarket books](https://docs.oddpool.com/polymarket/orderbook)
- [Kalshi fee schedule](https://kalshi.com/docs/kalshi-fee-schedule.pdf)
- [Polymarket fees](https://docs.polymarket.com/trading/fees)
