import { describe, it } from "vitest";
import fc from "fast-check";
import {
  compileRedact,
  redactConfigSchema,
  type RedactConfig,
} from "../src/redact.js";

// Feature: jar-capture, Property 16: Redact config validation
// **Validates: Requirements 7.1, 7.3, 7.4, 7.5**

const RUNS = { numRuns: 200 };

/** The three top-level keys that Requirement 7.1 requires. */
const REQUIRED_KEYS = ["keys", "patterns", "text"] as const;

/** Non-empty literal patterns. They compile, and they cannot match the empty string. */
const literalPatternArb = fc.stringMatching(/^[a-z]{1,6}$/);

/** Non-empty regular expressions with some structure, all valid and non-empty-matching. */
const structuredPatternArb = fc.constantFrom(
  "Bearer\\s+\\S+",
  "sk-[0-9]{3,}",
  "[a-z]+@x\\.io",
  "\\d+",
  "(ab|cd)+",
);

const validPatternArb = fc.oneof(literalPatternArb, structuredPatternArb);

/** Sources that do not compile as JavaScript regular expressions. */
const invalidPatternPool = ["(", "[", "*", "a{2,1}", "\\"];

/** Sources that compile but match the empty string. */
const emptyMatchPool = ["", "x*", "a?", "^", "(?:)", "b|"];

const validConfigArb: fc.Arbitrary<RedactConfig> = fc.record({
  keys: fc.array(fc.stringMatching(/^[a-z_]{1,12}$/), { maxLength: 6 }),
  patterns: fc.array(validPatternArb, { maxLength: 5 }),
  text: fc.constantFrom<"redact" | "hash">("redact", "hash"),
});

describe("Property 16: Redact config validation", () => {
  it("accepts every valid config and compiles each pattern as a global RegExp", () => {
    fc.assert(
      fc.property(validConfigArb, (config) => {
        if (!redactConfigSchema.safeParse(config).success) return false;
        const result = compileRedact(config);
        if (!result.ok) return false;
        // Requirement 7.5: no flag other than the global flag.
        return result.value.res.every((re) => re.flags === "g");
      }),
      RUNS,
    );
  });

  it("rejects a config that has any key other than keys, patterns and text", () => {
    const extraKeyArb = fc
      .string({ minLength: 1, maxLength: 12 })
      .filter((k) => !(REQUIRED_KEYS as readonly string[]).includes(k));
    fc.assert(
      fc.property(validConfigArb, extraKeyArb, (config, extra) => {
        const withExtra: Record<string, unknown> = { ...config, [extra]: 1 };
        return redactConfigSchema.safeParse(withExtra).success === false;
      }),
      RUNS,
    );
  });

  it("rejects a config that is missing any one of the required keys", () => {
    fc.assert(
      fc.property(validConfigArb, fc.constantFrom(...REQUIRED_KEYS), (config, missing) => {
        const withoutKey: Record<string, unknown> = { ...config };
        delete withoutKey[missing];
        return redactConfigSchema.safeParse(withoutKey).success === false;
      }),
      RUNS,
    );
  });

  it("reports the index of a pattern that is not a valid regular expression", () => {
    fc.assert(
      fc.property(
        fc.array(validPatternArb, { maxLength: 4 }),
        fc.constantFrom(...invalidPatternPool),
        fc.array(validPatternArb, { maxLength: 3 }),
        (before, bad, after) => {
          const result = compileRedact({
            keys: [],
            patterns: [...before, bad, ...after],
            text: "redact",
          });
          return (
            !result.ok && result.patternIndex === before.length
          );
        },
      ),
      RUNS,
    );
  });

  it("reports the index of a pattern that matches the empty string", () => {
    fc.assert(
      fc.property(
        fc.array(validPatternArb, { maxLength: 4 }),
        fc.constantFrom(...emptyMatchPool),
        fc.array(validPatternArb, { maxLength: 3 }),
        (before, empty, after) => {
          const result = compileRedact({
            keys: [],
            patterns: [...before, empty, ...after],
            text: "redact",
          });
          return !result.ok && result.patternIndex === before.length;
        },
      ),
      RUNS,
    );
  });
});
