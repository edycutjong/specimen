/**
 * Fixture eval E3b (Requirements 5.11, 5.12, 9.2 to 9.5). Three rattled quote jars and one
 * Bugfix_Spec that cites all three ids give HOLD with `covered` true. A spec that omits one id
 * gives `covered` false, and the missing id is named by the Spec_Checker and by the report.
 *
 * `verdict()` takes only counts, so the unfiled ids are derived here from the Result_Entries and
 * the filed set. No verdict-level field is invented.
 */
import { describe, expect, it } from "vitest";
import {
  type Json,
  type ReplayResult,
  type ResultEntry,
  buildReport,
  checkSpec,
  diff,
  replayResultSchema,
  verdict,
} from "../src/index.js";

const MARKER_START = "<!-- specimen:repro:start -->";
const MARKER_END = "<!-- specimen:repro:end -->";

type Fixture = {
  id: string;
  input: Json;
  jarred: string;
  replayed: string;
  current: string;
  expected: string;
};

/** Three quote jars whose `/total` differs from the replay. Each has its own jarred literal. */
const FIXTURES: Fixture[] = [
  {
    id: "SPC-0001",
    input: { room_id: "r-04", nights: 2 },
    jarred: '{"room_id":"r-04","nights":2,"total":425.00}',
    replayed: '{"room_id":"r-04","nights":2,"total":430}',
    current: "WHEN quote is called for r-04 with 2 nights THEN the system returns /total 430 for SPC-0001.",
    expected:
      "WHEN quote is called for r-04 with 2 nights THEN the system SHALL return /total 425.00 for SPC-0001.",
  },
  {
    id: "SPC-0002",
    input: { room_id: "r-08", nights: 3 },
    jarred: '{"room_id":"r-08","nights":3,"total":318.50}',
    replayed: '{"room_id":"r-08","nights":3,"total":312}',
    current: "WHEN quote is called for r-08 with 3 nights THEN the system returns /total 312 for SPC-0002.",
    expected:
      "WHEN quote is called for r-08 with 3 nights THEN the system SHALL return /total 318.50 for SPC-0002.",
  },
  {
    id: "SPC-0003",
    input: { room_id: "r-09", nights: 1 },
    jarred: '{"room_id":"r-09","nights":1,"total":512.75}',
    replayed: '{"room_id":"r-09","nights":1,"total":520}',
    current: "WHEN quote is called for r-09 with 1 night THEN the system returns /total 520 for SPC-0003.",
    expected:
      "WHEN quote is called for r-09 with 1 night THEN the system SHALL return /total 512.75 for SPC-0003.",
  },
];

const TOOLS_LISTED = ["quote"];

/** A rattled quote Result_Entry, with its changes produced by the structural diff. */
function rattledQuote(fixture: Fixture, seq: number): ResultEntry {
  const replayed = JSON.parse(fixture.replayed) as Json;
  return {
    id: fixture.id,
    session_id: "s-covered",
    seq,
    tool: "quote",
    state: "rattled",
    input: fixture.input,
    response_text: fixture.jarred,
    changes: diff(JSON.parse(fixture.jarred) as Json, replayed),
    compatible: [],
    ignored: [],
    replayed_text: fixture.replayed,
    replayed,
    ms: 1,
  };
}

const ENTRIES: ResultEntry[] = FIXTURES.map((fixture, index) => rattledQuote(fixture, index + 1));

/** The Repro_Block entries of the given jars, in the shape of Requirement 7 criterion 8. */
function reproBlock(entries: ResultEntry[]): string {
  const items = entries.map((entry) => ({
    id: entry.id,
    input: entry.input,
    response_text: entry.response_text,
    replayed: entry.replayed,
    changed_paths: entry.changes.map((change) => change.path),
  }));
  return [
    MARKER_START,
    "```json specimen-repro",
    JSON.stringify(items, null, 2),
    "```",
    MARKER_END,
  ].join("\n");
}

/** A Bugfix_Spec that covers the given fixtures and carries the Repro_Block of their entries. */
function bugfixSpec(fixtures: Fixture[]): string {
  const ids = new Set(fixtures.map((fixture) => fixture.id));
  const entries = ENTRIES.filter((entry) => entry.id !== null && ids.has(entry.id));
  return [
    "# Bugfix: quote totals differ from the recorded totals",
    "",
    "## Current Behavior (Defect)",
    "",
    ...fixtures.map((fixture) => fixture.current),
    "",
    "## Expected Behavior (Correct)",
    "",
    ...fixtures.map((fixture) => fixture.expected),
    "",
    "## Unchanged Behavior (Regression Prevention)",
    "",
    "WHEN quote is called for r-04 THEN the system SHALL CONTINUE TO return the recorded bodies of the other calls. The replay holds no preserved jar of quote.",
    "",
    reproBlock(entries),
    "",
  ].join("\n");
}

/** The ids whose Result_Entry is red and for which the spec text returns `pass`. */
function filedIdsFor(text: string, entries: ResultEntry[]): Set<string> {
  const filed = new Set<string>();
  for (const entry of entries) {
    if (entry.id === null) continue;
    if (entry.state !== "rattled" && entry.state !== "cracked") continue;
    if (checkSpec(text, entry.id, entries) === "pass") filed.add(entry.id);
  }
  return filed;
}

/** The red ids that no passing spec files. Derived from the Replay_Result, not from the verdict. */
function unfiledRedIds(entries: ResultEntry[], filed: ReadonlySet<string>): string[] {
  return entries
    .filter(
      (entry): entry is ResultEntry & { id: string } =>
        entry.id !== null && (entry.state === "rattled" || entry.state === "cracked"),
    )
    .map((entry) => entry.id)
    .filter((id) => !filed.has(id));
}

/** A Replay_Result around the entries and verdict, validated by its zod schema. */
function replayResultFor(entries: ResultEntry[], outcome: ReturnType<typeof verdict>): ReplayResult {
  const counts: ReplayResult["counts"] = {
    preserved: 0,
    rattled: 0,
    cracked: 0,
    unsealed: 0,
    skipped: 0,
  };
  for (const entry of entries) counts[entry.state] += 1;
  return replayResultSchema.parse({
    v: 1,
    server: "fixture",
    started_at: "2026-01-01T00:00:00.000Z",
    strict: false,
    jars: entries,
    spoiled: [],
    counts,
    schema_diff: { tools_removed: [], tools_added: [], input_schema_changed: [] },
    verdict: outcome.verdict,
    red: outcome.red,
    filed: outcome.filed,
    covered: outcome.covered,
    reason: outcome.reason,
    coverage: outcome.coverage,
  });
}

describe("fixture eval E3b: covered", () => {
  it("builds three rattled quote jars with one value Change at /total each", () => {
    for (const entry of ENTRIES) {
      expect(entry.state).toBe("rattled");
      expect(entry.tool).toBe("quote");
      expect(entry.changes.map((change) => [change.path, change.kind])).toEqual([["/total", "value"]]);
    }
  });

  it("gives HOLD with covered true when one spec files all three rattled ids", () => {
    const spec = bugfixSpec(FIXTURES);
    const filed = filedIdsFor(spec, ENTRIES);
    expect(filed.size).toBe(3);

    const outcome = verdict({
      entries: ENTRIES,
      spoiledCount: 0,
      toolsListed: TOOLS_LISTED,
      filedIds: filed,
    });

    expect(outcome.verdict).toBe("HOLD");
    expect(outcome.red).toBe(3);
    expect(outcome.filed).toBe(3);
    expect(outcome.covered).toBe(true);
    expect(outcome.reason).toBe("3 rattled");
    expect(unfiledRedIds(ENTRIES, filed)).toEqual([]);

    const [firstLine] = buildReport(replayResultFor(ENTRIES, outcome));
    expect(firstLine?.startsWith("HOLD · covered · 3 rattled · ")).toBe(true);
  });

  it("gives covered false when one id is omitted, and names the missing id", () => {
    const covered = FIXTURES.slice(0, 2);
    const spec = bugfixSpec(covered);
    const filed = filedIdsFor(spec, ENTRIES);
    expect(filed.size).toBe(2);
    expect(filed.has("SPC-0003")).toBe(false);

    const outcome = verdict({
      entries: ENTRIES,
      spoiledCount: 0,
      toolsListed: TOOLS_LISTED,
      filedIds: filed,
    });

    expect(outcome.verdict).toBe("HOLD");
    expect(outcome.red).toBe(3);
    expect(outcome.filed).toBe(2);
    expect(outcome.covered).toBe(false);
    expect(outcome.reason).toBe("3 rattled");

    // The unfiled id comes from the Replay_Result.
    expect(unfiledRedIds(ENTRIES, filed)).toEqual(["SPC-0003"]);

    // The Spec_Checker names the missing id in its failure.
    const checked = checkSpec(spec, "SPC-0003", ENTRIES);
    expect(checked).not.toBe("pass");
    const failures = checked === "pass" ? [] : checked;
    expect(failures).toContainEqual({
      code: "jar_id",
      message: "spec does not cite the jar id SPC-0003",
    });

    // The report has no covered marker and lists the unfiled jar on its own line.
    const report = buildReport(replayResultFor(ENTRIES, outcome));
    expect(report[0]?.startsWith("HOLD · 3 rattled · ")).toBe(true);
    expect(report[0]?.includes("covered")).toBe(false);
    expect(report.some((line) => line.startsWith("SPC-0003 · quote · rattled · "))).toBe(true);
  });
});
