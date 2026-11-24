import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Every case runs the real bin in a child process. The temporary workspace stands in for the
// repository. Its jars/ directory is a fixture, so the repository jars/ is never read or written.
// Cases already covered by firewall-hook.test.ts (the direct jars/ block, a '..' path, a file
// symlink, an outside path, invalid STDIN and an unknown argument) are not repeated here.
const BIN = fileURLToPath(new URL("../bin/specimen.mjs", import.meta.url));
const CHILD_TIMEOUT = 60_000;
const MESSAGE = "jars are evidence and read-only\n";

let workspace: string;

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), "specimen-fw-2-4-"));
  mkdirSync(join(workspace, ".kiro"));
  mkdirSync(join(workspace, "jars"));
  mkdirSync(join(workspace, "jars-extra"));
  mkdirSync(join(workspace, "src"));
  writeFileSync(join(workspace, "jars", "MANIFEST.sha256"), "");
  writeFileSync(join(workspace, "jars", "a.jsonl"), "");
  // Directory symlink whose target is the fixture jars/ directory. The target of the write
  // (new.jsonl) does not exist yet, so the real-path check must handle a missing leaf.
  symlinkSync(join(workspace, "jars"), join(workspace, "jars-link"));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function fire(stdin: string) {
  return spawnSync(process.execPath, [BIN, "hook", "firewall"], {
    cwd: workspace,
    input: stdin,
    encoding: "utf8",
    timeout: CHILD_TIMEOUT,
  });
}

function payload(toolInput: unknown): string {
  return JSON.stringify({
    session_id: "s-1",
    hook_event_name: "PreToolUse",
    cwd: workspace,
    tool_name: "write",
    tool_input: toolInput,
  });
}

function expectBlocked(result: ReturnType<typeof fire>) {
  expect(result.status).toBe(2);
  expect(result.stderr).toBe(MESSAGE);
  expect(result.stdout).toBe("");
}

describe("specimen hook firewall, additional cases (child process)", () => {
  it.each(["Jars/a.jsonl", "JARS/a.jsonl", "jArS/MANIFEST.sha256"])(
    "blocks a case variant of jars/ (%s)",
    (path) => {
      expectBlocked(fire(payload({ path })));
    },
    CHILD_TIMEOUT,
  );

  it("blocks a new file created through a directory symbolic link into jars/", () => {
    expectBlocked(fire(payload({ path: "jars-link/new.jsonl" })));
  }, CHILD_TIMEOUT);

  it("blocks a target held in a nested string field of tool_input", () => {
    expectBlocked(
      fire(payload({ edit: { ops: [{ note: "ok" }, { target: "jars/a.jsonl" }] } })),
    );
  }, CHILD_TIMEOUT);

  it("blocks a write to jars/MANIFEST.sha256", () => {
    expectBlocked(fire(payload({ path: "jars/MANIFEST.sha256", text: "x" })));
  }, CHILD_TIMEOUT);

  it("allows a sibling directory whose name only starts with jars", () => {
    const result = fire(payload({ path: "jars-extra/notes.txt" }));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  }, CHILD_TIMEOUT);
});
