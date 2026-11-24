import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { nextSeq, type JarLine, type PendingLine } from "../src/index.js";

// Feature: jar-capture, Property 8: Sequence numbers never collide
// **Validates: Requirements 3.4, 4.7, 11.14, 11.18**

const RUNS = { numRuns: 200 };

const TARGET = "sess-target";
const OTHER = "sess-other";
const HASH = "a".repeat(64);

/** A valid Jar_Line for the given session and seq. nextSeq reads only session_id and seq. */
function jarLine(sessionId: string, seq: number): JarLine {
  return {
    v: 1,
    id: "SPC-0001",
    session_id: sessionId,
    seq,
    server: "hollow-inn",
    tool: "quote",
    tool_id: "mcp_hollowinn_quote",
    input: {},
    response_text: "",
    response: null,
    t0: "2025-01-01T10:00:00.000Z",
    t1: "2025-01-01T10:00:01.000Z",
    duration_ms: 1000,
    redacted: [],
  };
}

/** A valid Pending_Entry line for the given session and seq. */
function pendingLine(line: number, sessionId: string, seq: number): PendingLine {
  const entry = {
    session_id: sessionId,
    seq,
    tool_id: "mcp_hollowinn_quote",
    input_sha256: HASH,
    t0: "2025-01-01T10:00:00.000Z",
  };
  return { line, raw: JSON.stringify(entry), entry };
}

/** A Pending_File line that is blank, not JSON, or fails the schema. It never has an entry. */
function invalidPendingLine(line: number, raw: string): PendingLine {
  return { line, raw };
}

const INVALID_RAWS = ["", "not json", "{}", '{"session_id":"sess-target","seq":3}'] as const;

const sessionArb = fc.constantFrom(TARGET, OTHER);
/** Small seq range so gaps and duplicates appear often. */
const seqArb = fc.integer({ min: 1, max: 30 });

type Item =
  | { kind: "pending"; session: string; seq: number }
  | { kind: "jar"; session: string; seq: number }
  | { kind: "invalid"; raw: string };

const itemArb: fc.Arbitrary<Item> = fc.oneof(
  fc.record({ kind: fc.constant("pending" as const), session: sessionArb, seq: seqArb }),
  fc.record({ kind: fc.constant("jar" as const), session: sessionArb, seq: seqArb }),
  fc.record({ kind: fc.constant("invalid" as const), raw: fc.constantFrom(...INVALID_RAWS) }),
);

/**
 * Turns items into the two inputs nextSeq reads. Pending lines are numbered in file order,
 * starting at 1, and jar lines keep their generated order.
 */
function build(items: readonly Item[]): { pending: PendingLine[]; jar: JarLine[] } {
  const pending: PendingLine[] = [];
  const jar: JarLine[] = [];
  for (const item of items) {
    const line = pending.length + 1;
    if (item.kind === "pending") pending.push(pendingLine(line, item.session, item.seq));
    else if (item.kind === "invalid") pending.push(invalidPendingLine(line, item.raw));
    else jar.push(jarLine(item.session, item.seq));
  }
  return { pending, jar };
}

/** The seqs of valid entries and lines that belong to the target session. */
function targetSeqs(items: readonly Item[]): number[] {
  return items
    .filter((i): i is Extract<Item, { session: string }> => i.kind !== "invalid" && i.session === TARGET)
    .map((i) => i.seq);
}

describe("Property 8: Sequence numbers never collide", () => {
  it("nextSeq is one more than the highest seq of the session, or 1 when there are none", () => {
    fc.assert(
      fc.property(fc.array(itemArb, { maxLength: 30 }), (items) => {
        const { pending, jar } = build(items);
        const seqs = targetSeqs(items);
        const expected = seqs.length === 0 ? 1 : Math.max(...seqs) + 1;
        expect(nextSeq(TARGET, pending, jar)).toBe(expected);
      }),
      RUNS,
    );
  });

  it("invalid lines and other sessions never change nextSeq", () => {
    fc.assert(
      fc.property(fc.array(itemArb, { maxLength: 30 }), (items) => {
        const full = build(items);
        const relevant = build(items.filter((i) => i.kind !== "invalid" && i.session === TARGET));
        expect(nextSeq(TARGET, full.pending, full.jar)).toBe(nextSeq(TARGET, relevant.pending, relevant.jar));
      }),
      RUNS,
    );
  });

  it("repeated calls with the grown set never reuse a seq and always exceed every seq present", () => {
    fc.assert(
      fc.property(
        fc.array(itemArb, { maxLength: 30 }),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }),
        (items, asPending) => {
          const { pending, jar } = build(items);
          const issued: number[] = [];

          for (const usePending of asPending) {
            const seq = nextSeq(TARGET, pending, jar);
            const present = [...targetSeqs(items), ...issued];
            const highest = present.length === 0 ? 0 : Math.max(...present);

            expect(seq).toBeGreaterThan(highest);
            expect(issued).not.toContain(seq);
            expect(present).not.toContain(seq);
            issued.push(seq);

            // Record the call as a Pending_Entry (in flight) or a Jar_Line (completed or Orphan).
            const line = pending.length + 1;
            if (usePending) pending.push(pendingLine(line, TARGET, seq));
            else jar.push(jarLine(TARGET, seq));
          }
        },
      ),
      RUNS,
    );
  });
});
