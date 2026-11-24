/**
 * Property 2: CountsPair arithmetic matches its source fields.
 * Requirements 6.1, 6.3 and 6.4. Node environment, no jsdom. Nothing is written.
 *
 * The generators build Replay_Results from the @specimen/core zod schemas: every jar and the
 * whole result pass through `resultEntrySchema` and `replayResultSchema`, and `verdict()` fills the
 * verdict fields. The view model is then checked against figures recomputed from the raw fields.
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  changeSchema,
  replayResultSchema,
  resultEntrySchema,
  verdict,
  type ReplayResult,
  type ResultEntry,
} from "@specimen/core";
import type { CabinetReplayResult } from "../../src/browser-replay.js";
import { buildViewModel, type CabinetViewModel } from "../../src/cabinet-model.js";

// Feature: cabinet-ui, Property 2: CountsPair arithmetic matches its source fields
// **Validates: Requirements 6.1, 6.3, 6.4**

const RUNS = { numRuns: 200 };

const TOOLS = ["quote", "book", "get_room", "search_rooms", "cancel_booking", "list_bookings"];
const STATES = ["preserved", "rattled", "cracked", "unsealed", "skipped"] as const;
const KINDS = ["removed", "added", "value", "type", "length"] as const;

const toolArb = fc.constantFrom(...TOOLS);

const idArb = fc.option(
  fc.integer({ min: 1, max: 9999 }).map((n) => `SPC-${String(n).padStart(4, "0")}`),
  { nil: null },
);

const changeArb = fc
  .record({
    path: fc.constantFrom("/response/a", "/response/b"),
    kind: fc.constantFrom(...KINDS),
  })
  .map((change) => changeSchema.parse(change));

const entryArb: fc.Arbitrary<ResultEntry> = fc
  .record({
    id: idArb,
    session_id: fc.constantFrom("sess_aaaa1111", "sess_bbbb2222"),
    seq: fc.integer({ min: 1, max: 20 }),
    tool: toolArb,
    state: fc.constantFrom(...STATES),
    changes: fc.array(changeArb, { maxLength: 2 }),
    compatible: fc.array(changeArb, { maxLength: 1 }),
  })
  .map((entry) =>
    resultEntrySchema.parse({
      ...entry,
      ignored: [],
      input: null,
      response_text: null,
      replayed_text: null,
      replayed: null,
      ms: 0,
    }),
  );

const spoiledArb = fc.record({
  file: fc.constant("jars/sess_aaaa1111.jsonl"),
  line: fc.integer({ min: 1, max: 50 }),
  reason: fc.constant("not valid JSON"),
});

/**
 * A schema diff against a baseline. `removed` and `kept` partition the baseline, `changed` is a
 * subset of `kept`, and `added` names are new, so `kept + added` is the listed tool set.
 */
const diffArb = fc
  .record({
    baseline: fc.uniqueArray(toolArb, { maxLength: TOOLS.length }),
    added: fc.uniqueArray(fc.stringMatching(/^extra_[a-z]{1,6}$/), { maxLength: 3 }),
  })
  .chain(({ baseline, added }) =>
    fc.subarray(baseline).chain((removed) => {
      const kept = baseline.filter((tool) => !removed.includes(tool));
      return fc
        .subarray(kept)
        .map((changed) => ({ baseline, added, removed, kept, changed }));
    }),
  );

const fixtureArb = fc.record({
  diff: diffArb,
  entries: fc.array(entryArb, { maxLength: 12 }),
  spoiled: fc.array(spoiledArb, { maxLength: 2 }),
});

type Fixture = {
  diff: { baseline: string[]; added: string[]; removed: string[]; kept: string[]; changed: string[] };
  entries: ResultEntry[];
  spoiled: { file: string; line: number; reason: string }[];
};

/** Builds a valid Replay_Result from a fixture. `verdict()` supplies the verdict fields. */
function buildResult({ diff, entries, spoiled }: Fixture): CabinetReplayResult {
  const listed = [...diff.kept, ...diff.added];
  const judged = verdict({
    entries,
    spoiledCount: spoiled.length,
    toolsListed: listed,
    filedIds: new Set<string>(),
  });
  const count = (state: (typeof STATES)[number]): number =>
    entries.filter((entry) => entry.state === state).length;
  const parsed: ReplayResult = replayResultSchema.parse({
    v: 1,
    server: "hollow-inn v2 (test)",
    started_at: "2025-01-01T00:00:00.000Z",
    strict: false,
    jars: entries,
    spoiled,
    counts: {
      preserved: count("preserved"),
      rattled: count("rattled"),
      cracked: count("cracked"),
      unsealed: count("unsealed"),
      skipped: count("skipped"),
    },
    schema_diff: {
      tools_removed: diff.removed,
      tools_added: diff.added,
      input_schema_changed: diff.changed,
    },
    ...judged,
  });
  return { ...parsed, replayTimeMs: 0 };
}

function countsOf(result: CabinetReplayResult): CabinetViewModel["counts"] {
  return buildViewModel({
    result,
    version: "v2",
    bugfixSpecs: [],
    racks: [],
    guideFlags: { openedRedJar: false, viewedSpec: false, replayedFixedVersion: false },
  }).counts;
}

describe("Property 2: CountsPair arithmetic matches its source fields", () => {
  it("A, B, C and D follow from schema_diff, coverage and the jar states", () => {
    fc.assert(
      fc.property(fixtureArb, (fixture) => {
        const result = buildResult(fixture);
        const counts = countsOf(result);
        const { schema_diff: diff, coverage, jars } = result;
        const redJars = jars.filter((entry) => entry.state === "rattled" || entry.state === "cracked");

        // 6.1: A is removed plus input-schema-changed; B is the baseline tool count.
        expect(counts.schemaChanged).toBe(diff.tools_removed.length + diff.input_schema_changed.length);
        expect(counts.schemaTotal).toBe(
          coverage.tools_listed.length - diff.tools_added.length + diff.tools_removed.length,
        );
        expect(counts.schemaTotal).toBe(fixture.diff.baseline.length);

        // 6.3: C is the distinct tools of the Red_Jars; D is the Red_Jar count and equals red.
        expect(counts.replayToolCount).toBe(new Set(redJars.map((entry) => entry.tool)).size);
        expect(counts.redJarCount).toBe(redJars.length);
        expect(counts.redJarCount).toBe(result.red);
      }),
      RUNS,
    );
  });
});

describe("CountsPair literal example", () => {
  it("gives 2 of 3 changed and 1 tool across 2 red jars", () => {
    // Baseline: quote, book, get_room. book is removed, quote is changed, extra_hold is added.
    // quote has a rattled and a cracked jar, so C counts quote once and D counts both jars.
    const entry = (state: ResultEntry["state"], tool: string, seq: number): ResultEntry =>
      resultEntrySchema.parse({
        id: `SPC-000${seq}`,
        session_id: "sess_aaaa1111",
        seq,
        tool,
        state,
        changes: [],
        compatible: [],
        ignored: [],
        input: null,
        response_text: null,
        replayed_text: null,
        replayed: null,
        ms: 0,
      });
    const result = buildResult({
      diff: {
        baseline: ["quote", "book", "get_room"],
        added: ["extra_hold"],
        removed: ["book"],
        kept: ["quote", "get_room"],
        changed: ["quote"],
      },
      entries: [
        entry("rattled", "quote", 1),
        entry("cracked", "quote", 2),
        entry("preserved", "get_room", 3),
        entry("skipped", "book", 4),
      ],
      spoiled: [],
    });
    const counts = countsOf(result);
    expect(counts.schemaChanged).toBe(2);
    expect(counts.schemaTotal).toBe(3);
    expect(counts.replayToolCount).toBe(1);
    expect(counts.redJarCount).toBe(2);
  });
});
