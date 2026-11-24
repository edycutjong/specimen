import { describe, expect, it } from "vitest";
import {
  formatAccession,
  jarLineSchema,
  maxAccession,
  parseAccession,
  parseCounter,
  serializeJarLine,
  type JarLine,
} from "../src/index.js";

function lineWithId(id: string, seq: number): JarLine {
  const result = jarLineSchema.safeParse({
    v: 1,
    id,
    session_id: "sess-1",
    seq,
    server: "hollowinn",
    tool: "quote",
    tool_id: "mcp_hollowinn_quote",
    input: { room_id: "r-04" },
    response_text: "ok",
    response: null,
    t0: "2025-01-01T10:00:00.000Z",
    t1: "2025-01-01T10:00:00.010Z",
    duration_ms: 10,
    redacted: [],
  });
  if (!result.success) throw new Error("fixture is not a valid Jar_Line");
  return result.data;
}

describe("formatAccession", () => {
  it("zero-pads to at least four digits", () => {
    expect(formatAccession(1)).toBe("SPC-0001");
    expect(formatAccession(42)).toBe("SPC-0042");
    expect(formatAccession(12345)).toBe("SPC-12345");
    expect(formatAccession(0)).toBe("SPC-0000");
  });

  it("rejects negative, fractional and unsafe numbers", () => {
    expect(() => formatAccession(-1)).toThrow(RangeError);
    expect(() => formatAccession(1.5)).toThrow(RangeError);
    expect(() => formatAccession(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});

describe("parseAccession", () => {
  it("returns the number of a well-formed id", () => {
    expect(parseAccession("SPC-0001")).toBe(1);
    expect(parseAccession("SPC-12345")).toBe(12345);
  });

  it("round-trips with formatAccession", () => {
    for (const n of [1, 9, 10, 9999, 10000, 123456]) {
      expect(parseAccession(formatAccession(n))).toBe(n);
    }
  });

  it("returns undefined for malformed ids", () => {
    expect(parseAccession("SPC-1")).toBeUndefined();
    expect(parseAccession("spc-0001")).toBeUndefined();
    expect(parseAccession("SPC-0001x")).toBeUndefined();
    expect(parseAccession("0001")).toBeUndefined();
    expect(parseAccession("")).toBeUndefined();
  });

  it("returns undefined for a number above Number.MAX_SAFE_INTEGER", () => {
    expect(parseAccession("SPC-99999999999999999999")).toBeUndefined();
  });
});

describe("parseCounter", () => {
  it("accepts decimal digits and ignores surrounding whitespace", () => {
    expect(parseCounter("0")).toBe(0);
    expect(parseCounter("17\n")).toBe(17);
    expect(parseCounter("  4  ")).toBe(4);
  });

  it("rejects negative, fractional, empty and non-numeric text", () => {
    expect(parseCounter("-1")).toBeUndefined();
    expect(parseCounter("1.5")).toBeUndefined();
    expect(parseCounter("")).toBeUndefined();
    expect(parseCounter("abc")).toBeUndefined();
    expect(parseCounter("12 34")).toBeUndefined();
  });

  it("rejects values above Number.MAX_SAFE_INTEGER", () => {
    expect(parseCounter("9007199254740993")).toBeUndefined();
    expect(parseCounter(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("maxAccession", () => {
  it("returns 0 when no Jar holds a valid id", () => {
    expect(maxAccession([])).toBe(0);
    expect(maxAccession([""])).toBe(0);
    expect(maxAccession(["not json\n"])).toBe(0);
  });

  it("returns the highest id across several Jars, reading tolerantly", () => {
    const jarA = serializeJarLine(lineWithId("SPC-0003", 1)) + serializeJarLine(lineWithId("SPC-0007", 2));
    const jarB = "broken line\n" + serializeJarLine(lineWithId("SPC-0005", 1));
    expect(maxAccession([jarA, jarB])).toBe(7);
  });

  it("ignores ids above Number.MAX_SAFE_INTEGER", () => {
    const jar =
      serializeJarLine(lineWithId("SPC-0002", 1)) +
      serializeJarLine(lineWithId("SPC-99999999999999999999", 2));
    expect(maxAccession([jar])).toBe(2);
  });
});
