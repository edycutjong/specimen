/**
 * The turn snapshot (`specimen hook prompt`) and the watch hash it shares with the Stop gate.
 * Every repository is a temporary git workspace, so the tests never touch the repository.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WATCH,
  readTurnSnapshot,
  runPrompt,
  watchGlobs,
  watchHash,
} from "../src/hooks/prompt.js";

const SESSION = "sess_turn-test";
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function git(root: string, args: readonly string[]): string {
  const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** A git repository with `.kiro`, one committed server file and a replay policy that watches servers/**. */
function repo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "specimen-turn-")));
  roots.push(root);
  mkdirSync(join(root, ".kiro"));
  mkdirSync(join(root, ".specimen"));
  mkdirSync(join(root, "servers"));
  writeFileSync(join(root, "servers", "demo.txt"), "v1\n");
  writeFileSync(join(root, ".specimen", "replay.json"), `${JSON.stringify({ allow: [], watch: ["servers/**"] })}\n`);
  git(root, ["init", "-q"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "init"]);
  vi.spyOn(process, "cwd").mockReturnValue(root);
  return root;
}

function prompt(root: string, sessionId = SESSION): Promise<number> {
  return runPrompt(async () => JSON.stringify({ session_id: sessionId, cwd: root, hook_event_name: "UserPromptSubmit" }));
}

describe("hook prompt", () => {
  it("prints nothing and writes the snapshot with the head and the watch hash", async () => {
    const root = repo();
    const write = vi.spyOn(process.stdout, "write");
    expect(await prompt(root)).toBe(0);
    expect(write).not.toHaveBeenCalled();

    const snapshot = JSON.parse(readFileSync(join(root, ".specimen", "turn.json"), "utf8")) as Record<string, string>;
    expect(snapshot.session_id).toBe(SESSION);
    expect(snapshot.head).toBe(git(root, ["rev-parse", "HEAD"]));
    expect(snapshot.watch).toMatch(/^[0-9a-f]{64}$/);
    expect(readTurnSnapshot(root)).toEqual(snapshot);
  });

  it("writes nothing outside a git repository and still exits 0", async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "specimen-turn-plain-")));
    roots.push(root);
    mkdirSync(join(root, ".kiro"));
    vi.spyOn(process, "cwd").mockReturnValue(root);
    const write = vi.spyOn(process.stdout, "write");
    expect(await prompt(root)).toBe(0);
    expect(write).not.toHaveBeenCalled();
    expect(existsSync(join(root, ".specimen", "turn.json"))).toBe(false);
  });

  it("logs a bad payload and exits 0", async () => {
    const root = repo();
    expect(await runPrompt(async () => "not json")).toBe(0);
    expect(readFileSync(join(root, ".specimen", "hook.log"), "utf8")).toContain("stdin is not valid JSON");
  });
});

describe("watch hash", () => {
  it("changes when a watched file changes and not when an unwatched file changes", () => {
    const root = repo();
    const before = watchHash(root, ["servers/**"], git(root, ["rev-parse", "HEAD"]));
    writeFileSync(join(root, "servers", "demo.txt"), "v2\n");
    const edited = watchHash(root, ["servers/**"], git(root, ["rev-parse", "HEAD"]));
    expect(edited).not.toBe(before);

    writeFileSync(join(root, "notes.txt"), "outside the watch\n");
    expect(watchHash(root, ["servers/**"], git(root, ["rev-parse", "HEAD"]))).toBe(edited);
  });

  it("counts an untracked file under a watch path, by its content", () => {
    const root = repo();
    const head = git(root, ["rev-parse", "HEAD"]);
    writeFileSync(join(root, "servers", "new.txt"), "one\n");
    const first = watchHash(root, ["servers/**"], head);
    writeFileSync(join(root, "servers", "new.txt"), "two\n");
    expect(watchHash(root, ["servers/**"], head)).not.toBe(first);
  });

  it("uses the default watch when the policy names none", () => {
    const root = repo();
    rmSync(join(root, ".specimen", "replay.json"));
    expect(watchGlobs(root)).toEqual([...DEFAULT_WATCH]);
    writeFileSync(join(root, ".specimen", "replay.json"), `${JSON.stringify({ allow: [], watch: [] })}\n`);
    expect(watchGlobs(root)).toEqual(["servers/**"]);
  });
});
