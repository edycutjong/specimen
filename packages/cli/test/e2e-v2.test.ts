/**
 * End-to-end test of `specimen replay` against hollow-inn v2 (Requirement 13 criterion 13).
 *
 * The test copies the recorded jars, the shipped volatile policy and the redact config into a
 * temporary workspace, writes a replay.json that allows the six hollow-inn tools, and runs the
 * exact command `npx --no-install specimen replay --server "npx tsx servers/hollow-inn/src/main.ts v2"`
 * as a child process. The workspace holds symlinks to the repository node_modules and servers
 * directories, so that both `specimen` and the server command resolve from the workspace. The
 * repository jars/ directory is only read, and the test checks that its bytes did not change.
 *
 * Source of each expectation. Every call below is present in the repository jars, so no fixture
 * is created:
 * - quote: SPC-0002, SPC-0006 and SPC-0007 (recorded jars).
 * - search_rooms with guests 3 and no limit: SPC-0010 (recorded jar). SPC-0001 has a limit of 50,
 *   and SPC-0005 has guests 2, so SPC-0010 is the only match.
 * - cancel_booking: SPC-0009 (recorded jar).
 * No assertion is taken from a fixture.
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type ReplayResult, type ResultEntry, replayResultSchema } from "@specimen/core";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const REPO_JARS = join(REPO, "jars");
const REPO_SPECIMEN = join(REPO, ".specimen");

/** The exact server command of Requirement 13 criterion 13. */
const SERVER = "npx tsx servers/hollow-inn/src/main.ts v2";
/** The six tools of hollow-inn. Every one is allowed, so no jar is skipped. */
const ALL_TOOLS = ["search_rooms", "get_room", "quote", "book", "list_bookings", "cancel_booking"];
const RENAME_NOTE = "suspected rename from /total ×100";
const RUN_TIMEOUT = 150_000;

let root: string;
let repoBefore: Map<string, Buffer>;
let run: SpawnSyncReturns<string>;
let result: ReplayResult;

/** Every file under the repository jars/ directory, by name, with its bytes. */
function snapshotRepoJars(): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const name of readdirSync(REPO_JARS)) {
    files.set(name, readFileSync(join(REPO_JARS, name)));
  }
  return files;
}

/** The lines of a text report, without the final newline. */
function reportLines(stdout: string): string[] {
  return stdout.replace(/\n$/, "").split("\n");
}

/** The input of a Result_Entry as a plain object, or an empty object when it is not one. */
function inputOf(entry: ResultEntry): Record<string, unknown> {
  const input = entry.input;
  if (input === null || typeof input !== "object" || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

/** The paths of the changes of one kind, in the order the report lists them. */
function pathsOf(entry: ResultEntry, kind: string): string[] {
  return entry.changes.filter((change) => change.kind === kind).map((change) => change.path);
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "specimen-e2e-v2-")));
  mkdirSync(join(root, ".kiro"));
  mkdirSync(join(root, "jars"));
  mkdirSync(join(root, ".specimen"));
  for (const name of readdirSync(REPO_JARS)) {
    if (name.endsWith(".jsonl")) copyFileSync(join(REPO_JARS, name), join(root, "jars", name));
  }
  copyFileSync(join(REPO_SPECIMEN, "volatile.json"), join(root, ".specimen", "volatile.json"));
  copyFileSync(join(REPO_SPECIMEN, "redact.json"), join(root, ".specimen", "redact.json"));
  writeFileSync(join(root, ".specimen", "replay.json"), `${JSON.stringify({ allow: ALL_TOOLS, watch: [] })}\n`);
  symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"), "dir");
  symlinkSync(join(REPO, "servers"), join(root, "servers"), "dir");

  repoBefore = snapshotRepoJars();
  run = spawnSync("npx", ["--no-install", "specimen", "replay", "--server", SERVER], {
    cwd: root,
    encoding: "utf8",
    timeout: RUN_TIMEOUT,
  });

  const files = readdirSync(join(root, "replays")).filter((name) => name.endsWith(".json"));
  if (files.length !== 1 || files[0] === undefined) {
    throw new Error(`expected one Replay_Result, found ${files.length}. stderr: ${run.stderr}`);
  }
  result = replayResultSchema.parse(JSON.parse(readFileSync(join(root, "replays", files[0]), "utf8")));
}, RUN_TIMEOUT);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("specimen replay against hollow-inn v2", () => {
  it("exits 1 with a HOLD report", () => {
    expect(run.status).toBe(1);
    expect(result.verdict).toBe("HOLD");
    expect(reportLines(run.stdout)[0]).toMatch(/^HOLD /);
  });

  it("rattles every recorded quote jar, each with the rename note", () => {
    const quotes = result.jars.filter((entry) => entry.tool === "quote");
    expect(quotes.map((entry) => entry.id)).toEqual(["SPC-0002", "SPC-0006", "SPC-0007"]);
    for (const entry of quotes) {
      expect(entry.state, entry.id ?? "").toBe("rattled");
      const notes = entry.changes.map((change) => change.note ?? "");
      expect(notes.some((note) => note.includes(RENAME_NOTE)), entry.id ?? "").toBe(true);
    }
  });

  it("rattles the search_rooms jar with guests 3 and no limit, with two removed rooms and one length Change", () => {
    const searches = result.jars.filter(
      (entry) => entry.tool === "search_rooms" && inputOf(entry).guests === 3 && !("limit" in inputOf(entry)),
    );
    expect(searches.map((entry) => entry.id)).toEqual(["SPC-0010"]);

    const [search] = searches;
    if (search === undefined) throw new Error("no search_rooms jar with guests 3 and no limit");
    expect(search.state).toBe("rattled");
    expect(pathsOf(search, "removed")).toEqual(["/rooms/r-08", "/rooms/r-09"]);
    expect(pathsOf(search, "length")).toEqual(["/rooms"]);
  });

  it("cracks the cancel_booking jar with the reason 'tool not in tools/list'", () => {
    const cancels = result.jars.filter((entry) => entry.tool === "cancel_booking");
    expect(cancels.map((entry) => entry.id)).toEqual(["SPC-0009"]);

    const [cancel] = cancels;
    if (cancel === undefined) throw new Error("no cancel_booking jar");
    expect(cancel.state).toBe("cracked");
    expect(cancel.reason).toBe("tool not in tools/list");
  });

  it("leaves the repository jars/ directory byte-identical", () => {
    const after = snapshotRepoJars();
    expect([...after.keys()]).toEqual([...repoBefore.keys()]);
    for (const [name, bytes] of repoBefore) {
      expect(after.get(name)?.equals(bytes), name).toBe(true);
    }
  });
});
