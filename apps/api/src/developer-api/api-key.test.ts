import { describe, expect, it } from "vitest";

import { generateApiKey, hashApiKey, verifyApiKey } from "./api-key.js";

const HASHING_SECRET = "a-secure-test-secret-with-at-least-32-characters";

describe("developer API keys", () => {
  it("generates a one-time secret with a visible prefix and stable hash", () => {
    const generated = generateApiKey(HASHING_SECRET);

    expect(generated.secret).toMatch(/^fp_live_/);
    expect(generated.prefix).toContain("…");
    expect(generated.hash).toBe(hashApiKey(generated.secret, HASHING_SECRET));
    expect(generated.hash).not.toContain(generated.secret);
  });

  it("validates the correct credential and rejects another credential", () => {
    const generated = generateApiKey(HASHING_SECRET);

    expect(verifyApiKey(generated.secret, generated.hash, HASHING_SECRET)).toBe(
      true,
    );
    expect(verifyApiKey("fp_live_wrong", generated.hash, HASHING_SECRET)).toBe(
      false,
    );
  });

  it("rejects an unsafe hashing secret", () => {
    expect(() => generateApiKey("short")).toThrow(/at least 32/);
  });
});
