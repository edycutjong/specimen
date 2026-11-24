import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Json,
  type VolatilePolicy,
  SHIPPED_VOLATILE_POLICY,
  canonicalJson,
  normalize,
} from "../src/index.js";

const EMPTY: VolatilePolicy = { volatile: [] };
const RUNS = { numRuns: 200 };

// Object keys include the two names that must stay ordinary keys, and digits so that arrays
// and objects can share the same key shapes. Glob segments never use digits, so a glob cannot
// remove an array element by a literal index; those removals reindex and are covered by the
// example tests instead.
const KEYS = fc.constantFrom("a", "b", "c", "created_at", "__proto__", "constructor", "0", "1");

const GLOB_SEGMENT = fc.constantFrom("*", "a", "b", "created_at", "__proto__", "constructor");

const globArb = fc
  .array(GLOB_SEGMENT, { minLength: 1, maxLength: 3 })
  .map((segments) => "/" + segments.join("/"));

const policyArb: fc.Arbitrary<VolatilePolicy> = fc
  .array(globArb, { maxLength: 3 })
  .map((volatile) => ({ volatile }));

/** A JSON Body (object or array) built from parsed text, so "__proto__" is an own key. */
const bodyArb: fc.Arbitrary<Json> = fc
  .oneof(
    fc.dictionary(KEYS, fc.jsonValue({ maxDepth: 3 }), { maxKeys: 5 }),
    fc.array(fc.jsonValue({ maxDepth: 3 }), { maxLength: 4 }),
  )
  .map((value) => JSON.parse(JSON.stringify(value)) as Json);

const CRLF_TEXT = fc.array(fc.constantFrom("\r", "\n", "a", " ", "é"), { maxLength: 40 }).map((parts) =>
  parts.join(""),
);

describe("normalize", () => {
  // Feature: replay-engine, Property 5: Normalisation is idempotent and a no-op under an empty policy
  it("Property 5: Normalisation is idempotent and a no-op under an empty policy", () => {
    fc.assert(
      fc.property(bodyArb, policyArb, (body, policy) => {
        const once = normalize(body, policy);
        const twice = normalize(once.value as Json, policy);
        expect(canonicalJson(twice.value as Json)).toBe(canonicalJson(once.value as Json));
        expect(twice.removed).toEqual([]);

        const untouched = normalize(body, EMPTY);
        expect(canonicalJson(untouched.value as Json)).toBe(canonicalJson(body));
        expect(untouched.removed).toEqual([]);
      }),
      RUNS,
    );
  });

  // Feature: replay-engine, Property 6: Non-JSON normalisation only touches line endings
  it("Property 6: Non-JSON normalisation only touches line endings", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), CRLF_TEXT), (text) => {
        const result = normalize(text, SHIPPED_VOLATILE_POLICY);
        expect(result.value).toBe(text.replace(/\r\n/g, "\n"));
        expect(result.removed).toEqual([]);
        expect(result.depthLimited).toBe(false);
      }),
      RUNS,
    );
  });

  it("parses the literal 425.00 as the number 425", () => {
    const body = JSON.parse('{"total":425.00}') as Json;
    const result = normalize(body, EMPTY);
    expect(result.value).toEqual({ total: 425 });
    expect(typeof (result.value as { total: Json }).total).toBe("number");
  });

  it("leaves the Body unchanged when a glob matches nothing", () => {
    const body = JSON.parse('{"a":1,"list":[1,2],"nested":{"b":true}}') as Json;
    const result = normalize(body, { volatile: ["/nope", "/list/*/x", "/nested/c/d"] });
    expect(canonicalJson(result.value as Json)).toBe(canonicalJson(body));
    expect(result.removed).toEqual([]);
  });

  it("matches * against exactly one segment", () => {
    const body = JSON.parse(
      '{"bookings":{"b1":{"created_at":"x","id":1},"b2":{"meta":{"created_at":"y"}}}}',
    ) as Json;
    const result = normalize(body, { volatile: ["/bookings/*/created_at"] });
    expect(result.removed).toEqual(["/bookings/b1/created_at"]);
    expect(result.value).toEqual({
      bookings: { b1: { id: 1 }, b2: { meta: { created_at: "y" } } },
    });
  });

  it("reindexes the remaining array elements after a removal", () => {
    const body = JSON.parse('{"items":[1,2,3]}') as Json;
    const result = normalize(body, { volatile: ["/items/1"] });
    expect(result.removed).toEqual(["/items/1"]);
    expect(result.value).toEqual({ items: [1, 3] });
  });

  it("keeps __proto__ and constructor as ordinary own keys", () => {
    const body = JSON.parse('{"__proto__":{"x":1},"constructor":"k","keep":2}') as Json;
    const result = normalize(body, { volatile: ["/constructor"] });
    const value = result.value as { [k: string]: Json };
    expect(result.removed).toEqual(["/constructor"]);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(value, "__proto__")?.value).toEqual({ x: 1 });
    expect(Object.keys(value)).toEqual(["__proto__", "keep"]);
  });

  it("treats a change only at /created_at as equal under the default policy", () => {
    const was = JSON.parse('{"id":1,"created_at":"2026-01-01T00:00:00Z"}') as Json;
    const now = JSON.parse('{"id":1,"created_at":"2027-02-02T00:00:00Z"}') as Json;
    const a = normalize(was, SHIPPED_VOLATILE_POLICY).value as Json;
    const b = normalize(now, SHIPPED_VOLATILE_POLICY).value as Json;
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it("replaces CRLF with LF in a non-JSON Body and nothing else", () => {
    expect(normalize("a\r\nb\rc\r\n", EMPTY)).toEqual({
      value: "a\nb\rc\n",
      removed: [],
      depthLimited: false,
    });
  });

  it("stops at depth 1000 and reports it without a stack overflow", () => {
    let deep: Json = 1;
    for (let level = 0; level < 1005; level += 1) deep = [deep];
    const result = normalize(deep, EMPTY);
    expect(result.depthLimited).toBe(true);
    expect(result.removed).toEqual([]);
    expect(canonicalJson(result.value as Json)).toBe(canonicalJson(deep));
  });
});
