import { ArrowRight, Link2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { createReport, listRecentReports, type RecentReport } from "../api.js";

/** FinePredict home page with primary market-analysis workflow. */
export function HomePage() {
  const navigate = useNavigate();
  const [urls, setUrls] = useState(["", ""]);
  const [compareMode, setCompareMode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recentReports, setRecentReports] = useState<RecentReport[]>([]);

  useEffect(() => {
    void listRecentReports()
      .then(setRecentReports)
      .catch(() => setRecentReports([]));
  }, []);

  /**
   * Creates a report and navigates directly to its permanent share page.
   *
   * @param event - Browser form submission event.
   * @returns Promise resolved after navigation or error display.
   */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedUrls = urls
      .slice(0, compareMode ? 2 : 1)
      .map((url) => url.trim())
      .filter(Boolean);
    if (submittedUrls.length !== (compareMode ? 2 : 1)) {
      setError(
        compareMode
          ? "Paste both market URLs to compare their contracts."
          : "Paste a Polymarket or Kalshi market URL.",
      );
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const report = await createReport({ urls: submittedUrls });
      await navigate(`/reports/${report.slug}`);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "FinePredict could not analyze this market.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  /**
   * Updates one URL field without mutating React state.
   *
   * @param index - URL field index.
   * @param value - New input value.
   * @returns Nothing.
   */
  function updateUrl(index: number, value: string): void {
    setUrls((current) =>
      current.map((url, currentIndex) =>
        currentIndex === index ? value : url,
      ),
    );
  }

  return (
    <>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">Contract research / Polymarket + Kalshi</div>
          <h1>
            Compare the rules
            <br />
            behind the trade.
          </h1>
          <p className="hero-lede">
            Check deadlines, resolution sources, trigger language and rule
            differences before taking a position.
          </p>
          <div className="research-principles" aria-label="Report principles">
            <span>Exact quotes</span>
            <span>Timestamped rules</span>
            <span>Specific warnings</span>
          </div>
        </div>

        <form
          className="analyze-card"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <div className="analyze-card-header">
            <span className="card-kicker">New analysis</span>
            <span className="terminal-code">FP / 01</span>
          </div>
          <h2>Market URL</h2>
          <p>Paste a current Polymarket or Kalshi contract.</p>
          <label htmlFor="market-url-1">Primary contract</label>
          <div className="url-input-wrap">
            <Link2 size={18} aria-hidden="true" />
            <input
              id="market-url-1"
              type="url"
              value={urls[0]}
              onChange={(event) => updateUrl(0, event.target.value)}
              placeholder="https://polymarket.com/event/…"
              autoComplete="url"
            />
          </div>
          {compareMode ? (
            <>
              <label htmlFor="market-url-2">Comparison contract</label>
              <div className="url-input-wrap">
                <Link2 size={18} aria-hidden="true" />
                <input
                  id="market-url-2"
                  type="url"
                  value={urls[1]}
                  onChange={(event) => updateUrl(1, event.target.value)}
                  placeholder="https://kalshi.com/markets/…"
                  autoComplete="url"
                />
              </div>
            </>
          ) : null}
          <button
            className="compare-toggle"
            type="button"
            onClick={() => setCompareMode((current) => !current)}
          >
            {compareMode
              ? "Analyze one market instead"
              : "+ Compare with another market"}
          </button>
          {error ? <div className="form-error">{error}</div> : null}
          <button
            className="primary-button"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Reading the contracts…" : "Analyze fine print"}
            {!isSubmitting ? <ArrowRight size={18} /> : null}
          </button>
          <p className="analysis-note">
            Reports archive the rules and cite the source text beside every
            conclusion.
          </p>
        </form>
      </section>

      <section className="recent-section" id="recent">
        <div className="recent-heading">
          <div>
            <span className="eyebrow">Report archive</span>
            <h2>Recent analysis</h2>
          </div>
          <span className="archive-note">Public, timestamped snapshots</span>
        </div>
        {recentReports.length ? (
          <div className="recent-list">
            <div className="recent-list-head" aria-hidden="true">
              <span>Type</span>
              <span>Contract</span>
              <span>Captured</span>
              <span />
            </div>
            {recentReports.map((report) => (
              <Link
                className="recent-card"
                key={report.slug}
                to={`/reports/${report.slug}`}
              >
                <span>
                  {report.marketCount === 2 ? "Comparison" : "Market brief"}
                </span>
                <h3>{report.titles.join(" vs ")}</h3>
                <time>
                  {new Date(report.createdAt).toLocaleDateString("en-US", {
                    dateStyle: "medium",
                  })}
                </time>
                <ArrowRight size={18} />
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-reports">
            No reports yet. Run an analysis to create the first snapshot.
          </div>
        )}
      </section>
    </>
  );
}
