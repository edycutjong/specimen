import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { pluralise } from "../../src/cabinet-model.js";

// Feature: cabinet-ui, Property 3: Count-formatting pluralisation is consistent
// **Validates: Requirements 6.10**

const RUNS = { numRuns: 200 };

/** Non-negative counts, biased so that 1 and small counts come up often. */
const countArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 3, arbitrary: fc.constant(1) },
  { weight: 2, arbitrary: fc.constant(0) },
  { weight: 3, arbitrary: fc.integer({ min: 0, max: 20 }) },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }) },
);

/** Singular and plural noun pairs that the Cabinet renders with a count. */
const nounArb: fc.Arbitrary<[string, string]> = fc.constantFrom(
  ["jar", "jars"],
  ["tool", "tools"],
  ["field", "fields"],
  ["red jar", "red jars"],
);

describe("pluralise (Property 3)", () => {
  it("uses the singular noun exactly when the count is 1, and the plural otherwise", () => {
    fc.assert(
      fc.property(countArb, nounArb, (count, [singular, plural]) => {
        const phrase = pluralise(count, singular, plural);
        const expectedWord = count === 1 ? singular : plural;

        expect(phrase).toBe(`${count} ${expectedWord}`);
        expect(phrase.endsWith(` ${singular}`)).toBe(count === 1);
        expect(phrase.endsWith(` ${plural}`)).toBe(count !== 1);
      }),
      RUNS,
    );
  });

  it("formats zero with the plural form, as the Cabinet shows '0 jars'", () => {
    expect(pluralise(0, "jar", "jars")).toBe("0 jars");
  });

  it("formats one with the singular form and two with the plural form", () => {
    expect(pluralise(1, "jar", "jars")).toBe("1 jar");
    expect(pluralise(2, "jar", "jars")).toBe("2 jars");
  });
});
