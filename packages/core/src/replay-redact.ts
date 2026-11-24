/**
 * Redaction of one Result_Entry before it is written (Requirement 6 criteria 8 and 9). The
 * functions of redact.ts are reused with the same Compiled Redact_Config that jar-capture uses.
 * Nothing here is compared: Bodies are compared before this step runs.
 *
 * Pure logic: no clock, no randomness, no I/O and no Node built-in import.
 */
import type { Change } from "./diff.js";
import type { Json } from "./json.js";
import { MARKER, redactInput, redactResponse, type Compiled } from "./redact.js";
import type { ResultEntry } from "./replay-result.js";

/** The unescaped segments of a Change path. The root path has none. */
function pathKeys(path: string): string[] {
  if (path === "") return [];
  return path
    .slice(1)
    .split("/")
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/**
 * Redacts one value of a Change. A Change whose path has a segment equal to a redacted key
 * loses its value entirely and keeps only the Redaction_Marker. Any other value is redacted
 * as a tool input is: keys and pattern matches are replaced as in jar-capture.
 */
function redactValue(value: Json, keyed: boolean, c: Compiled): Json {
  return keyed ? MARKER : redactInput(value, c).value;
}

/** A copy of a Change with its `was` and `now` redacted. The path and note are kept. */
export function redactChange(change: Change, c: Compiled): Change {
  const keyed = pathKeys(change.path).some((key) => c.keys.has(key));
  const out: Change = { path: change.path, kind: change.kind };
  if (change.was !== undefined) out.was = redactValue(change.was, keyed, c);
  if (change.now !== undefined) out.now = redactValue(change.now, keyed, c);
  if (change.note !== undefined) out.note = change.note;
  return out;
}

/**
 * A copy of a Result_Entry with every replayed text, replayed value, Change value and error
 * redacted. The replayed text uses the configured mode, so a hash-mode config stores its hash,
 * as jar-capture does for a response. An error text never becomes a hash: it is redacted in
 * `redact` mode, so the reason stays readable.
 */
export function redactEntry(entry: ResultEntry, c: Compiled): ResultEntry {
  const out: ResultEntry = {
    ...entry,
    changes: entry.changes.map((change) => redactChange(change, c)),
    compatible: entry.compatible.map((change) => redactChange(change, c)),
  };
  if (entry.replayed_text !== null) {
    const redacted = redactResponse(entry.replayed_text, c);
    out.replayed_text = redacted.responseText;
    out.replayed = redacted.response;
  }
  if (entry.error !== undefined) {
    out.error = redactResponse(entry.error, { ...c, text: "redact" }).responseText;
  }
  return out;
}
