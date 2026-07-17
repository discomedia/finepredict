import { describe, expect, it } from "vitest";

import { splitContractSentences } from "./text.js";

describe("splitContractSentences", () => {
  it("keeps a clock time and its timezone in the same sentence", () => {
    expect(
      splitContractSentences(
        "The deadline is December 31 at 5 p.m. ET. Later revisions do not count.",
      ),
    ).toEqual([
      "The deadline is December 31 at 5 p.m. ET.",
      "Later revisions do not count.",
    ]);
  });
});
