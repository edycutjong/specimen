import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { diffManifest, formatManifest, parseManifest, type ManifestEntry } from "../src/index.js";

// Feature: jar-capture, Property 18: Manifest format and diff
// **Validates: Requirements 8.6, 8.8, 8.9, 8.15, 8.17, 8.18**

const RUNS = { numRuns: 200 };

const LINE_FORM = /^[0-9a-f]{64}  .+$/;

/** Characters a Manifest path may not contain, matching manifestPathError. */
const FORBIDDEN = ["\n", "\r", "\u2028", "\u2029", "\\"] as const;
const UNSAFE = /[\n\r\u2028\u2029\\]/;

const safeSegment = fc
  .string({ unit: "grapheme", minLength: 1, maxLength: 6 })
  .filter((s) => !UNSAFE.test(s));
const safePath = fc
  .array(safeSegment, { minLength: 1, maxLength: 3 })
  .map((parts) => parts.join("/"));

/** A non-empty path with one forbidden character inserted at a random position. */
const poisonedPathArb = (base: fc.Arbitrary<string>) =>
  fc
    .record({ path: base, bad: fc.constantFrom(...FORBIDDEN), seed: fc.nat() })
    .map(({ path, bad, seed }) => {
      const at = seed % (path.length + 1);
      return path.slice(0, at) + bad + path.slice(at);
    });

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

  it("formatManifest rejects any path containing a newline, carriage return, U+2028, U+2029 or backslash, even among valid entries", () => {
    fc.assert(
      fc.property(entriesArb, poisonedPathArb(safePath), hashArb, (valid, poisoned, hash) => {
        expect(() => formatManifest([...valid, { path: poisoned, sha256: hash }])).toThrow();
      }),
      RUNS,
    );
  });

  it("formatManifest rejects an empty path", () => {
    fc.assert(
      fc.property(entriesArb, hashArb, (valid, hash) => {
        expect(() => formatManifest([...valid, { path: "", sha256: hash }])).toThrow();
      }),
      RUNS,
    );
  });

  it("parseManifest reports the line of a path containing a forbidden character", () => {
    fc.assert(
      fc.property(entriesArb, poisonedPathArb(safePath), hashArb, (valid, poisoned, hash) => {
        const bad = `${hash}  ${poisoned}\n`;
        const result = parseManifest(formatManifest(valid) + bad);
        expect(result).toHaveProperty("error");
        // A newline splits the path, so the first bad line can be a later one. Without a
        // newline the bad line is the one that holds the path.
        if (!poisoned.includes("\n")) {
          expect(result).toEqual({ error: { line: valid.length + 1 } });
        }
      }),
      RUNS,
    );
  });

  it("format and parse agree on every path: formatManifest accepts it exactly when parseManifest reads it back", () => {
    const anyPathArb = fc
      .array(
        fc.oneof(fc.string({ unit: "binary", maxLength: 3 }), fc.constantFrom(...FORBIDDEN)),
        { maxLength: 6 },
      )
      .map((parts) => parts.join(""));

    fc.assert(
      fc.property(anyPathArb, hashArb, (path, hash) => {
        let accepted = true;
        try {
          formatManifest([{ path, sha256: hash }]);
        } catch {
          accepted = false;
        }
        const parsed = parseManifest(`${hash}  ${path}\n`);
        if (accepted) {
          expect(parsed).toEqual({ entries: [{ path, sha256: hash }] });
        } else {
          expect(parsed).toHaveProperty("error");
        }
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
