import { join } from "node:path";
import {
  buildJarLine,
  durationMs,
  fieldPaths,
  formatAccession,
  jarLineSchema,
  maxAccession,
  nextSeq,
  parseCounter,
  parsePending,
  postPayloadSchema,
  readJarTolerant,
  redactResponse,
  removeLine,
  selectPending,
  serializeJarLine,
  type ResponseResult,
} from "@specimen/core";
import { jarsDirectory } from "../io/jars.js";
import { specimenFile } from "../io/fsx.js";
import { withLock } from "../io/lock.js";
import { describeError, logDiag } from "../io/log.js";
import type { HookIO } from "../io/port.js";
import { jarPathFor, parsePayload, prepareCall, workspaceFor } from "./prepare.js";

const HOOK = "post";

/**
 * Takes the next Accession_ID and persists the new counter. The counter is written before the
 * caller builds the Jar_Line. When the counter is missing or not a number, the highest id in
 * `jars/` is used instead, and a garbled counter is logged.
 */
function takeAccession(io: HookIO, root: string, sessionId: string): string {
  const counterPath = specimenFile(root, "counter");
  const stored = io.fs.readText(counterPath);
  let base = stored === undefined ? undefined : parseCounter(stored);
  if (base === undefined) {
    if (stored !== undefined) logDiag(root, HOOK, sessionId, "counter is not a non-negative integer");
    const dir = jarsDirectory(root);
    base = maxAccession(io.fs.listFiles(dir).map((name) => io.fs.readText(join(dir, name)) ?? ""));
  }
  const n = base + 1;
  const id = formatAccession(n);
  io.fs.writeAtomic(counterPath, `${n}\n`);
  return id;
}

/**
 * `specimen hook post`. Pairs the response with the oldest matching Pending_Entry and appends
 * one Jar_Line. Without a match the line is marked unpaired. Errors are thrown to the runner,
 * which logs them and exits 0.
 */
export async function runPost(io: HookIO, serverFlag: string | undefined): Promise<void> {
  const text = await io.readStdin();
  const t1 = io.now();

  const parsed = parsePayload(text, postPayloadSchema);
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

  let response: ResponseResult;
  try {
    response = redactResponse(parsed.data.tool_response, call.compiled);
  } catch (err) {
    logDiag(root, HOOK, sessionId, `response redaction failed ${describeError(err)}`);
    return;
  }

  const t1Iso = new Date(t1).toISOString();
  const pendingPath = specimenFile(root, "pending.jsonl");
  const jarPath = jarPathFor(root, sessionId);

  await withLock(specimenFile(root, "lock"), () => {
    const pendingText = io.fs.readText(pendingPath) ?? "";
    const pending = parsePending(pendingText);
    const match = selectPending(pending, {
      session_id: sessionId,
      tool_id: call.toolName,
      input_sha256: call.inputSha256,
    });

    const jarText = io.fs.readText(jarPath);
    if (jarText !== undefined && jarText !== "" && !jarText.endsWith("\n")) {
      logDiag(root, HOOK, sessionId, "jar does not end with a newline, line not appended");
      return;
    }

    const matched = match === undefined ? undefined : pending[match - 1]?.entry;
    let timing: { seq: number; t0: string; durationMs: number; unpaired: boolean };
    if (matched !== undefined) {
      const span = durationMs(matched.t0, t1Iso);
      if (span.anomaly) logDiag(root, HOOK, sessionId, "clock anomaly, duration set to 0");
      timing = { seq: matched.seq, t0: matched.t0, durationMs: span.ms, unpaired: false };
    } else {
      const jarLines = readJarTolerant(jarText ?? "");
      timing = { seq: nextSeq(sessionId, pending, jarLines), t0: t1Iso, durationMs: 0, unpaired: true };
    }

    const id = takeAccession(io, root, sessionId);
    const built = buildJarLine({
      id,
      sessionId,
      seq: timing.seq,
      server: call.server,
      tool: call.tool,
      toolId: call.toolName,
      input: call.input,
      inputPointers: call.inputPointers,
      response,
      t0: timing.t0,
      t1: t1Iso,
      durationMs: timing.durationMs,
      unpaired: timing.unpaired,
    });
    const line = jarLineSchema.safeParse(built);
    if (!line.success) {
      logDiag(root, HOOK, sessionId, `jar line invalid at ${fieldPaths(line.error.issues).join(", ")}`);
      return;
    }

    try {
      io.fs.appendText(jarPath, serializeJarLine(line.data));
    } catch (err) {
      logDiag(root, HOOK, sessionId, `append failed ${describeError(err)}`);
      return;
    }

    if (match === undefined) return;
    try {
      io.fs.writeAtomic(pendingPath, removeLine(pendingText, match));
    } catch (err) {
      logDiag(root, HOOK, sessionId, `pending removal failed ${describeError(err)}`);
    }
  });
}
