import { z } from "zod";
import type { Json } from "./json.js";
import type { JarLine } from "./jar.js";
import type { ResponseResult } from "./redact.js";

/** Largest value allowed for `seq` and `duration_ms` (signed 32-bit). */
const MAX_INT32 = 2147483647;

/** One Pending_Entry, written by the pre hook and read by the post hook. */
export const pendingEntrySchema = z.strictObject({
  session_id: z.string(),
  seq: z.number().int().min(1),
  tool_id: z.string().min(1),
  input_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  t0: z.string(),
});

export type PendingEntry = z.infer<typeof pendingEntrySchema>;

/** A line of the Pending_File. `entry` is absent when the line is blank or fails the schema. */
export type PendingLine = { line: number; raw: string; entry?: PendingEntry };

/**
 * Splits the Pending_File into lines. Every line is kept, including invalid ones, so later
 * edits can leave them in place. Line numbers are 1-based. A final newline does not create
 * an extra line.
 */
export function parsePending(text: string): PendingLine[] {
  const segments = text.split("\n");
  if (segments[segments.length - 1] === "") segments.pop();

  return segments.map((raw, index) => {
    const line = index + 1;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { line, raw };
    }
    const result = pendingEntrySchema.safeParse(parsed);
    return result.success ? { line, raw, entry: result.data } : { line, raw };
  });
}

/**
 * The lowest line number of a valid Pending_Entry that matches the session, the tool and
 * the input hash. Returns undefined when no entry matches.
 */
export function selectPending(
  pending: readonly PendingLine[],
  k: { session_id: string; tool_id: string; input_sha256: string },
): number | undefined {
  for (const p of pending) {
    const e = p.entry;
    if (e && e.session_id === k.session_id && e.tool_id === k.tool_id && e.input_sha256 === k.input_sha256) {
      return p.line;
    }
  }
  return undefined;
}

/**
 * Removes one line by its 1-based number. Every other line is kept verbatim and in order.
 * A file that did not end with a newline still does not, unless its last line was removed.
 */
export function removeLine(text: string, line: number): string {
  const segments = text.split("\n");
  const terminated = segments[segments.length - 1] === "";
  if (terminated) segments.pop();

  const index = line - 1;
  if (index < 0 || index >= segments.length) return text;

  const kept = segments.filter((_, i) => i !== index);
  const lastRemoved = index === segments.length - 1;
  const endsWithNewline = terminated || lastRemoved;
  return kept.join("\n") + (kept.length > 0 && endsWithNewline ? "\n" : "");
}

/**
 * One more than the highest `seq` among the valid Pending_Entries and the Jar_Lines of the
 * same session. Returns 1 when there are none. Orphans count, so no `seq` is reused.
 */
export function nextSeq(
  sessionId: string,
  pending: readonly PendingLine[],
  jarLines: readonly JarLine[],
): number {
  let max = 0;
  for (const p of pending) {
    if (p.entry && p.entry.session_id === sessionId) max = Math.max(max, p.entry.seq);
  }
  for (const l of jarLines) {
    if (l.session_id === sessionId) max = Math.max(max, l.seq);
  }
  return max + 1;
}

/**
 * Milliseconds from `t0` to `t1`, clamped to 0..MAX_INT32. `anomaly` is true when `t1` is
 * earlier than `t0`, or when either time is not a parseable date.
 */
export function durationMs(t0: string, t1: string): { ms: number; anomaly: boolean } {
  const diff = Date.parse(t1) - Date.parse(t0);
  if (!Number.isFinite(diff)) return { ms: 0, anomaly: true };
  if (diff < 0) return { ms: 0, anomaly: true };
  return { ms: Math.min(diff, MAX_INT32), anomaly: false };
}

export type BuildArgs = {
  id: string;
  sessionId: string;
  seq: number;
  server: string;
  tool: string;
  toolId: string;
  /** The redacted tool input. */
  input: Json;
  /** Pointers into `input`, relative to its root, as returned by redactInput. */
  inputPointers: readonly string[];
  /** The redacted response, as returned by redactResponse. */
  response: ResponseResult;
  t0: string;
  t1: string;
  durationMs: number;
  unpaired: boolean;
};

/**
 * Builds a Jar_Line object in the fixed field order. `redacted` is the sorted, deduplicated
 * union of the input pointers (prefixed `/input`) and the response pointers (prefixed
 * `/response`). An unpaired line uses `t0 = t1` and `duration_ms = 0`. The caller validates
 * the result with jarLineSchema before appending it.
 */
export function buildJarLine(a: BuildArgs): Record<string, unknown> {
  const pointers = [
    ...a.inputPointers.map((p) => `/input${p}`),
    ...a.response.pointers.map((p) => `/response${p}`),
  ];
  const redacted = [...new Set(pointers)].sort();

  const t0 = a.unpaired ? a.t1 : a.t0;
  const duration = a.unpaired ? 0 : a.durationMs;

  const line: Record<string, unknown> = {
    v: 1,
    id: a.id,
    session_id: a.sessionId,
    seq: a.seq,
    server: a.server,
    tool: a.tool,
    tool_id: a.toolId,
    input: a.input,
    response_text: a.response.responseText,
    response: a.response.response,
    t0,
    t1: a.t1,
    duration_ms: duration,
    redacted,
  };
  if (a.response.textRedacted) line.text_redacted = true;
  if (a.unpaired) line.unpaired = true;
  if (a.response.responseLength !== undefined) line.response_length = a.response.responseLength;
  return line;
}
