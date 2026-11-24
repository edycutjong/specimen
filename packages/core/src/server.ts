import { z } from "zod";

/**
 * Workspace `.kiro/settings/mcp.json`. Only the `mcpServers` object is read here. Its values
 * are not checked, because only the keys take part in server resolution.
 */
export const mcpConfigSchema = z.looseObject({
  mcpServers: z.record(z.string(), z.unknown()),
});

export type Resolution =
  | { ok: true; server: string; tool: string }
  | { ok: false; reason: "no_match" | "ambiguous" };

/** Server keys that can take part in name-based resolution. */
const RESOLVABLE_KEY = /^[A-Za-z0-9_-]+$/;

/** Kiro writes `-` as `_` inside `tool_name`, so a key is sanitised before it is matched. */
export function sanitiseKey(k: string): string {
  return k.replace(/-/g, "_");
}

/**
 * Attributes a tool call to one server.
 *
 * With `serverFlag`, the flag is the server. The tool is the name without the
 * `mcp_<sanitised flag>_` prefix when that prefix is present, otherwise the full name.
 *
 * Without a flag, a configured key matches when `toolName` starts with
 * `mcp_<sanitised key>_`. Keys outside `[A-Za-z0-9_-]` never match. One match resolves,
 * none gives `no_match`, and two or more give `ambiguous`. A nested prefix, such as keys
 * `hollow` and `hollow_inn` for `mcp_hollow_inn_quote`, is ambiguous for that reason.
 */
export function resolveServer(a: {
  toolName: string;
  serverFlag?: string;
  keys?: readonly string[];
}): Resolution {
  if (a.serverFlag !== undefined) {
    const prefix = `mcp_${sanitiseKey(a.serverFlag)}_`;
    const tool = a.toolName.startsWith(prefix) ? a.toolName.slice(prefix.length) : a.toolName;
    return { ok: true, server: a.serverFlag, tool };
  }

  const matches = (a.keys ?? []).filter(
    (key) => RESOLVABLE_KEY.test(key) && a.toolName.startsWith(`mcp_${sanitiseKey(key)}_`),
  );
  if (matches.length === 0) return { ok: false, reason: "no_match" };
  if (matches.length > 1) return { ok: false, reason: "ambiguous" };

  const server = matches[0] ?? "";
  const prefix = `mcp_${sanitiseKey(server)}_`;
  return { ok: true, server, tool: a.toolName.slice(prefix.length) };
}
