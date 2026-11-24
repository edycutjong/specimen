import { describe, expect, it } from "vitest";
import { ScanError, scanJson, type ScanMember, type ScanNode } from "../src/scan.js";

function members(node: ScanNode): ScanMember[] {
  if (node.kind !== "object") throw new Error("expected an object node");
  return node.members;
}

function at<T>(xs: readonly T[], index: number): T {
  const x = xs[index];
  if (x === undefined) throw new Error(`missing index ${index}`);
  return x;
}

function errorOf(text: string): unknown {
  try {
    scanJson(text);
  } catch (err) {
    return err;
  }
  throw new Error("expected scanJson to throw");
}

describe("scanJson spans", () => {
  it("records the span of a top-level scalar without the surrounding whitespace", () => {
    expect(scanJson(" 425.00 ")).toEqual({ kind: "scalar", start: 1, end: 7 });
  });

  it("records the span of each object member value and keeps the number literal text", () => {
    const text = '{"total":425.00,"name":"a\\u00e9"}';
    const node = scanJson(text);
    const [total, name] = [at(members(node), 0), at(members(node), 1)];
    expect(total.key).toBe("total");
    expect(text.slice(total.value.start, total.value.end)).toBe("425.00");
    expect(name.key).toBe("name");
    expect(name.value).toEqual({
      kind: "string",
      start: 23,
      end: 32,
      decoded: "a\u00e9",
    });
  });

  it("keeps duplicate keys as separate members in text order", () => {
    const node = scanJson('{"token":"a","token":"b"}');
    const all = members(node);
    expect(all.map((m) => m.key)).toEqual(["token", "token"]);
    const [first, second] = [at(all, 0), at(all, 1)];
    expect(first.value).toMatchObject({ kind: "string", decoded: "a" });
    expect(second.value).toMatchObject({ kind: "string", decoded: "b" });
  });

  it("records the span of nested arrays and objects", () => {
    const text = '[ {"a": [1, 2]} ]';
    const node = scanJson(text);
    expect(node.kind).toBe("array");
    expect(node.start).toBe(0);
    expect(node.end).toBe(text.length);
    if (node.kind !== "array") return;
    const inner = at(node.items, 0);
    expect(text.slice(inner.start, inner.end)).toBe('{"a": [1, 2]}');
  });

  it("accepts every whitespace character RFC 8259 allows around values", () => {
    expect(scanJson("\t\r\n[\n1\r\n,\t2 ]\n")).toMatchObject({ kind: "array" });
  });

  it("accepts number grammar used by JSON.parse, including exponents and negatives", () => {
    for (const text of ["0", "-0", "12.5", "1e10", "-2.5E-3", "0.1"]) {
      expect(scanJson(text)).toEqual({ kind: "scalar", start: 0, end: text.length });
    }
  });

  it("decodes escapes in strings and keeps the raw span", () => {
    const text = '"x\\"y\\\\z\\n\\u0041"';
    expect(scanJson(text)).toEqual({
      kind: "string",
      start: 0,
      end: text.length,
      decoded: 'x"y\\z\nA',
    });
  });
});

describe("scanJson rejects anything that is not strict JSON", () => {
  it.each([
    "",
    "   ",
    "01",
    "1.",
    ".5",
    "+1",
    "-",
    "1e",
    "[1,]",
    '{"a":1,}',
    "{a:1}",
    "'a'",
    '"a',
    '"\u0001"',
    '"\\x41"',
    '"\\u12G4"',
    "tru",
    "NaN",
    "Infinity",
    "[] []",
    '{"a" 1}',
    '{"a":}',
    "[1 2]",
    "\uFEFF{}",
  ])("rejects %j", (text) => {
    expect(() => scanJson(text)).toThrow(ScanError);
  });

  it("reports only an offset, never a substring of the input", () => {
    const err = errorOf('{"k":"SECRETVALUE" oops}');
    expect(err).toBeInstanceOf(ScanError);
    const scanErr = err as ScanError;
    expect(scanErr.offset).toBeTypeOf("number");
    expect(scanErr.message).not.toContain("SECRET");
    expect(scanErr.message).not.toContain("oops");
  });
});
