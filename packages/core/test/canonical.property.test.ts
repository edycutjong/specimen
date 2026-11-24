import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { canonicalJson, type Json } from "../src/index.js";

// Feature: jar-capture, Property 4: Canonical JSON invariants
// **Validates: Requirements 3.6, 3.7, 3.8**

const RUNS = { numRuns: 200 };

/** Keys that stress the object model, plus surrogates and characters above U+FFFF. */
const KEY_POOL = [
  "__proto__",
  "constructor",
  "prototype",
  "toString",
  "hasOwnProperty",
  "a",
  "B",
  "é",
  "\uFFFD",
  "\uE000",
  "\u{1F600}",
  "",
];
const keyArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom(...KEY_POOL),
  fc.string({ unit: "binary" }),
);

/** Normalises -0 to 0, since JSON text cannot tell them apart. */
const normZero = (n: number): number => (Object.is(n, -0) ? 0 : n);

const leafArb: fc.Arbitrary<Json> = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer(),
  fc.double({ noNaN: true, noDefaultInfinity: true }).map(normZero),
  fc.string({ unit: "binary" }),
);

/**
 * Builds an object with defineProperty, so a key named "__proto__" becomes an own data
 * property. Later entries with the same key replace earlier ones.
 */
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

const jsonArb: fc.Arbitrary<Json> = fc.letrec<{ json: Json }>((tie) => ({
  json: fc.oneof(
    { maxDepth: 4 },
    leafArb,
    fc.array(tie("json"), { maxLength: 4 }),
    fc.array(fc.tuple(keyArb, tie("json")), { maxLength: 5 }).map(makeObject),
  ),
})).json;

/** Own data value of a key, read without touching the prototype chain. */
function ownValue(obj: object, key: string): Json {
  return Object.getOwnPropertyDescriptor(obj, key)?.value as Json;
}

/** Rebuilds a value with every object's keys in a seeded random insertion order. */
function reorderKeys(value: Json, seed: number): Json {
  let state = seed >>> 0;
  const nextRandom = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const walk = (v: Json): Json => {
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      const entries: Array<[string, Json]> = Object.keys(v).map((key) => [
        key,
        walk(ownValue(v, key)),
      ]);
      for (let i = entries.length - 1; i > 0; i--) {
        const j = Math.floor(nextRandom() * (i + 1));
        [entries[i], entries[j]] = [entries[j]!, entries[i]!];
      }
      return makeObject(entries);
    }
    return v;
  };
  return walk(value);
}

/** Compares strings by UTF-16 code unit, written here without the default sort. */
function compareUtf16(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const diff = a.charCodeAt(i) - b.charCodeAt(i);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}

/** Independent reference for Canonical_JSON, used as the oracle. */
function referenceCanonical(value: Json): string {
  if (Array.isArray(value)) {
    return "[" + value.map(referenceCanonical).join(",") + "]";
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value)
      .sort(compareUtf16)
      .map((key) => JSON.stringify(key) + ":" + referenceCanonical(ownValue(value, key)));
    return "{" + entries.join(",") + "}";
  }
  return JSON.stringify(value);
}

/** Deep equality over own data properties, so "__proto__" keys compare as keys. */
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

describe("canonicalJson invariants (Property 4)", () => {
  it("gives the same text for values that differ only in object key order", () => {
    fc.assert(
      fc.property(jsonArb, fc.integer(), (value, seed) => {
        expect(canonicalJson(reorderKeys(value, seed))).toBe(canonicalJson(value));
      }),
      RUNS,
    );
  });

  it("matches a reference that sorts keys by UTF-16 code unit at every depth", () => {
    fc.assert(
      fc.property(jsonArb, (value) => {
        expect(canonicalJson(value)).toBe(referenceCanonical(value));
      }),
      RUNS,
    );
  });

  it("round-trips: parsing the canonical text gives back a deep-equal value", () => {
    fc.assert(
      fc.property(jsonArb, (value) => {
        const parsed = JSON.parse(canonicalJson(value)) as Json;
        expect(sameJson(parsed, value)).toBe(true);
      }),
      RUNS,
    );
  });

  it("keeps array order and writes arrays without sorting their items", () => {
    fc.assert(
      fc.property(fc.array(jsonArb, { maxLength: 6 }), (items) => {
        const text = canonicalJson(items);
        expect(text).toBe("[" + items.map(canonicalJson).join(",") + "]");
        expect(sameJson(JSON.parse(text) as Json, items)).toBe(true);
      }),
      RUNS,
    );
  });

  it("treats __proto__ and constructor as ordinary keys in generated objects", () => {
    fc.assert(
      fc.property(jsonArb, jsonArb, jsonArb, (protoValue, ctorValue, rest) => {
        const value = makeObject([
          ["__proto__", protoValue],
          ["constructor", ctorValue],
          ["z", rest],
        ]);
        const text = canonicalJson(value);
        expect(text).toBe(referenceCanonical(value));
        const parsed = JSON.parse(text) as Json;
        expect(Object.prototype.hasOwnProperty.call(parsed, "__proto__")).toBe(true);
        expect(sameJson(ownValue(parsed as object, "__proto__"), protoValue)).toBe(true);
        expect(sameJson(ownValue(parsed as object, "constructor"), ctorValue)).toBe(true);
      }),
      RUNS,
    );
  });

  it("does not let a __proto__ key pollute Object.prototype", () => {
    const value = JSON.parse('{"__proto__":{"polluted":1}}') as Json;
    expect(canonicalJson(value)).toBe('{"__proto__":{"polluted":1}}');
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("sorts by UTF-16 code unit, so U+1F600 sorts before U+FFFD (the requirement order)", () => {
    // Code point order would place U+FFFD first. Requirement 3.6 and the glossary define
    // Canonical_JSON with UTF-16 code unit order, so this pins that choice.
    const value = JSON.parse('{"\\uFFFD":1,"\\ud83d\\ude00":2}') as Json;
    expect(canonicalJson(value)).toBe('{"\u{1F600}":2,"\uFFFD":1}');
  });

  it("sorts ASCII keys and puts the shorter of a prefix pair first", () => {
    expect(canonicalJson({ ab: 1, a: 2, B: 3, b: 4 })).toBe('{"B":3,"a":2,"ab":1,"b":4}');
  });
});
