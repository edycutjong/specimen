/**
 * The `specimen file <jar-id>` command. It files one Bugfix_Spec for a rattled or cracked jar. The
 * CLI writes a skeleton with the Repro_Block copied from the Replay_Result, then runs the
 * `specimen-curator` agent through `kiro-cli` to write the prose. Afterwards it checks the marked
 * block byte for byte and runs the Spec_Checker for every jar of the signature group.
 *
 * Exit codes: 0 filed, 2 usage or invalid input, 20 rejected after one retry, 21 curator timed out,
 * 22 kiro-cli failed.
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
  type Dirent,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Command } from "commander";
import {
  canonicalJson,
  checkSpec,
  referenceOf,
  replayResultSchema,
  selectLatestReplay,
  type Failure,
  type Json,
  type ResultEntry,
} from "@specimen/core";
import { findWorkspaceRoot } from "./io/root.js";

/** Exit codes of `specimen file`. */
export const FILE_EXIT = { filed: 0, usage: 2, rejected: 20, timeout: 21, kiroFailed: 22 } as const;

const DEFAULT_TIMEOUT_SECONDS = 300;
const SLUG_MAX = 48;
const CURATOR_AGENT = "specimen-curator";
const REJECTED_NAME = "bugfix.rejected.md";

/** The reason the replay engine gives a jar whose tool is not in the server's tools/list. */
const MISSING_TOOL_REASON = "tool not in tools/list";
const MARKER_START = "<!-- specimen:repro:start -->";
const MARKER_END = "<!-- specimen:repro:end -->";

/** The option values as commander gives them. */
export type FileOptions = {
  dryRun?: boolean;
  replay?: string;
  timeout?: string;
};

/** The effects that `runFile` needs from its surroundings. Tests supply their own. */
export type FileIO = {
  stdout(text: string): void;
  stderr(text: string): void;
  cwd(): string;
};

export const processFileIO: FileIO = {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
  cwd: () => process.cwd(),
};

/** One `kiro-cli` invocation: the program, its arguments, the working directory and the limit. */
export type KiroCall = { command: string; args: string[]; cwd: string; timeoutMs: number };

/** The outcome of one `kiro-cli` invocation. `exitCode` is null when the process was killed or never started. */
export type KiroRun = { exitCode: number | null; stderr: string; timedOut: boolean };

/** Runs one `kiro-cli` invocation. Tests pass a fake, so the real CLI is never started in tests. */
export type KiroRunner = (call: KiroCall) => Promise<KiroRun>;

/** The real runner. It kills the process when the time limit passes and reports `timedOut`. */
export const spawnKiro: KiroRunner = (call) =>
  new Promise((resolvePromise) => {
    let stderr = "";
    let settled = false;
    const settle = (run: KiroRun): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(run);
    };
    const child = spawn(call.command, call.args, { cwd: call.cwd, stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, SPECIMEN_GATE: "off" } });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle({ exitCode: null, stderr, timedOut: true });
    }, call.timeoutMs);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) => settle({ exitCode: null, stderr: err.message, timedOut: false }));
    child.on("close", (code) => settle({ exitCode: code, stderr, timedOut: false }));
  });

/** One failed check, tied to the jar it was run for. */
export type Finding = { id: string; code: string; message: string };

/** The inputs of the curator prompt. */
export type CuratorInput = {
  filePath: string;
  server: string;
  tool: string;
  state: "rattled" | "cracked";
  group: readonly ResultEntry[];
  preserved: readonly ResultEntry[];
  failures?: readonly Finding[];
};

/** Reads a file as UTF-8 text. Returns undefined when the file is missing or cannot be read. */
function readOrUndefined(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** The newest `<server>-<iso>.json` file in `<root>/replays`, or undefined when none exists. */
function latestReplayPath(root: string): string | undefined {
  const dir = join(root, "replays");
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const name = selectLatestReplay(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  return name === undefined ? undefined : join(dir, name);
}

/** Writes one diagnostic line to STDERR and returns the usage exit code. */
function usage(io: FileIO, message: string): number {
  io.stderr(`specimen file: ${message}\n`);
  return FILE_EXIT.usage;
}

/** The changed paths of an entry, sorted. A cracked jar has none. */
function pathsOf(entry: ResultEntry): string[] {
  return entry.state === "cracked" ? [] : entry.changes.map((change) => change.path).sort();
}

/**
 * The file name slug: the tool name followed by the sorted changed paths, in kebab case. A cracked
 * group uses `<tool>-missing-tool`. The result is at most 48 characters.
 */
export function specSlug(tool: string, state: "rattled" | "cracked", paths: readonly string[]): string {
  const raw = state === "cracked" ? `${tool} missing-tool` : [tool, ...paths].join(" ");
  const kebab = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return kebab.slice(0, SLUG_MAX).replace(/-+$/, "");
}

/**
 * The signature group of `target`: every entry with an id, the same tool and state, and the same
 * changed path set, in Replay_Result order. The target is always a member.
 */
export function signatureGroup(jars: readonly ResultEntry[], target: ResultEntry): ResultEntry[] {
  const key = JSON.stringify(pathsOf(target));
  return jars.filter(
    (jar) =>
      jar.id !== null &&
      jar.tool === target.tool &&
      jar.state === target.state &&
      (jar.state !== "cracked" || jar.reason === target.reason) &&
      JSON.stringify(pathsOf(jar)) === key,
  );
}

/** Escapes a value for one markdown table cell. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

/**
 * The skeleton Bugfix_Spec for a group. The text between the repro markers is generated from the
 * entries by code and must reappear byte for byte after the curator has written the prose.
 */
export function buildSkeleton(group: readonly ResultEntry[]): string {
  const repro = group.map((entry) => ({
    id: entry.id,
    input: entry.input,
    response_text: entry.response_text,
    replayed: entry.replayed,
    changed_paths: entry.changes.map((change) => change.path),
  }));
  const rows = group.flatMap((entry) =>
    entry.changes.map(
      (change) => `| ${cell(entry.id ?? "")} | ${cell(change.path)} | ${change.kind} | ${cell(change.note ?? "-")} |`,
    ),
  );
  const lines = [
    "# Bugfix Requirements Document",
    "",
    "## Introduction",
    "",
    MARKER_START,
    "```json specimen-repro",
    JSON.stringify(repro, null, 2),
    "```",
    "",
    "| jar | path | kind | note |",
    "|---|---|---|---|",
    ...rows,
    "",
    MARKER_END,
    "",
    "## Bug Analysis",
    "",
    "### Current Behavior (Defect)",
    "",
    "### Expected Behavior (Correct)",
    "",
    "### Unchanged Behavior (Regression Prevention)",
    "",
  ];
  return lines.join("\n") + "\n";
}

/** The text between the two repro markers, or undefined when the markers are not exactly one pair. */
function markedBlock(text: string): string | undefined {
  const start = text.indexOf(MARKER_START);
  const end = text.indexOf(MARKER_END);
  if (start < 0 || end < 0 || end < start) return undefined;
  if (text.indexOf(MARKER_START, start + 1) >= 0 || text.indexOf(MARKER_END, end + 1) >= 0) return undefined;
  return text.slice(start + MARKER_START.length, end);
}

/** The Reference of one jar as prose: each element names the path and the recorded literal, or the removed item or the tool. */
function referenceText(entry: ResultEntry): string {
  try {
    const parts = referenceOf(entry).map((element) => {
      switch (element.kind) {
        case "path-literal":
          return `${element.path} with recorded value ${element.literal}`;
        case "path":
          return element.path;
        case "key":
          return `removed array item ${element.key}`;
        case "tool":
          return `missing tool ${element.tool}`;
      }
    });
    return parts.length === 0 ? "no reference element" : parts.join("; ");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `reference unavailable (${detail})`;
  }
}

/** The curator prompt. It is a pure function of its input. */
export function buildCuratorPrompt(input: CuratorInput): string {
  const lines: string[] = [
    `Write the Bugfix_Spec at ${input.filePath}.`,
    "The repro block between the markers was written by the specimen CLI: keep it byte for byte. Write the Introduction sentences above it and numbered lines under the three headings below it. Follow specimen-bugfix.md.",
    "",
    `Server: ${input.server}`,
    `Tool: ${input.tool}`,
    `State: ${input.state}`,
    `Jar ids: ${input.group.map((entry) => entry.id ?? "").join(", ")}`,
    "",
    "Changes:",
  ];
  for (const entry of input.group) {
    const id = entry.id ?? "";
    if (entry.changes.length === 0) lines.push(`- ${id} · no changes recorded`);
    for (const change of entry.changes) {
      lines.push(`- ${id} · ${change.path} · ${change.kind} · ${change.note ?? "-"}`);
    }
  }
  lines.push("", "Expected Behavior must restore:");
  for (const entry of input.group) {
    lines.push(`- ${entry.id ?? ""}: ${referenceText(entry)}`);
  }
  lines.push("", "Unchanged Behavior names these preserved jars:");
  if (input.preserved.length === 0) {
    lines.push(`no preserved jar of ${input.tool} was recorded`);
  }
  for (const jar of input.preserved) {
    lines.push(`- ${jar.id ?? ""} · input ${canonicalJson(jar.input as Json)}`);
  }
  if (input.failures !== undefined && input.failures.length > 0) {
    lines.push("", "The previous attempt failed these checks. Fix each one:");
    for (const failure of input.failures) {
      lines.push(`FAIL ${failure.id} ${failure.code}: ${failure.message}`);
    }
  }
  return lines.join("\n");
}

/**
 * The findings of one attempt: a changed repro block, and every Spec_Checker failure of each jar of
 * the group. An empty list means the spec is filed.
 */
function verify(
  text: string | undefined,
  skeleton: string,
  group: readonly ResultEntry[],
  jars: ResultEntry[],
): Finding[] {
  const findings: Finding[] = [];
  const expected = markedBlock(skeleton);
  const actual = text === undefined ? undefined : markedBlock(text);
  if (actual !== expected) {
    for (const entry of group) {
      findings.push({
        id: entry.id ?? "",
        code: "repro_block_edited",
        message: "repro block between the markers differs from the CLI skeleton",
      });
    }
  }
  for (const entry of group) {
    const outcome = checkSpec(text ?? "", entry.id ?? "", jars);
    if (outcome === "pass") continue;
    for (const failure of outcome as Failure[]) {
      findings.push({ id: entry.id ?? "", code: failure.code, message: failure.message });
    }
  }
  return findings;
}

/** The --timeout value in seconds, or undefined when it is not a positive number. */
function timeoutSeconds(value: string | undefined): number | undefined {
  if (value === undefined) return DEFAULT_TIMEOUT_SECONDS;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/**
 * Removes the skeleton when the curator never ran to completion, so "no spec written" stays true:
 * the file goes, and its folder too when nothing else is in it.
 */
function discardSkeleton(specPath: string): void {
  rmSync(specPath, { force: true });
  try {
    rmdirSync(dirname(specPath));
  } catch {
    // The folder still holds other files, or is already gone: leave it.
  }
}

/**
 * Runs `specimen file <jar-id>`. The Replay_Result is `options.replay`, or the newest file in
 * `replays/`. Paths are relative to the working directory, and the spec is written under the
 * workspace root.
 */
export async function runFile(
  jarId: string,
  options: FileOptions,
  io: FileIO = processFileIO,
  runner: KiroRunner = spawnKiro,
): Promise<number> {
  const cwd = io.cwd();
  const root = findWorkspaceRoot(cwd);

  const seconds = timeoutSeconds(options.timeout);
  if (seconds === undefined) return usage(io, "--timeout must be a positive number of seconds");

  const replayPath = options.replay !== undefined ? resolve(cwd, options.replay) : latestReplayPath(root);
  if (replayPath === undefined) {
    return usage(io, "no file in replays/ matches <server>-<iso>.json; pass --replay <file>");
  }
  const replayText = readOrUndefined(replayPath);
  if (replayText === undefined) return usage(io, `cannot read Replay_Result ${replayPath}`);

  let json: unknown;
  try {
    json = JSON.parse(replayText);
  } catch {
    return usage(io, `Replay_Result ${replayPath} is not JSON`);
  }
  const parsed = replayResultSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue === undefined ? "" : issue.path.map(String).join(".");
    const why = issue?.message ?? "unknown problem";
    return usage(io, `Replay_Result ${replayPath} fails its schema at ${where || "(root)"}: ${why}`);
  }
  const result = parsed.data;

  const target = result.jars.find((jar) => jar.id === jarId);
  if (target === undefined) return usage(io, `jar ${jarId} is not in the Replay_Result ${replayPath}`);
  if (target.state !== "rattled" && target.state !== "cracked") {
    return usage(io, `jar ${jarId} is ${target.state}, not rattled or cracked`);
  }

  // A cracked jar is filed only as a missing tool, the one crack the replay proves from tools/list. A
  // start failure, a timeout, a dead session or an error result is not a missing tool, and a spec that
  // said so would invent the root cause (a2a round 05).
  if (target.state === "cracked" && target.reason !== MISSING_TOOL_REASON) {
    const cause = target.error ?? target.reason ?? "no cause recorded";
    return usage(
      io,
      `jar ${jarId} is cracked by "${cause}", not by a tool missing from tools/list — only a missing tool is filed as a cracked jar; check the server start or re-run the replay`,
    );
  }

  const state: "rattled" | "cracked" = target.state;
  const group = signatureGroup(result.jars, target);
  const preserved = result.jars.filter((jar) => jar.state === "preserved" && jar.tool === target.tool && jar.id !== null);
  const slug = specSlug(target.tool, state, pathsOf(target));
  const relPath = `.kiro/specs/${slug}/bugfix.md`;
  const specPath = join(root, relPath);
  const skeleton = buildSkeleton(group);
  const promptFor = (failures?: readonly Finding[]): string =>
    buildCuratorPrompt({
      filePath: relPath,
      server: result.server,
      tool: target.tool,
      state,
      group,
      preserved,
      failures,
    });

  if (options.dryRun === true) {
    io.stdout(`${skeleton}\n--- curator prompt ---\n${promptFor()}\n`);
    return FILE_EXIT.filed;
  }

  // A filed spec is never overwritten: a failed or rejected re-run would otherwise replace it and then
  // delete or rename it (a2a round 05).
  if (existsSync(specPath)) {
    return usage(io, `${relPath} already exists — a filed spec is never overwritten; move it away first to file it again`);
  }
  mkdirSync(dirname(specPath), { recursive: true });
  writeFileSync(specPath, skeleton);

  /** One curator run. Returns the exit code to stop with, or undefined when the run finished. */
  const curate = async (failures?: readonly Finding[]): Promise<number | undefined> => {
    const run = await runner({
      command: "kiro-cli",
      args: [
        "chat",
        "--no-interactive",
        "--agent-engine",
        "v3",
        "--trust-workspace",
        "--agent",
        CURATOR_AGENT,
        promptFor(failures),
      ],
      cwd: root,
      timeoutMs: seconds * 1000,
    });
    if (run.timedOut || run.exitCode !== 0) discardSkeleton(specPath);
    if (run.timedOut) {
      io.stderr(`specimen file: curator timed out after ${seconds} s — no spec written\n`);
      return FILE_EXIT.timeout;
    }
    if (run.exitCode !== 0) {
      const detail = run.stderr === "" || run.stderr.endsWith("\n") ? run.stderr : `${run.stderr}\n`;
      io.stderr(`specimen file: kiro-cli failed with exit code ${run.exitCode ?? "none"}\n${detail}`);
      return FILE_EXIT.kiroFailed;
    }
    return undefined;
  };

  const first = await curate();
  if (first !== undefined) return first;
  let findings = verify(readOrUndefined(specPath), skeleton, group, result.jars);

  if (findings.length > 0) {
    writeFileSync(specPath, skeleton);
    const second = await curate(findings);
    if (second !== undefined) return second;
    findings = verify(readOrUndefined(specPath), skeleton, group, result.jars);
  }

  if (findings.length > 0) {
    if (existsSync(specPath)) renameSync(specPath, join(dirname(specPath), REJECTED_NAME));
    for (const finding of findings) {
      io.stdout(`FAIL ${finding.id} ${finding.code}: ${finding.message}\n`);
    }
    return FILE_EXIT.rejected;
  }

  const ids = group.map((entry) => entry.id ?? "").join(", ");
  io.stdout(`filed ${relative(root, specPath)} · PASS ${ids}\n`);
  return FILE_EXIT.filed;
}

/** The `file` subcommand. Usage errors are thrown to the caller so `run` can exit 2. */
export function createFileCommand(): Command {
  return new Command("file")
    .description("File a Bugfix_Spec for one rattled or cracked jar through the specimen-curator agent")
    .argument("<jar-id>", "the jar id to file")
    .option("--dry-run", "print the skeleton and the curator prompt; write and run nothing")
    .option("--replay <file>", "Replay_Result file (default: the newest file in replays/)")
    .option("--timeout <seconds>", `seconds to wait for each curator run (default ${DEFAULT_TIMEOUT_SECONDS})`)
    .exitOverride()
    .action(async (jarId: string, options: FileOptions) => {
      process.exitCode = await runFile(jarId, options);
    });
}
