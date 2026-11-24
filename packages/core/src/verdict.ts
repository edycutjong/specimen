/**
 * The verdict: the single source of truth for SHIP or HOLD (Requirement 5). Pure logic: no
 * clock, no randomness, no network and no Node built-in import. The arguments are not mutated.
 */
import type { ReplayResult, ResultEntry } from "./replay-result.js";

export type VerdictArgs = {
  entries: ResultEntry[];
  spoiledCount: number;
  toolsListed: string[];
  filedIds: ReadonlySet<string>;
};

export type VerdictResult = {
  verdict: "SHIP" | "HOLD";
  reason: string;
  red: number;
  filed: number;
  covered: boolean;
  coverage: ReplayResult["coverage"];
};

const ORPHAN_REASON = "orphan pre-event";
const UNPAIRED_REASON = "unpaired post-event";

/** Code-unit order, the order every list in the verdict uses. */
function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** The distinct values of `values`, sorted in code-unit order. Never mutates the input. */
function distinctSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareCodeUnits);
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

/**
 * The reason parts, in the fixed order of Requirement 5 criterion 8: no jars, red, not
 * replayed, quarantined, spoiled.
 */
function reasonParts(
  entries: ResultEntry[],
  spoiledCount: number,
  counts: Record<"rattled" | "cracked" | "skipped", number>,
  quarantined: Map<string, number>,
  skippedTools: string[],
): string[] {
  const parts: string[] = [];

  if (entries.length === 0 && spoiledCount === 0) {
    parts.push("no jars");
  }

  if (counts.rattled > 0 || counts.cracked > 0) {
    const red: string[] = [];
    if (counts.rattled > 0) red.push(`${counts.rattled} rattled`);
    if (counts.cracked > 0) red.push(`${counts.cracked} cracked`);
    parts.push(red.join(", "));
  }

  if (counts.skipped > 0) {
    const tools = skippedTools.join(", ");
    parts.push(
      `${counts.skipped} not replayed: not in replay.json — allow ${tools} in .specimen/replay.json to replay them against your disposable test instance`,
    );
  }

  for (const reason of [ORPHAN_REASON, UNPAIRED_REASON]) {
    const count = quarantined.get(reason) ?? 0;
    if (count > 0) {
      parts.push(`${count} quarantined: ${reason} — re-record the session`);
    }
  }

  if (spoiledCount >= 1) {
    parts.push(`${spoiledCount} ${plural(spoiledCount, "spoiled line", "spoiled lines")}`);
  }

  return parts;
}

/**
 * Decides SHIP or HOLD and builds the counts, reason and coverage.
 *
 * SHIP if and only if at least one Compared_Jar exists, no jar is rattled, cracked, unsealed or
 * skipped, and spoiledCount is 0. SHIP means "replay clean on the recorded set" and nothing more.
 *
 * `covered` is true only when the verdict is HOLD, a Compared_Jar exists, `red` is above 0, every
 * Red_Jar is filed, no jar is unsealed or skipped, and no line is spoiled.
 *
 * Coverage follows Requirement 5 criterion 13. A tool is recorded when a Jar_Line names it, and an
 * Orphan_Entry (id null) names no Jar_Line. `tools_compared` holds the distinct tools of compared
 * jars that are listed. `tools_unrecorded` holds the listed tools that no Jar_Line names.
 */
export function verdict(args: VerdictArgs): VerdictResult {
  const { entries, spoiledCount, toolsListed, filedIds } = args;

  const counts = { preserved: 0, rattled: 0, cracked: 0, unsealed: 0, skipped: 0 };
  const quarantined = new Map<string, number>();
  const skippedTools: string[] = [];
  const comparedTools: string[] = [];
  const recordedTools: string[] = [];
  let red = 0;
  let filed = 0;

  for (const entry of entries) {
    counts[entry.state] += 1;
    if (entry.id !== null) recordedTools.push(entry.tool);
    if (entry.state === "rattled" || entry.state === "cracked") {
      red += 1;
      if (entry.id !== null && filedIds.has(entry.id)) filed += 1;
    }
    if (entry.state === "skipped") skippedTools.push(entry.tool);
    if (entry.state === "unsealed" && entry.reason !== undefined) {
      if (entry.reason === ORPHAN_REASON || entry.reason === UNPAIRED_REASON) {
        quarantined.set(entry.reason, (quarantined.get(entry.reason) ?? 0) + 1);
      }
    }
    if (entry.state === "preserved" || entry.state === "rattled" || entry.state === "cracked") {
      comparedTools.push(entry.tool);
    }
  }

  const compared = counts.preserved + counts.rattled + counts.cracked;
  const listed = distinctSorted(toolsListed);
  const listedSet = new Set(listed);
  const recordedSet = new Set(recordedTools);

  const coverage: ReplayResult["coverage"] = {
    compared,
    tools_compared: distinctSorted(comparedTools.filter((tool) => listedSet.has(tool))),
    tools_listed: listed,
    tools_unrecorded: listed.filter((tool) => !recordedSet.has(tool)),
  };

  const clean =
    compared > 0 &&
    counts.rattled === 0 &&
    counts.cracked === 0 &&
    counts.unsealed === 0 &&
    counts.skipped === 0 &&
    spoiledCount === 0;

  const verdictValue: "SHIP" | "HOLD" = clean ? "SHIP" : "HOLD";
  const reason = clean
    ? ""
    : reasonParts(entries, spoiledCount, counts, quarantined, distinctSorted(skippedTools)).join(
        "; ",
      );

  const covered =
    verdictValue === "HOLD" &&
    compared > 0 &&
    red > 0 &&
    filed === red &&
    counts.unsealed === 0 &&
    counts.skipped === 0 &&
    spoiledCount === 0;

  return { verdict: verdictValue, reason, red, filed, covered, coverage };
}
