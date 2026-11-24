/**
 * Tests for the pure filed-ids rule in bugfix-spec.ts (Requirements 5.3, 5.5, 5.7, 5.9). No file
 * system access: the specs are strings and the jars are Replay_Result entries built with the real
 * structural diff. checkSpec from the same package decides each spec.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type BugfixSpec,
  type Json,
  type ResultEntry,
  checkSpec,
  citesId,
  diff,
  filedJarIds,
} from "../src/index.js";

const MARKER_START = "<!-- specimen:repro:start -->";
const MARKER_END = "<!-- specimen:repro:end -->";

const JARRED = '{"room_id":"r-04","nights":2,"total":425.00}';
const REPLAYED_TOTAL = 430;
const INPUT = { room_id: "r-04", nights: 2 };
const PRESERVED_ID = "SPC-0099";

/** A rattled quote jar with one `/total` change. */
function rattled(id: string | null): ResultEntry {
  const replayed = { room_id: "r-04", nights: 2, total: REPLAYED_TOTAL } as Json;
  return {
    id,
    session_id: "s-1",
    seq: 1,
    tool: "quote",
    state: "rattled",
    input: INPUT,
    response_text: JARRED,
    changes: diff(JSON.parse(JARRED) as Json, replayed),
    compatible: [],
    ignored: [],
    replayed_text: JSON.stringify(replayed),
    replayed,
    ms: 1,
  };
}

/** A preserved quote jar. Its id is named in the Unchanged Section of every valid spec below. */
function preservedQuote(): ResultEntry {
  return {
    id: PRESERVED_ID,
    session_id: "s-2",
    seq: 1,
    tool: "quote",
    state: "preserved",
    input: INPUT,
    response_text: JARRED,
    changes: [],
    compatible: [],
    ignored: [],
    replayed_text: JARRED,
    replayed: JSON.parse(JARRED) as Json,
    ms: 1,
  };
}

/** A complete Bugfix_Spec for one jar id. `total` is the value the Repro_Block records. */
function specFor(id: string, options: { total?: number; omitRepro?: boolean } = {}): string {
  const total = options.total ?? REPLAYED_TOTAL;
  const repro = [
    {
      id,
      input: INPUT,
      response_text: JARRED,
      replayed: { room_id: "r-04", nights: 2, total },
      changed_paths: ["/total"],
    },
  ];
  const lines = [
    `# Bugfix: quote total for ${id}`,
    "",
    "## Current Behavior (Defect)",
    "",
    `WHEN quote is called for r-04 with 2 nights THEN the system returns /total ${REPLAYED_TOTAL} for ${id}.`,
    "",
    "## Expected Behavior (Correct)",
    "",
    `WHEN quote is called for r-04 with 2 nights THEN the system SHALL return /total 425.00 for ${id}.`,
    "",
    "## Unchanged Behavior (Regression Prevention)",
    "",
    `WHEN quote is called for r-04 THEN the system SHALL CONTINUE TO return the body recorded in ${PRESERVED_ID}.`,
    "",
  ];
  if (options.omitRepro !== true) {
    lines.push(MARKER_START, "```json specimen-repro", JSON.stringify(repro, null, 2), "```", MARKER_END, "");
  }
  return lines.join("\n");
}

/** The Replay_Result entries of a run: the red jars plus one preserved companion. */
function runOf(...ids: string[]): ResultEntry[] {
  return [...ids.map((id) => rattled(id)), preservedQuote()];
}

describe("citesId", () => {
  it("matches an id only as a whole token", () => {
    expect(citesId("the jar SPC-00021 was filed", "SPC-0002")).toBe(false);
    expect(citesId("SPC-00021 and nothing else", "SPC-0002")).toBe(false);
    expect(citesId("SPC-0002 was filed", "SPC-0002")).toBe(true);
    expect(citesId("SPC-0002.", "SPC-0002")).toBe(true);
    expect(citesId("(SPC-0002)", "SPC-0002")).toBe(true);
    expect(citesId("`SPC-0002`", "SPC-0002")).toBe(true);
  });

  it("does not match an id glued to letters, digits or a hyphen", () => {
    expect(citesId("xSPC-0002", "SPC-0002")).toBe(false);
    expect(citesId("SPC-0002a", "SPC-0002")).toBe(false);
    expect(citesId("SPC-0002-retry", "SPC-0002")).toBe(false);
    expect(citesId("OLD-SPC-0002", "SPC-0002")).toBe(false);
  });

  // Feature: cabinet-ui, Property: a cited id never matches inside a longer id token
  it("never matches an id that is extended by an id character on either side", () => {
    const idArb = fc.integer({ min: 1, max: 9999 }).map((n) => `SPC-${String(n).padStart(4, "0")}`);
    const extraArb = fc.constantFrom(..."0123456789ABCDEFxyz-".split(""));
    const separatorArb = fc.constantFrom(" ", ".", ",", "(", "`", ":");

    fc.assert(
      fc.property(idArb, extraArb, separatorArb, (id, extra, separator) => {
        expect(citesId(`cites ${id}${extra}`, id)).toBe(false);
        expect(citesId(`cites ${extra}${id}`, id)).toBe(false);
        expect(citesId(`cites${separator}${id}${separator}done`, id)).toBe(true);
      }),
      { numRuns: 150 },
    );
  });
});

describe("filedJarIds", () => {
  it("files SPC-0002 and not SPC-00021 when a spec cites only SPC-0002", () => {
    const jars = runOf("SPC-0002", "SPC-00021");
    const specs: BugfixSpec[] = [{ name: "quote-total", text: specFor("SPC-0002") }];

    expect([...filedJarIds(specs, jars)]).toEqual(["SPC-0002"]);
  });

  it("files SPC-00021 and not SPC-0002 when a spec cites only SPC-00021", () => {
    const jars = runOf("SPC-0002", "SPC-00021");
    const specs: BugfixSpec[] = [{ name: "quote-total-long", text: specFor("SPC-00021") }];

    expect([...filedJarIds(specs, jars)]).toEqual(["SPC-00021"]);
  });

  it("ignores a jar whose id is null", () => {
    const jars = [rattled(null), rattled("SPC-0002"), preservedQuote()];
    const specs: BugfixSpec[] = [{ name: "quote-total", text: specFor("SPC-0002") }];

    const filed = filedJarIds(specs, jars);

    expect([...filed]).toEqual(["SPC-0002"]);
    expect(filed.has("null")).toBe(false);
  });

  it("ignores every jar that is not rattled or cracked, even when a spec cites it", () => {
    fc.assert(
      fc.property(fc.constantFrom("preserved", "unsealed", "skipped"), (state) => {
        const jar: ResultEntry = { ...rattled("SPC-0002"), state: state as ResultEntry["state"] };
        const specs: BugfixSpec[] = [{ name: "quote-total", text: specFor("SPC-0002") }];

        expect(filedJarIds(specs, [jar, preservedQuote()]).size).toBe(0);
      }),
      { numRuns: 30 },
    );
  });

  it("files nothing when the only spec fails checkSpec", () => {
    const jars = runOf("SPC-0002");
    const missingRepro = specFor("SPC-0002", { omitRepro: true });
    const wrongRepro = specFor("SPC-0002", { total: 999 });

    expect(checkSpec(missingRepro, "SPC-0002", jars)).not.toBe("pass");
    expect(checkSpec(wrongRepro, "SPC-0002", jars)).not.toBe("pass");
    expect(filedJarIds([{ name: "no-repro", text: missingRepro }], jars).size).toBe(0);
    expect(filedJarIds([{ name: "wrong-repro", text: wrongRepro }], jars).size).toBe(0);
  });

  // Feature: cabinet-ui, Property: a spec that fails checkSpec for its jar files nothing
  it("files no jar for any Repro_Block value that differs from the replay", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 500 }), (delta) => {
        const jars = runOf("SPC-0002");
        const text = specFor("SPC-0002", { total: REPLAYED_TOTAL + delta });

        expect(checkSpec(text, "SPC-0002", jars)).not.toBe("pass");
        expect(filedJarIds([{ name: "edited", text }], jars).size).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it("files only the id that the spec's own check passes when one spec also cites another red jar", () => {
    const jars = runOf("SPC-0002", "SPC-00021");
    const text = specFor("SPC-0002").replace(
      "## Expected Behavior (Correct)",
      "Related red jar: SPC-00021.\n\n## Expected Behavior (Correct)",
    );
    const specs: BugfixSpec[] = [{ name: "mixed", text }];

    expect(checkSpec(text, "SPC-0002", jars)).toBe("pass");
    expect(citesId(text, "SPC-00021")).toBe(true);
    expect(checkSpec(text, "SPC-00021", jars)).not.toBe("pass");
    expect([...filedJarIds(specs, jars)]).toEqual(["SPC-0002"]);
  });
});
