/**
 * End-to-end test of `specimen replay` against hollow-inn v1 (Requirements 13.12 and 13.20).
 *
 * The recorded jars are copied into a temporary workspace with its own `.kiro` directory, so the
 * Workspace_Root is that directory and every write (replays/, .specimen/quarantine.json) lands
 * there. The server command is a small executable wrapper in the workspace that runs tsx on
 * servers/hollow-inn/src/main.ts from the repository. It is a wrapper, not `npx tsx ...`, because
 * `--server` runs with the Workspace_Root as working directory and servers/ exists only in the
 * repository. The repository jars/ and .specimen/ are read and never written.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { replayResultSchema } from "@specimen/core";

const BIN = fileURLToPath(new URL("../bin/specimen.mjs", import.meta.url));
const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const REPO_JARS = join(REPO, "jars");
const REPO_VOLATILE = join(REPO, ".specimen", "volatile.json");
const REPO_REDACT = join(REPO, ".specimen", "redact.json");
const TSX_CLI = join(REPO, "node_modules", "tsx", "dist", "cli.mjs");
const HOLLOW_MAIN = join(REPO, "servers", "hollow-inn", "src", "main.ts");

const CHILD_TIMEOUT = 60_000;
const TEST_TIMEOUT = 120_000;

/** The six tools of hollow-inn. Every one is allowed, so no recorded jar is skipped. */
const ALL_TOOLS = ["search_rooms", "get_room", "quote", "book", "list_bookings", "cancel_booking"];

/** The first line of the text report for the recorded jars in jars/ against v1. */
const SHIP_FIRST =
  "SHIP · replay clean on the recorded set · 10 jars compared · 5 of 6 tools · not recorded: get_room";

let root: string;
let hollowV1: string;

/** Single-quotes a value for /bin/sh. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The bytes of every file directly under the repository jars/ directory, keyed by file name. */
function snapshotRepoJars(): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const name of readdirSync(REPO_JARS).sort()) {
    files.set(name, readFileSync(join(REPO_JARS, name)));
  }
  return files;
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "specimen-e2e-v1-")));
  mkdirSync(join(root, ".kiro"));
  mkdirSync(join(root, "jars"));
  mkdirSync(join(root, ".specimen"));

  for (const name of readdirSync(REPO_JARS)) {
    if (name.endsWith(".jsonl")) copyFileSync(join(REPO_JARS, name), join(root, "jars", name));
  }
  copyFileSync(REPO_VOLATILE, join(root, ".specimen", "volatile.json"));
  copyFileSync(REPO_REDACT, join(root, ".specimen", "redact.json"));
  writeFileSync(join(root, ".specimen", "replay.json"), `${JSON.stringify({ allow: ALL_TOOLS, watch: [] })}\n`);

  hollowV1 = join(root, "hollow-v1");
  const command = [process.execPath, TSX_CLI, HOLLOW_MAIN, "v1"].map(shellQuote).join(" ");
  writeFileSync(hollowV1, `#!/bin/sh\nexec ${command}\n`);
  chmodSync(hollowV1, 0o755);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("specimen replay against hollow-inn v1", () => {
  it(
    "ships every recorded jar as preserved, exits 0, and leaves the repository jars/ byte-identical",
    () => {
      const before = snapshotRepoJars();
      const recordedJars = [...before.entries()]
        .filter(([name]) => name.endsWith(".jsonl"))
        .flatMap(([, bytes]) => bytes.toString("utf8").split("\n"))
        .filter((line) => line.trim() !== "").length;
      expect(recordedJars).toBeGreaterThan(0);

      const run = spawnSync(process.execPath, [BIN, "replay", "--server", hollowV1], {
        cwd: root,
        encoding: "utf8",
        timeout: CHILD_TIMEOUT,
      });

      expect(run.status).toBe(0);
      expect(run.stderr).toBe("");
      expect(run.stdout.split("\n")[0]).toBe(SHIP_FIRST);

      const replays = readdirSync(join(root, "replays"));
      expect(replays).toHaveLength(1);
      const [file] = replays;
      if (file === undefined) throw new Error("no Replay_Result was written");
      const result = replayResultSchema.parse(JSON.parse(readFileSync(join(root, "replays", file), "utf8")));

      expect(result.verdict).toBe("SHIP");
      expect(result.jars).toHaveLength(recordedJars);
      expect(result.jars.map((jar) => jar.state)).toEqual(Array<string>(recordedJars).fill("preserved"));

      const after = snapshotRepoJars();
      expect([...after.keys()]).toEqual([...before.keys()]);
      for (const [name, bytes] of before) {
        expect(after.get(name)?.equals(bytes), name).toBe(true);
      }
    },
    TEST_TIMEOUT,
  );
});
