/**
 * Normalisation of one response Body before diff. A JSON Body (an object or array parsed from
 * a JSON_Response) loses every value whose concrete pointer matches a Pointer_Glob of the
 * Volatile_Policy. A non-JSON Body, given as a string, only has "\r\n" replaced by "\n".
 *
 * Pure logic: no clock, no randomness, no I/O and no Node built-in import. The input is never
 * mutated. Output objects are built with Object.defineProperty, so an attacker-controlled key
 * such as "__proto__" or "constructor" stays an ordinary own key.
 */
import type { Json } from "./json.js";
import { type VolatilePolicy, matchesGlob } from "./policy.js";

/**
 * The comparable form of a response. A string is the text of a non-JSON response. Any other
 * value is the parsed JSON value of a JSON_Response, which is always an object or an array.
 */
export type Body = Json;

/** Deepest level that is walked. Values at or below this depth are returned unchanged. */
export const NORMALIZE_MAX_DEPTH = 1000;

export type NormalizeResult = {
  /** The normalised Body. */
  value: Body;
  /** Concrete RFC 6901 pointers of the removed values, in the original coordinates. */
  removed: string[];
  /**
   * True when a nested value at depth 1000 or deeper was reached. That subtree is returned
   * unchanged and no Pointer_Glob was applied inside it.
   */
  depthLimited: boolean;
};

/** Escapes one object key as an RFC 6901 reference token (`~` first, then `/`). */
function escapeSegment(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Own enumerable value of `key`, read through the descriptor so `__proto__` is not special. */
function ownValue(container: { [k: string]: Json }, key: string): Json {
  return Object.getOwnPropertyDescriptor(container, key)?.value as Json;
}

/**
 * Normalises one Body under a Volatile_Policy. A glob that matches nothing leaves the Body
 * unchanged, and an empty policy returns a deep-equal value. Array removals reindex the
 * remaining elements. Removing an array element changes the indices of the later ones, so a
 * literal index glob is not idempotent across a second application.
 */
export function normalize(body: Body, policy: VolatilePolicy): NormalizeResult {
  if (typeof body === "string") {
    return { value: body.replace(/\r\n/g, "\n"), removed: [], depthLimited: false };
  }
  const removed: string[] = [];
  const state = { depthLimited: false };
  const value = walk(body, "", 0, policy.volatile, removed, state);
  return { value, removed, depthLimited: state.depthLimited };
}

/** True when the concrete pointer matches any of the globs. */
function matchesAny(pointer: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(pointer, glob));
}

/**
 * Plain recursion over the parsed value. `pointer` is the concrete pointer of `node` in the
 * original Body, so every glob is matched against original coordinates.
 */
function walk(
  current: Json,
  pointer: string,
  depth: number,
  globs: readonly string[],
  removed: string[],
  state: { depthLimited: boolean },
): Json {
  if (current === null || typeof current !== "object") return current;
  if (depth >= NORMALIZE_MAX_DEPTH) {
    state.depthLimited = true;
    return current;
  }

  if (Array.isArray(current)) {
    const kept: Json[] = [];
    for (let index = 0; index < current.length; index += 1) {
      const element = current[index] as Json;
      const childPointer = pointer + "/" + String(index);
      if (matchesAny(childPointer, globs)) {
        removed.push(childPointer);
        continue;
      }
      kept.push(walk(element, childPointer, depth + 1, globs, removed, state));
    }
    return kept;
  }

  const out: { [k: string]: Json } = {};
  for (const key of Object.keys(current)) {
    const childPointer = pointer + "/" + escapeSegment(key);
    if (matchesAny(childPointer, globs)) {
      removed.push(childPointer);
      continue;
    }
    const child = walk(ownValue(current, key), childPointer, depth + 1, globs, removed, state);
    Object.defineProperty(out, key, {
      value: child,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}
