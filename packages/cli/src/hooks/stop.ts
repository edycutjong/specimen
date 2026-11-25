/**
 * `specimen hook stop --server <cmd>`: the Agent Stop gate. When the agent finishes a turn that
 * changed the watched server and a replayed jar is still red with no filed bugfix spec, the gate
 * blocks the stop once. Kiro then sends the reason to the agent as one more turn.
 *
 * The gate fails open. Every error, a missing or unparseable replay, and a killed hook all let the
 * agent stop. Only a block prints anything on STDOUT.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { z } from "zod";
import {
  decideStop,
  filedJarIds,
  replayResultSchema,
  validSessionId,
  type ReplayResult,
} from "@specimen/core";
import { readText, specimenFile, writeAtomic } from "../io/fsx.js";
import { describeError, logDiag } from "../io/log.js";
import { nodeFs } from "../io/port.js";
import { readStdin } from "../io/stdin.js";
import { findWorkspaceRoot } from "../io/root.js";
import { readBugfixSpecs } from "../replay/spec-files.js";
import { runReplay, type ReplayIO, type ReplayOptions } from "../replay.js";
import { makeStdioClientFactory } from "../replay/client-factory.js";
import { parsePayload, workspaceFor } from "./prepare.js";
import { readTurnSnapshot, turnPayloadSchema, watchGlobs, watchHash } from "./prompt.js";

const HOOK = "stop";

/** The number of blocks a session gets before the gate lets the agent stop. */
export const MAX_BLOCKS = 3;

/** Content of `.specimen/gate-<session>.json`. */
const gateSchema = z.strictObject({
  session_id: z.string(),
  blocks: z.number().int().nonnegative(),
});

/** The per-request timeout of the start probe, the same default that `specimen replay` uses. */
const PROBE_TIMEOUT_MS = 10_000;

/** The effects of the gate: STDIN, the probe, the replay and STDOUT. Tests supply their own. */
export type StopPorts = {
  readStdin(): Promise<string>;
  /**
   * Starts the server once and lists its tools. Rejects when the server cannot start or cannot
   * list its tools. A replay cannot tell that apart from a server that lost every tool, because
   * both leave each jar cracked, so the gate checks the start first.
   */
  probe(server: string, root: string): Promise<void>;
  replay(options: ReplayOptions, io: ReplayIO): Promise<number>;
  stdout(text: string): void;
};

export const nodeStopPorts: StopPorts = {
  readStdin,
  probe: async (server, root) => {
    const session = await makeStdioClientFactory(server, PROBE_TIMEOUT_MS, root)();
    try {
      await session.client.listTools(undefined, { timeout: PROBE_TIMEOUT_MS });
    } finally {
      await session.close().catch(() => undefined);
    }
  },
  replay: runReplay,
  stdout: (text) => {
    process.stdout.write(text);
  },
};

/** Exit codes of `specimen replay` that still produce a Replay_Result: SHIP, HOLD and covered HOLD. */
const RESULT_EXIT_CODES = new Set([0, 1, 3]);

/**
 * True when the watched server changed since the turn snapshot. A missing, corrupt or foreign
 * snapshot cannot be compared, so the change counts as made. That fails towards checking.
 */
function changedThisTurn(root: string, sessionId: string): boolean {
  const turn = readTurnSnapshot(root);
  if (turn === undefined || turn.session_id !== sessionId) return true;
  // The turn's own head is used, so a commit made during the turn still counts as a change.
  return watchHash(root, watchGlobs(root), turn.head) !== turn.watch;
}

/**
 * Runs the replay in JSON mode and returns its Replay_Result. The result is written to a
 * temporary folder that is removed afterwards, so `replays/` is not touched. Returns undefined
 * when the replay cannot start, exits with a usage error, or prints a document that fails its
 * schema.
 */
async function replayResult(root: string, server: string, ports: StopPorts): Promise<ReplayResult | undefined> {
  const dir = mkdtempSync(join(tmpdir(), "specimen-gate-"));
  let stdout = "";
  try {
    const io: ReplayIO = {
      stdout: (text) => {
        stdout += text;
      },
      stderr: () => {},
      cwd: () => root,
      now: () => Date.now(),
    };
    const code = await ports.replay({ server, json: true, out: join(dir, "result.json") }, io);
    if (!RESULT_EXIT_CODES.has(code)) return undefined;
    const parsed = replayResultSchema.safeParse(JSON.parse(stdout));
    return parsed.success ? parsed.data : undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The number of blocks already issued in this session. A missing file counts as zero. */
function blocksIssued(root: string, sessionId: string): number {
  const text = readText(gatePath(root, sessionId));
  if (text === undefined) return 0;
  const parsed = gateSchema.parse(JSON.parse(text));
  if (parsed.session_id !== sessionId) throw new Error("gate file belongs to another session");
  return parsed.blocks;
}

function gatePath(root: string, sessionId: string): string {
  return specimenFile(root, `gate-${sessionId}.json`);
}

/**
 * Runs the Stop gate and returns 0. It returns 0 in every case, and it prints only a block
 * decision. `server` is the `--server` command that starts the disposable test instance.
 */
export async function runStop(server: string, ports: StopPorts = nodeStopPorts): Promise<number> {
  // `specimen file` starts the curator with SPECIMEN_GATE=off: the gate is for the agent that edits the server, and
  // it must not send the curator's own turn back (measured in evidence/stop-gate/live-shell.md before this switch).
  if (process.env.SPECIMEN_GATE === "off") return 0;
  let root = findWorkspaceRoot(process.cwd());
  let sessionId: string | undefined;
  try {
    const parsed = parsePayload(await ports.readStdin(), turnPayloadSchema);
    if (!parsed.ok) {
      logDiag(root, HOOK, undefined, parsed.message);
      return 0;
    }
    root = workspaceFor(parsed.data.cwd);
    if (!validSessionId(parsed.data.session_id)) {
      logDiag(root, HOOK, undefined, "session_id invalid");
      return 0;
    }
    sessionId = parsed.data.session_id;

    if (!changedThisTurn(root, sessionId)) return 0;

    try {
      await ports.probe(server, root);
    } catch (err) {
      logDiag(root, HOOK, sessionId, `server did not start: ${describeError(err)}`);
      return 0;
    }

    const result = await replayResult(root, server, ports);
    if (result === undefined) {
      logDiag(root, HOOK, sessionId, "replay did not produce a Replay_Result");
      return 0;
    }

    const filed = filedJarIds(readBugfixSpecs(root), result.jars);
    const redIds = result.jars
      .filter((jar) => (jar.state === "rattled" || jar.state === "cracked") && jar.id !== null)
      .map((jar) => jar.id as string);
    const unfiledIds = redIds.filter((id) => !filed.has(id));

    const blocksSoFar = blocksIssued(root, sessionId);
    const decision = decideStop({
      changedThisTurn: true,
      verdict: result,
      redIds,
      unfiledIds,
      blocksSoFar,
      maxBlocks: MAX_BLOCKS,
    });

    if (decision.action === "block") {
      writeAtomic(gatePath(root, sessionId), `${JSON.stringify({ session_id: sessionId, blocks: blocksSoFar + 1 }, null, 2)}\n`);
      ports.stdout(`${JSON.stringify({ decision: "block", reason: decision.reason })}\n`);
    } else if ("unresolved" in decision) {
      nodeFs.appendText(
        specimenFile(root, "unresolved.md"),
        `## ${new Date().toISOString()}\n\nsession: ${sessionId}\n\n${decision.unresolved}\n\n`,
      );
    }
  } catch (err) {
    logDiag(root, HOOK, sessionId, `unexpected ${describeError(err)}`);
  }
  return 0;
}

/** The `specimen hook stop` command. Silent on STDOUT except for a block decision. */
export function createStopCommand(): Command {
  return new Command("stop")
    .description("Stop gate: block a turn that changed the server and left a red jar unfiled")
    .requiredOption("--server <cmd>", "command that starts a disposable test instance of the server")
    .exitOverride()
    .configureOutput({ writeOut: () => {}, writeErr: () => {} })
    .action(async (options: { server: string }) => {
      process.exitCode = await runStop(options.server);
    });
}
