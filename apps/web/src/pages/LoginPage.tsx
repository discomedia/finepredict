import { Mail } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";

import { requestMagicLink } from "../api.js";
import { ProductHeader, errorMessage } from "../components/ProductPage.js";

/** Passwordless FinePredict account sign-in page. */
export function LoginPage() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Requests a one-time email sign-in link.
   *
   * @param event - Sign-in form submission.
   * @returns Promise resolved after request feedback is shown.
   */
  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      await requestMagicLink(email, `${window.location.origin}/account`);
      setSent(true);
    } catch (caughtError) {
      setError(
        errorMessage(caughtError, "The sign-in link could not be sent."),
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="product-page product-page-narrow">
      <ProductHeader
        eyebrow="Account access"
        title="Sign in"
        description="FinePredict uses one-time email links. No password is stored."
      />
      {sent ? (
        <div className="product-panel auth-confirmation">
          <Mail size={20} />
          <div>
            <h2>Check your email</h2>
            <p>A sign-in link was sent to {email}.</p>
          </div>
        </div>
      ) : (
        <form
          className="product-panel product-form"
          onSubmit={(event) => void handleSubmit(event)}
        >
          <label htmlFor="account-email">Email address</label>
          <input
            id="account-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            placeholder="name@company.com"
            required
          />
          {error ? <div className="form-error">{error}</div> : null}
          <button className="primary-button" type="submit" disabled={sending}>
            {sending ? "Sending…" : "Email sign-in link"}
          </button>
          <p className="field-help">
            By continuing, you agree to receive an authentication email from
            FinePredict.
          </p>
        </form>
      )}
      <Link className="product-back-link" to="/">
        Return to analysis
      </Link>
    </section>
  );
}
