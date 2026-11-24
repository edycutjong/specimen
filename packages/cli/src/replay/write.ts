/**
 * Writes the files of `specimen replay`: the Replay_Result (`replays/<server>-<iso>.json` or the
 * `--out` file) and the Quarantine_File (`.specimen/quarantine.json`). Both are validated with
 * their zod schemas before anything is written, so an invalid document never reaches disk.
 * Nothing else is written here.
 */
import { join } from "node:path";
import {
  quarantineFileSchema,
  replayResultSchema,
  type QuarantineFile,
  type ReplayResult,
} from "@specimen/core";
import { specimenFile, writeAtomic } from "../io/fsx.js";

/** The characters a server label may hold. Every other character is replaced by "-". */
const LABEL_CHARS = /^[A-Za-z0-9._-]+$/;

/** `YYYY-MM-DDTHH:mm:ss.sssZ`, the only time form that `started_at` may take. */
const STARTED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** A document that failed its schema, or a name that cannot be written. The message names the cause. */
export class ReplayWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayWriteError";
  }
}

/**
 * The server label of a `--server` command: every character outside `[A-Za-z0-9._-]` becomes
 * "-". The label is used in the Replay_Result and in the file name.
 */
export function serverLabelOf(command: string): string {
  return command.replace(/[^A-Za-z0-9._-]/g, "-");
}

/**
 * The default Replay_Result file name, `<server>-<iso>.json`. The `:` characters of `startedAt`
 * become "-", so the time part is 24 characters long, as `check-spec` expects.
 */
export function replayFileName(server: string, startedAt: string): string {
  if (!LABEL_CHARS.test(server)) {
    throw new ReplayWriteError("the server label holds characters outside [A-Za-z0-9._-]");
  }
  if (!STARTED_AT.test(startedAt)) {
    throw new ReplayWriteError("started_at is not in the form YYYY-MM-DDTHH:mm:ss.sssZ");
  }
  return `${server}-${startedAt.replace(/:/g, "-")}.json`;
}

/** Pretty-printed JSON with a terminating newline. */
export function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** The Quarantine_File of a Replay_Result: one item per unsealed entry, in Replay_Result order. */
export function quarantineOf(result: ReplayResult): QuarantineFile {
  const items = result.jars
    .filter((entry) => entry.state === "unsealed")
    .map((entry) => ({
      id: entry.id,
      session_id: entry.session_id,
      seq: entry.seq,
      tool: entry.tool,
      reason: entry.reason ?? "unsealed",
    }));
  return { v: 1, items };
}

/**
 * Writes the Replay_Result to `path`, creating the parent directory. The document is validated
 * first. An invalid document throws ReplayWriteError and nothing is written.
 */
export function writeReplayResult(path: string, result: ReplayResult): void {
  const parsed = replayResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new ReplayWriteError(`the Replay_Result is invalid: ${parsed.error.issues[0]?.path.join(".") ?? "root"}`);
  }
  writeAtomic(path, jsonText(parsed.data));
}

/**
 * Replaces `<root>/.specimen/quarantine.json` with the Quarantine_File of `result`. An empty
 * `items` list is written when no jar is unsealed, so a stale file never remains.
 */
export function writeQuarantine(root: string, result: ReplayResult): QuarantineFile {
  const quarantine = quarantineOf(result);
  const parsed = quarantineFileSchema.safeParse(quarantine);
  if (!parsed.success) {
    throw new ReplayWriteError("the Quarantine_File is invalid");
  }
  writeAtomic(specimenFile(root, "quarantine.json"), jsonText(parsed.data));
  return parsed.data;
}

/** The default path of a Replay_Result under the Workspace_Root. */
export function defaultResultPath(root: string, fileName: string): string {
  return join(root, "replays", fileName);
}
