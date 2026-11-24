import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { runCapture, type StdioObserver } from "../src/hooks/run.js";
import type { FsPort, HookIO } from "../src/io/port.js";

/*
 * The capture hooks write to the file system in three places that do not go through FsPort:
 * the workspace probe (`findWorkspaceRoot`), the lock file (`withLock`) and the Hook_Log
 * (`logDiag`). The fallbacks also read `process.cwd()`. So each run:
 *   - gets a fresh mkdtemp workspace with its own `.kiro` folder, which becomes the process cwd;
 *   - uses an in-memory FsPort for every file the hook reads or writes through the port;
 *   - is removed afterwards, and the process cwd is restored.
 * The repository `.specimen/` and `jars/` are snapshotted before the suite and compared after it.
 */

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const ORIGINAL_CWD = process.cwd();
const FIXED_NOW = 1_700_000_000_000;
const MCP_CONFIG = JSON.stringify({
  mcpServers: { hollowinn: { command: "npx", args: ["tsx", "servers/hollow-inn/src/main.ts", "v1"] } },
});

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Every file and folder under `dir` with its size, modification time and content hash, or a marker when `dir` is missing. */
function snapshotDir(dir: string): string[] {
  if (!existsSync(dir)) return ["<absent>"];
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const stat = lstatSync(path);
      const rel = relative(REPO_ROOT, path);
      if (stat.isDirectory()) {
        out.push(`dir ${rel}`);
        walk(path);
      } else if (stat.isFile()) {
        out.push(`file ${rel} ${stat.size} ${stat.mtimeMs} ${sha256(readFileSync(path))}`);
      } else {
        out.push(`other ${rel}`);
      }
    }
  };
  walk(dir);
  return out;
}

function snapshotRepo(): string {
  return JSON.stringify({
    specimen: snapshotDir(join(REPO_ROOT, ".specimen")),
    jars: snapshotDir(join(REPO_ROOT, "jars")),
  });
}

/**
 * Runs `body` in a fresh workspace under the OS temp directory. The workspace has a `.kiro`
 * folder, becomes the process cwd, and is removed with the cwd restored, even when `body` throws.
 */
async function withWorkspace<T>(body: (root: string) => Promise<T>): Promise<T> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "specimen-hook-silence-")));
  expect(root.startsWith(REPO_ROOT)).toBe(false);
  mkdirSync(join(root, ".kiro", "settings"), { recursive: true });
  process.chdir(root);
  try {
    return await body(root);
  } finally {
    process.chdir(ORIGINAL_CWD);
    rmSync(root, { recursive: true, force: true });
  }
}

/** An in-memory FsPort. Keys are the absolute paths the hook uses, so the workspace layout is unchanged. */
function memoryPort(root: string): { fs: FsPort; files: Map<string, string> } {
  const files = new Map<string, string>([[join(root, ".kiro", "settings", "mcp.json"), MCP_CONFIG]]);
  const fs: FsPort = {
    readText: (path) => files.get(path),
    writeAtomic: (path, text) => {
      files.set(path, text);
    },
    appendText: (path, text) => {
      files.set(path, (files.get(path) ?? "") + text);
    },
    listFiles: (dir) =>
      [...files.keys()]
        .filter((key) => dirname(key) === dir)
        .map((key) => basename(key))
        .sort(),
  };
  return { fs, files };
}

const TOOL_NAMES = ["mcp_hollowinn_quote", "mcp_hollowinn_book", "mcp_other_quote", "quote", ""] as const;
const SESSION_IDS = ["s-1", "sess_2", "bad/id", "..", "", "a b", "A-Z_0"] as const;

const arbitraryBytes = fc
  .uint8Array({ maxLength: 256 })
  .map((bytes) => ({ tag: "bytes" as const, text: Buffer.from(bytes).toString("utf8") }));

const arbitraryJson = fc
  .jsonValue()
  .map((value) => ({ tag: "json" as const, text: JSON.stringify(value) }));

const structuredCall = fc.record({
  tag: fc.constant("call" as const),
  sessionId: fc.oneof(fc.constantFrom(...SESSION_IDS), fc.string({ maxLength: 12 })),
  toolName: fc.oneof(fc.constantFrom(...TOOL_NAMES), fc.string({ maxLength: 24 })),
  toolInput: fc.jsonValue(),
  response: fc.oneof(fc.string({ maxLength: 160 }), fc.jsonValue()),
});

const stdinShape = fc.oneof(arbitraryBytes, arbitraryJson, structuredCall);

const argWord = fc.oneof(
  fc.constantFrom("--server", "--help", "-h", "--bogus", "--server=hollowinn", "extra", "--"),
  fc.string({ maxLength: 10 }),
);

const argv = fc.oneof(
  fc.array(argWord, { maxLength: 4 }),
  fc.string({ maxLength: 10 }).map((server) => ["--server", server]),
  fc.constant(["--server", "hollowinn"]),
);

type StdinShape =
  | { tag: "bytes" | "json"; text: string }
  | { tag: "call"; sessionId: string; toolName: string; toolInput: unknown; response: unknown };

/** The STDIN text for one case. A structured call gets the run's own workspace as its `cwd`. */
function stdinText(shape: StdinShape, root: string, hook: "pre" | "post"): string {
  if (shape.tag !== "call") return shape.text;
  const payload: Record<string, unknown> = {
    session_id: shape.sessionId,
    hook_event_name: hook === "pre" ? "PreToolUse" : "PostToolUse",
    cwd: root,
    tool_name: shape.toolName,
    tool_input: shape.toolInput,
  };
  if (hook === "post") payload.tool_response = shape.response;
  return JSON.stringify(payload);
}

describe("Property 19: capture hooks are silent and exit 0", () => {
  let before: string;

  beforeAll(() => {
    before = snapshotRepo();
  });

  // Feature: jar-capture, Property 19: Capture hooks are silent and exit 0
  // **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.8, 6.9, 6.10, 11.10**
  it("exits 0 and writes nothing to STDOUT or STDERR for arbitrary STDIN bytes and argument lists", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("pre" as const, "post" as const),
        stdinShape,
        argv,
        async (hook, shape, args) => {
          await withWorkspace(async (root) => {
            const { fs } = memoryPort(root);
            const text = stdinText(shape, root, hook);
            const io: HookIO = {
              readStdin: async () => text,
              now: () => FIXED_NOW,
              fs,
            };
            const attempts: Array<"stdout" | "stderr"> = [];
            const observe: StdioObserver = (stream) => {
              attempts.push(stream);
            };

            const code = await runCapture(hook, args, io, observe);

            expect(code).toBe(0);
            expect(attempts).toEqual([]);
          });
        },
      ),
      { numRuns: 200 },
    );
  }, 120_000);

  it("leaves the repository .specimen/ and jars/ unchanged after the property runs", () => {
    expect(snapshotRepo()).toBe(before);
  });
});
