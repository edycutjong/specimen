/**
 * The filed-ids rule (Requirement 9). Pure: it takes spec text and Replay_Result entries and
 * returns ids. It reads no file, so the browser cabinet can bundle it. Reading the spec files is
 * left to the caller.
 */
import { checkSpec } from "./spec-check.js";
import type { ResultEntry } from "./replay-result.js";

/** One `.kiro/specs/<name>/bugfix.md` file. */
export type BugfixSpec = { name: string; text: string };

/**
 * True when `id` occurs in `text` as a Whole_Token_Match: it is neither preceded nor followed by
 * an alphanumeric character or by "-". So `SPC-0004` does not match inside `SPC-00045`.
 */
export function citesId(text: string, id: string): boolean {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9-])${escaped}(?![A-Za-z0-9-])`).test(text);
}

/**
 * The ids of the Red_Jars (rattled or cracked) for which at least one Bugfix_Spec that cites the
 * id passes checkSpec. Each spec is checked against every id it cites, so a spec that fails for
 * one of several ids counts only for the ids it passes. The Replay_Result entries are read only
 * to find the Red_Jars and to run the check.
 */
export function filedJarIds(specs: readonly BugfixSpec[], jars: ResultEntry[]): Set<string> {
  const filed = new Set<string>();
  for (const jar of jars) {
    if (jar.id === null) continue;
    if (jar.state !== "rattled" && jar.state !== "cracked") continue;
    const id = jar.id;
    const passes = specs.some((spec) => citesId(spec.text, id) && checkSpec(spec.text, id, jars) === "pass");
    if (passes) filed.add(id);
  }
  return filed;
}
