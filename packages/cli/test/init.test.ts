import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { replayPolicySchema, type ClientFactory } from "@specimen/core";
import { createProgram } from "../src/main.js";
import {
  INIT_EXIT,
  checkServerKey,
  checkTestServer,
  hookFiles,
  mergeGitignore,
  mergeMcpEntry,
  runInit,
  stopHookText,
  type InitOptions,
  type InitPorts,
} from "../src/init.js";

/**
 * `specimen init` with fake ports. Files live in a temporary directory and are read and written
 * for real. The prompts, the kiro-cli probe and the test server are fakes, so no server or
 * kiro-cli process is started.
 */

type Tool = { name: string; annotations?: { readOnlyHint?: boolean } };
type Mode = "ok" | "start-fail" | "list-fail";

const TOOLS: Tool[] = [
  { name: "get_room", annotations: { readOnlyHint: true } },
  { name: "book_room", annotations: { readOnlyHint: false } },
  { name: "cancel_booking" },
];

const MCP_COMMAND = "npx tsx servers/hollow-inn/src/main.ts v1";
const TEST_SERVER = "npx tsx test/instance.ts v1";

type Harness = {
  root: string;
  ports: InitPorts;
  stdout: string[];
  stderr: string[];
  asked: string[];
  started: string[];
  closed: { count: number };
};

const roots: string[] = [];

function harness(opts: { tty?: boolean; answers?: string[]; mode?: Mode; kiro?: string | null } = {}): Harness {
  const root = mkdtempSync(join(tmpdir(), "specimen-init-"));
  roots.push(root);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const asked: string[] = [];
  const started: string[] = [];
  const closed = { count: 0 };
  const answers = [...(opts.answers ?? [])];
  const mode = opts.mode ?? "ok";
  const kiro = opts.kiro === undefined ? "kiro-cli 2.0.0" : opts.kiro;

  const ports: InitPorts = {
    cwd: () => root,
    stdout: (text) => {
      stdout.push(text);
    },
    stderr: (text) => {
      stderr.push(text);
    },
    isTTY: opts.tty ?? false,
    ask: async (question) => {
      asked.push(question);
      return answers.shift() ?? "";
    },
    readText: (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    },
    writeText: (path, text) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    },
    kiroVersion: async () => kiro ?? undefined,
    clientFactory: (command) => {
      started.push(command);
      const factory = async () => {
        if (mode === "start-fail") throw new Error("spawn npx ENOENT");
        const client = {
          listTools: async () => {
            if (mode === "list-fail") throw new Error("tools/list failed");
            return { tools: TOOLS };
          },
        };
        return {
          client: client as unknown as Client,
          close: async () => {
            closed.count += 1;
          },
        };
      };
      return factory as unknown as ClientFactory;
    },
  };
  return { root, ports, stdout, stderr, asked, started, closed };
}

function baseOptions(h: Harness, overrides: Partial<InitOptions> = {}): InitOptions {
  return {
    root: h.root,
    serverKey: "hollowinn",
    mcpCommand: MCP_COMMAND,
    allow: [],
    watch: [],
    ...overrides,
  };
}

function init(h: Harness, overrides: Partial<InitOptions> = {}): Promise<number> {
  return runInit(baseOptions(h, overrides), h.ports);
}

function read(h: Harness, rel: string): string {
  return readFileSync(join(h.root, rel), "utf8");
}

function exists(h: Harness, rel: string): boolean {
  return existsSync(join(h.root, rel));
}

function seed(h: Harness, rel: string, text: string): void {
  mkdirSync(dirname(join(h.root, rel)), { recursive: true });
  writeFileSync(join(h.root, rel), text);
}

/** Every regular file under the root, with its text. Used to compare two runs. */
function snapshot(h: Harness): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rel of readdirSync(h.root, { recursive: true }) as string[]) {
    const abs = join(h.root, rel);
    if (statSync(abs).isFile()) out[rel] = readFileSync(abs, "utf8");
  }
  return out;
}

let h: Harness;

beforeEach(() => {
  h = harness();
});

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("hook files", () => {
  it("writes the pre, post and firewall hooks with the existing JSON shape", async () => {
    expect(await init(h, { testServer: undefined })).toBe(INIT_EXIT.done);

    expect(JSON.parse(read(h, ".kiro/hooks/specimen-jar-pre.json"))).toEqual({
      version: "v1",
      hooks: [
        {
          name: "specimen-jar-pre",
          trigger: "PreToolUse",
          matcher: "@hollowinn",
          action: { type: "command", command: "npx --no-install specimen hook pre --server hollowinn" },
        },
      ],
    });
    expect(JSON.parse(read(h, ".kiro/hooks/specimen-jar-post.json"))).toEqual({
      version: "v1",
      hooks: [
        {
          name: "specimen-jar-post",
          trigger: "PostToolUse",
          matcher: "@hollowinn",
          action: { type: "command", command: "npx --no-install specimen hook post --server hollowinn" },
        },
      ],
    });
    expect(JSON.parse(read(h, ".kiro/hooks/specimen-jar-firewall.json"))).toEqual({
      version: "v1",
      hooks: [
        {
          name: "specimen-jar-firewall",
          trigger: "PreToolUse",
          matcher: "write",
          action: { type: "command", command: "npx --no-install specimen hook firewall" },
        },
      ],
    });
  });

  it("builds the same three files from hookFiles", () => {
    expect(hookFiles("hollowinn").map((file) => file.rel)).toEqual([
      ".kiro/hooks/specimen-jar-pre.json",
      ".kiro/hooks/specimen-jar-post.json",
      ".kiro/hooks/specimen-jar-firewall.json",
    ]);
  });
});

describe("server key", () => {
  it("accepts letters and digits", () => {
    expect(() => checkServerKey("hollowinn")).not.toThrow();
  });

  it("rejects a key with a separator and exits 2 without writing", async () => {
    expect(await init(h, { serverKey: "hollow-inn" })).toBe(INIT_EXIT.usage);
    expect(h.stderr.join("")).toContain("/^[A-Za-z0-9]+$/");
    expect(exists(h, ".kiro/hooks/specimen-jar-pre.json")).toBe(false);
    expect(exists(h, MCP_REL_PATH)).toBe(false);
  });

  it("accepts a hollowinn key end to end", async () => {
    expect(await init(h, { serverKey: "hollowinn" })).toBe(INIT_EXIT.done);
  });

  it("exits 2 without a terminal and without --server-key", async () => {
    expect(await init(h, { serverKey: undefined })).toBe(INIT_EXIT.usage);
    expect(h.stderr.join("")).toBe("specimen init: --server-key is required without a terminal\n");
  });

  it("asks for the key with the mcp.json keys listed when a terminal is attached", async () => {
    h = harness({ tty: true, answers: ["hollowinn"] });
    seed(h, MCP_REL_PATH, JSON.stringify({ mcpServers: { hollowinn: { command: "npx", args: [] } } }));
    expect(await init(h, { serverKey: undefined, mcpCommand: undefined })).toBe(INIT_EXIT.done);
    expect(h.asked[0]).toContain("hollowinn");
    expect(exists(h, ".kiro/hooks/specimen-jar-pre.json")).toBe(true);
  });
});

const MCP_REL_PATH = ".kiro/settings/mcp.json";

describe("mcp.json", () => {
  it("keeps every other entry and key, and adds only the missing key", () => {
    const before = JSON.stringify({
      mcpServers: { other: { command: "node", args: ["x.js"] } },
      extra: true,
    });
    const merged = mergeMcpEntry(before, "hollowinn", { command: "npx", args: ["tsx", "main.ts"] });
    expect(merged.changed).toBe(true);
    expect(JSON.parse(merged.text)).toEqual({
      mcpServers: {
        other: { command: "node", args: ["x.js"] },
        hollowinn: { command: "npx", args: ["tsx", "main.ts"] },
      },
      extra: true,
    });
  });

  it("writes the merged file through init and keeps an existing entry", async () => {
    seed(h, MCP_REL_PATH, JSON.stringify({ mcpServers: { other: { command: "node", args: [] } } }));
    expect(await init(h)).toBe(INIT_EXIT.done);
    const parsed = JSON.parse(read(h, MCP_REL_PATH));
    expect(parsed.mcpServers.other).toEqual({ command: "node", args: [] });
    expect(parsed.mcpServers.hollowinn).toEqual({ command: "npx", args: ["tsx", "servers/hollow-inn/src/main.ts", "v1"] });

    const kept = JSON.stringify({ mcpServers: { hollowinn: { command: "custom", args: [] } } });
    seed(h, MCP_REL_PATH, kept);
    h.stdout.length = 0;
    expect(await init(h, { mcpCommand: "npx other" })).toBe(INIT_EXIT.done);
    expect(read(h, MCP_REL_PATH)).toBe(kept);
    expect(h.stdout.join("")).toContain(`kept ${MCP_REL_PATH} (has an entry for hollowinn)`);
  });

  it("exits 2 when there is no entry and no --mcp-command, and writes nothing", async () => {
    expect(await init(h, { mcpCommand: undefined })).toBe(INIT_EXIT.usage);
    expect(h.stderr.join("")).toContain(
      "no mcp.json entry for hollowinn — add the server to .kiro/settings/mcp.json or pass --mcp-command",
    );
    expect(exists(h, ".kiro/hooks/specimen-jar-pre.json")).toBe(false);
  });
});

describe("stop gate", () => {
  it("is written only when a test server command is given", async () => {
    expect(await init(h, { testServer: undefined })).toBe(INIT_EXIT.done);
    expect(exists(h, ".kiro/hooks/specimen-jar-stop.json")).toBe(false);
    expect(h.stdout.join("")).toContain("no stop gate installed");

    h = harness();
    expect(await init(h, { testServer: TEST_SERVER })).toBe(INIT_EXIT.done);
    expect(JSON.parse(read(h, ".kiro/hooks/specimen-jar-stop.json"))).toEqual({
      version: "v1",
      hooks: [
        {
          name: "specimen-jar-stop",
          trigger: "Stop",
          timeout: 30,
          action: {
            type: "command",
            command: `npx --no-install specimen hook stop --server "${TEST_SERVER}"`,
          },
        },
      ],
    });
  });

  it("refuses a double quote in the command with exit 2 and writes nothing", async () => {
    expect(await init(h, { testServer: 'npx tsx "test instance.ts"' })).toBe(INIT_EXIT.usage);
    expect(h.stderr.join("")).toContain("double quote");
    expect(exists(h, ".kiro/hooks/specimen-jar-stop.json")).toBe(false);
    expect(exists(h, ".kiro/hooks/specimen-jar-pre.json")).toBe(false);
  });

  it("writes the turn hook next to the stop hook, and not without it", async () => {
    expect(await init(h, { testServer: undefined })).toBe(INIT_EXIT.done);
    expect(exists(h, ".kiro/hooks/specimen-jar-turn.json")).toBe(false);

    h = harness();
    expect(await init(h, { testServer: TEST_SERVER })).toBe(INIT_EXIT.done);
    expect(JSON.parse(read(h, ".kiro/hooks/specimen-jar-turn.json"))).toEqual({
      version: "v1",
      hooks: [
        {
          name: "specimen-jar-turn",
          trigger: "UserPromptSubmit",
          action: { type: "command", command: "npx --no-install specimen hook prompt" },
        },
      ],
    });
  });

  it("builds the stop hook text and checks the command", () => {
    expect(JSON.parse(stopHookText("a b"))).toHaveProperty("hooks.0.action.command", 'npx --no-install specimen hook stop --server "a b"');
    expect(checkTestServer("   ")).toBeUndefined();
    expect(() => checkTestServer("npx 'open")).toThrow(/unterminated/);
  });
});

describe("allow list and replay.json", () => {
  it("pre-fills read-only tools and watches src/** by default", async () => {
    expect(await init(h, { testServer: TEST_SERVER })).toBe(INIT_EXIT.done);
    const policy = JSON.parse(read(h, ".specimen/replay.json"));
    expect(policy).toEqual({ allow: ["get_room"], watch: ["src/**"] });
    expect(h.started).toEqual([TEST_SERVER]);
    expect(h.closed.count).toBe(1);
  });

  it("writes replay.json that validates against the core schema", async () => {
    await init(h, { testServer: TEST_SERVER, allow: ["book_room"], watch: ["app/**"] });
    const parsed = replayPolicySchema.safeParse(JSON.parse(read(h, ".specimen/replay.json")));
    expect(parsed.success).toBe(true);
  });

  it("adds --allow tools to the read-only ones", async () => {
    await init(h, { testServer: TEST_SERVER, allow: ["book_room"] });
    expect(JSON.parse(read(h, ".specimen/replay.json")).allow).toEqual(["get_room", "book_room"]);
  });

  it("exits 2 for an --allow name the server does not list, and writes no replay.json", async () => {
    expect(await init(h, { testServer: TEST_SERVER, allow: ["nope"] })).toBe(INIT_EXIT.usage);
    expect(h.stderr.join("")).toContain("nope");
    expect(exists(h, ".specimen/replay.json")).toBe(false);
  });

  it("allows every listed tool with --yes and names them", async () => {
    await init(h, { testServer: TEST_SERVER, yes: true });
    expect(JSON.parse(read(h, ".specimen/replay.json")).allow).toEqual(["get_room", "book_room", "cancel_booking"]);
    expect(h.stdout.join("")).toContain("allowed by --yes: get_room, book_room, cancel_booking");
  });

  it("asks about each other tool with a terminal, and watches the globs given", async () => {
    h = harness({ tty: true, answers: ["src/**, lib/**", "y", "n"] });
    expect(await init(h, { testServer: TEST_SERVER })).toBe(INIT_EXIT.done);
    expect(h.asked.find((q) => q.includes("book_room"))).toContain("[y/N]");
    expect(JSON.parse(read(h, ".specimen/replay.json"))).toEqual({
      allow: ["get_room", "book_room"],
      watch: ["src/**", "lib/**"],
    });
  });

  it("keeps the --allow flags and exits 0 when the test server cannot start", async () => {
    h = harness({ mode: "start-fail" });
    expect(await init(h, { testServer: TEST_SERVER, allow: ["book_room"] })).toBe(INIT_EXIT.done);
    expect(h.stdout.join("")).toContain("could not list the tools of the test server");
    expect(JSON.parse(read(h, ".specimen/replay.json")).allow).toEqual(["book_room"]);
  });

  it("closes the test server when listing fails", async () => {
    h = harness({ mode: "list-fail" });
    expect(await init(h, { testServer: TEST_SERVER })).toBe(INIT_EXIT.done);
    expect(h.closed.count).toBe(1);
    expect(JSON.parse(read(h, ".specimen/replay.json")).allow).toEqual([]);
  });

  it("says the allow list is empty when nothing can be replayed", async () => {
    await init(h);
    expect(h.stdout.join("")).toContain("allow list is empty");
    expect(h.started).toEqual([]);
  });
});

describe("gitignore", () => {
  it("appends only the missing lines and keeps the existing ones in order", async () => {
    seed(h, ".gitignore", "node_modules/\njars/\n");
    expect(await init(h)).toBe(INIT_EXIT.done);
    expect(read(h, ".gitignore")).toBe(
      "node_modules/\njars/\nreplays/\n.specimen/pending.jsonl\n.specimen/hook.log\n.specimen/turn.json\n.specimen/gate-*.json\n.specimen/unresolved.md\n",
    );
  });

  it("creates the file when it is missing", async () => {
    await init(h);
    expect(read(h, ".gitignore").split("\n").filter(Boolean)).toEqual([
      "jars/",
      "replays/",
      ".specimen/pending.jsonl",
      ".specimen/hook.log",
      ".specimen/turn.json",
      ".specimen/gate-*.json",
      ".specimen/unresolved.md",
    ]);
  });

  it("does not ignore jars/ with --commit-jars and says so", async () => {
    await init(h, { commitJars: true });
    expect(read(h, ".gitignore").split("\n")).not.toContain("jars/");
    expect(h.stdout.join("")).toContain("jars/ is committed: redaction rules apply — read .specimen/redact.json first");
  });

  it("merges without reordering or removing a line", () => {
    const merged = mergeGitignore("b\na", ["a", "c"]);
    expect(merged).toEqual({ text: "b\na\nc\n", changed: true });
    expect(mergeGitignore("a\nc\n", ["a", "c"])).toEqual({ text: "a\nc\n", changed: false });
  });
});

describe("idempotence", () => {
  it("a second run with the same arguments writes nothing and changes no byte", async () => {
    const options = { testServer: TEST_SERVER, allow: ["book_room"], watch: ["app/**"] };
    expect(await init(h, options)).toBe(INIT_EXIT.done);
    const before = snapshot(h);
    h.stdout.length = 0;
    expect(await init(h, options)).toBe(INIT_EXIT.done);
    expect(snapshot(h)).toEqual(before);
    const lines = h.stdout.join("").split("\n");
    expect(lines.some((line) => line.startsWith("wrote"))).toBe(false);
    expect(lines.filter((line) => line.startsWith("kept")).length).toBeGreaterThanOrEqual(5);
    expect(h.started).toHaveLength(1);
  });

  it("--force rewrites existing hook files and replay.json", async () => {
    await init(h, { testServer: TEST_SERVER });
    writeFileSync(join(h.root, ".kiro/hooks/specimen-jar-pre.json"), "stale");
    writeFileSync(join(h.root, ".specimen/replay.json"), '{"allow":[],"watch":[]}');
    h.stdout.length = 0;
    expect(await init(h, { testServer: TEST_SERVER, force: true })).toBe(INIT_EXIT.done);
    expect(JSON.parse(read(h, ".kiro/hooks/specimen-jar-pre.json")).hooks[0].name).toBe("specimen-jar-pre");
    expect(JSON.parse(read(h, ".specimen/replay.json")).allow).toEqual(["get_room"]);
    expect(h.stdout.join("")).toContain("wrote .kiro/hooks/specimen-jar-pre.json");
  });
});

describe("kiro-cli engine check", () => {
  it("warns and still exits 0 when kiro-cli is missing", async () => {
    h = harness({ kiro: null });
    expect(await init(h)).toBe(INIT_EXIT.done);
    expect(h.stdout.join("")).toContain("kiro-cli not found on PATH — hooks are written but the headless commands need it");
  });

  it("prints the version and the engine pin", async () => {
    expect(await init(h)).toBe(INIT_EXIT.done);
    const out = h.stdout.join("");
    expect(out).toContain("kiro-cli 2.0.0\n");
    expect(out).toContain("headless commands pin --agent-engine v3");
  });

  it("ends with the next line", async () => {
    await init(h);
    const last = h.stdout[h.stdout.length - 1];
    expect(last).toBe(
      'next: restart the Kiro session, run your agent against hollowinn, then: specimen replay --server "<your test instance command>"\n',
    );
  });
});

describe("command registration", () => {
  it("registers init on the specimen program", () => {
    expect(createProgram().commands.map((command) => command.name())).toContain("init");
  });
});
