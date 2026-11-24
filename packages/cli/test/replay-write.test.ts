import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { replayResultSchema, type ReplayResult, type ResultEntry } from "@specimen/core";
import {
  ReplayWriteError,
  jsonText,
  quarantineOf,
  replayFileName,
  serverLabelOf,
  writeQuarantine,
  writeReplayResult,
} from "../src/replay/write.js";
import { citesId, filedJarIds, readBugfixSpecs } from "../src/replay/spec-files.js";

/**
 * Tests of the Replay_Result and Quarantine_File writers and of the filed-id computation. Every
 * test works in its own temporary workspace. None touches the repository `jars/` directory.
 */

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "specimen-replay-write-")));
  mkdirSync(join(root, ".kiro"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A rattled quote jar, `/total` 425.00 recorded and 435 replayed. */
function rattledQuote(id: string, seq: number): ResultEntry {
  return {
    id,
    session_id: "sess-a",
    seq,
    tool: "quote",
    state: "rattled",
    input: { room_id: "r-04", nights: 2 },
    response_text: '{"total":425.00}',
    changes: [{ path: "/total", kind: "value", was: 425, now: 435 }],
    compatible: [],
    ignored: [],
    replayed_text: '{"total":435}',
    replayed: { total: 435 },
    ms: 3,
  };
}

/** An unsealed jar and an Orphan_Entry, for the quarantine tests. */
const UNPAIRED: ResultEntry = {
  id: "SPC-0009",
  session_id: "sess-b",
  seq: 4,
  tool: "search_rooms",
  state: "unsealed",
  input: { guests: 2 },
  response_text: '{"rooms":[]}',
  changes: [],
  compatible: [],
  ignored: [],
  replayed_text: null,
  replayed: null,
  reason: "unpaired post-event",
  ms: 0,
};

const ORPHAN: ResultEntry = {
  id: null,
  session_id: "sess-c",
  seq: 1,
  tool: "book_room",
  state: "unsealed",
  input: null,
  response_text: null,
  changes: [],
  compatible: [],
  ignored: [],
  replayed_text: null,
  replayed: null,
  reason: "orphan pre-event",
  ms: 0,
};

/** A valid Replay_Result around the given entries. Built through the schema, so the fixture is valid. */
function resultOf(jars: ResultEntry[]): ReplayResult {
  const counts = { preserved: 0, rattled: 0, cracked: 0, unsealed: 0, skipped: 0 };
  for (const jar of jars) counts[jar.state] += 1;
  return replayResultSchema.parse({
    v: 1,
    server: "svr",
    started_at: "2026-11-25T00:00:00.000Z",
    strict: false,
    jars,
    spoiled: [],
    counts,
    schema_diff: { tools_removed: [], tools_added: [], input_schema_changed: [] },
    verdict: "HOLD",
    red: counts.rattled + counts.cracked,
    filed: 0,
    covered: false,
    reason: "1 rattled",
    coverage: {
      compared: counts.rattled,
      tools_compared: ["quote"],
      tools_listed: ["quote"],
      tools_unrecorded: [],
    },
  });
}

/** Every file below `dir`, as relative paths in code-unit order. */
function filesUnder(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const next = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...filesUnder(dir, next));
    else out.push(next);
  }
  return out.sort();
}

describe("server label and file name", () => {
  it("keeps [A-Za-z0-9._-] and replaces every other character with '-'", () => {
    expect(serverLabelOf("npx tsx servers/hollow-inn/src/main.ts v2")).toBe(
      "npx-tsx-servers-hollow-inn-src-main.ts-v2",
    );
    expect(serverLabelOf("node 'a b:c'")).toBe("node--a-b-c-");
  });

  it("replaces the colons of started_at and keeps a 24-character time part", () => {
    const name = replayFileName("svr", "2026-11-25T01:02:03.456Z");
    expect(name).toBe("svr-2026-11-25T01-02-03.456Z.json");
    expect(name.slice("svr-".length, -".json".length)).toHaveLength(24);
  });

  it("rejects a label with characters outside the allowed set", () => {
    expect(() => replayFileName("a/b", "2026-11-25T01:02:03.456Z")).toThrow(ReplayWriteError);
  });

  it("rejects a started_at that is not in the fixed UTC form", () => {
    expect(() => replayFileName("svr", "2026-11-25T01:02:03+00:00")).toThrow(ReplayWriteError);
    expect(() => replayFileName("svr", "2026-11-25T01:02:03Z")).toThrow(ReplayWriteError);
  });
});

describe("writeReplayResult", () => {
  it("writes pretty JSON with a trailing newline, creating the directory, and round-trips", () => {
    const result = resultOf([rattledQuote("SPC-0001", 1)]);
    const path = join(root, "replays", replayFileName("svr", "2026-11-25T00:00:00.000Z"));
    writeReplayResult(path, result);

    const text = readFileSync(path, "utf8");
    expect(text).toBe(jsonText(result));
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "v": 1');
    expect(replayResultSchema.parse(JSON.parse(text))).toEqual(result);
  });

  it("validates before writing and writes nothing for an invalid document", () => {
    const bad = { ...resultOf([]), verdict: "MAYBE" } as unknown as ReplayResult;
    const path = join(root, "replays", "bad.json");
    expect(() => writeReplayResult(path, bad)).toThrow(ReplayWriteError);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(join(root, "replays"))).toBe(false);
  });
});

describe("quarantine", () => {
  it("lists every unsealed jar and Orphan_Entry in Replay_Result order, with a null id for the orphan", () => {
    const result = resultOf([rattledQuote("SPC-0001", 1), UNPAIRED, ORPHAN]);
    expect(quarantineOf(result).items).toEqual([
      { id: "SPC-0009", session_id: "sess-b", seq: 4, tool: "search_rooms", reason: "unpaired post-event" },
      { id: null, session_id: "sess-c", seq: 1, tool: "book_room", reason: "orphan pre-event" },
    ]);
  });

  it("replaces .specimen/quarantine.json and leaves no other file behind", () => {
    mkdirSync(join(root, ".specimen"));
    writeFileSync(join(root, ".specimen", "quarantine.json"), '{"v":1,"items":[{"stale":true}]}\n');

    writeQuarantine(root, resultOf([rattledQuote("SPC-0001", 1), ORPHAN]));

    const written = JSON.parse(readFileSync(join(root, ".specimen", "quarantine.json"), "utf8"));
    expect(written.items).toHaveLength(1);
    expect(written.items[0].id).toBeNull();
    expect(filesUnder(root)).toEqual([".specimen/quarantine.json"]);
  });

  it("writes an empty items list when no jar is unsealed, replacing a stale file", () => {
    mkdirSync(join(root, ".specimen"));
    writeFileSync(join(root, ".specimen", "quarantine.json"), '{"v":1,"items":[{"stale":true}]}\n');

    writeQuarantine(root, resultOf([rattledQuote("SPC-0001", 1)]));

    expect(JSON.parse(readFileSync(join(root, ".specimen", "quarantine.json"), "utf8"))).toEqual({
      v: 1,
      items: [],
    });
  });
});

/** A Bugfix_Spec for SPC-0001 that passes checkSpec for `/total` 425.00. */
function passingSpec(extraId = ""): string {
  const repro = [
    {
      id: "SPC-0001",
      input: { room_id: "r-04", nights: 2 },
      response_text: '{"total":425.00}',
      replayed: { total: 435 },
      changed_paths: ["/total"],
    },
  ];
  return [
    "<!-- specimen:repro:start -->",
    "```json specimen-repro",
    JSON.stringify(repro),
    "```",
    "<!-- specimen:repro:end -->",
    "",
    "## Current Behavior (Defect)",
    "",
    `WHEN quote is called with room r-04 for two nights THEN the system returns /total 435 for SPC-0001.${extraId}`,
    "",
    "## Expected Behavior (Correct)",
    "",
    "WHEN quote is called with room r-04 for two nights THEN the system SHALL return /total 425.00 for SPC-0001.",
    "",
    "## Unchanged Behavior (Regression Prevention)",
    "",
    "no preserved jar of quote is recorded, so the system SHALL CONTINUE TO answer as before.",
    "",
  ].join("\n");
}

/** Writes `.kiro/specs/<name>/bugfix.md` and returns its path. */
function writeSpec(name: string, text: string): string {
  const dir = join(root, ".kiro", "specs", name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "bugfix.md");
  writeFileSync(path, text);
  return path;
}

describe("spec files and filed ids", () => {
  it("reads bugfix.md files in name order and skips folders without one", () => {
    writeSpec("gamma", "gamma text");
    writeSpec("alpha", "alpha text");
    mkdirSync(join(root, ".kiro", "specs", "beta"), { recursive: true });

    expect(readBugfixSpecs(root)).toEqual([
      { name: "alpha", text: "alpha text" },
      { name: "gamma", text: "gamma text" },
    ]);
  });

  it("gives no specs when .kiro/specs is missing", () => {
    expect(readBugfixSpecs(root)).toEqual([]);
  });

  it("matches ids as whole tokens only", () => {
    expect(citesId("see SPC-0004 here", "SPC-0004")).toBe(true);
    expect(citesId("see SPC-00045 here", "SPC-0004")).toBe(false);
    expect(citesId("see xSPC-0004 here", "SPC-0004")).toBe(false);
  });

  it("counts only the ids that a spec passes, when the spec fails for another id it cites", () => {
    const jars = [rattledQuote("SPC-0001", 1), rattledQuote("SPC-0002", 2)];
    // The spec cites both ids but its Repro_Block holds only SPC-0001, so SPC-0002 fails repro_missing.
    const specs = [{ name: "mixed", text: passingSpec(" Also SPC-0002 is cited here.") }];

    expect([...filedJarIds(specs, jars)]).toEqual(["SPC-0001"]);
  });

  it("ignores a spec that cites no red jar, and files nothing when every spec fails", () => {
    const jars = [rattledQuote("SPC-0001", 1)];
    const unrelated = [{ name: "other", text: "SPC-0077 is cited, with no repro block." }];
    expect(filedJarIds(unrelated, jars).size).toBe(0);
    expect(filedJarIds([], jars).size).toBe(0);
  });

  it("files a red jar that a complete spec cites, and never changes the spec file", () => {
    const jars = [rattledQuote("SPC-0001", 1)];
    const path = writeSpec("quote-total", passingSpec());
    const before = readFileSync(path, "utf8");
    const mtime = statSync(path).mtimeMs;

    const filed = filedJarIds(readBugfixSpecs(root), jars);

    expect([...filed]).toEqual(["SPC-0001"]);
    expect(readFileSync(path, "utf8")).toBe(before);
    expect(statSync(path).mtimeMs).toBe(mtime);
  });
});
