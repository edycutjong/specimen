import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parsePending, removeLine, selectPending } from "../src/pairing.js";

// Feature: jar-capture, Property 9: FIFO pairing and verbatim removal
// **Validates: Requirements 4.4, 4.6, 4.9, 4.21, 10.6**

const RUNS = { numRuns: 200 };

const SESSIONS = ["sess-a", "sess-b"];
const TOOLS = ["mcp_hollowinn_quote", "mcp_hollowinn_book"];
const HASHES = ["a".repeat(64), "b".repeat(64)];
const T0 = "2025-01-01T10:00:00.000Z";

type Key = { session_id: string; tool_id: string; input_sha256: string };

/** One generated line of a Pending_File. `entry` is set only for lines that are valid. */
type Item = { raw: string; entry?: Key & { seq: number; t0: string } };

const keyArb: fc.Arbitrary<Key> = fc.record({
  session_id: fc.constantFrom(...SESSIONS),
  tool_id: fc.constantFrom(...TOOLS),
  input_sha256: fc.constantFrom(...HASHES),
});

const validItemArb: fc.Arbitrary<Item> = fc
  .record({ key: keyArb, seq: fc.integer({ min: 1, max: 1000 }) })
  .map(({ key, seq }) => {
    const entry = { ...key, seq, t0: T0 };
    return { raw: JSON.stringify(entry), entry };
  });

/** Lines that must fail the Pending_Entry schema. Blank and unparseable lines are included. */
const invalidRawArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom("", "not json", "{", "[]", "null", '"text"', '{"session_id":"sess-a"}'),
  // A valid entry with one extra field: the strict schema must reject it.
  fc.record({ key: keyArb, seq: fc.integer({ min: 1, max: 1000 }) }).map(({ key, seq }) =>
    JSON.stringify({ ...key, seq, t0: T0, extra: true }),
  ),
  // A valid entry with a malformed hash.
  keyArb.map((key) => JSON.stringify({ ...key, input_sha256: "XYZ", seq: 1, t0: T0 })),
  // A valid entry with seq 0, which is below the minimum of 1.
  keyArb.map((key) => JSON.stringify({ ...key, seq: 0, t0: T0 })),
);

const itemArb: fc.Arbitrary<Item> = fc.oneof(
  validItemArb,
  invalidRawArb.map((raw) => ({ raw })),
);

/**
 * Lines plus a trailing-newline flag. A last line that is blank must be terminated, because
 * an unterminated blank last line has no bytes to read back as a line.
 */
const fileArb = fc
  .record({
    items: fc.array(itemArb, { minLength: 1, maxLength: 25 }),
    terminated: fc.boolean(),
  })
  .map(({ items, terminated }) => {
    const last = items[items.length - 1]?.raw;
    const forced = last === "" ? true : terminated;
    const text = items.map((i) => i.raw).join("\n") + (forced ? "\n" : "");
    return { items, terminated: forced, text };
  });

describe("Property 9: FIFO pairing and verbatim removal", () => {
  it("selectPending returns the lowest line of a matching valid entry, or undefined", () => {
    fc.assert(
      fc.property(fileArb, keyArb, ({ items, text }, key) => {
        const pending = parsePending(text);
        expect(pending.map((p) => p.raw)).toEqual(items.map((i) => i.raw));

        const index = items.findIndex(
          (i) =>
            i.entry !== undefined &&
            i.entry.session_id === key.session_id &&
            i.entry.tool_id === key.tool_id &&
            i.entry.input_sha256 === key.input_sha256,
        );
        const expected = index === -1 ? undefined : index + 1;
        expect(selectPending(pending, key)).toBe(expected);
      }),
      RUNS,
    );
  });

  it("removeLine deletes exactly one line and keeps the other raw bytes and newline state", () => {
    fc.assert(
      fc.property(
        fileArb,
        fc.nat(),
        ({ items, terminated, text }, n) => {
          const index = n % items.length;
          const remaining = items.filter((_, i) => i !== index).map((i) => i.raw);

          // Removing the final line of an unterminated file leaves the new last line terminated,
          // as removeLine documents.
          const lastRemoved = index === items.length - 1;
          const endsWithNewline = terminated || lastRemoved;
          const expected =
            remaining.length === 0 ? "" : remaining.join("\n") + (endsWithNewline ? "\n" : "");

          const result = removeLine(text, index + 1);
          expect(result).toBe(expected);
          expect(parsePending(result).map((p) => p.raw)).toEqual(remaining);
        },
      ),
      RUNS,
    );
  });

  it("repeated pair-and-remove cycles pair matching posts in append order and keep other lines", () => {
    fc.assert(
      fc.property(fileArb, keyArb, ({ items, text }, key) => {
        let current = text;
        const pairedSeqs: number[] = [];

        for (;;) {
          const pending = parsePending(current);
          const line = selectPending(pending, key);
          if (line === undefined) break;
          const entry = pending[line - 1]?.entry;
          expect(entry).toBeDefined();
          pairedSeqs.push(entry!.seq);
          current = removeLine(current, line);
        }

        const matching = items.filter(
          (i) =>
            i.entry !== undefined &&
            i.entry.session_id === key.session_id &&
            i.entry.tool_id === key.tool_id &&
            i.entry.input_sha256 === key.input_sha256,
        );
        expect(pairedSeqs).toEqual(matching.map((i) => i.entry!.seq));

        const nonMatching = items
          .filter((i) => !matching.includes(i))
          .map((i) => i.raw);
        expect(parsePending(current).map((p) => p.raw)).toEqual(nonMatching);
        expect(selectPending(parsePending(current), key)).toBeUndefined();
      }),
      RUNS,
    );
  });
});
