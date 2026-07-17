import type { AnalysedMarket, FinePredictReport } from "@finepredict/shared";
import {
  ArrowLeft,
  CalendarClock,
  Check,
  Copy,
  ExternalLink,
  FileArchive,
  Radio,
  Share2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { getReport } from "../api.js";
import { ComparisonTable } from "../components/ComparisonTable.js";
import { Countdown } from "../components/Countdown.js";
import { FindingCard } from "../components/FindingCard.js";

/** Public shareable report page. */
export function ReportPage() {
  const { slug } = useParams();
  const [report, setReport] = useState<FinePredictReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!slug) {
      setError("Report not found.");
      return;
    }
    void getReport(slug)
      .then(setReport)
      .catch((caughtError: unknown) =>
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Report could not be loaded.",
        ),
      );
  }, [slug]);

  /**
   * Copies the canonical report URL to the clipboard.
   *
   * @returns Promise resolved after clipboard feedback is updated.
   */
  async function copyShareUrl(): Promise<void> {
    if (!report) {
      return;
    }
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (error) {
    return (
      <section className="status-page">
        <span className="report-kicker">Unable to load report</span>
        <h1>{error}</h1>
        <Link className="primary-button inline-button" to="/">
          Analyze a market
        </Link>
      </section>
    );
  }
  if (!report) {
    return (
      <section className="status-page">
        <div className="loading-mark">FP</div>
        <p>Opening the archived contract…</p>
      </section>
    );
  }

  const firstMarket = report.markets[0];
  const secondMarket = report.markets[1];
  return (
    <div className="report-page">
      <div className="report-toolbar">
        <Link to="/">
          <ArrowLeft size={16} /> New analysis
        </Link>
        <button type="button" onClick={() => void copyShareUrl()}>
          {copied ? <Check size={16} /> : <Share2 size={16} />}
          {copied ? "Copied" : "Share report"}
        </button>
      </div>

      <header className="report-header">
        <div className="report-status">
          <span className="report-kicker">Contract report</span>
          <span className="archived-pill">
            <FileArchive size={14} /> Archived
          </span>
        </div>
        <h1>
          {report.markets.map((market) => market.contract.title).join(" vs ")}
        </h1>
        <div className="report-meta">
          <span>Captured {formatDate(report.createdAt)}</span>
          <span>•</span>
          <span>
            {report.markets.length} contract
            {report.markets.length === 1 ? "" : "s"}
          </span>
          {report.modelUsed ? (
            <>
              <span>•</span>
              <span>{report.modelUsed}</span>
            </>
          ) : null}
        </div>
      </header>

      <div className="report-market-grid">
        {report.markets.map((market, index) => (
          <MarketOverview
            key={`${market.contract.platform}:${market.contract.externalId}`}
            market={market}
            label={
              report.markets.length === 2 ? `Contract ${index + 1}` : "Contract"
            }
          />
        ))}
      </div>

      {report.comparison && firstMarket && secondMarket ? (
        <ComparisonTable
          comparison={report.comparison}
          leftPlatform={firstMarket.contract.platform}
          rightPlatform={secondMarket.contract.platform}
        />
      ) : null}

      {report.markets.map((market) => (
        <section
          className="report-section findings-section"
          key={`findings:${market.contract.externalId}`}
        >
          <div className="section-title-row">
            <div>
              <span className="report-kicker">
                {capitalize(market.contract.platform)} checks
              </span>
              <h2>Wording to review</h2>
            </div>
            <span className="finding-count">
              {market.findings.length} finding
              {market.findings.length === 1 ? "" : "s"}
            </span>
          </div>
          <p className="section-intro">
            Each conclusion is tied to an exact excerpt from the archived
            contract.
          </p>
          {market.findings.length ? (
            <div className="findings-grid">
              {market.findings.map((finding) => (
                <FindingCard finding={finding} key={finding.id} />
              ))}
            </div>
          ) : (
            <div className="no-findings">
              No wording was flagged by the deterministic checks. This is not a
              guarantee of unambiguous settlement.
            </div>
          )}
        </section>
      ))}

      {report.markets.map((market) => (
        <SnapshotHistory
          key={`snapshots:${market.contract.externalId}`}
          market={market}
        />
      ))}

      <aside className="report-disclaimer">
        FinePredict explains visible settlement language. It does not provide
        legal or investment advice, predict disputes, or override the market
        operator’s official rules and settlement process.
      </aside>
    </div>
  );
}

/** Properties for a market overview card. */
interface MarketOverviewProps {
  label: string;
  market: AnalysedMarket;
}

/**
 * Renders contract summary, deadline, source, and exact supporting wording.
 *
 * @param props - Analyzed market and display label.
 * @returns Market overview card.
 */
function MarketOverview({ label, market }: MarketOverviewProps) {
  return (
    <article className="market-overview">
      <div className="market-overview-top">
        <span className={`platform-badge platform-${market.contract.platform}`}>
          {capitalize(market.contract.platform)}
        </span>
        <span>{label}</span>
      </div>
      <h2>{market.contract.title}</h2>
      <p className="plain-summary">{market.summary.plainEnglish}</p>
      <blockquote>“{market.summary.supportingQuote}”</blockquote>
      <div className="market-facts">
        <div>
          <CalendarClock size={17} />
          <span>
            <small>Platform end timestamp</small>
            {market.contract.endDate
              ? formatDateTime(market.contract.endDate)
              : "Not extracted"}
          </span>
        </div>
        <div>
          <Radio size={17} />
          <span>
            <small>Resolution source</small>
            {market.contract.resolutionSource ?? "No distinct source extracted"}
          </span>
        </div>
      </div>
      <div className="market-card-footer">
        <Countdown endDate={market.contract.endDate} />
        <span className={`source-state source-${market.sourceAvailability}`}>
          {formatSourceAvailability(market.sourceAvailability)}
        </span>
        <a href={market.contract.url} target="_blank" rel="noreferrer">
          Original market <ExternalLink size={14} />
        </a>
      </div>
    </article>
  );
}

/**
 * Converts a stored source-check status into precise, non-alarmist copy.
 *
 * @param sourceAvailability - Automated source reachability result.
 * @returns Human-readable source check label.
 */
export function formatSourceAvailability(
  sourceAvailability: AnalysedMarket["sourceAvailability"],
): string {
  const labels: Record<AnalysedMarket["sourceAvailability"], string> = {
    access_limited: "Source check limited",
    available: "Source reachable",
    confirmed_unavailable: "Source unavailable",
    not_checked: "Source not checked",
    unavailable: "Source status unconfirmed",
  };
  return labels[sourceAvailability];
}

/** Properties for an archived snapshot history section. */
interface SnapshotHistoryProps {
  market: AnalysedMarket;
}

/**
 * Renders timestamped rules snapshots and any line-level changes.
 *
 * @param props - Market with snapshot history.
 * @returns Snapshot archive section.
 */
function SnapshotHistory({ market }: SnapshotHistoryProps) {
  const latest = market.snapshots[0];
  return (
    <section className="report-section snapshot-section">
      <div className="section-title-row">
        <div>
          <span className="report-kicker">
            {capitalize(market.contract.platform)} rules
          </span>
          <h2>Snapshot history</h2>
        </div>
        <span className="snapshot-hash">
          {latest
            ? `SHA-256 ${latest.contentHash.slice(0, 12)}…`
            : "No snapshot"}
        </span>
      </div>
      <div className="snapshot-layout">
        <div className="snapshot-timeline">
          {market.snapshots.map((snapshot, index) => (
            <div className="snapshot-item" key={snapshot.id}>
              <span className="timeline-dot" />
              <div>
                <strong>
                  {index === 0 ? "Current snapshot" : "Earlier snapshot"}
                </strong>
                <time>{formatDateTime(snapshot.capturedAt)}</time>
                <span>
                  {snapshot.changedFromPrevious
                    ? "Rules changed"
                    : "Initial or unchanged"}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="rules-document">
          <div className="document-header">
            <span>Archived full rules</span>
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard.writeText(market.contract.rulesText)
              }
            >
              <Copy size={14} /> Copy
            </button>
          </div>
          <pre>{market.contract.rulesText}</pre>
        </div>
      </div>
      {latest?.diffLines.length ? (
        <div className="rules-diff">
          <h3>Changes from the previous snapshot</h3>
          {latest.diffLines.map((line, index) => (
            <code
              className={line.startsWith("+") ? "diff-added" : "diff-removed"}
              key={`${index}:${line}`}
            >
              {line}
            </code>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * Formats a timestamp as a user-friendly date.
 *
 * @param value - ISO timestamp.
 * @returns Localized date label.
 */
function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", { dateStyle: "long" });
}

/**
 * Formats a timestamp consistently in US Eastern time.
 *
 * @param value - ISO timestamp.
 * @returns Date/time label in America/New_York.
 */
function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  });
}

/**
 * Capitalizes a platform label.
 *
 * @param value - Lowercase platform name.
 * @returns Capitalized label.
 */
function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
