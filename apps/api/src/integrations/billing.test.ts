import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../config.js";
import { BillingService } from "./billing.js";

const WEBHOOK_SECRET = "whsec_finepredict_test_secret";

/**
 * Creates a valid Stripe signature header for a fixed JSON payload.
 *
 * @param payload - Raw webhook JSON.
 * @param timestamp - Unix timestamp included in the signature.
 * @returns Stripe-Signature header value.
 */
function signStripePayload(payload: string, timestamp: number): string {
  const signature = createHmac("sha256", WEBHOOK_SECRET)
    .update(`${String(timestamp)}.${payload}`)
    .digest("hex");
  return `t=${String(timestamp)},v1=${signature}`;
}

describe("Stripe webhook verification", () => {
  it("accepts an unmodified signed body and rejects a changed body", () => {
    const service = new BillingService(
      loadConfig({
        STRIPE_API_KEY: "sk_test_placeholder",
        STRIPE_WATCHLIST_PRICE_ID: "price_watchlists",
        STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
      }),
    );
    const payload = JSON.stringify({
      api_version: "2026-06-30.clover",
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: "obj_test" } },
      id: "evt_test",
      livemode: false,
      object: "event",
      pending_webhooks: 1,
      request: null,
      type: "test.event",
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signStripePayload(payload, timestamp);

    expect(
      service.constructWebhookEvent(Buffer.from(payload), signature).id,
    ).toBe("evt_test");
    expect(() =>
      service.constructWebhookEvent(Buffer.from(`${payload} `), signature),
    ).toThrow();
  });
});
