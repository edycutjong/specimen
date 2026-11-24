import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { resolveServer, sanitiseKey, type Resolution } from "../src/index.js";

// Feature: jar-capture, Property 7: Server resolution
// **Validates: Requirements 3.9, 3.10, 5.1, 5.2, 5.3, 5.5, 5.7, 5.8, 11.12**

const RUNS = { numRuns: 200 };

/** Keys that are valid for matching. Shared prefixes and hyphen/underscore twins are common here. */
const POOL = ["hollow", "hollow-inn", "hollow_inn", "inn", "inn-2", "h", "a", "a_b", "a-b"];

const validKeyArb = fc.oneof(
  { weight: 2, arbitrary: fc.constantFrom(...POOL) },
  { weight: 1, arbitrary: fc.stringMatching(/^[A-Za-z0-9_-]{1,8}$/) },
);

/** The part of a tool name after the server prefix. It may hold letters, digits, "_" and "-". */
const suffixArb = fc.stringMatching(/^[A-Za-z0-9_-]{1,8}$/);

/** A key with one character outside [A-Za-z0-9_-] somewhere in it. */
const invalidKeyArb = fc
  .tuple(validKeyArb, fc.constantFrom(".", " ", "/", "+", ":", "*"), fc.nat({ max: 8 }))
  .map(([key, ch, at]) => {
    const pos = Math.min(at, key.length);
    return key.slice(0, pos) + ch + key.slice(pos);
  });

/** The prefix a key contributes to a tool name, before any matching is judged. */
const prefixOf = (key: string): string => `mcp_${sanitiseKey(key)}_`;

/** Keys that the spec allows to match: they consist only of [A-Za-z0-9_-]. */
const isResolvable = (key: string): boolean => /^[A-Za-z0-9_-]+$/.test(key);

/**
 * Reference answer for a call with no flag. It follows the spec text directly: sanitise each
 * resolvable key, count the ones that start the tool name, and decide from that count.
 */
function expectedByName(toolName: string, keys: readonly string[]): Resolution {
  const hits = keys.filter((k) => isResolvable(k) && toolName.startsWith(prefixOf(k)));
  if (hits.length === 0) return { ok: false, reason: "no_match" };
  if (hits.length > 1) return { ok: false, reason: "ambiguous" };
  const server = hits[0] ?? "";
  return { ok: true, server, tool: toolName.slice(prefixOf(server).length) };
}

describe("Property 7: server resolution", () => {
  it("matches the reference answer for any tool name and key set", () => {
    fc.assert(
      fc.property(
        fc.array(validKeyArb, { minLength: 0, maxLength: 4 }),
        suffixArb,
        fc.option(fc.constantFrom(...POOL), { nil: undefined }),
        (keys, suffix, head) => {
          const toolName = head === undefined ? suffix : `${prefixOf(head)}${suffix}`;
          expect(resolveServer({ toolName, keys })).toEqual(expectedByName(toolName, keys));
        },
      ),
      RUNS,
    );
  });

  it("resolves a tool to its one key when no other key prefixes it, and reports ambiguity otherwise", () => {
    fc.assert(
      fc.property(
        validKeyArb,
        fc.array(validKeyArb, { maxLength: 3 }),
        suffixArb,
        (target, others, suffix) => {
          const toolName = `${prefixOf(target)}${suffix}`;
          const keys = [target, ...others];
          // The target always matches. Any other key with the same prefix makes the call ambiguous.
          const otherHit = others.some(
            (k) => isResolvable(k) && toolName.startsWith(prefixOf(k)),
          );
          const result = resolveServer({ toolName, keys });
          if (otherHit) {
            expect(result).toEqual({ ok: false, reason: "ambiguous" });
          } else {
            expect(result).toEqual({ ok: true, server: target, tool: suffix });
          }
        },
      ),
      RUNS,
    );
  });

  it("resolves a sanitised key, where each hyphen in the key appears as an underscore in the tool name", () => {
    fc.assert(
      fc.property(validKeyArb, suffixArb, (key, suffix) => {
        const toolName = `mcp_${key.replace(/-/g, "_")}_${suffix}`;
        expect(resolveServer({ toolName, keys: [key] })).toEqual({
          ok: true,
          server: key,
          tool: suffix,
        });
      }),
      RUNS,
    );
  });

  it("never names a key with a character outside [A-Za-z0-9_-]", () => {
    fc.assert(
      fc.property(invalidKeyArb, suffixArb, (bad, suffix) => {
        const toolName = `${prefixOf(bad)}${suffix}`;
        expect(resolveServer({ toolName, keys: [bad] })).toEqual({
          ok: false,
          reason: "no_match",
        });
      }),
      RUNS,
    );
  });

  it("ignores an invalid key even when it sits beside a valid key that matches", () => {
    fc.assert(
      fc.property(invalidKeyArb, validKeyArb, suffixArb, (bad, good, suffix) => {
        const toolName = `${prefixOf(good)}${suffix}`;
        const result = resolveServer({ toolName, keys: [bad, good] });
        // The invalid key is never a candidate, so it cannot cause ambiguity or be returned.
        const expected = expectedByName(toolName, [good]);
        expect(result).toEqual(expected);
        if (result.ok) expect(result.server).not.toBe(bad);
      }),
      RUNS,
    );
  });
});

describe("Property 7: server resolution examples", () => {
  it("reports ambiguity for nested-prefix keys hollow and hollow-inn", () => {
    expect(
      resolveServer({ toolName: "mcp_hollow_inn_quote", keys: ["hollow", "hollow-inn"] }),
    ).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("resolves a hyphenated key hollow-inn through its sanitised form", () => {
    expect(resolveServer({ toolName: "mcp_hollow_inn_quote", keys: ["hollow-inn"] })).toEqual({
      ok: true,
      server: "hollow-inn",
      tool: "quote",
    });
  });

  it("resolves a plain key", () => {
    expect(resolveServer({ toolName: "mcp_hollowinn_quote", keys: ["hollowinn"] })).toEqual({
      ok: true,
      server: "hollowinn",
      tool: "quote",
    });
  });
});
