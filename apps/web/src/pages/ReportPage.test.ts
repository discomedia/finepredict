import { describe, expect, it } from "vitest";

import { formatSourceAvailability } from "./ReportPage.js";

describe("formatSourceAvailability", () => {
  it("describes automated access limits without calling the source unavailable", () => {
    expect(formatSourceAvailability("access_limited")).toBe(
      "Source check limited",
    );
  });

  it("uses neutral copy for legacy unavailable report values", () => {
    expect(formatSourceAvailability("unavailable")).toBe(
      "Source status unconfirmed",
    );
  });

  it("reserves unavailable wording for newly confirmed missing sources", () => {
    expect(formatSourceAvailability("confirmed_unavailable")).toBe(
      "Source unavailable",
    );
  });
});
