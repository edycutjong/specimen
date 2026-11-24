/**
 * Property 6: Reveal order is rack order then seq order.
 *
 * `revealOrder` must list every jar of the view model in the key order of the racks, and within
 * each rack in ascending `seq` order. The oracle is computed from the generated plan, not from the
 * view model. Racks and jars are generated as the real inputs: jar lines are built and parsed with
 * `jarLineSchema`, written with `serializeJarLine`, and read back by `buildRackMeta`. Replay results
 * are parsed with `resultEntrySchema` and `replayResultSchema`. The committed racks are checked
 * once against `jars/racks.json` and the Jar_Files on disk, read through `readJar`.
 *
 * **Validates: Requirements 2.3, 7.1, 7.5**
 */
import fc from "fast-check";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  countStates,
  emptySchemaDiff,
  formatAccession,
  jarLineSchema,
  readJar,
  replayResultSchema,
  resultEntrySchema,
  serializeJarLine,
  type JarLine,
  type ResultEntry,
} from "@specimen/core";
import { buildViewModel, revealOrder, type JarViewModel } from "../../src/cabinet-model.js";
import type { CabinetReplayResult } from "../../src/browser-replay.js";
import { RACK_META, buildRackMeta, promptFileFor, type RackMeta, type RackSources } from "../../src/rack-meta.js";

const NUM_RUNS = 200;

const MAX_RACKS = 4;
const MAX_JARS = 6;
const SLOTS = MAX_RACKS * MAX_JARS;
const LETTERS = ["A", "B", "C", "D"];
const TOOLS = ["quote", "search_rooms", "book_room", "cancel_booking"] as const;
const STATES = ["preserved", "skipped", "unsealed"] as const;
const JARRED_TEXT = JSON.stringify({ total: 425 });
const NO_FLAGS = { openedRedJar: false, viewedSpec: false, replayedFixedVersion: false };
const SLOT_INDEXES = Array.from({ length: SLOTS }, (_, index) => index);

type State = (typeof STATES)[number];

/** One generated jar. `seq` is unique within its rack. */
type PlannedJar = { id: string; sessionId: string; seq: number; tool: string; state: State };

/** One generated rack. `jars` is in file order, which differs from seq order. */
type RackPlan = { code: string; sessionId: string; jars: PlannedJar[] };

type Scene = {
  codes: string[];
  seqs: number[][];
  tools: (typeof TOOLS)[number][];
  states: State[];
  ids: number[];
  mix: number[];
};

const sceneArb: fc.Arbitrary<Scene> = fc.record({
  codes: fc.shuffledSubarray(LETTERS, { minLength: 1, maxLength: MAX_RACKS }),
  seqs: fc.array(fc.uniqueArray(fc.integer({ min: 1, max: 500 }), { maxLength: MAX_JARS }), {
    minLength: MAX_RACKS,
    maxLength: MAX_RACKS,
  }),
  tools: fc.array(fc.constantFrom(...TOOLS), { minLength: SLOTS, maxLength: SLOTS }),
  states: fc.array(fc.constantFrom(...STATES), { minLength: SLOTS, maxLength: SLOTS }),
  ids: fc.uniqueArray(fc.integer({ min: 1, max: 9999 }), { minLength: SLOTS, maxLength: SLOTS }),
  mix: fc.shuffledSubarray(SLOT_INDEXES, { minLength: SLOTS, maxLength: SLOTS }),
});

function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no generated value at index ${index}`);
  return item;
}

/** Racks in the key order of the scene, with jars taken from the accession pool slot by slot. */
function plansOf(scene: Scene): RackPlan[] {
  let slot = 0;
  return scene.codes.map((letter, rackIndex) => {
    const code = `RACK ${letter}`;
    const sessionId = `sess_rack-${letter.toLowerCase()}-0000-4000-8000-000000000000`;
    const jars = at(scene.seqs, rackIndex).map((seq): PlannedJar => {
      const index = slot;
      slot += 1;
      return {
        id: formatAccession(at(scene.ids, index)),
        sessionId,
        seq,
        tool: at(scene.tools, index),
        state: at(scene.states, index),
      };
    });
    return { code, sessionId, jars };
  });
}

/** A valid Jar_Line for one planned jar, built through the core schema. */
function lineOf(jar: PlannedJar): JarLine {
  return jarLineSchema.parse({
    v: 1,
    id: jar.id,
    session_id: jar.sessionId,
    seq: jar.seq,
    server: "hollow-inn v2",
    tool: jar.tool,
    tool_id: jar.tool,
    input: { room_id: "r-04", nights: 2 },
    response_text: JARRED_TEXT,
    response: null,
    t0: "2026-01-01T00:00:00.000Z",
    t1: "2026-01-01T00:00:00.001Z",
    duration_ms: 1,
    redacted: [],
  });
}

/** The sources of buildRackMeta, written as the committed files are: racks.json, Jar_Files, prompts. */
function sourcesOf(plans: RackPlan[]): RackSources {
  const racks: Record<string, string> = {};
  const jarTexts: Record<string, string> = {};
  const prompts: Record<string, string> = {};
  for (const plan of plans) {
    const file = `${plan.sessionId}.jsonl`;
    racks[plan.code] = file;
    jarTexts[file] = plan.jars.map((jar) => serializeJarLine(lineOf(jar))).join("");
    prompts[promptFileFor(plan.code)] = `<!-- header of ${plan.code} -->\nTask for ${plan.code}.\n`;
  }
  return { racks, jarTexts, prompts };
}

/** The replay entry of one planned jar, parsed with the core schema. */
function entryOf(jar: PlannedJar): ResultEntry {
  const base = {
    id: jar.id,
    session_id: jar.sessionId,
    seq: jar.seq,
    tool: jar.tool,
    input: { room_id: "r-04", nights: 2 },
    response_text: JARRED_TEXT,
    changes: [],
    compatible: [],
    ignored: [],
    ms: 0,
  };
  if (jar.state === "preserved") {
    return resultEntrySchema.parse({
      ...base,
      state: "preserved",
      replayed_text: JARRED_TEXT,
      replayed: { total: 425 },
    });
  }
  if (jar.state === "skipped") {
    return resultEntrySchema.parse({
      ...base,
      state: "skipped",
      replayed_text: null,
      replayed: null,
      reason: "not in replay.json",
    });
  }
  return resultEntrySchema.parse({
    ...base,
    state: "unsealed",
    replayed_text: null,
    replayed: null,
    reason: "not replayable",
  });
}

/** Expected reveal order: racks in key order, each rack's jars in ascending seq order. */
function expectedOf(plans: RackPlan[]): (string | number)[][] {
  return plans.flatMap((plan) =>
    [...plan.jars]
      .sort((a, b) => a.seq - b.seq)
      .map((jar): (string | number)[] => [plan.code, jar.seq, jar.id]),
  );
}

function tuplesOf(jars: JarViewModel[]): (string | number)[][] {
  return jars.map((jar): (string | number)[] => [jar.rackCode, jar.seq, jar.accession]);
}

/** A Replay_Result whose entries are given in the order the replay emitted them. */
function resultOf(entries: ResultEntry[]): CabinetReplayResult {
  const parsed = replayResultSchema.parse({
    v: 1,
    server: "hollow-inn v2 (property test)",
    started_at: "2026-01-01T00:00:00.000Z",
    strict: false,
    jars: entries,
    spoiled: [],
    counts: countStates(entries),
    schema_diff: emptySchemaDiff(),
    verdict: "HOLD",
    red: 0,
    filed: 0,
    covered: false,
    reason: "no jar was compared",
    coverage: { compared: 0, tools_compared: [], tools_listed: [], tools_unrecorded: [] },
  });
  return { ...parsed, replayTimeMs: 1 };
}

describe("Property 6: reveal order is rack order then seq order", () => {
  it("lists every jar in rack key order, then seq order, before a replay", () => {
    fc.assert(
      fc.property(sceneArb, (scene) => {
        const plans = plansOf(scene);
        const racks: RackMeta[] = buildRackMeta(sourcesOf(plans));
        const viewModel = buildViewModel({
          result: null,
          version: "v2",
          bugfixSpecs: [],
          racks,
          guideFlags: NO_FLAGS,
        });
        expect(tuplesOf(revealOrder(viewModel))).toEqual(expectedOf(plans));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("lists every jar in rack key order, then seq order, after a replay in any emit order", () => {
    fc.assert(
      fc.property(sceneArb, (scene) => {
        const plans = plansOf(scene);
        const racks: RackMeta[] = buildRackMeta(sourcesOf(plans));
        const flat = plans.flatMap((plan) => plan.jars.map((jar) => entryOf(jar)));
        // The replay emits entries in any order, so the scene's permutation decides the order here.
        const entries = scene.mix.filter((index) => index < flat.length).map((index) => at(flat, index));
        const viewModel = buildViewModel({
          result: resultOf(entries),
          version: "v2",
          bugfixSpecs: [],
          racks,
          guideFlags: NO_FLAGS,
        });
        expect(tuplesOf(revealOrder(viewModel))).toEqual(expectedOf(plans));
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("orders the committed racks by the key order of racks.json, then seq", () => {
    const jarsDir = fileURLToPath(new URL("../../../../jars/", import.meta.url));
    const racksFile = JSON.parse(readFileSync(`${jarsDir}racks.json`, "utf8")) as Record<string, string>;
    const expected = Object.entries(racksFile).flatMap(([code, file]) =>
      [...readJar(readFileSync(`${jarsDir}${file}`, "utf8")).lines]
        .sort((a, b) => a.seq - b.seq)
        .map((line): (string | number)[] => [code, line.seq, line.id]),
    );
    expect(expected.length).toBeGreaterThan(0);

    const viewModel = buildViewModel({
      result: null,
      version: "v2",
      bugfixSpecs: [],
      racks: RACK_META,
      guideFlags: NO_FLAGS,
    });
    expect(tuplesOf(revealOrder(viewModel))).toEqual(expected);
  });
});
