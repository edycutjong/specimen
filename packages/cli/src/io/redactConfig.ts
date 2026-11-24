import {
  compileRedact,
  DEFAULT_REDACT_CONFIG,
  redactConfigSchema,
  type Compiled,
  type RedactConfig,
} from "@specimen/core";
import { specimenFile, readText } from "./fsx.js";

/** Reads a file as text, or undefined when it is missing. The capture hooks pass their file port here. */
export type TextReader = (path: string) => string | undefined;

export type RedactLoad =
  | { ok: true; config: RedactConfig; compiled: Compiled }
  | {
      ok: false;
      reason: "invalid_json" | "invalid_config" | "bad_pattern";
      /** Index in `patterns` of the failing pattern, for `bad_pattern` only. */
      patternIndex?: number;
    };

/**
 * Reads `<root>/.specimen/redact.json`, validates it with the strict zod schema and compiles its
 * patterns. A missing file gives DEFAULT_REDACT_CONFIG. An unreadable JSON document, a schema
 * failure, or a pattern that is not a valid regular expression or matches the empty string gives
 * a failure, so that no call is recorded with unvalidated redaction.
 *
 * The failure carries only a reason code. It never carries file text, because the caller logs it.
 */
export function loadRedactConfig(root: string, read: TextReader = readText): RedactLoad {
  const text = read(specimenFile(root, "redact.json"));
  let config: RedactConfig = DEFAULT_REDACT_CONFIG;

  if (text !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: "invalid_json" };
    }
    const result = redactConfigSchema.safeParse(parsed);
    if (!result.success) return { ok: false, reason: "invalid_config" };
    config = result.data;
  }

  const compiled = compileRedact(config);
  if (!compiled.ok) {
    return { ok: false, reason: "bad_pattern", patternIndex: compiled.patternIndex };
  }
  return { ok: true, config, compiled: compiled.value };
}
