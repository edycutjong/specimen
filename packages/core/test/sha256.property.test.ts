import { createHash } from "node:crypto";
import { describe, it } from "vitest";
import fc from "fast-check";
import { sha256Hex } from "../src/index.js";

// Feature: jar-capture, Property 5: SHA-256 agrees with a reference
// **Validates: Requirements 10.11**

// The reference is node:crypto. It is used only here, never in packages/core/src.
const RUNS = { numRuns: 200 };

const reference = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** Arbitrary strings, including lone surrogates, which TextEncoder replaces with U+FFFD. */
const anyStringArb = fc.string({ unit: "binary", maxLength: 300 });

/** Strings built from code points above U+007F, so UTF-8 uses two to four bytes per character. */
const multiByteStringArb = fc
  .array(
    fc.oneof(
      fc.integer({ min: 0x80, max: 0x7ff }),
      fc.integer({ min: 0x800, max: 0xd7ff }),
      fc.integer({ min: 0xe000, max: 0xffff }),
      fc.integer({ min: 0x10000, max: 0x10ffff }),
    ),
    { maxLength: 120 },
  )
  .map((codePoints) => String.fromCodePoint(...codePoints));

/** Arbitrary byte sequences, with lengths that cross the 55, 56, 63 and 64 byte padding edges. */
const bytesArb = fc.oneof(
  fc.uint8Array({ minLength: 0, maxLength: 300 }),
  fc.uint8Array({ minLength: 54, maxLength: 66 }),
  fc.uint8Array({ minLength: 118, maxLength: 130 }),
);

describe("sha256Hex property", () => {
  it("agrees with node:crypto for arbitrary strings", () => {
    fc.assert(
      fc.property(anyStringArb, (text) => {
        const bytes = new TextEncoder().encode(text);
        return sha256Hex(text) === reference(bytes);
      }),
      RUNS,
    );
  });

  it("agrees with node:crypto for multi-byte UTF-8 strings", () => {
    fc.assert(
      fc.property(multiByteStringArb, (text) => {
        const bytes = new TextEncoder().encode(text);
        return sha256Hex(text) === reference(bytes);
      }),
      RUNS,
    );
  });

  it("agrees with node:crypto for arbitrary Uint8Array inputs", () => {
    fc.assert(
      fc.property(bytesArb, (bytes) => sha256Hex(bytes) === reference(bytes)),
      RUNS,
    );
  });

  it("returns 64 lowercase hex characters", () => {
    fc.assert(
      fc.property(fc.oneof(anyStringArb, bytesArb), (input) =>
        /^[0-9a-f]{64}$/.test(sha256Hex(input)),
      ),
      RUNS,
    );
  });
});
