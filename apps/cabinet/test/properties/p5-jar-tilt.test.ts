import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { jarTiltDeg } from "../../src/cabinet-model.js";

// Feature: cabinet-ui, Property 5: Jar tilt is deterministic and bounded
// **Validates: Requirements 8.2, 16.6**

const RUNS = { numRuns: 200 };

const MIN_TILT_DEG = 0.5;
const MAX_TILT_DEG = 1.5;

/** Accession-like ids (`jar-…`, session-based `${session_id}#${seq}`) and arbitrary strings. */
const accessionArb: fc.Arbitrary<string> = fc.oneof(
  fc.string(),
  fc
    .array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 64 })
    .map((units) => String.fromCharCode(...units)),
  fc
    .tuple(fc.stringMatching(/^[a-z0-9]{1,16}$/), fc.nat({ max: 10_000 }))
    .map(([session, seq]) => `${session}#${seq}`),
);

describe("Property 5: jar tilt is deterministic and bounded", () => {
  it("returns the same tilt for the same id on every call", () => {
    fc.assert(
      fc.property(accessionArb, (id) => {
        expect(jarTiltDeg(id)).toBe(jarTiltDeg(id));
      }),
      RUNS,
    );
  });

  it("gives equal tilts for equal ids, even when the string is a different instance", () => {
    fc.assert(
      fc.property(accessionArb, (id) => {
        const copy = Array.from(id).join("");
        expect(jarTiltDeg(copy)).toBe(jarTiltDeg(id));
      }),
      RUNS,
    );
  });

  it("keeps every tilt between 0.5 and 1.5 degrees", () => {
    fc.assert(
      fc.property(accessionArb, (id) => {
        const tilt = jarTiltDeg(id);
        expect(Number.isFinite(tilt)).toBe(true);
        expect(tilt).toBeGreaterThanOrEqual(MIN_TILT_DEG);
        expect(tilt).toBeLessThanOrEqual(MAX_TILT_DEG);
      }),
      RUNS,
    );
  });
});
