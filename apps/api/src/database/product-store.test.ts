import { describe, expect, it } from "vitest";

import {
  ACTIVE_MARKET_LIMIT,
  isSubscriptionEntitled,
} from "./product-store.js";

describe("subscription entitlements", () => {
  it("allows active and trialing subscriptions", () => {
    expect(isSubscriptionEntitled("active")).toBe(true);
    expect(isSubscriptionEntitled("trialing")).toBe(true);
  });

  it("rejects inactive billing states", () => {
    for (const status of ["inactive", "past_due", "canceled", "unpaid"]) {
      expect(isSubscriptionEntitled(status)).toBe(false);
    }
  });

  it("uses the promised 25-market limit", () => {
    expect(ACTIVE_MARKET_LIMIT).toBe(25);
  });
});
