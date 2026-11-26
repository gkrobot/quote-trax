// Cleanup rules applied when quotes are imported. Decisions from review:
// - The "Fitness" heading is removed from one quote.
// - Single line breaks inside a paragraph are joined as wraps, except in the
//   quotes listed below, where the break is intentional (verse, a list, chat).
// - Paragraph breaks (blank lines) are always kept.

const KEEP_LINE_BREAKS = new Set(["mrxt4ydo-gq2lhqr", "muw3bsd1-qux5r09", "muzk2hty-ty3btpd"]);
const LEADING_HEADING: Record<string, string> = { "mwgxlqc7-2s2crkz": "Fitness" };

// Trailing attribution such as "- Roque" or "-Lysander". The dash must follow
// whitespace or closing punctuation, so hyphens inside words don't match.
const ATTRIBUTION = /(?:\s+|(?<=[.!?”"’]))[-–—]\s*([^\n]{2,120})$/;

// Text-only cleanup. Used when the export already carries a separate attribution.
export function cleanText(id: string, raw: string): string {
  let text = raw.trim();

  const heading = LEADING_HEADING[id];
  if (heading && text.startsWith(heading + "\n")) {
    text = text.slice(heading.length + 1).trimStart();
  }

  if (!KEEP_LINE_BREAKS.has(id)) {
    text = text.replace(/(?<=[^\n])\n(?=[^\n])/g, " ");
  }

  return text;
}

// Splits a trailing attribution off the end of a quote's text.
export function splitAttribution(text: string): { text: string; attribution: string | null } {
  const match = text.match(ATTRIBUTION);
  if (match && match.index !== undefined && match.index > 0) {
    return { text: text.slice(0, match.index).trimEnd(), attribution: match[1].trim() };
  }
  return { text, attribution: null };
}

// Full cleanup for raw text that may still have an attribution at the end.
export function cleanQuote(id: string, raw: string): { text: string; attribution: string | null } {
  return splitAttribution(cleanText(id, raw));
}

// Stable series ID derived from the name, so re-imports reuse the same row.
export function seriesId(name: string): string {
  return "series-" + name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
