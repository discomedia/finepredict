import {
  AddWatchlistMarketRequestSchema,
  CreateApiKeyRequestSchema,
  CreateWatchlistRequestSchema,
  MarketPlatformSchema,
} from "@finepredict/shared";
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { z } from "zod";

import type { AuthRuntime } from "../auth.js";
import type { AppConfig } from "../config.js";
import {
  ProductAccessError,
  ProductStore,
  type SaveDisputeCaseInput,
} from "../database/product-store.js";
import { generateApiKey } from "../developer-api/api-key.js";
import type { BillingService } from "../integrations/billing.js";
import { fetchMarketContract } from "../markets/platform.js";
import {
  type FinePredictLocals,
  isAdministratorRequest,
  requireAuthenticatedUser,
} from "./auth-middleware.js";

/** Dependencies used by authenticated product and public dispute routes. */
export interface ProductRoutesDependencies {
  authRuntime?: AuthRuntime | null;
  billingService: BillingService;
  config: AppConfig;
  fetchImplementation?: typeof fetch;
  productStore: ProductStore;
}

/** Administrator request body for imported dispute material. */
const SaveDisputeCaseRequestSchema = z.object({
  archivedRules: z.string().min(1),
  checkIds: z.array(z.string().min(1)).default([]),
  disputedWording: z.string().min(1),
  externalId: z.string().min(1),
  marketUrl: z.url(),
  outcome: z.string().min(1).nullable().default(null),
  platform: z.enum(["polymarket", "kalshi"]),
  reviewStatus: z
    .enum(["pending_review", "published", "rejected"])
    .default("pending_review"),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  sourceLabel: z.string().min(1),
  sourceQuote: z.string().min(1).nullable().default(null),
  sourceUrl: z.url(),
  title: z.string().min(1),
  transactionHash: z.string().min(1).nullable().default(null),
  wordingTags: z.array(z.string().min(1)).default([]),
});

/**
 * Creates authenticated account/watchlist/billing routes and public disputes.
 *
 * @param dependencies - Authentication, persistence, providers, and config.
 * @returns Express router mounted under `/api`.
 */
export function createProductRouter(
  dependencies: ProductRoutesDependencies,
): Router {
  const router = Router();
  const requireUser = requireAuthenticatedUser(dependencies.authRuntime);

  router.get(
    "/me",
    requireUser,
    (_request, response: Response<unknown, FinePredictLocals>) => {
      response.json({ user: response.locals.user });
    },
  );

  router.get(
    "/me/subscription",
    requireUser,
    async (_request, response: Response<unknown, FinePredictLocals>, next) => {
      try {
        response.json(
          await dependencies.productStore.getSubscriptionSummary(
            response.locals.user.id,
            dependencies.billingService.watchlistConfigured,
          ),
        );
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/me/watchlists",
    requireUser,
    async (_request, response: Response<unknown, FinePredictLocals>, next) => {
      try {
        response.json({
          watchlists: await dependencies.productStore.listWatchlists(
            response.locals.user.id,
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/me/watchlists",
    requireUser,
    async (request, response: Response<unknown, FinePredictLocals>, next) => {
      try {
        const subscription =
          await dependencies.productStore.getSubscriptionSummary(
            response.locals.user.id,
            dependencies.billingService.watchlistConfigured,
          );
        if (!subscription.entitled) {
          throw new ProductAccessError(
            402,
            `An active FinePredict subscription is required to create watchlists.`,
          );
        }
        const input = CreateWatchlistRequestSchema.parse(request.body);
        response
          .status(201)
          .json(
            await dependencies.productStore.createWatchlist(
              response.locals.user.id,
              input.name,
            ),
          );
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/me/watchlists/:watchlistId/markets",
    requireUser,
    async (request, response: Response<unknown, FinePredictLocals>, next) => {
      try {
        const input = AddWatchlistMarketRequestSchema.parse(request.body);
        const contract = await fetchMarketContract(
          input.url,
          dependencies.fetchImplementation,
        );
        const id = await dependencies.productStore.addWatchlistMarket(
          response.locals.user.id,
          String(request.params.watchlistId),
          contract,
        );
        response.status(201).json({ id });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    "/me/watchlist-markets/:marketId",
    requireUser,
    async (request, response: Response<unknown, FinePredictLocals>, next) => {
      try {
        const removed =
          await dependencies.productStore.deactivateWatchlistMarket(
            response.locals.user.id,
            String(request.params.marketId),
          );
        response.status(removed ? 204 : 404).end();
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/me/notifications",
    requireUser,
    async (_request, response: Response<unknown, FinePredictLocals>, next) => {
      try {
        response.json({
          notifications: await dependencies.productStore.listAlerts(
            response.locals.user.id,
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/me/notifications/:notificationId/read",
    requireUser,
    async (request, response: Response<unknown, FinePredictLocals>, next) => {
      try {
        const updated = await dependencies.productStore.markAlertRead(
          response.locals.user.id,
          String(request.params.notificationId),
        );
        response.status(updated ? 204 : 404).end();
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/billing/checkout",
    requireUser,
    async (_request, response: Response<unknown, FinePredictLocals>, next) => {
      try {
        const identity = await dependencies.productStore.getBillingIdentity(
          response.locals.user.id,
        );
        const url = await dependencies.billingService.createWatchlistCheckout({
          email: response.locals.user.email,
          stripeCustomerId: identity.stripeCustomerId,
          userId: response.locals.user.id,
        });
        response.json({ url });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/billing/portal",
    requireUser,
    async (_request, response: Response<unknown, FinePredictLocals>, next) => {
      try {
        const identity = await dependencies.productStore.getBillingIdentity(
          response.locals.user.id,
        );
        if (!identity.stripeCustomerId) {
          throw new ProductAccessError(
            409,
            `No Stripe billing account exists for this user yet.`,
          );
        }
        response.json({
          url: await dependencies.billingService.createCustomerPortal(
            identity.stripeCustomerId,
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/billing/api-checkout",
    requireUser,
    async (_request, response: Response<unknown, FinePredictLocals>, next) => {
      try {
        const identity = await dependencies.productStore.getBillingIdentity(
          response.locals.user.id,
        );
        response.json({
          url: await dependencies.billingService.createDeveloperApiCheckout({
            email: response.locals.user.email,
            stripeCustomerId: identity.stripeCustomerId,
            userId: response.locals.user.id,
          }),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get("/disputes", async (_request, response, next) => {
    try {
      response.json({
        disputes: await dependencies.productStore.listDisputeCases(false),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/disputes/:slug", async (request, response, next) => {
    try {
      const dispute = await dependencies.productStore.getDisputeCase(
        String(request.params.slug),
        false,
      );
      if (!dispute) {
        response.status(404).json({ error: `Dispute case not found.` });
        return;
      }
      response.json(dispute);
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/markets/:platform/:externalId/status",
    async (request, response, next) => {
      try {
        const platform = MarketPlatformSchema.parse(request.params.platform);
        const observation =
          await dependencies.productStore.getLatestMarketObservation(
            platform,
            String(request.params.externalId),
          );
        response.json({ observation });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get("/admin/disputes", async (request, response, next) => {
    try {
      if (
        !(await isAdministratorRequest(
          request,
          dependencies.authRuntime,
          dependencies.config.adminApiKey,
        ))
      ) {
        response.status(403).json({ error: `Administrator access required.` });
        return;
      }
      response.json({
        disputes: await dependencies.productStore.listDisputeCases(true),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/disputes", async (request, response, next) => {
    try {
      if (
        !(await isAdministratorRequest(
          request,
          dependencies.authRuntime,
          dependencies.config.adminApiKey,
        ))
      ) {
        response.status(403).json({ error: `Administrator access required.` });
        return;
      }
      const input: SaveDisputeCaseInput = SaveDisputeCaseRequestSchema.parse(
        request.body,
      );
      response
        .status(201)
        .json(await dependencies.productStore.saveDisputeCase(input));
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/me/api-keys",
    requireUser,
    async (_request, response: Response<unknown, FinePredictLocals>, next) => {
      try {
        response.json({
          apiKeys: await dependencies.productStore.listApiKeys(
            response.locals.user.id,
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/me/api-keys",
    requireUser,
    async (request, response: Response<unknown, FinePredictLocals>, next) => {
      try {
        const input = CreateApiKeyRequestSchema.parse(request.body);
        const generated = generateApiKey(dependencies.config.apiKeyHashSecret);
        const apiKey = await dependencies.productStore.createApiKey({
          hash: generated.hash,
          name: input.name,
          prefix: generated.prefix,
          scopes: input.scopes,
          userId: response.locals.user.id,
        });
        response.status(201).json({ apiKey, secret: generated.secret });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    "/me/api-keys/:apiKeyId",
    requireUser,
    async (request, response: Response<unknown, FinePredictLocals>, next) => {
      try {
        const revoked = await dependencies.productStore.revokeApiKey(
          response.locals.user.id,
          String(request.params.apiKeyId),
        );
        response.status(revoked ? 204 : 404).end();
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    "/me/api-usage",
    requireUser,
    async (_request, response: Response<unknown, FinePredictLocals>, next) => {
      try {
        response.json({
          usage: await dependencies.productStore.listUsage(
            response.locals.user.id,
          ),
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

/**
 * Express error helper retained for strongly typed async callback signatures.
 *
 * @param error - Unknown route failure.
 * @param _request - Incoming request.
 * @param _response - Outgoing response.
 * @param next - Express next callback.
 * @returns Nothing after forwarding the error.
 */
export function forwardProductRouteError(
  error: unknown,
  _request: Request,
  _response: Response,
  next: NextFunction,
): void {
  next(error);
}
