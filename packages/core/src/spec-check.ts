/**
 * The Spec_Checker (Requirement 7 and the Reference checks of Requirement 8). It decides whether
 * a Bugfix_Spec counts as filed for one jar id. It reads only the `jars` entries of a
 * Replay_Result, never the verdict, red, filed, covered or reason fields of that document.
 *
 * Pure logic: no clock, no randomness, no network and no Node built-in import.
 */
import { z } from "zod";
import { jsonValue } from "./jar.js";
import { type Json, canonicalJson, isJsonResponse } from "./json.js";
import { referenceOf, referenceSubstrings } from "./reference.js";
import type { ResultEntry } from "./replay-result.js";

/** One failed check. `code` is the stable identifier, `message` is for people. */
export type Failure = { code: string; message: string };

const SECTION_CURRENT = "Current Behavior (Defect)";
const SECTION_EXPECTED = "Expected Behavior (Correct)";
const SECTION_UNCHANGED = "Unchanged Behavior (Regression Prevention)";

const MARKER_START = "<!-- specimen:repro:start -->";
const MARKER_END = "<!-- specimen:repro:end -->";
const REPRO_INFO = "json specimen-repro";

/** Characters that make a jar id or path part of a longer token. */
const ID_BOUNDARY = "A-Za-z0-9-";
/** Pointers and Reference elements also stop at `_`, `~` and `/`, so `/total` is not `/total_cents`. */
const PATH_BOUNDARY = "A-Za-z0-9_~/-";

/** One entry of the Repro_Block (Requirement 7 criterion 8). */
const reproEntrySchema = z.strictObject({
  id: z.string(),
  input: jsonValue.nullable(),
  response_text: z.string().nullable(),
  replayed: jsonValue.nullable(),
  changed_paths: z.array(z.string()),
});

const reproBlockSchema = z.array(reproEntrySchema);

type ReproEntry = z.infer<typeof reproEntrySchema>;

/**
 * Checks one Bugfix_Spec text against one jar. Returns "pass" when every check holds, otherwise
 * every failing check. A jar that is not in `resultJars`, or that is neither rattled nor
 * cracked, gives the single failure `jar_unknown` or `not_red`.
 */
export function checkSpec(
  text: string,
  jarId: string,
  resultJars: ResultEntry[],
): "pass" | Failure[] {
  const entry = resultJars.find((jar) => jar.id === jarId);
  if (entry === undefined) {
    return [{ code: "jar_unknown", message: `jar ${jarId} is not in the Replay_Result` }];
  }
  if (entry.state !== "rattled" && entry.state !== "cracked") {
    return [{ code: "not_red", message: "jar is not rattled or cracked" }];
  }

  const lines = text.split(/\r?\n/);
  const failures: Failure[] = [];
  const blocks = fenceBlocks(lines);
  const headings = markdownHeadings(lines, blocks);

  const current = sectionText(lines, headings, SECTION_CURRENT, failures);
  const expected = sectionText(lines, headings, SECTION_EXPECTED, failures);
  const unchanged = sectionText(lines, headings, SECTION_UNCHANGED, failures);

  if (!/WHEN.*THEN the system/.test(current ?? "")) {
    failures.push({
      code: "when_then",
      message: `${SECTION_CURRENT} has no line with WHEN ... THEN the system`,
    });
  }
  if (!(expected ?? "").split("\n").some((line) => /SHALL(?! CONTINUE TO)/.test(line))) {
    failures.push({
      code: "shall",
      message: `${SECTION_EXPECTED} has no SHALL outside SHALL CONTINUE TO`,
    });
  }
  if (!(unchanged ?? "").includes("SHALL CONTINUE TO")) {
    failures.push({
      code: "shall_continue",
      message: `${SECTION_UNCHANGED} has no SHALL CONTINUE TO`,
    });
  }

  if (!tokenRegExp(jarId, ID_BOUNDARY).test(text)) {
    failures.push({ code: "jar_id", message: `spec does not cite the jar id ${jarId}` });
  }

  failures.push(...reproFailures(lines, blocks, entry));

  if (current === undefined) {
    failures.push({ code: "paths", message: `${SECTION_CURRENT} section is missing` });
  } else {
    const missing = entry.changes
      .map((change) => change.path)
      .filter((path) => !tokenRegExp(path, PATH_BOUNDARY).test(current));
    if (missing.length > 0) {
      failures.push({
        code: "paths",
        message: `${SECTION_CURRENT} does not name the changed path(s): ${missing.join(", ")}`,
      });
    }
  }

  if (unchanged === undefined) {
    failures.push({
      code: "unchanged_jar",
      message: `${SECTION_UNCHANGED} section is missing`,
    });
  } else {
    failures.push(...unchangedFailures(unchanged, entry, resultJars));
  }

  if (expected === undefined) {
    failures.push({ code: "expected_reference", message: "expected does not name the reference" });
  } else {
    failures.push(...expectedFailures(expected, entry));
  }

  return failures.length === 0 ? "pass" : failures;
}

/** A markdown heading line that is not inside a fenced code block. */
type Heading = { index: number; level: number; text: string };

/** A fenced code block: the opening line, the closing line (or the end of text) and the info string. */
type FenceBlock = { open: number; close: number; info: string };

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*$/;

/** Every fenced code block of the text, in order. An unclosed block runs to the end of the text. */
function fenceBlocks(lines: readonly string[]): FenceBlock[] {
  const blocks: FenceBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = FENCE_OPEN.exec(lines[i] ?? "");
    const marker = open?.[1];
    if (open === null || marker === undefined || open[2] === undefined) {
      i++;
      continue;
    }
    const info = open[2].trim();
    if (marker.startsWith("`") && info.includes("`")) {
      i++;
      continue;
    }
    let close = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = FENCE_CLOSE.exec(lines[j] ?? "");
      const run = candidate?.[1];
      if (run !== undefined && run[0] === marker[0] && run.length >= marker.length) {
        close = j;
        break;
      }
    }
    blocks.push({ open: i, close, info });
    i = close + 1;
  }
  return blocks;
}

/** The headings of the text, skipping every line inside a fenced code block. */
function markdownHeadings(lines: readonly string[], blocks: readonly FenceBlock[]): Heading[] {
  const inside = new Set<number>();
  for (const block of blocks) {
    for (let i = block.open; i <= block.close && i < lines.length; i++) inside.add(i);
  }
  const headings: Heading[] = [];
  lines.forEach((line, index) => {
    if (inside.has(index)) return;
    const match = HEADING.exec(line);
    const hashes = match?.[1];
    const title = match?.[2];
    if (hashes !== undefined && title !== undefined) {
      headings.push({ index, level: hashes.length, text: title });
    }
  });
  return headings;
}

/**
 * The text of one named Section: the lines after its Heading up to the next heading of the same
 * or a higher level, or the end of the text. Returns undefined when the Heading is absent. A
 * Heading that appears more than once adds a `headings` failure and the first one is used.
 */
function sectionText(
  lines: readonly string[],
  headings: readonly Heading[],
  name: string,
  failures: Failure[],
): string | undefined {
  const matches = headings.filter((heading) => heading.text === name);
  const first = matches[0];
  if (first === undefined) {
    failures.push({ code: "headings", message: `missing heading "${name}"` });
    return undefined;
  }
  if (matches.length > 1) {
    failures.push({
      code: "headings",
      message: `heading "${name}" appears ${matches.length} times`,
    });
  }
  const next = headings.find((heading) => heading.index > first.index && heading.level <= first.level);
  const end = next === undefined ? lines.length : next.index;
  return lines.slice(first.index + 1, end).join("\n");
}

/** Checks the Repro_Block against the entry of the jar. Returns the failures, possibly none. */
function reproFailures(
  lines: readonly string[],
  blocks: readonly FenceBlock[],
  entry: ResultEntry,
): Failure[] {
  const starts = lineIndexes(lines, MARKER_START);
  const ends = lineIndexes(lines, MARKER_END);
  const start = starts[0];
  const end = ends[0];
  if (starts.length !== 1 || ends.length !== 1 || start === undefined || end === undefined || start > end) {
    return [
      {
        code: "repro_missing",
        message: "spec needs exactly one repro marker pair, start before end",
      },
    ];
  }

  const found = blocks.filter((block) => block.open > start && block.close < end && block.info === REPRO_INFO);
  const block = found[0];
  if (found.length !== 1 || block === undefined) {
    return [
      {
        code: "repro_missing",
        message: `repro markers must enclose exactly one "${REPRO_INFO}" block, found ${found.length}`,
      },
    ];
  }

  const content = lines.slice(block.open + 1, block.close).join("\n");
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return [{ code: "repro_missing", message: "repro block is not valid JSON" }];
  }
  const parsed = reproBlockSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue === undefined ? "" : `${issue.path.join(".")}: ${issue.message}`;
    return [{ code: "repro_missing", message: `repro block fails its schema at ${where}` }];
  }

  const repro = parsed.data.filter((item) => item.id === entry.id);
  const reproEntry = repro[0];
  if (repro.length !== 1 || reproEntry === undefined) {
    return [
      {
        code: "repro_missing",
        message: `repro block needs exactly one entry for ${entry.id ?? "the jar"}, found ${repro.length}`,
      },
    ];
  }

  return differingFields(reproEntry, entry).map((field) => ({
    code: "repro_not_verbatim",
    message: `repro entry differs from the replay in ${field}`,
  }));
}

/** The names of the repro fields that differ from the Result_Entry, in a fixed order. */
function differingFields(repro: ReproEntry, entry: ResultEntry): string[] {
  const differs: string[] = [];
  if (canonicalJson(repro.input) !== canonicalJson(entry.input)) differs.push("input");
  if (!sameResponseText(repro.response_text, entry.response_text)) differs.push("response_text");
  if (canonicalJson(repro.replayed) !== canonicalJson(entry.replayed)) differs.push("replayed");
  const paths: Json = entry.changes.map((change) => change.path);
  if (canonicalJson(repro.changed_paths) !== canonicalJson(paths)) differs.push("changed_paths");
  return differs;
}

/**
 * Canonical_JSON equality when the jarred text is a JSON_Response, exact equality otherwise.
 * The jarred text is the reference: a repro text that is not a JSON_Response cannot match it.
 */
function sameResponseText(repro: string | null, jarred: string | null): boolean {
  if (repro === null || jarred === null) return repro === jarred;
  if (!isJsonResponse(jarred)) return repro === jarred;
  if (!isJsonResponse(repro)) return false;
  return canonicalJson(JSON.parse(jarred) as Json) === canonicalJson(JSON.parse(repro) as Json);
}

/** Failures of the unchanged-jar check, read from the Unchanged Section and the companion entries. */
function unchangedFailures(section: string, entry: ResultEntry, resultJars: ResultEntry[]): Failure[] {
  const preserved = resultJars.flatMap((jar) =>
    jar.state === "preserved" && jar.tool === entry.tool && jar.id !== null ? [jar.id] : [],
  );

  if (preserved.length > 0) {
    const named = preserved.some((id) => tokenRegExp(id, ID_BOUNDARY).test(section));
    if (named) return [];
    return [
      {
        code: "unchanged_jar",
        message: `${SECTION_UNCHANGED} names no preserved jar of ${entry.tool} (${preserved.join(", ")})`,
      },
    ];
  }

  const says = section.split("\n").some((line) => line.includes("no preserved jar"));
  if (says) return [];
  return [
    {
      code: "unchanged_jar",
      message: `${SECTION_UNCHANGED} must say "no preserved jar" because no preserved jar of ${entry.tool} exists`,
    },
  ];
}

/**
 * Failures of the Reference check. A Reference that cannot be derived from the entry is one
 * failure with its own code, never a crash.
 */
function expectedFailures(section: string, entry: ResultEntry): Failure[] {
  let reference: ReturnType<typeof referenceOf>;
  try {
    reference = referenceOf(entry);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return [
      {
        code: "reference_unresolvable",
        message: `cannot derive the reference of ${entry.id ?? "the jar"}: ${detail}`,
      },
    ];
  }
  const named = reference.every((element) =>
    referenceSubstrings(element).every((text) => tokenRegExp(text, PATH_BOUNDARY).test(section)),
  );
  if (named) return [];
  return [{ code: "expected_reference", message: "expected does not name the reference" }];
}

/** Indexes of the lines whose trimmed text equals `marker`. */
function lineIndexes(lines: readonly string[], marker: string): number[] {
  const found: number[] = [];
  lines.forEach((line, index) => {
    if (line.trim() === marker) found.push(index);
  });
  return found;
}

/**
 * A regular expression that finds `token` only where neither side touches a character of
 * `boundary`. A side is checked only when the token's own edge character is in `boundary`.
 */
function tokenRegExp(token: string, boundary: string): RegExp {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const edgeIn = (char: string | undefined): boolean =>
    char !== undefined && new RegExp(`^[${boundary}]$`).test(char);
  const before = edgeIn(token.charAt(0)) ? `(?<![${boundary}])` : "";
  const after = edgeIn(token.charAt(token.length - 1)) ? `(?![${boundary}])` : "";
  return new RegExp(before + escaped + after);
}
