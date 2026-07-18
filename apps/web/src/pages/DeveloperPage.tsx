import type {
  ApiKeyScope,
  ApiKeySummary,
  UsageSummary,
} from "@finepredict/shared";
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import {
  createApiKey,
  createDeveloperApiCheckout,
  getPublicApiUrl,
  isAuthenticationError,
  listApiKeys,
  listApiUsage,
  revokeApiKey,
} from "../api.js";
import {
  AccountNavigation,
  ProductHeader,
  SignInRequired,
  errorMessage,
} from "../components/ProductPage.js";

/** Developer API key, usage, and documentation page. */
export function DeveloperPage() {
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([]);
  const [usage, setUsage] = useState<UsageSummary[]>([]);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiKeyScope[]>(["reports:read"]);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [accountLoadFailed, setAccountLoadFailed] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openingBilling, setOpeningBilling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Reloads API keys and usage for the current account.
   *
   * @returns Promise resolved after page state updates.
   */
  async function loadDeveloperAccount(): Promise<void> {
    const [loadedKeys, loadedUsage] = await Promise.all([
      listApiKeys(),
      listApiUsage(),
    ]);
    setApiKeys(loadedKeys);
    setUsage(loadedUsage);
    setAccountLoadFailed(false);
  }

  useEffect(() => {
    void loadDeveloperAccount()
      .catch((caughtError: unknown) => {
        setSignedOut(isAuthenticationError(caughtError));
        setAccountLoadFailed(true);
        setError(
          errorMessage(
            caughtError,
            "Developer account data could not be loaded.",
          ),
        );
      })
      .finally(() => setLoading(false));
  }, []);

  /**
   * Toggles one API-key permission.
   *
   * @param scope - Permission to add or remove.
   * @returns Nothing.
   */
  function toggleScope(scope: ApiKeyScope): void {
    setScopes((current) =>
      current.includes(scope)
        ? current.filter((value) => value !== scope)
        : [...current, scope],
    );
  }

  /**
   * Creates an API key and displays its secret once.
   *
   * @param event - Key form submission.
   * @returns Promise resolved after creation feedback.
   */
  async function handleCreate(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSecret(null);
    try {
      const created = await createApiKey(name, scopes);
      setSecret(created.secret);
      setName("");
      await loadDeveloperAccount();
    } catch (caughtError) {
      setError(errorMessage(caughtError, "The API key could not be created."));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Opens Stripe Checkout for metered developer API access.
   *
   * @returns Promise resolved after navigation or error feedback.
   */
  async function handleApiBilling(): Promise<void> {
    setOpeningBilling(true);
    setError(null);
    try {
      window.location.assign(await createDeveloperApiCheckout());
    } catch (caughtError) {
      setError(errorMessage(caughtError, "API billing could not be opened."));
      setOpeningBilling(false);
    }
  }

  /**
   * Revokes an API key immediately.
   *
   * @param apiKeyId - Key ID.
   * @returns Promise resolved after list refresh.
   */
  async function handleRevoke(apiKeyId: string): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await revokeApiKey(apiKeyId);
      await loadDeveloperAccount();
    } catch (caughtError) {
      setError(errorMessage(caughtError, "The API key could not be revoked."));
    } finally {
      setSaving(false);
    }
  }

  /**
   * Copies the one-time API secret to the clipboard.
   *
   * @returns Promise resolved after clipboard feedback.
   */
  async function copySecret(): Promise<void> {
    if (!secret) return;
    await navigator.clipboard.writeText(secret);
    setCopied(true);
  }

  const loadFailed = accountLoadFailed && !signedOut;
  return (
    <section className="product-page">
      <ProductHeader
        eyebrow="Developer platform"
        title="API access"
        description="Create fine-print reports, retrieve snapshots and query published disputes."
        actions={
          <a
            className="secondary-button"
            href={getPublicApiUrl("/api/openapi.json")}
            target="_blank"
            rel="noreferrer"
          >
            OpenAPI 3.1
          </a>
        }
      />
      <AccountNavigation />
      {loading ? (
        <div className="product-loading">Loading developer account…</div>
      ) : null}
      {signedOut ? <SignInRequired message={error ?? undefined} /> : null}
      {loadFailed ? <div className="form-error">{error}</div> : null}
      {!signedOut && !loading && !loadFailed ? (
        <>
          {error ? <div className="form-error">{error}</div> : null}
          <div className="product-grid developer-grid">
            <form
              className="product-panel product-form"
              onSubmit={(event) => void handleCreate(event)}
            >
              <span className="panel-label">Credentials</span>
              <h2>Create API key</h2>
              <label htmlFor="api-key-name">Key name</label>
              <input
                id="api-key-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                placeholder="Production scanner"
                required
              />
              <fieldset className="scope-fieldset">
                <legend>Scopes</legend>
                {API_SCOPES.map((scope) => (
                  <label key={scope}>
                    <input
                      type="checkbox"
                      checked={scopes.includes(scope)}
                      onChange={() => toggleScope(scope)}
                    />
                    {scope}
                  </label>
                ))}
              </fieldset>
              <button
                className="primary-button"
                type="submit"
                disabled={saving || !scopes.length}
              >
                <KeyRound size={15} /> Create key
              </button>
              <div className="api-billing-note">
                <p>
                  Free accounts include one request per UTC minute and 10 per
                  UTC day. Upgrade for higher metered limits.
                </p>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={openingBilling}
                  onClick={() => void handleApiBilling()}
                >
                  {openingBilling ? "Opening billing…" : "Upgrade API limits"}
                </button>
              </div>
            </form>
            <section className="product-panel">
              <span className="panel-label">Metering</span>
              <h2>Daily usage</h2>
              <div className="usage-bars">
                {usage.length ? (
                  usage.slice(0, 14).map((day) => (
                    <div key={day.date}>
                      <span>{day.date}</span>
                      <strong>
                        {day.billableUnits} unit
                        {day.billableUnits === 1 ? "" : "s"}
                      </strong>
                    </div>
                  ))
                ) : (
                  <p>No API usage recorded.</p>
                )}
              </div>
            </section>
          </div>
          {secret ? (
            <div className="one-time-secret">
              <div>
                <span className="panel-label">Shown once</span>
                <strong>
                  Copy this key now. FinePredict stores only its hash.
                </strong>
              </div>
              <code>{secret}</code>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void copySecret()}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy key"}
              </button>
            </div>
          ) : null}
          <section className="product-panel">
            <span className="panel-label">Credentials</span>
            <h2>API keys</h2>
            <div className="data-table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Prefix</th>
                    <th>Scopes</th>
                    <th>Last used</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {apiKeys.length ? (
                    apiKeys.map((apiKey) => (
                      <tr key={apiKey.id}>
                        <td>{apiKey.name}</td>
                        <td>
                          <code>{apiKey.prefix}…</code>
                        </td>
                        <td>{apiKey.scopes.join(", ")}</td>
                        <td>
                          {apiKey.lastUsedAt
                            ? new Date(apiKey.lastUsedAt).toLocaleString(
                                "en-US",
                              )
                            : "Never"}
                        </td>
                        <td>
                          {apiKey.revokedAt ? (
                            "Revoked"
                          ) : (
                            <button
                              className="icon-button"
                              type="button"
                              aria-label={`Revoke ${apiKey.name}`}
                              disabled={saving}
                              onClick={() => void handleRevoke(apiKey.id)}
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5}>No API keys.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
          <ApiExamples />
        </>
      ) : null}
    </section>
  );
}

/** Supported developer API permissions. */
const API_SCOPES: ApiKeyScope[] = [
  "reports:read",
  "reports:write",
  "markets:read",
  "disputes:read",
];

/**
 * Renders exact curl examples for the versioned developer API.
 *
 * @returns API endpoint examples.
 */
function ApiExamples() {
  const baseUrl = getPublicApiUrl("/api/v1");
  return (
    <section className="product-panel api-examples">
      <span className="panel-label">API v1</span>
      <h2>Examples</h2>
      <p>
        Authenticate with a bearer key. Report creation supports an
        Idempotency-Key header.
      </p>
      <h3>Create a report</h3>
      <pre>{`curl -X POST ${baseUrl}/reports \\
  -H "Authorization: Bearer $FINEPREDICT_API_KEY" \\
  -H "Idempotency-Key: analysis-001" \\
  -H "Content-Type: application/json" \\
  -d '{"urls":["https://polymarket.com/event/example"]}'`}</pre>
      <h3>List published disputes</h3>
      <pre>{`curl ${baseUrl}/disputes \\
  -H "Authorization: Bearer $FINEPREDICT_API_KEY"`}</pre>
      <p className="field-help">
        Responses include request and rate-limit headers. Errors use a stable
        code, message and request ID.
      </p>
    </section>
  );
}
