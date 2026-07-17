import { timingSafeEqual } from "node:crypto";

import { fromNodeHeaders } from "better-auth/node";
import type { NextFunction, Request, Response } from "express";

import type { AuthRuntime, AuthenticatedUser } from "../auth.js";

/** Express response locals used by authenticated FinePredict routes. */
export interface FinePredictLocals {
  user: AuthenticatedUser;
}

/**
 * Requires a Better Auth session and exposes its user through response locals.
 *
 * @param authRuntime - Configured Better Auth bridge, or null when disabled.
 * @returns Express middleware enforcing authentication.
 */
export function requireAuthenticatedUser(
  authRuntime: AuthRuntime | null | undefined,
) {
  return async (
    request: Request,
    response: Response<unknown, FinePredictLocals>,
    next: NextFunction,
  ): Promise<void> => {
    if (!authRuntime) {
      response.status(503).json({
        error: `Account access is not configured on this deployment.`,
      });
      return;
    }
    try {
      const user = await authRuntime.getUser(fromNodeHeaders(request.headers));
      if (!user) {
        response.status(401).json({ error: `Sign in is required.` });
        return;
      }
      response.locals.user = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Checks either an authenticated administrator or emergency automation key.
 *
 * @param request - Incoming Express request.
 * @param authRuntime - Configured Better Auth bridge.
 * @param expectedEmergencyKey - Server-only automation key.
 * @returns True only for an authorized administrator.
 */
export async function isAdministratorRequest(
  request: Request,
  authRuntime: AuthRuntime | null | undefined,
  expectedEmergencyKey: string,
): Promise<boolean> {
  if (authRuntime) {
    const user = await authRuntime.getUser(fromNodeHeaders(request.headers));
    if (user?.role === "admin") {
      return true;
    }
  }
  const suppliedKey = request.header("x-admin-api-key") ?? "";
  if (
    !expectedEmergencyKey ||
    suppliedKey.length !== expectedEmergencyKey.length
  ) {
    return false;
  }
  return timingSafeEqual(
    Buffer.from(suppliedKey),
    Buffer.from(expectedEmergencyKey),
  );
}
