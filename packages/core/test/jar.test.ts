import { describe, expect, it } from "vitest";
import {
  jarLineSchema,
  readJar,
  readJarTolerant,
  serializeJarLine,
  type JarLine,
} from "../src/index.js";

/** A valid Jar_Line whose response keeps `425.00` as written in response_text. */
function validLine(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    v: 1,
    id: "SPC-0001",
    session_id: "sess-1",
    seq: 1,
    server: "hollowinn",
    tool: "quote",
    tool_id: "mcp_hollowinn_quote",
    input: { room_id: "r-04", nights: 2 },
    response_text: '{"room_id":"r-04","nights":2,"nightly":212.50,"total":425.00,"currency":"USD"}',
    response: { room_id: "r-04", nights: 2, nightly: 212.5, total: 425, currency: "USD" },
    t0: "2025-01-01T10:00:00.000Z",
    t1: "2025-01-01T10:00:00.120Z",
    duration_ms: 120,
    redacted: [],
    ...overrides,
  };
}

function parseOk(obj: Record<string, unknown>): JarLine {
  const result = jarLineSchema.safeParse(obj);
  if (!result.success) throw new Error(JSON.stringify(result.error.issues));
  return result.data;
}

function fails(obj: Record<string, unknown>): boolean {
  return !jarLineSchema.safeParse(obj).success;
}

describe("Jar_Line round trip (Requirement 11.13)", () => {
  it("serialises a Jar_Line to one newline-terminated line and parses it back deep-equal", () => {
    const original = parseOk(validLine());
    const text = serializeJarLine(original);

    expect(text.endsWith("\n")).toBe(true);
    expect(text.slice(0, -1).includes("\n")).toBe(false);
    expect(text).toContain('"total":425,'); // `response` holds JSON.parse output
    expect(text).toContain('"response_text":"{\\"room_id\\"');

    const back = readJar(text);
    expect(back.errors).toEqual([]);
    expect(back.lines).toHaveLength(1);
    expect(back.lines[0]).toEqual(original);
  });

  it("keeps response_text byte-identical, so 425.00 is not rewritten as 425", () => {
    const original = parseOk(validLine());
    const back = readJar(serializeJarLine(original)).lines[0];
    expect(back?.response_text).toContain('"total":425.00');
  });
});

describe("jarLineSchema field rules", () => {
  it("accepts the baseline valid line", () => {
    expect(fails(validLine())).toBe(false);
  });

  it("requires v to equal 1", () => {
    expect(fails(validLine({ v: 2 }))).toBe(true);
    expect(fails(validLine({ v: "1" }))).toBe(true);
  });

  it("requires id to be SPC- followed by at least four digits", () => {
    expect(fails(validLine({ id: "SPC-0001" }))).toBe(false);
    expect(fails(validLine({ id: "SPC-12345" }))).toBe(false);
    expect(fails(validLine({ id: "SPC-001" }))).toBe(true);
    expect(fails(validLine({ id: "spc-0001" }))).toBe(true);
  });

  it("requires session_id to match the pattern and contain no '..'", () => {
    expect(fails(validLine({ session_id: "a.b_c-1" }))).toBe(false);
    expect(fails(validLine({ session_id: "a/b" }))).toBe(true);
    expect(fails(validLine({ session_id: "a..b" }))).toBe(true);
    expect(fails(validLine({ session_id: "-a" }))).toBe(true);
  });

  it("requires server, tool and tool_id to be non-empty", () => {
    expect(fails(validLine({ server: "" }))).toBe(true);
    expect(fails(validLine({ tool: "" }))).toBe(true);
    expect(fails(validLine({ tool_id: "" }))).toBe(true);
  });

  it("requires seq to be an integer from 1 to 2147483647", () => {
    expect(fails(validLine({ seq: 1 }))).toBe(false);
    expect(fails(validLine({ seq: 2147483647 }))).toBe(false);
    expect(fails(validLine({ seq: 0 }))).toBe(true);
    expect(fails(validLine({ seq: 2147483648 }))).toBe(true);
    expect(fails(validLine({ seq: 1.5 }))).toBe(true);
  });

  it("requires t0 and t1 to be date-times with a time zone designator", () => {
    expect(fails(validLine({ t0: "2025-01-01T10:00:00.000Z" }))).toBe(false);
    expect(fails(validLine({ t1: "2025-01-01T10:00:00.000+02:00" }))).toBe(false);
    expect(fails(validLine({ t0: "2025-01-01T10:00:00.000" }))).toBe(true);
    expect(fails(validLine({ t0: "yesterday" }))).toBe(true);
  });

  it("requires duration_ms to be an integer from 0 to 2147483647", () => {
    expect(fails(validLine({ duration_ms: 0 }))).toBe(false);
    expect(fails(validLine({ duration_ms: -1 }))).toBe(true);
    expect(fails(validLine({ duration_ms: 2147483648 }))).toBe(true);
  });

  it("accepts JSON pointers into input and response, and rejects others", () => {
    expect(fails(validLine({ redacted: ["/input/guest", "/response/token"] }))).toBe(false);
    expect(fails(validLine({ redacted: ["/input/a~0b/c~1d"] }))).toBe(false);
    expect(fails(validLine({ redacted: ["/other/x"] }))).toBe(true);
    expect(fails(validLine({ redacted: ["/inputx"] }))).toBe(true);
    expect(fails(validLine({ redacted: ["input/guest"] }))).toBe(true);
    expect(fails(validLine({ redacted: ["/input/bad~2"] }))).toBe(true);
  });

  it("requires response to be a JSON value or null", () => {
    expect(fails(validLine({ response: null }))).toBe(false);
    expect(fails(validLine({ response: "text" }))).toBe(false);
    expect(fails(validLine({ response: undefined }))).toBe(true);
  });

  it("accepts the optional boolean fields and rejects other types", () => {
    expect(fails(validLine({ text_redacted: true, unpaired: false }))).toBe(false);
    expect(fails(validLine({ text_redacted: "yes" }))).toBe(true);
  });

  it("requires response_text to be a string", () => {
    expect(fails(validLine({ response_text: 42 }))).toBe(true);
  });

  it("requires response_length to be present only with a sha256 response_text and a null response", () => {
    const hash = "sha256:" + "a".repeat(64);
    expect(fails(validLine({ response_text: hash, response: null, response_length: 17 }))).toBe(
      false,
    );
    expect(fails(validLine({ response_text: "plain", response: null, response_length: 5 }))).toBe(
      true,
    );
    expect(fails(validLine({ response_text: hash, response: {}, response_length: 17 }))).toBe(
      true,
    );
    expect(
      fails(validLine({ response_text: "sha256:" + "A".repeat(64), response: null, response_length: 1 })),
    ).toBe(true);
    expect(fails(validLine({ response_text: hash, response: null, response_length: -1 }))).toBe(
      true,
    );
  });

  it("rejects an unknown field", () => {
    expect(fails(validLine({ extra: 1 }))).toBe(true);
  });
});

describe("readJar", () => {
  it("returns no lines and no errors for an empty Jar", () => {
    expect(readJar("")).toEqual({ lines: [], errors: [] });
  });

  it("returns every valid line in file order", () => {
    const a = parseOk(validLine({ id: "SPC-0001", seq: 2 }));
    const b = parseOk(validLine({ id: "SPC-0002", seq: 1 }));
    const result = readJar(serializeJarLine(a) + serializeJarLine(b));
    expect(result.errors).toEqual([]);
    expect(result.lines.map((l) => l.id)).toEqual(["SPC-0001", "SPC-0002"]);
  });

  it("reports a line that is not valid JSON by its 1-based line number", () => {
    const good = serializeJarLine(parseOk(validLine()));
    const result = readJar(good + "{not json\n");
    expect(result.lines).toHaveLength(1);
    expect(result.errors).toEqual([{ line: 2, kind: "json" }]);
  });

  it("names the failing field of a line that fails the schema", () => {
    const result = readJar(JSON.stringify(validLine({ seq: 0 })) + "\n");
    expect(result.lines).toEqual([]);
    expect(result.errors).toEqual([{ line: 1, kind: "schema", field: "seq" }]);
  });

  it("names the unknown field of a line that has one", () => {
    const result = readJar(JSON.stringify(validLine({ debug_note: "x" })) + "\n");
    expect(result.lines).toEqual([]);
    expect(result.errors).toEqual([{ line: 1, kind: "unknown_field", field: "debug_note" }]);
  });

  it("reports a blank line before the final line", () => {
    const a = serializeJarLine(parseOk(validLine({ id: "SPC-0001" })));
    const b = serializeJarLine(parseOk(validLine({ id: "SPC-0002", seq: 2 })));
    const result = readJar(a + "\n" + b);
    expect(result.errors).toEqual([{ line: 2, kind: "blank" }]);
    expect(result.lines.map((l) => l.id)).toEqual(["SPC-0001", "SPC-0002"]);
  });

  it("reports a final line with no terminating newline as incomplete", () => {
    const a = serializeJarLine(parseOk(validLine({ id: "SPC-0001" })));
    const b = JSON.stringify(validLine({ id: "SPC-0002", seq: 2 }));
    const result = readJar(a + b);
    expect(result.errors).toEqual([{ line: 2, kind: "incomplete" }]);
    expect(result.lines.map((l) => l.id)).toEqual(["SPC-0001"]);
  });
});

describe("readJarTolerant", () => {
  it("returns only the valid lines and never throws", () => {
    const good = serializeJarLine(parseOk(validLine()));
    const text = "garbage\n" + good + "\n" + '{"v":1}\n' + good.slice(0, 10);
    expect(() => readJarTolerant(text)).not.toThrow();
    expect(readJarTolerant(text)).toHaveLength(1);
  });
});
