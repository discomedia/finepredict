import {
  ArrowRight,
  Check,
  FileDiff,
  Link2,
  Radio,
  Scale,
  ShieldCheck,
} from "lucide-react";
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
          <div className="eyebrow">
            <span className="live-dot" />
            Contract intelligence for prediction markets
          </div>
          <h1>
            The odds look equal.
            <br />
            <em>The contracts may not be.</em>
          </h1>
          <p className="hero-lede">
            FinePredict reads the settlement terms behind Polymarket and Kalshi
            markets—then shows the deadlines, sources, edge cases and
            differences that can decide the trade.
          </p>
          <div className="trust-row">
            <span>
              <Check size={15} /> Verbatim evidence
            </span>
            <span>
              <Check size={15} /> Permanent snapshots
            </span>
            <span>
              <Check size={15} /> No mystery scores
            </span>
          </div>
        </div>

        <form
          className="analyze-card"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <div className="card-kicker">Analyze fine print</div>
          <h2>Paste a market URL</h2>
          <p>We fetch the current rules directly from the market.</p>
          <label htmlFor="market-url-1">Market URL</label>
          <div className="url-input-wrap">
            <Link2 size={18} aria-hidden="true" />
            <input
              id="market-url-1"
              type="url"
              value={urls[0]}
              onChange={(event) => updateUrl(0, event.target.value)}
              placeholder="https://polymarket.com/event/..."
              autoComplete="url"
            />
          </div>
          {compareMode ? (
            <>
              <label htmlFor="market-url-2">Comparison URL</label>
              <div className="url-input-wrap">
                <Link2 size={18} aria-hidden="true" />
                <input
                  id="market-url-2"
                  type="url"
                  value={urls[1]}
                  onChange={(event) => updateUrl(1, event.target.value)}
                  placeholder="https://kalshi.com/markets/..."
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
          <div className="supported-row">
            <span>Supported</span>
            <strong className="platform-wordmark polymarket-wordmark">
              ◆ Polymarket
            </strong>
            <strong className="platform-wordmark kalshi-wordmark">
              K Kalshi
            </strong>
          </div>
        </form>
      </section>

      <section className="sample-strip" aria-label="Sample warning">
        <div className="sample-number">01</div>
        <div>
          <span className="sample-label">The kind of difference we catch</span>
          <p>
            <del>“Announced by December 31”</del>
            <span className="sample-arrow">→</span>
            <ins>“Transaction completed by 5 p.m. ET”</ins>
          </p>
        </div>
        <div className="sample-verdict">
          <Scale size={18} /> Not equivalent
        </div>
      </section>

      <section className="features-section">
        <div className="section-heading">
          <span className="eyebrow">What you get</span>
          <h2>Settlement terms, made legible.</h2>
          <p>
            Every conclusion is specific, checkable, and placed beside the
            contract text that supports it.
          </p>
        </div>
        <div className="feature-grid">
          <FeatureCard
            icon={<ShieldCheck />}
            number="01"
            title="Plain-English brief"
            text="A direct explanation of what must happen, by when, and according to whom."
          />
          <FeatureCard
            icon={<Scale />}
            number="02"
            title="Equivalence check"
            text="A term-by-term Polymarket and Kalshi comparison—not a vague similarity score."
          />
          <FeatureCard
            icon={<FileDiff />}
            number="03"
            title="Archived rules & diffs"
            text="A timestamped copy of the fine print, with visible changes between observations."
          />
          <FeatureCard
            icon={<Radio />}
            number="04"
            title="Source monitoring"
            text="Visibility into named resolution sources and whether directly linked sources remain reachable."
          />
        </div>
      </section>

      <section className="recent-section" id="recent">
        <div className="recent-heading">
          <div>
            <span className="eyebrow">Public research</span>
            <h2>Recently analyzed</h2>
          </div>
          <span className="archive-note">
            Every report is permanently archived
          </span>
        </div>
        {recentReports.length ? (
          <div className="recent-grid">
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
                <p>
                  Captured{" "}
                  {new Date(report.createdAt).toLocaleDateString("en-US", {
                    dateStyle: "medium",
                  })}
                </p>
                <ArrowRight size={18} />
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-reports">
            Your first analysis will appear here as a permanent, shareable
            report.
          </div>
        )}
      </section>
    </>
  );
}

/** Properties for a home-page feature card. */
interface FeatureCardProps {
  icon: React.ReactNode;
  number: string;
  text: string;
  title: string;
}

/**
 * Renders a compact product-capability card.
 *
 * @param props - Card icon, number, title, and supporting text.
 * @returns Feature card element.
 */
function FeatureCard({ icon, number, text, title }: FeatureCardProps) {
  return (
    <article className="feature-card">
      <div className="feature-icon">{icon}</div>
      <span className="feature-number">{number}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </article>
  );
}
