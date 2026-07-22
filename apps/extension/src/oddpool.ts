import {
  buildFinePredictAnalysisUrl,
  isMarketUrlForVenue,
} from "./market-url.js";

/** Marker placed on every extension-owned Oddpool comparison control. */
export const ODDPOOL_COMPARE_ACTION_ATTRIBUTE =
  "data-finepredict-compare-action";

/** Pair of supported venue contracts extracted from one Oddpool row. */
export interface OddpoolContractPair {
  kalshiUrl: string;
  polymarketUrl: string;
}

/** Callback used to open an explicit FinePredict comparison. */
export type OpenFinePredictComparison = (url: string) => void;

/**
 * Determines whether the current page is Oddpool's arbitrage dashboard.
 *
 * @param value - Absolute browser URL to inspect.
 * @returns True only for Oddpool's production arbitrage-dashboard route.
 */
export function isOddpoolArbitrageDashboardUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "oddpool.com" || url.hostname === "www.oddpool.com") &&
      url.pathname === "/arb-dashboard"
    );
  } catch {
    return false;
  }
}

/**
 * Extracts one Kalshi and one Polymarket contract from an Oddpool table row.
 *
 * @param row - Arbitrage opportunity row containing public venue links.
 * @returns Supported cross-venue contract pair, or null for other venue mixes.
 */
export function readOddpoolContractPair(
  row: HTMLTableRowElement,
): OddpoolContractPair | null {
  const linksCell = row.cells.item(row.cells.length - 1);
  if (!linksCell) {
    return null;
  }
  const marketUrls = Array.from(
    linksCell.querySelectorAll<HTMLAnchorElement>("a[href]"),
  )
    .map((link) => link.href)
    .filter((url) => url.length > 0);
  const kalshiUrl = marketUrls.find((url) =>
    isMarketUrlForVenue(url, "kalshi"),
  );
  const polymarketUrl = marketUrls.find((url) =>
    isMarketUrlForVenue(url, "polymarket"),
  );
  return kalshiUrl && polymarketUrl ? { kalshiUrl, polymarketUrl } : null;
}

/**
 * Creates one site-matched button that opens a prefilled comparison.
 *
 * @param documentReference - Owning page document.
 * @param pair - Cross-venue contracts represented by the row.
 * @param openComparison - Explicit click callback that opens FinePredict.
 * @param referenceLink - Existing Oddpool link whose styling should be reused.
 * @returns FinePredict comparison button.
 */
export function createOddpoolCompareAction(
  documentReference: Document,
  pair: OddpoolContractPair,
  openComparison: OpenFinePredictComparison,
  referenceLink?: HTMLAnchorElement,
): HTMLButtonElement {
  const button = documentReference.createElement("button");
  button.type = "button";
  button.textContent = "Compare";
  button.setAttribute(ODDPOOL_COMPARE_ACTION_ATTRIBUTE, "true");
  button.setAttribute(
    "aria-label",
    "Compare this Kalshi and Polymarket contract pair with FinePredict",
  );
  button.title = "Compare contract fine print in FinePredict";
  button.className =
    referenceLink?.className ??
    "inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium";
  Object.assign(button.style, {
    color: "#0a6b47",
    cursor: "pointer",
    whiteSpace: "nowrap",
  });
  button.addEventListener("click", () => {
    openComparison(
      buildFinePredictAnalysisUrl(pair.polymarketUrl, pair.kalshiUrl),
    );
  });
  return button;
}

/**
 * Adds comparison controls to every supported Oddpool opportunity row.
 *
 * @param documentReference - Oddpool dashboard document.
 * @param openComparison - Explicit click callback that opens FinePredict.
 * @returns Number of newly added comparison controls.
 */
export function addOddpoolCompareActions(
  documentReference: Document,
  openComparison: OpenFinePredictComparison,
): number {
  let addedActionCount = 0;
  const rows = documentReference.querySelectorAll<HTMLTableRowElement>(
    "main table tbody tr",
  );
  for (const row of rows) {
    const linksCell = row.cells.item(row.cells.length - 1);
    if (
      !linksCell ||
      linksCell.querySelector(`[${ODDPOOL_COMPARE_ACTION_ATTRIBUTE}]`)
    ) {
      continue;
    }
    const pair = readOddpoolContractPair(row);
    if (!pair) {
      continue;
    }
    const existingLink = linksCell.querySelector<HTMLAnchorElement>("a[href]");
    const actionContainer = existingLink?.parentElement ?? linksCell;
    actionContainer.append(
      createOddpoolCompareAction(
        documentReference,
        pair,
        openComparison,
        existingLink ?? undefined,
      ),
    );
    addedActionCount += 1;
  }
  return addedActionCount;
}

/**
 * Removes every extension-owned comparison control from the document.
 *
 * @param documentReference - Page document to clean.
 * @returns Nothing.
 */
export function removeOddpoolCompareActions(documentReference: Document): void {
  for (const action of documentReference.querySelectorAll(
    `[${ODDPOOL_COMPARE_ACTION_ATTRIBUTE}]`,
  )) {
    action.remove();
  }
}
