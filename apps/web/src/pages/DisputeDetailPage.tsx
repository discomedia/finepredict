import type { DisputeCase } from "@finepredict/shared";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { getDispute } from "../api.js";
import { errorMessage } from "../components/ProductPage.js";

/** Public source-backed dispute case detail. */
export function DisputeDetailPage() {
  const { slug = "" } = useParams();
  const [dispute, setDispute] = useState<DisputeCase | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getDispute(slug)
      .then(setDispute)
      .catch((caughtError: unknown) =>
        setError(
          errorMessage(caughtError, "The dispute case could not be loaded."),
        ),
      );
  }, [slug]);

  if (error)
    return (
      <section className="product-page">
        <div className="form-error">{error}</div>
        <Link to="/disputes">Back to cases</Link>
      </section>
    );
  if (!dispute)
    return (
      <section className="product-page">
        <div className="product-loading">Loading case…</div>
      </section>
    );

  return (
    <article className="product-page dispute-detail">
      <Link className="product-back-link" to="/disputes">
        <ArrowLeft size={13} /> All disputes
      </Link>
      <header className="product-page-header">
        <div>
          <span className="eyebrow">
            {dispute.platform} / {dispute.externalId}
          </span>
          <h1>{dispute.title}</h1>
          <p>
            Published{" "}
            {dispute.publishedAt
              ? new Date(dispute.publishedAt).toLocaleDateString("en-US")
              : "case"}
          </p>
        </div>
        <a
          className="secondary-button"
          href={dispute.marketUrl}
          target="_blank"
          rel="noreferrer"
        >
          Original market <ExternalLink size={13} />
        </a>
      </header>
      <div className="product-grid dispute-summary-grid">
        <section className="product-panel">
          <span className="panel-label">Disputed wording</span>
          <blockquote>“{dispute.disputedWording}”</blockquote>
        </section>
        <section className="product-panel">
          <span className="panel-label">Outcome</span>
          <h2>{dispute.outcome ?? "Outcome not recorded"}</h2>
          <div className="tag-list">
            {dispute.wordingTags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
        </section>
      </div>
      <section className="product-panel">
        <div className="panel-heading-row">
          <div>
            <span className="panel-label">Evidence</span>
            <h2>Sources</h2>
          </div>
        </div>
        <div className="source-list">
          {dispute.sources.map((source) => (
            <article key={source.id}>
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.label} <ExternalLink size={12} />
              </a>
              {source.quotedText ? (
                <blockquote>“{source.quotedText}”</blockquote>
              ) : null}
              {source.transactionHash ? (
                <code>{source.transactionHash}</code>
              ) : null}
            </article>
          ))}
        </div>
      </section>
      <section className="product-panel">
        <span className="panel-label">Archived contract</span>
        <h2>Rules at the time</h2>
        <pre className="archived-rules">{dispute.archivedRules}</pre>
      </section>
      {dispute.events.length ? (
        <section className="product-panel">
          <span className="panel-label">Lifecycle</span>
          <h2>Settlement events</h2>
          <ol className="event-timeline">
            {dispute.events.map((event) => (
              <li key={event.id}>
                <time>
                  {new Date(event.occurredAt).toLocaleString("en-US")}
                </time>
                <strong>{event.eventType}</strong>
                <span>{event.rawPlatformState}</span>
                {event.detail ? <p>{event.detail}</p> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </article>
  );
}
