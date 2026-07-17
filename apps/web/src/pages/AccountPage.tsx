import type { AccountUser, SubscriptionSummary } from "@finepredict/shared";
import { CreditCard, LogOut, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import {
  createBillingCheckout,
  createBillingPortal,
  getCurrentAccount,
  getSubscription,
  isAuthenticationError,
  signOutAccount,
} from "../api.js";
import {
  AccountNavigation,
  ProductHeader,
  SignInRequired,
  errorMessage,
} from "../components/ProductPage.js";

/** Account and subscription management page. */
export function AccountPage() {
  const [account, setAccount] = useState<AccountUser | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [billingAction, setBillingAction] = useState<
    "checkout" | "portal" | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([getCurrentAccount(), getSubscription()])
      .then(([loadedAccount, loadedSubscription]) => {
        setAccount(loadedAccount);
        setSubscription(loadedSubscription);
      })
      .catch((caughtError: unknown) => {
        setSignedOut(isAuthenticationError(caughtError));
        setError(
          errorMessage(caughtError, "Account details could not be loaded."),
        );
      })
      .finally(() => setLoading(false));
  }, []);

  /**
   * Opens a Stripe-hosted billing flow.
   *
   * @param action - Checkout for a new subscription or portal for management.
   * @returns Promise resolved after navigation or feedback.
   */
  async function openBilling(action: "checkout" | "portal"): Promise<void> {
    setBillingAction(action);
    setError(null);
    try {
      const url =
        action === "checkout"
          ? await createBillingCheckout()
          : await createBillingPortal();
      window.location.assign(url);
    } catch (caughtError) {
      setError(errorMessage(caughtError, "Billing could not be opened."));
      setBillingAction(null);
    }
  }

  /**
   * Ends the current session and returns to sign-in.
   *
   * @returns Promise resolved after navigation or error feedback.
   */
  async function handleSignOut(): Promise<void> {
    setError(null);
    try {
      await signOutAccount();
      window.location.assign("/account/login");
    } catch (caughtError) {
      setError(errorMessage(caughtError, "The session could not be ended."));
    }
  }

  return (
    <section className="product-page">
      <ProductHeader
        eyebrow="Account"
        title="Subscription"
        description="Manage market monitoring, billing and account access."
        actions={
          account?.role === "admin" ? (
            <Link className="secondary-button" to="/settings">
              <Settings size={15} /> System settings
            </Link>
          ) : undefined
        }
      />
      <AccountNavigation />
      {loading ? <div className="product-loading">Loading account…</div> : null}
      {!loading && signedOut ? (
        <SignInRequired message={error ?? undefined} />
      ) : null}
      {!loading && !signedOut && error && !account ? (
        <div className="form-error">{error}</div>
      ) : null}
      {account && subscription ? (
        <div className="product-grid account-summary-grid">
          <article className="product-panel">
            <span className="panel-label">Account holder</span>
            <h2>{account.name}</h2>
            <p>{account.email}</p>
            <dl className="data-list">
              <div>
                <dt>Role</dt>
                <dd>{account.role}</dd>
              </div>
              <div>
                <dt>Account ID</dt>
                <dd>{account.id}</dd>
              </div>
            </dl>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void handleSignOut()}
            >
              <LogOut size={14} /> Sign out
            </button>
          </article>
          <article className="product-panel">
            <span className="panel-label">Plan status</span>
            <div className="status-line">
              <h2>
                {subscription.entitled ? "Monitoring active" : "Free reports"}
              </h2>
              <span className={`status-chip status-${subscription.status}`}>
                {subscription.status}
              </span>
            </div>
            <p>
              {subscription.entitled
                ? `Monitor up to ${subscription.activeMarketLimit} active markets.`
                : "Individual contract reports remain free. Subscribe to monitor changes."}
            </p>
            <dl className="data-list">
              <div>
                <dt>Market limit</dt>
                <dd>{subscription.activeMarketLimit}</dd>
              </div>
              <div>
                <dt>Renews / ends</dt>
                <dd>{formatOptionalDate(subscription.currentPeriodEnd)}</dd>
              </div>
              <div>
                <dt>Cancel scheduled</dt>
                <dd>{subscription.cancelAtPeriodEnd ? "Yes" : "No"}</dd>
              </div>
            </dl>
            {error ? <div className="form-error">{error}</div> : null}
            {subscription.providerConfigured ? (
              <button
                className="primary-button"
                type="button"
                disabled={billingAction !== null}
                onClick={() =>
                  void openBilling(
                    subscription.entitled ? "portal" : "checkout",
                  )
                }
              >
                <CreditCard size={16} />
                {billingAction
                  ? "Opening billing…"
                  : subscription.entitled
                    ? "Manage billing"
                    : "Subscribe — US$12/month"}
              </button>
            ) : (
              <p className="field-help">
                Billing is not configured on this deployment.
              </p>
            )}
          </article>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Formats a nullable ISO billing date.
 *
 * @param value - Nullable ISO timestamp.
 * @returns Compact date or an em dash.
 */
function formatOptionalDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString("en-US") : "—";
}
