import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { canonicalJson, isJsonResponse, type Json } from "../src/json.js";
import {
  DEFAULT_REDACT_CONFIG,
  MARKER,
  compileRedact,
  redactInput,
  redactResponse,
} from "../src/redact.js";

// Feature: jar-capture, Property 15: Redaction idempotence
// **Validates: Requirements 7.23**

const RUNS = { numRuns: 200 };

const compiled = compileRedact(DEFAULT_REDACT_CONFIG);
if (!compiled.ok) throw new Error("default redact config must compile");
const config = compiled.value;

/** Keys the generator draws from. Some are sensitive under the default config, some are not. */
const KEY_POOL = [
  "password",
  "token",
  "authorization",
  "secret",
  "api_key",
  "custom_secret",
  "room",
  "guest",
  "notes",
  "a/b~c",
  "__proto__",
  "constructor",
];

/** String fragments. Several match a default pattern, so both redacted and kept strings occur. */
const SEGMENTS = [
  "Bearer tok9",
  "Bearer  x.y",
  "sk-abcdefghijklmnopqrst",
  "guest@example.com",
  "plain",
  "room 12",
  "425.00",
  " ",
  '"',
  "\\",
  "/",
  "\n",
  "é",
  "€",
  "~",
  "{",
  "]",
  ",",
  ":",
];

const stringArb = fc
  .array(fc.constantFrom(...SEGMENTS), { maxLength: 3 })
  .map((parts) => parts.join(""));

/** Builds an object with own data properties, so a key named `__proto__` stays an ordinary key. */
function ownObject(entries: { key: string; value: Json }[]): { [k: string]: Json } {
  const out: { [k: string]: Json } = {};
  for (const { key, value } of entries) {
    Object.defineProperty(out, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

const leafArb: fc.Arbitrary<Json> = fc.oneof(
  { weight: 3, arbitrary: stringArb },
  { weight: 1, arbitrary: fc.double({ noNaN: true, noDefaultInfinity: true }) },
  { weight: 1, arbitrary: fc.boolean() },
  { weight: 1, arbitrary: fc.constant(null) },
);

/** Random JSON-like trees whose object keys come from the pool, so sensitive keys occur often. */
const tree = fc.letrec<{ node: Json; arr: Json; obj: Json; root: Json }>((tie) => ({
  node: fc.oneof({ maxDepth: 4 }, leafArb, tie("arr"), tie("obj")),
  arr: fc.array(tie("node") as fc.Arbitrary<Json>, { maxLength: 4 }),
  obj: fc
    .array(
      fc.record({
        key: fc.constantFrom(...KEY_POOL),
        value: tie("node") as fc.Arbitrary<Json>,
      }),
      { maxLength: 5 },
    )
    .map((entries) => ownObject(entries)),
  root: fc.oneof(tie("arr"), tie("obj")) as fc.Arbitrary<Json>,
}));

/** Any JSON-like value, used as tool input. */
const valueArb: fc.Arbitrary<Json> = tree.node;

/** A root object or array, used as a JSON response. */
const rootArb: fc.Arbitrary<Json> = tree.root;

/** Serialises a root object or array with random indentation. */
const jsonTextArb = fc
  .tuple(rootArb, fc.constantFrom<number | undefined>(undefined, 0, 2))
  .map(([value, indent]) => JSON.stringify(value, null, indent));

/** Non-JSON text. The fixed prefix keeps every sample out of JSON.parse, so the text path runs. */
const plainTextArb = stringArb.map((s) => `T:${s}`);

/** True when the pointers of the second pass all occur in the first pass. */
function noNewPointers(first: string[], second: string[]): boolean {
  const known = new Set(first);
  return second.every((ptr) => known.has(ptr));
}

describe("redaction idempotence (Property 15)", () => {
  it("the default patterns never match inside a string that contains the marker", () => {
    // Precondition of Property 15. Every default pattern must have no non-empty match that
    // overlaps the marker, in any surrounding context, so a second pass cannot find new matches.
    const probes = ["", "a", "@", "Bearer ", "sk-", " ", ".co", "9", "x.y"];
    for (const prefix of probes) {
      for (const suffix of probes) {
        const probe = `${prefix}${MARKER}${suffix}`;
        const start = prefix.length;
        const end = start + MARKER.length;
        for (const source of DEFAULT_REDACT_CONFIG.patterns) {
          for (const m of probe.matchAll(new RegExp(source, "g"))) {
            const at = m.index ?? 0;
            const overlaps = at < end && at + m[0].length > start && m[0].length > 0;
            expect(overlaps, `${source} matches inside the marker in "${probe}"`).toBe(false);
          }
        }
      }
    }
  });

  it("redacting a redacted JSON response gives the same text and no new pointers", () => {
    fc.assert(
      fc.property(jsonTextArb, (text) => {
        const first = redactResponse(text, config);
        const second = redactResponse(first.responseText, config);

        expect(second.responseText).toBe(first.responseText);
        expect(noNewPointers(first.pointers, second.pointers)).toBe(true);
        expect(second.textRedacted).toBe(false);
        expect(canonicalJson(second.response as Json)).toBe(canonicalJson(first.response as Json));
      }),
      RUNS,
    );
  });

  it("redacting a redacted text response gives the same text and no pointers", () => {
    fc.assert(
      fc.property(plainTextArb, (text) => {
        expect(isJsonResponse(text)).toBe(false);

        const first = redactResponse(text, config);
        const second = redactResponse(first.responseText, config);

        expect(second.responseText).toBe(first.responseText);
        expect(second.pointers).toEqual([]);
        expect(first.pointers).toEqual([]);
        expect(second.textRedacted).toBe(true);
      }),
      RUNS,
    );
  });

  it("redacting a redacted input gives the same value and no new pointers", () => {
    fc.assert(
      fc.property(valueArb, (input) => {
        const first = redactInput(input, config);
        const second = redactInput(first.value, config);

        expect(canonicalJson(second.value)).toBe(canonicalJson(first.value));
        expect(noNewPointers(first.pointers, second.pointers)).toBe(true);
      }),
      RUNS,
    );
  });
});
