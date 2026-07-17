import { Bell, UserRound } from "lucide-react";
import { useEffect } from "react";
import { Link, Route, Routes } from "react-router-dom";

import { AccountPage } from "./pages/AccountPage.js";
import { DeveloperPage } from "./pages/DeveloperPage.js";
import { DisputeDetailPage } from "./pages/DisputeDetailPage.js";
import { DisputesPage } from "./pages/DisputesPage.js";
import { HomePage } from "./pages/HomePage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { NotificationsPage } from "./pages/NotificationsPage.js";
import { ReportPage } from "./pages/ReportPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { WatchlistsPage } from "./pages/WatchlistsPage.js";

/** Main FinePredict application shell and route map. */
export function App() {
  const isEmbedded = isEmbedMode(window.location.search);

  useEffect(() => {
    if (!isEmbedded || window.parent === window) {
      return undefined;
    }

    /**
     * Posts the current document height to the embedding page.
     *
     * @returns Nothing.
     */
    const postEmbedHeight = (): void => {
      const message: FinePredictEmbedResizeMessage = {
        type: "finepredict:resize",
        height: document.documentElement.scrollHeight,
      };
      window.parent.postMessage(message, "*");
    };

    const resizeObserver = new ResizeObserver(postEmbedHeight);
    resizeObserver.observe(document.documentElement);
    postEmbedHeight();
    return () => resizeObserver.disconnect();
  }, [isEmbedded]);

  return (
    <div className={`app-shell${isEmbedded ? " embed-mode" : ""}`}>
      {isEmbedded ? null : (
        <header className="site-header">
          <Link className="brand" to="/" aria-label="FinePredict home">
            <span className="brand-mark">FP</span>
            <span>FinePredict</span>
          </Link>
          <nav className="site-nav" aria-label="Primary navigation">
            <Link to="/">Analyze</Link>
            <Link to="/disputes">Disputes</Link>
            <Link to="/watchlists">Watchlists</Link>
            <Link to="/developers">API</Link>
            <Link
              className="nav-settings"
              to="/notifications"
              aria-label="Notifications"
            >
              <Bell size={15} aria-hidden="true" />
              Alerts
            </Link>
            <Link className="nav-settings" to="/account">
              <UserRound size={15} aria-hidden="true" />
              Account
            </Link>
          </nav>
          <div className="header-market-status" aria-label="Supported markets">
            <span className="status-light" />
            Polymarket&nbsp;&nbsp;/&nbsp;&nbsp;Kalshi
          </div>
        </header>
      )}

      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route path="/account/login" element={<LoginPage />} />
          <Route path="/developers" element={<DeveloperPage />} />
          <Route path="/disputes" element={<DisputesPage />} />
          <Route path="/disputes/:slug" element={<DisputeDetailPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/reports/:slug" element={<ReportPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/watchlists" element={<WatchlistsPage />} />
        </Routes>
      </main>

      {isEmbedded ? null : (
        <footer className="site-footer">
          <span>FinePredict</span>
          <p>Contract terms are archived at the time of analysis.</p>
          <a href="mailto:hello@finepredict.com">API access</a>
        </footer>
      )}
    </div>
  );
}

/** Message sent from an embedded FinePredict report to its parent window. */
interface FinePredictEmbedResizeMessage {
  height: number;
  type: "finepredict:resize";
}

/**
 * Determines whether the application should render without site chrome.
 *
 * @param search - URL search string to inspect.
 * @returns True when the explicit embed flag is present.
 */
export function isEmbedMode(search: string): boolean {
  return new URLSearchParams(search).get("embed") === "1";
}
