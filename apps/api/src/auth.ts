import { eq } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

import type { AppConfig } from "./config.js";
import type { FinePredictDatabase } from "./database/client.js";
import { authUsers } from "./database/schema.js";

/** Authenticated account details consumed by Express authorization. */
export interface AuthenticatedUser {
  email: string;
  id: string;
  name: string;
  role: "user" | "admin";
}

/** Authentication bridge exposed to the HTTP application. */
export interface AuthRuntime {
  /**
   * Resolves one Neon Auth bearer token into a FinePredict account.
   *
   * @param authorizationHeader - Incoming Authorization header value.
   * @returns Authenticated account, or null when the token is absent or invalid.
   */
  getUser(
    authorizationHeader: string | undefined,
  ): Promise<AuthenticatedUser | null>;
}

/** UUID claim accepted as a Neon Auth user identifier. */
const NeonAuthUserIdSchema = z.uuid();

/**
 * Creates a Neon Auth JWT verifier backed by the managed JWKS endpoint.
 *
 * @param config - Validated application configuration.
 * @param database - Typed database containing the managed Neon Auth schema.
 * @returns Neon Auth bridge, or null when its required resources are absent.
 */
export function createAuthRuntime(
  config: AppConfig,
  database: FinePredictDatabase | null,
): AuthRuntime | null {
  if (!config.neonAuthBaseUrl || !config.neonAuthJwksUrl || !database) {
    return null;
  }
  const jwks = createRemoteJWKSet(new URL(config.neonAuthJwksUrl));

  return {
    getUser: async (authorizationHeader) => {
      const token = extractBearerToken(authorizationHeader);
      if (!token) {
        return null;
      }
      try {
        const { payload } = await jwtVerify(token, jwks, {
          algorithms: ["EdDSA"],
        });
        const userId = NeonAuthUserIdSchema.safeParse(payload.sub);
        if (!userId.success) {
          return null;
        }
        const [user] = await database
          .select({
            banned: authUsers.banned,
            email: authUsers.email,
            name: authUsers.name,
            role: authUsers.role,
          })
          .from(authUsers)
          .where(eq(authUsers.id, userId.data))
          .limit(1);
        if (!user || user.banned) {
          return null;
        }
        return {
          email: user.email,
          id: userId.data,
          name: user.name,
          role:
            user.role === "admin" ||
            config.adminEmails.includes(user.email.toLowerCase())
              ? "admin"
              : "user",
        };
      } catch {
        return null;
      }
    },
  };
}

/**
 * Extracts a case-insensitive Bearer token without accepting other schemes.
 *
 * @param authorizationHeader - Raw Authorization header value.
 * @returns Token string, or null when the header is malformed.
 */
function extractBearerToken(
  authorizationHeader: string | undefined,
): string | null {
  if (!authorizationHeader) {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(authorizationHeader.trim());
  return match?.[1] ?? null;
}
