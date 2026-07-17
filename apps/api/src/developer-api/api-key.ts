import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Generated developer API credential and persistence-safe metadata. */
export interface GeneratedApiKey {
  hash: string;
  prefix: string;
  secret: string;
}

/**
 * Creates a FinePredict API key whose secret is displayed only once.
 *
 * @param hashingSecret - Server-only HMAC secret.
 * @returns Plaintext credential plus hash and visible prefix.
 */
export function generateApiKey(hashingSecret: string): GeneratedApiKey {
  requireHashingSecret(hashingSecret);
  const randomSecret = randomBytes(24).toString("base64url");
  const secret = `fp_live_${randomSecret}`;
  return {
    hash: hashApiKey(secret, hashingSecret),
    prefix: `${secret.slice(0, 15)}…`,
    secret,
  };
}

/**
 * Computes a non-reversible HMAC for API-key persistence and lookup.
 *
 * @param secret - Full developer API secret.
 * @param hashingSecret - Server-only HMAC secret.
 * @returns Hex-encoded SHA-256 HMAC.
 */
export function hashApiKey(secret: string, hashingSecret: string): string {
  requireHashingSecret(hashingSecret);
  return createHmac("sha256", hashingSecret).update(secret).digest("hex");
}

/**
 * Compares a supplied secret against a persisted HMAC in constant time.
 *
 * @param suppliedSecret - Bearer token supplied by the caller.
 * @param expectedHash - Persisted expected hash.
 * @param hashingSecret - Server-only HMAC secret.
 * @returns True only when the credential is valid.
 */
export function verifyApiKey(
  suppliedSecret: string,
  expectedHash: string,
  hashingSecret: string,
): boolean {
  const suppliedHash = hashApiKey(suppliedSecret, hashingSecret);
  if (suppliedHash.length !== expectedHash.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(suppliedHash), Buffer.from(expectedHash));
}

/**
 * Rejects an unsafe empty HMAC secret before key generation or verification.
 *
 * @param hashingSecret - Server-only HMAC secret.
 * @returns Nothing when valid.
 */
function requireHashingSecret(hashingSecret: string): void {
  if (hashingSecret.length < 32) {
    throw new Error(
      `FinePredict developer API: API_KEY_HASH_SECRET must be at least 32 characters.`,
    );
  }
}
