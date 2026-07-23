import { describe, expect, it } from "vitest";

import {
  buildFinePredictAnalysisUrl,
  FINEPREDICT_COMPARISON_URL_PARAMETER,
  isMarketUrlForVenue,
  isSupportedMarketUrl,
} from "./market-url.js";

describe("isSupportedMarketUrl", () => {
  it("accepts contract pages on both supported platforms", () => {
    expect(
      isSupportedMarketUrl("https://polymarket.com/event/will-example-happen"),
    ).toBe(true);
    expect(
      isSupportedMarketUrl("https://kalshi.com/markets/example/example-market"),
    ).toBe(true);
  });

  it("rejects non-market and lookalike pages", () => {
    expect(isSupportedMarketUrl("https://polymarket.com/about")).toBe(false);
    expect(
      isSupportedMarketUrl("https://polymarket.com.evil.example/event/test"),
    ).toBe(false);
    expect(isSupportedMarketUrl("not a url")).toBe(false);
  });

  it("identifies the supported venue without accepting lookalikes", () => {
    expect(
      isMarketUrlForVenue(
        "https://polymarket.com/event/will-example-happen",
        "polymarket",
      ),
    ).toBe(true);
    expect(
      isMarketUrlForVenue(
        "https://polymarket.com/event/will-example-happen",
        "kalshi",
      ),
    ).toBe(false);
    expect(
      isMarketUrlForVenue(
        "https://kalshi.com.evil.example/markets/example",
        "kalshi",
      ),
    ).toBe(false);
  });
});

describe("buildFinePredictAnalysisUrl", () => {
  it("prefills the source market without an automatic-analysis flag", () => {
    const marketUrl = "https://polymarket.com/event/will-example-happen";
    const destination = new URL(buildFinePredictAnalysisUrl(marketUrl));
    expect(destination.origin).toBe("https://finepredict.netlify.app");
    expect(destination.searchParams.get("marketUrl")).toBe(marketUrl);
    expect(destination.searchParams.has("analyze")).toBe(false);
  });

  it("prefills both contracts and starts the explicitly requested comparison", () => {
    const polymarketUrl = "https://polymarket.com/event/will-example-happen";
    const kalshiUrl = "https://kalshi.com/markets/example/example-market";
    const destination = new URL(
      buildFinePredictAnalysisUrl(polymarketUrl, kalshiUrl),
    );
    expect(destination.searchParams.get("marketUrl")).toBe(polymarketUrl);
    expect(
      destination.searchParams.get(FINEPREDICT_COMPARISON_URL_PARAMETER),
    ).toBe(kalshiUrl);
    expect(destination.searchParams.get("analyze")).toBe("1");
  });
});
