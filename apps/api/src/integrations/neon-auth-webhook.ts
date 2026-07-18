import {
  createPublicKey,
  verify as verifySignature,
  type KeyObject,
} from "node:crypto";

import { z } from "zod";

import type { EmailService } from "./email.js";

/** Maximum accepted age or clock skew for a signed Neon Auth webhook. */
const MAX_WEBHOOK_AGE_MILLISECONDS = 5 * 60 * 1_000;

/** Ed25519 public key returned by the Neon Auth JWKS endpoint. */
const NeonAuthJwkSchema = z.object({
  alg: z.literal("EdDSA"),
  crv: z.literal("Ed25519"),
  kid: z.string().min(1),
  kty: z.literal("OKP"),
  x: z.string().min(1),
});

/** Neon Auth JWKS document used for webhook signature verification. */
const NeonAuthJwksSchema = z.object({ keys: z.array(NeonAuthJwkSchema) });

/** Detached JWS protected header sent by Neon Auth. */
const NeonAuthJwsHeaderSchema = z.object({
  alg: z.literal("EdDSA"),
  kid: z.string().min(1),
});

/** Signed magic-link delivery event accepted by FinePredict. */
const NeonAuthMagicLinkEventSchema = z.object({
  event_id: z.uuid(),
  event_type: z.literal("send.magic_link"),
  event_data: z.object({
    expires_at: z.iso.datetime(),
    link_type: z.literal("sign-in"),
    link_url: z.url(),
    token: z.string().min(1),
  }),
  timestamp: z.iso.datetime(),
  user: z.object({
    email: z.email(),
    id: z.uuid().optional(),
    name: z.string().optional(),
  }),
});

/** Required signature headers from a Neon Auth webhook request. */
export interface NeonAuthWebhookHeaders {
  eventId: string | undefined;
  eventType: string | undefined;
  keyId: string | undefined;
  signature: string | undefined;
  timestamp: string | undefined;
}

/** Error identifying a webhook that failed authentication or validation. */
export class NeonAuthWebhookVerificationError extends Error {
  /**
   * Creates a safe webhook verification failure.
   *
   * @param message - Non-secret validation detail.
   */
  public constructor(message: string) {
    super(message);
    this.name = "NeonAuthWebhookVerificationError";
  }
}

/** Verifies Neon Auth webhooks and delivers magic links through Disco Mail. */
export class NeonAuthWebhookService {
  public readonly configured: boolean;
  private jwksPromise: Promise<z.infer<typeof NeonAuthJwksSchema>> | null =
    null;

  /**
   * Creates the managed-auth delivery bridge.
   *
   * @param neonAuthBaseUrl - Managed Neon Auth base URL.
   * @param emailService - FinePredict email delivery service.
   * @param fetchImplementation - HTTP client used to refresh the JWKS cache.
   * @param now - Clock used for replay-window validation.
   */
  public constructor(
    private readonly neonAuthBaseUrl: string | null,
    private readonly emailService: EmailService,
    private readonly fetchImplementation: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.configured = Boolean(neonAuthBaseUrl && emailService.configured);
  }

  /**
   * Verifies and delivers one signed Neon Auth magic-link event.
   *
   * @param rawBody - Exact request bytes covered by the detached JWS.
   * @param headers - Signature and event headers supplied by Neon Auth.
   * @returns Nothing after Disco Mail accepts the idempotent email.
   */
  public async deliverMagicLink(
    rawBody: Buffer,
    headers: NeonAuthWebhookHeaders,
  ): Promise<void> {
    if (!this.configured) {
      throw new Error(`FinePredict Neon Auth webhook is not configured.`);
    }
    await this.verifySignature(rawBody, headers);
    const payload = NeonAuthMagicLinkEventSchema.safeParse(
      parseSignedJson(rawBody),
    );
    if (!payload.success) {
      throw new NeonAuthWebhookVerificationError(
        `Neon Auth webhook payload is invalid.`,
      );
    }
    if (
      headers.eventId !== payload.data.event_id ||
      headers.eventType !== payload.data.event_type
    ) {
      throw new NeonAuthWebhookVerificationError(
        `Neon Auth webhook headers do not match its payload.`,
      );
    }
    const linkUrl = escapeHtml(payload.data.event_data.link_url);
    await this.emailService.send({
      html: `<p>Use this secure link to sign in to FinePredict:</p><p><a href="${linkUrl}">Sign in to FinePredict</a></p><p>This link expires shortly and can only be used once.</p>`,
      idempotencyKey: `finepredict-neon-auth-${payload.data.event_id}`,
      subject: "Your FinePredict sign-in link",
      text: `Sign in to FinePredict: ${payload.data.event_data.link_url}`,
      to: payload.data.user.email,
    });
  }

  /**
   * Verifies timestamp freshness and the Ed25519 detached JWS.
   *
   * @param rawBody - Exact signed request body.
   * @param headers - Required Neon Auth signature headers.
   * @returns Nothing when the signature is valid.
   */
  private async verifySignature(
    rawBody: Buffer,
    headers: NeonAuthWebhookHeaders,
  ): Promise<void> {
    const { keyId, signature, timestamp } = headers;
    if (!keyId || !signature || !timestamp) {
      throw new NeonAuthWebhookVerificationError(
        `Neon Auth webhook signature headers are incomplete.`,
      );
    }
    const timestampMilliseconds = Number(timestamp);
    if (
      !Number.isSafeInteger(timestampMilliseconds) ||
      Math.abs(this.now() - timestampMilliseconds) >
        MAX_WEBHOOK_AGE_MILLISECONDS
    ) {
      throw new NeonAuthWebhookVerificationError(
        `Neon Auth webhook timestamp is outside the replay window.`,
      );
    }
    const signatureParts = signature.split(".");
    if (signatureParts.length !== 3 || signatureParts[1] !== "") {
      throw new NeonAuthWebhookVerificationError(
        `Neon Auth webhook signature is not a detached JWS.`,
      );
    }
    const [protectedHeader, , encodedSignature] = signatureParts;
    if (!protectedHeader || !encodedSignature) {
      throw new NeonAuthWebhookVerificationError(
        `Neon Auth webhook signature is malformed.`,
      );
    }
    const parsedHeader = NeonAuthJwsHeaderSchema.safeParse(
      parseSignedJson(Buffer.from(protectedHeader, "base64url")),
    );
    if (!parsedHeader.success || parsedHeader.data.kid !== keyId) {
      throw new NeonAuthWebhookVerificationError(
        `Neon Auth webhook key identifier is invalid.`,
      );
    }
    const publicKey = await this.getPublicKey(keyId);
    const payloadBase64 = rawBody.toString("base64url");
    const timestampPayload = Buffer.from(
      `${timestamp}.${payloadBase64}`,
      "utf8",
    ).toString("base64url");
    const signingInput = Buffer.from(
      `${protectedHeader}.${timestampPayload}`,
      "utf8",
    );
    if (
      !verifySignature(
        null,
        signingInput,
        publicKey,
        Buffer.from(encodedSignature, "base64url"),
      )
    ) {
      throw new NeonAuthWebhookVerificationError(
        `Neon Auth webhook signature is invalid.`,
      );
    }
  }

  /**
   * Resolves a webhook signing key from a cached Neon Auth JWKS document.
   *
   * @param keyId - Key identifier supplied in the signed request.
   * @returns Imported Ed25519 public key.
   */
  private async getPublicKey(keyId: string): Promise<KeyObject> {
    const jwks = await this.getJwks();
    let jwk = jwks.keys.find((candidate) => candidate.kid === keyId);
    if (!jwk) {
      this.jwksPromise = null;
      jwk = (await this.getJwks()).keys.find(
        (candidate) => candidate.kid === keyId,
      );
    }
    if (!jwk) {
      throw new NeonAuthWebhookVerificationError(
        `Neon Auth webhook signing key is unknown.`,
      );
    }
    return createPublicKey({ format: "jwk", key: jwk });
  }

  /**
   * Fetches and caches the managed Neon Auth JWKS document.
   *
   * @returns Validated JWKS document.
   */
  private async getJwks(): Promise<z.infer<typeof NeonAuthJwksSchema>> {
    if (!this.neonAuthBaseUrl) {
      throw new Error(`FinePredict Neon Auth base URL is missing.`);
    }
    this.jwksPromise ??= this.fetchImplementation(
      `${this.neonAuthBaseUrl}/.well-known/jwks.json`,
    ).then(async (response) => {
      if (!response.ok) {
        throw new Error(
          `FinePredict Neon Auth JWKS request failed with status ${response.status}.`,
        );
      }
      return NeonAuthJwksSchema.parse(await response.json());
    });
    return this.jwksPromise;
  }
}

/**
 * Escapes a dynamic link before embedding it in the email HTML template.
 *
 * @param value - Untrusted dynamic value.
 * @returns HTML-safe value.
 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * Parses signed webhook JSON while classifying malformed bytes as untrusted.
 *
 * @param bytes - Signed request body or protected-header bytes.
 * @returns Parsed unknown JSON value.
 */
function parseSignedJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new NeonAuthWebhookVerificationError(
      `Neon Auth webhook contains malformed JSON.`,
    );
  }
}
