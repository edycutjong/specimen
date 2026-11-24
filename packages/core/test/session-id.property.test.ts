import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { sessionIdRe, validSessionId } from "../src/index.js";

// Feature: jar-capture, Property 21: Session id validation
// **Validates: Requirements 1.4, 10.1, 10.2, 10.9, 11.19**

const RUNS = { numRuns: 200 };

const FIRST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const REST = `${FIRST}._-`;

/** Ids that match the pattern: one leading alphanumeric, then 0 to 127 allowed characters. */
const allowedIdArb = fc
  .tuple(
    fc.integer({ min: 0, max: FIRST.length - 1 }),
    fc.array(fc.integer({ min: 0, max: REST.length - 1 }), { maxLength: 127 }),
  )
  .map(([first, rest]) => FIRST[first] + rest.map((i) => REST[i]).join(""));

/** Arbitrary strings from a small alphabet that includes every separator the rule cares about. */
const mixedIdArb = fc
  .array(fc.constantFrom(..."aZ09._-/\\ x"), { minLength: 0, maxLength: 140 })
  .map((chars) => chars.join(""));

/** Strings with a path separator or ".." somewhere inside an otherwise valid id. */
const separatorIdArb = fc
  .tuple(
    allowedIdArb,
    fc.constantFrom("/", "\\", ".."),
    fc.string({ unit: "binary", maxLength: 20 }),
  )
  .map(([head, sep, tail]) => `${head}${sep}${tail}`);

describe("Property 21: Session id validation", () => {
  it("accepts exactly the strings matching the pattern with no '..'", () => {
    fc.assert(
      fc.property(mixedIdArb, (s) => {
        const expected = sessionIdRe.test(s) && !s.includes("..");
        expect(validSessionId(s)).toBe(expected);
      }),
      RUNS,
    );
  });

  it("accepts every generated id that follows the pattern", () => {
    // "..", which the pattern alone allows, is rejected by validSessionId, so it is excluded here.
    fc.assert(
      fc.property(allowedIdArb.filter((s) => !s.includes("..")), (s) => {
        expect(sessionIdRe.test(s)).toBe(true);
        expect(validSessionId(s)).toBe(true);
      }),
      RUNS,
    );
  });

  it("rejects any id that contains '/', '\\' or '..'", () => {
    fc.assert(
      fc.property(separatorIdArb, (s) => {
        expect(validSessionId(s)).toBe(false);
      }),
      RUNS,
    );
  });

  it("rejects ids that are empty, start with a separator, or exceed 128 characters", () => {
    expect(validSessionId("")).toBe(false);
    expect(validSessionId(".hidden")).toBe(false);
    expect(validSessionId("-flag")).toBe(false);
    expect(validSessionId("a".repeat(128))).toBe(true);
    expect(validSessionId("a".repeat(129))).toBe(false);
  });
});
