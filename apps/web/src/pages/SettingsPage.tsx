import type { FinePredictModel, PublicSettings } from "@finepredict/shared";
import { Check, KeyRound, LockKeyhole, Save, Sparkles } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { getSettings, updateSettings } from "../api.js";

/** Administrator-only system settings page. */
export function SettingsPage() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [model, setModel] = useState<FinePredictModel>("gpt-5.6-luna");
  const [adminKey, setAdminKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getSettings()
      .then((loadedSettings) => {
        setSettings(loadedSettings);
        setModel(loadedSettings.model);
      })
      .catch((caughtError: unknown) =>
        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Settings could not be loaded.",
        ),
      );
  }, []);

  /**
   * Saves the selected model through the administrator-protected API.
   *
   * @param event - Settings form submission event.
   * @returns Promise resolved after success or error feedback.
   */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updatedSettings = await updateSettings(model, adminKey);
      setSettings(updatedSettings);
      setAdminKey("");
      setMessage("System model updated. New analyses will use this setting.");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Settings could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-page">
      <div className="settings-heading">
        <span className="eyebrow">
          <LockKeyhole size={14} /> Administrator area
        </span>
        <h1>System settings</h1>
        <p>
          Control the model used to explain deterministic contract findings. The
          administrator key is checked by the API and is never stored in the
          browser.
        </p>
      </div>

      <form
        className="settings-card"
        onSubmit={(event) => void handleSubmit(event)}
      >
        <div className="settings-card-header">
          <div className="feature-icon">
            <Sparkles />
          </div>
          <div>
            <span>Contract explanation</span>
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
          Luna is the default: it keeps routine report cost low. Deterministic
          checks always run before the model and remain visible if the API call
          fails.
        </p>
        <label htmlFor="admin-key">Administrator API key</label>
        <div className="url-input-wrap">
          <KeyRound size={18} />
          <input
            id="admin-key"
            type="password"
            value={adminKey}
            onChange={(event) => setAdminKey(event.target.value)}
            placeholder="Enter the server administrator key"
            autoComplete="current-password"
            required
          />
        </div>
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
  if (model === "gpt-5.6-luna") {
    return "GPT-5.6 Luna — low cost (recommended)";
  }
  if (model === "gpt-5.6-terra") {
    return "GPT-5.6 Terra — balanced";
  }
  return "GPT-5.6 — highest capability";
}
