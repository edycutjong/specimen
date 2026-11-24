/**
 * Property 7: filed ids never include a jar that is not red.
 *
 * The oracle is the real `filedJarIds()`, `citesId()` and `checkSpec()` of @specimen/core. Generators
 * build `ResultEntry` values and parse each one with `resultEntrySchema`. Specs are built from the
 * entries with the core Reference helpers, so many of them pass `checkSpec`. Other specs cite an id
 * only inside a longer token (for example SPC-0002 inside SPC-00021), or cite a null-id jar.
 *
 * **Validates: Requirements 5.5, 5.7, 5.9**
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type BugfixSpec,
  type Change,
  type Json,
  type ResultEntry,
  checkSpec,
  citesId,
  diff,
  filedJarIds,
  referenceOf,
  referenceSubstrings,
  resultEntrySchema,
} from "@specimen/core";

const NUM_RUNS = 200;

/** Ids that are prefixes or extensions of one another, so the generator produces collisions. */
const ID_POOL = ["SPC-0002", "SPC-00021", "SPC-0003", "SPC-0031", "SPC-0004", "SPC-0099"] as const;
/** Appended to an id to make a longer token: SPC-0002 + "1" is SPC-00021. */
const SUFFIXES = ["1", "0", "x", "-retry"] as const;
const STATES = ["preserved", "rattled", "cracked", "unsealed", "skipped"] as const;
const TOOLS = ["quote", "book_room"] as const;
const SESSION = "sess_0000000a-0000-4000-8000-00000000000a";

const JARRED = '{"room_id":"r-04","nights":2,"total":425.00}';
const JARRED_VALUE: Json = { room_id: "r-04", nights: 2, total: 425 };
const INPUT: Json = { room_id: "r-04", nights: 2 };
const CRACKED_ERROR = "tool not in tools/list";
const SKIPPED_REASON = "not in replay.json";
const UNSEALED_REASON = "orphan pre-event";

type State = (typeof STATES)[number];
type Tool = (typeof TOOLS)[number];
type Raw = { id: string | null; state: State; tool: Tool; total: number };

const isRed = (entry: ResultEntry): boolean => entry.state === "rattled" || entry.state === "cracked";

/** Builds one entry from its raw fields and parses it with the core schema. */
function toEntry(raw: Raw, seq: number): ResultEntry {
  const base = {
    id: raw.id,
    session_id: SESSION,
    seq,
    tool: raw.tool,
    input: INPUT,
    response_text: JARRED,
    changes: [] as Change[],
    compatible: [] as Change[],
    ignored: [] as string[],
    replayed_text: null as string | null,
    replayed: null as Json | null,
    ms: 0,
  };
  switch (raw.state) {
    case "preserved":
      return resultEntrySchema.parse({
        ...base,
        state: "preserved",
        replayed: JARRED_VALUE,
        replayed_text: JARRED,
      });
    case "rattled": {
      const replayed: Json = { room_id: "r-04", nights: 2, total: raw.total };
      return resultEntrySchema.parse({
        ...base,
        state: "rattled",
        replayed,
        replayed_text: JSON.stringify(replayed),
        changes: diff(JARRED_VALUE, replayed),
      });
    }
    case "cracked":
      return resultEntrySchema.parse({ ...base, state: "cracked", error: CRACKED_ERROR });
    case "unsealed":
      return resultEntrySchema.parse({
        ...base,
        state: "unsealed",
        response_text: null,
        reason: UNSEALED_REASON,
      });
    case "skipped":
      return resultEntrySchema.parse({ ...base, state: "skipped", reason: SKIPPED_REASON });
  }
}

/** A Bugfix_Spec built from one entry, in the layout checkSpec reads. */
function specFor(entry: ResultEntry, entries: ResultEntry[], note: string | undefined): string {
  const id = entry.id ?? "SPC-9999";
  const tool = entry.tool;
  const paths = entry.changes.map((change) => change.path);
  const current = paths.length > 0 ? paths.join(" and ") : "the recorded body";
  const reference = referenceOf(entry).flatMap(referenceSubstrings).join(" ");
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
      replayed: entry.replayed,
      changed_paths: paths,
    },
  ];
  const currentLines = [
    `WHEN ${tool} is called for r-04 with 2 nights THEN the system returns ${current} for ${id}.`,
  ];
  if (note !== undefined) currentLines.push(`Related red jar: ${note}.`);
  return [
    `# Bugfix: ${tool} for ${id}`,
    "",
    "## Current Behavior (Defect)",
    "",
    ...currentLines,
    "",
    "## Expected Behavior (Correct)",
    "",
    `WHEN ${tool} is called for r-04 with 2 nights THEN the system SHALL return ${reference || "the recorded body"} for ${id}.`,
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

/** Replaces every whole-token occurrence of `id` with `longer`, so `id` no longer appears as a token. */
function replaceWhole(text: string, id: string, longer: string): string {
  return text.replace(new RegExp(`(?<![A-Za-z0-9-])${id}(?![A-Za-z0-9-])`, "g"), longer);
}

const rawArb: fc.Arbitrary<Raw & { id: string }> = fc.record({
  id: fc.constantFrom(...ID_POOL),
  state: fc.constantFrom(...STATES),
  tool: fc.constantFrom(...TOOLS),
  total: fc.integer({ min: 0, max: 999 }).filter((total) => total !== 425),
});

/** A run: entries with distinct ids, plus up to two entries with a null id. */
const entriesArb: fc.Arbitrary<ResultEntry[]> = fc
  .tuple(
    fc.uniqueArray(rawArb, { selector: (raw) => raw.id, maxLength: ID_POOL.length }),
    fc.array(fc.constantFrom(...STATES), { maxLength: 2 }),
  )
  .map(([withIds, nullStates]) => {
    const red = withIds.map((raw, index) => toEntry(raw, index + 1));
    const nulls = nullStates.map((state, index) =>
      toEntry({ id: null, state, tool: "quote", total: 430 }, withIds.length + index + 1),
    );
    return [...red, ...nulls];
  });

/** One spec for an id from the pool. Each kind changes how the id appears in the text. */
function specArb(entries: ResultEntry[]): fc.Arbitrary<BugfixSpec> {
  const byId = new Map<string, ResultEntry>();
  for (const entry of entries) if (entry.id !== null) byId.set(entry.id, entry);

  return fc
    .record({
      id: fc.constantFrom(...ID_POOL),
      kind: fc.constantFrom("cited", "cited-with-longer-note", "longer-only", "bare", "bare-longer"),
      suffix: fc.constantFrom(...SUFFIXES),
    })
    .map(({ id, kind, suffix }): BugfixSpec => {
      const longer = `${id}${suffix}`;
      const entry = byId.get(id);
      let text: string;
      if (entry === undefined || kind === "bare" || kind === "bare-longer") {
        text = kind === "bare-longer" ? `Notes about ${longer}.` : `Notes about ${id}.`;
      } else if (kind === "cited") {
        text = specFor(entry, entries, undefined);
      } else if (kind === "cited-with-longer-note") {
        text = specFor(entry, entries, longer);
      } else {
        text = replaceWhole(specFor(entry, entries, undefined), id, longer);
      }
      return { name: `${kind}-${id}`, text };
    });
}

const scenarioArb = entriesArb.chain((entries) =>
  fc
    .array(specArb(entries), { maxLength: 5 })
    .map((specs) => ({ entries, specs })),
);

/** Two red jars whose ids are SPC-0002 and SPC-00021, and one preserved companion. */
function fixtureJars(): ResultEntry[] {
  return [
    toEntry({ id: "SPC-0002", state: "rattled", tool: "quote", total: 430 }, 1),
    toEntry({ id: "SPC-00021", state: "rattled", tool: "quote", total: 430 }, 2),
    toEntry({ id: "SPC-0099", state: "preserved", tool: "quote", total: 0 }, 3),
  ];
}

function entryNamed(jars: ResultEntry[], id: string): ResultEntry {
  const found = jars.find((jar) => jar.id === id);
  if (found === undefined) throw new Error(`fixture has no ${id}`);
  return found;
}

describe("Property 7: filed ids never include a jar that is not red", () => {
  // Feature: cabinet-ui, Property 7: Filed ids never include a jar that is not red
  it("files only ids of rattled or cracked jars, and every filed id has a passing citing spec", () => {
    fc.assert(
      fc.property(scenarioArb, ({ entries, specs }) => {
        const filed = filedJarIds(specs, entries);

        for (const id of filed) {
          const entry = entries.find((jar) => jar.id === id);
          expect(entry).toBeDefined();
          expect(entry !== undefined && isRed(entry)).toBe(true);
          const justified = specs.some(
            (spec) => citesId(spec.text, id) && checkSpec(spec.text, id, entries) === "pass",
          );
          expect(justified).toBe(true);
        }

        for (const jar of entries) {
          if (jar.id !== null && !isRed(jar)) expect(filed.has(jar.id)).toBe(false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it("files SPC-0002 when a passing spec cites it as a whole token", () => {
    const jars = fixtureJars();
    const text = specFor(entryNamed(jars, "SPC-0002"), jars, undefined);

    expect(checkSpec(text, "SPC-0002", jars)).toBe("pass");
    expect([...filedJarIds([{ name: "whole", text }], jars)]).toEqual(["SPC-0002"]);
  });

  it("does not file SPC-0002 when a passing spec cites SPC-00021, which contains SPC-0002", () => {
    const jars = fixtureJars();
    const text = specFor(entryNamed(jars, "SPC-00021"), jars, undefined);

    expect(citesId(text, "SPC-0002")).toBe(false);
    expect(checkSpec(text, "SPC-00021", jars)).toBe("pass");
    const filed = filedJarIds([{ name: "long-token", text }], jars);
    expect(filed.has("SPC-0002")).toBe(false);
    expect([...filed]).toEqual(["SPC-00021"]);
  });

  it("does not file SPC-0002 when its only mention is inside the longer token SPC-00021", () => {
    const jars = fixtureJars();
    // The SPC-0002 spec, with every whole SPC-0002 token replaced by SPC-00021.
    const text = replaceWhole(specFor(entryNamed(jars, "SPC-0002"), jars, undefined), "SPC-0002", "SPC-00021");

    expect(citesId(text, "SPC-0002")).toBe(false);
    expect(citesId(text, "SPC-00021")).toBe(true);
    const filed = filedJarIds([{ name: "inside-long-token", text }], jars);
    expect(filed.has("SPC-0002")).toBe(false);
  });
});
