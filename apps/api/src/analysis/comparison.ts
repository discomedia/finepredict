import type { MarketComparison, MarketContract } from "@finepredict/shared";

import { splitContractSentences } from "./text.js";

/** Extractor used to create one comparison-table row. */
interface ComparisonTerm {
  label: string;
  read: (contract: MarketContract) => string;
}

/** Contract dimensions that must align before trades are called equivalent. */
const COMPARISON_TERMS: readonly ComparisonTerm[] = [
  { label: "Deadline", read: readDeadline },
  { label: "Required event", read: readTrigger },
  { label: "Resolution source", read: readSource },
  { label: "Later revisions", read: readRevisionTreatment },
  { label: "Postponements", read: readPostponementTreatment },
  { label: "Fallback", read: readFallback },
];

/**
 * Compares two contracts across settlement-critical terms.
 *
 * @param left - First normalized contract.
 * @param right - Second normalized contract.
 * @returns Explicit term-by-term comparison and equivalence conclusion.
 */
export function compareContracts(
  left: MarketContract,
  right: MarketContract,
): MarketComparison {
  const rows = COMPARISON_TERMS.map((term) => {
    const leftValue = term.read(left);
    const rightValue = term.read(right);
    return {
      equivalent: normalize(leftValue) === normalize(rightValue),
      left: leftValue,
      right: rightValue,
      term: term.label,
    };
  });
  const equivalentTrade = rows.every((row) => row.equivalent);
  const differences = rows
    .filter((row) => !row.equivalent)
    .map((row) => row.term.toLowerCase());
  return {
    conclusion: equivalentTrade
      ? "The visible settlement terms align on every extracted dimension. Re-check the archived rules before trading."
      : `No. The contracts differ on ${formatList(differences)}.`,
    equivalentTrade,
    rows,
  };
}

/**
 * Reads an explicit textual deadline or formats platform metadata in ET.
 *
 * @param contract - Normalized contract.
 * @returns Human-readable deadline.
 */
function readDeadline(contract: MarketContract): string {
  const explicitClockTime = findSentence(
    contract.rulesText,
    /(?:\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|11:59|midnight|noon)/i,
  );
  if (explicitClockTime) {
    return explicitClockTime;
  }
  const dateBoundary = findSentence(
    contract.rulesText,
    /\b(?:deadline|before|by|until|through)\b.{0,120}(?:\b20\d{2}\b|[A-Z][a-z]+\s+\d{1,2})/i,
  );
  if (dateBoundary) {
    return dateBoundary;
  }
  if (!contract.endDate) {
    return "Not explicitly stated";
  }
  return new Date(contract.endDate).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
    timeZoneName: "short",
  });
}

/**
 * Reads the event that must occur for Yes settlement.
 *
 * @param contract - Normalized contract.
 * @returns Trigger description.
 */
function readTrigger(contract: MarketContract): string {
  const sentence = findSentence(
    contract.rulesText,
    /(?:resolve|announcement|announced|completed|transaction|launched|resignation|filing)/i,
  );
  return sentence ?? contract.title;
}

/**
 * Reads the named resolution source.
 *
 * @param contract - Normalized contract.
 * @returns Named source or an explicit missing marker.
 */
function readSource(contract: MarketContract): string {
  return contract.resolutionSource ?? "No distinct source extracted";
}

/**
 * Reads how later revisions affect settlement.
 *
 * @param contract - Normalized contract.
 * @returns Relevant rule sentence or an explicit silence marker.
 */
function readRevisionTreatment(contract: MarketContract): string {
  return (
    findSentence(
      contract.rulesText,
      /preliminary|revis(?:e|ed|ion)|final data/i,
    ) ?? "Not addressed"
  );
}

/**
 * Reads how postponement affects the market.
 *
 * @param contract - Normalized contract.
 * @returns Relevant rule sentence or an explicit silence marker.
 */
function readPostponementTreatment(contract: MarketContract): string {
  return (
    findSentence(contract.rulesText, /postpon|reschedul|delay|cancel/i) ??
    "Not addressed"
  );
}

/**
 * Reads fallback-source or discretionary settlement language.
 *
 * @param contract - Normalized contract.
 * @returns Relevant rule sentence or an explicit silence marker.
 */
function readFallback(contract: MarketContract): string {
  return (
    findSentence(
      contract.rulesText,
      /fallback|otherwise|credible reporting|consensus|unavailable|discretion|alternative source/i,
    ) ?? "Not addressed"
  );
}

/**
 * Finds the first compact sentence matching a contract concept.
 *
 * @param text - Full contract rules.
 * @param pattern - Concept pattern.
 * @returns Exact matching sentence or null.
 */
function findSentence(text: string, pattern: RegExp): string | null {
  const sentences = splitContractSentences(text);
  const sentence = sentences.find((candidate) => pattern.test(candidate));
  return sentence ? sentence.slice(0, 300) : null;
}

/**
 * Normalizes prose only for exact comparison across sources.
 *
 * @param value - Extracted comparison value.
 * @returns Lowercase whitespace-normalized value.
 */
function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Formats a short list as natural English.
 *
 * @param values - Lowercase term labels.
 * @returns Natural-language list.
 */
function formatList(values: string[]): string {
  if (values.length <= 1) {
    return values[0] ?? "the extracted terms";
  }
  return `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}
