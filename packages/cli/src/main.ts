import { Command, CommanderError } from "commander";
import { createFirewallCommand } from "./hooks/firewall.js";
import { captureCommand, isCaptureName, runCapture } from "./hooks/run.js";
import { createManifestGroup } from "./manifest.js";
import { createReplayCommand } from "./replay.js";
import { createCheckSpecCommand } from "./check-spec.js";
import { createFileCommand } from "./file.js";
import { createInitCommand } from "./init.js";
import { logDiag } from "./io/log.js";
import { nodeIO } from "./io/port.js";
import { findWorkspaceRoot } from "./io/root.js";

const SILENT = { writeOut: () => {}, writeErr: () => {} };

/**
 * The `specimen hook` command group. Output is silenced and errors are thrown instead of
 * exiting, so `run` can turn a bad argument into a logged exit 0. `pre` and `post` are listed
 * here for help output; `run` dispatches them before this group parses.
 */
export function createHookGroup(): Command {
  return new Command("hook")
    .description("Run a SPECIMEN JAR hook")
    .exitOverride()
    .configureOutput(SILENT)
    .addCommand(captureCommand("pre"))
    .addCommand(captureCommand("post"))
    .addCommand(createFirewallCommand());
}


/** Builds the `specimen` program. Has no side effects, so tests can call it directly. */
export function createProgram(): Command {
  return new Command()
    .name("specimen")
    .description("Record MCP tool calls as jars and replay them against a changed server.")
    .addCommand(createHookGroup())
    .addCommand(createManifestGroup())
    .addCommand(createReplayCommand())
    .addCommand(createCheckSpecCommand())
    .addCommand(createFileCommand())
    .addCommand(createInitCommand());
}

/**
 * Parses argv and runs the matching command. `argv` is the full process.argv array.
 * A bad argument to a hook command is logged and exits 0 with no output.
 */
export async function run(argv: readonly string[]): Promise<void> {
  const [, , group, name] = argv;
  if (group === "hook" && isCaptureName(name)) {
    process.exitCode = await runCapture(name, argv.slice(4), nodeIO);
    return;
  }
  try {
    await createProgram().parseAsync([...argv]);
  } catch (err) {
    if (
      err instanceof CommanderError &&
      (argv[2] === "replay" || argv[2] === "check-spec" || argv[2] === "file" || argv[2] === "init")
    ) {
      // A usage error of `replay`, `check-spec`, `file` or `init` (unknown option, missing argument) is exit 2. Help is exit 0.
      process.exitCode = err.exitCode === 0 ? 0 : 2;
      return;
    }
    if (!(err instanceof CommanderError) || argv[2] !== "hook") throw err;
    if (err.exitCode !== 0) {
      const hook = argv[3] === "firewall" ? "firewall" : "hook";
      logDiag(findWorkspaceRoot(process.cwd()), hook, undefined, "invalid argument");
    }
    process.exitCode = 0;
  }
}
