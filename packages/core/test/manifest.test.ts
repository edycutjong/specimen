import { describe, expect, it } from "vitest";
import {
  diffManifest,
  formatManifest,
  parseManifest,
  sha256Hex,
  type ManifestEntry,
} from "../src/index.js";

const H1 = sha256Hex("one");
const H2 = sha256Hex("two");
const H3 = sha256Hex("three");

describe("formatManifest", () => {
  it("writes the sha256sum form: 64 hex, two spaces, path, newline", () => {
    expect(formatManifest([{ path: "a.jsonl", sha256: H1 }])).toBe(`${H1}  a.jsonl\n`);
  });

  it("writes an empty string for no entries", () => {
    expect(formatManifest([])).toBe("");
  });

  it("sorts by code point, so U+10000 comes after U+FFFD (UTF-16 order would reverse them)", () => {
    const text = formatManifest([
      { path: "\u{10000}.jsonl", sha256: H1 },
      { path: "\uFFFD.jsonl", sha256: H2 },
      { path: "b/x.jsonl", sha256: H3 },
      { path: "a.jsonl", sha256: H1 },
    ]);
    const paths = text.trimEnd().split("\n").map((l) => l.slice(66));
    expect(paths).toEqual(["a.jsonl", "b/x.jsonl", "\uFFFD.jsonl", "\u{10000}.jsonl"]);
  });

  it("rejects a path containing a newline", () => {
    expect(() => formatManifest([{ path: "a\nb", sha256: H1 }])).toThrow();
  });

  it("rejects a path containing a backslash", () => {
    expect(() => formatManifest([{ path: "a\\b", sha256: H1 }])).toThrow();
  });

  it("rejects a sha256 that is not 64 lowercase hex characters", () => {
    expect(() => formatManifest([{ path: "a", sha256: H1.toUpperCase() }])).toThrow();
    expect(() => formatManifest([{ path: "a", sha256: "abc" }])).toThrow();
  });
});

describe("parseManifest", () => {
  it("reads back what formatManifest wrote", () => {
    const entries: ManifestEntry[] = [
      { path: "b.jsonl", sha256: H2 },
      { path: "a/c.jsonl", sha256: H1 },
    ];
    const parsed = parseManifest(formatManifest(entries));
    expect(parsed).toEqual({
      entries: [
        { path: "a/c.jsonl", sha256: H1 },
        { path: "b.jsonl", sha256: H2 },
      ],
    });
  });

  it("treats empty text as an empty Manifest", () => {
    expect(parseManifest("")).toEqual({ entries: [] });
  });

  it("reports the 1-based line of a bad hex digit", () => {
    const text = `${H1}  a.jsonl\n${H2.toUpperCase()}  b.jsonl\n`;
    expect(parseManifest(text)).toEqual({ error: { line: 2 } });
  });

  it("reports a line with one space instead of two", () => {
    expect(parseManifest(`${H1} a.jsonl\n`)).toEqual({ error: { line: 1 } });
  });

  it("reports a final line that has no newline", () => {
    expect(parseManifest(`${H1}  a.jsonl`)).toEqual({ error: { line: 1 } });
  });

  it("reports a path containing a backslash", () => {
    expect(parseManifest(`${H1}  a\\b.jsonl\n`)).toEqual({ error: { line: 1 } });
  });
});

describe("diffManifest", () => {
  it("returns three empty lists when the files match the Manifest", () => {
    const listed = [{ path: "a.jsonl", sha256: H1 }];
    expect(diffManifest(listed, listed, [])).toEqual({ missing: [], changed: [], unlisted: [] });
  });

  it("lists a listed file that is gone as missing", () => {
    const listed = [{ path: "a.jsonl", sha256: H1 }];
    expect(diffManifest(listed, [], []).missing).toEqual(["a.jsonl"]);
  });

  it("lists a file whose hash differs as changed", () => {
    const listed = [{ path: "a.jsonl", sha256: H1 }];
    const actual = [{ path: "a.jsonl", sha256: H2 }];
    expect(diffManifest(listed, actual, [])).toEqual({ missing: [], changed: ["a.jsonl"], unlisted: [] });
  });

  it("lists a file the Manifest does not name as unlisted", () => {
    const actual = [{ path: "new.jsonl", sha256: H3 }];
    expect(diffManifest([], actual, []).unlisted).toEqual(["new.jsonl"]);
  });

  it("adds symbolic links to unlisted and sorts the combined list", () => {
    const actual = [{ path: "z.jsonl", sha256: H3 }];
    const diff = diffManifest([], actual, ["link.jsonl", "a-link"]);
    expect(diff.unlisted).toEqual(["a-link", "link.jsonl", "z.jsonl"]);
  });

  it("sorts each list by code point", () => {
    const listed = [
      { path: "\u{10000}", sha256: H1 },
      { path: "\uFFFD", sha256: H1 },
    ];
    expect(diffManifest(listed, [], []).missing).toEqual(["\uFFFD", "\u{10000}"]);
  });
});
