/**
 * Property 1: view-model counts always equal the core verdict's counts.
 *
 * The oracle is the real `verdict()` and `filedJarIds()` of @specimen/core. Generators build
 * `ResultEntry`, `ReplayResult` and `BugfixSpec` values, and every generated value is checked with
 * the core zod schemas (`resultEntrySchema`, `replayResultSchema`) before it reaches the view model.
 *
 * **Validates: Requirements 1.10, 4.4, 4.5, 4.6, 4.11, 4.15, 6.3**
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type BugfixSpec,
  type Change,
  type Json,
  type ResultEntry,
  coverageString,
  diff,
  filedJarIds,
  formatAccession,
  replayResultSchema,
  resultEntrySchema,
  verdict,
  type VerdictResult,
} from "@specimen/core";
import { buildViewModel, coveringSpecCount, pluralise, type CabinetViewModel } from "../../src/cabinet-model.js";
import type { CabinetReplayResult, HollowInnVersion } from "../../src/browser-replay.js";
import type { RackMeta } from "../../src/rack-meta.js";

const NUM_RUNS = 200;

const VERSIONS: HollowInnVersion[] = ["v1", "v2", "v2.1"];
const STATES = ["preserved", "rattled", "cracked", "unsealed", "skipped"] as const;
const TOOLS = ["quote", "search_rooms", "book_room", "cancel_booking", "booking_cancel"] as const;
const SESSIONS = [
  "sess_0000000a-0000-4000-8000-00000000000a",
  "sess_0000000b-0000-4000-8000-00000000000b",
] as const;
const ORPHAN_REASON = "orphan pre-event";
const UNPAIRED_REASON = "unpaired post-event";

const INPUT: Json = { room_id: "r-04", nights: 2 };
const JARRED: Json = { room_id: "r-04", nights: 2, total: 425 };
const JARRED_TEXT = JSON.stringify(JARRED);

/** Two racks, one per session. Every generated entry belongs to one of them. */
const RACKS: RackMeta[] = SESSIONS.map((sessionId, index) => ({
  code: `RACK ${"AB"[index]}`,
  task: "Book a room for two nights.",
  sessionId,
  shortSessionId: sessionId.slice(0, "sess_".length + 8),
  callCount: 0,
  jars: [],
}));

type RawEntry = {
  state: (typeof STATES)[number];
  tool: (typeof TOOLS)[number];
  session: (typeof SESSIONS)[number];
  withId: boolean;
  replayedTotal: number;
  unsealedReason: string;
  compatibleCount: number;
};

const rawEntryArb: fc.Arbitrary<RawEntry> = fc.record({
  state: fc.constantFrom(...STATES),
  tool: fc.constantFrom(...TOOLS),
  session: fc.constantFrom(...SESSIONS),
  withId: fc.boolean(),
  replayedTotal: fc.integer({ min: 0, max: 999 }),
  unsealedReason: fc.constantFrom(ORPHAN_REASON, UNPAIRED_REASON, "some other unsealed reason"),
  compatibleCount: fc.integer({ min: 0, max: 2 }),
});

/** Builds one entry for `index` and parses it with the core schema. */
function toEntry(raw: RawEntry, index: number): ResultEntry {
  const base = {
    id: raw.withId ? formatAccession(index + 1) : null,
    session_id: raw.session,
    seq: index + 1,
    tool: raw.tool,
    input: INPUT,
    response_text: JARRED_TEXT,
    replayed_text: null as string | null,
    replayed: null as Json | null,
    changes: [] as Change[],
    compatible: [] as Change[],
    ignored: [] as string[],
    ms: index,
  };

  let entry: Record<string, unknown>;
  switch (raw.state) {
    case "preserved":
      entry = {
        ...base,
        state: "preserved",
        replayed: JARRED,
        replayed_text: JARRED_TEXT,
        compatible: Array.from({ length: raw.compatibleCount }, (_, n) => ({
          path: `/note_${n}`,
          kind: "added" as const,
          now: "x",
        })),
      };
      break;
    case "rattled": {
      const replayed: Json = { room_id: "r-04", nights: 2, total: raw.replayedTotal };
      entry = {
        ...base,
        state: "rattled",
        replayed,
        replayed_text: JSON.stringify(replayed),
        changes: diff(JARRED, replayed),
      };
      break;
    }
    case "cracked":
      entry = { ...base, state: "cracked", error: "tool not in tools/list" };
      break;
    case "unsealed":
      entry = { ...base, state: "unsealed", response_text: null, reason: raw.unsealedReason };
      break;
    case "skipped":
      entry = { ...base, state: "skipped", reason: "not in replay.json" };
      break;
  }
  return resultEntrySchema.parse(entry);
}

/**
 * Text of a spec that cites `entry.id`, laid out as the filed-ids rule checks it. The Unchanged
 * section names a preserved jar of the same tool when the run has one, and otherwise says that no
 * preserved jar exists (the wording checkSpec requires for that case).
 */
function specText(entry: ResultEntry, entries: ResultEntry[], matchRepro: boolean): string {
  const id = entry.id ?? "SPC-9999";
  const tool = entry.tool;
  const paths = entry.changes.map((change) => change.path);
  const current = paths.length > 0 ? paths.join(" and ") : "the recorded body";
  // The generator changes only /total, whose jarred literal is 425. The Expected section names it.
  const reference = paths.length > 0 ? "/total 425" : JARRED_TEXT;
  const preserved = entries.find(
    (other) => other.state === "preserved" && other.tool === tool && other.id !== null,
  );
  const unchanged =
    preserved?.id !== undefined && preserved.id !== null
      ? `WHEN ${tool} is called THEN the system SHALL CONTINUE TO return the body recorded in ${preserved.id}.`
      : `WHEN ${tool} is called THEN the system SHALL CONTINUE TO answer as before; no preserved jar of ${tool} exists.`;
  const repro = [
    {
      id,
      input: entry.input,
      response_text: entry.response_text,
      replayed: matchRepro ? entry.replayed : null,
      changed_paths: paths,
    },
  ];
  return [
    `# Bugfix: ${tool} for ${id}`,
    "",
    "## Current Behavior (Defect)",
    "",
    `WHEN ${tool} is called for r-04 with 2 nights THEN the system returns ${current} for ${id}.`,
    "",
    "## Expected Behavior (Correct)",
    "",
    `WHEN ${tool} is called for r-04 with 2 nights THEN the system SHALL return ${reference} for ${id}.`,
    "",
    "## Unchanged Behavior (Regression Prevention)",
    "",
    unchanged,
    "",
    "<!-- specimen:repro:start -->",
    "```json specimen-repro",
    JSON.stringify(repro, null, 2),
    "```",
    "<!-- specimen:repro:end -->",
    "",
  ].join("\n");
}

/** Specs for a set of entries: some cite a red jar with a matching or mismatched repro, some are bare. */
function specsArb(entries: ResultEntry[]): fc.Arbitrary<BugfixSpec[]> {
  const ids = entries.flatMap((entry) => (entry.id === null ? [] : [entry.id]));
  if (ids.length === 0) return fc.constant([]);
  const byId = new Map<string, ResultEntry>();
  for (const entry of entries) if (entry.id !== null) byId.set(entry.id, entry);

  const specArb = fc
    .record({
      id: fc.constantFrom(...ids),
      matchRepro: fc.boolean(),
      bare: fc.boolean(),
    })
    .map(({ id, matchRepro, bare }): BugfixSpec => {
      const entry = byId.get(id);
      if (bare || entry === undefined) return { name: `bare-${id}`, text: `Notes about ${id}.` };
      return {
        name: `spec-${id}`,
        text: specText(entry, entries, matchRepro),
      };
    });
  return fc.array(specArb, { maxLength: 3 });
}

type Scenario = {
  entries: ResultEntry[];
  specs: BugfixSpec[];
  spoiled: { file: string; line: number; reason: string }[];
  toolsListed: string[];
  schemaDiff: { tools_removed: string[]; tools_added: string[]; input_schema_changed: string[] };
  version: HollowInnVersion;
};

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .array(rawEntryArb, { maxLength: 8 })
  .map((raws) => raws.map((raw, index) => toEntry(raw, index)))
  .chain((entries) =>
    fc.record({
      entries: fc.constant(entries),
      specs: specsArb(entries),
      spoiled: fc.array(
        fc.record({
          file: fc.constant("jars/racks.jsonl"),
          line: fc.integer({ min: 1, max: 50 }),
          reason: fc.constant("line does not match the Jar_Line schema"),
        }),
        { maxLength: 2 },
      ),
      toolsListed: fc.uniqueArray(fc.constantFrom(...TOOLS, "legacy_tool"), { maxLength: 6 }),
      schemaDiff: fc.record({
        tools_removed: fc.uniqueArray(fc.constantFrom("legacy_tool", "zz_tool"), { maxLength: 2 }),
        tools_added: fc.uniqueArray(fc.constantFrom("booking_cancel", "room_hold"), { maxLength: 2 }),
        input_schema_changed: fc.uniqueArray(fc.constantFrom("quote", "search_rooms"), {
          maxLength: 2,
        }),
      }),
      version: fc.constantFrom(...VERSIONS),
    }),
  );

function tally(entries: ResultEntry[]) {
  const counts = { preserved: 0, rattled: 0, cracked: 0, unsealed: 0, skipped: 0 };
  for (const entry of entries) counts[entry.state] += 1;
  return counts;
}

/** Builds the Replay_Result of one scenario, with `verdict()` as the only source of its judgement. */
function resultOf(scenario: Scenario, judged: VerdictResult): CabinetReplayResult {
  const parsed = replayResultSchema.parse({
    v: 1,
    server: `hollow-inn ${scenario.version}`,
    started_at: "2026-01-01T00:00:00.000Z",
    strict: false,
    jars: scenario.entries,
    spoiled: scenario.spoiled,
    counts: tally(scenario.entries),
    schema_diff: scenario.schemaDiff,
    verdict: judged.verdict,
    red: judged.red,
    filed: judged.filed,
    covered: judged.covered,
    reason: judged.reason,
    coverage: judged.coverage,
  });
  return { ...parsed, replayTimeMs: 0 };
}

/** The line the plate shows for a count of zero is absent. `label` is the plate's text. */
function optionalLine(count: number, label: string): string | undefined {
  return count > 0 ? `${count} ${label}` : undefined;
}

function assertCountsEqualVerdict(
  vm: CabinetViewModel,
  scenario: Scenario,
  judged: VerdictResult,
): void {
  const counts = tally(scenario.entries);
  const quarantined = scenario.entries.filter(
    (entry) =>
      entry.state === "unsealed" &&
      (entry.reason === ORPHAN_REASON || entry.reason === UNPAIRED_REASON),
  ).length;
  const plate = vm.plate;

  // Verdict word, reason and coverage come from verdict() unchanged (Requirements 4.11, 4.15).
  expect(plate.verdict).toBe(judged.verdict);
  expect(plate.reason).toBe(judged.reason);
  expect(plate.compared).toBe(judged.coverage.compared);
  expect(plate.coverageLine).toBe(coverageString(judged.coverage));
  expect(plate.coverageLine).toContain(
    `${judged.coverage.tools_compared.length} of ${judged.coverage.tools_listed.length} tools`,
  );

  // Counts line (Requirement 4.4, 4.5).
  const expectedCounts =
    `${counts.preserved} preserved · ${counts.rattled} rattled · ${counts.cracked} cracked` +
    (counts.unsealed > 0 ? `, ${counts.unsealed} unsealed` : "");
  expect(plate.countsLine).toBe(expectedCounts);

  // Filed counter (Requirement 4.6, 4.7).
  // The filed counter names the distinct spec files that cover the red jars (design pass, item 2).
  const allFiled = judged.red > 0 && judged.filed === judged.red;
  const covering = pluralise(
    coveringSpecCount(scenario.specs, scenario.entries),
    "filed Kiro bugfix spec",
    "filed Kiro bugfix specs",
  );
  expect(plate.filedLine).toBe(
    judged.filed === 0
      ? `${judged.red} red · 0 filed as Kiro bugfix specs`
      : `${judged.red} red · ${allFiled ? "all red jars covered by" : `${judged.filed} covered by`} ${covering}`,
  );

  // Optional lines (Requirements 4.8 to 4.10).
  expect(plate.skippedLine).toBe(optionalLine(counts.skipped, "skipped"));
  expect(plate.quarantinedLine).toBe(optionalLine(quarantined, "quarantined"));
  expect(plate.spoiledLine).toBe(optionalLine(scenario.spoiled.length, "spoiled"));

  // CountsPair D is the red count of verdict() (Requirement 6.3).
  expect(vm.counts.redJarCount).toBe(judged.red);

  // The shelves show every entry once, and the jars' red and filed flags match verdict().
  const jars = vm.racks.flatMap((rack) => rack.jars);
  expect(jars.length).toBe(scenario.entries.length);
  expect(jars.filter((jar) => jar.isRed).length).toBe(judged.red);
  expect(jars.filter((jar) => jar.filed).length).toBe(judged.filed);
}

describe("Property 1: view-model counts equal the core verdict's counts", () => {
  // Feature: cabinet-ui, Property 1: View-model counts always equal the core verdict's counts
  it("matches verdict() for any replay result built from the core schemas", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        // filedJarIds and verdict are the same core functions that the browser uses.
        const filedIds = filedJarIds(scenario.specs, scenario.entries);
        const judged = verdict({
          entries: scenario.entries,
          spoiledCount: scenario.spoiled.length,
          toolsListed: scenario.toolsListed,
          filedIds,
        });

        const vm = buildViewModel({
          result: resultOf(scenario, judged),
          version: scenario.version,
          bugfixSpecs: scenario.specs,
          racks: RACKS,
          guideFlags: { openedRedJar: false, viewedSpec: false, replayedFixedVersion: false },
        });

        assertCountsEqualVerdict(vm, scenario, judged);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
