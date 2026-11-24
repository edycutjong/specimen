/**
 * The `specimen check-spec` command (replay-engine Requirement 11). It reads one Bugfix_Spec and
 * one Replay_Result, runs the Spec_Checker for one jar and prints `PASS <id>` or one
 * `FAIL <code>: <message>` line per failure. It writes no file and never modifies the spec.
 * Exit codes: 0 for PASS, 1 for FAIL, 2 for a missing or invalid input.
 */
import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { checkSpec, replayResultSchema, selectLatestReplay } from "@specimen/core";
import { findWorkspaceRoot } from "./io/root.js";

/** Exit codes of `specimen check-spec` (Requirement 11 criteria 3 to 5). */
export const CHECK_SPEC_EXIT = { pass: 0, fail: 1, usage: 2 } as const;

/** The option values as commander gives them. */
export type CheckSpecOptions = {
  jar?: string;
  replay?: string;
};

/** The effects that `runCheckSpec` needs from its surroundings. Tests may supply their own. */
export type CheckSpecIO = {
  stdout(text: string): void;
  stderr(text: string): void;
  cwd(): string;
};

export const processCheckSpecIO: CheckSpecIO = {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
  cwd: () => process.cwd(),
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

/** Writes one diagnostic to STDERR and returns the usage exit code. */
function usage(io: CheckSpecIO, message: string): number {
  io.stderr(`specimen check-spec: ${message}\n`);
  return CHECK_SPEC_EXIT.usage;
}

/**
 * Runs the check for `bugfix` (a path relative to the working directory) against the jar named
 * in `options.jar`. The Replay_Result is `options.replay`, or the newest file in `replays/`.
 */
export function runCheckSpec(
  bugfix: string,
  options: CheckSpecOptions,
  io: CheckSpecIO = processCheckSpecIO,
): number {
  const cwd = io.cwd();
  const root = findWorkspaceRoot(cwd);

  const jar = options.jar?.trim() ?? "";
  if (jar === "") return usage(io, "--jar <id> is required");

  const specText = readOrUndefined(resolve(cwd, bugfix));
  if (specText === undefined) return usage(io, `cannot read Bugfix_Spec ${bugfix}`);

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

  if (!result.jars.some((entry) => entry.id === jar)) {
    return usage(io, `jar ${jar} is not in the Replay_Result ${replayPath}`);
  }

  const outcome = checkSpec(specText, jar, result.jars);
  if (outcome === "pass") {
    io.stdout(`PASS ${jar}\n`);
    return CHECK_SPEC_EXIT.pass;
  }
  for (const failure of outcome) {
    io.stdout(`FAIL ${failure.code}: ${failure.message}\n`);
  }
  return CHECK_SPEC_EXIT.fail;
}

/** The `check-spec` subcommand. Usage errors are thrown to the caller so `run` can exit 2. */
export function createCheckSpecCommand(): Command {
  return new Command("check-spec")
    .description("Run the bugfix spec check for one jar against a Replay_Result")
    .argument("<bugfix>", "path of the Bugfix_Spec (bugfix.md)")
    .option("--jar <id>", "the jar id the spec must cover")
    .option("--replay <file>", "Replay_Result file (default: the newest file in replays/)")
    .exitOverride()
    .action((bugfix: string, options: CheckSpecOptions) => {
      process.exitCode = runCheckSpec(bugfix, options);
    });
}
