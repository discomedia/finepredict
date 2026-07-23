import { fireEvent } from "@testing-library/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addOddpoolCompareActions,
  isOddpoolArbitrageDashboardUrl,
  ODDPOOL_COMPARE_ACTION_ATTRIBUTE,
  readOddpoolContractPair,
} from "./oddpool.js";

/**
 * Creates one Oddpool-like row with the supplied venue links.
 *
 * @param marketUrls - Public venue URLs to add to the Links cell.
 * @returns Table row attached to the test document.
 */
function createOddpoolRow(marketUrls: string[]): HTMLTableRowElement {
  const row = document.createElement("tr");
  row.innerHTML = `<td>Event</td><td><div class="flex items-center gap-1">${marketUrls
    .map(
      (marketUrl) =>
        `<a class="inline-flex rounded-md border px-2 py-1 text-xs" href="${marketUrl}">Venue</a>`,
    )
    .join("")}</div></td>`;
  document.querySelector("tbody")?.append(row);
  return row;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("isOddpoolArbitrageDashboardUrl", () => {
  it("accepts only the production arbitrage dashboard", () => {
    expect(
      isOddpoolArbitrageDashboardUrl("https://www.oddpool.com/arb-dashboard"),
    ).toBe(true);
    expect(
      isOddpoolArbitrageDashboardUrl("https://www.oddpool.com/dashboard"),
    ).toBe(false);
    expect(
      isOddpoolArbitrageDashboardUrl(
        "https://www.oddpool.com.evil.example/arb-dashboard",
      ),
    ).toBe(false);
  });
});

describe("Oddpool comparison actions", () => {
  it("extracts the supported pair regardless of link order", () => {
    document.body.innerHTML = "<main><table><tbody></tbody></table></main>";
    const row = createOddpoolRow([
      "https://kalshi.com/markets/example/example-contract",
      "https://polymarket.com/event/example-contract",
    ]);
    expect(readOddpoolContractPair(row)).toEqual({
      kalshiUrl: "https://kalshi.com/markets/example/example-contract",
      polymarketUrl: "https://polymarket.com/event/example-contract",
    });
  });

  it("adds one explicit Compare button and never duplicates it", () => {
    document.body.innerHTML = "<main><table><tbody></tbody></table></main>";
    createOddpoolRow([
      "https://kalshi.com/markets/example/example-contract",
      "https://polymarket.com/event/example-contract",
    ]);
    const openComparison = vi.fn<(url: string) => void>();

    expect(addOddpoolCompareActions(document, openComparison)).toBe(1);
    expect(addOddpoolCompareActions(document, openComparison)).toBe(0);
    const button = document.querySelector<HTMLButtonElement>(
      `[${ODDPOOL_COMPARE_ACTION_ATTRIBUTE}]`,
    );
    expect(button?.textContent).toBe("⚖️ Compare");

    fireEvent.click(button as HTMLButtonElement);
    expect(openComparison).toHaveBeenCalledTimes(1);
    const destination = new URL(openComparison.mock.calls[0]?.[0] ?? "");
    expect(destination.searchParams.get("marketUrl")).toBe(
      "https://polymarket.com/event/example-contract",
    );
    expect(destination.searchParams.get("comparisonMarketUrl")).toBe(
      "https://kalshi.com/markets/example/example-contract",
    );
    expect(destination.searchParams.get("analyze")).toBe("1");
  });

  it("does not add a comparison for unsupported venue pairs", () => {
    document.body.innerHTML = "<main><table><tbody></tbody></table></main>";
    createOddpoolRow([
      "https://polymarket.com/event/example-contract",
      "https://app.opinion.trade/detail?topicId=1",
    ]);
    expect(addOddpoolCompareActions(document, vi.fn())).toBe(0);
  });
});
