import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { compileRedact, DEFAULT_REDACT_CONFIG, findTextMembers, parseHeading, redactResponse } from "../src/index.js";

// CodeQL js/polynomial-redos (alerts 5 and 6) flagged two patterns that backtrack quadratically. Both were replaced by
// linear scanners. The old patterns stay here as the oracle: on random inputs built from the characters the patterns
// care about, the scanners must find exactly what the patterns found.

/** The pattern findTextMembers replaced (packages/core/src/redact.ts before this change). */
const TEXT_MEMBER = /"((?:[^"\\\n]|\\.)*)"(\s*:\s*)("(?:[^"\\\n]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{[])/g;

/** The pattern parseHeading replaced (packages/core/src/spec-check.ts before this change). */
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*$/;

function oracleMembers(text: string) {
  return [...text.matchAll(TEXT_MEMBER)].map((m) => ({
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
    rawKey: m[1] ?? "",
    colon: m[2] ?? "",
    value: m[3] ?? "",
  }));
}

function oracleHeading(line: string) {
  const m = HEADING.exec(line);
  return m === null || m[1] === undefined || m[2] === undefined ? undefined : { level: m[1].length, text: m[2] };
}

const memberChars = ['"', '"', '"', "\\", "\\", ":", ":", " ", "\t", "\n", "\r", "\u2028", "a", "k", "0", "7", "-", ".", "e", "E", "+", "{", "[", "t", "r", "u", "f", "n", "l", "s"];
const memberFragments = ['"password"', '"token": ', ': "x"', "true", "false", "null", "-12.5e+3", '\\"', '\\\\', '"a":{', '"k":[', "\\\n"];
const memberText = fc
  .array(fc.oneof({ weight: 4, arbitrary: fc.constantFrom(...memberChars) }, { weight: 1, arbitrary: fc.constantFrom(...memberFragments) }), { maxLength: 80 })
  .map((parts) => parts.join(""));

const headingLine = fc
  .array(fc.constantFrom(" ", " ", "\t", "\t", "#", "#", "#", "a", "b", "\r", "\u2028", "\n"), { maxLength: 24 })
  .map((parts) => parts.join(""));

describe("findTextMembers ≡ the old TEXT_MEMBER pattern", () => {
  it("finds the same members at the same offsets", () => {
    fc.assert(
      fc.property(memberText, (text) => {
        expect(findTextMembers(text)).toEqual(oracleMembers(text));
      }),
      { numRuns: 20_000 },
    );
  });

  it("agrees on the cases the redaction tests rely on", () => {
    for (const text of [
      'Error: {"password":"hunter2"}',
      '"a" "b": 1',
      '"password": "unterminated',
      '"k\\"ey": -0.5e',
      '"x":\n  {"token": null}',
      '"\\"": true, "": false',
    ]) {
      expect(findTextMembers(text)).toEqual(oracleMembers(text));
    }
  });

  it("is linear on the input CodeQL describes: a quote and many repetitions of \\\"!", () => {
    const text = `"${'\\"!'.repeat(200_000)}`;
    const t0 = performance.now();
    expect(findTextMembers(text)).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(1_000);
  });

  it("redacts a plain-text response of that shape quickly and still redacts a sensitive member after it", () => {
    const text = `${'"\\"!'.repeat(50_000)}\nError: {"password":"hunter2"}`;
    const compiled = compileRedact(DEFAULT_REDACT_CONFIG);
    if (!compiled.ok) throw new Error("the default redact config compiles");
    const t0 = performance.now();
    const out = redactResponse(text, compiled.value);
    expect(performance.now() - t0).toBeLessThan(2_000);
    expect(out.responseText).not.toContain("hunter2");
  });
});

describe("parseHeading ≡ the old HEADING pattern", () => {
  it("accepts the same lines with the same level and title", () => {
    fc.assert(
      fc.property(headingLine, (line) => {
        expect(parseHeading(line)).toEqual(oracleHeading(line));
      }),
      { numRuns: 20_000 },
    );
  });

  it("is linear on a long run of tabs", () => {
    const line = `#${"\t".repeat(200_000)}x\t`;
    const t0 = performance.now();
    expect(parseHeading(line)).toEqual({ level: 1, text: "x" });
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
