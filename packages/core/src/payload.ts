import { z } from "zod";

/** Session ids name jar files, so they must not carry path separators or "..". */
export const sessionIdRe = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function validSessionId(s: string): boolean {
  return sessionIdRe.test(s) && !s.includes("..");
}

const preFields = z.looseObject({
  session_id: z.string(),
  cwd: z.string(),
  tool_name: z.string(),
  hook_event_name: z.string().optional(),
  tool_input: z.unknown(),
});

const hasToolInput = (o: object): boolean => Object.hasOwn(o, "tool_input");

/**
 * Kiro PreToolUse payload. zod treats a `z.unknown()` key as optional, so the key is
 * checked separately.
 */
export const prePayloadSchema = preFields.refine(hasToolInput, { path: ["tool_input"] });

/** Kiro PostToolUse payload: the same fields plus tool_response as a string. */
export const postPayloadSchema = z
  .looseObject({
    session_id: z.string(),
    cwd: z.string(),
    tool_name: z.string(),
    hook_event_name: z.string().optional(),
    tool_input: z.unknown(),
    tool_response: z.string(),
  })
  .refine(hasToolInput, { path: ["tool_input"] });

const SAFE_SEGMENT = /^[A-Za-z0-9_]{1,40}$/;

/**
 * Field paths for a diagnostic, such as "tool_response". A segment that is not a short
 * identifier is written as "?". Messages from zod and JSON.parse are never used.
 */
export function fieldPaths(issues: readonly z.core.$ZodIssue[]): string[] {
  const seen = new Set<string>();
  for (const issue of issues) {
    const segments = issue.path.map((seg) => {
      const text = typeof seg === "string" || typeof seg === "number" ? String(seg) : "";
      return SAFE_SEGMENT.test(text) ? text : "?";
    });
    seen.add(segments.length === 0 ? "(root)" : segments.join("."));
  }
  return [...seen];
}
