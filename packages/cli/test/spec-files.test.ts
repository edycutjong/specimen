/**
 * Tests for the filed-jar aggregation of spec-files.ts (Requirement 9). Every Bugfix_Spec lives in
 * a temporary workspace with its own `.kiro` folder. The real checkSpec from core decides each
 * spec. The repository `jars/`, `.specimen/` and `servers/` are never touched.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Json, type ResultEntry, checkSpec, diff } from "@specimen/core";
import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { citesId, filedJarIds, readBugfixSpecs } from "../src/replay/spec-files.js";

const MARKER_START = "<!-- specimen:repro:start -->";
const MARKER_END = "<!-- specimen:repro:end -->";

/** Jar ids that share substrings. `SPC-0004` lies inside `SPC-00045`, and `SPC-0001` inside `SPC-00012`. */
const POOL = ["SPC-0004", "SPC-00045", "SPC-0045", "SPC-0001", "SPC-0002", "SPC-00012", "SPC-0012"] as const;

const INPUT = { room_id: "r-04", nights: 2 };
const JARRED = '{"room_id":"r-04","nights":2,"total":425.00}';
const REPLAYED_TOTAL = 430;

/** A Result_Entry built with the real structural diff. A rattled jar has one `/total` change. */
function entryFor(id: string, state: "rattled" | "preserved"): ResultEntry {
  if (state === "rattled") {
    const replayed = { room_id: "r-04", nights: 2, total: REPLAYED_TOTAL } as Json;
    return {
      id,
      session_id: `s-${id}`,
      seq: 1,
      tool: "quote",
      state,
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
  // A preserved jar of another tool, so the Unchanged Section of quote specs stays valid.
  return {
    id,
    session_id: `s-${id}`,
    seq: 1,
    tool: "search_rooms",
    state,
    input: { nights: 2 },
    response_text: JARRED,
    changes: [],
    compatible: [],
    ignored: [],
    replayed_text: JARRED,
    replayed: JSON.parse(JARRED) as Json,
    ms: 1,
  };
}

/**
 * Builds a Bugfix_Spec for the given ids. Each id gets a Current line and an Expected line, and
 * a Repro_Block entry. `badRepro` ids carry a different replayed total, `badExpected` ids name a
 * wrong total, and `noRepro` drops the Repro_Block. `prose` ids are cited in the Unchanged Section
 * without a Repro_Block entry.
 */
function specText(options: {
  ids: readonly string[];
  badRepro?: readonly string[];
  badExpected?: readonly string[];
  noRepro?: boolean;
  prose?: readonly string[];
}): string {
  const badRepro = new Set(options.badRepro ?? []);
  const badExpected = new Set(options.badExpected ?? []);
  const lines = [
    "# Bugfix: quote total",
    "",
    "## Current Behavior (Defect)",
    "",
    ...options.ids.map(
      (id) => `WHEN quote is called for r-04 with 2 nights THEN the system returns /total ${REPLAYED_TOTAL} for ${id}.`,
    ),
    "",
    "## Expected Behavior (Correct)",
    "",
    ...options.ids.map((id) => {
      const total = badExpected.has(id) ? "999" : "425.00";
      return `WHEN quote is called for r-04 with 2 nights THEN the system SHALL return /total ${total} for ${id}.`;
    }),
    "",
    "## Unchanged Behavior (Regression Prevention)",
    "",
    "WHEN quote is called for r-04 THEN the system SHALL CONTINUE TO return the recorded body. The replay holds no preserved jar of quote.",
    ...(options.prose ?? []).map((id) => `Related jar: ${id}.`),
    "",
  ];
  if (options.noRepro !== true) {
    const items = options.ids.map((id) => ({
      id,
      input: INPUT,
      response_text: JARRED,
      replayed: { room_id: "r-04", nights: 2, total: badRepro.has(id) ? 999 : REPLAYED_TOTAL },
      changed_paths: ["/total"],
    }));
    lines.push(MARKER_START, "```json specimen-repro", JSON.stringify(items, null, 2), "```", MARKER_END, "");
  }
  return lines.join("\n");
}

/** The whole-token set of a text: every maximal run of id characters. Independent of citesId. */
function tokensOf(text: string): Set<string> {
  return new Set(text.match(/[A-Za-z0-9-]+/g) ?? []);
}

/** Every regular file under `root` with its exact bytes. */
function byteSnapshot(root: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const rel of readdirSync(root, { recursive: true }) as string[]) {
    const full = join(root, rel);
    if (statSync(full).isFile()) files.set(rel, readFileSync(full));
  }
  return files;
}

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "specimen-spec-files-")));
  mkdirSync(join(root, ".kiro"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Writes `.kiro/specs/<name>/bugfix.md` in the temporary workspace. */
function writeSpec(name: string, text: string): void {
  mkdirSync(join(root, ".kiro", "specs", name), { recursive: true });
  writeFileSync(join(root, ".kiro", "specs", name, "bugfix.md"), text, "utf8");
}

describe("filed jar aggregation (real checkSpec)", () => {
  // Feature: replay-engine, Property 24: Filed ids are exactly those with at least one passing spec
  it("files exactly the red ids that a spec cites whole-token and that checkSpec passes", () => {
    const specArb = fc.record({
      subject: fc.constantFrom(...POOL),
      variant: fc.constantFrom("good", "noRepro", "badRepro", "badExpected"),
      prose: fc.array(fc.constantFrom(...POOL), { maxLength: 2 }),
    });
    const jarsArb = fc.uniqueArray(
      fc.record({ id: fc.constantFrom(...POOL), state: fc.constantFrom("rattled", "rattled", "preserved") }),
      { selector: (jar) => jar.id, minLength: 1, maxLength: POOL.length },
    );

    fc.assert(
      fc.property(jarsArb, fc.array(specArb, { minLength: 1, maxLength: 4 }), (jarSpecs, specSpecs) => {
        const jars = jarSpecs.map((jar) => entryFor(jar.id, jar.state));
        const specs = specSpecs.map((spec, index) => ({
          name: `spec-${index}`,
          text: specText({
            ids: [spec.subject],
            noRepro: spec.variant === "noRepro",
            badRepro: spec.variant === "badRepro" ? [spec.subject] : [],
            badExpected: spec.variant === "badExpected" ? [spec.subject] : [],
            prose: spec.prose,
          }),
        }));

        const actual = filedJarIds(specs, jars);

        const expected = new Set(
          jarSpecs
            .filter((jar) => jar.state === "rattled")
            .map((jar) => jar.id)
            .filter((id) =>
              specs.some((spec) => tokensOf(spec.text).has(id) && checkSpec(spec.text, id, jars) === "pass"),
            ),
        );
        expect([...actual].sort()).toEqual([...expected].sort());
      }),
      { numRuns: 150 },
    );
  }, 300_000);
});

describe("filed jar examples", () => {
  it("counts only the passing ids of a spec that cites several ids and fails for one", () => {
    const jars = [entryFor("SPC-0001", "rattled"), entryFor("SPC-0002", "rattled")];
    const text = specText({ ids: ["SPC-0001", "SPC-0002"], badRepro: ["SPC-0002"] });
    writeSpec("quote-total", text);

    expect(checkSpec(text, "SPC-0001", jars)).toBe("pass");
    const failed = checkSpec(text, "SPC-0002", jars);
    expect(failed).not.toBe("pass");
    expect(failed === "pass" ? [] : failed.map((failure) => failure.code)).toContain("repro_not_verbatim");

    expect([...filedJarIds(readBugfixSpecs(root), jars)]).toEqual(["SPC-0001"]);
  });

  it("ignores a spec that cites no Red_Jar, including a spec for a preserved jar", () => {
    const jars = [entryFor("SPC-0001", "rattled"), entryFor("SPC-0002", "preserved")];
    writeSpec("unknown-id", specText({ ids: ["SPC-0009"] }));
    writeSpec("preserved-id", specText({ ids: ["SPC-0002"] }));
    writeSpec("no-id", "# Bugfix: nothing cited here\n");

    expect(filedJarIds(readBugfixSpecs(root), jars).size).toBe(0);
  });

  it("respects the Whole_Token_Match: SPC-0004 is not cited by a spec that only cites SPC-00045", () => {
    const jars = [entryFor("SPC-0004", "rattled"), entryFor("SPC-00045", "rattled")];
    writeSpec("long-id", specText({ ids: ["SPC-00045"] }));

    expect([...filedJarIds(readBugfixSpecs(root), jars)]).toEqual(["SPC-00045"]);
  });

  it("respects the Whole_Token_Match: SPC-00045 is not cited by a spec that only cites SPC-0004", () => {
    const jars = [entryFor("SPC-0004", "rattled"), entryFor("SPC-00045", "rattled")];
    writeSpec("short-id", specText({ ids: ["SPC-0004"] }));

    expect([...filedJarIds(readBugfixSpecs(root), jars)]).toEqual(["SPC-0004"]);
  });

  it("matches ids as whole tokens in citesId", () => {
    expect(citesId("cites SPC-00045 only", "SPC-0004")).toBe(false);
    expect(citesId("cites SPC-0004.", "SPC-0004")).toBe(true);
    expect(citesId("(SPC-0004)", "SPC-0004")).toBe(true);
  });

  it("modifies no Bugfix_Spec file: the bytes before and after are equal", () => {
    const jars = [entryFor("SPC-0001", "rattled"), entryFor("SPC-0002", "rattled")];
    writeSpec("passing", specText({ ids: ["SPC-0001"] }));
    writeSpec("failing", specText({ ids: ["SPC-0002"], noRepro: true }));
    writeSpec("mixed", specText({ ids: ["SPC-0001", "SPC-0002"], badRepro: ["SPC-0002"] }));
    const before = byteSnapshot(root);

    const filed = filedJarIds(readBugfixSpecs(root), jars);

    expect([...filed].sort()).toEqual(["SPC-0001"]);
    expect(byteSnapshot(root)).toEqual(before);
  });

  it("reads only .kiro/specs/<name>/bugfix.md in code-unit order and returns nothing without specs", () => {
    expect(readBugfixSpecs(root)).toEqual([]);

    writeSpec("b-spec", "second");
    writeSpec("a-spec", "first");
    mkdirSync(join(root, ".kiro", "specs", "no-bugfix"), { recursive: true });
    writeFileSync(join(root, ".kiro", "specs", "no-bugfix", "requirements.md"), "not a bugfix", "utf8");

    expect(readBugfixSpecs(root)).toEqual([
      { name: "a-spec", text: "first" },
      { name: "b-spec", text: "second" },
    ]);
  });
});
