import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { diff, replayResultSchema, type Json, type ReplayResult, type ResultEntry } from "@specimen/core";
import { createWorkspace, fireRaw, snapshot, type Workspace } from "./support/capture.js";

/**
 * Real bin runs of `specimen check-spec` in a temporary workspace. Each test writes its own
 * Replay_Result and Bugfix_Spec. No file under the repository `jars/` or `.specimen/` is used.
 */

const JAR = "SPC-0001";
const SPEC_PATH = ".kiro/specs/quote-total/bugfix.md";
const OLD_REPLAY = "hollow-inn-2026-01-01T00-00-00.000Z.json";
const NEW_REPLAY = "hollow-inn-2026-05-01T10-00-00.000Z.json";

const MARKER_START = "<!-- specimen:repro:start -->";
const MARKER_END = "<!-- specimen:repro:end -->";

const QUOTE_INPUT = { room_id: "r-04", nights: 2 };
const QUOTE_JARRED = '{"room_id":"r-04","nights":2,"total":425.00}';
const QUOTE_REPLAYED = '{"room_id":"r-04","nights":2,"total":430}';

let ws: Workspace;

beforeEach(() => {
  ws = createWorkspace();
});

afterEach(() => {
  ws.remove();
});

/** A jar that the replay rattled: `/total` 425.00 recorded and 430 replayed. */
function rattledEntry(): ResultEntry {
  return {
    id: JAR,
    session_id: "s-1",
    seq: 1,
    tool: "quote",
    state: "rattled",
    input: QUOTE_INPUT,
    response_text: QUOTE_JARRED,
    changes: diff(JSON.parse(QUOTE_JARRED) as Json, JSON.parse(QUOTE_REPLAYED) as Json),
    compatible: [],
    ignored: [],
    replayed_text: QUOTE_REPLAYED,
    replayed: JSON.parse(QUOTE_REPLAYED) as Json,
    ms: 4,
  };
}

/** A jar that replayed clean. It is the companion named in the Unchanged Section. */
function preservedEntry(): ResultEntry {
  return {
    id: "SPC-0002",
    session_id: "s-2",
    seq: 1,
    tool: "quote",
    state: "preserved",
    input: { room_id: "r-04" },
    response_text: '{"ok":true}',
    changes: [],
    compatible: [],
    ignored: [],
    replayed_text: '{"ok":true}',
    replayed: { ok: true },
    ms: 2,
  };
}

/** A schema-valid Replay_Result holding the given jars. */
function resultWith(jars: ResultEntry[], rattled: number): ReplayResult {
  return replayResultSchema.parse({
    v: 1,
    server: "hollow-inn",
    started_at: "2026-05-01T10:00:00.000Z",
    strict: false,
    jars,
    spoiled: [],
    counts: { preserved: jars.length - rattled, rattled, cracked: 0, unsealed: 0, skipped: 0 },
    schema_diff: { tools_removed: [], tools_added: [], input_schema_changed: [] },
    verdict: "HOLD",
    red: rattled,
    filed: 0,
    covered: false,
    reason: `${rattled} rattled`,
    coverage: {
      compared: jars.length,
      tools_compared: ["quote"],
      tools_listed: ["quote"],
      tools_unrecorded: [],
    },
  });
}

/** Writes a Replay_Result under `replays/` and returns its path relative to the workspace. */
function writeReplay(name: string, result: ReplayResult | string): string {
  mkdirSync(join(ws.root, "replays"), { recursive: true });
  const text = typeof result === "string" ? result : `${JSON.stringify(result, null, 2)}\n`;
  writeFileSync(join(ws.root, "replays", name), text, "utf8");
  return join("replays", name);
}

/** Writes a Bugfix_Spec at the fixed spec path. */
function writeSpec(text: string): void {
  mkdirSync(join(ws.root, ".kiro", "specs", "quote-total"), { recursive: true });
  writeFileSync(join(ws.root, SPEC_PATH), text, "utf8");
}

/** The Repro_Block of the rattled jar, in the shape the Spec_Checker reads. */
function reproBlock(): string {
  const entry = rattledEntry();
  const items = [
    {
      id: entry.id,
      input: entry.input,
      response_text: entry.response_text,
      replayed: entry.replayed,
      changed_paths: entry.changes.map((change) => change.path),
    },
  ];
  return [MARKER_START, "```json specimen-repro", JSON.stringify(items, null, 2), "```", MARKER_END].join("\n");
}

/** A Bugfix_Spec that the Spec_Checker accepts for SPC-0001. */
function passingSpec(): string {
  return [
    "# Bugfix: quote total",
    "",
    "## Current Behavior (Defect)",
    "",
    "WHEN quote is called for r-04 with 2 nights THEN the system returns /total 430 for SPC-0001.",
    "",
    "## Expected Behavior (Correct)",
    "",
    "WHEN quote is called for r-04 with 2 nights THEN the system SHALL return /total 425.00.",
    "",
    "## Unchanged Behavior (Regression Prevention)",
    "",
    "WHEN quote is called for r-04 THEN the system SHALL CONTINUE TO return the body recorded in SPC-0002.",
    "",
    reproBlock(),
    "",
  ].join("\n");
}

/** Runs `specimen check-spec` as a real child process in the workspace. */
function checkSpec(args: string[]) {
  return fireRaw(ws.root, ["check-spec", ...args], "");
}

describe("specimen check-spec (real bin)", () => {
  it("prints PASS and exits 0 for a spec that the Spec_Checker accepts", () => {
    const replay = writeReplay(NEW_REPLAY, resultWith([rattledEntry(), preservedEntry()], 1));
    writeSpec(passingSpec());

    const run = checkSpec([SPEC_PATH, "--jar", JAR, "--replay", replay]);

    expect(run.status).toBe(0);
    expect(run.stdout).toBe(`PASS ${JAR}\n`);
    expect(run.stderr).toBe("");
  }, 60_000);

  it("prints one FAIL line per failure and exits 1 when the Repro_Block is missing", () => {
    const replay = writeReplay(NEW_REPLAY, resultWith([rattledEntry(), preservedEntry()], 1));
    writeSpec(passingSpec().replace(reproBlock(), ""));

    const run = checkSpec([SPEC_PATH, "--jar", JAR, "--replay", replay]);

    expect(run.status).toBe(1);
    const lines = run.stdout.split("\n").filter((line) => line !== "");
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/^FAIL [a-z_]+: .+$/);
    expect(lines.some((line) => /^FAIL repro_missing: /.test(line))).toBe(true);
  }, 60_000);

  it("selects the replay file with the greatest ISO suffix when --replay is absent", () => {
    // The older file says the jar was preserved, so the spec would fail against it.
    writeReplay(OLD_REPLAY, resultWith([{ ...preservedEntry(), id: JAR }], 0));
    writeReplay(NEW_REPLAY, resultWith([rattledEntry(), preservedEntry()], 1));
    // A name that does not match the pattern is ignored, even though it sorts after both.
    writeReplay("zzz-notes.json", "this is not a Replay_Result");
    writeSpec(passingSpec());

    const run = checkSpec([SPEC_PATH, "--jar", JAR]);

    expect(run.status).toBe(0);
    expect(run.stdout).toBe(`PASS ${JAR}\n`);
  }, 60_000);

  it("exits 2 with a diagnostic on STDERR when no file in replays/ matches the pattern", () => {
    writeReplay("notes.json", resultWith([rattledEntry()], 1));
    writeSpec(passingSpec());

    const run = checkSpec([SPEC_PATH, "--jar", JAR]);

    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toMatch(/replays\//);
  }, 60_000);

  it("exits 2 when --jar names an id that the Replay_Result does not hold", () => {
    const replay = writeReplay(NEW_REPLAY, resultWith([rattledEntry()], 1));
    writeSpec(passingSpec());

    const run = checkSpec([SPEC_PATH, "--jar", "SPC-9999", "--replay", replay]);

    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toMatch(/SPC-9999/);
  }, 60_000);

  it("exits 2 when --jar is missing", () => {
    const replay = writeReplay(NEW_REPLAY, resultWith([rattledEntry()], 1));
    writeSpec(passingSpec());

    const run = checkSpec([SPEC_PATH, "--replay", replay]);

    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr.length).toBeGreaterThan(0);
  }, 60_000);

  it("exits 2 when the Replay_Result fails its schema", () => {
    const replay = writeReplay(NEW_REPLAY, '{"v":1,"jars":"not a list"}');
    writeSpec(passingSpec());

    const run = checkSpec([SPEC_PATH, "--jar", JAR, "--replay", replay]);

    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toMatch(/schema/);
  }, 60_000);

  it("leaves the Bugfix_Spec and the replays/ directory unchanged and writes no file", () => {
    writeReplay(OLD_REPLAY, resultWith([preservedEntry()], 0));
    const replay = writeReplay(NEW_REPLAY, resultWith([rattledEntry(), preservedEntry()], 1));
    writeSpec(passingSpec().replace(reproBlock(), ""));
    const before = snapshot(ws.root);

    checkSpec([SPEC_PATH, "--jar", JAR, "--replay", replay]);
    checkSpec([SPEC_PATH, "--jar", JAR]);

    const after = snapshot(ws.root);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [file, text] of before) {
      expect(after.get(file), file).toBe(text);
    }
  }, 120_000);
});
