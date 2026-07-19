import type { MarketPlatform, MarketSearchResult } from "@finepredict/shared";
import { ArrowRight, Link2, Search } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import {
  createReport,
  listRecentReports,
  searchMarkets,
  type RecentReport,
} from "../api.js";

/** Loading lifecycle for one venue's dynamic result list. */
type MarketSearchStatus = "idle" | "loading" | "success" | "error";

/** Dynamic search state retained independently for each venue. */
interface PlatformSearchState {
  error: string | null;
  results: MarketSearchResult[];
  status: MarketSearchStatus;
}

/** Empty venue state used before a valid search term is entered. */
const EMPTY_PLATFORM_SEARCH_STATE: PlatformSearchState = {
  error: null,
  results: [],
  status: "idle",
};

/** Minimum trimmed query length accepted by market search. */
const MINIMUM_MARKET_SEARCH_LENGTH = 3;

/** Delay after typing before venue searches begin. */
const MARKET_SEARCH_DEBOUNCE_MILLISECONDS = 400;

/** FinePredict home page with primary market-analysis workflow. */
export function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [urls, setUrls] = useState(() => [
    new URLSearchParams(location.search).get("marketUrl") ?? "",
    "",
  ]);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchState, setSearchState] = useState<
    Record<MarketPlatform, PlatformSearchState>
  >({
    kalshi: EMPTY_PLATFORM_SEARCH_STATE,
    polymarket: EMPTY_PLATFORM_SEARCH_STATE,
  });
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recentReports, setRecentReports] = useState<RecentReport[]>([]);

  useEffect(() => {
    let isMounted = true;
    void listRecentReports()
      .then((reports) => {
        if (isMounted) {
          setRecentReports(reports);
        }
      })
      .catch(() => {
        if (isMounted) {
          setRecentReports([]);
        }
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const query = searchTerm.trim();
    if (query.length < MINIMUM_MARKET_SEARCH_LENGTH) {
      setSearchState({
        kalshi: EMPTY_PLATFORM_SEARCH_STATE,
        polymarket: EMPTY_PLATFORM_SEARCH_STATE,
      });
      return;
    }
    const controller = new AbortController();
    setSearchState({
      kalshi: { error: null, results: [], status: "loading" },
      polymarket: { error: null, results: [], status: "loading" },
    });
    const timeout = window.setTimeout(() => {
      for (const platform of ["polymarket", "kalshi"] as const) {
        void searchMarkets(platform, query, controller.signal)
          .then((results) => {
            setSearchState((current) => ({
              ...current,
              [platform]: { error: null, results, status: "success" },
            }));
          })
          .catch((caughtError: unknown) => {
            if (
              caughtError instanceof DOMException &&
              caughtError.name === "AbortError"
            ) {
              return;
            }
            setSearchState((current) => ({
              ...current,
              [platform]: {
                error:
                  caughtError instanceof Error
                    ? caughtError.message
                    : `FinePredict could not search ${platform}.`,
                results: [],
                status: "error",
              },
            }));
          });
      }
    }, MARKET_SEARCH_DEBOUNCE_MILLISECONDS);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [searchTerm]);

  /**
   * Creates a report and navigates directly to its permanent share page.
   *
   * @param event - Browser form submission event.
   * @returns Promise resolved after navigation or error display.
   */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedUrls = urls.map((url) => url.trim()).filter(Boolean);
    if (submittedUrls.length !== 2) {
      setError("Choose or paste both market URLs to compare their contracts.");
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

  /**
   * Places a selected result into the URL field aligned with its venue.
   *
   * @param result - Ranked venue result selected by the user.
   * @returns Nothing.
   */
  function selectMarket(result: MarketSearchResult): void {
    const index = result.platform === "polymarket" ? 0 : 1;
    updateUrl(index, result.url);
    setError(null);
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
          <h2>Find matching markets</h2>
          <p>
            Search by topic, event, person or outcome, then choose one result
            from each venue.
          </p>
          <label htmlFor="market-search">Search markets</label>
          <div className="market-search-input-wrap">
            <Search size={19} aria-hidden="true" />
            <input
              id="market-search"
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Try “Bitcoin”, “Fed rates” or “World Cup”"
              autoComplete="off"
            />
          </div>
          <div className="search-minimum-note" aria-live="polite">
            {searchTerm.trim().length > 0 &&
            searchTerm.trim().length < MINIMUM_MARKET_SEARCH_LENGTH
              ? `Enter at least ${MINIMUM_MARKET_SEARCH_LENGTH} characters to search.`
              : "Results balance keyword match, market activity and variety."}
          </div>

          {searchTerm.trim().length >= MINIMUM_MARKET_SEARCH_LENGTH ? (
            <div className="market-search-results">
              {(["polymarket", "kalshi"] as const).map((platform) => (
                <MarketResultList
                  key={platform}
                  platform={platform}
                  selectedUrl={urls[platform === "polymarket" ? 0 : 1] ?? ""}
                  state={searchState[platform]}
                  onSelect={selectMarket}
                />
              ))}
            </div>
          ) : null}

          <div className="selected-market-heading">
            <span>Selected markets</span>
            <span>Or paste URLs manually</span>
          </div>
          <div className="market-url-grid">
            <div>
              <label htmlFor="market-url-1">Polymarket URL</label>
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
            </div>
            <div>
              <label htmlFor="market-url-2">Kalshi URL</label>
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
            </div>
          </div>
          {error ? <div className="form-error">{error}</div> : null}
          <button
            className="primary-button"
            type="submit"
            disabled={isSubmitting || urls.some((url) => !url.trim())}
          >
            {isSubmitting ? "Reading the contracts…" : "Compare market rules"}
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

/** Properties for one venue's dynamic result list. */
interface MarketResultListProperties {
  onSelect: (result: MarketSearchResult) => void;
  platform: MarketPlatform;
  selectedUrl: string;
  state: PlatformSearchState;
}

/**
 * Renders independently loading, ranked results for one venue.
 *
 * @param properties - Venue state, selected URL, and selection callback.
 * @returns Accessible dynamic market result list.
 */
function MarketResultList({
  onSelect,
  platform,
  selectedUrl,
  state,
}: MarketResultListProperties) {
  const platformLabel = platform === "polymarket" ? "Polymarket" : "Kalshi";
  return (
    <section
      className="market-result-column"
      aria-label={`${platformLabel} results`}
    >
      <div className="market-result-column-heading">
        <span
          className={`venue-dot venue-dot-${platform}`}
          aria-hidden="true"
        />
        <h3>{platformLabel}</h3>
      </div>
      <div className="market-result-list" aria-live="polite">
        {state.status === "loading" ? (
          <div className="market-result-status">Searching {platformLabel}…</div>
        ) : null}
        {state.status === "error" ? (
          <div className="market-result-status market-result-error">
            {state.error}
          </div>
        ) : null}
        {state.status === "success" && state.results.length === 0 ? (
          <div className="market-result-status">No active matches found.</div>
        ) : null}
        {state.results.map((result) => (
          <button
            className={`market-result${selectedUrl === result.url ? " market-result-selected" : ""}`}
            key={result.externalId}
            type="button"
            onClick={() => onSelect(result)}
          >
            <span>{result.title}</span>
            {result.subtitle ? <small>{result.subtitle}</small> : null}
          </button>
        ))}
      </div>
    </section>
  );
}
