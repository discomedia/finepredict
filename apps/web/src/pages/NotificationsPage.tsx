import type { AlertEvent } from "@finepredict/shared";
import { Check, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

import {
  isAuthenticationError,
  listNotifications,
  markNotificationRead,
} from "../api.js";
import {
  AccountNavigation,
  ProductHeader,
  SignInRequired,
  errorMessage,
} from "../components/ProductPage.js";

/** Monitoring notification inbox. */
export function NotificationsPage() {
  const [notifications, setNotifications] = useState<AlertEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listNotifications()
      .then(setNotifications)
      .catch((caughtError: unknown) => {
        setSignedOut(isAuthenticationError(caughtError));
        setError(
          errorMessage(caughtError, "Notifications could not be loaded."),
        );
      })
      .finally(() => setLoading(false));
  }, []);

  /**
   * Marks one alert read and updates local state.
   *
   * @param notificationId - Alert ID.
   * @returns Promise resolved after the update.
   */
  async function handleMarkRead(notificationId: string): Promise<void> {
    try {
      await markNotificationRead(notificationId);
      const readAt = new Date().toISOString();
      setNotifications((current) =>
        current.map((item) =>
          item.id === notificationId ? { ...item, readAt } : item,
        ),
      );
    } catch (caughtError) {
      setError(
        errorMessage(caughtError, "The notification could not be updated."),
      );
    }
  }

  return (
    <section className="product-page">
      <ProductHeader
        eyebrow="Monitoring"
        title="Notifications"
        description="Rule, deadline, source and settlement changes from monitored markets."
      />
      <AccountNavigation />
      {loading ? (
        <div className="product-loading">Loading notifications…</div>
      ) : null}
      {!loading && signedOut ? (
        <SignInRequired message={error ?? undefined} />
      ) : null}
      {error && !signedOut ? <div className="form-error">{error}</div> : null}
      {!loading && !error && !notifications.length ? (
        <div className="product-empty-state">
          <h2>No notifications</h2>
          <p>Monitoring events will appear here.</p>
        </div>
      ) : null}
      <div className="notification-list">
        {notifications.map((notification) => (
          <article
            className={`notification-row${notification.readAt ? " is-read" : ""}`}
            key={notification.id}
          >
            <div>
              <span className="panel-label">
                {formatEventType(notification.type)}
              </span>
              <h2>{notification.title}</h2>
              <p>{notification.detail}</p>
            </div>
            <time>
              {new Date(notification.createdAt).toLocaleString("en-US")}
            </time>
            <div className="notification-actions">
              <a href={notification.marketUrl} target="_blank" rel="noreferrer">
                Market <ExternalLink size={12} />
              </a>
              {!notification.readAt ? (
                <button
                  type="button"
                  onClick={() => void handleMarkRead(notification.id)}
                >
                  <Check size={13} /> Mark read
                </button>
              ) : (
                <span>Read</span>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

/**
 * Formats a machine alert type for display.
 *
 * @param value - Alert event type.
 * @returns Sentence-case event label.
 */
function formatEventType(value: string): string {
  return value.replaceAll("_", " ");
}
