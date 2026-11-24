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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validSessionId } from "@specimen/core";
import fc from "fast-check";
import { beforeAll, describe, expect, it } from "vitest";
import { runCapture, type StdioObserver } from "../src/hooks/run.js";
import type { FsPort, HookIO } from "../src/io/port.js";

/*
 * Each run is a failing capture hook in a fresh mkdtemp workspace. Generated markers (random
 * tokens and secret-looking values) are placed in STDIN, in tool_input, in tool_response and in
 * the argument list. After the run the workspace `.specimen/hook.log` is read and checked line by
 * line. The repository `.specimen/` and `jars/` are snapshotted before and after the suite.
 */

const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const ORIGINAL_CWD = process.cwd();
const FIXED_NOW = 1_700_000_000_000;
const MCP_CONFIG = JSON.stringify({
  mcpServers: { hollowinn: { command: "npx", args: ["tsx", "servers/hollow-inn/src/main.ts", "v1"] } },
});

const LOG_LINE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Messages that the hooks write as fixed strings. */
const FIXED_MESSAGES = new Set([
  "stdin is not valid JSON",
  "session_id invalid",
  "server key is empty",
  "redact config is not valid JSON",
  "redact config fails its schema",
  "workspace mcp.json is missing",
  "workspace mcp.json is not valid JSON",
  "workspace mcp.json fails its schema",
  "server boundary is ambiguous",
  "no configured server matches tool name",
  "invalid argument",
  "counter is not a non-negative integer",
  "jar does not end with a newline, line not appended",
  "clock anomaly, duration set to 0",
]);

/** Messages built from a fixed prefix plus a field path, an index, or a short error name and errno code. */
const COMPOSED_MESSAGES: RegExp[] = [
  /^redact pattern (?:\d+|\?) is invalid$/,
  /^pending line \d+ is invalid$/,
  /^(?:payload invalid|pending entry invalid|jar line invalid) at [A-Za-z0-9_.?()]+(?:, [A-Za-z0-9_.?()]+)*$/,
  /^unexpected [A-Za-z]{1,40}(?: E[A-Z]{1,20})?$/,
  /^(?:response redaction|append|pending removal) failed [A-Za-z]{1,40}(?: E[A-Z]{1,20})?$/,
];

function isAllowedMessage(message: string): boolean {
  return FIXED_MESSAGES.has(message) || COMPOSED_MESSAGES.some((re) => re.test(message));
}

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
  const root = realpathSync(mkdtempSync(join(tmpdir(), "specimen-hook-diag-")));
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
function memoryPort(root: string): FsPort {
  const files = new Map<string, string>([[join(root, ".kiro", "settings", "mcp.json"), MCP_CONFIG]]);
  return {
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
}

/** A port whose reads fail with an error that carries a generated secret in its message. */
function failingReadPort(root: string, secret: string): FsPort {
  const base = memoryPort(root);
  return {
    ...base,
    readText: () => {
      throw Object.assign(new Error(secret), { code: "EACCES" });
    },
  };
}

/** Input shape generated for one run. Markers are built from the random parts inside `build`. */
type Kind = "invalidJson" | "schemaFailure" | "badSession" | "badArguments" | "unexpectedError" | "lockTimeout";

type Shape = {
  hook: "pre" | "post";
  kind: Kind;
  token: string;
  secret: string;
  arg: string;
  variant: number;
  extra: unknown;
};

type Built = {
  markers: string[];
  stdin: string;
  argv: string[];
  readStdinFails: boolean;
  readFails: boolean;
  holdLock: boolean;
};

/** Builds the STDIN text, the argument list and the failure setup for one shape in its workspace. */
function build(shape: Shape, root: string): Built {
  const MK = `MK${shape.token}`;
  const SK = `sk-${shape.secret}`;
  const ARG = `ARG${shape.arg}`;
  const toolInput = { query: MK, nested: { key: SK, list: [ARG, shape.extra] } };
  const valid: Record<string, unknown> = {
    session_id: "s-1",
    hook_event_name: shape.hook === "pre" ? "PreToolUse" : "PostToolUse",
    cwd: root,
    tool_name: "mcp_hollowinn_quote",
    tool_input: toolInput,
  };
  if (shape.hook === "post") valid.tool_response = `Quoted ${MK} total 425.00 ${SK}`;
  const text = JSON.stringify(valid);

  const base: Built = {
    markers: [MK, SK, ARG],
    stdin: text,
    argv: ["--server", "hollowinn"],
    readStdinFails: false,
    readFails: false,
    holdLock: false,
  };

  switch (shape.kind) {
    case "invalidJson": {
      const forms = [`{"session_id":"s-1","tool_input":"${MK}`, `${MK} ${SK} {`, `${text}}`];
      return { ...base, stdin: forms[shape.variant % forms.length] ?? forms[0] ?? "" };
    }
    case "schemaFailure": {
      const broken: Record<string, unknown> = { ...valid };
      switch (shape.variant % 4) {
        case 0:
          delete broken.tool_input;
          break;
        case 1:
          broken.session_id = [MK];
          break;
        case 2:
          broken.tool_name = { name: ARG };
          break;
        default:
          broken.cwd = 42;
      }
      return { ...base, stdin: JSON.stringify(broken) };
    }
    case "badSession": {
      const ids = [`${MK}/x`, `${MK}..${SK}`, `${SK} ${MK}`];
      const id = ids[shape.variant % ids.length] ?? ids[0] ?? MK;
      return { ...base, stdin: JSON.stringify({ ...valid, session_id: id }) };
    }
    case "badArguments": {
      const lists = [["--bogus", MK], ["--server"], ["--bogus", ARG, "--server", SK]];
      return { ...base, argv: lists[shape.variant % lists.length] ?? lists[0] ?? [] };
    }
    case "unexpectedError":
      if (shape.variant % 2 === 0) return { ...base, readStdinFails: true };
      return { ...base, readFails: true };
    case "lockTimeout":
      return { ...base, holdLock: true };
  }
}

const hexToken = fc
  .array(fc.constantFrom(..."0123456789abcdef"), { minLength: 24, maxLength: 40 })
  .map((chars) => chars.join(""));

const shapeArb: fc.Arbitrary<Shape> = fc.record({
  hook: fc.constantFrom("pre" as const, "post" as const),
  kind: fc.oneof(
    { weight: 2, arbitrary: fc.constant("invalidJson" as const) },
    { weight: 2, arbitrary: fc.constant("schemaFailure" as const) },
    { weight: 2, arbitrary: fc.constant("badSession" as const) },
    { weight: 2, arbitrary: fc.constant("badArguments" as const) },
    { weight: 2, arbitrary: fc.constant("unexpectedError" as const) },
    // A held lock costs the full 2 s lock timeout, so it is sampled less often.
    { weight: 1, arbitrary: fc.constant("lockTimeout" as const) },
  ),
  token: hexToken,
  secret: hexToken,
  arg: hexToken,
  variant: fc.nat(7),
  extra: fc.jsonValue(),
});

describe("Property 20: diagnostics never quote input", () => {
  let before: string;

  beforeAll(() => {
    before = snapshotRepo();
  });

  // Feature: jar-capture, Property 20: Diagnostics never quote input
  // **Validates: Requirements 6.5, 6.7, 7.24**
  it("writes no generated input marker to the Hook_Log, and every line has the fixed format", async () => {
    await fc.assert(
      fc.asyncProperty(shapeArb, async (shape) => {
        await withWorkspace(async (root) => {
          const built = build(shape, root);
          const specimenDir = join(root, ".specimen");
          if (built.holdLock) {
            mkdirSync(specimenDir, { recursive: true });
            writeFileSync(join(specimenDir, "lock"), `held ${built.markers.join(" ")}`, "utf8");
          }

          const io: HookIO = {
            readStdin: async () => {
              if (built.readStdinFails) throw Object.assign(new Error(built.markers[0] ?? ""), { code: "EIO" });
              return built.stdin;
            },
            now: () => FIXED_NOW,
            fs: built.readFails ? failingReadPort(root, built.markers[1] ?? "") : memoryPort(root),
          };
          const attempts: Array<"stdout" | "stderr"> = [];
          const observe: StdioObserver = (stream) => {
            attempts.push(stream);
          };

          const code = await runCapture(shape.hook, built.argv, io, observe);
          expect(code).toBe(0);
          expect(attempts).toEqual([]);

          const logPath = join(specimenDir, "hook.log");
          const logText = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
          for (const marker of built.markers) {
            expect(logText.includes(marker), `marker reached the log: ${shape.kind}`).toBe(false);
          }

          // A failing path must log something, so an empty log would mean the check saw nothing.
          expect(logText, `no diagnostic for ${shape.kind}`).not.toBe("");
          expect(logText.endsWith("\n")).toBe(true);
          const lines = logText.slice(0, -1).split("\n");
          for (const line of lines) {
            for (const marker of built.markers) expect(line.includes(marker)).toBe(false);
            const fields = line.split("\t");
            expect(fields, `line format: ${line}`).toHaveLength(4);
            const [time, hookName, session, message] = fields as [string, string, string, string];
            expect(LOG_LINE.test(time)).toBe(true);
            expect(hookName).toBe(shape.hook);
            expect(session === "-" || validSessionId(session)).toBe(true);
            expect(isAllowedMessage(message), `unexpected message: ${message}`).toBe(true);
          }
        });
      }),
      { numRuns: 120 },
    );
  }, 300_000);

  it("leaves the repository .specimen/ and jars/ unchanged after the property runs", () => {
    expect(snapshotRepo()).toBe(before);
  });
});
