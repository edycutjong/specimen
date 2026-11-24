import { z } from "zod";
import { validSessionId } from "./payload.js";
import type { Json } from "./json.js";

/** Largest value allowed for `seq` and `duration_ms` (signed 32-bit). */
const MAX_INT32 = 2147483647;

/** RFC 8259 value check. Used instead of a rebuilt zod schema so JSON keys such as "__proto__" stay own data properties. */
function isJsonValue(v: unknown): v is Json {
  if (v === null || typeof v === "boolean" || typeof v === "string") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isJsonValue);
  if (typeof v === "object") {
    const proto: unknown = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return false;
    return Object.keys(v).every((key) =>
      isJsonValue(Object.getOwnPropertyDescriptor(v, key)?.value),
    );
  }
  return false;
}

/** zod schema for one JSON value, shared with replay-result.ts. */
export const jsonValue = z.custom<Json>((v) => isJsonValue(v), { message: "not a JSON value" });

const FIELD_TOKENS = new Set(["input", "response"]);

/**
 * RFC 6901 pointer into the Jar_Line. The first token must be `input` or `response`, because
 * redaction only ever points into those two fields. `~` may appear only as `~0` or `~1`.
 */
export function isJarPointer(p: string): boolean {
  if (!p.startsWith("/")) return false;
  const tokens = p.slice(1).split("/");
  const first = tokens[0];
  if (first === undefined || !FIELD_TOKENS.has(first)) return false;
  return tokens.every((t) => /^(?:[^~]|~[01])*$/.test(t));
}

const jsonPointer = z.string().refine(isJarPointer, { message: "invalid JSON pointer" });

const sessionIdSchema = z.string().refine(validSessionId, { message: "invalid session_id" });

const utcDateTime = z.iso.datetime({ offset: true });

const SHA256_TEXT = /^sha256:[0-9a-f]{64}$/;

/**
 * Schema for one Jar_Line (format "specimen v1").
 *
 * `seq` is unique within a Jar. It gives the order in which calls started. Jar_Lines are
 * appended in the order calls completed, so file order can differ from `seq` order.
 * Consumers sort Jar_Lines by `seq`.
 *
 * `duration_ms` includes hook overhead: it is the time between the pre hook reading its
 * payload and the post hook reading its payload, not the time the MCP tool took to run.
 */
export const jarLineSchema = z
  .strictObject({
    v: z.literal(1),
    id: z.string().regex(/^SPC-\d{4,}$/),
    session_id: sessionIdSchema,
    seq: z.number().int().min(1).max(MAX_INT32),
    server: z.string().min(1),
    tool: z.string().min(1),
    tool_id: z.string().min(1),
    input: jsonValue,
    response_text: z.string(),
    response: jsonValue.nullable(),
    t0: utcDateTime,
    t1: utcDateTime,
    duration_ms: z.number().int().min(0).max(MAX_INT32),
    redacted: z.array(jsonPointer),
    text_redacted: z.boolean().optional(),
    unpaired: z.boolean().optional(),
    /** UTF-16 code unit length of the replaced text. Present only for hashed responses. */
    response_length: z.number().int().min(0).optional(),
  })
  .superRefine((line, ctx) => {
    if (line.response_length === undefined) return;
    if (!SHA256_TEXT.test(line.response_text)) {
      ctx.addIssue({
        code: "custom",
        path: ["response_text"],
        message: "response_text must be sha256: followed by 64 lowercase hex characters",
      });
    }
    if (line.response !== null) {
      ctx.addIssue({ code: "custom", path: ["response"], message: "response must be null" });
    }
  });

export type JarLine = z.infer<typeof jarLineSchema>;

/** Key order used when a Jar_Line is written, so every line has the same field order. */
const WRITE_ORDER = [
  "v",
  "id",
  "session_id",
  "seq",
  "server",
  "tool",
  "tool_id",
  "input",
  "response_text",
  "response",
  "t0",
  "t1",
  "duration_ms",
  "redacted",
  "text_redacted",
  "unpaired",
  "response_length",
] as const;

/** One JSON object on one line, terminated by a single newline. */
export function serializeJarLine(line: JarLine): string {
  const record = line as unknown as Record<string, unknown>;
  const ordered: Record<string, unknown> = {};
  for (const key of WRITE_ORDER) {
    if (record[key] !== undefined) ordered[key] = record[key];
  }
  return JSON.stringify(ordered) + "\n";
}

export type JarErrorKind = "json" | "schema" | "unknown_field" | "blank" | "incomplete";

/** A defect found on one 1-based line. `field` names the failing field or unknown key. */
export type JarError = { line: number; kind: JarErrorKind; field?: string };

export type JarReadResult = { lines: JarLine[]; errors: JarError[] };

/** Field path such as "redacted.0", or "(root)". Built from zod issue paths only. */
function issueField(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "(root)";
  return path.map((seg) => String(seg)).join(".");
}

/**
 * Reads the text of a Jar. Valid lines are returned in file order. Every defect is returned
 * with its 1-based line number and the defective line is not returned.
 */
export function readJar(text: string): JarReadResult {
  const lines: JarLine[] = [];
  const errors: JarError[] = [];
  if (text === "") return { lines, errors };

  const segments = text.split("\n");
  const lastIndex = segments.length - 1;
  const terminated = segments[lastIndex] === "";

  segments.forEach((raw, index) => {
    const lineNo = index + 1;
    if (index === lastIndex) {
      if (terminated) return;
      errors.push({ line: lineNo, kind: "incomplete" });
      return;
    }
    if (raw === "") {
      errors.push({ line: lineNo, kind: "blank" });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      errors.push({ line: lineNo, kind: "json" });
      return;
    }

    const result = jarLineSchema.safeParse(parsed);
    if (result.success) {
      lines.push(result.data);
      return;
    }

    const unknown = result.error.issues.find((issue) => issue.code === "unrecognized_keys");
    if (unknown && unknown.code === "unrecognized_keys") {
      const key = unknown.keys[0] ?? "(unknown)";
      errors.push({ line: lineNo, kind: "unknown_field", field: key });
      return;
    }

    const first = result.error.issues[0];
    errors.push({
      line: lineNo,
      kind: "schema",
      field: first ? issueField(first.path) : "(root)",
    });
  });

  return { lines, errors };
}

/** The valid Jar_Lines of a Jar text. Invalid lines are skipped. Never throws. */
export function readJarTolerant(text: string): JarLine[] {
  return readJar(text).lines;
}
