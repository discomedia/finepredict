import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { EmailService, SendEmailInput } from "./email.js";
import {
  NeonAuthWebhookService,
  NeonAuthWebhookVerificationError,
  type NeonAuthWebhookHeaders,
} from "./neon-auth-webhook.js";

/** In-memory email boundary used to inspect webhook delivery. */
class RecordingEmailService implements EmailService {
  public readonly configured = true;
  public readonly sent: SendEmailInput[] = [];

  /** @inheritdoc */
  public async send(input: SendEmailInput): Promise<void> {
    this.sent.push(input);
  }
}

/** Signed request fixture consumed by the webhook service. */
interface SignedWebhookFixture {
  headers: NeonAuthWebhookHeaders;
  rawBody: Buffer;
}

/**
 * Creates a detached Neon Auth-style Ed25519 webhook signature.
 *
 * @param rawBody - Exact JSON request bytes.
 * @param timestamp - Millisecond timestamp copied into the webhook header.
 * @param keyId - JWKS key identifier.
 * @param privateKey - Ed25519 private key used by the test fixture.
 * @param eventId - Signed event identifier copied into the webhook header.
 * @returns Raw body and signature headers accepted by the webhook service.
 */
function createSignedWebhook(
  rawBody: Buffer,
  timestamp: number,
  keyId: string,
  privateKey: KeyObject,
  eventId: string,
): SignedWebhookFixture {
  const protectedHeader = Buffer.from(
    JSON.stringify({ alg: "EdDSA", kid: keyId }),
    "utf8",
  ).toString("base64url");
  const timestampPayload = Buffer.from(
    `${String(timestamp)}.${rawBody.toString("base64url")}`,
    "utf8",
  ).toString("base64url");
  const signature = sign(
    null,
    Buffer.from(`${protectedHeader}.${timestampPayload}`, "utf8"),
    privateKey,
  ).toString("base64url");
  return {
    headers: {
      eventId,
      eventType: "send.magic_link",
      keyId,
      signature: `${protectedHeader}..${signature}`,
      timestamp: String(timestamp),
    },
    rawBody,
  };
}

describe("NeonAuthWebhookService", () => {
  it("verifies the detached signature and sends one idempotent magic link", async () => {
    const now = Date.parse("2026-07-18T02:00:00.000Z");
    const eventId = crypto.randomUUID();
    const keyId = `test-key-${crypto.randomUUID()}`;
    const keyPair = generateKeyPairSync("ed25519");
    const publicJwk = {
      ...keyPair.publicKey.export({ format: "jwk" }),
      alg: "EdDSA",
      kid: keyId,
    };
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ keys: [publicJwk] }));
    const emailService = new RecordingEmailService();
    const service = new NeonAuthWebhookService(
      "https://example.neonauth.example/neondb/auth",
      emailService,
      fetchImplementation,
      () => now,
    );
    const linkUrl =
      "https://example.neonauth.example/neondb/auth/magic-link/verify?token=one&next=%2Faccount";
    const rawBody = Buffer.from(
      JSON.stringify({
        event_data: {
          expires_at: "2026-07-18T02:05:00.000Z",
          link_type: "sign-in",
          link_url: linkUrl,
          token: "one-time-token",
        },
        event_id: eventId,
        event_type: "send.magic_link",
        timestamp: "2026-07-18T02:00:00.000Z",
        user: {
          email: "trader@example.com",
          id: crypto.randomUUID(),
          name: "Trader",
        },
      }),
      "utf8",
    );
    const fixture = createSignedWebhook(
      rawBody,
      now,
      keyId,
      keyPair.privateKey,
      eventId,
    );

    await service.deliverMagicLink(fixture.rawBody, fixture.headers);

    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(emailService.sent).toEqual([
      expect.objectContaining({
        idempotencyKey: `finepredict-neon-auth-${eventId}`,
        subject: "Your FinePredict sign-in link",
        text: `Sign in to FinePredict: ${linkUrl}`,
        to: "trader@example.com",
      }),
    ]);
    expect(emailService.sent[0]?.html).toContain("&amp;next=");
  });

  it("rejects stale signed requests before loading a key or sending email", async () => {
    const now = Date.parse("2026-07-18T02:10:01.000Z");
    const eventId = crypto.randomUUID();
    const keyId = `test-key-${crypto.randomUUID()}`;
    const keyPair = generateKeyPairSync("ed25519");
    const rawBody = Buffer.from("{}", "utf8");
    const fixture = createSignedWebhook(
      rawBody,
      Date.parse("2026-07-18T02:00:00.000Z"),
      keyId,
      keyPair.privateKey,
      eventId,
    );
    const fetchImplementation = vi.fn<typeof fetch>();
    const emailService = new RecordingEmailService();
    const service = new NeonAuthWebhookService(
      "https://example.neonauth.example/neondb/auth",
      emailService,
      fetchImplementation,
      () => now,
    );

    await expect(
      service.deliverMagicLink(fixture.rawBody, fixture.headers),
    ).rejects.toBeInstanceOf(NeonAuthWebhookVerificationError);
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(emailService.sent).toEqual([]);
  });
});
