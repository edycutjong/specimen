/**
 * Which red jars a bugfix spec can be filed for. Shared by `specimen file` and the Stop gate, so the
 * gate never sends the agent back for a spec the CLI must refuse to write (a2a round 06). Pure logic.
 */

/** The reason the replay engine gives a jar whose tool is not in the server's tools/list. */
export const MISSING_TOOL_REASON = "tool not in tools/list";

/** The reason the replay engine gives a jar whose call now returns an MCP error result (`isError`). */
export const ERROR_RESULT_REASON = "tool returned isError";

/** The two cracks the replay proves from the server's own answers; every other crack is operational. */
export const FILEABLE_CRACK_REASONS: readonly string[] = [MISSING_TOOL_REASON, ERROR_RESULT_REASON];

/**
 * True for a red jar a spec can be filed for: every rattled jar, and a cracked jar whose tool is gone
 * or now returns an error. A start failure, a timeout or a dead session is operational: no spec.
 */
export function isFileable(entry: { state: string; reason?: string }): boolean {
  if (entry.state === "rattled") return true;
  return entry.state === "cracked" && entry.reason !== undefined && FILEABLE_CRACK_REASONS.includes(entry.reason);
}
