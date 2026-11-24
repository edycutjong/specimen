import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { isJsonResponse } from "../src/json.js";
import { DEFAULT_REDACT_CONFIG, MARKER, compileRedact, redactResponse } from "../src/redact.js";

// Feature: jar-capture, Property 14: Text response redaction and hash mode
// **Validates: Requirements 7.18, 7.19, 7.20**

const RUNS = { numRuns: 200 };

/** Pattern pool: the shipped default plus one custom pattern. None of them matches inside MARKER. */
const PATTERN_POOL: string[] = [...DEFAULT_REDACT_CONFIG.patterns, "ZZ\\d{2}"];

/** Text fragments. Several match a pattern, so matches and non-matches both occur. */
const SEGMENTS = [
  "Bearer tok9",
  "Bearer  x.y",
  "sk-abcdefghijklmnopqrst",
  "a@b.co",
  "ZZ42",
  "ZZ4",
  "425.00",
  "plain text",
  "x",
  " ",
  '"',
  "\\",
  "/",
  "\n",
  "é",
  "€",
  "{",
  "]",
  "token",
];

const textArb = fc.oneof(
  { weight: 3, arbitrary: fc.array(fc.constantFrom(...SEGMENTS), { maxLength: 8 }).map((p) => p.join("")) },
  { weight: 1, arbitrary: fc.string({ maxLength: 40 }) },
);

const configArb = fc.record({
  patterns: fc.uniqueArray(fc.constantFrom(...PATTERN_POOL), { minLength: 1 }),
  text: fc.constantFrom("redact" as const, "hash" as const),
});

/** Oracle: every match of every pattern, in pattern order, becomes the marker. */
function replaceOracle(s: string, patterns: readonly string[]): string {
  let out = s;
  for (const p of patterns) {
    out = out.replace(new RegExp(p, "g"), MARKER);
  }
  return out;
}

/** True when some pattern still has a non-empty match in the string. */
function hasMatch(s: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => [...s.matchAll(new RegExp(p, "g"))].some((m) => m[0].length > 0));
}

describe("redactResponse property: text response redaction and hash mode", () => {
  it("replaces every match in redact mode, and stores only the hash and length in hash mode", () => {
    fc.assert(
      fc.property(textArb, configArb, (raw, cfg) => {
        // Only non-JSON text takes the text path. JSON responses are covered by Property 13.
        fc.pre(!isJsonResponse(raw));

        const compiled = compileRedact({
          keys: DEFAULT_REDACT_CONFIG.keys,
          patterns: cfg.patterns,
          text: cfg.text,
        });
        expect(compiled.ok).toBe(true);
        if (!compiled.ok) return;

        const replaced = replaceOracle(raw, cfg.patterns);
        // Every match is gone after replacement, so the marker covers each one.
        expect(hasMatch(replaced, cfg.patterns)).toBe(false);

        const result = redactResponse(raw, compiled.value);

        // Both modes set textRedacted, and text responses have no pointers.
        expect(result.textRedacted).toBe(true);
        expect(result.pointers).toEqual([]);

        if (cfg.text === "redact") {
          // Redact mode keeps the text with each match replaced by the marker.
          expect(result.responseText).toBe(replaced);
          expect(result.response).toBeNull();
          expect(result.responseLength).toBeUndefined();
          return;
        }

        // Hash mode: the stored text is the SHA-256 of the replaced text, with the hash computed
        // by node:crypto as an independent reference.
        const digest = createHash("sha256").update(replaced, "utf8").digest("hex");
        expect(result.responseText).toBe(`sha256:${digest}`);
        expect(result.responseText).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(result.responseLength).toBe(replaced.length);
        expect(result.response).toBeNull();

        // The raw text and the replaced text appear nowhere in the stored output. Strings shorter
        // than 8 characters are skipped because they can occur inside the hex digest by chance.
        if (raw.length >= 8) {
          expect(result.responseText).not.toContain(raw);
        }
        if (replaced.length >= 8) {
          expect(result.responseText).not.toContain(replaced);
        }
        expect(result.responseText).not.toContain(MARKER);
      }),
      RUNS,
    );
  });
});
