import type {
  ArbitrageOpportunity,
  ArbitrageOpportunityHistoryResponse,
  ArbitrageRelationship,
  ArbitrageServiceStatus,
  ArbitrageSummary,
} from "@finepredict/shared";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Clock3,
  GitCompareArrows,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  createOrGetArbitrageComparison,
  getArbitrageOpportunityHistory,
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
        title="Arbitrage Opportunities"
        description="Executable prediction market arbitrage opportunities, post fees"
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

/** Sortable opportunity-table columns. */
type OpportunitySortKey =
  | "contracts"
  | "trade"
  | "gross"
  | "fees"
  | "net"
  | "depthProfit"
  | "expiry"
  | "updated";

/** Direction applied to the active opportunity sort. */
type SortDirection = "ascending" | "descending";

/** One sortable table-column definition. */
interface OpportunityColumn {
  /** Visible column heading. */
  readonly label: string;
  /** Stable value selector used by the sorter. */
  readonly sortKey: OpportunitySortKey;
}

const opportunityColumns: readonly OpportunityColumn[] = [
  { label: "Contracts", sortKey: "contracts" },
  { label: "Trade", sortKey: "trade" },
  { label: "Gross", sortKey: "gross" },
  { label: "Fees", sortKey: "fees" },
  { label: "Net", sortKey: "net" },
  { label: "Depth profit", sortKey: "depthProfit" },
  { label: "Expiry date", sortKey: "expiry" },
  { label: "Updated", sortKey: "updated" },
];

/**
 * Renders current opportunities in a horizontally scrollable finance table.
 *
 * @param props - Opportunity rows and current clock.
 * @returns Responsive opportunity table.
 */
function OpportunityTable({ opportunities, clockMs }: OpportunityTableProps) {
  const [sortKey, setSortKey] = useState<OpportunitySortKey>("net");
  const [sortDirection, setSortDirection] =
    useState<SortDirection>("descending");
  const sortedOpportunities = useMemo(
    () => sortOpportunities(opportunities, sortKey, sortDirection),
    [opportunities, sortDirection, sortKey],
  );

  /**
   * Selects a column or reverses the current column direction.
   *
   * @param nextSortKey - Column selected by the user.
   * @returns Nothing.
   */
  const selectSort = (nextSortKey: OpportunitySortKey): void => {
    if (nextSortKey === sortKey) {
      setSortDirection((current) =>
        current === "ascending" ? "descending" : "ascending",
      );
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection(
      nextSortKey === "contracts" || nextSortKey === "expiry"
        ? "ascending"
        : "descending",
    );
  };

  return (
    <div className="arbitrage-table-wrap">
      <table className="arbitrage-table">
        <thead>
          <tr>
            {opportunityColumns.map((column) => {
              const active = column.sortKey === sortKey;
              return (
                <th
                  key={column.sortKey}
                  aria-sort={active ? sortDirection : "none"}
                >
                  <button
                    type="button"
                    onClick={() => selectSort(column.sortKey)}
                  >
                    {column.label}
                    {active ? (
                      sortDirection === "ascending" ? (
                        <ArrowUp size={12} aria-hidden="true" />
                      ) : (
                        <ArrowDown size={12} aria-hidden="true" />
                      )
                    ) : (
                      <ArrowUpDown size={12} aria-hidden="true" />
                    )}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedOpportunities.map((opportunity) => (
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
  const navigate = useNavigate();
  const progressTimers = useRef<number[]>([]);
  const [savedComparisonSlug, setSavedComparisonSlug] = useState<string | null>(
    () => readSavedComparisonSlug(opportunity.opportunityId),
  );
  const [comparisonStatus, setComparisonStatus] = useState<string | null>(null);
  const [comparisonError, setComparisonError] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] =
    useState<ArbitrageOpportunityHistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const title = getOpportunityTitle(opportunity);
  const expiryAtIso = getNearestExpiryIso(opportunity);

  useEffect(
    () => () => {
      clearProgressTimers(progressTimers.current);
    },
    [],
  );

  /**
   * Opens a saved report or runs the idempotent server comparison workflow.
   *
   * @returns Nothing after navigation or an inline error.
   */
  const compareContracts = async (): Promise<void> => {
    if (savedComparisonSlug) {
      await navigate(`/reports/${savedComparisonSlug}`);
      return;
    }
    setComparing(true);
    setComparisonError(false);
    setComparisonStatus("Fetching current contract terms…");
    clearProgressTimers(progressTimers.current);
    progressTimers.current = [
      window.setTimeout(
        () => setComparisonStatus("Checking settlement rules and deadlines…"),
        700,
      ),
      window.setTimeout(
        () => setComparisonStatus("Preparing the comparison report…"),
        1_800,
      ),
    ];
    try {
      const result = await createOrGetArbitrageComparison(
        opportunity.opportunityId,
      );
      clearProgressTimers(progressTimers.current);
      setSavedComparisonSlug(result.slug);
      saveComparisonSlug(opportunity.opportunityId, result.slug);
      setComparisonStatus(
        result.reused
          ? "Opening the saved comparison…"
          : "Analysis complete. Opening comparison…",
      );
      await waitForStatusMessage();
      await navigate(`/reports/${result.slug}`);
    } catch (error) {
      clearProgressTimers(progressTimers.current);
      setComparisonError(true);
      setComparisonStatus(
        errorMessage(
          error,
          "FinePredict could not create this comparison report.",
        ),
      );
    } finally {
      setComparing(false);
    }
  };

  /**
   * Opens or loads the hourly scanner history for this pair.
   *
   * @returns Nothing after the history panel is ready.
   */
  const toggleHistory = async (): Promise<void> => {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setHistoryOpen(true);
    if (history || historyLoading) {
      return;
    }
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setHistory(
        await getArbitrageOpportunityHistory(opportunity.opportunityId),
      );
    } catch (error) {
      setHistoryError(
        errorMessage(error, "FinePredict could not load spread history."),
      );
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <>
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
          <div className="arbitrage-compare">
            <button
              className="secondary-button arbitrage-compare-button"
              type="button"
              aria-expanded={historyOpen}
              onClick={() => void toggleHistory()}
            >
              <Clock3 size={13} aria-hidden="true" />
              {historyOpen ? "Hide history" : "History"}
            </button>
            <button
              className={`secondary-button arbitrage-compare-button${comparing ? " is-comparing" : ""}`}
              type="button"
              disabled={comparing}
              aria-busy={comparing}
              onClick={() => void compareContracts()}
            >
              {comparing ? (
                <LoaderCircle size={13} aria-hidden="true" />
              ) : (
                <GitCompareArrows size={13} aria-hidden="true" />
              )}
              {comparing
                ? "Comparing…"
                : savedComparisonSlug
                  ? "Open comparison"
                  : "Compare"}
            </button>
            {comparisonStatus ? (
              <span
                className={
                  comparisonError
                    ? "arbitrage-compare-status error"
                    : "arbitrage-compare-status"
                }
                role={comparisonError ? "alert" : "status"}
              >
                {comparisonStatus}
              </span>
            ) : null}
          </div>
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
          value={expiryAtIso ? formatExpiryDate(expiryAtIso) : "Unknown"}
          detail={
            expiryAtIso
              ? formatTimeToExpiry(expiryAtIso, clockMs)
              : "venue date unavailable"
          }
        />
        <NumberCell
          value={relativeTime(opportunity.observedAtIso, clockMs)}
          detail={formatTimestamp(opportunity.observedAtIso)}
        />
      </tr>
      {historyOpen ? (
        <tr className="arbitrage-history-row">
          <td colSpan={8}>
            {historyLoading ? (
              <p className="arbitrage-history-message">
                Loading hourly history…
              </p>
            ) : historyError ? (
              <p className="arbitrage-history-message error" role="alert">
                {historyError}
              </p>
            ) : history ? (
              <OpportunityHistoryChart history={history} />
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * Renders hourly executable prices and spread for one scanner pair.
 *
 * @param props - Persisted hourly history.
 * @returns Accessible dual-scale SVG chart.
 */
function OpportunityHistoryChart({
  history,
}: {
  history: ArbitrageOpportunityHistoryResponse;
}) {
  const points = history.points;
  if (points.length === 0) {
    return (
      <div className="arbitrage-history-panel">
        <h3>Spread history</h3>
        <p className="arbitrage-history-message">
          The scanner has not completed an hourly observation for this pair yet.
        </p>
      </div>
    );
  }
  const dimensions = { width: 860, height: 300 };
  const detectionMs = Date.parse(points[0]!.observedAtIso);
  const originMs = history.contractOriginAtIso
    ? Date.parse(history.contractOriginAtIso)
    : detectionMs;
  const latestMs = Date.parse(points.at(-1)!.observedAtIso);
  const timeDomain = getHistoryTimeDomain(originMs, latestMs);
  const priceDomain = getHistoryPriceDomain(points);
  const spreadDomain = getHistorySpreadDomain(points);
  return (
    <div className="arbitrage-history-panel">
      <div className="arbitrage-history-heading">
        <div>
          <span className="eyebrow">Hourly scanner observations</span>
          <h3>Spread history</h3>
        </div>
        <span className="arbitrage-history-meta">
          Last observed {formatTimestamp(points.at(-1)!.observedAtIso)}
        </span>
      </div>
      <p className="arbitrage-history-intro">
        Prices are the executable YES and NO legs used by the scanner. Spread is
        shown before and after modeled fees; origin and first detection are
        marked when timestamps are available.
      </p>
      <div className="arbitrage-history-legend" aria-hidden="true">
        <span>
          <i className="yes" />
          YES price
        </span>
        <span>
          <i className="no" />
          NO price
        </span>
        <span>
          <i className="gross" />
          Gross spread
        </span>
        <span>
          <i className="net" />
          Post-fee edge
        </span>
      </div>
      <svg
        aria-label="Hourly arbitrage prices and spread history"
        className="arbitrage-history-chart"
        role="img"
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
      >
        {renderHistoryGrid(dimensions, priceDomain, spreadDomain)}
        {renderHistoryMarker("origin", originMs, timeDomain, dimensions)}
        {originMs < detectionMs
          ? renderHistoryMarker("detected", detectionMs, timeDomain, dimensions)
          : null}
        <path
          className="yes"
          d={createHistoryPath(
            points,
            dimensions,
            timeDomain,
            priceDomain,
            (point) => point.buyYesAveragePriceDollars * 100,
            12,
            156,
          )}
        />
        <path
          className="no"
          d={createHistoryPath(
            points,
            dimensions,
            timeDomain,
            priceDomain,
            (point) => point.buyNoAveragePriceDollars * 100,
            12,
            156,
          )}
        />
        <path
          className="gross"
          d={createHistoryPath(
            points,
            dimensions,
            timeDomain,
            spreadDomain,
            (point) => point.grossEdgeDollarsPerShare * 100,
            180,
            256,
          )}
        />
        <path
          className="net"
          d={createHistoryPath(
            points,
            dimensions,
            timeDomain,
            spreadDomain,
            (point) => point.netEdgeDollarsPerShare * 100,
            180,
            256,
          )}
        />
      </svg>
      <div className="arbitrage-history-axis">
        <span>{formatHistoryDate(originMs)}</span>
        <span>
          {originMs < detectionMs
            ? "First detection marked"
            : "First detection"}
        </span>
        <span>{formatHistoryDate(latestMs)}</span>
      </div>
    </div>
  );
}

/**
 * Draws grid lines and scale labels for both history panels.
 *
 * @param dimensions - SVG dimensions.
 * @param priceDomain - Price range in cents.
 * @param spreadDomain - Spread range in cents.
 * @returns SVG grid elements.
 */
function renderHistoryGrid(
  dimensions: { width: number; height: number },
  priceDomain: { minimum: number; maximum: number },
  spreadDomain: { minimum: number; maximum: number },
) {
  return [0, 0.5, 1].map((position) => (
    <g key={position}>
      <line
        className="arbitrage-history-grid"
        x1="0"
        x2={dimensions.width}
        y1={12 + position * 144}
        y2={12 + position * 144}
      />
      <line
        className="arbitrage-history-grid"
        x1="0"
        x2={dimensions.width}
        y1={180 + position * 76}
        y2={180 + position * 76}
      />
      <text x="4" y={16 + position * 144}>
        {formatHistoryCents(
          priceDomain.maximum -
            position * (priceDomain.maximum - priceDomain.minimum),
        )}
      </text>
      <text x="4" y={184 + position * 76}>
        {formatHistoryCents(
          spreadDomain.maximum -
            position * (spreadDomain.maximum - spreadDomain.minimum),
        )}
      </text>
    </g>
  ));
}

/**
 * Creates one timestamped history line.
 *
 * @param points - Hourly observations.
 * @param dimensions - SVG dimensions.
 * @param timeDomain - Shared timeline.
 * @param valueDomain - Series value range.
 * @param valueForPoint - Series selector.
 * @param top - Chart top.
 * @param bottom - Chart bottom.
 * @returns SVG path data.
 */
function createHistoryPath(
  points: ArbitrageOpportunityHistoryResponse["points"],
  dimensions: { width: number; height: number },
  timeDomain: { minimum: number; maximum: number },
  valueDomain: { minimum: number; maximum: number },
  valueForPoint: (
    point: ArbitrageOpportunityHistoryResponse["points"][number],
  ) => number,
  top: number,
  bottom: number,
): string {
  return points
    .map((point, index) => {
      const x = scaleHistoryValue(
        Date.parse(point.observedAtIso),
        timeDomain.minimum,
        timeDomain.maximum,
        0,
        dimensions.width,
      );
      const y = scaleHistoryValue(
        valueForPoint(point),
        valueDomain.minimum,
        valueDomain.maximum,
        bottom,
        top,
      );
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

/**
 * Returns a non-zero timeline range.
 *
 * @param minimum - Origin or first-observation timestamp.
 * @param maximum - Latest observation timestamp.
 * @returns Timeline range.
 */
function getHistoryTimeDomain(minimum: number, maximum: number) {
  return { minimum, maximum: maximum > minimum ? maximum : minimum + 1 };
}

/**
 * Returns a padded price range in cents.
 *
 * @param points - Hourly observations.
 * @returns Price chart range.
 */
function getHistoryPriceDomain(
  points: ArbitrageOpportunityHistoryResponse["points"],
) {
  return getPaddedHistoryDomain(
    points.flatMap((point) => [
      point.buyYesAveragePriceDollars * 100,
      point.buyNoAveragePriceDollars * 100,
    ]),
    0,
    100,
  );
}

/**
 * Returns a padded spread range in cents.
 *
 * @param points - Hourly observations.
 * @returns Spread chart range.
 */
function getHistorySpreadDomain(
  points: ArbitrageOpportunityHistoryResponse["points"],
) {
  return getPaddedHistoryDomain(
    points.flatMap((point) => [
      point.grossEdgeDollarsPerShare * 100,
      point.netEdgeDollarsPerShare * 100,
    ]),
    -100,
    100,
  );
}

/**
 * Pads and clamps one history chart range.
 *
 * @param values - Visible series values.
 * @param minimumClamp - Lower hard bound.
 * @param maximumClamp - Upper hard bound.
 * @returns Padded chart domain.
 */
function getPaddedHistoryDomain(
  values: readonly number[],
  minimumClamp: number,
  maximumClamp: number,
) {
  const minimumValue = Math.min(...values);
  const maximumValue = Math.max(...values);
  const padding = Math.max(1, (maximumValue - minimumValue) * 0.15);
  const minimum = Math.max(minimumClamp, minimumValue - padding);
  const maximum = Math.min(maximumClamp, maximumValue + padding);
  return { minimum, maximum: maximum > minimum ? maximum : minimum + 1 };
}

/**
 * Renders one vertical timeline marker.
 *
 * @param label - Marker label.
 * @param timestamp - Marker time.
 * @param timeDomain - Shared timeline.
 * @param dimensions - SVG dimensions.
 * @returns SVG marker group.
 */
function renderHistoryMarker(
  label: string,
  timestamp: number,
  timeDomain: { minimum: number; maximum: number },
  dimensions: { width: number; height: number },
) {
  const x = scaleHistoryValue(
    timestamp,
    timeDomain.minimum,
    timeDomain.maximum,
    0,
    dimensions.width,
  );
  return (
    <g key={label} className={`arbitrage-history-marker ${label}`}>
      <line x1={x} x2={x} y1="0" y2={dimensions.height - 24} />
      <text x={Math.min(dimensions.width - 72, Math.max(4, x + 4))} y="10">
        {label}
      </text>
    </g>
  );
}

/**
 * Scales one history value into an SVG coordinate.
 *
 * @param value - Source value.
 * @param inputMinimum - Source minimum.
 * @param inputMaximum - Source maximum.
 * @param outputMinimum - Target minimum.
 * @param outputMaximum - Target maximum.
 * @returns Scaled target value.
 */
function scaleHistoryValue(
  value: number,
  inputMinimum: number,
  inputMaximum: number,
  outputMinimum: number,
  outputMaximum: number,
): number {
  return (
    outputMinimum +
    ((value - inputMinimum) / (inputMaximum - inputMinimum)) *
      (outputMaximum - outputMinimum)
  );
}

/**
 * Formats a chart date in the product timezone.
 *
 * @param timestamp - Unix milliseconds.
 * @returns Short date label.
 */
function formatHistoryDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

/**
 * Formats a chart value in cents.
 *
 * @param value - Cents per share.
 * @returns Cents label.
 */
function formatHistoryCents(value: number): string {
  return `${value.toFixed(1)}¢`;
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
 * Sorts opportunities by one visible table column with stable tie-breaking.
 *
 * @param opportunities - Current filtered opportunity rows.
 * @param sortKey - Visible column selected by the user.
 * @param direction - Ascending or descending sort direction.
 * @returns Newly sorted opportunity rows.
 */
function sortOpportunities(
  opportunities: readonly ArbitrageOpportunity[],
  sortKey: OpportunitySortKey,
  direction: SortDirection,
): readonly ArbitrageOpportunity[] {
  return [...opportunities].sort((left, right) => {
    const leftValue = getSortValue(left, sortKey);
    const rightValue = getSortValue(right, sortKey);
    if (leftValue === null && rightValue !== null) {
      return 1;
    }
    if (leftValue !== null && rightValue === null) {
      return -1;
    }
    let comparison = 0;
    if (typeof leftValue === "string" && typeof rightValue === "string") {
      comparison = leftValue.localeCompare(rightValue, "en-US");
    } else if (
      typeof leftValue === "number" &&
      typeof rightValue === "number"
    ) {
      comparison = leftValue - rightValue;
    }
    if (comparison === 0) {
      comparison = left.opportunityId.localeCompare(
        right.opportunityId,
        "en-US",
      );
    }
    return direction === "ascending" ? comparison : -comparison;
  });
}

/**
 * Selects one scalar value corresponding to a visible table column.
 *
 * @param opportunity - Current opportunity row.
 * @param sortKey - Visible column identifier.
 * @returns Comparable string, number, or null for an unknown expiry.
 */
function getSortValue(
  opportunity: ArbitrageOpportunity,
  sortKey: OpportunitySortKey,
): string | number | null {
  switch (sortKey) {
    case "contracts":
      return getOpportunityTitle(opportunity).toLocaleLowerCase("en-US");
    case "trade":
      return (
        opportunity.buyYesAveragePriceDollars +
        opportunity.buyNoAveragePriceDollars
      );
    case "gross":
      return opportunity.grossEdgeDollarsPerShare;
    case "fees":
      return opportunity.feeDollarsPerShare;
    case "net":
      return opportunity.netEdgeDollarsPerShare;
    case "depthProfit":
      return opportunity.netProfitDollars;
    case "expiry": {
      const expiryAtIso = getNearestExpiryIso(opportunity);
      return expiryAtIso ? Date.parse(expiryAtIso) : null;
    }
    case "updated":
      return Date.parse(opportunity.observedAtIso);
  }
}

/**
 * Gets the concise paired-contract title used in the first column.
 *
 * @param opportunity - Current opportunity row.
 * @returns Outcome label or Kalshi proposition.
 */
function getOpportunityTitle(opportunity: ArbitrageOpportunity): string {
  return (
    opportunity.kalshi.outcomeLabel ??
    opportunity.polymarket.outcomeLabel ??
    opportunity.kalshi.question
  );
}

/**
 * Selects the nearer valid venue expiry when both legs supply dates.
 *
 * @param opportunity - Current paired opportunity.
 * @returns Nearest valid expiry timestamp, or undefined.
 */
function getNearestExpiryIso(
  opportunity: ArbitrageOpportunity,
): string | undefined {
  const expiries = [
    opportunity.kalshi.endDateIso,
    opportunity.polymarket.endDateIso,
  ].filter(
    (value): value is string =>
      value !== undefined && Number.isFinite(Date.parse(value)),
  );
  return expiries.sort(
    (left, right) => Date.parse(left) - Date.parse(right),
  )[0];
}

/**
 * Clears and removes every pending comparison-progress timer.
 *
 * @param timerIds - Mutable browser timer identifier list.
 * @returns Nothing.
 */
function clearProgressTimers(timerIds: number[]): void {
  for (const timerId of timerIds) {
    window.clearTimeout(timerId);
  }
  timerIds.splice(0, timerIds.length);
}

/**
 * Allows the final comparison status to render before route navigation.
 *
 * @returns Promise resolved after a short visual transition.
 */
function waitForStatusMessage(): Promise<void> {
  return new Promise((resolvePromise) => {
    window.setTimeout(resolvePromise, 250);
  });
}

/**
 * Reads a completed comparison slug from browser-session storage.
 *
 * @param opportunityId - Stable arbitrage opportunity identifier.
 * @returns Saved slug, or null when unavailable.
 */
function readSavedComparisonSlug(opportunityId: string): string | null {
  try {
    return window.sessionStorage.getItem(
      `finepredict:arbitrage-comparison:${opportunityId}`,
    );
  } catch {
    return null;
  }
}

/**
 * Saves a completed comparison slug for immediate client-side reuse.
 *
 * @param opportunityId - Stable arbitrage opportunity identifier.
 * @param slug - Public report slug.
 * @returns Nothing.
 */
function saveComparisonSlug(opportunityId: string, slug: string): void {
  try {
    window.sessionStorage.setItem(
      `finepredict:arbitrage-comparison:${opportunityId}`,
      slug,
    );
  } catch {
    // Server-side source-key reuse remains available when storage is blocked.
  }
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
 * Formats the displayed nearest expiry in Eastern time.
 *
 * @param value - ISO expiry timestamp.
 * @returns Short absolute date and time.
 */
function formatExpiryDate(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Formats time remaining using approximate 30-day months plus exact remainder.
 *
 * @param value - ISO expiry timestamp.
 * @param clockMs - Current client clock.
 * @returns Human-readable months, days, hours, and minutes.
 */
function formatTimeToExpiry(value: string, clockMs: number): string {
  const remainingMinutes = Math.max(
    0,
    Math.ceil((Date.parse(value) - clockMs) / 60_000),
  );
  if (remainingMinutes === 0) {
    return "Expired";
  }
  const minutesPerHour = 60;
  const hoursPerDay = 24;
  const daysPerMonth = 30;
  const totalHours = Math.floor(remainingMinutes / minutesPerHour);
  const totalDays = Math.floor(totalHours / hoursPerDay);
  const months = Math.floor(totalDays / daysPerMonth);
  const days = totalDays % daysPerMonth;
  const hours = totalHours % hoursPerDay;
  const minutes = remainingMinutes % minutesPerHour;
  return [
    ...(months > 0 ? [`${String(months)}mo`] : []),
    ...(months > 0 || days > 0 ? [`${String(days)}d`] : []),
    ...(months > 0 || days > 0 || hours > 0 ? [`${String(hours)}h`] : []),
    `${String(minutes)}m`,
  ].join(" ");
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
