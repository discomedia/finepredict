import { describe, expect, it } from "vitest";

import { shouldSuppressMigrationNotice } from "./postgres-notices.js";

describe("migration notice filtering", () => {
  it("suppresses only idempotent Drizzle bookkeeping notices", () => {
    expect(shouldSuppressMigrationNotice("42P06")).toBe(true);
    expect(shouldSuppressMigrationNotice("42P07")).toBe(true);
    expect(shouldSuppressMigrationNotice("01000")).toBe(false);
    expect(shouldSuppressMigrationNotice(undefined)).toBe(false);
  });
});
