import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Child processes run the real bin, which loads the TypeScript CLI through tsx. Each call is
// a few seconds, so the timeout is raised.
const BIN = fileURLToPath(new URL("../bin/specimen.mjs", import.meta.url));
const CHILD_TIMEOUT = 60_000;
const MESSAGE = "jars are evidence and read-only\n";

let workspace: string;

/** A temporary Kiro workspace with `jars/` and `src/`. Nothing is created under the repo. */
beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "specimen-fw-"));
  mkdirSync(join(workspace, ".kiro"));
  mkdirSync(join(workspace, "jars"));
  mkdirSync(join(workspace, "src"));
  writeFileSync(join(workspace, "jars", "a.jsonl"), "");
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function fire(stdin: string, args: string[] = ["firewall"]) {
  return spawnSync(process.execPath, [BIN, "hook", ...args], {
    cwd: workspace,
    input: stdin,
    encoding: "utf8",
    timeout: CHILD_TIMEOUT,
  });
}

function payload(toolInput: unknown, cwd = workspace): string {
  return JSON.stringify({ session_id: "s-1", hook_event_name: "PreToolUse", cwd, tool_name: "write", tool_input: toolInput });
}

describe("specimen hook firewall (child process)", () => {
  it("blocks a write to a file under jars/ with exit 2 and the fixed message on STDERR", () => {
    const result = fire(payload({ path: "jars/a.jsonl" }));
    expect(result.status).toBe(2);
    expect(result.stderr).toBe(MESSAGE);
    expect(result.stdout).toBe("");
  }, CHILD_TIMEOUT);

  it("blocks a '..' path that resolves into jars/", () => {
    const result = fire(payload({ path: "../jars/MANIFEST.sha256" }, join(workspace, "src")));
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
  }, CHILD_TIMEOUT);

  it("blocks a symbolic link whose target is under jars/", () => {
    const link = join(workspace, "link.jsonl");
    symlinkSync(join(workspace, "jars", "a.jsonl"), link);
    const result = fire(payload({ path: "link.jsonl" }));
    expect(result.status).toBe(2);
    expect(result.stderr).toBe(MESSAGE);
  }, CHILD_TIMEOUT);

  it("allows a write outside jars/ with exit 0 and nothing on STDOUT or STDERR", () => {
    const result = fire(payload({ path: "src/app.ts", text: "export {};" }));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  }, CHILD_TIMEOUT);

  it("exits 0 on invalid STDIN and writes nothing to STDOUT", () => {
    const result = fire("this is not json");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  }, CHILD_TIMEOUT);

  it("exits 0 when the payload is valid JSON but not an object", () => {
    const result = fire("[]");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  }, CHILD_TIMEOUT);

  it("exits 0 on an unknown argument with no output", () => {
    const result = fire(payload({ path: "jars/a.jsonl" }), ["firewall", "unexpected-arg"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  }, CHILD_TIMEOUT);
});
