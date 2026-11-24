import { readJarTolerant } from "./jar.js";

const ACCESSION_RE = /^SPC-(\d{4,})$/;
const COUNTER_RE = /^\d+$/;

/** `SPC-` followed by the number zero-padded to at least four digits, such as `SPC-0001`. */
export function formatAccession(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError("accession number must be a non-negative safe integer");
  }
  return "SPC-" + String(n).padStart(4, "0");
}

/** The number of an Accession_ID, or undefined when the text is not one or exceeds the safe integer range. */
export function parseAccession(id: string): number | undefined {
  const match = ACCESSION_RE.exec(id);
  if (!match || match[1] === undefined) return undefined;
  const n = Number(match[1]);
  return Number.isSafeInteger(n) ? n : undefined;
}

/** The stored counter from `.specimen/counter`: decimal digits after trimming whitespace. */
export function parseCounter(text: string): number | undefined {
  const trimmed = text.trim();
  if (!COUNTER_RE.test(trimmed)) return undefined;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : undefined;
}

/**
 * The highest Accession_ID number across the texts of several Jars. Invalid lines are
 * ignored, values above Number.MAX_SAFE_INTEGER are ignored, and 0 is returned when no
 * valid id exists. Never throws and never modifies its input.
 */
export function maxAccession(jarTexts: readonly string[]): number {
  let max = 0;
  for (const text of jarTexts) {
    for (const line of readJarTolerant(text)) {
      const n = parseAccession(line.id);
      if (n !== undefined && n > max) max = n;
    }
  }
  return max;
}
