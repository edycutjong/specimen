/**
 * The `specimen replay` command (Requirement 10). It reads the inputs, replays the jars against
 * the `--server` process, computes the filed ids before the verdict, writes the Replay_Result and
 * the Quarantine_File, and prints the report or the JSON. The exit code is 0 for SHIP, 1 for HOLD,
 * 3 for a covered HOLD and 2 for a usage or operational error.
 */
import { resolve } from "node:path";
import { Command } from "commander";
import {
  buildReplayResultFields,
  buildReport,
  replay,
  replayResultSchema,
  verdict,
  type ReplayResult,
} from "@specimen/core";
import { findWorkspaceRoot } from "./io/root.js";
import { CommandSyntaxError, makeStdioClientFactory, splitCommand } from "./replay/client-factory.js";
import { formatLoadFailure, loadReplayInputs } from "./replay/load.js";
import { defaultResultPath, jsonText, replayFileName, serverLabelOf, writeQuarantine, writeReplayResult } from "./replay/write.js";
import { filedJarIds, readBugfixSpecs } from "./replay/spec-files.js";

/** Exit codes of `specimen replay` (Requirement 10 criteria 4 to 7). */
export const REPLAY_EXIT = { ship: 0, hold: 1, usage: 2, covered: 3 } as const;

/** The option values as commander gives them. */
export type ReplayOptions = {
  server: string;
  jars?: string;
  baseline?: string;
  strict?: boolean;
  json?: boolean;
  out?: string;
  timeout?: string;
};

/** The effects that `runReplay` needs from its surroundings. Tests may supply their own. */
export type ReplayIO = {
  stdout(text: string): void;
  stderr(text: string): void;
  cwd(): string;
  /** Milliseconds since the epoch. The engine's Clock is built from it. */
  now(): number;
};

export const processIO: ReplayIO = {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
  cwd: () => process.cwd(),
  now: () => Date.now(),
};

/** Prefix of the schema_diff error text when the Baseline_Server cannot start or list tools. */
const BASELINE_FAILED = "baseline failed:";

/** The usage check of the options. Returns the message of the first problem, or the parsed values. */
type Usage =
  | { ok: true; timeoutMs: number; server: string; baseline: string | undefined }
  | { ok: false; message: string };

/**
 * Validates `--server`, `--baseline` and `--timeout`. A command that is empty, has an unterminated
 * quote, or names no executable is a usage error. The Baseline_Server is optional.
 */
function checkUsage(options: ReplayOptions): Usage {
  const server = options.server.trim();
  if (server === "") return { ok: false, message: "--server must not be empty" };
  if (options.baseline !== undefined && options.baseline.trim() === "") {
    return { ok: false, message: "--baseline must not be empty" };
  }
  const timeout = options.timeout ?? "10000";
  if (!/^\d+$/.test(timeout) || Number(timeout) <= 0 || !Number.isSafeInteger(Number(timeout))) {
    return { ok: false, message: "--timeout must be a positive integer" };
  }

  for (const [flag, command] of [
    ["--server", options.server],
    ["--baseline", options.baseline],
  ] as const) {
    if (command === undefined) continue;
    try {
      const [executable] = splitCommand(command);
      if (executable === undefined || executable === "") {
        return { ok: false, message: `${flag} names no executable` };
      }
    } catch (err) {
      if (err instanceof CommandSyntaxError) return { ok: false, message: `${flag}: ${err.message}` };
      throw err;
    }
  }
  return { ok: true, timeoutMs: Number(timeout), server, baseline: options.baseline };
}

/**
 * Runs `specimen replay` and returns the exit code. Every failure that the user can act on is
 * written to STDERR and gives 2. Nothing is written when the inputs fail to load or the baseline
 * cannot start, so the caller never sees a partial Replay_Result.
 */
export async function runReplay(options: ReplayOptions, io: ReplayIO = processIO): Promise<number> {
  const usage = checkUsage(options);
  if (!usage.ok) {
    io.stderr(`specimen replay: ${usage.message}\n`);
    return REPLAY_EXIT.usage;
  }

  const cwd = io.cwd();
  const root = findWorkspaceRoot(cwd);
  const loaded = loadReplayInputs({
    root,
    jarsDir: options.jars === undefined ? undefined : resolve(cwd, options.jars),
  });
  if (!loaded.ok) {
    io.stderr(`${formatLoadFailure(loaded)}\n`);
    return REPLAY_EXIT.usage;
  }
  const inputs = loaded.inputs;
  const strict = options.strict === true;
  const serverLabel = serverLabelOf(usage.server);
  const clock = () => io.now();

  try {
    const startedAt = new Date(io.now()).toISOString();
    const outcome = await replay({
      jarFiles: inputs.jarFiles,
      pendingText: inputs.pendingText,
      replayPolicy: inputs.replayPolicy,
      volatilePolicy: inputs.volatilePolicy,
      redactConfig: inputs.compiledRedact,
      strict,
      clientFactory: makeStdioClientFactory(usage.server, usage.timeoutMs, root),
      baselineFactory:
        usage.baseline === undefined ? undefined : makeStdioClientFactory(usage.baseline, usage.timeoutMs, root),
      clock,
      serverLabel,
      startedAt,
      timeoutMs: usage.timeoutMs,
    });

    if (outcome.schemaDiffError?.startsWith(BASELINE_FAILED) === true) {
      io.stderr(`specimen replay: --baseline ${outcome.schemaDiffError}\n`);
      return REPLAY_EXIT.usage;
    }
    if (outcome.schemaDiffError !== undefined) {
      io.stderr(`specimen replay: ${outcome.schemaDiffError}\n`);
    }

    // The filed ids are computed from the Replay_Result entries before the verdict (Requirement 9.1).
    const filedIds = filedJarIds(readBugfixSpecs(root), outcome.resultEntries);
    const judged = verdict({
      entries: outcome.resultEntries,
      spoiledCount: outcome.spoiled.length,
      toolsListed: outcome.toolsListed,
      filedIds,
    });

    const result: ReplayResult = {
      ...buildReplayResultFields({ serverLabel, startedAt, strict }, outcome),
      verdict: judged.verdict,
      red: judged.red,
      filed: judged.filed,
      covered: judged.covered,
      reason: judged.reason,
      coverage: judged.coverage,
    };
    const parsed = replayResultSchema.safeParse(result);
    if (!parsed.success) {
      io.stderr("specimen replay: the Replay_Result failed its schema and was not written\n");
      return REPLAY_EXIT.usage;
    }

    const resultPath =
      options.out === undefined
        ? defaultResultPath(root, replayFileName(serverLabel, startedAt))
        : resolve(cwd, options.out);
    writeReplayResult(resultPath, parsed.data);
    writeQuarantine(root, parsed.data);

    io.stdout(options.json === true ? jsonText(parsed.data) : reportText(parsed.data, filedIds));
    return exitCodeOf(parsed.data);
  } catch (err) {
    io.stderr(`specimen replay: ${err instanceof Error ? err.message : String(err)}\n`);
    return REPLAY_EXIT.usage;
  }
}

/**
 * The text report of Requirement 10: the first line, one line per jar, the spoiled lines, and,
 * when the verdict is not covered, the ids of the Red_Jars that no spec files.
 */
function reportText(result: ReplayResult, filedIds: ReadonlySet<string>): string {
  const lines = buildReport(result);
  if (!result.covered && result.red > result.filed) {
    const unfiled = result.jars.flatMap((entry) =>
      (entry.state === "rattled" || entry.state === "cracked") && entry.id !== null && !filedIds.has(entry.id)
        ? [entry.id]
        : [],
    );
    lines.push(`not filed · ${unfiled.join(", ")}`);
  }
  return `${lines.join("\n")}\n`;
}

/** SHIP gives 0, a covered HOLD gives 3, and any other HOLD gives 1. */
function exitCodeOf(result: ReplayResult): number {
  if (result.verdict === "SHIP") return REPLAY_EXIT.ship;
  return result.covered ? REPLAY_EXIT.covered : REPLAY_EXIT.hold;
}

/** The `replay` command. Commander errors are turned into exit 2 by the caller in main.ts. */
export function createReplayCommand(): Command {
  return new Command("replay")
    .description("Replay recorded jars against a changed server and print a verdict")
    .requiredOption("--server <cmd>", "command that starts the server under test")
    .option("--jars <dir>", "directory of jar files (default: jars/ under the workspace root)")
    .option("--baseline <cmd>", "command that starts a baseline server, used only for tools/list")
    .option("--strict", "treat an added field as a rattle", false)
    .option("--json", "print only the Replay_Result as JSON on STDOUT", false)
    .option("--out <file>", "write the Replay_Result to this file instead of replays/")
    .option("--timeout <ms>", "per-request timeout in milliseconds", "10000")
    .exitOverride()
    .action(async (options: ReplayOptions) => {
      process.exitCode = await runReplay(options);
    });
}
