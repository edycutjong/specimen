/**
 * The `specimen init` command. It sets up one MCP server repository: the capture hooks, the stop
 * gate, the replay policy and the ignore rules. Every check that can fail runs before the first
 * file is written, so a usage error (exit 2) leaves the repository unchanged.
 *
 * Exit codes: 0 done, 2 usage error or a missing answer in a non-interactive run.
 */
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { Command } from "commander";
import { MAX_LIST_PAGES, replayPolicySchema, type ClientFactory, type ReplayPolicy } from "@specimen/core";
import { findWorkspaceRoot } from "./io/root.js";
import { CommandSyntaxError, makeStdioClientFactory, splitCommand } from "./replay/client-factory.js";

/** Exit codes of `specimen init`. */
export const INIT_EXIT = { done: 0, usage: 2 } as const;

const KEY_PATTERN = /^[A-Za-z0-9]+$/;
const UNSAFE_IN_DOUBLE_QUOTES = /["\\$`\r\n]/;
const DEFAULT_WATCH = ["src/**"];
const ALWAYS_IGNORED = [
  "replays/",
  ".specimen/pending.jsonl",
  ".specimen/hook.log",
  ".specimen/turn.json",
  ".specimen/gate-*.json",
  ".specimen/unresolved.md",
];
const JARS_IGNORED = "jars/";
const TEST_SERVER_TIMEOUT_MS = 30_000;
const MCP_REL = ".kiro/settings/mcp.json";
const REPLAY_REL = ".specimen/replay.json";
const STOP_REL = ".kiro/hooks/specimen-jar-stop.json";
const TURN_REL = ".kiro/hooks/specimen-jar-turn.json";
const STOP_TIMEOUT_SECONDS = 30;
const GITIGNORE_REL = ".gitignore";
const STOP_PROMPT =
  "command that starts a disposable test instance of the server — never production; leave blank for no stop gate";
const WATCH_PROMPT = "paths that hold the server source (comma separated)";

/** The option values as commander gives them. */
export type InitOptions = {
  root?: string;
  serverKey?: string;
  mcpCommand?: string;
  testServer?: string;
  allow: string[];
  watch: string[];
  commitJars?: boolean;
  force?: boolean;
  yes?: boolean;
};

/** The effects that `runInit` needs from its surroundings. Tests supply their own. */
export type InitPorts = {
  cwd(): string;
  stdout(text: string): void;
  stderr(text: string): void;
  /** True when STDIN is a terminal. Questions are asked only then. */
  isTTY: boolean;
  ask(question: string): Promise<string>;
  /** The file text, or undefined when the file is missing or cannot be read. */
  readText(path: string): string | undefined;
  /** Writes the file, creating its folder when it is missing. */
  writeText(path: string, text: string): void;
  /** The first line of `kiro-cli --version`, or undefined when kiro-cli cannot be started. */
  kiroVersion(): Promise<string | undefined>;
  /** A Client_Factory for the test server command, run from `root`. */
  clientFactory(command: string, root: string): ClientFactory;
  /** Releases the terminal. */
  close?(): void;
};

/** A problem with the arguments or the repository. `runInit` turns it into exit 2. */
class UsageError extends Error {}

type McpEntry = { command: string; args: string[] };
type TestTool = { name: string; readOnly: boolean };

/** Pretty-printed JSON with a final newline. */
function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** Throws a UsageError unless the key matches /^[A-Za-z0-9]+$/. */
export function checkServerKey(key: string): void {
  if (!KEY_PATTERN.test(key)) {
    throw new UsageError(
      `the server key "${key}" must match /^[A-Za-z0-9]+$/ (letters and digits only, no separators): it is the hook selector @<key> and the prefix of the sanitised tool names`,
    );
  }
}

/** The three hook files for a server key, with their paths relative to the repository root. */
export function hookFiles(key: string): Array<{ rel: string; text: string }> {
  const hook = (name: string, trigger: string, matcher: string, command: string): string =>
    jsonText({ version: "v1", hooks: [{ name, trigger, matcher, action: { type: "command", command } }] });
  return [
    {
      rel: ".kiro/hooks/specimen-jar-pre.json",
      text: hook("specimen-jar-pre", "PreToolUse", `@${key}`, `npx --no-install specimen hook pre --server ${key}`),
    },
    {
      rel: ".kiro/hooks/specimen-jar-post.json",
      text: hook("specimen-jar-post", "PostToolUse", `@${key}`, `npx --no-install specimen hook post --server ${key}`),
    },
    {
      rel: ".kiro/hooks/specimen-jar-firewall.json",
      text: hook("specimen-jar-firewall", "PreToolUse", "write", "npx --no-install specimen hook firewall"),
    },
  ];
}

/** The stop gate file. The test server command sits inside double quotes in the shell command. */
export function stopHookText(testServer: string): string {
  return jsonText({
    version: "v1",
    hooks: [
      {
        name: "specimen-jar-stop",
        trigger: "Stop",
        timeout: STOP_TIMEOUT_SECONDS,
        action: { type: "command", command: `npx --no-install specimen hook stop --server "${testServer}"` },
      },
    ],
  });
}

/** The UserPromptSubmit hook that writes the turn snapshot the stop gate compares against. */
export function turnHookText(): string {
  return jsonText({
    version: "v1",
    hooks: [
      {
        name: "specimen-jar-turn",
        trigger: "UserPromptSubmit",
        action: { type: "command", command: "npx --no-install specimen hook prompt" },
      },
    ],
  });
}

/**
 * The trimmed test server command, or undefined when it is blank. A double quote, backslash, `$`,
 * backtick or line break is refused, because the stop gate wraps the command in double quotes.
 */
export function checkTestServer(raw: string): string | undefined {
  const command = raw.trim();
  if (command === "") return undefined;
  if (UNSAFE_IN_DOUBLE_QUOTES.test(command)) {
    throw new UsageError(
      "the test-server command cannot contain a double quote, backslash, $, backtick or line break: the stop gate puts it inside double quotes",
    );
  }
  try {
    splitCommand(command);
  } catch (error) {
    if (error instanceof CommandSyntaxError) throw new UsageError(`the test-server command has ${error.message}`);
    throw error;
  }
  return command;
}

/** The `--mcp-command` value split into its program and arguments. */
export function parseMcpCommand(raw: string): McpEntry {
  let words: string[];
  try {
    words = splitCommand(raw);
  } catch (error) {
    if (error instanceof CommandSyntaxError) throw new UsageError(`--mcp-command has ${error.message}`);
    throw error;
  }
  const [command, ...args] = words;
  if (command === undefined) throw new UsageError("--mcp-command is empty");
  return { command, args };
}

/** The parsed mcp.json and its `mcpServers` object. A missing or blank file is an empty object. */
function readMcp(text: string | undefined): { doc: Record<string, unknown>; servers: Record<string, unknown> } {
  let doc: unknown = {};
  if (text !== undefined && text.trim() !== "") {
    try {
      doc = JSON.parse(text);
    } catch {
      throw new UsageError(`${MCP_REL} is not valid JSON`);
    }
  }
  if (!isRecord(doc)) throw new UsageError(`${MCP_REL} must hold a JSON object`);
  const servers = doc.mcpServers ?? {};
  if (!isRecord(servers)) throw new UsageError(`mcpServers in ${MCP_REL} must be an object`);
  return { doc, servers };
}

/**
 * Adds `entry` under `mcpServers.<key>` when that key is missing. Every other key stays as it
 * was. An existing entry is never replaced. Without an entry and without `entry`, it throws.
 */
export function mergeMcpEntry(
  text: string | undefined,
  key: string,
  entry: McpEntry | undefined,
): { text: string; changed: boolean } {
  const { doc, servers } = readMcp(text);
  if (Object.keys(servers).includes(key)) return { text: text ?? "", changed: false };
  if (entry === undefined) {
    throw new UsageError(`no mcp.json entry for ${key} — add the server to ${MCP_REL} or pass --mcp-command`);
  }
  const next = { ...doc, mcpServers: { ...servers, [key]: { command: entry.command, args: entry.args } } };
  return { text: jsonText(next), changed: true };
}

/**
 * Appends the required lines that the file does not already hold, in the order given. Existing
 * lines are never reordered or removed.
 */
export function mergeGitignore(text: string | undefined, required: readonly string[]): { text: string; changed: boolean } {
  const existing = text ?? "";
  const present = new Set(existing.split("\n").map((line) => line.trim()));
  const missing = required.filter((line) => !present.has(line));
  if (missing.length === 0) return { text: existing, changed: false };
  const prefix = existing === "" || existing.endsWith("\n") ? existing : `${existing}\n`;
  return { text: prefix + missing.map((line) => `${line}\n`).join(""), changed: true };
}

/** The server keys of mcp.json. An unreadable file gives none; the merge reports the error later. */
function mcpServerKeys(text: string | undefined): string[] {
  try {
    return Object.keys(readMcp(text).servers);
  } catch {
    return [];
  }
}

/** The server key: `--server-key`, or a question when a terminal is attached. */
async function chooseKey(flag: string | undefined, known: readonly string[], ports: InitPorts): Promise<string> {
  if (flag !== undefined) {
    checkServerKey(flag);
    return flag;
  }
  if (!ports.isTTY) throw new UsageError("--server-key is required without a terminal");
  const hint = known.length > 0 ? ` (in mcp.json: ${known.join(", ")})` : "";
  const answer = (await ports.ask(`MCP server key${hint}: `)).trim();
  checkServerKey(answer);
  return answer;
}

/** The stop gate command: the flag, or a question when a terminal is attached. Blank means none. */
async function chooseTestServer(flag: string | undefined, ports: InitPorts): Promise<string | undefined> {
  let raw = flag;
  if (raw === undefined && ports.isTTY) raw = await ports.ask(`${STOP_PROMPT}: `);
  return checkTestServer(raw ?? "");
}

/** The watch globs: the flags, else a question when a terminal is attached, else `src/**`. */
async function chooseWatch(flags: readonly string[], ports: InitPorts): Promise<string[]> {
  if (flags.length > 0) return unique(flags);
  if (!ports.isTTY) return [...DEFAULT_WATCH];
  const globs = (await ports.ask(`${WATCH_PROMPT}: `))
    .split(",")
    .map((glob) => glob.trim())
    .filter((glob) => glob !== "");
  return globs.length > 0 ? globs : [...DEFAULT_WATCH];
}

/** Starts the test server, lists its tools and closes it. The child is closed even when listing fails. */
async function listTestTools(
  command: string,
  root: string,
  ports: InitPorts,
): Promise<{ ok: true; tools: TestTool[] } | { ok: false; message: string }> {
  let session: Awaited<ReturnType<ClientFactory>>;
  try {
    session = await ports.clientFactory(command, root)();
  } catch (error) {
    return { ok: false, message: describe(error) };
  }
  try {
    // tools/list is paginated: follow nextCursor (same bound as the replay engine), or replay.json misses later tools.
    const tools: TestTool[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; ; page += 1) {
      if (page >= MAX_LIST_PAGES) throw new Error(`tools/list did not end after ${MAX_LIST_PAGES} pages`);
      const listing = await session.client.listTools(cursor === undefined ? undefined : { cursor });
      for (const tool of listing.tools) {
        tools.push({ name: tool.name, readOnly: tool.annotations?.readOnlyHint === true });
      }
      const next = listing.nextCursor;
      if (next === undefined) break;
      if (seen.has(next)) throw new Error(`tools/list repeated the cursor ${JSON.stringify(next)}`);
      seen.add(next);
      cursor = next;
    }
    return { ok: true, tools };
  } catch (error) {
    return { ok: false, message: describe(error) };
  } finally {
    await session.close().catch(() => undefined);
  }
}

/**
 * The allow list. Read-only tools are always allowed. `--allow` adds names. `--yes` allows every
 * listed tool. With a terminal each other tool is asked about. Without one it is not allowed.
 */
async function chooseAllow(
  tools: readonly TestTool[],
  flags: readonly string[],
  yes: boolean,
  ports: InitPorts,
): Promise<string[]> {
  const listed = tools.map((tool) => tool.name);
  const unknown = flags.filter((name) => !listed.includes(name));
  if (unknown.length > 0) {
    throw new UsageError(`--allow names tools that the test server does not list: ${unknown.join(", ")}`);
  }
  if (yes) {
    ports.stdout(`allowed by --yes: ${listed.join(", ")}\n`);
    return listed;
  }
  const allow: string[] = [];
  for (const tool of tools) {
    if (tool.readOnly || flags.includes(tool.name)) {
      allow.push(tool.name);
    } else if (ports.isTTY) {
      const answer = await ports.ask(`replay ${tool.name} against your test instance? [y/N] `);
      if (/^y(es)?$/i.test(answer.trim())) allow.push(tool.name);
    }
  }
  return allow;
}

/** The replay policy to write. The test server is started only when a test server command is given. */
async function planPolicy(
  options: InitOptions,
  testServer: string | undefined,
  root: string,
  ports: InitPorts,
): Promise<ReplayPolicy> {
  const watch = await chooseWatch(options.watch, ports);
  const flags = unique(options.allow);
  let allow = flags;
  if (testServer !== undefined) {
    const listing = await listTestTools(testServer, root, ports);
    if (listing.ok) {
      allow = await chooseAllow(listing.tools, flags, options.yes === true, ports);
    } else {
      ports.stdout(
        `specimen init: could not list the tools of the test server (${listing.message}); replay.json holds only the --allow flags\n`,
      );
    }
  }
  if (allow.length === 0) {
    ports.stdout("allow list is empty — no jar can be replayed until you add tools to .specimen/replay.json\n");
  }
  return replayPolicySchema.parse({ allow, watch });
}

/** Writes a file and reports it. */
function writeFile(ports: InitPorts, root: string, rel: string, text: string): void {
  ports.writeText(join(root, rel), text);
  ports.stdout(`wrote ${rel}\n`);
}

/** Writes a file unless it exists and `force` is off. Then it reports `kept`. */
function writeUnlessKept(ports: InitPorts, root: string, rel: string, text: string, force: boolean): void {
  if (!force && ports.readText(join(root, rel)) !== undefined) {
    ports.stdout(`kept ${rel} (exists; use --force)\n`);
    return;
  }
  writeFile(ports, root, rel, text);
}

/** The version line of kiro-cli, or undefined when the program cannot be started. Never rejects. */
function kiroCliVersion(): Promise<string | undefined> {
  return new Promise((resolvePromise) => {
    execFile("kiro-cli", ["--version"], { timeout: 10_000 }, (error, stdout, stderr) => {
      if ((error as { code?: unknown } | null)?.code === "ENOENT") {
        resolvePromise(undefined);
        return;
      }
      const line = `${stdout}\n${stderr}`
        .split("\n")
        .map((text) => text.trim())
        .find((text) => text !== "");
      resolvePromise(line ?? "kiro-cli printed no version");
    });
  });
}

/** Runs `specimen init`. Usage errors are written to STDERR and return exit code 2. */
export async function runInit(options: InitOptions, ports: InitPorts): Promise<number> {
  try {
    await initRepository(options, ports);
    return INIT_EXIT.done;
  } catch (error) {
    if (error instanceof UsageError) {
      ports.stderr(`specimen init: ${error.message}\n`);
      return INIT_EXIT.usage;
    }
    throw error;
  }
}

async function initRepository(options: InitOptions, ports: InitPorts): Promise<void> {
  const cwd = ports.cwd();
  const root = options.root !== undefined ? resolve(cwd, options.root) : findWorkspaceRoot(cwd);
  const force = options.force === true;

  // Every check that can exit 2 runs here, before the first write.
  const mcpText = ports.readText(join(root, MCP_REL));
  const key = await chooseKey(options.serverKey, mcpServerKeys(mcpText), ports);
  const entry = options.mcpCommand === undefined ? undefined : parseMcpCommand(options.mcpCommand);
  const mcp = mergeMcpEntry(mcpText, key, entry);
  const testServer = await chooseTestServer(options.testServer, ports);
  const replayExists = ports.readText(join(root, REPLAY_REL)) !== undefined;
  const policy = replayExists && !force ? undefined : await planPolicy(options, testServer, root, ports);
  const gitignoreText = ports.readText(join(root, GITIGNORE_REL));
  const ignored = options.commitJars === true ? ALWAYS_IGNORED : [JARS_IGNORED, ...ALWAYS_IGNORED];
  const gitignore = mergeGitignore(gitignoreText, ignored);

  // Writes, in the order of the spec.
  if (mcp.changed) {
    writeFile(ports, root, MCP_REL, mcp.text);
  } else {
    ports.stdout(`kept ${MCP_REL} (has an entry for ${key})\n`);
  }
  for (const hook of hookFiles(key)) {
    writeUnlessKept(ports, root, hook.rel, hook.text, force);
  }
  if (testServer === undefined) {
    ports.stdout("no stop gate installed\n");
  } else {
    writeUnlessKept(ports, root, STOP_REL, stopHookText(testServer), force);
    writeUnlessKept(ports, root, TURN_REL, turnHookText(), force);
  }
  if (policy === undefined) {
    ports.stdout(`kept ${REPLAY_REL} (exists; use --force)\n`);
  } else {
    writeFile(ports, root, REPLAY_REL, jsonText(policy));
  }
  if (gitignore.changed) {
    writeFile(ports, root, GITIGNORE_REL, gitignore.text);
  } else {
    ports.stdout(`kept ${GITIGNORE_REL} (already has the ignore rules)\n`);
  }
  if (options.commitJars === true) {
    ports.stdout("jars/ is committed: redaction rules apply — read .specimen/redact.json first\n");
  }

  const version = await ports.kiroVersion();
  if (version === undefined) {
    ports.stdout("kiro-cli not found on PATH — hooks are written but the headless commands need it\n");
  } else {
    ports.stdout(`${version}\n`);
    ports.stdout("headless commands pin --agent-engine v3\n");
  }
  ports.stdout(
    `next: restart the Kiro session, run your agent against ${key}, then: specimen replay --server "<your test instance command>"\n`,
  );
}

/** The real ports: node:fs, the terminal, a `kiro-cli --version` probe and the stdio client factory. */
export function createProcessInitPorts(): InitPorts {
  let terminal: Interface | undefined;
  return {
    cwd: () => process.cwd(),
    stdout: (text) => {
      process.stdout.write(text);
    },
    stderr: (text) => {
      process.stderr.write(text);
    },
    isTTY: process.stdin.isTTY === true,
    ask(question) {
      terminal ??= createInterface({ input: process.stdin, output: process.stdout });
      return terminal.question(question);
    },
    readText(path) {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return undefined;
      }
    },
    writeText(path, text) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    },
    kiroVersion: kiroCliVersion,
    clientFactory: (command, root) => makeStdioClientFactory(command, TEST_SERVER_TIMEOUT_MS, root),
    close() {
      terminal?.close();
    },
  };
}

const collect = (value: string, previous: string[]): string[] => [...previous, value];

/** The `init` subcommand. Usage errors are thrown to the caller so `run` can exit 2. */
export function createInitCommand(): Command {
  return new Command("init")
    .description("Set up SPECIMEN JAR in this repository: hooks, stop gate, replay policy and ignore rules")
    .option("--root <dir>", "repository root (default: the workspace root)")
    .option("--server-key <key>", "MCP server key, letters and digits only")
    .option("--mcp-command <cmd>", "command that starts the server, used only when mcp.json has no entry for the key")
    .option("--test-server <cmd>", "command that starts a disposable test instance of the server")
    .option("--allow <tool>", "tool that replay may call (repeatable)", collect, [])
    .option("--watch <glob>", "glob of the server source for replay.json (repeatable)", collect, [])
    .option("--commit-jars", "commit jars/ instead of ignoring it (redaction rules then apply)")
    .option("--force", "rewrite existing hook files and replay.json")
    .option("--yes", "allow every tool that the test server lists")
    .exitOverride()
    .action(async (options: InitOptions) => {
      const ports = createProcessInitPorts();
      try {
        process.exitCode = await runInit(options, ports);
      } finally {
        ports.close?.();
      }
    });
}
