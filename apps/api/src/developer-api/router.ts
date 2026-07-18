import { createHash } from "node:crypto";

import {
  CreateReportRequestSchema,
  MarketPlatformSchema,
  type ApiKeyScope,
} from "@finepredict/shared";
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { ZodError } from "zod";

import type { AppConfig } from "../config.js";
import {
  ProductStore,
  type VerifiedApiKeyRecord,
} from "../database/product-store.js";
import type { ReportStore } from "../database/store.js";
import { ReportService } from "../report-service.js";
import { hashApiKey } from "./api-key.js";

/** Express locals available after developer API authentication. */
interface DeveloperApiLocals {
  apiKey: VerifiedApiKeyRecord;
  remaining: number;
  requestId: string;
}

/** Dependencies used by versioned developer API routes. */
export interface DeveloperApiRouterDependencies {
  config: AppConfig;
  fetchImplementation?: typeof fetch;
  productStore: ProductStore;
  reportStore: ReportStore;
}

/**
 * Creates authenticated, metered, versioned developer API routes.
 *
 * @param dependencies - Persistence, config, and optional upstream fetch.
 * @returns Router mounted under `/api/v1`.
 */
export function createDeveloperApiRouter(
  dependencies: DeveloperApiRouterDependencies,
): Router {
  const router = Router();
  const reportService = new ReportService({
    config: dependencies.config,
    ...(dependencies.fetchImplementation
      ? { fetchImplementation: dependencies.fetchImplementation }
      : {}),
    store: dependencies.reportStore,
  });

  router.use(createRequestContext(dependencies));

  router.post(
    "/reports",
    requireScope("reports:write"),
    async (request, response: Response<unknown, DeveloperApiLocals>, next) => {
      try {
        const input = CreateReportRequestSchema.parse(request.body);
        const idempotencyKey = request.header("idempotency-key")?.trim();
        const requestHash = hashRequestBody(input);
        if (idempotencyKey) {
          const existing =
            await dependencies.productStore.getIdempotentResponse(
              response.locals.apiKey.apiKeyId,
              idempotencyKey,
            );
          if (existing) {
            if (existing.requestHash !== requestHash) {
              sendApiError(
                response,
                409,
                "idempotency_conflict",
                `This Idempotency-Key was already used with a different request.`,
              );
              return;
            }
            response
              .status(existing.responseStatus)
              .json(existing.responseBody);
            return;
          }
        }
        const report = await reportService.createReport(input.urls);
        if (idempotencyKey) {
          await dependencies.productStore.saveIdempotentResponse({
            apiKeyId: response.locals.apiKey.apiKeyId,
            idempotencyKey,
            requestHash,
            responseBody: report,
            responseStatus: 201,
          });
        }
        response.status(201).json(report);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/reports/:slug",
    requireScope("reports:read"),
    async (request, response: Response<unknown, DeveloperApiLocals>, next) => {
      try {
        const report = await reportService.getReport(
          String(request.params.slug),
        );
        if (!report) {
          sendApiError(response, 404, "not_found", `Report not found.`);
          return;
        }
        response.json(report);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/markets/:platform/:externalId/snapshots",
    requireScope("markets:read"),
    async (request, response: Response<unknown, DeveloperApiLocals>, next) => {
      try {
        const platform = MarketPlatformSchema.parse(request.params.platform);
        const snapshots = await dependencies.reportStore.listSnapshots(
          platform,
          String(request.params.externalId),
          100,
        );
        response.json({ items: snapshots, nextCursor: null });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/disputes",
    requireScope("disputes:read"),
    async (_request, response: Response<unknown, DeveloperApiLocals>, next) => {
      try {
        response.json({
          items: await dependencies.productStore.listDisputeCases(false),
          nextCursor: null,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.use(
    (
      error: unknown,
      _request: Request,
      response: Response<unknown, DeveloperApiLocals>,
      _next: NextFunction,
    ) => {
      if (error instanceof ZodError) {
        sendApiError(
          response,
          400,
          "invalid_request",
          `Please check the submitted values.`,
        );
        return;
      }
      sendApiError(
        response,
        500,
        "internal_error",
        `FinePredict could not complete the request.`,
      );
    },
  );

  return router;
}

/**
 * Authenticates a bearer key, consumes one atomic unit, and sets rate headers.
 *
 * @param dependencies - Developer API dependencies.
 * @returns Async Express middleware.
 */
function createRequestContext(dependencies: DeveloperApiRouterDependencies) {
  return async (
    request: Request,
    response: Response<unknown, DeveloperApiLocals>,
    next: NextFunction,
  ): Promise<void> => {
    const requestId =
      request.header("x-request-id")?.trim() || crypto.randomUUID();
    response.locals.requestId = requestId;
    response.setHeader("x-request-id", requestId);
    response.setHeader(
      "x-ratelimit-limit",
      String(dependencies.config.developerApiDailyLimit),
    );
    const authorization = request.header("authorization") ?? "";
    const secret = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length).trim()
      : "";
    if (!secret) {
      sendApiError(
        response,
        401,
        "authentication_required",
        `Use Authorization: Bearer <key>.`,
      );
      return;
    }
    if (dependencies.config.apiKeyHashSecret.length < 32) {
      sendApiError(
        response,
        503,
        "api_not_configured",
        `Developer API key hashing is not configured.`,
      );
      return;
    }
    try {
      const hash = hashApiKey(secret, dependencies.config.apiKeyHashSecret);
      const key = await dependencies.productStore.findApiKeyByHash(hash);
      if (!key) {
        sendApiError(response, 401, "invalid_api_key", `API key is invalid.`);
        return;
      }
      const usage = await dependencies.productStore.consumeApiUnit(
        key,
        dependencies.config.developerApiDailyLimit,
      );
      response.setHeader("x-ratelimit-limit", String(usage.dailyLimit));
      response.setHeader("x-ratelimit-remaining", String(usage.dailyRemaining));
      response.setHeader("x-ratelimit-tier", usage.tier);
      if (!usage.allowed) {
        response.setHeader("retry-after", String(usage.retryAfterSeconds));
        sendApiError(
          response,
          429,
          "rate_limit_exceeded",
          usage.reason === "minute"
            ? `Free API accounts may make one request per UTC minute.`
            : `${usage.tier === "free" ? "Free" : "Paid"} API daily quota reached.`,
        );
        return;
      }
      response.locals.apiKey = key;
      response.locals.remaining = usage.dailyRemaining;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Requires a specific scope on the authenticated API key.
 *
 * @param requiredScope - Scope required by the route.
 * @returns Express authorization middleware.
 */
function requireScope(requiredScope: ApiKeyScope) {
  return (
    _request: Request,
    response: Response<unknown, DeveloperApiLocals>,
    next: NextFunction,
  ): void => {
    if (!response.locals.apiKey.scopes.includes(requiredScope)) {
      sendApiError(
        response,
        403,
        "insufficient_scope",
        `API key requires the ${requiredScope} scope.`,
      );
      return;
    }
    next();
  };
}

/**
 * Sends the documented structured error contract with a request ID.
 *
 * @param response - Express response with developer API locals.
 * @param status - HTTP status.
 * @param code - Stable machine-readable error code.
 * @param message - Safe human-readable explanation.
 * @returns Nothing after writing the response.
 */
function sendApiError(
  response: Response<unknown, DeveloperApiLocals>,
  status: number,
  code: string,
  message: string,
): void {
  response.status(status).json({
    error: { code, message, requestId: response.locals.requestId },
  });
}

/**
 * Hashes a parsed request for idempotency-key conflict detection.
 *
 * @param body - Validated JSON request body.
 * @returns Stable SHA-256 hash.
 */
function hashRequestBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}
