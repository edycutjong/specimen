import { Command, CommanderError } from "commander";
import { logDiag, describeError } from "../io/log.js";
import type { HookIO } from "../io/port.js";
import { findWorkspaceRoot } from "../io/root.js";
import { runPost } from "./post.js";
import { runPre } from "./pre.js";
import type { CaptureName } from "./prepare.js";

const SILENT = { writeOut: () => {}, writeErr: () => {} };

export function isCaptureName(name: string | undefined): name is CaptureName {
  return name === "pre" || name === "post";
}

/**
 * The `pre` or `post` command with its `--server` option. It has no action of its own:
 * `run` dispatches the capture hooks before commander runs them, so `runCapture` is the only
 * place a capture hook executes. Errors are thrown here, not printed.
 */
export function captureCommand(name: CaptureName): Command {
  const description =
    name === "pre"
      ? "Record the start of an MCP tool call (PreToolUse)"
      : "Record the response of an MCP tool call (PostToolUse)";
  return new Command(name)
    .description(description)
    .option("--server <key>", "configured MCP server key that owns the tool")
    .exitOverride()
    .configureOutput(SILENT);
}

/** Called once for each attempted write to STDOUT or STDERR during a capture run. Tests use it to see output that was silenced. */
export type StdioObserver = (stream: "stdout" | "stderr") => void;

/** Replaces the process stdout and stderr writers with no-ops. Returns a function that restores them. */
function silenceStdio(observe?: StdioObserver): () => void {
  const out = process.stdout.write;
  const err = process.stderr.write;
  process.stdout.write = (() => {
    observe?.("stdout");
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = (() => {
    observe?.("stderr");
    return true;
  }) as typeof process.stderr.write;
  return () => {
    process.stdout.write = out;
    process.stderr.write = err;
  };
}

/**
 * Runs one capture hook with its arguments (the words after `hook <name>`). Always resolves to
 * 0 and writes nothing to STDOUT or STDERR. Every failure is written to the Hook_Log as a fixed
 * message: `invalid argument` for a bad command line, or the error name and errno code for an
 * unexpected failure. The message of the error is never logged, because it can quote input.
 * `observe`, when given, is told about every write attempt that the silencing intercepts.
 */
export async function runCapture(
  name: CaptureName,
  argv: readonly string[],
  io: HookIO,
  observe?: StdioObserver,
): Promise<number> {
  const restore = silenceStdio(observe);
  try {
    const command = captureCommand(name);
    command.parse([...argv], { from: "user" });
    const server = command.opts<{ server?: string }>().server;
    if (name === "pre") await runPre(io, server);
    else await runPost(io, server);
  } catch (err) {
    const root = findWorkspaceRoot(process.cwd());
    if (err instanceof CommanderError) {
      // --help and --version exit 0 and are not errors.
      if (err.exitCode !== 0) logDiag(root, name, undefined, "invalid argument");
    } else {
      logDiag(root, name, undefined, `unexpected ${describeError(err)}`);
    }
  } finally {
    restore();
  }
  return 0;
}
