import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { selectLatestReplay } from "../src/index.js";

const RUNS = { numRuns: 150 };

const MIN_DATE = new Date("1970-01-01T00:00:00.000Z");
const MAX_DATE = new Date("2099-12-31T23:59:59.999Z");

/** The 24-character `YYYY-MM-DDTHH-mm-ss.sssZ` form that `replayFileName` writes. */
const isoArb = fc
  .date({ min: MIN_DATE, max: MAX_DATE, noInvalidDate: true })
  .map((date) => date.toISOString().replace(/:/g, "-"));

const serverArb = fc
  .array(fc.constantFrom(..."abcxyz019._-"), { minLength: 1, maxLength: 12 })
  .map((chars) => chars.join(""));

/** A file name that matches the pattern, with the parts it was built from. */
type Candidate = { name: string; server: string; iso: string };

const matchingArb: fc.Arbitrary<Candidate> = fc
  .tuple(serverArb, isoArb)
  .map(([server, iso]) => ({ name: `${server}-${iso}.json`, server, iso }));

/** Names that must be ignored: wrong extension, no separator, short suffix, or extra suffix. */
const noiseArb: fc.Arbitrary<string> = fc
  .tuple(serverArb, isoArb)
  .chain(([server, iso]) =>
    fc.constantFrom(
      `${server}-${iso}.txt`,
      `${iso}.json`,
      `${server}-${iso.slice(1)}.json`,
      `${server}-${iso}.JSON`,
      `${server}-${iso}.json.bak`,
    ),
  );

/** The expected answer, computed by sorting: greatest ISO first, then greatest whole name. */
function expectedLatest(candidates: Candidate[]): string | undefined {
  const sorted = [...candidates].sort((a, b) => {
    if (a.iso !== b.iso) return a.iso < b.iso ? 1 : -1;
    if (a.name === b.name) return 0;
    return a.name < b.name ? 1 : -1;
  });
  return sorted[0]?.name;
}

describe("selectLatestReplay", () => {
  // Feature: replay-engine, Property 25: Replay result file selection picks the greatest ISO suffix deterministically
  it("picks the greatest ISO suffix, ties by whole name, ignoring non-matching names, in any order", () => {
    fc.assert(
      fc.property(
        fc.array(matchingArb, { maxLength: 8 }),
        fc.array(noiseArb, { maxLength: 8 }),
        (matching, noise) => {
          const names = [...matching.map((c) => c.name), ...noise];
          const expected = expectedLatest(matching);

          const picked = selectLatestReplay(names);
          expect(picked).toBe(expected);

          // Order of the listed names does not change the answer.
          const reversed = [...names].reverse();
          expect(selectLatestReplay(reversed)).toBe(expected);
          expect(selectLatestReplay(names)).toBe(picked);

          if (picked !== undefined) {
            expect(names).toContain(picked);
            expect(matching.map((c) => c.name)).toContain(picked);
          }
        },
      ),
      RUNS,
    );
  });

  it("ignores a name that does not match the pattern, even when it sorts last", () => {
    expect(
      selectLatestReplay([
        "alpha-2026-01-01T00-00-00.000Z.json",
        "zzz-notes.json",
        "zzz-2099-12-31T23-59-59.999Z.json.bak",
      ]),
    ).toBe("alpha-2026-01-01T00-00-00.000Z.json");
  });

  it("returns undefined when no name matches", () => {
    expect(selectLatestReplay([])).toBeUndefined();
    expect(selectLatestReplay(["notes.json", "2026-01-01T00-00-00.000Z.json"])).toBeUndefined();
  });

  it("prefers the greater ISO suffix over a greater server name", () => {
    expect(
      selectLatestReplay([
        "zzz-2026-01-01T00-00-00.000Z.json",
        "aaa-2026-02-01T00-00-00.000Z.json",
      ]),
    ).toBe("aaa-2026-02-01T00-00-00.000Z.json");
  });

  it("breaks an equal ISO suffix by the greatest whole name in code-unit order", () => {
    const iso = "2026-03-04T05-06-07.008Z";
    expect(selectLatestReplay([`beta-${iso}.json`, `Zeta-${iso}.json`, `alpha-${iso}.json`])).toBe(
      `beta-${iso}.json`,
    );
  });
});
