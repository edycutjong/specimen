import { describe, expect, it } from "vitest";
import {
  DEFAULT_REDACT_CONFIG,
  buildJarLine,
  compileRedact,
  durationMs,
  inputHash,
  jarLineSchema,
  nextSeq,
  parsePending,
  removeLine,
  redactInput,
  redactResponse,
  selectPending,
  serializeJarLine,
  type JarLine,
} from "../src/index.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function entryLine(fields: Record<string, unknown>): string {
  return JSON.stringify({
    session_id: "sess-1",
    seq: 1,
    tool_id: "mcp_hollowinn_quote",
    input_sha256: HASH_A,
    t0: "2025-01-01T10:00:00.000Z",
    ...fields,
  });
}

function jarLine(fields: Record<string, unknown>): JarLine {
  const parsed = jarLineSchema.safeParse({
    v: 1,
    id: "SPC-0001",
    session_id: "sess-1",
    seq: 1,
    server: "hollowinn",
    tool: "quote",
    tool_id: "mcp_hollowinn_quote",
    input: {},
    response_text: "{}",
    response: {},
    t0: "2025-01-01T10:00:00.000Z",
    t1: "2025-01-01T10:00:00.010Z",
    duration_ms: 10,
    redacted: [],
    ...fields,
  });
  if (!parsed.success) throw new Error("fixture is not a valid Jar_Line");
  return parsed.data;
}

describe("parsePending", () => {
  it("keeps every line with its 1-based number, including invalid and blank lines", () => {
    const text = [entryLine({ seq: 1 }), "not json", "", entryLine({ seq: 2 })].join("\n") + "\n";
    const lines = parsePending(text);

    expect(lines.map((l) => l.line)).toEqual([1, 2, 3, 4]);
    expect(lines[0]?.entry?.seq).toBe(1);
    expect(lines[1]?.entry).toBeUndefined();
    expect(lines[1]?.raw).toBe("not json");
    expect(lines[2]?.entry).toBeUndefined();
    expect(lines[3]?.entry?.seq).toBe(2);
  });

  it("treats an entry that fails the schema as invalid", () => {
    const extra = parsePending(entryLine({ unexpected: true }) + "\n");
    expect(extra[0]?.entry).toBeUndefined();
    const badHash = parsePending(entryLine({ input_sha256: "XYZ" }) + "\n");
    expect(badHash[0]?.entry).toBeUndefined();
  });

  it("returns no lines for an empty file", () => {
    expect(parsePending("")).toEqual([]);
  });
});

describe("selectPending", () => {
  it("returns the lowest line number that matches session, tool and input hash", () => {
    const pending = parsePending(
      [
        entryLine({ input_sha256: HASH_B }),
        entryLine({ input_sha256: HASH_A, seq: 2 }),
        entryLine({ input_sha256: HASH_A, seq: 3 }),
      ].join("\n") + "\n",
    );
    const line = selectPending(pending, {
      session_id: "sess-1",
      tool_id: "mcp_hollowinn_quote",
      input_sha256: HASH_A,
    });
    expect(line).toBe(2);
  });

  it("ignores invalid lines and entries that differ in session or tool", () => {
    const pending = parsePending(
      ["garbage", entryLine({ session_id: "other" }), entryLine({ tool_id: "mcp_hollowinn_x" })].join(
        "\n",
      ) + "\n",
    );
    expect(
      selectPending(pending, {
        session_id: "sess-1",
        tool_id: "mcp_hollowinn_quote",
        input_sha256: HASH_A,
      }),
    ).toBeUndefined();
  });
});

describe("removeLine", () => {
  it("removes one line and keeps every other line verbatim, in order", () => {
    const first = entryLine({ seq: 1 });
    const second = "not json";
    const third = entryLine({ seq: 3 });
    const text = [first, second, third].join("\n") + "\n";
    expect(removeLine(text, 2)).toBe([first, third].join("\n") + "\n");
  });

  it("keeps a missing final newline when a middle line is removed", () => {
    expect(removeLine("a\nb\nc", 2)).toBe("a\nc");
  });

  it("adds the newline when the unterminated last line is removed", () => {
    expect(removeLine("a\nb", 2)).toBe("a\n");
  });

  it("returns an empty text when the only line is removed", () => {
    expect(removeLine("only\n", 1)).toBe("");
  });
});

describe("nextSeq", () => {
  it("returns 1 when the session has no entries and no Jar_Lines", () => {
    expect(nextSeq("sess-1", [], [])).toBe(1);
  });

  it("takes one more than the highest seq across entries and Jar_Lines of that session", () => {
    const pending = parsePending(entryLine({ seq: 4 }) + "\n" + entryLine({ seq: 2 }) + "\n");
    const jar = [jarLine({ seq: 3 }), jarLine({ seq: 1, session_id: "other-sess" })];
    expect(nextSeq("sess-1", pending, jar)).toBe(5);
  });

  it("counts an orphan entry, so its seq is not reused", () => {
    const pending = parsePending(entryLine({ seq: 7 }) + "\n");
    expect(nextSeq("sess-1", pending, [])).toBe(8);
  });
});

describe("durationMs", () => {
  it("returns the difference in milliseconds", () => {
    expect(durationMs("2025-01-01T10:00:00.000Z", "2025-01-01T10:00:01.250Z")).toEqual({
      ms: 1250,
      anomaly: false,
    });
  });

  it("clamps a negative difference to 0 and flags an anomaly", () => {
    expect(durationMs("2025-01-01T10:00:01.000Z", "2025-01-01T10:00:00.000Z")).toEqual({
      ms: 0,
      anomaly: true,
    });
  });

  it("clamps a very long difference to the signed 32-bit maximum", () => {
    expect(durationMs("1970-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z").ms).toBe(2147483647);
  });
});

describe("buildJarLine", () => {
  const compiled = compileRedact(DEFAULT_REDACT_CONFIG);
  if (!compiled.ok) throw new Error("default config must compile");
  const c = compiled.value;

  it("writes fixed field order, sorted and deduplicated redacted pointers, and validates", () => {
    const input = {
      password: "hunter2",
      guest: "Bearer abc.def",
      room: "r-04",
    };
    const redacted = redactInput(input, c);
    const text = '{"total":425.00,"token":"t0k","note":"ok"}';
    const response = redactResponse(text, c);

    const built = buildJarLine({
      id: "SPC-0007",
      sessionId: "sess-1",
      seq: 3,
      server: "hollowinn",
      tool: "quote",
      toolId: "mcp_hollowinn_quote",
      input: redacted.value,
      inputPointers: redacted.pointers,
      response,
      t0: "2025-01-01T10:00:00.000Z",
      t1: "2025-01-01T10:00:00.042Z",
      durationMs: 42,
      unpaired: false,
    });

    expect(Object.keys(built)).toEqual([
      "v",
      "id",
      "session_id",
      "seq",
      "server",
      "tool",
      "tool_id",
      "input",
      "response_text",
      "response",
      "t0",
      "t1",
      "duration_ms",
      "redacted",
    ]);
    expect(built.redacted).toEqual(["/input/guest", "/input/password", "/response/token"]);
    expect(built.response_text).toBe('{"total":425.00,"token":"[REDACTED]","note":"ok"}');
    expect(built.duration_ms).toBe(42);
    expect(built.unpaired).toBeUndefined();
    expect(built.text_redacted).toBeUndefined();

    const valid = jarLineSchema.safeParse(built);
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(serializeJarLine(valid.data).split("\n")).toHaveLength(2);
      expect(inputHash(redacted.value)).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("builds an unpaired line with t0 equal to t1 and duration 0", () => {
    const response = redactResponse("plain words", c);
    const built = buildJarLine({
      id: "SPC-0002",
      sessionId: "sess-1",
      seq: 1,
      server: "hollowinn",
      tool: "quote",
      toolId: "mcp_hollowinn_quote",
      input: {},
      inputPointers: [],
      response,
      t0: "2025-01-01T10:00:05.000Z",
      t1: "2025-01-01T10:00:05.000Z",
      durationMs: 99,
      unpaired: true,
    });

    expect(built.unpaired).toBe(true);
    expect(built.t0).toBe(built.t1);
    expect(built.duration_ms).toBe(0);
    expect(built.text_redacted).toBe(true);
    expect(jarLineSchema.safeParse(built).success).toBe(true);
  });
});
