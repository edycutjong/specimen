import { join, resolve } from "node:path";
import { z } from "zod";
import {
  fieldPaths,
  inputHash,
  mcpConfigSchema,
  redactInput,
  resolveServer,
  validSessionId,
  type Compiled,
  type Json,
} from "@specimen/core";
import { jarsDirectory } from "../io/jars.js";
import type { FsPort } from "../io/port.js";
import { loadRedactConfig, type RedactLoad } from "../io/redactConfig.js";
import { findWorkspaceRoot, isDirectory } from "../io/root.js";

export type CaptureName = "pre" | "post";

/** The fields that the pre and post payloads share, after their zod schema has passed. */
export type CapturePayload = {
  session_id: string;
  cwd: string;
  tool_name: string;
  tool_input: unknown;
};

/** A call that is not recorded, with the fixed message for the Hook_Log. */
export type Refusal = { root: string; sessionId?: string | undefined; message: string };

/** A call that passed every check, with its input already redacted and hashed. */
export type PreparedCall = {
  root: string;
  sessionId: string;
  toolName: string;
  server: string;
  tool: string;
  compiled: Compiled;
  input: Json;
  inputPointers: string[];
  inputSha256: string;
};

export type Prepared = { ok: true; call: PreparedCall } | { ok: false; refusal: Refusal };

/**
 * The Workspace_Root for a payload `cwd`. A `cwd` that is not an existing directory falls back
 * to the process directory, so a diagnostic never creates `.specimen` under a made-up path.
 */
export function workspaceFor(cwd: string): string {
  const base = resolve(cwd);
  return findWorkspaceRoot(isDirectory(base) ? base : process.cwd());
}

/**
 * Parses STDIN text against a payload schema. The failure message names field paths only,
 * never text from the input.
 */
export function parsePayload<T>(
  text: string,
  schema: z.ZodType<T>,
): { ok: true; data: T } | { ok: false; message: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: "stdin is not valid JSON" };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, message: `payload invalid at ${fieldPaths(parsed.error.issues).join(", ")}` };
  }
  return { ok: true, data: parsed.data };
}

function loadFailure(load: Extract<RedactLoad, { ok: false }>): string {
  switch (load.reason) {
    case "invalid_json":
      return "redact config is not valid JSON";
    case "invalid_config":
      return "redact config fails its schema";
    case "bad_pattern":
      return `redact pattern ${load.patternIndex ?? "?"} is invalid`;
  }
}

/** The configured server keys from the workspace `.kiro/settings/mcp.json`, or a fixed reason. */
function readServerKeys(root: string, fs: FsPort): { ok: true; keys: string[] } | { ok: false; message: string } {
  const text = fs.readText(join(root, ".kiro", "settings", "mcp.json"));
  if (text === undefined) return { ok: false, message: "workspace mcp.json is missing" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: "workspace mcp.json is not valid JSON" };
  }
  const parsed = mcpConfigSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "workspace mcp.json fails its schema" };
  return { ok: true, keys: Object.keys(parsed.data.mcpServers) };
}

/**
 * The checks that pre and post share. Order: session id, server key flag, redact config,
 * server resolution, then input redaction and hashing. A refusal names the reason and never
 * records anything.
 */
export function prepareCall(a: { payload: CapturePayload; serverFlag: string | undefined; fs: FsPort }): Prepared {
  const { payload, serverFlag, fs } = a;
  const root = workspaceFor(payload.cwd);
  const refuse = (message: string, sessionId?: string): Prepared => ({
    ok: false,
    refusal: { root, sessionId, message },
  });

  const sessionId = payload.session_id;
  if (!validSessionId(sessionId)) return refuse("session_id invalid");
  if (serverFlag === "") return refuse("server key is empty", sessionId);

  const load = loadRedactConfig(root, (path) => fs.readText(path));
  if (!load.ok) return refuse(loadFailure(load), sessionId);

  const toolName = payload.tool_name;
  let resolution;
  if (serverFlag !== undefined) {
    resolution = resolveServer({ toolName, serverFlag });
  } else {
    const keys = readServerKeys(root, fs);
    if (!keys.ok) return refuse(keys.message, sessionId);
    resolution = resolveServer({ toolName, keys: keys.keys });
  }
  if (!resolution.ok) {
    const message =
      resolution.reason === "ambiguous" ? "server boundary is ambiguous" : "no configured server matches tool name";
    return refuse(message, sessionId);
  }

  // JSON.parse produced tool_input, so it is already a Json value. The zod schema types it as unknown.
  const redacted = redactInput(payload.tool_input as Json, load.compiled);
  return {
    ok: true,
    call: {
      root,
      sessionId,
      toolName,
      server: resolution.server,
      tool: resolution.tool,
      compiled: load.compiled,
      input: redacted.value,
      inputPointers: redacted.pointers,
      inputSha256: inputHash(redacted.value),
    },
  };
}

/** Path of `jars/<session>.jsonl` for a session id that has already passed validSessionId. */
export function jarPathFor(root: string, sessionId: string): string {
  return join(jarsDirectory(root), `${sessionId}.jsonl`);
}
