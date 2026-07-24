import type { MarketSearchPair, MarketSearchResult } from "@finepredict/shared";
import { ArrowRight, Link2, Search } from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import {
  ApiRequestError,
  createReport,
  listRecentReports,
  searchMarketPairs,
  type RecentReport,
} from "../api.js";

/** Loading lifecycle for one venue's dynamic result list. */
type MarketSearchStatus = "idle" | "loading" | "success" | "error";

/** Dynamic lifecycle for one cross-venue pair search. */
interface MarketPairSearchState {
  error: string | null;
  pairs: MarketSearchPair[];
  status: MarketSearchStatus;
}

/** Browser-visible failure for the primary report-analysis form. */
interface AnalysisFormError {
  code: string | null;
  message: string;
  title: string;
}

/** Empty pair state used before a valid search term is entered. */
const EMPTY_MARKET_PAIR_SEARCH_STATE: MarketPairSearchState = {
  error: null,
  pairs: [],
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
  const [urls, setUrls] = useState(() => {
    const searchParameters = new URLSearchParams(location.search);
    return [
      searchParameters.get("marketUrl") ?? "",
      searchParameters.get("comparisonMarketUrl") ?? "",
    ];
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [searchState, setSearchState] = useState<MarketPairSearchState>(
    EMPTY_MARKET_PAIR_SEARCH_STATE,
  );
  const [error, setError] = useState<AnalysisFormError | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recentReports, setRecentReports] = useState<RecentReport[]>([]);
  const hasStartedAutomaticComparison = useRef(false);
  const shouldStartAutomaticComparison = useRef(
    new URLSearchParams(location.search).get("analyze") === "1" &&
      urls.every((url) => url.trim().length > 0),
  ).current;

  /**
   * Creates a report for exactly two selected contracts.
   *
   * @param submittedUrls - Trimmed Polymarket and Kalshi market URLs.
   * @returns Promise resolved after report navigation or error display.
   */
  const submitComparison = useCallback(
    async (submittedUrls: string[]): Promise<void> => {
      setError(null);
      setIsSubmitting(true);
      try {
        const report = await createReport({ urls: submittedUrls });
        await navigate(`/reports/${report.slug}`);
      } catch (caughtError) {
        setError(createAnalysisFormError(caughtError));
      } finally {
        setIsSubmitting(false);
      }
    },
    [navigate],
  );

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
      setSearchState(EMPTY_MARKET_PAIR_SEARCH_STATE);
      return;
    }
    const controller = new AbortController();
    setSearchState({ error: null, pairs: [], status: "loading" });
    const timeout = window.setTimeout(() => {
      void searchMarketPairs(query, controller.signal)
        .then((pairs) => {
          setSearchState({ error: null, pairs, status: "success" });
        })
        .catch((caughtError: unknown) => {
          if (
            caughtError instanceof DOMException &&
            caughtError.name === "AbortError"
          ) {
            return;
          }
          setSearchState({
            error:
              caughtError instanceof Error
                ? caughtError.message
                : `FinePredict could not find matching markets.`,
            pairs: [],
            status: "error",
          });
        });
    }, MARKET_SEARCH_DEBOUNCE_MILLISECONDS);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [searchTerm]);

  useEffect(() => {
    if (
      !shouldStartAutomaticComparison ||
      hasStartedAutomaticComparison.current
    ) {
      return;
    }
    const submittedUrls = urls.map((url) => url.trim()).filter(Boolean);
    if (submittedUrls.length !== 2) {
      return;
    }
    hasStartedAutomaticComparison.current = true;
    const consumedSearchParameters = new URLSearchParams(location.search);
    consumedSearchParameters.delete("analyze");
    void navigate(
      {
        pathname: location.pathname,
        search: consumedSearchParameters.toString(),
      },
      { replace: true },
    );
    void submitComparison(submittedUrls);
  }, [
    location.pathname,
    location.search,
    navigate,
    shouldStartAutomaticComparison,
    submitComparison,
    urls,
  ]);

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
      setError({
        code: null,
        message: "Choose or paste both market URLs to compare their contracts.",
        title: "Two market URLs required",
      });
      return;
    }
    await submitComparison(submittedUrls);
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
              : "Each row pairs markets with matching outcomes and deadlines."}
          </div>

          {searchTerm.trim().length >= MINIMUM_MARKET_SEARCH_LENGTH ? (
            <MarketPairResultList
              selectedUrls={{
                kalshi: urls[1] ?? "",
                polymarket: urls[0] ?? "",
              }}
              state={searchState}
              onSelect={selectMarket}
            />
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
          {error ? (
            <div className="form-error" role="alert">
              <div>
                <strong>{error.title}</strong>
                <span>{error.message}</span>
                {error.code ? <code>{error.code}</code> : null}
              </div>
            </div>
          ) : null}
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

/**
 * Converts an API failure into concise report-form guidance.
 *
 * @param error - Unknown failure caught while creating a report.
 * @returns Structured browser-visible error copy.
 */
function createAnalysisFormError(error: unknown): AnalysisFormError {
  if (
    error instanceof ApiRequestError &&
    error.code === "EXTERNAL_SERVICE_UNAVAILABLE"
  ) {
    return {
      code: error.code,
      message: error.message,
      title: `${error.externalService ?? "External service"} unavailable`,
    };
  }
  return {
    code: null,
    message:
      error instanceof Error
        ? error.message
        : "FinePredict could not analyze this market.",
    title: "Analysis could not be completed",
  };
}

/** Properties for the aligned cross-venue result grid. */
interface MarketPairResultListProperties {
  onSelect: (result: MarketSearchResult) => void;
  selectedUrls: { kalshi: string; polymarket: string };
  state: MarketPairSearchState;
}

/**
 * Renders matching Polymarket and Kalshi outcomes on shared rows.
 *
 * @param properties - Pair state, selected URLs, and selection callback.
 * @returns Accessible dynamic paired-market grid.
 */
function MarketPairResultList({
  onSelect,
  selectedUrls,
  state,
}: MarketPairResultListProperties) {
  return (
    <section className="market-pair-results" aria-label="Matching markets">
      <div className="market-pair-headings">
        <div className="market-result-column-heading">
          <span className="venue-dot venue-dot-polymarket" aria-hidden="true" />
          <h3>Polymarket</h3>
        </div>
        <div className="market-result-column-heading">
          <span className="venue-dot venue-dot-kalshi" aria-hidden="true" />
          <h3>Kalshi</h3>
        </div>
      </div>
      <div className="market-pair-list" aria-live="polite">
        {state.status === "loading" ? (
          <div className="market-result-status">
            Finding equivalent markets…
          </div>
        ) : null}
        {state.status === "error" ? (
          <div className="market-result-status market-result-error">
            {state.error}
          </div>
        ) : null}
        {state.status === "success" && state.pairs.length === 0 ? (
          <div className="market-result-status">
            No credible cross-venue equivalents found. Try a more specific event
            or paste URLs manually.
          </div>
        ) : null}
        {state.pairs.map((pair) => (
          <div
            className="market-pair-row"
            key={`${pair.polymarket.externalId}:${pair.kalshi.externalId}`}
          >
            {([pair.polymarket, pair.kalshi] as const).map((result) => (
              <button
                className={`market-result${selectedUrls[result.platform] === result.url ? " market-result-selected" : ""}`}
                key={result.externalId}
                type="button"
                onClick={() => onSelect(result)}
              >
                <span>{result.title}</span>
                {result.subtitle ? <small>{result.subtitle}</small> : null}
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
