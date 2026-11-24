/**
 * Replay policy and volatile policy: the zod schemas for `.specimen/replay.json` and
 * `.specimen/volatile.json`, the tool decision, and RFC 6901 pointer globs. Pure logic with
 * no Node built-in imports, no clock and no I/O.
 *
 * A Pointer_Glob is an RFC 6901 pointer in which a segment equal to `*` matches exactly one
 * segment of a concrete pointer. Every other segment matches an equal segment after RFC 6901
 * unescaping, so `~1` stands for `/` and `~0` stands for `~`.
 */
import { z } from "zod";

/** A segment may contain `~` only as `~0` or `~1`. */
const ESCAPED_SEGMENT = /^(?:[^~]|~[01])*$/;

/**
 * True when `glob` is a non-empty RFC 6901 pointer whose `~` escapes are valid. The empty
 * pointer is rejected because a glob that matches the whole body would remove everything.
 */
export function isPointerGlob(glob: string): boolean {
  if (!glob.startsWith("/")) return false;
  return glob
    .slice(1)
    .split("/")
    .every((segment) => ESCAPED_SEGMENT.test(segment));
}

/** Content of `.specimen/replay.json`. Strict: any other key is rejected. */
export const replayPolicySchema = z.strictObject({
  allow: z.array(z.string()),
  watch: z.array(z.string()),
});
export type ReplayPolicy = z.infer<typeof replayPolicySchema>;

/** Content of `.specimen/volatile.json`. Strict: any other key is rejected. */
export const volatilePolicySchema = z.strictObject({
  volatile: z.array(z.string().refine(isPointerGlob, { message: "not a Pointer_Glob" })),
});
export type VolatilePolicy = z.infer<typeof volatilePolicySchema>;

export type ToolDecision = "allowed" | "watched" | "both" | "skipped";

/**
 * Decides how a tool is treated. A tool in `allow` may change state, a tool in `watch` only
 * reads, and a tool in both lists is replayed once. Any other tool is skipped.
 */
export function decideTool(tool: string, policy: ReplayPolicy): ToolDecision {
  const allowed = policy.allow.includes(tool);
  const watched = policy.watch.includes(tool);
  if (allowed && watched) return "both";
  if (allowed) return "allowed";
  if (watched) return "watched";
  return "skipped";
}

/** RFC 6901 unescaping of one segment: `~1` becomes `/`, then `~0` becomes `~`. */
function unescapeSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** Segments of a pointer, or undefined when the pointer does not start with `/`. */
function segmentsOf(pointer: string): string[] | undefined {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) return undefined;
  return pointer.slice(1).split("/");
}

/**
 * True when the concrete RFC 6901 `pointer` matches `glob`. Segments are compared one by one,
 * so a `*` segment matches exactly one segment and never zero or several.
 */
export function matchesGlob(pointer: string, glob: string): boolean {
  if (!isPointerGlob(glob)) return false;
  const pointerSegments = segmentsOf(pointer);
  if (pointerSegments === undefined) return false;
  const globSegments = segmentsOf(glob);
  if (globSegments === undefined || globSegments.length !== pointerSegments.length) {
    return false;
  }
  return globSegments.every((segment, index) => {
    if (segment === "*") return true;
    const concrete = pointerSegments[index];
    return concrete !== undefined && unescapeSegment(segment) === unescapeSegment(concrete);
  });
}

/** The volatile policy shipped in `.specimen/volatile.json`. */
export const SHIPPED_VOLATILE_POLICY: VolatilePolicy = {
  volatile: ["/created_at", "/bookings/*/created_at"],
};
