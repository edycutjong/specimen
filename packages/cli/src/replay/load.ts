/**
 * Reads the inputs of `specimen replay` from disk and validates them at the boundary: the jar
 * files, the Pending_File, `.specimen/replay.json`, `.specimen/volatile.json` and
 * `.specimen/redact.json`. Nothing here writes, and nothing here decides an exit code. A failure
 * is returned as data and the CLI prints it and exits with 2.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PENDING_FILE,
  SHIPPED_VOLATILE_POLICY,
  redactConfigSchema,
  replayPolicySchema,
  volatilePolicySchema,
  type Compiled,
  type JarFile,
  type RedactConfig,
  type ReplayPolicy,
  type VolatilePolicy,
} from "@specimen/core";
import { readText, specimenFile } from "../io/fsx.js";
import { describeFirstIssue } from "../io/issues.js";
import { loadRedactConfig, type RedactLoad, type TextReader } from "../io/redactConfig.js";
import type { z } from "zod";

/** The name of the jar that jar-capture writes beside the jars and that is never a jar. */
const MANIFEST_FILE = "MANIFEST.sha256";

export type ReplayInputs = {
  /** The `*.jsonl` files of the jars directory, in file name code-unit order. */
  jarFiles: JarFile[];
  /** The Pending_File text. Empty when the file is missing. */
  pendingText: string;
  replayPolicy: ReplayPolicy;
  volatilePolicy: VolatilePolicy;
  redactConfig: RedactConfig;
  compiledRedact: Compiled;
};

/** A failed read or validation. `file` is the file name and `problem` names the failing field. */
export type LoadFailure = { ok: false; file: string; problem: string };

export type LoadResult = { ok: true; inputs: ReplayInputs } | LoadFailure;

export type LoadOptions = {
  /** The Workspace_Root that holds `.specimen/`. */
  root: string;
  /** The jars directory. Defaults to `<root>/jars`. A missing directory is empty. */
  jarsDir?: string;
  /** The text reader for the `.specimen` files. Defaults to the file system. */
  read?: TextReader;
};

type Step<T> = { ok: true; value: T } | LoadFailure;

function fail(file: string, problem: string): LoadFailure {
  return { ok: false, file, problem };
}

function codeOf(err: unknown): string {
  return (err as NodeJS.ErrnoException | undefined)?.code ?? "unknown error";
}

/**
 * The `*.jsonl` files of a directory, read in file name code-unit order. A missing directory
 * gives no files. Other errors fail, because a partial view of the evidence must not be judged.
 */
function readJarFiles(dir: string): Step<JarFile[]> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (codeOf(err) === "ENOENT") return { ok: true, value: [] };
    return fail(dir, `cannot read the jars directory (${codeOf(err)})`);
  }

  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl") && entry.name !== MANIFEST_FILE)
    .map((entry) => entry.name)
    .sort();

  const files: JarFile[] = [];
  for (const name of names) {
    try {
      files.push({ file: name, text: readFileSync(join(dir, name), "utf8") });
    } catch (err) {
      return fail(name, `cannot read the jar (${codeOf(err)})`);
    }
  }
  return { ok: true, value: files };
}

/** Parses JSON text and validates it with a strict zod schema. */
function parsePolicy<S extends z.ZodType>(text: string, schema: S, file: string): Step<z.output<S>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail(file, "invalid JSON");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) return fail(file, describeFirstIssue(result.error.issues));
  return { ok: true, value: result.data as z.output<S> };
}

/** Reads one file through the reader. A missing file gives undefined. */
function readOptional(read: TextReader, path: string, file: string): Step<string | undefined> {
  try {
    return { ok: true, value: read(path) };
  } catch (err) {
    return fail(file, `cannot read the file (${codeOf(err)})`);
  }
}

/**
 * Loads every input of `specimen replay`. A missing `.specimen/replay.json` means empty `allow`
 * and `watch`, so every jar is skipped. A missing `.specimen/volatile.json` means the shipped
 * Volatile_Policy, and a missing `.specimen/redact.json` means the default Redact_Config. An
 * invalid file, an unreadable file or a bad redact pattern fails with the file name and the
 * failing field or pattern index.
 */
export function loadReplayInputs(options: LoadOptions): LoadResult {
  const read = options.read ?? readText;
  const root = options.root;

  const jars = readJarFiles(options.jarsDir ?? join(root, "jars"));
  if (!jars.ok) return jars;

  const pendingFile = PENDING_FILE;
  const pending = readOptional(read, join(root, pendingFile), pendingFile);
  if (!pending.ok) return pending;

  const replayFile = ".specimen/replay.json";
  const replayText = readOptional(read, specimenFile(root, "replay.json"), replayFile);
  if (!replayText.ok) return replayText;
  const replayPolicy: Step<ReplayPolicy> =
    replayText.value === undefined
      ? { ok: true, value: { allow: [], watch: [] } }
      : parsePolicy(replayText.value, replayPolicySchema, replayFile);
  if (!replayPolicy.ok) return replayPolicy;

  const volatileFile = ".specimen/volatile.json";
  const volatileText = readOptional(read, specimenFile(root, "volatile.json"), volatileFile);
  if (!volatileText.ok) return volatileText;
  const volatilePolicy: Step<VolatilePolicy> =
    volatileText.value === undefined
      ? { ok: true, value: SHIPPED_VOLATILE_POLICY }
      : parsePolicy(volatileText.value, volatilePolicySchema, volatileFile);
  if (!volatilePolicy.ok) return volatilePolicy;

  const redactFile = ".specimen/redact.json";
  let redact: RedactLoad;
  try {
    redact = loadRedactConfig(root, read);
  } catch (err) {
    return fail(redactFile, `cannot read the file (${codeOf(err)})`);
  }
  if (!redact.ok) {
    if (redact.reason === "invalid_json") return fail(redactFile, "invalid JSON");
    if (redact.reason === "invalid_config") {
      // The shared loader does not name the field, so the file is parsed again to name it.
      const text = readOptional(read, specimenFile(root, "redact.json"), redactFile);
      if (!text.ok) return text;
      const named = parsePolicy(text.value ?? "", redactConfigSchema, redactFile);
      return named.ok ? fail(redactFile, "invalid content") : named;
    }
    return fail(
      redactFile,
      `pattern ${redact.patternIndex ?? "?"} is not a valid regular expression or matches the empty string`,
    );
  }

  return {
    ok: true,
    inputs: {
      jarFiles: jars.value,
      pendingText: pending.value ?? "",
      replayPolicy: replayPolicy.value,
      volatilePolicy: volatilePolicy.value,
      redactConfig: redact.config,
      compiledRedact: redact.compiled,
    },
  };
}

/** The one-line STDERR diagnostic for a failed load. */
export function formatLoadFailure(failure: LoadFailure): string {
  return `specimen replay: ${failure.file}: ${failure.problem}`;
}
