/**
 * Jar_Loader: turns the text of jar files and of the Pending_File into Jar_Lines, Orphan_Entry
 * candidates and Spoiled_Lines, and groups them into Session_Groups. Pure logic with no Node
 * built-in imports, no clock and no I/O. Jar lines are parsed by jar-capture's readJar and
 * jarLineSchema, and pending lines by pendingEntrySchema.
 */
import { z } from "zod";
import { readJar, type JarError, type JarLine } from "./jar.js";
import { pendingEntrySchema, type PendingEntry } from "./pairing.js";
import { fieldPaths } from "./payload.js";

/** The file name reported for Pending_File lines. */
export const PENDING_FILE = ".specimen/pending.jsonl";

/** A line excluded from replay. `line` is 1-based. */
export type SpoiledLine = { file: string; line: number; reason: string };

/** One jar file: its file name and full text. */
export type JarFile = { file: string; text: string };

export type LoaderResult = {
  /** Every schema-valid Jar_Line in loading order, including those spoiled as duplicates. */
  valid: JarLine[];
  /** The Jar_Lines that are not spoiled, in loading order. */
  lines: JarLine[];
  /** Spoiled lines ordered by file name, then line number. */
  spoiled: SpoiledLine[];
};

export type PendingResult = { entries: PendingEntry[]; spoiled: SpoiledLine[] };

export type GroupMember =
  | { kind: "jar"; line: JarLine }
  | { kind: "orphan"; entry: PendingEntry };

export type SessionGroup = { sessionId: string; members: GroupMember[] };

/** Code-unit order, as used for file names and session ids. */
function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** A key for a (session_id, seq) pair that cannot collide across separators. */
function seqKey(sessionId: string, seq: number): string {
  return JSON.stringify([sessionId, seq]);
}

function describeJarError(error: JarError): string {
  switch (error.kind) {
    case "json":
      return "not valid JSON";
    case "blank":
      return "blank line";
    case "incomplete":
      return "incomplete line at end of file";
    case "unknown_field":
      return `unknown field ${error.field ?? "(unknown)"}`;
    case "schema":
      return `invalid field ${error.field ?? "(root)"}`;
  }
}

function describePendingIssues(issues: readonly z.core.$ZodIssue[]): string {
  const unknown = issues.find((issue) => issue.code === "unrecognized_keys");
  if (unknown && unknown.code === "unrecognized_keys") {
    return `unknown field ${unknown.keys[0] ?? "(unknown)"}`;
  }
  return `invalid field ${fieldPaths(issues).join(", ")}`;
}

/**
 * The 1-based line numbers of the lines that readJar returns as valid, in file order. readJar
 * returns one Jar_Line for each line that it does not report as an error, so these numbers
 * pair one to one with its `lines`. A terminating newline does not make a line.
 */
function validLineNumbers(text: string, errors: readonly JarError[]): number[] {
  if (text === "") return [];
  const segments = text.split("\n");
  const errorLines = new Set(errors.map((error) => error.line));
  const numbers: number[] = [];
  for (let line = 1; line <= segments.length; line++) {
    const isTerminator = line === segments.length && segments[line - 1] === "";
    if (isTerminator) break;
    if (!errorLines.has(line)) numbers.push(line);
  }
  return numbers;
}

/**
 * Reads every jar file, then spoils duplicates. Files are taken in file name code-unit order,
 * and lines in line order, so an "earlier" line is one that comes first in that order. A valid
 * Jar_Line whose `id` equals an earlier retained line is spoiled with "duplicate id". Failing
 * that, one whose (session_id, seq) equals an earlier retained line is spoiled with
 * "duplicate seq". A spoiled duplicate is not retained, so it cannot spoil a later line.
 */
export function loadJars(files: readonly JarFile[]): LoaderResult {
  const ordered = [...files].sort((a, b) => compareCodeUnits(a.file, b.file));
  const valid: JarLine[] = [];
  const lines: JarLine[] = [];
  const spoiled: SpoiledLine[] = [];
  const seenIds = new Set<string>();
  const seenSeqs = new Set<string>();

  for (const { file, text } of ordered) {
    const { lines: parsed, errors } = readJar(text);
    for (const error of errors) {
      spoiled.push({ file, line: error.line, reason: describeJarError(error) });
    }

    const numbers = validLineNumbers(text, errors);
    if (numbers.length !== parsed.length) {
      throw new Error(`jar line numbering mismatch in ${file}`);
    }

    parsed.forEach((jar, index) => {
      const line = numbers[index] ?? 0;
      valid.push(jar);
      const key = seqKey(jar.session_id, jar.seq);
      if (seenIds.has(jar.id)) {
        spoiled.push({ file, line, reason: "duplicate id" });
      } else if (seenSeqs.has(key)) {
        spoiled.push({ file, line, reason: "duplicate seq" });
      } else {
        seenIds.add(jar.id);
        seenSeqs.add(key);
        lines.push(jar);
      }
    });
  }

  spoiled.sort((a, b) => compareCodeUnits(a.file, b.file) || a.line - b.line);
  return { valid, lines, spoiled };
}

/**
 * Parses the Pending_File text. Every line is 1-based. A final newline does not start a line.
 * A blank line or a line that is not JSON is spoiled. A JSON line that fails pendingEntrySchema
 * is spoiled with the failing field. Each spoiled line carries PENDING_FILE as its file name.
 */
export function loadPending(text: string): PendingResult {
  const entries: PendingEntry[] = [];
  const spoiled: SpoiledLine[] = [];
  if (text === "") return { entries, spoiled };

  const segments = text.split("\n");
  if (segments[segments.length - 1] === "") segments.pop();

  segments.forEach((raw, index) => {
    const line = index + 1;
    if (raw === "") {
      spoiled.push({ file: PENDING_FILE, line, reason: "blank line" });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      spoiled.push({ file: PENDING_FILE, line, reason: "not valid JSON" });
      return;
    }

    const result = pendingEntrySchema.safeParse(parsed);
    if (result.success) {
      entries.push(result.data);
    } else {
      spoiled.push({ file: PENDING_FILE, line, reason: describePendingIssues(result.error.issues) });
    }
  });

  return { entries, spoiled };
}

/**
 * Orphan_Entries: the entries whose (session_id, seq) equals that of no jar line. Pass every
 * schema-valid Jar_Line (LoaderResult.valid), so that a call recorded in a spoiled duplicate
 * line is not reported as an orphan too. Entries keep their input order.
 */
export function findOrphans(
  entries: readonly PendingEntry[],
  jarLines: readonly JarLine[],
): PendingEntry[] {
  const known = new Set(jarLines.map((line) => seqKey(line.session_id, line.seq)));
  return entries.filter((entry) => !known.has(seqKey(entry.session_id, entry.seq)));
}

/**
 * Groups jar lines and orphan entries by session_id. Members of a group are ordered by seq
 * ascending. Groups are ordered by their lowest seq, with ties broken by session_id in
 * code-unit order. Members with equal seq keep their input order, with jar lines first.
 */
export function groupBySession(
  lines: readonly JarLine[],
  orphans: readonly PendingEntry[],
): SessionGroup[] {
  const bySession = new Map<string, GroupMember[]>();
  const add = (sessionId: string, member: GroupMember): void => {
    const members = bySession.get(sessionId);
    if (members) members.push(member);
    else bySession.set(sessionId, [member]);
  };

  for (const line of lines) add(line.session_id, { kind: "jar", line });
  for (const entry of orphans) add(entry.session_id, { kind: "orphan", entry });

  const seqOf = (member: GroupMember): number =>
    member.kind === "jar" ? member.line.seq : member.entry.seq;
  const kindRank = (member: GroupMember): number => (member.kind === "jar" ? 0 : 1);

  const groups: SessionGroup[] = [];
  for (const [sessionId, members] of bySession) {
    const ordered = [...members].sort((a, b) => seqOf(a) - seqOf(b) || kindRank(a) - kindRank(b));
    groups.push({ sessionId, members: ordered });
  }

  groups.sort((a, b) => {
    const firstA = seqOf(a.members[0] as GroupMember);
    const firstB = seqOf(b.members[0] as GroupMember);
    return firstA - firstB || compareCodeUnits(a.sessionId, b.sessionId);
  });
  return groups;
}
