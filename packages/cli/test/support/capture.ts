import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Shared helpers for the capture hook tests. Every workspace is a fresh `mkdtemp` directory with
 * its own `.kiro` folder. The repository `jars/` and `.specimen/` are never used.
 */

export const BIN = fileURLToPath(new URL("../../bin/specimen.mjs", import.meta.url));

/** Each child process runs through tsx and takes seconds, so the per-call timeout is raised. */
export const CHILD_TIMEOUT = 60_000;

export const SESSION = "s-1";
export const TOOL = "mcp_hollowinn_quote";
export const TOOL_INPUT = { room_id: "r-04", nights: 2 };
export const RESPONSE = '{"room_id":"r-04","nights":2,"nightly":212.50,"total":425.00,"currency":"USD"}';

export type Workspace = {
  root: string;
  jarFile(sessionId?: string): string;
  specimenFile(name: string): string;
  remove(): void;
};

/** Creates a temporary workspace root with a `.kiro` folder. Call `remove` when the test ends. */
export function createWorkspace(): Workspace {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "specimen-capture-")));
  mkdirSync(join(root, ".kiro"));
  return {
    root,
    jarFile: (sessionId = SESSION) => join(root, "jars", `${sessionId}.jsonl`),
    specimenFile: (name) => join(root, ".specimen", name),
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}

export function prePayload(
  root: string,
  sessionId = SESSION,
  toolInput: unknown = TOOL_INPUT,
  toolName = TOOL,
): Record<string, unknown> {
  return {
    session_id: sessionId,
    hook_event_name: "PreToolUse",
    cwd: root,
    tool_name: toolName,
    tool_input: toolInput,
  };
}

export function postPayload(
  root: string,
  sessionId = SESSION,
  toolInput: unknown = TOOL_INPUT,
  toolName = TOOL,
  response = RESPONSE,
): Record<string, unknown> {
  return {
    ...prePayload(root, sessionId, toolInput, toolName),
    hook_event_name: "PostToolUse",
    tool_response: response,
  };
}

/** Runs a capture hook as a real child process with a JSON payload on STDIN. */
export function fire(root: string, hook: "pre" | "post", payload: unknown) {
  return fireRaw(root, ["hook", hook, "--server", "hollowinn"], JSON.stringify(payload));
}

/** Runs the real bin with any argument list and raw STDIN text. */
export function fireRaw(root: string, args: string[], stdin: string) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: root,
    input: stdin,
    encoding: "utf8",
    timeout: CHILD_TIMEOUT,
  });
}

export type ChildResult = { status: number | null; stdout: string; stderr: string };

/** Async variant of fireRaw. Used to start several child processes at the same time. */
export function runChild(root: string, args: string[], stdin: string): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd: root });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.stdin.on("error", () => undefined);
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

/** Parses a JSONL file into objects. A missing file gives an empty array. */
export function readJsonl(path: string): Record<string, unknown>[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** The relative path and text of every regular file under the workspace. Used to prove nothing changed. */
export function snapshot(root: string, skip: string[] = []): Map<string, string> {
  const files = new Map<string, string>();
  for (const rel of readdirSync(root, { recursive: true }) as string[]) {
    const full = join(root, rel);
    if (skip.includes(rel) || !statSync(full).isFile()) continue;
    files.set(rel, readFileSync(full, "utf8"));
  }
  return files;
}
