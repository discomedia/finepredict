import type { MarketComparison, MarketContract } from "@finepredict/shared";

import { splitContractSentences } from "./text.js";

/** Extractor and semantic comparator used to create one comparison-table row. */
interface ComparisonTerm {
  label: string;
  read: (contract: MarketContract) => string;
  equivalent: (
    leftValue: string,
    rightValue: string,
    left: MarketContract,
    right: MarketContract,
  ) => boolean;
}

/** One parsed calendar boundary, represented without a timezone assumption. */
interface CalendarBoundary {
  dayNumber: number;
  minuteOfDay: number;
}

/** Explicit marker used when a contract does not expose a comparison term. */
const NOT_ADDRESSED = "Not addressed";

/** Explicit marker used when a contract does not expose a resolution source. */
const NO_SOURCE = "No distinct source extracted";

/** Contract dimensions that must not contain an explicit conflict. */
const COMPARISON_TERMS: readonly ComparisonTerm[] = [
  {
    equivalent: areDeadlinesEquivalent,
    label: "Deadline",
    read: readDeadline,
  },
  {
    equivalent: areTriggersEquivalent,
    label: "Required event",
    read: readTrigger,
  },
  {
    equivalent: areOptionalTermsCompatible,
    label: "Resolution source",
    read: readSource,
  },
  {
    equivalent: areOptionalTermsCompatible,
    label: "Later revisions",
    read: readRevisionTreatment,
  },
  {
    equivalent: areOptionalTermsCompatible,
    label: "Postponements",
    read: readPostponementTreatment,
  },
  {
    equivalent: areOptionalTermsCompatible,
    label: "Fallback",
    read: readFallback,
  },
];

/** Common grammar that does not distinguish two settlement propositions. */
const SEMANTIC_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "any",
  "as",
  "at",
  "be",
  "before",
  "by",
  "for",
  "from",
  "if",
  "in",
  "is",
  "it",
  "market",
  "of",
  "on",
  "or",
  "serves",
  "serving",
  "shall",
  "that",
  "the",
  "then",
  "this",
  "to",
  "will",
  "with",
  "yes",
]);

/** Token aliases for common prediction-market paraphrases. */
const SEMANTIC_TOKEN_ALIASES: Readonly<Record<string, string>> = {
  announced: "announce",
  announcement: "announce",
  announcements: "announce",
  completed: "complete",
  completion: "complete",
  disclosures: "statement",
  filing: "file",
  filings: "file",
  launched: "launch",
  launches: "launch",
  leftmost: "lead",
  published: "publish",
  releases: "publish",
  statements: "statement",
  underwriters: "underwriter",
};

/** Actions whose difference commonly changes what resolves a contract. */
const MATERIAL_ACTION_TOKENS = new Set([
  "acquire",
  "announce",
  "approve",
  "appoint",
  "close",
  "complete",
  "file",
  "launch",
  "nominate",
  "publish",
  "release",
  "resign",
  "sign",
  "trade",
  "vote",
  "win",
]);

/** Month numbers keyed by normalized English month name. */
const MONTH_NUMBERS: Readonly<Record<string, number>> = {
  april: 3,
  august: 7,
  december: 11,
  february: 1,
  january: 0,
  july: 6,
  june: 5,
  march: 2,
  may: 4,
  november: 10,
  october: 9,
  september: 8,
};

/** Month aliases accepted in extracted contract prose. */
const MONTH_ALIASES: Readonly<Record<string, string>> = {
  apr: "april",
  aug: "august",
  dec: "december",
  feb: "february",
  jan: "january",
  jul: "july",
  jun: "june",
  mar: "march",
  nov: "november",
  oct: "october",
  sep: "september",
  sept: "september",
};

/**
 * Compares two contracts across settlement-critical terms.
 *
 * Equivalent means that the extracted terms describe the same practical
 * proposition and contain no explicit conflict. Silence on one venue is not
 * treated as proof that the other venue has a different rule.
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
      equivalent: term.equivalent(leftValue, rightValue, left, right),
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
      ? "Yes. The extracted terms describe the same practical outcome and no explicit settlement conflict was found. Re-check the archived rules before trading."
      : `No. The contracts contain a material conflict in ${formatList(differences)}.`,
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
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "America/New_York",
    timeZoneName: "short",
    year: "numeric",
  });
}

/**
 * Reads the event that must occur for Yes settlement.
 *
 * Event-level contracts may contain one Yes sentence per child outcome. The
 * title is therefore retained as the event identity while the first sentence
 * remains the most useful verbatim detail for the table.
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
  return contract.resolutionSource ?? NO_SOURCE;
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
    ) ?? NOT_ADDRESSED
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
    NOT_ADDRESSED
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
    ) ?? NOT_ADDRESSED
  );
}

/**
 * Compares deadline boundaries rather than their prose.
 *
 * @param leftValue - First extracted deadline.
 * @param rightValue - Second extracted deadline.
 * @param left - First normalized contract.
 * @param right - Second normalized contract.
 * @returns True when both deadlines describe the same practical boundary.
 */
function areDeadlinesEquivalent(
  leftValue: string,
  rightValue: string,
  left: MarketContract,
  right: MarketContract,
): boolean {
  if (normalize(leftValue) === normalize(rightValue)) {
    return true;
  }
  const leftBoundary = parseCalendarBoundary(leftValue);
  const rightBoundary = parseCalendarBoundary(rightValue);
  if (leftBoundary && rightBoundary) {
    const leftMinutes =
      leftBoundary.dayNumber * 1_440 + leftBoundary.minuteOfDay;
    const rightMinutes =
      rightBoundary.dayNumber * 1_440 + rightBoundary.minuteOfDay;
    return Math.abs(leftMinutes - rightMinutes) <= 1;
  }
  if (left.endDate && right.endDate) {
    return (
      Math.abs(
        new Date(left.endDate).getTime() - new Date(right.endDate).getTime(),
      ) <= 60_000
    );
  }
  return areSemanticallySimilar(leftValue, rightValue);
}

/**
 * Compares event identity and trigger actions without requiring identical prose.
 *
 * @param leftValue - First extracted trigger.
 * @param rightValue - Second extracted trigger.
 * @param left - First normalized contract.
 * @param right - Second normalized contract.
 * @returns True when the contracts describe the same practical event.
 */
function areTriggersEquivalent(
  leftValue: string,
  rightValue: string,
  left: MarketContract,
  right: MarketContract,
): boolean {
  if (normalize(leftValue) === normalize(rightValue)) {
    return true;
  }
  if (haveMaterialActionConflict(leftValue, rightValue)) {
    return false;
  }
  if (haveDirectionConflict(leftValue, rightValue)) {
    return false;
  }
  if (haveNumericThresholdConflict(leftValue, rightValue)) {
    return false;
  }
  const titlesAlign = areSemanticallySimilar(left.title, right.title);
  if (
    titlesAlign &&
    (isMultiOutcomeContract(left) || isMultiOutcomeContract(right))
  ) {
    return true;
  }
  return titlesAlign && areSemanticallySimilar(leftValue, rightValue);
}

/**
 * Compares optional procedural terms without inventing a conflict from silence.
 *
 * @param leftValue - First extracted term.
 * @param rightValue - Second extracted term.
 * @returns True when the terms align or only one contract addresses the topic.
 */
function areOptionalTermsCompatible(
  leftValue: string,
  rightValue: string,
): boolean {
  if (normalize(leftValue) === normalize(rightValue)) {
    return true;
  }
  if (isMissingTerm(leftValue) || isMissingTerm(rightValue)) {
    return true;
  }
  if (haveDirectionConflict(leftValue, rightValue)) {
    return false;
  }
  if (haveNumericThresholdConflict(leftValue, rightValue)) {
    return false;
  }
  return areSemanticallySimilar(leftValue, rightValue);
}

/**
 * Parses common English date and clock expressions into an exclusive boundary.
 *
 * Thus `by Dec 31, 2027 at 11:59 PM` and `before Jan 1, 2028` both normalize
 * to midnight on January 1. The representation intentionally avoids timezone
 * conversion because both venue rule excerpts normally use the same market
 * timezone and the comparison concerns their stated calendar boundary.
 *
 * @param value - Extracted deadline sentence.
 * @returns Parsed boundary or null when no complete date is present.
 */
function parseCalendarBoundary(value: string): CalendarBoundary | null {
  const dateMatch = value.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(20\d{2})\b/i,
  );
  if (!dateMatch?.[1] || !dateMatch[2] || !dateMatch[3]) {
    return null;
  }
  const rawMonth = dateMatch[1].toLowerCase();
  const monthName = MONTH_ALIASES[rawMonth] ?? rawMonth;
  const month = MONTH_NUMBERS[monthName];
  if (month === undefined) {
    return null;
  }
  const day = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);
  const clockMinutes = parseClockMinutes(value);
  const isExclusive = /\bbefore\b/i.test(value);
  const dayNumber = Math.floor(Date.UTC(year, month, day) / 86_400_000);
  if (clockMinutes !== null) {
    const inclusiveAdjustmentMinutes = isExclusive ? 0 : 1;
    const adjustedMinutes = clockMinutes + inclusiveAdjustmentMinutes;
    return {
      dayNumber: dayNumber + Math.floor(adjustedMinutes / 1_440),
      minuteOfDay: adjustedMinutes % 1_440,
    };
  }
  return isExclusive
    ? { dayNumber, minuteOfDay: 0 }
    : { dayNumber: dayNumber + 1, minuteOfDay: 0 };
}

/**
 * Parses a common 12-hour clock expression.
 *
 * @param value - Contract sentence containing an optional clock time.
 * @returns Minutes after midnight or null when no time is stated.
 */
function parseClockMinutes(value: string): number | null {
  if (/\bmidnight\b/i.test(value)) {
    return 0;
  }
  if (/\bnoon\b/i.test(value)) {
    return 720;
  }
  const match = value.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/i,
  );
  if (!match?.[1] || !match[3]) {
    return null;
  }
  const hour12 = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const isPm = match[3].toLowerCase().startsWith("p");
  return (hour12 % 12) * 60 + (isPm ? 720 : 0) + minute;
}

/**
 * Detects whether an event contract contains several child Yes conditions.
 *
 * @param contract - Normalized contract.
 * @returns True for an aggregated multi-outcome event document.
 */
function isMultiOutcomeContract(contract: MarketContract): boolean {
  return (
    splitContractSentences(contract.rulesText).filter((sentence) =>
      /\b(?:resolves?|settles?)\s+to\s+(?:[“\"])?yes\b/i.test(sentence),
    ).length >= 2
  );
}

/**
 * Detects mutually different material trigger actions.
 *
 * @param left - First trigger sentence.
 * @param right - Second trigger sentence.
 * @returns True when both state actions and those action sets do not overlap.
 */
function haveMaterialActionConflict(left: string, right: string): boolean {
  const leftActions = getSemanticTokens(left).filter((token) =>
    MATERIAL_ACTION_TOKENS.has(token),
  );
  const rightActions = getSemanticTokens(right).filter((token) =>
    MATERIAL_ACTION_TOKENS.has(token),
  );
  return (
    leftActions.length > 0 &&
    rightActions.length > 0 &&
    !leftActions.some((action) => rightActions.includes(action))
  );
}

/**
 * Detects explicit above/below or Yes/No outcome direction conflicts.
 *
 * @param left - First comparison term.
 * @param right - Second comparison term.
 * @returns True when both terms express opposing directions.
 */
function haveDirectionConflict(left: string, right: string): boolean {
  const leftDirection = readDirection(left);
  const rightDirection = readDirection(right);
  return Boolean(
    leftDirection && rightDirection && leftDirection !== rightDirection,
  );
}

/**
 * Reads an explicit threshold or settlement direction.
 *
 * @param value - Extracted comparison term.
 * @returns Canonical direction or null when none is stated.
 */
function readDirection(value: string): string | null {
  if (/\b(?:above|at least|greater than|over)\b/i.test(value)) {
    return "above";
  }
  if (/\b(?:below|at most|less than|under)\b/i.test(value)) {
    return "below";
  }
  if (/\bresolve(?:s|d)?\s+to\s+[“\"]?no\b/i.test(value)) {
    return "no";
  }
  if (/\bresolve(?:s|d)?\s+to\s+[“\"]?yes\b/i.test(value)) {
    return "yes";
  }
  return null;
}

/**
 * Detects incompatible non-date numeric thresholds.
 *
 * @param left - First comparison term.
 * @param right - Second comparison term.
 * @returns True when both terms state different material number sets.
 */
function haveNumericThresholdConflict(left: string, right: string): boolean {
  const leftNumbers = extractMaterialNumbers(left);
  const rightNumbers = extractMaterialNumbers(right);
  return (
    leftNumbers.length > 0 &&
    rightNumbers.length > 0 &&
    normalizeNumberSet(leftNumbers) !== normalizeNumberSet(rightNumbers)
  );
}

/**
 * Extracts numeric values while omitting ordinary four-digit years.
 *
 * @param value - Extracted comparison term.
 * @returns Material numeric values in source order.
 */
function extractMaterialNumbers(value: string): number[] {
  return [...value.matchAll(/\b\d[\d,]*(?:\.\d+)?%?\b/g)]
    .map((match) => Number(match[0].replace(/[, %]/g, "")))
    .filter((number) => number < 1900 || number > 2100);
}

/**
 * Creates a stable representation of a numeric threshold set.
 *
 * @param values - Extracted numeric values.
 * @returns Sorted unique value key.
 */
function normalizeNumberSet(values: readonly number[]): string {
  return [...new Set(values)].sort((left, right) => left - right).join(",");
}

/**
 * Compares meaningful token sets using both containment and Jaccard overlap.
 *
 * @param left - First contract phrase.
 * @param right - Second contract phrase.
 * @returns True for close paraphrases with at least two shared concepts.
 */
function areSemanticallySimilar(left: string, right: string): boolean {
  const leftTokens = new Set(getSemanticTokens(left));
  const rightTokens = new Set(getSemanticTokens(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return false;
  }
  const intersectionSize = [...leftTokens].filter((token) =>
    rightTokens.has(token),
  ).length;
  const smallerSize = Math.min(leftTokens.size, rightTokens.size);
  const unionSize = new Set([...leftTokens, ...rightTokens]).size;
  const containment = intersectionSize / smallerSize;
  const jaccard = intersectionSize / unionSize;
  return intersectionSize >= 2 && containment >= 0.75 && jaccard >= 0.45;
}

/**
 * Converts prose into normalized semantic tokens.
 *
 * @param value - Contract prose or title.
 * @returns Distinguishing tokens in source order.
 */
function getSemanticTokens(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/initial public offering/g, " ipo ")
    .replace(/lead[ -]left/g, " lead ")
    .replace(/primary lead/g, " lead ")
    .split(/[^a-z0-9.]+/)
    .filter(Boolean)
    .map((token) => SEMANTIC_TOKEN_ALIASES[token] ?? token)
    .map((token) =>
      token.length > 4 && token.endsWith("s") ? token.slice(0, -1) : token,
    )
    .filter(
      (token) =>
        !SEMANTIC_STOP_WORDS.has(token) &&
        !/^20\d{2}$/.test(token) &&
        !/^(?:am|pm|et|edt|est)$/.test(token),
    );
}

/**
 * Identifies a value that represents missing extracted information.
 *
 * @param value - Extracted comparison value.
 * @returns True for the known absence markers.
 */
function isMissingTerm(value: string): boolean {
  return [NOT_ADDRESSED, NO_SOURCE, "Not explicitly stated"].includes(value);
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
 * Normalizes prose for direct comparison.
 *
 * @param value - Extracted comparison value.
 * @returns Lowercase punctuation- and whitespace-normalized value.
 */
function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
