import type { SubscriptionSummary, Watchlist } from "@finepredict/shared";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  addWatchlistMarket,
  createWatchlist,
  getSubscription,
  isAuthenticationError,
  listWatchlists,
  removeWatchlistMarket,
} from "../api.js";
import {
  AccountNavigation,
  ProductHeader,
  SignInRequired,
  errorMessage,
} from "../components/ProductPage.js";

/** User watchlists and market-monitoring management page. */
export function WatchlistsPage() {
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(
    null,
  );
  const [name, setName] = useState("");
  const [marketUrls, setMarketUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeMarketCount = useMemo(
    () =>
      watchlists
        .flatMap((watchlist) => watchlist.markets)
        .filter((market) => market.active).length,
    [watchlists],
  );

  /**
   * Reloads subscription and watchlists from the authenticated API.
   *
   * @returns Promise resolved after page state is updated.
   */
  async function loadWatchlists(): Promise<void> {
    const [loadedWatchlists, loadedSubscription] = await Promise.all([
      listWatchlists(),
      getSubscription(),
    ]);
    setWatchlists(loadedWatchlists);
    setSubscription(loadedSubscription);
  }

  useEffect(() => {
    void loadWatchlists()
      .catch((caughtError: unknown) => {
        setSignedOut(isAuthenticationError(caughtError));
        setError(errorMessage(caughtError, "Watchlists could not be loaded."));
      })
      .finally(() => setLoading(false));
  }, []);

  /**
   * Creates an empty named watchlist.
   *
   * @param event - Watchlist form submission.
   * @returns Promise resolved after list refresh.
   */
  async function handleCreate(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createWatchlist(name);
      setName("");
      await loadWatchlists();
    } catch (caughtError) {
      setError(
        errorMessage(caughtError, "The watchlist could not be created."),
      );
    } finally {
      setSaving(false);
    }
  }

  /**
   * Adds a market URL to a selected watchlist.
   *
   * @param watchlistId - Target watchlist ID.
   * @returns Promise resolved after list refresh.
   */
  async function handleAddMarket(watchlistId: string): Promise<void> {
    const url = marketUrls[watchlistId]?.trim();
    if (!url) return;
    setSaving(true);
    setError(null);
    try {
      await addWatchlistMarket(watchlistId, url);
      setMarketUrls((current) => ({ ...current, [watchlistId]: "" }));
      await loadWatchlists();
    } catch (caughtError) {
      setError(errorMessage(caughtError, "The market could not be added."));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Stops monitoring a market.
   *
   * @param marketId - Watchlist-market ID.
   * @returns Promise resolved after list refresh.
   */
  async function handleRemoveMarket(marketId: string): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await removeWatchlistMarket(marketId);
      await loadWatchlists();
    } catch (caughtError) {
      setError(errorMessage(caughtError, "The market could not be removed."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="product-page">
      <ProductHeader
        eyebrow="Monitoring"
        title="Watchlists"
        description="Track rule changes, deadlines, source status and settlement events."
        actions={
          subscription ? (
            <span className="terminal-counter">
              {activeMarketCount} / {subscription.activeMarketLimit} active
            </span>
          ) : undefined
        }
      />
      <AccountNavigation />
      {loading ? (
        <div className="product-loading">Loading watchlists…</div>
      ) : null}
      {!loading && signedOut ? (
        <SignInRequired message={error ?? undefined} />
      ) : null}
      {!loading && !signedOut && error && !subscription ? (
        <div className="form-error">{error}</div>
      ) : null}
      {subscription && !subscription.entitled ? (
        <div className="product-empty-state">
          <h2>Monitoring requires a subscription</h2>
          <p>
            Free reports remain available. The US$12/month plan monitors up to{" "}
            {subscription.activeMarketLimit} active markets.
          </p>
          <Link className="primary-button inline-button" to="/account">
            View subscription
          </Link>
        </div>
      ) : null}
      {subscription?.entitled ? (
        <>
          <form
            className="product-toolbar-form"
            onSubmit={(event) => void handleCreate(event)}
          >
            <label htmlFor="watchlist-name">New watchlist</label>
            <input
              id="watchlist-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              placeholder="Macro releases"
              required
            />
            <button
              className="secondary-button"
              type="submit"
              disabled={saving}
            >
              <Plus size={15} /> Create
            </button>
          </form>
          {error ? <div className="form-error">{error}</div> : null}
          <div className="watchlist-stack">
            {watchlists.map((watchlist) => (
              <article
                className="product-panel watchlist-panel"
                key={watchlist.id}
              >
                <div className="panel-heading-row">
                  <div>
                    <span className="panel-label">Watchlist</span>
                    <h2>{watchlist.name}</h2>
                  </div>
                  <time>
                    {new Date(watchlist.createdAt).toLocaleDateString("en-US")}
                  </time>
                </div>
                <div className="data-table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Market</th>
                        <th>Venue</th>
                        <th>Added</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {watchlist.markets.length ? (
                        watchlist.markets.map((market) => (
                          <tr key={market.id}>
                            <td>
                              <a
                                href={market.marketUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {market.title} <ExternalLink size={12} />
                              </a>
                            </td>
                            <td>{market.platform}</td>
                            <td>
                              {new Date(market.addedAt).toLocaleDateString(
                                "en-US",
                              )}
                            </td>
                            <td>
                              <button
                                className="icon-button"
                                type="button"
                                aria-label={`Stop monitoring ${market.title}`}
                                disabled={saving}
                                onClick={() =>
                                  void handleRemoveMarket(market.id)
                                }
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={4}>No markets monitored.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="inline-market-form">
                  <input
                    aria-label={`Market URL for ${watchlist.name}`}
                    type="url"
                    value={marketUrls[watchlist.id] ?? ""}
                    onChange={(event) =>
                      setMarketUrls((current) => ({
                        ...current,
                        [watchlist.id]: event.target.value,
                      }))
                    }
                    placeholder="Polymarket or Kalshi URL"
                  />
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={
                      saving ||
                      activeMarketCount >= subscription.activeMarketLimit
                    }
                    onClick={() => void handleAddMarket(watchlist.id)}
                  >
                    Add market
                  </button>
                </div>
              </article>
            ))}
            {!watchlists.length ? (
              <div className="product-empty-state">
                <h2>No watchlists</h2>
                <p>Create a list to begin monitoring markets.</p>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
