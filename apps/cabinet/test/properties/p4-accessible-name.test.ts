import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  changeSchema,
  jsonValue,
  replayResultSchema,
  resultEntrySchema,
  validSessionId,
  type Json,
  type ResultEntry,
} from "@specimen/core";
import {
  buildViewModel,
  jarAccessibleName,
  revealOrder,
  type JarViewModel,
} from "../../src/cabinet-model.js";
import type { CabinetReplayResult } from "../../src/browser-replay.js";
import type { RackMeta } from "../../src/rack-meta.js";

// Feature: cabinet-ui, Property 4: Jar accessible name always names accession, tool and state
// **Validates: Requirements 8.7**

const RUNS = { numRuns: 200 };

const JAR_STATES = ["preserved", "rattled", "cracked", "unsealed", "skipped"] as const;
const CHANGE_KINDS = ["removed", "added", "value", "type", "length"] as const;

/** Any JSON value that the core jsonValue schema accepts. */
const jsonArb: fc.Arbitrary<Json> = fc
  .jsonValue()
  .filter((value) => jsonValue.safeParse(value).success)
  .map((value) => jsonValue.parse(value));

/** One Change, parsed by the core changeSchema so that the generator never leaves the schema. */
const changeArb = fc
  .record(
    {
      path: fc.string(),
      kind: fc.constantFrom(...CHANGE_KINDS),
      was: jsonArb,
      now: jsonArb,
      note: fc.string(),
    },
    { requiredKeys: ["path", "kind"] },
  )
  .map((change) => changeSchema.parse(change));

/** A Jar_Line id in the form the Jar_Files use (SPC-0001 and up). */
const idArb: fc.Arbitrary<string> = fc
  .integer({ min: 1, max: 99999 })
  .map((n) => `SPC-${String(n).padStart(4, "0")}`);

/** A session id that core's validSessionId accepts. */
const sessionIdArb: fc.Arbitrary<string> = fc
  .stringMatching(/^[A-Za-z0-9][A-Za-z0-9._-]{0,20}$/)
  .filter((text) => validSessionId(text));

/**
 * A rack of replay entries: one session id, and entries in seq order 1..n. Entries that carry no
 * id are named by `${session_id}#${seq}`, so both forms occur.
 */
const rackEntriesArb: fc.Arbitrary<{ sessionId: string; jars: ResultEntry[] }> = fc
  .record({
    sessionId: sessionIdArb,
    entries: fc.array(
      fc.record(
        {
          id: fc.option(idArb, { nil: null }),
          tool: fc.string({ minLength: 1 }),
          state: fc.constantFrom(...JAR_STATES),
          input: fc.option(jsonArb, { nil: null }),
          response_text: fc.option(fc.string(), { nil: null }),
          changes: fc.array(changeArb, { maxLength: 4 }),
          compatible: fc.array(changeArb, { maxLength: 3 }),
          ignored: fc.array(fc.string(), { maxLength: 3 }),
          replayed_text: fc.option(fc.string(), { nil: null }),
          replayed: fc.option(jsonArb, { nil: null }),
          reason: fc.option(fc.string(), { nil: undefined }),
          error: fc.option(fc.string(), { nil: undefined }),
          ms: fc.nat({ max: 100000 }),
        },
        {
          requiredKeys: [
            "id",
            "tool",
            "state",
            "input",
            "response_text",
            "changes",
            "compatible",
            "ignored",
            "replayed_text",
            "replayed",
            "ms",
          ],
        },
      ),
      { minLength: 1, maxLength: 6 },
    ),
  })
  .map(({ sessionId, entries }) => ({
    sessionId,
    jars: entries.map((entry, index) =>
      resultEntrySchema.parse({ ...entry, session_id: sessionId, seq: index + 1 }),
    ),
  }));

/** A ReplayResult built from the rack's entries, parsed by the core replayResultSchema. */
function resultFor(jars: ResultEntry[]): CabinetReplayResult {
  const count = (state: ResultEntry["state"]): number =>
    jars.filter((entry) => entry.state === state).length;
  const red = count("rattled") + count("cracked");
  const parsed = replayResultSchema.parse({
    v: 1,
    server: "hollow-inn v2 (property test)",
    started_at: "2025-01-01T10:00:00.000Z",
    strict: false,
    jars,
    spoiled: [],
    counts: {
      preserved: count("preserved"),
      rattled: count("rattled"),
      cracked: count("cracked"),
      unsealed: count("unsealed"),
      skipped: count("skipped"),
    },
    schema_diff: { tools_removed: [], tools_added: [], input_schema_changed: [] },
    verdict: "HOLD",
    red,
    filed: 0,
    covered: false,
    reason: "generated for a property test",
    coverage: {
      compared: jars.length,
      tools_compared: [],
      tools_listed: [],
      tools_unrecorded: [],
    },
  });
  return { ...parsed, replayTimeMs: 0 };
}

const GUIDE_FLAGS = { openedRedJar: false, viewedSpec: false, replayedFixedVersion: false };

/** The accessible name must be "<accession> <tool> — <state>" with an optional ", <details>". */
function expectNamesAccessionToolState(
  jar: JarViewModel,
  accession: string,
  tool: string,
  state: string,
): void {
  const head = `${accession} ${tool} — ${state}`;
  expect(jar.accessibleName.startsWith(head)).toBe(true);
  const rest = jar.accessibleName.slice(head.length);
  expect(rest === "" || rest.startsWith(", ")).toBe(true);
  expect(jarAccessibleName(jar)).toBe(jar.accessibleName);
}

describe("jar accessible name (Property 4)", () => {
  it("names the accession, the tool and the state of every replayed jar", () => {
    fc.assert(
      fc.property(rackEntriesArb, ({ sessionId, jars }) => {
        const vm = buildViewModel({
          result: resultFor(jars),
          version: "v2",
          bugfixSpecs: [],
          racks: [
            {
              code: "RACK A",
              task: "property test",
              sessionId,
              shortSessionId: sessionId.slice(0, 13),
              callCount: jars.length,
              jars: [],
            },
          ],
          guideFlags: GUIDE_FLAGS,
        });
        const shown = revealOrder(vm);

        // Reveal order is seq order here, so shown[i] is the view of jars[i].
        expect(shown).toHaveLength(jars.length);
        shown.forEach((jar, index) => {
          const entry = jars[index] as ResultEntry;
          const accession = entry.id ?? `${sessionId}#${entry.seq}`;
          expect(jar.accession).toBe(accession);
          expect(jar.state).toBe(entry.state);
          expectNamesAccessionToolState(jar, accession, entry.tool, entry.state);
          expect(jar.accessibleName).toContain(accession);
          expect(jar.accessibleName).toContain(entry.tool);
          expect(jar.accessibleName).toContain(entry.state);
        });
      }),
      RUNS,
    );
  });

  it("names the accession, the tool and the state of every jar before a replay", () => {
    const notReplayedRackArb = fc
      .record({
        sessionId: sessionIdArb,
        jars: fc.array(
          fc.record({
            id: idArb,
            tool: fc.string({ minLength: 1 }),
            seq: fc.nat({ max: 1000 }).map((n) => n + 1),
            input: jsonArb,
            responseText: fc.string(),
          }),
          { minLength: 1, maxLength: 6 },
        ),
      })
      .map(({ sessionId, jars }) => ({
        sessionId,
        jars: jars.map((jar, index) => ({ ...jar, seq: index + 1 })),
      }));

    fc.assert(
      fc.property(notReplayedRackArb, ({ sessionId, jars }) => {
        const rack: RackMeta = {
          code: "RACK B",
          task: "property test",
          sessionId,
          shortSessionId: sessionId.slice(0, 13),
          callCount: jars.length,
          jars,
        };
        const vm = buildViewModel({
          result: null,
          version: "v1",
          bugfixSpecs: [],
          racks: [rack],
          guideFlags: GUIDE_FLAGS,
        });
        const shown = revealOrder(vm);

        expect(shown).toHaveLength(jars.length);
        shown.forEach((jar, index) => {
          const meta = jars[index] as RackMeta["jars"][number];
          expect(jar.accession).toBe(meta.id);
          expectNamesAccessionToolState(jar, meta.id, meta.tool, "not replayed");
          expect(jar.accessibleName).toContain(meta.id);
          expect(jar.accessibleName).toContain(meta.tool);
          expect(jar.accessibleName).toContain("not replayed");
        });
      }),
      RUNS,
    );
  });
});
