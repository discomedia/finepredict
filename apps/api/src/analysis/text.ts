/**
 * Splits contract prose into sentences without breaking common clock abbreviations.
 *
 * @param text - Original contract prose.
 * @returns Verbatim sentences with original punctuation restored.
 */
export function splitContractSentences(text: string): string[] {
  const protectedText = text.replace(
    /\b([ap])\.m\./gi,
    (_match, period: string) => `${period}§m§`,
  );
  return protectedText
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.replace(/§m§/g, ".m.").trim())
    .filter(Boolean);
}
