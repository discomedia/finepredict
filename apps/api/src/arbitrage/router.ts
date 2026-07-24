import { Router, type Request, type Response } from "express";

import type {
  NativeBinaryMarket,
  OpportunityListFilters,
  OpportunityListItem,
  OpportunityListMarket,
  OpportunityRelationship,
  OpportunityStatus,
  ScannedOpportunity,
} from "./opportunities/types.js";
import type { ReportService } from "../report-service.js";
import type { ArbitrageRuntime } from "./runtime.js";

const opportunityStatuses = new Set<OpportunityStatus>([
  "actionable",
  "basis_opportunity",
  "relative_value",
  "review_required",
  "below_threshold",
]);
const opportunityRelationships = new Set<OpportunityRelationship>([
  "pure_arbitrage",
  "near_arbitrage",
  "relative_value",
  "unreviewed",
]);

/**
 * Creates FinePredict's public, read-only arbitrage API.
 *
 * @param runtime - Shared repository and recurring service.
 * @param reportService - Existing report analysis and persistence service.
 * @returns Express router mounted beneath `/api/arbitrage`.
 */
export function createArbitrageRouter(
  runtime: ArbitrageRuntime,
  reportService: ReportService,
): Router {
  const router = Router();

  router.get("/status", (_request, response) => {
    response.json(runtime.service.getStatus());
  });

  router.get("/summary", async (_request, response, next) => {
    try {
      response.json(await runtime.repository.getSummary());
    } catch (error) {
      next(error);
    }
  });

  router.get("/categories", async (_request, response, next) => {
    try {
      response.json({
        categories: await runtime.repository.listOpportunityCategories(),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/opportunities", async (request, response, next) => {
    try {
      const filters = parseOpportunityFilters(
        new URLSearchParams(
          Object.entries(request.query).flatMap(([key, value]) =>
            typeof value === "string" ? [[key, value]] : [],
          ),
        ),
      );
      const opportunities = await runtime.repository.listOpportunities(filters);
      response.json({
        filters,
        count: opportunities.length,
        opportunities: opportunities.map(toOpportunityListItem),
      });
    } catch (error) {
      next(error);
    }
  });

  router.get(
    "/opportunities/:opportunityId",
    async (request, response, next) => {
      try {
        const opportunity = await runtime.repository.getOpportunity(
          String(request.params.opportunityId),
        );
        if (!opportunity) {
          response.status(404).json({ error: "Opportunity not found." });
          return;
        }
        response.json(opportunity);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    "/opportunities/:opportunityId/compare",
    async (request, response, next) => {
      try {
        const opportunityId = String(request.params.opportunityId);
        const opportunity =
          await runtime.repository.getOpportunity(opportunityId);
        if (!opportunity) {
          response.status(404).json({ error: "Opportunity not found." });
          return;
        }
        const compact = toOpportunityListItem(opportunity);
        const resolution = await reportService.getOrCreateComparisonReport(
          `arbitrage:${opportunityId}`,
          [compact.kalshi.marketUrl, compact.polymarket.marketUrl],
        );
        response.status(resolution.reused ? 200 : 201).json({
          slug: resolution.report.slug,
          reused: resolution.reused,
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get("/stream", (request, response) => {
    openOpportunityEventStream(runtime, request, response);
  });

  return router;
}

/**
 * Opens one server-sent event connection for lightweight invalidations.
 *
 * @param runtime - Active arbitrage service.
 * @param request - Express request used for disconnect detection.
 * @param response - Streaming Express response.
 * @returns Nothing; the connection remains open until the browser disconnects.
 */
function openOpportunityEventStream(
  runtime: ArbitrageRuntime,
  request: Request,
  response: Response,
): void {
  response.status(200);
  response.set({
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders();
  writeEvent(response, "status", runtime.service.getStatus());
  const unsubscribe = runtime.service.subscribe((update) => {
    writeEvent(
      response,
      update.type,
      update.type === "status" ? runtime.service.getStatus() : update,
    );
  });
  const heartbeat = setInterval(() => {
    response.write(`: heartbeat ${new Date().toISOString()}\n\n`);
  }, 25_000);
  request.once("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    response.end();
  });
}

/**
 * Writes one named SSE payload.
 *
 * @param response - Open SSE response.
 * @param event - Browser event name.
 * @param payload - JSON-serializable payload.
 * @returns Nothing.
 */
function writeEvent(response: Response, event: string, payload: unknown): void {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * Parses bounded frontend list filters.
 *
 * @param searchParams - URL query parameters.
 * @returns Validated repository filters.
 */
export function parseOpportunityFilters(
  searchParams: URLSearchParams,
): OpportunityListFilters {
  const strategy = searchParams.get("strategy");
  if (strategy !== null && strategy !== "cross_venue_equivalent") {
    throw new Error(`Unsupported strategy ${strategy}.`);
  }
  const statusValue = searchParams.get("status");
  if (
    statusValue !== null &&
    !opportunityStatuses.has(statusValue as OpportunityStatus)
  ) {
    throw new Error(`Unsupported status ${statusValue}.`);
  }
  const relationshipValue = searchParams.get("relationship");
  if (
    relationshipValue !== null &&
    !opportunityRelationships.has(relationshipValue as OpportunityRelationship)
  ) {
    throw new Error(`Unsupported relationship ${relationshipValue}.`);
  }
  const minimumNetEdgeCents = parseOptionalNonnegativeNumber(
    searchParams.get("minimumNetEdgeCents"),
    "minimumNetEdgeCents",
  );
  const reviewedOnly = parseOptionalBoolean(
    searchParams.get("reviewedOnly"),
    "reviewedOnly",
  );
  return {
    ...(strategy ? { strategy } : {}),
    ...(searchParams.get("category")
      ? { category: searchParams.get("category") ?? "" }
      : {}),
    ...(statusValue ? { status: statusValue as OpportunityStatus } : {}),
    ...(relationshipValue
      ? { relationship: relationshipValue as OpportunityRelationship }
      : {}),
    ...(reviewedOnly !== undefined ? { reviewedOnly } : {}),
    ...(minimumNetEdgeCents !== undefined
      ? {
          minimumNetEdgeDollarsPerShare: minimumNetEdgeCents / 100,
        }
      : {}),
    limit: parseBoundedInteger(
      searchParams.get("limit") ?? "20",
      "limit",
      1,
      100,
    ),
    offset: parseBoundedInteger(
      searchParams.get("offset") ?? "0",
      "offset",
      0,
      1_000_000,
    ),
  };
}

/**
 * Removes rule text, token identifiers, and fee internals from list responses.
 *
 * @param opportunity - Full stored opportunity.
 * @returns Compact frontend list row.
 */
export function toOpportunityListItem(
  opportunity: ScannedOpportunity,
): OpportunityListItem {
  return {
    opportunityId: opportunity.opportunityId,
    strategy: opportunity.strategy,
    status: opportunity.status,
    category: opportunity.category,
    matchConfidence: opportunity.matchConfidence,
    relationship: opportunity.relationship,
    settlementRisks: opportunity.settlementRisks,
    kalshi: toOpportunityListMarket(opportunity.kalshi),
    polymarket: toOpportunityListMarket(opportunity.polymarket),
    direction: opportunity.direction,
    executableShares: opportunity.executableShares,
    buyYesAveragePriceDollars: opportunity.buyYesAveragePriceDollars,
    buyNoAveragePriceDollars: opportunity.buyNoAveragePriceDollars,
    grossEdgeDollarsPerShare:
      opportunity.grossProfitDollars / opportunity.executableShares,
    feeDollarsPerShare: opportunity.feesDollars / opportunity.executableShares,
    grossProfitDollars: opportunity.grossProfitDollars,
    feesDollars: opportunity.feesDollars,
    netProfitDollars: opportunity.netProfitDollars,
    conditionalNetProfitDollars: opportunity.conditionalNetProfitDollars,
    worstCaseSettlementDivergenceLossDollars:
      opportunity.worstCaseSettlementDivergenceLossDollars,
    ...(opportunity.breakEvenAdverseDivergenceProbabilityPercent100 !==
    undefined
      ? {
          breakEvenAdverseDivergenceProbabilityPercent100:
            opportunity.breakEvenAdverseDivergenceProbabilityPercent100,
        }
      : {}),
    netEdgeDollarsPerShare: opportunity.netEdgeDollarsPerShare,
    roiPercent100: opportunity.roiPercent100,
    observedAtIso: opportunity.observedAtIso,
    similarityPercent100: opportunity.similarityPercent100,
  };
}

/**
 * Converts one full market to the compact list shape.
 *
 * @param market - Full stored market.
 * @returns Compact venue leg.
 */
function toOpportunityListMarket(
  market: NativeBinaryMarket,
): OpportunityListMarket {
  return {
    venue: market.venue,
    marketId: market.marketId,
    eventId: market.eventId,
    ...(market.eventTitle ? { eventTitle: market.eventTitle } : {}),
    question: market.question,
    marketUrl: buildMarketUrl(market),
    ...(market.outcomeLabel ? { outcomeLabel: market.outcomeLabel } : {}),
    category: market.category,
    status: market.status,
    ...(market.settlementRulesUrl
      ? { settlementRulesUrl: market.settlementRulesUrl }
      : {}),
    ...(market.endDateIso ? { endDateIso: market.endDateIso } : {}),
    volume: market.volume,
    liquidity: market.liquidity,
  };
}

/**
 * Builds the public venue page for one normalized market.
 *
 * @param market - Native market.
 * @returns Public contract or parent-event URL.
 */
function buildMarketUrl(market: NativeBinaryMarket): string {
  if (market.venue === "polymarket") {
    const eventUrl = `https://polymarket.com/event/${encodeURIComponent(
      market.eventId,
    )}`;
    return market.marketSlug
      ? `${eventUrl}/${encodeURIComponent(market.marketSlug)}`
      : eventUrl;
  }
  const series = market.seriesId?.toLocaleLowerCase("en-US") ?? "markets";
  const eventUrl = `https://kalshi.com/markets/${encodeURIComponent(series)}/${encodeURIComponent(
    market.eventId.toLocaleLowerCase("en-US"),
  )}`;
  const url = new URL(eventUrl);
  url.searchParams.set("market_ticker", market.marketId);
  return url.toString();
}

/**
 * Parses an optional strict boolean query value.
 *
 * @param value - Raw query value.
 * @param name - Query name used in errors.
 * @returns Boolean or undefined.
 */
function parseOptionalBoolean(
  value: string | null,
  name: string,
): boolean | undefined {
  if (value === null) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`${name} must be true or false.`);
}

/**
 * Parses an optional nonnegative number.
 *
 * @param value - Raw query value.
 * @param name - Query name used in errors.
 * @returns Parsed value or undefined.
 */
function parseOptionalNonnegativeNumber(
  value: string | null,
  name: string,
): number | undefined {
  if (value === null) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a nonnegative number.`);
  }
  return parsed;
}

/**
 * Parses an integer within inclusive bounds.
 *
 * @param value - Raw query value.
 * @param name - Query name used in errors.
 * @param minimum - Inclusive minimum.
 * @param maximum - Inclusive maximum.
 * @returns Parsed integer.
 */
function parseBoundedInteger(
  value: string,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} must be an integer from ${String(minimum)} to ${String(maximum)}.`,
    );
  }
  return parsed;
}
