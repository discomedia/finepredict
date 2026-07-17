import type {
  AccountUser,
  DisputeCase,
  FinePredictModel,
  PublicSettings,
} from "@finepredict/shared";
import {
  Check,
  ExternalLink,
  LockKeyhole,
  Save,
  ShieldCheck,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  getCurrentAccount,
  getSettings,
  isAuthenticationError,
  listAdminDisputes,
  reviewAdminDispute,
  updateSettings,
} from "../api.js";
import { errorMessage } from "../components/ProductPage.js";

/** Administrator-only system settings and dispute review page. */
export function SettingsPage() {
  const [account, setAccount] = useState<AccountUser | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [disputes, setDisputes] = useState<DisputeCase[]>([]);
  const [model, setModel] = useState<FinePredictModel>("gpt-5.6-luna");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const pendingDisputes = useMemo(
    () =>
      disputes.filter((dispute) => dispute.reviewStatus === "pending_review"),
    [disputes],
  );

  useEffect(() => {
    void getCurrentAccount()
      .then(async (loadedAccount) => {
        setAccount(loadedAccount);
        if (loadedAccount.role !== "admin") return;
        const [loadedSettings, loadedDisputes] = await Promise.all([
          getSettings(),
          listAdminDisputes(),
        ]);
        setSettings(loadedSettings);
        setModel(loadedSettings.model);
        setDisputes(loadedDisputes);
      })
      .catch((caughtError: unknown) => {
        setSignedOut(isAuthenticationError(caughtError));
        setError(
          errorMessage(
            caughtError,
            "Administrator settings could not be loaded.",
          ),
        );
      })
      .finally(() => setLoading(false));
  }, []);

  /**
   * Saves the selected model through the administrator session.
   *
   * @param event - Settings form submission event.
   * @returns Promise resolved after success or error feedback.
   */
  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updatedSettings = await updateSettings(model);
      setSettings(updatedSettings);
      setMessage("System model updated. New analyses will use this setting.");
    } catch (caughtError) {
      setError(errorMessage(caughtError, "Settings could not be saved."));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Publishes or rejects a pending dispute using its preserved source fields.
   *
   * @param dispute - Pending dispute case.
   * @param reviewStatus - Administrator publication decision.
   * @returns Promise resolved after queue update or error feedback.
   */
  async function handleReview(
    dispute: DisputeCase,
    reviewStatus: "published" | "rejected",
  ): Promise<void> {
    setReviewingId(dispute.id);
    setError(null);
    try {
      const updated = await reviewAdminDispute(dispute, reviewStatus);
      setDisputes((current) =>
        current.map((item) => (item.id === dispute.id ? updated : item)),
      );
    } catch (caughtError) {
      setError(
        errorMessage(caughtError, "The dispute decision could not be saved."),
      );
    } finally {
      setReviewingId(null);
    }
  }

  if (loading) {
    return (
      <section className="status-page">
        <p>Checking administrator access…</p>
      </section>
    );
  }

  if (!account || account.role !== "admin") {
    return (
      <section className="status-page">
        <span className="report-kicker">Administrator area</span>
        <h1>
          {signedOut ? "Sign in required" : "Administrator access required"}
        </h1>
        <p>{error ?? "This account cannot change system settings."}</p>
        <Link
          className="primary-button inline-button"
          to={signedOut ? "/account/login" : "/account"}
        >
          {signedOut ? "Sign in" : "Return to account"}
        </Link>
      </section>
    );
  }

  return (
    <section className="settings-page admin-settings-page">
      <div className="settings-heading">
        <span className="eyebrow">
          <LockKeyhole size={14} /> Administrator area
        </span>
        <h1>System settings</h1>
        <p>Authenticated administrator session: {account.email}</p>
      </div>

      <form
        className="settings-card"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="settings-card-header">
          <div>
            <span>Analysis runtime</span>
            <h2>OpenAI model</h2>
          </div>
        </div>
        <label htmlFor="model">Analysis model</label>
        <select
          id="model"
          value={model}
          disabled={!settings}
          onChange={(event) => setModel(event.target.value as FinePredictModel)}
        >
          {(settings?.availableModels ?? ["gpt-5.6-luna"]).map(
            (availableModel) => (
              <option key={availableModel} value={availableModel}>
                {modelLabel(availableModel)}
              </option>
            ),
          )}
        </select>
        <p className="field-help">
          Luna is the low-cost default. Rule checks run before the model.
        </p>
        <p className="admin-automation-note">
          <ShieldCheck size={15} /> The ADMIN_API_KEY is reserved for emergency
          automation. It is never requested or stored by this browser.
        </p>
        {message ? (
          <div className="form-success">
            <Check size={16} /> {message}
          </div>
        ) : null}
        {error ? <div className="form-error">{error}</div> : null}
        <button
          className="primary-button"
          type="submit"
          disabled={saving || !settings}
        >
          <Save size={17} /> {saving ? "Saving…" : "Save system setting"}
        </button>
      </form>

      <section className="admin-review-section">
        <div className="section-title-row">
          <div>
            <span className="report-kicker">Editorial review</span>
            <h2>Pending dispute cases</h2>
          </div>
          <span className="finding-count">
            {pendingDisputes.length} pending
          </span>
        </div>
        <p className="section-intro">
          Decisions preserve the case fields and first source exactly as
          imported. No review rationale is generated.
        </p>
        {pendingDisputes.length ? (
          <div className="admin-dispute-list">
            {pendingDisputes.map((dispute) => {
              const source = dispute.sources[0];
              return (
                <article className="admin-dispute-card" key={dispute.id}>
                  <div className="panel-heading-row">
                    <div>
                      <span
                        className={`platform-badge platform-${dispute.platform}`}
                      >
                        {dispute.platform}
                      </span>
                      <h3>{dispute.title}</h3>
                    </div>
                    <span className="status-chip">pending review</span>
                  </div>
                  <dl className="admin-dispute-fields">
                    <div>
                      <dt>Disputed wording</dt>
                      <dd>“{dispute.disputedWording}”</dd>
                    </div>
                    <div>
                      <dt>Outcome</dt>
                      <dd>{dispute.outcome ?? "Not recorded"}</dd>
                    </div>
                    <div>
                      <dt>Checks</dt>
                      <dd>{dispute.checkIds.join(", ") || "None"}</dd>
                    </div>
                    <div>
                      <dt>Tags</dt>
                      <dd>{dispute.wordingTags.join(", ") || "None"}</dd>
                    </div>
                  </dl>
                  {source ? (
                    <div className="admin-source">
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {source.label} <ExternalLink size={12} />
                      </a>
                      {source.quotedText ? (
                        <blockquote>“{source.quotedText}”</blockquote>
                      ) : null}
                      {source.transactionHash ? (
                        <code>{source.transactionHash}</code>
                      ) : null}
                    </div>
                  ) : (
                    <div className="form-error">
                      No preserved source. Review is disabled.
                    </div>
                  )}
                  <div className="admin-review-actions">
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={!source || reviewingId === dispute.id}
                      onClick={() => void handleReview(dispute, "rejected")}
                    >
                      <X size={14} /> Reject
                    </button>
                    <button
                      className="primary-button"
                      type="button"
                      disabled={!source || reviewingId === dispute.id}
                      onClick={() => void handleReview(dispute, "published")}
                    >
                      <Check size={14} /> Publish
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="no-findings">
            No dispute cases are awaiting review.
          </div>
        )}
      </section>
    </section>
  );
}

/**
 * Adds pricing-tier context to a model identifier.
 *
 * @param model - Supported FinePredict model.
 * @returns Human-readable dropdown label.
 */
function modelLabel(model: FinePredictModel): string {
  if (model === "gpt-5.6-luna") return "GPT-5.6 Luna — low cost (recommended)";
  if (model === "gpt-5.6-terra") return "GPT-5.6 Terra — balanced";
  return "GPT-5.6 — highest capability";
}
