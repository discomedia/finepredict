import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "./app.js";
import { createAuthRuntime } from "./auth.js";
import { loadConfig } from "./config.js";
import { createDatabaseResources } from "./database/client.js";
import { ProductStore } from "./database/product-store.js";
import { authUsers } from "./database/schema.js";
import { MemoryReportStore } from "./database/store.js";
import { BillingService } from "./integrations/billing.js";
import type { EmailService, SendEmailInput } from "./integrations/email.js";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error(
    `FinePredict auth integration tests: DATABASE_URL is required in the root .env.`,
  );
}

/** Email adapter that captures a magic link without external delivery. */
class CapturingEmailService implements EmailService {
  public readonly configured = true;
  public lastEmail: SendEmailInput | null = null;

  /** @inheritdoc */
  public async send(input: SendEmailInput): Promise<void> {
    this.lastEmail = input;
  }
}

const resources = createDatabaseResources(databaseUrl);
const emailService = new CapturingEmailService();
const email = `integration-auth-${crypto.randomUUID()}@example.com`;
const config = loadConfig({
  ...process.env,
  BETTER_AUTH_SECRET: "integration-auth-secret-with-at-least-32-characters",
  BETTER_AUTH_URL: "http://localhost:3001",
  WEB_ORIGIN: "http://localhost:5173",
});
const authRuntime = createAuthRuntime(config, emailService);
if (!authRuntime) {
  throw new Error(`FinePredict auth integration runtime was not created.`);
}
const app = createApp({
  authRuntime,
  billingService: new BillingService(config),
  config,
  productStore: new ProductStore(resources.database),
  store: new MemoryReportStore(),
});

describe("Better Auth account sessions", () => {
  afterAll(async () => {
    try {
      await resources.database
        .delete(authUsers)
        .where(eq(authUsers.email, email));
    } finally {
      await Promise.all([authRuntime.close(), resources.close()]);
    }
  });

  it("creates a session from a captured magic link and signs out", async () => {
    const agent = request.agent(app);
    await agent
      .post("/api/auth/sign-in/magic-link")
      .send({ callbackURL: "http://localhost:5173/account", email })
      .expect(200, { status: true });
    const magicLink = emailService.lastEmail?.text.split(" ").at(-1);
    if (!magicLink) {
      throw new Error(`FinePredict auth integration email contained no link.`);
    }
    const verificationUrl = new URL(magicLink);
    await agent
      .get(`${verificationUrl.pathname}${verificationUrl.search}`)
      .expect(302);
    await agent
      .get("/api/me")
      .expect(200)
      .expect(({ body }) => {
        expect(body.user.email).toBe(email);
      });
    await agent.post("/api/auth/sign-out").expect(200);
    await agent.get("/api/me").expect(401);
  });
});
