import {
  fieldPaths,
  nextSeq,
  parsePending,
  pendingEntrySchema,
  prePayloadSchema,
  readJarTolerant,
} from "@specimen/core";
import { specimenFile } from "../io/fsx.js";
import { withLock } from "../io/lock.js";
import { logDiag } from "../io/log.js";
import type { HookIO } from "../io/port.js";
import { jarPathFor, parsePayload, prepareCall, workspaceFor } from "./prepare.js";

const HOOK = "pre";

/**
 * `specimen hook pre`. Appends one Pending_Entry that the post hook will later pair with its
 * response. Errors are thrown to the runner, which logs them and exits 0.
 */
export async function runPre(io: HookIO, serverFlag: string | undefined): Promise<void> {
  const text = await io.readStdin();
  const at = io.now();

  const parsed = parsePayload(text, prePayloadSchema);
  if (!parsed.ok) {
    logDiag(workspaceFor(process.cwd()), HOOK, undefined, parsed.message);
    return;
  }

  const prepared = prepareCall({ payload: parsed.data, serverFlag, fs: io.fs });
  if (!prepared.ok) {
    logDiag(prepared.refusal.root, HOOK, prepared.refusal.sessionId, prepared.refusal.message);
    return;
  }
  const { call } = prepared;
  const { root, sessionId } = call;
  const pendingPath = specimenFile(root, "pending.jsonl");
  const t0 = new Date(at).toISOString();

  await withLock(specimenFile(root, "lock"), () => {
    const pendingText = io.fs.readText(pendingPath) ?? "";
    const pending = parsePending(pendingText);
    for (const line of pending) {
      if (line.entry === undefined) logDiag(root, HOOK, sessionId, `pending line ${line.line} is invalid`);
    }
    const jarLines = readJarTolerant(io.fs.readText(jarPathFor(root, sessionId)) ?? "");
    const seq = nextSeq(sessionId, pending, jarLines);

    const entry = pendingEntrySchema.safeParse({
      session_id: sessionId,
      seq,
      tool_id: call.toolName,
      input_sha256: call.inputSha256,
      t0,
    });
    if (!entry.success) {
      logDiag(root, HOOK, sessionId, `pending entry invalid at ${fieldPaths(entry.error.issues).join(", ")}`);
      return;
    }

    // A torn final line from an earlier crash becomes its own invalid line, so this entry starts fresh.
    const prefix = pendingText !== "" && !pendingText.endsWith("\n") ? "\n" : "";
    io.fs.appendText(pendingPath, `${prefix}${JSON.stringify(entry.data)}\n`);
  });
}
