import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  jarLineSchema,
  readJar,
  serializeJarLine,
  type Json,
} from "../src/index.js";

// Feature: jar-capture, Property 1: Jar_Line round trip and single-line form
// **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 1.17, 11.13**

const RUNS = { numRuns: 200 };
const MAX_INT32 = 2147483647;

type Raw = Record<string, unknown>;

/** Removes keys whose value is undefined, so a generated object only carries present fields. */
function dropUndefined(o: Raw): Raw {
  const out: Raw = {};
  for (const key of Object.keys(o)) {
    if (o[key] !== undefined) out[key] = o[key];
  }
  return out;
}

/** Builds an object with defineProperty so a key named "__proto__" stays an own data property. */
function makeObject(entries: Array<[string, Json]>): { [k: string]: Json } {
  const out: { [k: string]: Json } = {};
  for (const [key, value] of entries) {
    Object.defineProperty(out, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/** Own data value of a key, read without touching the prototype chain. */
function ownValue(obj: object, key: string): Json {
  return Object.getOwnPropertyDescriptor(obj, key)?.value as Json;
}

/** Deep equality over own data properties. Keys such as "__proto__" compare as keys. */
function sameJson(a: Json, b: Json): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a !== "object" || typeof b !== "object") {
    return typeof a === typeof b && Object.is(a, b);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => sameJson(item, b[i]!));
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      sameJson(ownValue(a, key), ownValue(b, key)),
  );
}

/** Normalises -0 to 0, since JSON text cannot tell them apart. */
const normZero = (n: number): number => (Object.is(n, -0) ? 0 : n);

/** Keys that stress the object model, plus separators and characters above U+FFFF. */
const KEY_POOL = ["__proto__", "constructor", "", "a", "b.c", "/", "~", "\n", "\u2028", "\u{1F600}"];
const keyArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...KEY_POOL),
  fc.string({ unit: "binary", maxLength: 8 }),
);

/**
 * Arbitrary text. It mixes raw control characters, line breaks, quotes, backslashes and
 * binary code units, so the single-line check sees the characters most likely to leak a
 * raw newline.
 */
const textArb: fc.Arbitrary<string> = fc
  .array(
    fc.oneof(
      fc.constantFrom("\n", "\r", "\r\n", "\t", "\\", '"', "\u2028", "\u0000", "\u001f"),
      fc.string({ unit: "binary", maxLength: 4 }),
    ),
    { maxLength: 8 },
  )
  .map((parts) => parts.join(""));

const nonEmptyText: fc.Arbitrary<string> = textArb.filter((s) => s.length > 0);

const leafArb: fc.Arbitrary<Json> = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }).map(normZero),
  textArb,
);

const jsonArb: fc.Arbitrary<Json> = fc.letrec<{ json: Json }>((tie) => ({
  json: fc.oneof(
    { maxDepth: 3 },
    leafArb,
    fc.array(tie("json"), { maxLength: 3 }),
    fc.array(fc.tuple(keyArb, tie("json")), { maxLength: 4 }).map(makeObject),
  ),
})).json;

/** Session ids that match the pattern and contain no "..". */
const sessionIdArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.constantFrom(..."aZ9"),
    fc.array(fc.constantFrom(..."aZ9._-"), { maxLength: 20 }).map((c) => c.join("")),
  )
  .map(([head, tail]) => head + tail)
  .filter((s) => !s.includes(".."));

const idArb: fc.Arbitrary<string> = fc
  .integer({ min: 1, max: 999999 })
  .map((n) => "SPC-" + String(n).padStart(4, "0"));

const pad2 = (n: number): string => String(n).padStart(2, "0");

const instantArb: fc.Arbitrary<Date> = fc.date({
  min: new Date("1971-01-01T00:00:00.000Z"),
  max: new Date("2999-12-31T23:59:59.999Z"),
  noInvalidDate: true,
});

/** UTC timestamps, written with a Z designator. */
const utcStampArb: fc.Arbitrary<string> = instantArb.map((d) => d.toISOString());

/** Timestamps with a numeric offset, written as local time plus +hh:mm or -hh:mm. */
const offsetStampArb: fc.Arbitrary<string> = fc
  .tuple(instantArb, fc.integer({ min: -720, max: 840 }))
  .map(([d, mins]) => {
    const local = new Date(d.getTime() + mins * 60000).toISOString().slice(0, -1);
    const abs = Math.abs(mins);
    const sign = mins < 0 ? "-" : "+";
    return `${local}${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
  });

const stampArb: fc.Arbitrary<string> = fc.oneof(utcStampArb, offsetStampArb);

/** JSON pointers into input or response. Tokens use the only legal escapes, ~0 and ~1. */
const tokenArb: fc.Arbitrary<string> = fc
  .array(fc.constantFrom("a", "B", "_", "0", "é", "~0", "~1"), { maxLength: 3 })
  .map((parts) => parts.join(""));
const pointerArb: fc.Arbitrary<string> = fc
  .tuple(fc.constantFrom("input", "response"), fc.array(tokenArb, { maxLength: 3 }))
  .map(([head, tokens]) => ["/" + head, ...tokens.map((t) => "/" + t)].join(""));

const hexDigitArb = fc.constantFrom(..."0123456789abcdef");
const sha256TextArb: fc.Arbitrary<string> = fc
  .array(hexDigitArb, { minLength: 64, maxLength: 64 })
  .map((digits) => "sha256:" + digits.join(""));

const optBool: fc.Arbitrary<boolean | undefined> = fc.option(fc.boolean(), { nil: undefined });

/** Fields shared by every Jar_Line. */
const coreArb: fc.Arbitrary<Raw> = fc.record({
  v: fc.constant(1),
  id: idArb,
  session_id: sessionIdArb,
  seq: fc.integer({ min: 1, max: MAX_INT32 }),
  server: nonEmptyText,
  tool: nonEmptyText,
  tool_id: nonEmptyText,
  input: jsonArb,
  t0: stampArb,
  t1: stampArb,
  duration_ms: fc.integer({ min: 0, max: MAX_INT32 }),
  redacted: fc.array(pointerArb, { maxLength: 4 }),
});

/** A plain response: any text, and a JSON value or null. No response_length. */
const plainTailArb: fc.Arbitrary<Raw> = fc.record({
  response_text: textArb,
  response: fc.oneof(jsonArb, fc.constant(null)),
  text_redacted: optBool,
  unpaired: optBool,
});

/** A hashed response: the sha256 text form, a null response and a response_length. */
const hashedTailArb: fc.Arbitrary<Raw> = fc.record({
  response_text: sha256TextArb,
  response: fc.constant(null),
  text_redacted: fc.constant(true),
  unpaired: optBool,
  response_length: fc.integer({ min: 0, max: 1000000 }),
});

const lineArb: fc.Arbitrary<Raw> = fc
  .tuple(coreArb, fc.oneof(plainTailArb, hashedTailArb))
  .map(([core, tail]) => dropUndefined({ ...core, ...tail }));

const SHA256_FORM = /^sha256:[0-9a-f]{64}$/;

describe("Jar_Line round trip and single-line form (Property 1)", () => {
  it("serialises every valid Jar_Line to exactly one newline-terminated line with no raw control characters", () => {
    fc.assert(
      fc.property(lineArb, (raw) => {
        const line = jarLineSchema.parse(raw);
        const text = serializeJarLine(line);

        expect(text.endsWith("\n")).toBe(true);
        expect(text.split("\n")).toHaveLength(2);

        const body = text.slice(0, -1);
        for (let i = 0; i < body.length; i++) {
          expect(body.charCodeAt(i)).toBeGreaterThanOrEqual(0x20);
        }
        expect(body.includes("\r")).toBe(false);
      }),
      RUNS,
    );
  });

  it("parses the serialised line back to a deep-equal Jar_Line with no errors", () => {
    fc.assert(
      fc.property(lineArb, (raw) => {
        const line = jarLineSchema.parse(raw);
        const result = readJar(serializeJarLine(line));

        expect(result.errors).toEqual([]);
        expect(result.lines).toHaveLength(1);
        expect(result.lines[0]).toEqual(line);
        expect(sameJson(result.lines[0] as unknown as Json, line as unknown as Json)).toBe(true);
      }),
      RUNS,
    );
  });

  it("accepts a response_length only with a sha256 response_text and a null response", () => {
    fc.assert(
      fc.property(hashedTailArb, coreArb, (tail, core) => {
        const hashed = dropUndefined({ ...core, ...tail });
        expect(jarLineSchema.safeParse(hashed).success).toBe(true);

        const withResponse = { ...hashed, response: { total: 425 } };
        expect(jarLineSchema.safeParse(withResponse).success).toBe(false);
      }),
      RUNS,
    );
  });

  it("rejects a response_length on a response_text that is not the sha256 form", () => {
    fc.assert(
      fc.property(plainTailArb, coreArb, fc.integer({ min: 0, max: 1000000 }), (tail, core, n) => {
        const text = tail.response_text as string;
        fc.pre(!SHA256_FORM.test(text));
        const plain = dropUndefined({ ...core, ...tail, response: null });
        expect(jarLineSchema.safeParse({ ...plain, response_length: n }).success).toBe(false);
      }),
      RUNS,
    );
  });
});
