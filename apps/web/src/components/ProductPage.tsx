import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";

/** Properties for a finance-style product page header. */
interface ProductHeaderProps {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}

/**
 * Renders a consistent compact header for product and research pages.
 *
 * @param props - Header copy and optional actions.
 * @returns Product page header.
 */
export function ProductHeader({
  actions,
  description,
  eyebrow,
  title,
}: ProductHeaderProps) {
  return (
    <header className="product-page-header">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="product-header-actions">{actions}</div> : null}
    </header>
  );
}

/**
 * Renders account product navigation shared by authenticated surfaces.
 *
 * @returns Account section navigation.
 */
export function AccountNavigation() {
  return (
    <nav className="account-navigation" aria-label="Account navigation">
      <NavLink to="/account">Subscription</NavLink>
      <NavLink to="/watchlists">Watchlists</NavLink>
      <NavLink to="/notifications">Notifications</NavLink>
      <NavLink to="/developers">Developer API</NavLink>
    </nav>
  );
}

/** Properties for a signed-out account prompt. */
interface SignInRequiredProps {
  message?: string | undefined;
}

/**
 * Renders a direct sign-in prompt for protected product pages.
 *
 * @param props - Optional contextual message.
 * @returns Sign-in callout.
 */
export function SignInRequired({ message }: SignInRequiredProps) {
  return (
    <div className="product-empty-state">
      <h2>Sign in required</h2>
      <p>{message ?? "Use a secure email link to access this page."}</p>
      <Link className="primary-button inline-button" to="/account/login">
        Sign in by email
      </Link>
    </div>
  );
}

/**
 * Converts an unknown failure into safe page copy.
 *
 * @param error - Unknown caught value.
 * @param fallback - Message used for non-Error values.
 * @returns Human-readable error string.
 */
export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
