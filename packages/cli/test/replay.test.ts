/**
 * Tests of `specimen replay` (Requirement 10, with Requirements 2.12 and 2.15). Each test runs the
 * real bin as a child process in its own temporary workspace, against servers/hollow-inn. The
 * repository jars/ and .specimen/ are only read: the recorded jars and the redact config are
 * copied into the workspace, and nothing is written outside it.
 *
 * The server commands are short executable wrappers written into the workspace. Each wrapper runs
 * tsx on a script. The file name of a Replay_Result is built from the whole `--server` command, so
 * a full absolute command would make a name longer than the file system allows.
 */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ReplayResult,
  type ResultEntry,
  referenceOf,
  referenceSubstrings,
  replayResultSchema,
} from "@specimen/core";

const BIN = fileURLToPath(new URL("../bin/specimen.mjs", import.meta.url));
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const REPO_JARS = join(REPO, "jars");
const REPO_REDACT = join(REPO, ".specimen", "redact.json");
const TSX_CLI = join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
const HOLLOW_MAIN = join(REPO, "servers", "hollow-inn", "src", "main.ts");

const CHILD_TIMEOUT = 60_000;
const TEST_TIMEOUT = 120_000;

/** The six tools of hollow-inn v1. Every one is allowed, so no jar is skipped. */
const ALL_TOOLS = ["search_rooms", "get_room", "quote", "book", "list_bookings", "cancel_booking"];

/**
 * The first lines for the recorded jars in jars/: ten jars in two sessions. v1 replays them
 * cleanly. v2 renames `total` to `total_cents`, moves the rooms list and renames cancel_booking.
 */
const SHIP_FIRST =
  "SHIP · replay clean on the recorded set · 10 jars compared · 5 of 6 tools · not recorded: get_room";
const HOLD_FIRST =
  "HOLD · 4 rattled, 1 cracked · 10 jars compared · 4 of 6 tools · not recorded: booking_cancel, get_room";
const COVERED_FIRST =
  "HOLD · covered · 4 rattled, 1 cracked · 10 jars compared · 4 of 6 tools · not recorded: booking_cancel, get_room";

let root: string;
let hollowV1: string;
let hollowV2: string;

/** Single-quotes a value for /bin/sh. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Writes an executable `#!/bin/sh` wrapper in `dir` that runs tsx on `script` with `args`. */
function writeWrapper(dir: string, name: string, script: string, args: string[]): string {
  const path = join(dir, name);
  const command = [process.execPath, TSX_CLI, script, ...args].map(shellQuote).join(" ");
  writeFileSync(path, `#!/bin/sh\nexec ${command}\n`);
  chmodSync(path, 0o755);
  return path;
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "specimen-replay-cli-")));
  mkdirSync(join(root, ".kiro"));
  mkdirSync(join(root, "jars"));
  mkdirSync(join(root, ".specimen"));
  for (const name of readdirSync(REPO_JARS)) {
    if (name.endsWith(".jsonl")) writeFileSync(join(root, "jars", name), readFileSync(join(REPO_JARS, name)));
  }
  writeFileSync(join(root, ".specimen", "redact.json"), readFileSync(REPO_REDACT));
  writeFileSync(join(root, ".specimen", "replay.json"), `${JSON.stringify({ allow: ALL_TOOLS, watch: [] })}\n`);
  writeFileSync(
    join(root, ".specimen", "volatile.json"),
    `${JSON.stringify({ volatile: ["/created_at", "/bookings/*/created_at"] })}\n`,
  );
  hollowV1 = writeWrapper(root, "hollow-v1", HOLLOW_MAIN, ["v1"]);
  hollowV2 = writeWrapper(root, "hollow-v2", HOLLOW_MAIN, ["v2"]);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Runs `specimen replay` with the given arguments in the workspace. */
function specimen(args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [BIN, "replay", ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: CHILD_TIMEOUT,
  });
}

/** The names of the Replay_Result files in `replays/`. */
function replayFiles(): string[] {
  const dir = join(root, "replays");
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")) : [];
}

/** The single Replay_Result written by the last run, as text and as a parsed, schema-checked value. */
function writtenResult(): { text: string; result: ReplayResult } {
  const files = replayFiles();
  expect(files).toHaveLength(1);
  const [file] = files;
  if (file === undefined) throw new Error("no Replay_Result was written");
  const text = readFileSync(join(root, "replays", file), "utf8");
  return { text, result: replayResultSchema.parse(JSON.parse(text)) };
}

/** The lines of a text report, without the final newline. */
function reportLines(stdout: string): string[] {
  return stdout.replace(/\n$/, "").split("\n");
}

/**
 * The jar line of Requirement 10 criterion 9, `<id> · <tool> · <state> · <changed paths> · <note>`,
 * built from a Result_Entry. The note holds the rename notes, the "+N field" text, the reason and
 * the error text, or "-" when none applies.
 */
function jarLine(entry: ResultEntry): string {
  const id = entry.id ?? `${entry.session_id}#${entry.seq}`;
  const paths = entry.changes.length === 0 ? "-" : entry.changes.map((change) => change.path).join(", ");
  const notes: string[] = [];
  for (const change of entry.changes) {
    if (change.note !== undefined) notes.push(change.note);
  }
  if (entry.compatible.length > 0) notes.push(`+${entry.compatible.length} field`);
  if (entry.reason !== undefined) notes.push(entry.reason);
  if (entry.error !== undefined) notes.push(entry.error);
  return `${id} · ${entry.tool} · ${entry.state} · ${paths} · ${notes.length === 0 ? "-" : notes.join("; ")}`;
}

/** Every file below `dir`, read recursively. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

/** True for a jar that is rattled or cracked and has an id. */
function isRed(entry: ResultEntry): entry is ResultEntry & { id: string } {
  return entry.id !== null && (entry.state === "rattled" || entry.state === "cracked");
}

/**
 * A Bugfix_Spec that files every red jar of `result`. It follows the Spec_Checker rules: the three
 * headings, a WHEN ... THEN the system line per jar, every changed path in backticks, the Reference
 * of every jar in backticks, the "no preserved jar" or CONTINUE TO line per tool, and one Repro_Block
 * that copies each red entry.
 */
function bugfixSpecFor(result: ReplayResult): string {
  const red = result.jars.filter(isRed);
  const current = red.map((entry) => {
    const changed =
      entry.state === "cracked"
        ? "an error"
        : entry.changes.map((change) => `\`${change.path}\``).join(", ");
    return `WHEN ${entry.tool} is called with the recorded input THEN the system returns ${changed} for ${entry.id}.`;
  });
  const expected = red.map((entry) => {
    const reference = referenceOf(entry)
      .flatMap((element) => referenceSubstrings(element))
      .map((text) => `\`${text}\``)
      .join(", ");
    return `WHEN ${entry.tool} is called with the recorded input THEN the system SHALL return ${reference} for ${entry.id}.`;
  });
  const tools = [...new Set(red.map((entry) => entry.tool))].sort();
  const unchanged = [
    "WHEN the replay runs THEN the system SHALL CONTINUE TO return the recorded body of every preserved jar.",
    ...tools.map((tool) => {
      const preserved = result.jars
        .filter((jar) => jar.state === "preserved" && jar.tool === tool && jar.id !== null)
        .map((jar) => jar.id);
      return preserved.length > 0
        ? `WHEN ${tool} is called with the recorded input THEN the system SHALL CONTINUE TO return the recorded body of ${preserved.join(", ")}.`
        : `The replay holds no preserved jar of ${tool}.`;
    }),
  ];
  const repro = red.map((entry) => ({
    id: entry.id,
    input: entry.input,
    response_text: entry.response_text,
    replayed: entry.replayed,
    changed_paths: entry.changes.map((change) => change.path),
  }));
  const block = [
    "<!-- specimen:repro:start -->",
    "```json specimen-repro",
    JSON.stringify(repro, null, 2),
    "```",
    "<!-- specimen:repro:end -->",
  ];
  return [
    "# Bugfix: recorded replies no longer match",
    "",
    "## Current Behavior (Defect)",
    "",
    ...current,
    "",
    "## Expected Behavior (Correct)",
    "",
    ...expected,
    "",
    "## Unchanged Behavior (Regression Prevention)",
    "",
    ...unchanged,
    "",
    ...block,
    "",
  ].join("\n");
}

describe("specimen replay: exit codes and report", () => {
  it(
    "exits 0 with SHIP, the exact first line and one line per recorded jar",
    () => {
      const run = specimen(["--server", hollowV1]);
      expect(run.status).toBe(0);
      expect(run.stderr).toBe("");

      const { result } = writtenResult();
      expect(result.verdict).toBe("SHIP");
      expect(result.jars.every((jar) => jar.state === "preserved")).toBe(true);

      const lines = reportLines(run.stdout);
      expect(lines[0]).toBe(SHIP_FIRST);
      expect(lines.slice(1)).toEqual(result.jars.map(jarLine));
      expect(lines[1]).toBe("SPC-0001 · search_rooms · preserved · - · -");
    },
    TEST_TIMEOUT,
  );

  it(
    "exits 1 with HOLD for hollow-inn v2, and lists the unfiled red jars",
    () => {
      const run = specimen(["--server", hollowV2]);
      expect(run.status).toBe(1);

      const { result } = writtenResult();
      expect(result.verdict).toBe("HOLD");
      expect(result.covered).toBe(false);

      const lines = reportLines(run.stdout);
      expect(lines[0]).toBe(HOLD_FIRST);
      expect(lines[0]).not.toContain("covered");

      const jarLines = result.jars.map(jarLine);
      expect(lines.slice(1, 1 + jarLines.length)).toEqual(jarLines);

      const red = result.jars.filter(isRed).map((jar) => jar.id);
      expect(lines.slice(1 + jarLines.length)).toEqual([`not filed · ${red.join(", ")}`]);
    },
    TEST_TIMEOUT,
  );

  it(
    "exits 3 when one Bugfix_Spec files every red jar, and leaves the spec unchanged",
    () => {
      const first = specimen(["--server", hollowV2, "--json"]);
      expect(first.status).toBe(1);
      const firstResult = replayResultSchema.parse(JSON.parse(first.stdout));

      const specPath = join(root, ".kiro", "specs", "quote-and-rooms", "bugfix.md");
      mkdirSync(dirname(specPath), { recursive: true });
      writeFileSync(specPath, bugfixSpecFor(firstResult));
      const specText = readFileSync(specPath, "utf8");

      const covered = specimen(["--server", hollowV2]);
      expect(covered.status).toBe(3);
      expect(reportLines(covered.stdout)[0]).toBe(COVERED_FIRST);
      expect(readFileSync(specPath, "utf8")).toBe(specText);
    },
    TEST_TIMEOUT,
  );

  it(
    "--json writes only the Replay_Result to STDOUT",
    () => {
      const run = specimen(["--server", hollowV1, "--json"]);
      expect(run.status).toBe(0);
      expect(run.stderr).toBe("");

      const { text, result } = writtenResult();
      expect(result.verdict).toBe("SHIP");
      expect(run.stdout).toBe(text);
      expect(run.stdout).not.toContain("replay clean on the recorded set");
    },
    TEST_TIMEOUT,
  );

  it(
    "writes an empty quarantine items list when no jar is unsealed, replacing older content",
    () => {
      const stale = {
        v: 1,
        items: [{ id: "SPC-9999", session_id: "old", seq: 1, tool: "quote", reason: "unpaired post-event" }],
      };
      writeFileSync(join(root, ".specimen", "quarantine.json"), `${JSON.stringify(stale)}\n`);

      const run = specimen(["--server", hollowV1]);
      expect(run.status).toBe(0);

      const quarantine = JSON.parse(readFileSync(join(root, ".specimen", "quarantine.json"), "utf8")) as unknown;
      expect(quarantine).toEqual({ v: 1, items: [] });
    },
    TEST_TIMEOUT,
  );

  it(
    "takes the server command only from --server, ignoring .kiro/settings/mcp.json",
    () => {
      mkdirSync(join(root, ".kiro", "settings"), { recursive: true });
      writeFileSync(
        join(root, ".kiro", "settings", "mcp.json"),
        JSON.stringify({
          mcpServers: { hollowinn: { command: "npx", args: ["tsx", "servers/hollow-inn/src/main.ts", "v2"] } },
        }),
      );

      const run = specimen(["--server", hollowV1]);
      expect(run.status).toBe(0);
      expect(reportLines(run.stdout)[0]).toBe(SHIP_FIRST);
    },
    TEST_TIMEOUT,
  );
});

describe("specimen replay: usage errors and baseline", () => {
  it("exits 2 for an unterminated quote in --server, and writes no Replay_Result", () => {
    const run = specimen(["--server", `"${hollowV1}`]);
    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("unterminated");
    expect(replayFiles()).toEqual([]);
  });

  it("exits 2 when --server is missing", () => {
    const run = specimen([]);
    expect(run.status).toBe(2);
    expect(run.stdout).toBe("");
    expect(replayFiles()).toEqual([]);
  });

  it(
    "exits 2 for an invalid .specimen/redact.json, naming the file",
    () => {
      writeFileSync(join(root, ".specimen", "redact.json"), '{"keys": "not-a-list"}\n');

      const run = specimen(["--server", hollowV1]);
      expect(run.status).toBe(2);
      expect(run.stdout).toBe("");
      expect(run.stderr).toContain(".specimen/redact.json");
      expect(replayFiles()).toEqual([]);
    },
    TEST_TIMEOUT,
  );

  it(
    "exits 2 when the --baseline command cannot start, and writes no Replay_Result",
    () => {
      const run = specimen(["--server", hollowV1, "--baseline", join(root, "no-such-baseline")]);
      expect(run.status).toBe(2);
      expect(run.stdout).toBe("");
      expect(run.stderr).toContain("--baseline");
      expect(replayFiles()).toEqual([]);
      expect(existsSync(join(root, ".specimen", "quarantine.json"))).toBe(false);
    },
    TEST_TIMEOUT,
  );

  it(
    "a working --baseline changes no jar state and not the verdict",
    () => {
      const plain = specimen(["--server", hollowV1, "--json"]);
      expect(plain.status).toBe(0);
      const plainResult = replayResultSchema.parse(JSON.parse(plain.stdout));

      const withBaseline = specimen(["--server", hollowV1, "--baseline", hollowV2, "--json"]);
      expect(withBaseline.status).toBe(0);
      const baselineResult = replayResultSchema.parse(JSON.parse(withBaseline.stdout));

      expect(baselineResult.verdict).toBe(plainResult.verdict);
      expect(baselineResult.reason).toBe(plainResult.reason);
      expect(baselineResult.counts).toEqual(plainResult.counts);
      expect(baselineResult.jars.map((jar) => [jar.id, jar.state])).toEqual(
        plainResult.jars.map((jar) => [jar.id, jar.state]),
      );
      // The baseline was read, because its tool list differs from the target's.
      expect(baselineResult.schema_diff).not.toEqual(plainResult.schema_diff);
    },
    TEST_TIMEOUT,
  );

  it(
    "never writes a secret that the server prints to STDERR to STDOUT, STDERR or any file",
    () => {
      const secret = "sk-stderrfixture0123456789ABCDEF";
      const encoded = Buffer.from(secret, "utf8").toString("base64");
      // The fixture encodes the secret, so the fixture file itself does not hold the secret text.
      const fixture = join(root, "leaky-server.mts");
      writeFileSync(
        fixture,
        [
          `process.stderr.write("server log: " + Buffer.from(${JSON.stringify(encoded)}, "base64").toString("utf8") + "\\n");`,
          `await import(${JSON.stringify(pathToFileURL(HOLLOW_MAIN).href)});`,
          "",
        ].join("\n"),
      );
      const leaky = writeWrapper(root, "leaky", fixture, ["v1"]);

      // Check that the fixture really prints the secret, with an empty STDIN so that it exits.
      const alone = spawnSync(leaky, [], { cwd: root, encoding: "utf8", input: "", timeout: 30_000 });
      expect(alone.stderr).toContain(secret);

      const run = specimen(["--server", leaky]);
      expect(run.status).toBe(0);
      expect(run.stdout).not.toContain(secret);
      expect(run.stderr).not.toContain(secret);
      for (const file of filesUnder(root)) {
        expect(readFileSync(file, "utf8"), file).not.toContain(secret);
      }
    },
    TEST_TIMEOUT,
  );
});
