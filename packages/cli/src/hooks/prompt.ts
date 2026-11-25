/**
 * `specimen hook prompt`: the turn snapshot. On a UserPromptSubmit it writes `.specimen/turn.json`
 * with the HEAD and the watch hash at the start of the turn. The Stop gate compares the hash at
 * the end of the turn with this snapshot to learn whether the server changed during the turn.
 *
 * STDOUT stays empty, because the UserPromptSubmit output is added to the agent's context. Every
 * failure goes to the Hook_Log and the hook exits 0.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { z } from "zod";
import { replayPolicySchema, sha256Hex, validSessionId } from "@specimen/core";
import { readText, specimenFile, writeAtomic } from "../io/fsx.js";
import { describeError, logDiag } from "../io/log.js";
import { readStdin } from "../io/stdin.js";
import { parsePayload, workspaceFor } from "./prepare.js";

const HOOK = "prompt";

/** The watch globs when `.specimen/replay.json` names none. */
export const DEFAULT_WATCH = ["servers/**"] as const;

/** The fields the prompt and stop hooks read from their payloads. Other keys are allowed. */
export const turnPayloadSchema = z.looseObject({
  session_id: z.string(),
  cwd: z.string(),
});

/** Content of `.specimen/turn.json`. */
export const turnSnapshotSchema = z.strictObject({
  session_id: z.string(),
  head: z.string(),
  watch: z.string().regex(/^[0-9a-f]{64}$/),
});
export type TurnSnapshot = z.infer<typeof turnSnapshotSchema>;

/**
 * The watch globs of `.specimen/replay.json`, or the default when the file is missing or names
 * no glob. A file that fails the policy schema throws.
 */
export function watchGlobs(root: string): string[] {
  const text = readText(specimenFile(root, "replay.json"));
  if (text === undefined) return [...DEFAULT_WATCH];
  const policy = replayPolicySchema.parse(JSON.parse(text));
  return policy.watch.length > 0 ? policy.watch : [...DEFAULT_WATCH];
}

/** The output of a git command in `root`. Throws when git fails. */
function git(root: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** The current HEAD commit, or "none" when the repository has no commit or git cannot run. */
export function headOf(root: string): string {
  try {
    return git(root, ["rev-parse", "HEAD"]).trim();
  } catch {
    return "none";
  }
}

/**
 * The watch hash: sha256 of the text `git diff <head> -- <globs>` followed by one line
 * `<path>\t<sha256>` for each untracked file under the globs, sorted by path. A head of "none"
 * diffs against the index. Both the prompt hook and the stop gate call this function. The stop
 * gate passes the head that the turn snapshot recorded, so a commit made during the turn still
 * shows as a change.
 */
export function watchHash(root: string, globs: readonly string[], head: string): string {
  const flags = ["--no-ext-diff", "--no-color"];
  const diffArgs = head === "none" ? ["diff", ...flags, "--"] : ["diff", ...flags, head, "--"];
  const diff = git(root, [...diffArgs, ...globs]);
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...globs])
    .split("\0")
    .filter((path) => path !== "")
    .sort();
  const lines = untracked.map((path) => `${path}\t${sha256Hex(readFileSync(join(root, path)))}\n`);
  return sha256Hex(diff + lines.join(""));
}

/** Reads `.specimen/turn.json`. A missing, unreadable or invalid file gives undefined. */
export function readTurnSnapshot(root: string): TurnSnapshot | undefined {
  let text: string | undefined;
  try {
    text = readText(specimenFile(root, "turn.json"));
  } catch {
    return undefined;
  }
  if (text === undefined) return undefined;
  try {
    const parsed = turnSnapshotSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Runs the prompt hook. Always resolves to 0 and writes nothing to STDOUT. The snapshot is
 * written when the payload, the watch globs and git all succeed.
 */
export async function runPrompt(readInput: () => Promise<string>): Promise<number> {
  let root = workspaceFor(process.cwd());
  let sessionId: string | undefined;
  try {
    const parsed = parsePayload(await readInput(), turnPayloadSchema);
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
    const head = headOf(root);
    const watch = watchHash(root, watchGlobs(root), head);
    const snapshot: TurnSnapshot = { session_id: sessionId, head, watch };
    writeAtomic(specimenFile(root, "turn.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
  } catch (err) {
    logDiag(root, HOOK, sessionId, `unexpected ${describeError(err)}`);
  }
  return 0;
}

/** The `specimen hook prompt` command. Silent on STDOUT. */
export function createPromptCommand(): Command {
  return new Command("prompt")
    .description("UserPromptSubmit hook: snapshot the server source at the start of a turn")
    .exitOverride()
    .configureOutput({ writeOut: () => {}, writeErr: () => {} })
    .action(async () => {
      process.exitCode = await runPrompt(readStdin);
    });
}
