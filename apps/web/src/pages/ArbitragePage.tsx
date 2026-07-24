import type {
  ArbitrageOpportunity,
  ArbitrageRelationship,
  ArbitrageServiceStatus,
  ArbitrageSummary,
} from "@finepredict/shared";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getArbitrageCategories,
  getArbitrageOpportunities,
  getArbitrageServiceStatus,
  getArbitrageSummary,
  subscribeToArbitrageUpdates,
} from "../api.js";
import { ProductHeader, errorMessage } from "../components/ProductPage.js";

/** Minimum-edge choices shown in cents per paired share. */
const minimumEdgeChoices = [1, 3, 5, 10] as const;

/** Reviewed relationship filter choices. */
const relationshipChoices: readonly {
  label: string;
  value: ArbitrageRelationship;
}[] = [
  { label: "Pure arbitrage", value: "pure_arbitrage" },
  { label: "Near arbitrage", value: "near_arbitrage" },
  { label: "Relative value", value: "relative_value" },
  { label: "Unreviewed", value: "unreviewed" },
];

/** Public read-only cross-venue opportunity dashboard. */
export function ArbitragePage() {
  const [minimumNetEdgeCents, setMinimumNetEdgeCents] = useState(3);
  const [relationship, setRelationship] = useState<
    ArbitrageRelationship | undefined
  >(undefined);
  const [category, setCategory] = useState("");
  const [reviewedOnly, setReviewedOnly] = useState(true);
  const [opportunities, setOpportunities] = useState<
    readonly ArbitrageOpportunity[]
  >([]);
  const [summary, setSummary] = useState<ArbitrageSummary | null>(null);
  const [status, setStatus] = useState<ArbitrageServiceStatus | null>(null);
  const [categories, setCategories] = useState<readonly string[]>([]);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);
  const [clockMs, setClockMs] = useState(() => Date.now());
  const reloadTimer = useRef<number | undefined>(undefined);

  /**
   * Loads the four bounded dashboard resources in parallel.
   *
   * @returns Nothing after page state updates.
   */
  const loadDashboard = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [opportunityResponse, nextSummary, nextStatus, nextCategories] =
        await Promise.all([
          getArbitrageOpportunities({
            minimumNetEdgeCents,
            ...(relationship ? { relationship } : {}),
            ...(category ? { category } : {}),
            reviewedOnly,
          }),
          getArbitrageSummary(),
          getArbitrageServiceStatus(),
          getArbitrageCategories(),
        ]);
      setOpportunities(opportunityResponse.opportunities);
      setSummary(nextSummary);
      setStatus(nextStatus);
      setCategories(nextCategories);
      setFailure(null);
    } catch (error) {
      setFailure(
        errorMessage(
          error,
          "FinePredict could not load current arbitrage opportunities.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [category, minimumNetEdgeCents, relationship, reviewedOnly]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    /**
     * Coalesces service event bursts into one bounded reload.
     *
     * @returns Nothing.
     */
    const scheduleReload = (): void => {
      if (reloadTimer.current !== undefined) {
        window.clearTimeout(reloadTimer.current);
      }
      reloadTimer.current = window.setTimeout(() => {
        reloadTimer.current = undefined;
        void loadDashboard();
      }, 400);
    };
    const unsubscribe = subscribeToArbitrageUpdates(
      scheduleReload,
      setConnected,
    );
    const fallbackInterval = window.setInterval(() => {
      void loadDashboard();
    }, 30_000);
    return () => {
      unsubscribe();
      window.clearInterval(fallbackInterval);
      if (reloadTimer.current !== undefined) {
        window.clearTimeout(reloadTimer.current);
      }
    };
  }, [loadDashboard]);

  useEffect(() => {
    const interval = window.setInterval(() => setClockMs(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const lastRun =
    status?.lastPriceRefreshRun ?? status?.lastDiscoveryRun ?? null;
  const nextRefreshSeconds = useMemo(() => {
    const completedAtIso = status?.lastPriceRefreshRun?.completedAtIso;
    if (!completedAtIso || !status) {
      return null;
    }
    return Math.max(
      0,
      Math.ceil(
        (Date.parse(completedAtIso) +
          status.priceRefreshIntervalSeconds * 1_000 -
          clockMs) /
          1_000,
      ),
    );
  }, [clockMs, status]);

  return (
    <section className="product-page arbitrage-page">
      <ProductHeader
        eyebrow="Post-fee market scanner"
        title="Arbitrage"
        description="FinePredict compares executable Kalshi and Polymarket books, models venue fees, and separates strict equivalence from settlement-basis trades."
        actions={
          <div
            className={`arbitrage-live-state${connected ? " connected" : ""}`}
            aria-live="polite"
          >
            <span className="arbitrage-live-dot" aria-hidden="true" />
            {connected ? "Live updates" : "Reconnecting"}
          </div>
        }
      />

      <div className="arbitrage-metrics" aria-label="Scanner summary">
        <Metric
          label="Matching opportunities"
          value={String(opportunities.length)}
        />
        <Metric
          label="Contracts catalogued"
          value={
            summary
              ? (
                  summary.kalshiMarketCount + summary.polymarketMarketCount
                ).toLocaleString("en-US")
              : "—"
          }
        />
        <Metric
          label="Last public requests"
          value={lastRun?.externalRequestCount.toLocaleString("en-US") ?? "—"}
        />
        <Metric
          label="Last database writes"
          value={lastRun?.databaseWriteCount.toLocaleString("en-US") ?? "—"}
        />
      </div>

      <section className="arbitrage-panel">
        <div className="arbitrage-panel-heading">
          <div>
            <span className="eyebrow">Current direct books</span>
            <h2>Executable opportunities</h2>
            <p>
              {status?.activeJob
                ? `${formatJob(status.activeJob)} is running.`
                : nextRefreshSeconds === null
                  ? "Waiting for the first price refresh."
                  : `Next bounded price refresh in ${formatDuration(nextRefreshSeconds)}.`}
            </p>
          </div>
          <button
            className="secondary-button"
            type="button"
            disabled={loading}
            onClick={() => void loadDashboard()}
          >
            <RefreshCw size={14} aria-hidden="true" />
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div className="arbitrage-filters" aria-label="Opportunity filters">
          <label>
            <span>Minimum net edge</span>
            <select
              value={minimumNetEdgeCents}
              onChange={(event) =>
                setMinimumNetEdgeCents(Number(event.target.value))
              }
            >
              {minimumEdgeChoices.map((value) => (
                <option key={value} value={value}>
                  {value}¢ per share
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Relationship</span>
            <select
              value={relationship ?? ""}
              onChange={(event) =>
                setRelationship(
                  (event.target.value || undefined) as
                    ArbitrageRelationship | undefined,
                )
              }
            >
              <option value="">All relationships</option>
              {relationshipChoices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Category</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((categoryName) => (
                <option key={categoryName} value={categoryName}>
                  {formatCategory(categoryName)}
                </option>
              ))}
            </select>
          </label>
          <label className="arbitrage-review-toggle">
            <input
              type="checkbox"
              checked={reviewedOnly}
              onChange={(event) => setReviewedOnly(event.target.checked)}
            />
            <span>Reviewed relationships only</span>
          </label>
        </div>

        {failure ? (
          <div className="product-empty-state arbitrage-error" role="alert">
            <h2>Scanner unavailable</h2>
            <p>{failure}</p>
          </div>
        ) : opportunities.length === 0 ? (
          <div className="product-empty-state">
            <h2>{loading ? "Loading current books…" : "No matching spread"}</h2>
            <p>
              FinePredict only publishes rows that remain positive after modeled
              fees and displayed book depth.
            </p>
          </div>
        ) : (
          <OpportunityTable opportunities={opportunities} clockMs={clockMs} />
        )}
        <p className="arbitrage-footnote">
          “Pure” requires reviewed settlement equivalence. Near-arbitrage and
          relative-value rows can diverge at settlement; their known basis risks
          are shown with each pair. Quotes are observations, not guaranteed
          fills or trading instructions.
        </p>
      </section>
    </section>
  );
}

/** Properties for one metric tile. */
interface MetricProps {
  label: string;
  value: string;
}

/**
 * Renders one compact scanner metric.
 *
 * @param props - Metric label and display value.
 * @returns Metric tile.
 */
function Metric({ label, value }: MetricProps) {
  return (
    <article>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

/** Properties for the opportunity table. */
interface OpportunityTableProps {
  opportunities: readonly ArbitrageOpportunity[];
  clockMs: number;
}

/**
 * Renders current opportunities in a horizontally scrollable finance table.
 *
 * @param props - Opportunity rows and current clock.
 * @returns Responsive opportunity table.
 */
function OpportunityTable({ opportunities, clockMs }: OpportunityTableProps) {
  return (
    <div className="arbitrage-table-wrap">
      <table className="arbitrage-table">
        <thead>
          <tr>
            <th>Contracts</th>
            <th>Trade</th>
            <th>Gross</th>
            <th>Fees</th>
            <th>Net</th>
            <th>Depth profit</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {opportunities.map((opportunity) => (
            <OpportunityRow
              key={opportunity.opportunityId}
              opportunity={opportunity}
              clockMs={clockMs}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Properties for one opportunity row. */
interface OpportunityRowProps {
  opportunity: ArbitrageOpportunity;
  clockMs: number;
}

/**
 * Renders one fee-aware opportunity and its settlement-risk context.
 *
 * @param props - Current opportunity and clock.
 * @returns Table row.
 */
function OpportunityRow({ opportunity, clockMs }: OpportunityRowProps) {
  const title =
    opportunity.kalshi.outcomeLabel ??
    opportunity.polymarket.outcomeLabel ??
    opportunity.kalshi.question;
  return (
    <tr>
      <td>
        <span className={`arbitrage-badge ${opportunity.relationship}`}>
          {formatRelationship(opportunity.relationship)}
        </span>
        <strong className="arbitrage-contract-title">{title}</strong>
        <div className="arbitrage-contract-links">
          <a
            href={opportunity.kalshi.marketUrl}
            target="_blank"
            rel="noreferrer"
          >
            Kalshi ↗
          </a>
          <a
            href={opportunity.polymarket.marketUrl}
            target="_blank"
            rel="noreferrer"
          >
            Polymarket ↗
          </a>
          {opportunity.kalshi.settlementRulesUrl ? (
            <a
              href={opportunity.kalshi.settlementRulesUrl}
              target="_blank"
              rel="noreferrer"
            >
              Rules ↗
            </a>
          ) : null}
        </div>
        {opportunity.settlementRisks[0] ? (
          <span className="arbitrage-risk">
            Basis risk: {opportunity.settlementRisks[0]}
          </span>
        ) : null}
      </td>
      <td>
        <span className="arbitrage-trade-leg">
          YES {formatCents(opportunity.buyYesAveragePriceDollars)}{" "}
          <em>{formatVenue(opportunity.direction.buyYesVenue)}</em>
        </span>
        <span className="arbitrage-trade-leg">
          NO {formatCents(opportunity.buyNoAveragePriceDollars)}{" "}
          <em>{formatVenue(opportunity.direction.buyNoVenue)}</em>
        </span>
      </td>
      <NumberCell
        value={formatCents(opportunity.grossEdgeDollarsPerShare)}
        detail={`${formatShares(opportunity.executableShares)} shares`}
      />
      <NumberCell
        value={`−${formatCents(opportunity.feeDollarsPerShare)}`}
        detail="modeled taker fees"
      />
      <NumberCell
        value={formatCents(opportunity.netEdgeDollarsPerShare)}
        detail={`${opportunity.roiPercent100.toFixed(2)}% ROI`}
        positive
      />
      <NumberCell
        value={formatDollars(opportunity.netProfitDollars)}
        detail="at displayed depth"
        positive
      />
      <NumberCell
        value={relativeTime(opportunity.observedAtIso, clockMs)}
        detail={formatTimestamp(opportunity.observedAtIso)}
      />
    </tr>
  );
}

/** Properties for one numeric table cell. */
interface NumberCellProps {
  value: string;
  detail: string;
  positive?: boolean;
}

/**
 * Renders a primary numeric value with compact context.
 *
 * @param props - Display value, detail, and positive styling.
 * @returns Numeric table cell.
 */
function NumberCell({ value, detail, positive = false }: NumberCellProps) {
  return (
    <td>
      <span
        className={positive ? "arbitrage-number positive" : "arbitrage-number"}
      >
        {value}
      </span>
      <span className="arbitrage-subvalue">{detail}</span>
    </td>
  );
}

/**
 * Formats a dollar-per-share value as cents.
 *
 * @param value - Dollar value.
 * @returns Cents label.
 */
function formatCents(value: number): string {
  return `${(value * 100).toFixed(1)}¢`;
}

/**
 * Formats dollars with cents.
 *
 * @param value - Dollar value.
 * @returns US-dollar label.
 */
function formatDollars(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Formats an executable share count.
 *
 * @param value - Share count.
 * @returns Compact share label.
 */
function formatShares(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Formats one settlement relationship.
 *
 * @param value - Stable relationship key.
 * @returns Human-readable label.
 */
function formatRelationship(value: ArbitrageRelationship): string {
  return (
    relationshipChoices.find((choice) => choice.value === value)?.label ?? value
  );
}

/**
 * Formats a snake-case category.
 *
 * @param value - Stable category key.
 * @returns Title-case label.
 */
function formatCategory(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

/**
 * Formats a venue identifier.
 *
 * @param value - Supported market venue.
 * @returns Display venue name.
 */
function formatVenue(value: "kalshi" | "polymarket"): string {
  return value === "kalshi" ? "Kalshi" : "Polymarket";
}

/**
 * Formats a service job key.
 *
 * @param value - Scheduler job kind.
 * @returns Human-readable job label.
 */
function formatJob(value: "discovery" | "price_refresh"): string {
  return value === "discovery" ? "Catalog discovery" : "Price refresh";
}

/**
 * Formats a short countdown.
 *
 * @param seconds - Remaining whole seconds.
 * @returns Minute-and-second duration.
 */
function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes)}:${String(remainder).padStart(2, "0")}`;
}

/**
 * Formats an observation age.
 *
 * @param value - ISO observation timestamp.
 * @param clockMs - Current client clock.
 * @returns Compact relative age.
 */
function relativeTime(value: string, clockMs: number): string {
  const seconds = Math.max(
    0,
    Math.floor((clockMs - Date.parse(value)) / 1_000),
  );
  if (seconds < 60) {
    return `${String(seconds)}s ago`;
  }
  if (seconds < 3_600) {
    return `${String(Math.floor(seconds / 60))}m ago`;
  }
  return `${String(Math.floor(seconds / 3_600))}h ago`;
}

/**
 * Formats an ISO timestamp consistently for dashboard detail.
 *
 * @param value - ISO timestamp.
 * @returns Eastern-time display string.
 */
function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
