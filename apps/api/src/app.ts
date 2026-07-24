import {
  CreateReportRequestSchema,
  FinePredictModelSchema,
  MarketPairSearchQuerySchema,
  MarketSearchQuerySchema,
  UpdateSettingsRequestSchema,
} from "@finepredict/shared";
import cors from "cors";
import express, { type Express, type Request, type Response } from "express";
import { ZodError } from "zod";

import type { AppConfig } from "./config.js";
import type { AuthRuntime } from "./auth.js";
import { createArbitrageRouter } from "./arbitrage/router.js";
import type { ArbitrageRuntime } from "./arbitrage/runtime.js";
import {
  ProductAccessError,
  type ProductStore,
} from "./database/product-store.js";
import type { ReportStore } from "./database/store.js";
import { createDeveloperApiRouter } from "./developer-api/router.js";
import { DETERMINISTIC_CHECK_COUNT } from "./analysis/deterministic-checks.js";
import { createOpenApiDocument } from "./developer-api/openapi.js";
import { createProductRouter } from "./http/product-routes.js";
import { isAdministratorRequest } from "./http/auth-middleware.js";
import type { BillingService } from "./integrations/billing.js";
import {
  NeonAuthWebhookVerificationError,
  type NeonAuthWebhookService,
} from "./integrations/neon-auth-webhook.js";
import { log } from "./log.js";
import {
  ExternalServiceUnavailableError,
  UnsupportedMarketUrlError,
} from "./markets/platform.js";
import {
  MarketSearchService,
  MarketSearchUnavailableError,
} from "./markets/search.js";
import { MarketPriceHistoryService } from "./markets/price-history.js";
import { HistoricalMarketPriceService } from "./markets/historical-price-history.js";
import { ReportService } from "./report-service.js";

/** Dependencies used to construct the HTTP application. */
export interface CreateAppDependencies {
  arbitrageRuntime?: ArbitrageRuntime;
  authRuntime?: AuthRuntime | null;
  billingService?: BillingService;
  config: AppConfig;
  fetchImplementation?: typeof fetch;
  neonAuthWebhookService?: NeonAuthWebhookService;
  productStore?: ProductStore;
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
  const marketSearchService = new MarketSearchService(
    dependencies.config.oddpoolApiKey,
    dependencies.fetchImplementation,
  );
  const marketPriceHistoryService = new MarketPriceHistoryService(
    dependencies.fetchImplementation,
  );
  const historicalMarketPriceService = new HistoricalMarketPriceService(
    dependencies.fetchImplementation,
  );
  app.disable("x-powered-by");
  app.use(
    cors({
      credentials: true,
      origin: dependencies.config.webOrigin
        .split(",")
        .map((origin) => origin.trim()),
    }),
  );

  app.post(
    "/api/auth/neon-webhook",
    express.raw({ type: "application/json", limit: "32kb" }),
    async (request, response, next) => {
      const webhookService = dependencies.neonAuthWebhookService;
      if (!webhookService?.configured) {
        response.status(503).json({ error: `Neon Auth is not configured.` });
        return;
      }
      try {
        const body = Buffer.isBuffer(request.body)
          ? request.body
          : Buffer.from("");
        await webhookService.deliverMagicLink(body, {
          eventId: request.header("x-neon-event-id"),
          eventType: request.header("x-neon-event-type"),
          keyId: request.header("x-neon-signature-kid"),
          signature: request.header("x-neon-signature"),
          timestamp: request.header("x-neon-timestamp"),
        });
        response.json({ delivered: true });
      } catch (error) {
        if (error instanceof NeonAuthWebhookVerificationError) {
          response.status(401).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );

  app.post(
    "/api/billing/webhook",
    express.raw({ type: "application/json", limit: "256kb" }),
    async (request, response, next) => {
      const billingService = dependencies.billingService;
      const productStore = dependencies.productStore;
      if (!billingService || !productStore) {
        response.status(503).json({ error: `Billing is not configured.` });
        return;
      }
      let eventId: string | null = null;
      try {
        const signature = request.header("stripe-signature") ?? "";
        const body = Buffer.isBuffer(request.body)
          ? request.body
          : Buffer.from("");
        const event = billingService.constructWebhookEvent(body, signature);
        eventId = event.id;
        const claimed = await productStore.claimStripeWebhook(
          event.id,
          event.type,
        );
        if (!claimed) {
          response.json({ received: true, duplicate: true });
          return;
        }
        const update = billingService.extractSubscriptionUpdate(event);
        if (update) {
          await productStore.applyStripeSubscriptionUpdate(update);
        }
        response.json({ received: true });
      } catch (error) {
        if (eventId) {
          await productStore
            .releaseStripeWebhook(eventId)
            .catch(() => undefined);
        }
        next(error);
      }
    },
  );
  app.use(express.json({ limit: "64kb" }));

  app.get("/api/health/live", (_request, response) => {
    response.status(200).json({ ok: true });
  });

  app.get("/api/meta", (_request, response) => {
    response.json({
      deterministicCheckCount: DETERMINISTIC_CHECK_COUNT,
      platforms: ["polymarket", "kalshi"],
      accountFeaturesConfigured: Boolean(dependencies.authRuntime),
      billingConfigured: dependencies.billingService?.configured ?? false,
    });
  });

  app.get("/api/openapi.json", (_request, response) => {
    response.json(createOpenApiDocument(dependencies.config.apiUrl));
  });

  if (dependencies.arbitrageRuntime) {
    app.use(
      "/api/arbitrage",
      createArbitrageRouter(
        dependencies.arbitrageRuntime,
        reportService,
        historicalMarketPriceService,
      ),
    );
  }

  app.get("/api/reports", async (_request, response, next) => {
    try {
      response.json({ reports: await reportService.listRecentReports() });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/markets/search", async (request, response, next) => {
    try {
      const input = MarketSearchQuerySchema.parse(request.query);
      response.json(
        await marketSearchService.search(input.platform, input.query),
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/markets/search-pairs", async (request, response, next) => {
    try {
      const input = MarketPairSearchQuerySchema.parse(request.query);
      response.json(await marketSearchService.searchPairs(input.query));
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

  app.get("/api/reports/:slug/live-prices", async (request, response, next) => {
    try {
      const report = await reportService.getReport(String(request.params.slug));
      if (!report) {
        response.status(404).json({ error: "Report not found." });
        return;
      }
      const prices = await Promise.all(
        report.markets.map((market) =>
          marketPriceHistoryService.getPriceSnapshot(
            market.contract.platform,
            market.contract.externalId,
          ),
        ),
      );
      response.set("Cache-Control", "private, max-age=30").json({ prices });
    } catch (error) {
      next(error);
    }
  });

  app.get(
    "/api/reports/:slug/related-disputes",
    async (request, response, next) => {
      try {
        if (!dependencies.productStore) {
          response.json({ disputes: [] });
          return;
        }
        const report = await reportService.getReport(
          String(request.params.slug),
        );
        if (!report) {
          response.status(404).json({ error: "Report not found." });
          return;
        }
        const checkIds = [
          ...new Set(
            report.markets.flatMap((market) =>
              market.findings.map((finding) => finding.checkId),
            ),
          ),
        ];
        const wordingTags = extractReportWordingTags(
          report.markets.map((market) => market.contract.rulesText).join("\n"),
        );
        response.json({
          disputes: await dependencies.productStore.findRelatedDisputes(
            checkIds,
            wordingTags,
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );

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
      if (
        !(await isAdministratorRequest(
          request,
          dependencies.authRuntime,
          dependencies.config.adminApiKey,
        ))
      ) {
        response.status(403).json({ error: "Administrator access required." });
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

  if (dependencies.productStore && dependencies.billingService) {
    app.use(
      "/api",
      createProductRouter({
        ...(dependencies.authRuntime === undefined
          ? {}
          : { authRuntime: dependencies.authRuntime }),
        billingService: dependencies.billingService,
        config: dependencies.config,
        ...(dependencies.fetchImplementation
          ? { fetchImplementation: dependencies.fetchImplementation }
          : {}),
        productStore: dependencies.productStore,
      }),
    );
    app.use(
      "/api/v1",
      createDeveloperApiRouter({
        config: dependencies.config,
        ...(dependencies.fetchImplementation
          ? { fetchImplementation: dependencies.fetchImplementation }
          : {}),
        productStore: dependencies.productStore,
        reportStore: dependencies.store,
      }),
    );
  }

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
      if (error instanceof ExternalServiceUnavailableError) {
        log("api.externalServiceUnavailable", "External API request failed.", {
          externalService: error.serviceName,
          upstreamStatus: error.upstreamStatus,
        });
        response.status(error.responseStatus).json({
          code: error.code,
          error: error.message,
          externalService: error.serviceName,
          upstreamStatus: error.upstreamStatus,
        });
        return;
      }
      if (error instanceof MarketSearchUnavailableError) {
        response.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof ProductAccessError) {
        response.status(error.status).json({ error: error.message });
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
 * Extracts deterministic settlement-wording tags used for historical matching.
 *
 * @param rulesText - Combined report rules text.
 * @returns Normalized terms actually present in the report.
 */
function extractReportWordingTags(rulesText: string): string[] {
  const normalized = rulesText.toLowerCase();
  return [
    "announcement",
    "before",
    "consensus",
    "deadline",
    "fallback",
    "launch",
    "official",
    "postponement",
    "revision",
    "source",
  ].filter((term) => normalized.includes(term));
}
