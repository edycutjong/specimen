import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { canonicalJson, type Json } from "../src/json.js";
import { DEFAULT_REDACT_CONFIG, MARKER, compileRedact, keyMatcher, redactInput, type KeyMatcher } from "../src/redact.js";

// Feature: jar-capture, Property 12: Input redaction
// **Validates: Requirements 7.6, 7.7, 7.8, 7.24**

const RUNS = { numRuns: 200 };

/** Keys the generator draws from. Some are sensitive, some are not, and some need escaping. */
const KEY_POOL = [
  "password",
  "token",
  "authorization",
  "secret",
  "api_key",
  "custom_secret",
  "Password",
  "room",
  "guest",
  "notes",
  "a/b~c",
  "__proto__",
  "constructor",
  "toString",
];

/** Patterns with the shipped default, so string matches are the real default behaviour. */
const PATTERNS = DEFAULT_REDACT_CONFIG.patterns;

/** Strings that match the Bearer pattern. The token part is unique, so a leak is detectable. */
const bearerArb = fc.stringMatching(/^[A-Za-z0-9]{8,12}$/).map((t) => `Bearer ${t}`);

const leafArb: fc.Arbitrary<Json> = fc.oneof(
  { weight: 2, arbitrary: fc.stringMatching(/^[a-z ]{0,8}$/) },
  { weight: 1, arbitrary: bearerArb },
  { weight: 1, arbitrary: fc.integer() },
  { weight: 1, arbitrary: fc.boolean() },
  { weight: 1, arbitrary: fc.constant(null) },
);

/** Random JSON-like trees whose object keys come from the pool, so sensitive keys occur often. */
const inputArb: fc.Arbitrary<Json> = fc.letrec<{ node: Json; arr: Json; obj: Json }>((tie) => ({
  node: fc.oneof({ maxDepth: 4 }, leafArb, tie("arr"), tie("obj")),
  arr: fc.array(tie("node") as fc.Arbitrary<Json>, { maxLength: 4 }),
  obj: fc
    .array(
      fc.record({
        key: fc.constantFrom(...KEY_POOL),
        value: tie("node") as fc.Arbitrary<Json>,
      }),
      { maxLength: 4 },
    )
    .map((entries) => ownObject(entries)),
}))
  .node;

/** Config keys: any subset of the pool, so a generated key is sometimes sensitive and sometimes not. */
const configKeysArb = fc.uniqueArray(fc.constantFrom(...KEY_POOL), { maxLength: 6 });

/** Builds an object whose keys are own data properties, even for `__proto__`. */
function ownObject(entries: readonly { key: string; value: Json }[]): { [k: string]: Json } {
  const out: { [k: string]: Json } = {};
  for (const { key, value } of entries) {
    Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

/** RFC 6901 escape, the inverse of the unescape below. */
const escapeToken = (key: string): string => key.replace(/~/g, "~0").replace(/\//g, "~1");

/** Oracle: the expected redacted value and the pointers that were replaced. */
function expectedRedaction(
  v: Json,
  ptr: string,
  keys: KeyMatcher,
  pointers: string[],
): Json {
  if (typeof v === "string") {
    if (PATTERNS.some((p) => new RegExp(p).test(v))) {
      pointers.push(ptr);
      return MARKER;
    }
    return v;
  }
  if (Array.isArray(v)) {
    return v.map((item, index) => expectedRedaction(item, `${ptr}/${index}`, keys, pointers));
  }
  if (v !== null && typeof v === "object") {
    const entries: { key: string; value: Json }[] = [];
    for (const key of Object.keys(v)) {
      const child = Object.getOwnPropertyDescriptor(v, key)?.value as Json;
      const childPtr = `${ptr}/${escapeToken(key)}`;
      if (keys.has(key)) {
        pointers.push(childPtr);
        entries.push({ key, value: MARKER });
      } else {
        entries.push({ key, value: expectedRedaction(child, childPtr, keys, pointers) });
      }
    }
    return ownObject(entries);
  }
  return v;
}

/** Resolves an RFC 6901 pointer against a value using own properties only. */
function resolvePointer(root: Json, ptr: string): Json | undefined {
  if (ptr === "") return root;
  let cur: Json | undefined = root;
  for (const raw of ptr.slice(1).split("/")) {
    const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(cur)) {
      cur = cur[Number(token)];
    } else if (cur !== null && typeof cur === "object") {
      cur = Object.getOwnPropertyDescriptor(cur, token)?.value as Json | undefined;
    } else {
      return undefined;
    }
  }
  return cur;
}

/** Every string leaf in a value, in any position. */
function stringLeaves(v: Json, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((item) => stringLeaves(item, out));
  else if (v !== null && typeof v === "object") {
    for (const key of Object.keys(v)) {
      stringLeaves(Object.getOwnPropertyDescriptor(v, key)?.value as Json, out);
    }
  }
  return out;
}

describe("redactInput property: input redaction", () => {
  it("matches the oracle, resolves every pointer to MARKER, and leaks no redacted value", () => {
    fc.assert(
      fc.property(configKeysArb, inputArb, (keys, input) => {
        const compiled = compileRedact({ keys, patterns: PATTERNS, text: "redact" });
        if (!compiled.ok) throw new Error("default patterns must compile");

        const actual = redactInput(input, compiled.value);

        // Values under matching keys and matching strings are replaced, everything else is kept.
        const pointers: string[] = [];
        const expected = expectedRedaction(input, "", keyMatcher(keys), pointers);
        expect(canonicalJson(actual.value)).toBe(canonicalJson(expected));
        expect([...actual.pointers].sort()).toEqual([...pointers].sort());

        // Every recorded pointer, read from the result, is the marker.
        for (const ptr of actual.pointers) {
          expect(resolvePointer(actual.value, ptr)).toBe(MARKER);
        }

        // No redacted Bearer value survives anywhere in the result. Only the unique Bearer
        // strings are checked, because a short plain value may legitimately repeat elsewhere.
        const bearerPattern = /^Bearer [A-Za-z0-9]{8,12}$/;
        const redactedStrings = actual.pointers
          .map((ptr) => resolvePointer(input, ptr))
          .flatMap((v) => (v === undefined ? [] : stringLeaves(v)))
          .filter((s) => bearerPattern.test(s));
        const resultStrings = new Set(stringLeaves(actual.value));
        for (const secret of redactedStrings) {
          expect(resultStrings.has(secret)).toBe(false);
        }
      }),
      RUNS,
    );
  });

  it("keeps __proto__ and constructor as own data properties, including when configured", () => {
    fc.assert(
      fc.property(fc.boolean(), (configured) => {
        const keys = configured ? ["__proto__", "constructor"] : [];
        const compiled = compileRedact({ keys, patterns: PATTERNS, text: "redact" });
        if (!compiled.ok) throw new Error("default patterns must compile");
        const input = JSON.parse(
          '{"__proto__":{"password":"hunter2"},"constructor":"keep","room":"r-04"}',
        ) as Json;

        const { value } = redactInput(input, compiled.value);
        const out = value as { [k: string]: Json };

        expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
        const protoDesc = Object.getOwnPropertyDescriptor(out, "__proto__");
        const ctorDesc = Object.getOwnPropertyDescriptor(out, "constructor");
        expect(protoDesc).toBeDefined();
        expect(ctorDesc).toBeDefined();
        expect(ctorDesc?.value).toBe(configured ? MARKER : "keep");
        expect(protoDesc?.value).toEqual(configured ? MARKER : { password: "hunter2" });
        expect(out.room).toBe("r-04");
      }),
      RUNS,
    );
  });
});
