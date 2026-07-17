import { Settings } from "lucide-react";
import { Link, Route, Routes } from "react-router-dom";

import { HomePage } from "./pages/HomePage.js";
import { ReportPage } from "./pages/ReportPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";

/** Main FinePredict application shell and route map. */
export function App() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <Link className="brand" to="/" aria-label="FinePredict home">
          <span className="brand-mark">FP</span>
          <span>FinePredict</span>
        </Link>
        <nav className="site-nav" aria-label="Primary navigation">
          <Link to="/">Analyze</Link>
          <a href="/#recent">Reports</a>
          <Link className="nav-settings" to="/settings">
            <Settings size={15} aria-hidden="true" />
            System
          </Link>
        </nav>
        <div className="header-market-status" aria-label="Supported markets">
          <span className="status-light" />
          Polymarket&nbsp;&nbsp;/&nbsp;&nbsp;Kalshi
        </div>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/reports/:slug" element={<ReportPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>

      <footer className="site-footer">
        <span>FinePredict</span>
        <p>Contract terms are archived at the time of analysis.</p>
        <a href="mailto:hello@finepredict.com">API access</a>
      </footer>
    </div>
  );
}
