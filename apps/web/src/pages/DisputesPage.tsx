import type { DisputeCase } from "@finepredict/shared";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { listDisputes } from "../api.js";
import { ProductHeader, errorMessage } from "../components/ProductPage.js";

/** Public historical dispute research index. */
export function DisputesPage() {
  const [disputes, setDisputes] = useState<DisputeCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listDisputes()
      .then(setDisputes)
      .catch((caughtError: unknown) =>
        setError(
          errorMessage(caughtError, "Dispute cases could not be loaded."),
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="product-page">
      <ProductHeader
        eyebrow="Case archive"
        title="Settlement disputes"
        description="Published cases with archived wording, outcomes and original source evidence."
      />
      {loading ? <div className="product-loading">Loading cases…</div> : null}
      {error ? <div className="form-error">{error}</div> : null}
      {!loading && !error && !disputes.length ? (
        <div className="product-empty-state">
          <h2>No published cases</h2>
          <p>
            Reviewed dispute cases will appear here when source evidence is
            complete.
          </p>
        </div>
      ) : null}
      <div className="dispute-index">
        {disputes.map((dispute) => (
          <Link
            className="dispute-index-row"
            to={`/disputes/${dispute.slug}`}
            key={dispute.id}
          >
            <span className={`platform-badge platform-${dispute.platform}`}>
              {dispute.platform}
            </span>
            <div>
              <h2>{dispute.title}</h2>
              <blockquote>“{dispute.disputedWording}”</blockquote>
              <div className="tag-list">
                {dispute.wordingTags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </div>
            <time>
              {dispute.publishedAt
                ? new Date(dispute.publishedAt).toLocaleDateString("en-US")
                : "Published"}
            </time>
            <ArrowRight size={16} />
          </Link>
        ))}
      </div>
    </section>
  );
}
