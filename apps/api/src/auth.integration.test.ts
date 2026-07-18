import { generateKeyPairSync } from "node:crypto";
import { createServer, type Server } from "node:http";

import { eq } from "drizzle-orm";
import type { Express } from "express";
import { SignJWT } from "jose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "./app.js";
import { createAuthRuntime } from "./auth.js";
import { loadConfig } from "./config.js";
import { createDatabaseResources } from "./database/client.js";
import { ProductStore } from "./database/product-store.js";
import { authUsers } from "./database/schema.js";
import { MemoryReportStore } from "./database/store.js";
import { BillingService } from "./integrations/billing.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error(
    `FinePredict auth integration tests: DATABASE_URL is required in the root .env.`,
  );
}

const resources = createDatabaseResources(databaseUrl);
const userId = crypto.randomUUID();
const email = `integration-auth-${userId}@example.com`;
const keyId = `integration-key-${crypto.randomUUID()}`;
const keyPair = generateKeyPairSync("ed25519");
const publicJwk = {
  ...keyPair.publicKey.export({ format: "jwk" }),
  alg: "EdDSA",
  kid: keyId,
};
const jwksServer = createServer((_request, response) => {
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ keys: [publicJwk] }));
});
let app: Express;
let token = "";

/**
 * Starts the local JWKS fixture and returns its base URL.
 *
 * @param server - HTTP server exposing a deterministic public key.
 * @returns Local origin used by the JWT verifier.
 */
async function listenForJwks(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error(`FinePredict auth integration JWKS server has no port.`);
  }
  return `http://127.0.0.1:${address.port}`;
}

describe("Neon Auth account authorization", () => {
  beforeAll(async () => {
    const neonAuthBaseUrl = await listenForJwks(jwksServer);
    const config = loadConfig({
      ...process.env,
      API_URL: "http://localhost:3001",
      NEON_AUTH_BASE_URL: neonAuthBaseUrl,
      WEB_ORIGIN: "http://localhost:5173",
    });
    const authRuntime = createAuthRuntime(config, resources.database);
    if (!authRuntime) {
      throw new Error(`FinePredict Neon Auth runtime was not created.`);
    }
    await resources.database.insert(authUsers).values({
      email,
      emailVerified: true,
      id: userId,
      name: "Integration Administrator",
      role: "admin",
    });
    token = await new SignJWT({ email })
      .setProtectedHeader({ alg: "EdDSA", kid: keyId })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(keyPair.privateKey);
    app = createApp({
      authRuntime,
      billingService: new BillingService(config),
      config,
      productStore: new ProductStore(resources.database),
      store: new MemoryReportStore(),
    });
  });

  afterAll(async () => {
    try {
      await resources.database
        .delete(authUsers)
        .where(eq(authUsers.id, userId));
    } finally {
      jwksServer.close();
      await resources.close();
    }
  });

  it("authorizes a signed Neon JWT and rejects an invalid bearer token", async () => {
    await request(app)
      .get("/api/me")
      .set("authorization", `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.user).toMatchObject({ email, id: userId, role: "admin" });
      });
    await request(app)
      .get("/api/me")
      .set("authorization", "Bearer invalid-token")
      .expect(401, { error: "Sign in is required." });
  });
});
