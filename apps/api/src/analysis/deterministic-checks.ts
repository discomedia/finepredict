import type {
  ContractFinding,
  FindingSeverity,
  MarketContract,
} from "@finepredict/shared";

import { splitContractSentences } from "./text.js";

/** Declarative contract-language check applied to title and rules text. */
interface PatternCheck {
  checkId: string;
  explanation: string;
  pattern: RegExp;
  severity: FindingSeverity;
  title: string;
}

/** Deterministic wording checks that produce only specific, quoted findings. */
const PATTERN_CHECKS: readonly PatternCheck[] = [
  {
    checkId: "subjective-fallback",
    explanation:
      "This fallback depends on judgment about which reporting is credible or what counts as consensus, so two reasonable reviewers could apply it differently.",
    pattern:
      /(?:consensus|preponderance) of (?:credible|reliable) (?:reporting|sources)|credible reporting/i,
    severity: "high",
    title: "Subjective fallback language",
  },
  {
    checkId: "undefined-official-trigger",
    explanation:
      "The contract uses an official-status trigger without defining the act or document that makes the status official.",
    pattern:
      /official(?:ly)? (?:launch(?:ed)?|announc(?:e|ed|ement)|resign(?:ed|ation)|complete(?:d|tion)|approve(?:d|al))/i,
    severity: "warning",
    title: "Potentially undefined official trigger",
  },
  {
    checkId: "inclusive-deadline",
    explanation:
      "The boundary word may leave readers unsure whether an event occurring on the named date counts unless the rules state an exact time.",
    pattern:
      /\b(?:before|through|by|until)\s+(?:[A-Z][a-z]+\s+\d{1,2}|\d{1,2}\/\d{1,2}|the end of)/,
    severity: "warning",
    title: "Date boundary may be ambiguous",
  },
  {
    checkId: "preliminary-data",
    explanation:
      "Preliminary values can differ from finalized values; the contract should make clear which publication controls settlement.",
    pattern: /\bpreliminary\b/i,
    severity: "warning",
    title: "Preliminary figures are material",
  },
  {
    checkId: "revision-treatment",
    explanation:
      "Later revisions can change the reported result, so this wording materially determines which data vintage settles the market.",
    pattern:
      /\b(?:revis(?:e|ed|ion|ions)|final(?:ized)? figures|subsequent update)\b/i,
    severity: "warning",
    title: "Statistical revision treatment matters",
  },
  {
    checkId: "postponement-treatment",
    explanation:
      "A postponement or rescheduling clause can extend the exposure beyond the apparent deadline instead of voiding the contract.",
    pattern: /\b(?:postpon(?:e|ed|ement)|reschedul(?:e|ed|ing)|delayed?)\b/i,
    severity: "warning",
    title: "Postponement treatment changes the contract",
  },
  {
    checkId: "cancellation-treatment",
    explanation:
      "Cancellation language can settle, void, or extend a market differently; the stated consequence should be read literally.",
    pattern: /\b(?:cancel(?:led|ed|lation)|abandon(?:ed|ment)|void(?:ed)?)\b/i,
    severity: "warning",
    title: "Cancellation treatment is material",
  },
  {
    checkId: "source-unavailable",
    explanation:
      "This clause controls settlement when the preferred source is unavailable and may substitute a materially different source.",
    pattern:
      /(?:source|website|data).{0,50}(?:unavailable|ceases|discontinued|not publish)|(?:unavailable|ceases|discontinued).{0,50}(?:source|website|data)/i,
    severity: "high",
    title: "Source availability fallback",
  },
  {
    checkId: "platform-discretion",
    explanation:
      "This wording gives a decision-maker discretion beyond an objective source or mechanical test.",
    pattern:
      /(?:in (?:its|their) (?:sole )?discretion|deems? appropriate|may determine|reserves the right)/i,
    severity: "high",
    title: "Discretionary settlement language",
  },
  {
    checkId: "announcement-trigger",
    explanation:
      "An announcement trigger can resolve before the announced action is implemented or completed.",
    pattern: /\b(?:public(?:ly)? )?announc(?:e|ed|ement)\b/i,
    severity: "info",
    title: "Announcement may be sufficient",
  },
  {
    checkId: "completion-trigger",
    explanation:
      "A completion trigger requires the underlying act to finish; an announcement or agreement alone may not qualify.",
    pattern:
      /\b(?:completed? (?:transaction|acquisition|sale|launch)|transaction (?:closes|closed)|consummat(?:e|ed|ion))\b/i,
    severity: "info",
    title: "Completion appears to be required",
  },
  {
    checkId: "external-terms",
    explanation:
      "The settlement test incorporates material outside content, so the contract cannot be assessed from the visible rules alone.",
    pattern:
      /(?:available at|set forth (?:at|in)|pursuant to|incorporated by reference|see\s+https?:\/\/)/i,
    severity: "warning",
    title: "Rules incorporate external terms",
  },
  {
    checkId: "proxy-measurement",
    explanation:
      "The named source may be used as a proxy rather than publishing the exact contractual measurement directly.",
    pattern:
      /(?:calculated (?:from|using)|derived from|proxy for|as inferred from)/i,
    severity: "warning",
    title: "Source may not publish the exact measurement",
  },
  {
    checkId: "multiple-source-hierarchy",
    explanation:
      "Multiple possible sources are named, making their priority and conflict-handling rules important.",
    pattern:
      /(?:or any other|and\/or|alternative source|secondary source|other reputable source)/i,
    severity: "warning",
    title: "Multiple-source hierarchy",
  },
  {
    checkId: "materiality-qualifier",
    explanation:
      "A materiality qualifier introduces a judgment call unless the contract defines a measurable threshold.",
    pattern: /\b(?:material(?:ly)?|substantial(?:ly)?|significant(?:ly)?)\b/i,
    severity: "warning",
    title: "Subjective materiality threshold",
  },
];

/**
 * Runs the deterministic contract checklist and returns exact quoted findings.
 *
 * @param contract - Normalized contract to inspect.
 * @returns Specific findings, never an aggregate or pseudo-precise score.
 */
export function runDeterministicChecks(
  contract: MarketContract,
): ContractFinding[] {
  const sourceText = `${contract.title}\n\n${contract.rulesText}`;
  const findings = PATTERN_CHECKS.flatMap((check) => {
    const match = sourceText.match(check.pattern);
    if (!match?.[0]) {
      return [];
    }
    return [
      createFinding(
        check.checkId,
        check.severity,
        check.title,
        check.explanation,
        extractQuote(sourceText, match.index ?? 0, match[0].length),
      ),
    ];
  });

  if (!contract.resolutionSource) {
    findings.unshift(
      createFinding(
        "missing-resolution-source",
        "high",
        "No explicit resolution source extracted",
        "The visible contract data does not name a distinct resolution source, so source authority and availability cannot be verified independently.",
        contract.title,
      ),
    );
  }

  const timeMatch = sourceText.match(
    /(?:\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?)|11:59|midnight|noon)/i,
  );
  if (timeMatch?.[0] && !hasTimezone(sourceText)) {
    findings.push(
      createFinding(
        "timezone-ambiguity",
        "high",
        "Deadline has no explicit timezone",
        "The rules state a clock time without an explicit timezone, so the settlement boundary may differ by several hours.",
        extractQuote(sourceText, timeMatch.index ?? 0, timeMatch[0].length),
      ),
    );
  }

  const titleTrigger = detectTrigger(contract.title);
  const rulesTrigger = detectTrigger(contract.rulesText);
  if (titleTrigger && rulesTrigger && titleTrigger !== rulesTrigger) {
    findings.push(
      createFinding(
        "title-rules-trigger-conflict",
        "high",
        "Title and full rules suggest different triggers",
        `The title suggests ${titleTrigger}, while the full rules suggest ${rulesTrigger}; settlement generally turns on the full rules rather than the headline shorthand.`,
        contract.title,
      ),
    );
  }

  return findings;
}

/**
 * Creates a stable finding object.
 *
 * @param checkId - Deterministic check identifier.
 * @param severity - Finding severity.
 * @param title - Short user-facing title.
 * @param explanation - Verifiable explanation.
 * @param quote - Exact source text supporting the finding.
 * @returns Contract finding.
 */
function createFinding(
  checkId: string,
  severity: FindingSeverity,
  title: string,
  explanation: string,
  quote: string,
): ContractFinding {
  return {
    checkId,
    explanation,
    id: crypto.randomUUID(),
    llmExplained: false,
    quote,
    severity,
    title,
  };
}

/**
 * Extracts the complete sentence or compact surrounding clause for a match.
 *
 * @param text - Original title and rules text.
 * @param matchIndex - Start index of the matched wording.
 * @param matchLength - Length of the matched wording.
 * @returns Verbatim source excerpt.
 */
function extractQuote(
  text: string,
  matchIndex: number,
  matchLength: number,
): string {
  const matchedText = text.slice(matchIndex, matchIndex + matchLength);
  const exactSentence = splitContractSentences(text).find((sentence) =>
    sentence.includes(matchedText),
  );
  if (exactSentence) {
    return exactSentence.slice(0, 420);
  }
  const sentenceStart = Math.max(
    text.lastIndexOf(".", matchIndex - 1),
    text.lastIndexOf("\n", matchIndex - 1),
  );
  const nextPeriod = text.indexOf(".", matchIndex + matchLength);
  const nextLine = text.indexOf("\n", matchIndex + matchLength);
  const possibleEnds = [nextPeriod, nextLine].filter((index) => index >= 0);
  const sentenceEnd = possibleEnds.length
    ? Math.min(...possibleEnds) + 1
    : Math.min(text.length, matchIndex + matchLength + 160);
  return text
    .slice(sentenceStart + 1, sentenceEnd)
    .trim()
    .slice(0, 420);
}

/**
 * Determines whether contract prose contains a recognizable timezone.
 *
 * @param text - Full contract text.
 * @returns True when an explicit timezone marker is present.
 */
function hasTimezone(text: string): boolean {
  return /\b(?:ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT|UTC|GMT|Eastern Time|Central Time|Pacific Time)\b/i.test(
    text,
  );
}

/** Trigger family used for title-versus-rules comparison. */
type TriggerFamily = "an announcement" | "a completed event" | "a launch";

/**
 * Detects the primary event trigger described by a short text.
 *
 * @param text - Title or rules text.
 * @returns Trigger family or null when no supported trigger is present.
 */
function detectTrigger(text: string): TriggerFamily | null {
  if (/\bannounc(?:e|ed|ement)\b/i.test(text)) {
    return "an announcement";
  }
  if (/\b(?:complet(?:e|ed|ion)|clos(?:e|ed|ing)|consummat)/i.test(text)) {
    return "a completed event";
  }
  if (/\blaunch(?:ed|es|ing)?\b/i.test(text)) {
    return "a launch";
  }
  return null;
}

/** Number of deterministic checks FinePredict applies before using an LLM. */
export const DETERMINISTIC_CHECK_COUNT = PATTERN_CHECKS.length + 3;
