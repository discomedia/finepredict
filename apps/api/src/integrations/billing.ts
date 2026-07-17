import Stripe from "stripe";

import type { AppConfig } from "../config.js";

/** Subscription data extracted from a verified Stripe webhook. */
export interface StripeSubscriptionUpdate {
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  status: string;
  userId: string | null;
  product: "watchlists" | "developer_api";
}

/** Stripe-backed billing operations used by HTTP and cron services. */
export class BillingService {
  public readonly configured: boolean;
  public readonly developerApiConfigured: boolean;
  public readonly watchlistConfigured: boolean;
  private readonly stripe: Stripe | null;

  /**
   * Creates a billing adapter that remains disabled without provider keys.
   *
   * @param config - Validated application configuration.
   */
  public constructor(private readonly config: AppConfig) {
    this.watchlistConfigured = Boolean(
      config.stripeSecretKey && config.stripeWatchlistPriceId,
    );
    this.developerApiConfigured = Boolean(
      config.stripeSecretKey &&
      config.stripeApiPriceId &&
      config.stripeApiMeterEventName,
    );
    this.configured = this.watchlistConfigured || this.developerApiConfigured;
    this.stripe = config.stripeSecretKey
      ? new Stripe(config.stripeSecretKey)
      : null;
  }

  /**
   * Creates a Stripe Checkout session for the watchlist subscription.
   *
   * @param input - Authenticated customer and optional existing Stripe ID.
   * @returns Short-lived Stripe-hosted checkout URL.
   */
  public async createWatchlistCheckout(input: {
    email: string;
    stripeCustomerId: string | null;
    userId: string;
  }): Promise<string> {
    const stripe = this.requireStripe();
    if (!this.config.stripeWatchlistPriceId) {
      throw new Error(
        `FinePredict billing: STRIPE_WATCHLIST_PRICE_ID is not configured.`,
      );
    }
    const session = await stripe.checkout.sessions.create({
      ...(input.stripeCustomerId
        ? { customer: input.stripeCustomerId }
        : { customer_email: input.email }),
      allow_promotion_codes: true,
      cancel_url: `${this.config.appUrl}/account?billing=cancelled`,
      client_reference_id: input.userId,
      line_items: [{ price: this.config.stripeWatchlistPriceId, quantity: 1 }],
      metadata: { userId: input.userId },
      mode: "subscription",
      subscription_data: {
        metadata: { billingProduct: "watchlists", userId: input.userId },
      },
      success_url: `${this.config.appUrl}/account?billing=success`,
    });
    if (!session.url) {
      throw new Error(`FinePredict billing: Stripe returned no checkout URL.`);
    }
    return session.url;
  }

  /**
   * Creates a separate metered developer API subscription checkout.
   *
   * @param input - Authenticated customer and optional existing Stripe ID.
   * @returns Short-lived Stripe-hosted checkout URL.
   */
  public async createDeveloperApiCheckout(input: {
    email: string;
    stripeCustomerId: string | null;
    userId: string;
  }): Promise<string> {
    const stripe = this.requireStripe();
    if (!this.config.stripeApiPriceId) {
      throw new Error(
        `FinePredict billing: STRIPE_API_PRICE_ID is not configured.`,
      );
    }
    const session = await stripe.checkout.sessions.create({
      ...(input.stripeCustomerId
        ? { customer: input.stripeCustomerId }
        : { customer_email: input.email }),
      cancel_url: `${this.config.appUrl}/developers?billing=cancelled`,
      client_reference_id: input.userId,
      line_items: [{ price: this.config.stripeApiPriceId }],
      metadata: { billingProduct: "developer_api", userId: input.userId },
      mode: "subscription",
      subscription_data: {
        metadata: { billingProduct: "developer_api", userId: input.userId },
      },
      success_url: `${this.config.appUrl}/developers?billing=success`,
    });
    if (!session.url) {
      throw new Error(`FinePredict billing: Stripe returned no checkout URL.`);
    }
    return session.url;
  }

  /**
   * Creates a Stripe customer-portal session.
   *
   * @param stripeCustomerId - Existing Stripe customer ID.
   * @returns Short-lived Stripe-hosted portal URL.
   */
  public async createCustomerPortal(stripeCustomerId: string): Promise<string> {
    const session = await this.requireStripe().billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${this.config.appUrl}/account`,
    });
    return session.url;
  }

  /**
   * Verifies a raw Stripe webhook payload.
   *
   * @param body - Unmodified request bytes.
   * @param signature - Stripe-Signature header value.
   * @returns Verified Stripe event.
   */
  public constructWebhookEvent(body: Buffer, signature: string): Stripe.Event {
    if (!this.config.stripeWebhookSecret) {
      throw new Error(
        `FinePredict billing: STRIPE_WEBHOOK_SECRET is not configured.`,
      );
    }
    return this.requireStripe().webhooks.constructEvent(
      body,
      signature,
      this.config.stripeWebhookSecret,
    );
  }

  /**
   * Extracts entitlement data from a verified Stripe subscription event.
   *
   * @param event - Verified Stripe event.
   * @returns Subscription update, or null for unrelated events.
   */
  public extractSubscriptionUpdate(
    event: Stripe.Event,
  ): StripeSubscriptionUpdate | null {
    if (
      event.type !== "customer.subscription.created" &&
      event.type !== "customer.subscription.updated" &&
      event.type !== "customer.subscription.deleted"
    ) {
      return null;
    }
    const subscription = event.data.object;
    const customerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id;
    const itemPeriodEnds = subscription.items.data
      .map((item) => item.current_period_end)
      .filter((value): value is number => typeof value === "number");
    const currentPeriodEndSeconds = itemPeriodEnds.at(0) ?? null;
    return {
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      currentPeriodEnd: currentPeriodEndSeconds
        ? new Date(currentPeriodEndSeconds * 1000)
        : null,
      status: subscription.status,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      userId: subscription.metadata.userId || null,
      product:
        subscription.metadata.billingProduct === "developer_api"
          ? "developer_api"
          : "watchlists",
    };
  }

  /**
   * Reports one pre-aggregated usage row to a Stripe billing meter.
   *
   * @param input - Stripe customer, units, day, and stable identifier.
   * @returns Stripe meter-event identifier.
   */
  public async reportApiUsage(input: {
    customerId: string;
    identifier: string;
    units: number;
    usageDate: string;
  }): Promise<string> {
    if (!this.config.stripeApiMeterEventName) {
      throw new Error(
        `FinePredict billing: STRIPE_API_METER_EVENT_NAME is not configured.`,
      );
    }
    const timestamp = Math.floor(
      new Date(`${input.usageDate}T12:00:00.000Z`).getTime() / 1000,
    );
    const event = await this.requireStripe().billing.meterEvents.create({
      event_name: this.config.stripeApiMeterEventName,
      identifier: input.identifier,
      payload: {
        stripe_customer_id: input.customerId,
        value: String(input.units),
      },
      timestamp,
    });
    return event.identifier;
  }

  /**
   * Returns the configured Stripe client or throws an actionable error.
   *
   * @returns Configured Stripe SDK client.
   */
  private requireStripe(): Stripe {
    if (!this.stripe) {
      throw new Error(
        `FinePredict billing: STRIPE_SECRET_KEY is not configured.`,
      );
    }
    return this.stripe;
  }
}
