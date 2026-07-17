/**
 * Returns the concise FinePredict developer API OpenAPI document.
 *
 * @param serverUrl - Public API base URL.
 * @returns OpenAPI 3.1 document.
 */
export function createOpenApiDocument(serverUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "FinePredict Developer API",
      version: "1.0.0",
      description:
        "Analyze and compare prediction-market contract wording without an opaque risk score.",
    },
    servers: [{ url: serverUrl.replace(/\/$/, "") }],
    components: {
      securitySchemes: {
        bearerAuth: { scheme: "bearer", type: "http" },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      "/api/v1/reports": {
        post: {
          summary: "Create an immutable contract report",
          parameters: [
            {
              in: "header",
              name: "Idempotency-Key",
              required: false,
              schema: { type: "string" },
            },
          ],
          responses: { "201": { description: "Created report" } },
        },
      },
      "/api/v1/reports/{slug}": {
        get: {
          summary: "Get a report",
          responses: { "200": { description: "Immutable report" } },
        },
      },
      "/api/v1/markets/{platform}/{externalId}/snapshots": {
        get: {
          summary: "List archived market snapshots",
          responses: { "200": { description: "Paginated snapshots" } },
        },
      },
      "/api/v1/disputes": {
        get: {
          summary: "List reviewed historical disputes",
          responses: { "200": { description: "Paginated dispute cases" } },
        },
      },
    },
  };
}
