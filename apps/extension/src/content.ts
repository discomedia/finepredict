import {
  buildFinePredictAnalysisUrl,
  isSupportedMarketUrl,
} from "./market-url.js";
import {
  addOddpoolCompareActions,
  isOddpoolArbitrageDashboardUrl,
  removeOddpoolCompareActions,
} from "./oddpool.js";

/** Stable DOM identifier used to prevent duplicate extension controls. */
const ACTION_ID = "finepredict-check-fine-print";

/**
 * Creates the restrained FinePredict market action.
 *
 * @returns Button that opens a prefilled FinePredict page on explicit click.
 */
function createFinePredictAction(): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = ACTION_ID;
  button.type = "button";
  button.textContent = "Check fine print";
  button.setAttribute(
    "aria-label",
    "Check this market's fine print with FinePredict",
  );
  Object.assign(button.style, {
    position: "fixed",
    right: "16px",
    bottom: "18px",
    zIndex: "2147483647",
    border: "1px solid rgba(255, 255, 255, 0.22)",
    borderRadius: "4px",
    padding: "10px 13px",
    background: "#0a1712",
    color: "#f4f6f1",
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.22)",
    font: "600 12px/1.2 ui-sans-serif, system-ui, sans-serif",
    letterSpacing: "0.01em",
    cursor: "pointer",
  });
  button.addEventListener("click", () => {
    window.open(
      buildFinePredictAnalysisUrl(window.location.href),
      "_blank",
      "noopener,noreferrer",
    );
  });
  return button;
}

/**
 * Opens a FinePredict page without giving the opened page access to Oddpool.
 *
 * @param url - Prefilled FinePredict comparison or analysis URL.
 * @returns Nothing.
 */
function openFinePredict(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Adds or removes the action when a market site changes routes.
 *
 * @returns Nothing.
 */
function refreshFinePredictActions(): void {
  const existingAction = document.getElementById(ACTION_ID);
  if (!isSupportedMarketUrl(window.location.href)) {
    existingAction?.remove();
  } else if (!existingAction) {
    document.body.append(createFinePredictAction());
  }

  if (isOddpoolArbitrageDashboardUrl(window.location.href)) {
    addOddpoolCompareActions(document, openFinePredict);
  } else {
    removeOddpoolCompareActions(document);
  }
}

refreshFinePredictActions();
window.addEventListener("popstate", refreshFinePredictActions);
window.setInterval(refreshFinePredictActions, 1_000);
