import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Failure,
  type Json,
  type ResultEntry,
  checkSpec,
  diff,
} from "../src/index.js";

const RUNS = { numRuns: 150 };
const JAR = "SPC-0001";
const MARKER_START = "<!-- specimen:repro:start -->";
const MARKER_END = "<!-- specimen:repro:end -->";

type Sections = { current: string; expected: string; unchanged: string };
type ReproOptions = { indent?: number; reverse?: boolean };

/** A rattled jar: the diff of the jarred and the replayed JSON text. */
function rattledEntry(
  id: string,
  tool: string,
  responseText: string,
  replayedText: string,
  input: Json,
): ResultEntry {
  const now = JSON.parse(replayedText) as Json;
  return {
    id,
    session_id: "s-1",
    seq: 1,
    tool,
    state: "rattled",
    input,
    response_text: responseText,
    changes: diff(JSON.parse(responseText) as Json, now),
    compatible: [],
    ignored: [],
    replayed_text: replayedText,
    replayed: now,
    ms: 1,
  };
}

/** A jar that was replayed clean. Its id can be named in the Unchanged Section. */
function preservedEntry(id: string, tool: string, state: ResultEntry["state"] = "preserved"): ResultEntry {
  return {
    id,
    session_id: "s-2",
    seq: 1,
    tool,
    state,
    input: { room_id: "r-04" },
    response_text: '{"ok":true}',
    changes: [],
    compatible: [],
    ignored: [],
    replayed_text: '{"ok":true}',
    replayed: { ok: true },
    ms: 1,
  };
}

const QUOTE_JARRED = '{"room_id":"r-04","nights":2,"total":425.00}';
const QUOTE_REPLAYED = '{"room_id":"r-04","nights":2,"total":430}';
const QUOTE_INPUT = { room_id: "r-04", nights: 2 };

function quoteEntry(id = JAR): ResultEntry {
  return rattledEntry(id, "quote", QUOTE_JARRED, QUOTE_REPLAYED, QUOTE_INPUT);
}

const VALID_SECTIONS: Sections = {
  current: "WHEN quote is called for r-04 with 2 nights THEN the system returns /total 430 for SPC-0001.",
  expected: "WHEN quote is called for r-04 with 2 nights THEN the system SHALL return /total 425.00.",
  unchanged:
    "WHEN quote is called for r-04 THEN the system SHALL CONTINUE TO return the body recorded in SPC-0002.",
};

/** The Result_Entry fields of one jar, in the Repro_Block shape of Requirement 7 criterion 8. */
function reproItems(entries: ResultEntry[], reverse: boolean): unknown[] {
  return entries.map((entry) => {
    const responseText =
      reverse && entry.response_text !== null
        ? JSON.stringify(reverseKeys(JSON.parse(entry.response_text)), null, 3)
        : entry.response_text;
    const item = {
      id: entry.id,
      input: entry.input,
      response_text: responseText,
      replayed: entry.replayed,
      changed_paths: entry.changes.map((change) => change.path),
    };
    return reverse ? reverseKeys(item) : item;
  });
}

/** A copy of a value with every object's keys in reverse order. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => reverseKeys(item));
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .reverse()
        .map((key) => [key, reverseKeys(record[key])]),
    );
  }
  return value;
}

/** The Repro_Block content. With `reverse`, keys are reversed and the whitespace changes. */
function reproJson(entries: ResultEntry[], options: ReproOptions = {}): string {
  const indent = options.indent ?? 2;
  const items = reproItems(entries, options.reverse === true);
  return JSON.stringify(items, null, indent);
}

/** The Marker_Pair and the fenced block that holds the Repro_Block of the given entries. */
function reproRegion(entries: ResultEntry[], options: ReproOptions = {}): string {
  return regionRaw([MARKER_START, "```json specimen-repro", reproJson(entries, options), "```", MARKER_END]);
}

function regionRaw(lines: string[]): string {
  return lines.join("\n");
}

/** A complete Bugfix_Spec text with the three named Sections and the given Repro region. */
function specText(sections: Sections, region: string): string {
  return [
    "# Bugfix: quote total",
    "",
    "## Current Behavior (Defect)",
    "",
    sections.current,
    "",
    "## Expected Behavior (Correct)",
    "",
    sections.expected,
    "",
    "## Unchanged Behavior (Regression Prevention)",
    "",
    sections.unchanged,
    "",
    region,
    "",
  ].join("\n");
}

function codesOf(result: "pass" | Failure[]): string[] {
  return result === "pass" ? [] : result.map((failure) => failure.code);
}

function failuresWith(result: "pass" | Failure[], code: string): Failure[] {
  return result === "pass" ? [] : result.filter((failure) => failure.code === code);
}

const VALID_REGION = reproRegion([quoteEntry()]);
const VALID_SPEC = specText(VALID_SECTIONS, VALID_REGION);
const COMPANIONS = [preservedEntry("SPC-0002", "quote")];
const QUOTE_JARS = [quoteEntry(), ...COMPANIONS];

describe("checkSpec fixture E4 and the valid spec", () => {
  it("passes a complete spec whose Repro_Block matches the replay", () => {
    expect(checkSpec(VALID_SPEC, JAR, QUOTE_JARS)).toBe("pass");
  });

  it("fails with repro_missing when the Repro_Block is missing", () => {
    const noRepro = specText(VALID_SECTIONS, "");
    const result = checkSpec(noRepro, JAR, QUOTE_JARS);
    expect(codesOf(result)).toContain("repro_missing");
    expect(codesOf(result)).not.toContain("repro_not_verbatim");
  });

  it("fails with repro_not_verbatim for an edited value and names the field", () => {
    const edited = quoteEntry();
    edited.replayed = { room_id: "r-04", nights: 2, total: 431 };
    const result = checkSpec(specText(VALID_SECTIONS, reproRegion([edited])), JAR, QUOTE_JARS);
    const failures = failuresWith(result, "repro_not_verbatim");
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toContain("replayed");
  });

  it("passes when the keys of the Repro_Block are reordered and the whitespace changes", () => {
    const reordered = reproRegion([quoteEntry()], { reverse: true, indent: 0 });
    expect(checkSpec(specText(VALID_SECTIONS, reordered), JAR, QUOTE_JARS)).toBe("pass");
  });

  it("fails with expected_reference when Expected Behavior omits the Reference", () => {
    const sections = {
      ...VALID_SECTIONS,
      expected: "WHEN quote is called for r-04 with 2 nights THEN the system SHALL return the recorded amount.",
    };
    const result = checkSpec(specText(sections, VALID_REGION), JAR, QUOTE_JARS);
    expect(codesOf(result)).toEqual(["expected_reference"]);
    expect(failuresWith(result, "expected_reference")[0]?.message).toBe("expected does not name the reference");
  });

  it("does not accept the number re-rendered without its literal", () => {
    const sections = {
      ...VALID_SECTIONS,
      expected: "WHEN quote is called for r-04 with 2 nights THEN the system SHALL return /total 425.",
    };
    expect(codesOf(checkSpec(specText(sections, VALID_REGION), JAR, QUOTE_JARS))).toContain(
      "expected_reference",
    );
  });
});

describe("checkSpec", () => {
  // Feature: replay-engine, Property 19: The Spec_Checker never reads verdict-level fields and short-circuits correctly
  it("Property 19: the checker never reads verdict-level fields and short-circuits correctly", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("preserved", "rattled", "cracked", "unsealed", "skipped"),
        fc.string({ maxLength: 200 }),
        fc.boolean(),
        fc.constantFrom("SHIP", "HOLD"),
        fc.nat(5),
        fc.nat(5),
        fc.boolean(),
        fc.string({ maxLength: 20 }),
        (state, noise, useValid, verdict, red, filed, covered, reason) => {
          const entry: ResultEntry = { ...quoteEntry(), state: state as ResultEntry["state"] };
          const jars = [entry, ...COMPANIONS];
          const text = useValid ? VALID_SPEC : noise;

          // A Replay_Result with other verdict-level values. The checker sees only its jars.
          const original = { verdict: "HOLD", red: 0, filed: 0, covered: false, reason: "none", jars };
          const changed = {
            verdict,
            red,
            filed,
            covered,
            reason,
            jars: jars.map((jar) => ({ ...jar, reason: noise, error: noise, seq: red + 1, ms: filed })),
          };
          expect(checkSpec(text, JAR, changed.jars)).toEqual(checkSpec(text, JAR, original.jars));

          if (state !== "rattled" && state !== "cracked") {
            expect(checkSpec(text, JAR, jars)).toEqual([
              { code: "not_red", message: "jar is not rattled or cracked" },
            ]);
          } else if (!useValid) {
            expect(checkSpec(text, JAR, jars)).not.toBe("pass");
          }

          expect(checkSpec(text, "SPC-9999", jars)).toEqual([
            { code: "jar_unknown", message: "jar SPC-9999 is not in the Replay_Result" },
          ]);
        },
      ),
      RUNS,
    );
  });

  // Feature: replay-engine, Property 20: Heading and keyword checks are scoped to their own Section
  it("Property 20: heading and keyword checks are scoped to their own Section", () => {
    const WHEN_LINE = "WHEN quote is called THEN the system returns the total";
    const SHALL_LINE = "THE SYSTEM SHALL return the total";
    const CONTINUE_LINE = "THE SYSTEM SHALL CONTINUE TO respond";
    type Name = "current" | "expected" | "unchanged";
    const names: Name[] = ["current", "expected", "unchanged"];

    fc.assert(
      fc.property(
        fc.constantFrom(...names),
        fc.constantFrom(...names),
        fc.constantFrom(...names),
        (whenAt, shallAt, continueAt) => {
          const placed: Record<Name, string[]> = { current: [], expected: [], unchanged: [] };
          placed[whenAt].push(WHEN_LINE);
          placed[shallAt].push(SHALL_LINE);
          placed[continueAt].push(CONTINUE_LINE);
          const sections: Sections = {
            current: placed.current.join("\n"),
            expected: placed.expected.join("\n"),
            unchanged: placed.unchanged.join("\n"),
          };
          const result = checkSpec(specText(sections, VALID_REGION), JAR, QUOTE_JARS);
          const keywordCodes = codesOf(result).filter((code) =>
            ["when_then", "shall", "shall_continue"].includes(code),
          );

          const expectedCodes: string[] = [];
          if (whenAt !== "current") expectedCodes.push("when_then");
          if (shallAt !== "expected") expectedCodes.push("shall");
          if (continueAt !== "unchanged") expectedCodes.push("shall_continue");
          expect([...keywordCodes].sort()).toEqual([...expectedCodes].sort());
        },
      ),
      RUNS,
    );
  });

  // Feature: replay-engine, Property 21: The Repro_Block is required, parseable, and compared up to formatting only
  it("Property 21: the Repro_Block is required, parseable, and compared up to formatting only", () => {
    const quoteCase = fc.record({
      room: fc.constantFrom("r-04", "r-08"),
      nights: fc.integer({ min: 1, max: 30 }),
      cents: fc.integer({ min: 0, max: 999999 }),
      delta: fc.integer({ min: 1, max: 500 }),
      indent: fc.integer({ min: 0, max: 4 }),
      edit: fc.constantFrom("input", "replayed", "response_text", "changed_paths"),
      cut: fc.nat(),
    });

    fc.assert(
      fc.property(quoteCase, ({ room, nights, cents, delta, indent, edit, cut }) => {
        const whole = Math.floor(cents / 100);
        const literal = `${whole}.${String(cents % 100).padStart(2, "0")}`;
        const jarred = `{"room_id":"${room}","nights":${nights},"total":${literal}}`;
        const replayed = `{"room_id":"${room}","nights":${nights},"total":${whole + delta}}`;
        const entry = rattledEntry(JAR, "quote", jarred, replayed, { room_id: room, nights });
        const sections = VALID_SECTIONS;

        // Formatting only: reversed keys and a different indent give no repro failure.
        const reordered = checkSpec(specText(sections, reproRegion([entry], { reverse: true, indent })), JAR, [entry]);
        expect(codesOf(reordered).filter((code) => code.startsWith("repro_"))).toEqual([]);

        // A changed value in the Repro_Block is repro_not_verbatim and names the field.
        const bad = structuredCloneEntry(entry);
        const badItem = bad;
        if (edit === "input") badItem.input = { room_id: room, nights: nights + 1 };
        if (edit === "replayed") badItem.replayed = { room_id: room, nights, total: whole + delta + 1 };
        if (edit === "response_text") {
          badItem.response_text = jarred.replace(literal, String(whole + delta + 7));
        }
        if (edit === "changed_paths") badItem.changes = [];
        const edited = checkSpec(specText(sections, reproRegion([badItem], { indent })), JAR, [entry]);
        const mismatches = failuresWith(edited, "repro_not_verbatim");
        expect(mismatches).toHaveLength(1);
        expect(mismatches[0]?.message).toContain(edit);

        // Any strict prefix of the Repro_Block text is not JSON, so it is repro_missing.
        const full = reproJson([entry], { indent: 0 });
        const prefix = full.slice(0, cut % full.length);
        const truncated = checkSpec(specText(sections, regionRaw([MARKER_START, "```json specimen-repro", prefix, "```", MARKER_END])), JAR, [entry]);
        expect(codesOf(truncated)).toContain("repro_missing");
      }),
      RUNS,
    );
  });

  // Feature: replay-engine, Property 22: The paths and unchanged-jar checks read the right Section and the right companion entries
  it("Property 22: the paths and unchanged-jar checks read the right Section and the right companion entries", () => {
    const FIELDS = ["alpha", "beta", "gamma", "delta"];
    const caseArb = fc.record({
      changedBits: fc.integer({ min: 1, max: 15 }),
      mentions: fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
      companions: fc.array(
        fc.record({
          tool: fc.constantFrom("quote", "search_rooms"),
          state: fc.constantFrom<ResultEntry["state"]>("preserved", "rattled"),
          mentioned: fc.boolean(),
        }),
        { maxLength: 4 },
      ),
      phrase: fc.boolean(),
    });

    fc.assert(
      fc.property(caseArb, ({ changedBits, mentions, companions, phrase }) => {
        const changed = FIELDS.map((_, i) => (changedBits & (1 << i)) !== 0);
        const jarredFields = FIELDS.map((name, i) => `"${name}":${10 + i}`);
        const replayedFields = FIELDS.map((name, i) => `"${name}":${10 + i + (changed[i] ? 1 : 0)}`);
        const entry = rattledEntry(
          JAR,
          "quote",
          `{${jarredFields.join(",")}}`,
          `{${replayedFields.join(",")}}`,
          { room_id: "r-04" },
        );

        const companionEntries = companions.map((c, i) =>
          preservedEntry(`SPC-${String(i + 2).padStart(4, "0")}`, c.tool, c.state),
        );
        const pieces = companions.flatMap((c, i) => (c.mentioned ? [companionEntries[i]?.id ?? ""] : []));

        const currentMentions = FIELDS.filter((_, i) => mentions[i] === true).map((name) => `/${name}`);
        const current = ["WHEN quote is called THEN the system returns", ...currentMentions, "."].join(" ");
        const unchangedLines = [
          ["WHEN quote is called THEN the system SHALL CONTINUE TO respond", ...pieces].join(" "),
        ];
        if (phrase) unchangedLines.push("no preserved jar of quote is recorded.");
        const sections: Sections = {
          current,
          expected: "WHEN quote is called THEN the system SHALL return the recorded total.",
          unchanged: unchangedLines.join("\n"),
        };

        const jars = [entry, ...companionEntries];
        const result = checkSpec(specText(sections, reproRegion([entry])), JAR, jars);

        // paths: every changed path must be named in Current Behavior and none is missing otherwise.
        const changedPaths = FIELDS.filter((_, i) => changed[i] === true).map((name) => `/${name}`);
        const missing = changedPaths.filter((path) => !currentMentions.includes(path));
        const pathFailures = failuresWith(result, "paths");
        if (missing.length === 0) {
          expect(pathFailures).toEqual([]);
        } else {
          expect(pathFailures).toHaveLength(1);
          for (const path of missing) expect(pathFailures[0]?.message).toContain(path);
        }

        // unchanged_jar: a preserved jar of the same tool must be named, else the phrase is needed.
        const sameToolPreserved = companions
          .map((c, i) => ({ c, id: companionEntries[i]?.id ?? "" }))
          .filter(({ c }) => c.tool === "quote" && c.state === "preserved");
        const unchangedPass =
          sameToolPreserved.length > 0
            ? sameToolPreserved.some(({ c }) => c.mentioned)
            : phrase;
        expect(failuresWith(result, "unchanged_jar").length === 0).toBe(unchangedPass);
      }),
      RUNS,
    );
  });
});

describe("checkSpec examples", () => {
  const regionWithContent = (content: string, info = "json specimen-repro"): string =>
    regionRaw([MARKER_START, "```" + info, content, "```", MARKER_END]);
  const goodContent = reproJson([quoteEntry()]);

  it("reports repro_missing for no Marker_Pair", () => {
    const region = regionRaw(["```json specimen-repro", goodContent, "```"]);
    expect(codesOf(checkSpec(specText(VALID_SECTIONS, region), JAR, QUOTE_JARS))).toContain("repro_missing");
  });

  it("reports repro_missing for two Marker_Pairs", () => {
    const region = regionRaw([VALID_REGION, VALID_REGION]);
    expect(codesOf(checkSpec(specText(VALID_SECTIONS, region), JAR, QUOTE_JARS))).toContain("repro_missing");
  });

  it("reports repro_missing for no fenced block between the markers", () => {
    const region = regionRaw([MARKER_START, goodContent, MARKER_END]);
    expect(codesOf(checkSpec(specText(VALID_SECTIONS, region), JAR, QUOTE_JARS))).toContain("repro_missing");
  });

  it("reports repro_missing for two fenced json specimen-repro blocks", () => {
    const region = regionRaw([
      MARKER_START,
      "```json specimen-repro",
      goodContent,
      "```",
      "```json specimen-repro",
      goodContent,
      "```",
      MARKER_END,
    ]);
    expect(codesOf(checkSpec(specText(VALID_SECTIONS, region), JAR, QUOTE_JARS))).toContain("repro_missing");
  });

  it("reports repro_missing for a block that is not valid JSON", () => {
    const result = checkSpec(specText(VALID_SECTIONS, regionWithContent("[{")), JAR, QUOTE_JARS);
    expect(codesOf(result)).toContain("repro_missing");
  });

  it("reports repro_missing for a block with the wrong info string", () => {
    const result = checkSpec(specText(VALID_SECTIONS, regionWithContent(goodContent, "json")), JAR, QUOTE_JARS);
    expect(codesOf(result)).toContain("repro_missing");
  });

  it("reports repro_missing for a block that fails its zod schema", () => {
    const noPaths = JSON.stringify([{ id: JAR, input: QUOTE_INPUT, response_text: QUOTE_JARRED, replayed: { total: 430 } }]);
    const result = checkSpec(specText(VALID_SECTIONS, regionWithContent(noPaths)), JAR, QUOTE_JARS);
    expect(codesOf(result)).toContain("repro_missing");
  });

  it("reports repro_missing when the block holds no entry for the jar", () => {
    const other = reproRegion([quoteEntry("SPC-0009")]);
    expect(codesOf(checkSpec(specText(VALID_SECTIONS, other), JAR, QUOTE_JARS))).toContain("repro_missing");
  });

  it("does not match SPC-0004 inside SPC-00045", () => {
    const entry = quoteEntry("SPC-0004");
    const jars = [entry, ...COMPANIONS];
    const cited = (id: string): string =>
      specText(
        {
          current: `WHEN quote is called THEN the system returns /total 430 for ${id}.`,
          expected: VALID_SECTIONS.expected,
          unchanged: VALID_SECTIONS.unchanged,
        },
        reproRegion([entry]).replaceAll("SPC-0004", id),
      );
    expect(failuresWith(checkSpec(cited("SPC-00045"), "SPC-0004", jars), "jar_id")).toEqual([
      { code: "jar_id", message: "spec does not cite the jar id SPC-0004" },
    ]);
    expect(failuresWith(checkSpec(cited("SPC-0004"), "SPC-0004", jars), "jar_id")).toEqual([]);
  });

  it("reports headings and the dependent paths check when Current Behavior is missing", () => {
    const text = specText(VALID_SECTIONS, VALID_REGION).replace("## Current Behavior (Defect)", "## Something Else");
    const result = checkSpec(text, JAR, QUOTE_JARS);
    expect(failuresWith(result, "headings").map((f) => f.message)).toEqual([
      'missing heading "Current Behavior (Defect)"',
    ]);
    expect(codesOf(result)).toEqual(expect.arrayContaining(["when_then", "paths"]));
  });

  it("reports the headings failure when a heading appears twice", () => {
    const text = `${VALID_SPEC}\n## Expected Behavior (Correct)\n\nextra\n`;
    expect(codesOf(checkSpec(text, JAR, QUOTE_JARS))).toContain("headings");
  });

  it("ignores a fake heading inside a fenced code block", () => {
    const text = specText(
      {
        ...VALID_SECTIONS,
        expected: `${VALID_SECTIONS.expected}\n\n\`\`\`text\n## Unchanged Behavior (Regression Prevention)\n\`\`\``,
      },
      VALID_REGION,
    );
    expect(checkSpec(text, JAR, QUOTE_JARS)).toBe("pass");
  });

  it("accepts 'no preserved jar' only when no preserved jar of the tool exists", () => {
    const phrase = "no preserved jar of quote is recorded.";
    const named = "WHEN quote is called THEN the system SHALL CONTINUE TO respond SPC-0002.";
    const onlyPhrase = { ...VALID_SECTIONS, unchanged: phrase };

    // A preserved quote exists, so the phrase is not enough.
    expect(failuresWith(checkSpec(specText(onlyPhrase, VALID_REGION), JAR, QUOTE_JARS), "unchanged_jar")).toHaveLength(1);
    // Naming that preserved quote passes.
    expect(failuresWith(checkSpec(specText({ ...VALID_SECTIONS, unchanged: named }, VALID_REGION), JAR, QUOTE_JARS), "unchanged_jar")).toEqual([]);

    // No preserved quote exists: the phrase passes, and a preserved jar of another tool does not count.
    const other = [quoteEntry(), preservedEntry("SPC-0003", "search_rooms")];
    expect(failuresWith(checkSpec(specText(onlyPhrase, VALID_REGION), JAR, other), "unchanged_jar")).toEqual([]);
    const otherNamed = { ...VALID_SECTIONS, unchanged: "WHEN quote is called THEN the system SHALL CONTINUE TO respond SPC-0003." };
    expect(failuresWith(checkSpec(specText(otherNamed, VALID_REGION), JAR, other), "unchanged_jar")).toHaveLength(1);
    expect(failuresWith(checkSpec(specText(VALID_SECTIONS, VALID_REGION), JAR, other), "unchanged_jar")).toHaveLength(1);
  });

  it("returns reference_unresolvable instead of throwing when the Reference cannot be derived", () => {
    const entry: ResultEntry = {
      ...rattledEntry(JAR, "quote", '{"a":1}', '{"a":1}', {}),
      changes: [{ path: "/missing", kind: "removed", was: 1 }],
    };
    const result = checkSpec(specText(VALID_SECTIONS, reproRegion([entry])), JAR, [entry]);
    expect(codesOf(result)).toContain("reference_unresolvable");
    expect(codesOf(result)).not.toContain("expected_reference");
  });

  it("gives the same result whatever the verdict-level fields of the Replay_Result hold", () => {
    const jars = QUOTE_JARS;
    const before = checkSpec(VALID_SPEC, JAR, jars);
    const replayResult = { verdict: "SHIP", red: 9, filed: 9, covered: true, reason: "changed", jars };
    expect(checkSpec(VALID_SPEC, JAR, replayResult.jars)).toEqual(before);
  });

  it("reads no verdict-level field and no node: module in the source", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/spec-check.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/from "node:/);
    expect(source).not.toMatch(/\.(verdict|red|filed|covered|reason)\b/);
  });
});

/** Deep copy of an entry whose changes array can be replaced without touching the original. */
function structuredCloneEntry(entry: ResultEntry): ResultEntry {
  return JSON.parse(JSON.stringify(entry)) as ResultEntry;
}
