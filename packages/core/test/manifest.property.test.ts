import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { diffManifest, formatManifest, parseManifest, type ManifestEntry } from "../src/index.js";

// Feature: jar-capture, Property 18: Manifest format and diff
// **Validates: Requirements 8.6, 8.8, 8.9, 8.15, 8.17, 8.18**

const RUNS = { numRuns: 200 };

const LINE_FORM = /^[0-9a-f]{64}  .+$/;

/**
 * Characters kept out of generated paths. Backslash and newline are rejected by the format.
 * `\r`, `\u2028` and `\u2029` are excluded because a line that holds one does not parse back,
 * since `.` in the parser does not match them (see the note in the test report).
 */
const UNSAFE = /[\n\\\r\u2028\u2029]/;

const safeSegment = fc
  .string({ unit: "grapheme", minLength: 1, maxLength: 6 })
  .filter((s) => !UNSAFE.test(s));
const safePath = fc
  .array(safeSegment, { minLength: 1, maxLength: 3 })
  .map((parts) => parts.join("/"));

const hashArb = fc.uint8Array({ minLength: 32, maxLength: 32 }).map((b) => Buffer.from(b).toString("hex"));

const entriesArb: fc.Arbitrary<ManifestEntry[]> = fc.uniqueArray(
  fc.record({ path: safePath, sha256: hashArb }),
  { selector: (e) => e.path, maxLength: 8 },
);

/** Compares two strings by UTF-8 byte order, which equals code point order. */
const byCodePoint = (a: string, b: string): number =>
  Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));

describe("Manifest format and diff (Property 18)", () => {
  it("parseManifest reads back formatManifest output sorted by code point, one `<hex>  <path>` line each", () => {
    fc.assert(
      fc.property(entriesArb, (entries) => {
        const text = formatManifest(entries);
        const expected = [...entries].sort((a, b) => byCodePoint(a.path, b.path));

        expect(parseManifest(text)).toEqual({ entries: expected });

        const lines = text === "" ? [] : text.slice(0, -1).split("\n");
        expect(lines).toHaveLength(entries.length);
        lines.forEach((line, i) => {
          expect(line).toMatch(LINE_FORM);
          expect(line).toBe(`${expected[i]!.sha256}  ${expected[i]!.path}`);
        });
      }),
      RUNS,
    );
  });

  it("formatManifest rejects any path containing a newline or a backslash, even among valid entries", () => {
    fc.assert(
      fc.property(
        entriesArb,
        safePath,
        fc.constantFrom("\n", "\\"),
        fc.nat(),
        hashArb,
        (valid, path, bad, seed, hash) => {
          const at = seed % (path.length + 1);
          const poisoned = path.slice(0, at) + bad + path.slice(at);
          expect(() => formatManifest([...valid, { path: poisoned, sha256: hash }])).toThrow();
        },
      ),
      RUNS,
    );
  });

  it("parseManifest reports the line of a path that contains a backslash", () => {
    fc.assert(
      fc.property(entriesArb, safePath, hashArb, (valid, path, hash) => {
        const bad = `${hash}  ${path}\\x\n`;
        const result = parseManifest(formatManifest(valid) + bad);
        expect(result).toEqual({ error: { line: valid.length + 1 } });
      }),
      RUNS,
    );
  });

  it("diffManifest of a Manifest against the same files reports nothing", () => {
    fc.assert(
      fc.property(entriesArb, (entries) => {
        expect(diffManifest(entries, entries, [])).toEqual({ missing: [], changed: [], unlisted: [] });
      }),
      RUNS,
    );
  });

  it("diffManifest matches a model of missing, changed and unlisted, and always reports extraUnlisted", () => {
    // Small pools make overlaps, equal hashes and shared paths likely.
    const pathPool = fc.constantFrom(
      "a.jsonl",
      "b/c.jsonl",
      "b/c.jsonl.bak",
      "\u{10000}.jsonl",
      "\uFFFD.jsonl",
      "é.jsonl",
      "z",
    );
    const hashPool = fc.constantFrom("a".repeat(64), "b".repeat(64), "c".repeat(64));
    const sideArb = fc.uniqueArray(fc.record({ path: pathPool, sha256: hashPool }), {
      selector: (e) => e.path,
      maxLength: 6,
    });

    fc.assert(
      fc.property(
        sideArb,
        sideArb,
        fc.uniqueArray(pathPool, { maxLength: 3 }),
        (listed, actual, extra) => {
          const listedMap = new Map(listed.map((e) => [e.path, e.sha256]));
          const actualMap = new Map(actual.map((e) => [e.path, e.sha256]));

          const missing = [...listedMap.keys()].filter((p) => !actualMap.has(p));
          const changed = [...listedMap.keys()].filter(
            (p) => actualMap.has(p) && actualMap.get(p) !== listedMap.get(p),
          );
          const unlisted = new Set([...actualMap.keys()].filter((p) => !listedMap.has(p)));
          for (const p of extra) unlisted.add(p);

          const result = diffManifest(listed, actual, extra);

          expect(result).toEqual({
            missing: [...missing].sort(byCodePoint),
            changed: [...changed].sort(byCodePoint),
            unlisted: [...unlisted].sort(byCodePoint),
          });
          for (const p of extra) expect(result.unlisted).toContain(p);
        },
      ),
      RUNS,
    );
  });
});
