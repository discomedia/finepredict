import { timingSafeEqual } from "node:crypto";

import {
  CreateReportRequestSchema,
  FinePredictModelSchema,
  UpdateSettingsRequestSchema,
} from "@finepredict/shared";
import cors from "cors";
import express, { type Express, type Request, type Response } from "express";
import { ZodError } from "zod";

import type { AppConfig } from "./config.js";
import type { ReportStore } from "./database/store.js";
import { DETERMINISTIC_CHECK_COUNT } from "./analysis/deterministic-checks.js";
import { log } from "./log.js";
import { UnsupportedMarketUrlError } from "./markets/platform.js";
import { ReportService } from "./report-service.js";

/** Dependencies used to construct the HTTP application. */
export interface CreateAppDependencies {
  config: AppConfig;
  fetchImplementation?: typeof fetch;
  store: ReportStore;
}

/**
 * Creates the FinePredict Express API without opening a network socket.
 *
 * @param dependencies - Runtime configuration, store, and optional HTTP client.
 * @returns Configured Express application.
 */
export function createApp(dependencies: CreateAppDependencies): Express {
  const app = express();
  const reportService = new ReportService(dependencies);
  app.disable("x-powered-by");
  app.use(
    cors({
      origin: dependencies.config.webOrigin
        .split(",")
        .map((origin) => origin.trim()),
    }),
  );
  app.use(express.json({ limit: "64kb" }));

  app.get("/api/health/live", (_request, response) => {
    response.status(200).json({ ok: true });
  });

  app.get("/api/meta", (_request, response) => {
    response.json({
      deterministicCheckCount: DETERMINISTIC_CHECK_COUNT,
      platforms: ["polymarket", "kalshi"],
    });
  });

  app.get("/api/reports", async (_request, response, next) => {
    try {
      response.json({ reports: await reportService.listRecentReports() });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/reports", async (request, response, next) => {
    try {
      const input = CreateReportRequestSchema.parse(request.body);
      const report = await reportService.createReport(input.urls);
      response.status(201).json(report);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/reports/:slug", async (request, response, next) => {
    try {
      const slug = String(request.params.slug);
      const report = await reportService.getReport(slug);
      if (!report) {
        response.status(404).json({ error: "Report not found." });
        return;
      }
      response.json(report);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/settings", async (_request, response, next) => {
    try {
      const model = await dependencies.store.getSettingsModel(
        dependencies.config.defaultModel,
      );
      response.json({
        availableModels: FinePredictModelSchema.options,
        model,
      });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/settings", async (request, response, next) => {
    try {
      if (!isAdminRequest(request, dependencies.config.adminApiKey)) {
        response.status(403).json({ error: "Administrator key required." });
        return;
      }
      const input = UpdateSettingsRequestSchema.parse(request.body);
      await dependencies.store.updateSettingsModel(input.model);
      response.json({
        availableModels: FinePredictModelSchema.options,
        model: input.model,
      });
    } catch (error) {
      next(error);
    }
  });

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof ZodError) {
        response.status(400).json({
          error: "Please check the submitted values.",
          issues: error.issues,
        });
        return;
      }
      if (error instanceof UnsupportedMarketUrlError) {
        response.status(400).json({ error: error.message });
        return;
      }
      log("api.errorHandler", "Unhandled API error.", {
        error: error instanceof Error ? error.message : String(error),
      });
      response.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "FinePredict could not complete the request.",
      });
    },
  );
  return app;
}

/**
 * Performs a constant-time comparison of the supplied and configured admin key.
 *
 * @param request - Incoming Express request.
 * @param expectedKey - Server-only administrator key.
 * @returns True only for a valid administrator request.
 */
function isAdminRequest(request: Request, expectedKey: string): boolean {
  const suppliedKey = request.header("x-admin-api-key") ?? "";
  if (!expectedKey || suppliedKey.length !== expectedKey.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(suppliedKey), Buffer.from(expectedKey));
}
