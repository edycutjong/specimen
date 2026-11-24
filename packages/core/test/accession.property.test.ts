import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  formatAccession,
  jarLineSchema,
  maxAccession,
  parseAccession,
  parseCounter,
  serializeJarLine,
  type JarLine,
} from "../src/index.js";

// Feature: jar-capture, Property 11: Accession ids
// **Validates: Requirements 2.1, 2.2, 2.3, 2.7, 2.8, 11.17**

const RUNS = { numRuns: 200 };
const MAX = Number.MAX_SAFE_INTEGER;
const ACCESSION_SHAPE = /^SPC-\d{4,}$/;

/** Safe integers from 1 to Number.MAX_SAFE_INTEGER. */
const validNArb = fc.integer({ min: 1, max: MAX });

/** Integers from 1 to 1100 that cross the four-digit to five-digit width boundary at 10000 as well. */
const sequenceStartArb = fc.integer({ min: 1, max: MAX - 1200 });

/** Non-negative integers from 0 to Number.MAX_SAFE_INTEGER, as decimal text. */
const counterTextArb = fc.integer({ min: 0, max: MAX }).map((n) => String(n));

/** Strings that cannot be a complete Jar_Line: no line breaks, and not an accession-shaped garbage line. */
const garbageLineArb = fc.oneof(
  fc.constantFrom(
    "not json",
    "{",
    "[1,2]",
    "null",
    '{"id":"SPC-1"}',
    '{"v":1,"id":"SPC-0009"',
    "SPC-0042",
  ),
  fc
    .string({ maxLength: 80 })
    .filter((s) => !/[\n\r]/.test(s) && s.trim() !== ""),
);

function lineWithId(id: string, seq: number): JarLine {
  const result = jarLineSchema.safeParse({
    v: 1,
    id,
    session_id: "sess-1",
    seq,
    server: "hollowinn",
    tool: "quote",
    tool_id: "mcp_hollowinn_quote",
    input: { room_id: "r-04" },
    response_text: "ok",
    response: null,
    t0: "2025-01-01T10:00:00.000Z",
    t1: "2025-01-01T10:00:00.010Z",
    duration_ms: 10,
    redacted: [],
  });
  if (!result.success) throw new Error("fixture is not a valid Jar_Line");
  return result.data;
}

describe("Property 11: Accession ids", () => {
  it("parseAccession(formatAccession(n)) returns n for every valid n, in the accession shape", () => {
    fc.assert(
      fc.property(validNArb, (n) => {
        const id = formatAccession(n);
        expect(id).toMatch(ACCESSION_SHAPE);
        expect(parseAccession(id)).toBe(n);
      }),
      RUNS,
    );
  });

  it("formatAccession rejects negative, fractional and unsafe values", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -MAX, max: -1 }),
          fc
            .double({ min: 0, max: MAX, noNaN: true, noDefaultInfinity: true })
            .filter((x) => !Number.isInteger(x)),
          fc
            .bigInt({ min: BigInt(MAX) + 1n, max: 2n ** 80n })
            .map((b) => Number(b)),
          fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
        ),
        (n) => {
          expect(() => formatAccession(n)).toThrow(RangeError);
        },
      ),
      RUNS,
    );
  });

  it("parseCounter matches the non-negative integer rule for any text", () => {
    fc.assert(
      fc.property(
        fc.oneof(counterTextArb, fc.string({ maxLength: 40 })),
        fc.constantFrom("", " ", "\n", "\t"),
        (text, pad) => {
          const padded = pad + text + pad;
          const trimmed = padded.trim();
          const isCounter = /^[0-9]+$/.test(trimmed) && BigInt(trimmed) <= BigInt(MAX);
          expect(parseCounter(padded)).toBe(isCounter ? Number(trimmed) : undefined);
        },
      ),
      RUNS,
    );
  });

  it("parseCounter round-trips every safe non-negative integer and ignores values above the safe range", () => {
    fc.assert(
      fc.property(
        validNArb.map((n) => n - 1),
        fc.bigInt({ min: BigInt(MAX) + 1n, max: 2n ** 80n }),
        (n, big) => {
          expect(parseCounter(String(n) + "\n")).toBe(n);
          expect(parseCounter(big.toString())).toBeUndefined();
        },
      ),
      RUNS,
    );
  });

  it("parseAccession ignores ids whose number is above the safe range", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: BigInt(MAX) + 1n, max: 2n ** 80n }),
        (big) => {
          expect(parseAccession(`SPC-${big.toString()}`)).toBeUndefined();
        },
      ),
      RUNS,
    );
  });

  it("maxAccession equals the largest safe id on a valid line, and ignores garbage and unsafe ids", () => {
    const validEntryArb = fc.oneof(
      validNArb.map((n) => ({ kind: "valid" as const, n })),
      fc
        .bigInt({ min: BigInt(MAX) + 1n, max: 2n ** 80n })
        .map((b) => ({ kind: "unsafe" as const, n: b.toString() })),
    );
    const lineArb = fc.oneof(
      { weight: 3, arbitrary: validEntryArb.map((e) => ({ kind: "jar" as const, e })) },
      { weight: 2, arbitrary: garbageLineArb.map((text) => ({ kind: "garbage" as const, text })) },
    );

    fc.assert(
      fc.property(
        fc.array(fc.array(lineArb, { maxLength: 12 }), { maxLength: 4 }),
        (jars) => {
          let expected = 0;
          const texts = jars.map((entries, jarIndex) => {
            let text = "";
            entries.forEach((entry, i) => {
              if (entry.kind === "garbage") {
                text += entry.text + "\n";
                return;
              }
              const id = entry.e.kind === "valid" ? formatAccession(entry.e.n) : `SPC-${entry.e.n}`;
              text += serializeJarLine(lineWithId(id, jarIndex * 100 + i + 1));
              if (entry.e.kind === "valid" && entry.e.n > expected) expected = entry.e.n;
            });
            return text;
          });
          expect(maxAccession(texts)).toBe(expected);
        },
      ),
      RUNS,
    );
  });

  it("ids for sequential n are unique and strictly increasing, across the width boundary", () => {
    fc.assert(
      fc.property(sequenceStartArb, (start) => {
        const ids: string[] = [];
        for (let n = start; n < start + 1200; n++) ids.push(formatAccession(n));
        expect(new Set(ids).size).toBe(ids.length);
        const numbers = ids.map((id) => parseAccession(id));
        for (let i = 1; i < numbers.length; i++) {
          const prev = numbers[i - 1];
          const cur = numbers[i];
          expect(prev).toBeDefined();
          expect(cur).toBeDefined();
          expect(cur!).toBeGreaterThan(prev!);
        }
      }),
      { numRuns: 100 },
    );
  });
});
