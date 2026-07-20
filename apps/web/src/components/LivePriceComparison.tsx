import type {
  AnalysedMarket,
  MarketPricePoint,
  MarketPriceSnapshot,
} from "@finepredict/shared";

/** Properties for the compact read-only market-price comparison. */
interface LivePriceComparisonProps {
  markets: AnalysedMarket[];
  prices: MarketPriceSnapshot[];
}

/** SVG dimensions used by the responsive price-history chart. */
interface ChartDimensions {
  height: number;
  width: number;
}

/**
 * Renders current public Yes/No prices and a restrained shared history chart.
 *
 * @param props - Report markets and their fresh official-API price snapshots.
 * @returns Compact live price section for a public report.
 */
export function LivePriceComparison({
  markets,
  prices,
}: LivePriceComparisonProps) {
  const availablePrices = prices.filter(
    (price) => price.availability === "available",
  );
  const chartablePrices = availablePrices.filter(
    (price) => price.history.length >= 2,
  );
  const fetchedAt = availablePrices[0]?.fetchedAt;

  return (
    <section className="report-section live-prices-section">
      <div className="section-title-row">
        <div>
          <span className="report-kicker">Live market snapshot</span>
          <h2>Venue prices, side by side</h2>
        </div>
        <span className="live-price-refresh">
          {fetchedAt ? `Updated ${formatRefreshTime(fetchedAt)}` : "Loading"}
        </span>
      </div>
      <p className="section-intro">
        Read-only public venue prices. The chart covers the recent 24 hours and
        refreshes every 30 seconds; it is not a quote, recommendation, or
        execution interface.
      </p>
      <div className="live-price-cards">
        {markets.map((market) => {
          const price = prices.find(
            (candidate) =>
              candidate.platform === market.contract.platform &&
              candidate.externalId === market.contract.externalId,
          );
          return (
            <LivePriceCard
              key={marketKey(market)}
              market={market}
              price={price}
            />
          );
        })}
      </div>
      {chartablePrices.length ? (
        <PriceHistoryChart prices={chartablePrices} />
      ) : (
        <p className="live-price-chart-empty">
          A comparable price history is not available yet.
        </p>
      )}
    </section>
  );
}

/** Properties for one venue's live-price summary card. */
interface LivePriceCardProps {
  market: AnalysedMarket;
  price: MarketPriceSnapshot | undefined;
}

/**
 * Renders a minimal current Yes/No price card without trading controls.
 *
 * @param props - Contract identity and optional current public price.
 * @returns One venue summary in the live-price section.
 */
function LivePriceCard({ market, price }: LivePriceCardProps) {
  const deltaPercent100 = price
    ? getHistoryChangePercent100(price.history)
    : null;
  return (
    <article className="live-price-card">
      <div className="live-price-card-head">
        <span className={`platform-badge platform-${market.contract.platform}`}>
          {capitalize(market.contract.platform)}
        </span>
        <span>Current public price</span>
      </div>
      {price?.availability === "available" &&
      price.yesPricePercent100 !== null ? (
        <div className="live-price-values">
          <strong>{formatPercent100(price.yesPricePercent100)}</strong>
          <span>Yes</span>
          {price.noPricePercent100 !== null ? (
            <span className="live-price-no">
              No {formatPercent100(price.noPricePercent100)}
            </span>
          ) : null}
          {deltaPercent100 !== null ? (
            <span className={deltaPercent100 >= 0 ? "price-up" : "price-down"}>
              {formatSignedPercent100(deltaPercent100)} over 24h
            </span>
          ) : null}
        </div>
      ) : (
        <p className="live-price-unavailable">
          {price?.message ?? "Loading current public price…"}
        </p>
      )}
    </article>
  );
}

/** Properties for the shared recent-price SVG chart. */
interface PriceHistoryChartProps {
  prices: MarketPriceSnapshot[];
}

/**
 * Draws a compact shared SVG chart for two public venue histories.
 *
 * @param props - Available venue price histories with at least two points each.
 * @returns Accessible price-history chart.
 */
function PriceHistoryChart({ prices }: PriceHistoryChartProps) {
  const dimensions: ChartDimensions = { height: 172, width: 760 };
  const points = prices.flatMap((price) => price.history);
  const timeDomain = getTimeDomain(points);
  const priceDomain = getPriceDomain(points);
  const colors: Record<MarketPriceSnapshot["platform"], string> = {
    kalshi: "#167553",
    polymarket: "#3158bf",
  };
  return (
    <figure className="price-history-figure">
      <div className="price-history-legend">
        {prices.map((price) => (
          <span key={`${price.platform}:${price.externalId}`}>
            <i style={{ background: colors[price.platform] }} />
            {capitalize(price.platform)}
          </span>
        ))}
      </div>
      <svg
        aria-label="Recent Yes-price history by venue"
        className="price-history-chart"
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
      >
        {[0, 0.5, 1].map((position) => (
          <line
            key={position}
            stroke="currentColor"
            strokeDasharray="3 5"
            x1="0"
            x2={dimensions.width}
            y1={position * (dimensions.height - 24) + 6}
            y2={position * (dimensions.height - 24) + 6}
          />
        ))}
        {prices.map((price) => (
          <path
            d={createChartPath(
              price.history,
              dimensions,
              timeDomain,
              priceDomain,
            )}
            fill="none"
            key={`${price.platform}:${price.externalId}`}
            stroke={colors[price.platform]}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3"
          />
        ))}
      </svg>
      <figcaption>
        <span>{formatPercent100(priceDomain.maximum)}</span>
        <span>24h ago</span>
        <span>Now</span>
        <span>{formatPercent100(priceDomain.minimum)}</span>
      </figcaption>
    </figure>
  );
}

/**
 * Creates an SVG path from timestamped public price points.
 *
 * @param points - One venue's valid price history.
 * @param dimensions - Fixed SVG width and height.
 * @param timeDomain - Shared earliest and latest point timestamps.
 * @param priceDomain - Shared visible minimum and maximum price values.
 * @returns SVG path data for the price series.
 */
function createChartPath(
  points: MarketPricePoint[],
  dimensions: ChartDimensions,
  timeDomain: { maximum: number; minimum: number },
  priceDomain: { maximum: number; minimum: number },
): string {
  return points
    .map((point, index) => {
      const timestamp = new Date(point.timestamp).getTime();
      const x = scaleValue(
        timestamp,
        timeDomain.minimum,
        timeDomain.maximum,
        0,
        dimensions.width,
      );
      const y = scaleValue(
        point.yesPricePercent100,
        priceDomain.minimum,
        priceDomain.maximum,
        dimensions.height - 18,
        6,
      );
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

/**
 * Returns a shared time domain covering all chart points.
 *
 * @param points - All visible price observations.
 * @returns Minimum and maximum Unix-millisecond timestamps.
 */
function getTimeDomain(points: MarketPricePoint[]): {
  maximum: number;
  minimum: number;
} {
  const values = points.map((point) => new Date(point.timestamp).getTime());
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return maximum > minimum
    ? { maximum, minimum }
    : { maximum: minimum + 1, minimum };
}

/**
 * Returns a padded shared probability domain to preserve meaningful line movement.
 *
 * @param points - All visible price observations.
 * @returns Clamped percentage-scale bounds for the chart.
 */
function getPriceDomain(points: MarketPricePoint[]): {
  maximum: number;
  minimum: number;
} {
  const minimumValue = Math.min(
    ...points.map((point) => point.yesPricePercent100),
  );
  const maximumValue = Math.max(
    ...points.map((point) => point.yesPricePercent100),
  );
  const padding = Math.max(2, (maximumValue - minimumValue) * 0.2);
  const minimum = Math.max(0, minimumValue - padding);
  const maximum = Math.min(100, maximumValue + padding);
  return maximum > minimum
    ? { maximum, minimum }
    : {
        maximum: Math.min(100, maximum + 1),
        minimum: Math.max(0, minimum - 1),
      };
}

/**
 * Scales a value from one numeric domain into another.
 *
 * @param value - Value to transform.
 * @param inputMinimum - Lower source bound.
 * @param inputMaximum - Upper source bound.
 * @param outputMinimum - Lower target bound.
 * @param outputMaximum - Upper target bound.
 * @returns Scaled target-domain value.
 */
function scaleValue(
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
 * Calculates movement from the first to latest visible price point.
 *
 * @param history - Sorted recent price history.
 * @returns Percentage-point movement, or null when unavailable.
 */
function getHistoryChangePercent100(
  history: MarketPricePoint[],
): number | null {
  const first = history[0];
  const latest = history.at(-1);
  return first && latest
    ? Number((latest.yesPricePercent100 - first.yesPricePercent100).toFixed(2))
    : null;
}

/**
 * Formats a scale-100 probability as a short visible percentage.
 *
 * @param valuePercent100 - Probability on the scale-100 convention.
 * @returns User-facing percentage label.
 */
function formatPercent100(valuePercent100: number): string {
  return `${valuePercent100.toFixed(valuePercent100 % 1 === 0 ? 0 : 1)}%`;
}

/**
 * Formats a signed percentage-point movement.
 *
 * @param valuePercent100 - Scale-100 movement.
 * @returns Signed user-facing movement label.
 */
function formatSignedPercent100(valuePercent100: number): string {
  return `${valuePercent100 >= 0 ? "+" : ""}${formatPercent100(valuePercent100)}`;
}

/**
 * Formats a short Eastern-time refresh timestamp.
 *
 * @param value - ISO timestamp.
 * @returns Time label in the report's display timezone.
 */
function formatRefreshTime(value: string): string {
  return new Date(value).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

/**
 * Creates a stable client key for one analyzed market.
 *
 * @param market - Report market.
 * @returns Platform and external-ID key.
 */
function marketKey(market: AnalysedMarket): string {
  return `${market.contract.platform}:${market.contract.externalId}`;
}

/**
 * Capitalizes a platform label for display.
 *
 * @param value - Lowercase platform label.
 * @returns Display label.
 */
function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
