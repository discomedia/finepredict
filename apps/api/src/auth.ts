import { betterAuth } from "better-auth";
import { toNodeHandler } from "better-auth/node";
import { magicLink } from "better-auth/plugins";
import type { RequestHandler } from "express";
import { Pool } from "pg";

import type { AppConfig } from "./config.js";
import type { EmailService } from "./integrations/email.js";

/** Authenticated account details consumed by Express authorization. */
export interface AuthenticatedUser {
  email: string;
  id: string;
  name: string;
  role: "user" | "admin";
}

/** Authentication bridge exposed to the HTTP application. */
export interface AuthRuntime {
  close(): Promise<void>;
  getUser(headers: Headers): Promise<AuthenticatedUser | null>;
  handler: RequestHandler;
}

/**
 * Creates Better Auth with Neon persistence and Disco Mail magic links.
 *
 * @param config - Validated application configuration.
 * @param emailService - Email delivery adapter used for magic links.
 * @returns Better Auth bridge, or null when database/auth secret is absent.
 */
export function createAuthRuntime(
  config: AppConfig,
  emailService: EmailService,
): AuthRuntime | null {
  if (!config.databaseUrl || !config.authSecret) {
    return null;
  }
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  const auth = betterAuth({
    appName: "FinePredict",
    baseURL: config.authUrl,
    database: pool,
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({
            data: {
              ...user,
              role: config.adminEmails.includes(user.email.toLowerCase())
                ? "admin"
                : "user",
            },
          }),
        },
      },
    },
    secret: config.authSecret,
    trustedOrigins: config.webOrigin.split(",").map((origin) => origin.trim()),
    user: {
      additionalFields: {
        role: {
          defaultValue: "user",
          input: false,
          required: true,
          type: "string",
        },
      },
    },
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await emailService.send({
            html: `<p>Use this secure link to sign in to FinePredict:</p><p><a href="${escapeHtml(url)}">Sign in to FinePredict</a></p><p>This link expires shortly and can only be used once.</p>`,
            idempotencyKey: `finepredict-magic-link-${hashForEmailKey(url)}`,
            subject: "Your FinePredict sign-in link",
            text: `Sign in to FinePredict: ${url}`,
            to: email,
          });
        },
      }),
    ],
  });
  const handler = toNodeHandler(auth) as unknown as RequestHandler;

  return {
    close: async () => {
      await pool.end();
    },
    getUser: async (headers) => {
      const session = await auth.api.getSession({ headers });
      if (!session) {
        return null;
      }
      const role = session.user.role === "admin" ? "admin" : "user";
      return {
        email: session.user.email,
        id: session.user.id,
        name: session.user.name,
        role,
      };
    },
    handler,
  };
}

/**
 * Escapes dynamic values before embedding them in a minimal HTML email.
 *
 * @param value - Untrusted string.
 * @returns HTML-safe string.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Creates a non-secret bounded key fragment for Disco Mail idempotency.
 *
 * @param value - Magic-link URL.
 * @returns Stable bounded key fragment.
 */
function hashForEmailKey(value: string): string {
  let hash = 0;
  for (const character of value) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash.toString(16);
}
