import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { validSessionId } from "@specimen/core";

/**
 * Appends one diagnostic line to `<root>/.specimen/hook.log`:
 * `<ISO time>\t<hook>\t<session_id or ->\t<message>`.
 *
 * Callers pass only fixed messages or field paths, never STDIN text. The log is best effort:
 * a failure to write it is swallowed so that a hook still exits cleanly.
 */
export function logDiag(
  root: string,
  hook: string,
  sessionId: string | undefined,
  message: string,
): void {
  try {
    const dir = join(root, ".specimen");
    mkdirSync(dir, { recursive: true });
    const session = sessionId !== undefined && validSessionId(sessionId) ? sessionId : "-";
    const line = `${new Date().toISOString()}\t${hook}\t${session}\t${message}\n`;
    appendFileSync(join(dir, "hook.log"), line);
  } catch {
    // Swallowed on purpose: the hook must still exit with its own status.
  }
}

/**
 * A short description of a caught error: its name and, when present, its errno code. The
 * message is never used, because it can quote input.
 */
export function describeError(err: unknown): string {
  if (err === null || typeof err !== "object") return "Error";
  const name = (err as { name?: unknown }).name;
  const code = (err as { code?: unknown }).code;
  const safeName = typeof name === "string" && /^[A-Za-z]{1,40}$/.test(name) ? name : "Error";
  const safeCode = typeof code === "string" && /^E[A-Z]{1,20}$/.test(code) ? ` ${code}` : "";
  return `${safeName}${safeCode}`;
}
