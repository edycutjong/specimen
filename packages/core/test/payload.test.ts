import { describe, expect, it } from "vitest";
import {
  fieldPaths,
  postPayloadSchema,
  prePayloadSchema,
  validSessionId,
} from "../src/index.js";

const pre = {
  session_id: "sess-1",
  cwd: "/work",
  tool_name: "mcp_hollowinn_quote",
  hook_event_name: "PreToolUse",
  tool_input: { room_id: "r-04" },
};

describe("validSessionId", () => {
  it("accepts ids that start with a letter or digit and use the allowed set", () => {
    expect(validSessionId("abc-1.2_x")).toBe(true);
    expect(validSessionId("a")).toBe(true);
    expect(validSessionId("a".repeat(128))).toBe(true);
  });

  it("rejects empty ids, separators, leading punctuation, '..' and overlong ids", () => {
    expect(validSessionId("")).toBe(false);
    expect(validSessionId("a/b")).toBe(false);
    expect(validSessionId("a\\b")).toBe(false);
    expect(validSessionId("..")).toBe(false);
    expect(validSessionId("a..b")).toBe(false);
    expect(validSessionId("-a")).toBe(false);
    expect(validSessionId(".a")).toBe(false);
    expect(validSessionId("a".repeat(129))).toBe(false);
  });
});

describe("prePayloadSchema", () => {
  it("accepts a Kiro PreToolUse payload", () => {
    expect(prePayloadSchema.safeParse(pre).success).toBe(true);
  });

  it("accepts a null tool_input because the key is present", () => {
    expect(prePayloadSchema.safeParse({ ...pre, tool_input: null }).success).toBe(true);
  });

  it("requires the tool_input key itself", () => {
    const { tool_input: _omitted, ...withoutInput } = pre;
    const result = prePayloadSchema.safeParse(withoutInput);
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldPaths(result.error.issues)).toEqual(["tool_input"]);
  });

  it("ignores extra keys", () => {
    expect(prePayloadSchema.safeParse({ ...pre, extra: 1 }).success).toBe(true);
  });

  it("reports a non-object at the root", () => {
    const result = prePayloadSchema.safeParse("text");
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldPaths(result.error.issues)).toEqual(["(root)"]);
  });
});

describe("postPayloadSchema", () => {
  const post = { ...pre, tool_response: '{"total":425.00}' };

  it("accepts a payload with a string tool_response", () => {
    expect(postPayloadSchema.safeParse(post).success).toBe(true);
  });

  it("requires tool_response to be a string", () => {
    const missing = { ...pre };
    expect(postPayloadSchema.safeParse(missing).success).toBe(false);
    expect(postPayloadSchema.safeParse({ ...pre, tool_response: { a: 1 } }).success).toBe(false);
  });

  it("requires the tool_input key", () => {
    const { tool_input: _omitted, ...withoutInput } = post;
    expect(postPayloadSchema.safeParse(withoutInput).success).toBe(false);
  });
});

describe("fieldPaths", () => {
  it("returns the names of the failing fields, without zod messages", () => {
    const result = postPayloadSchema.safeParse({ ...pre, tool_response: 3 });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldPaths(result.error.issues)).toEqual(["tool_response"]);
  });

  it("writes an unsafe path segment as '?'", () => {
    const issues = [{ code: "custom" as const, path: ["a b", "ok_1"], message: "x", input: null }];
    expect(fieldPaths(issues)).toEqual(["?.ok_1"]);
  });

  it("returns each path once", () => {
    const issues = [
      { code: "custom" as const, path: ["x"], message: "1", input: null },
      { code: "custom" as const, path: ["x"], message: "2", input: null },
    ];
    expect(fieldPaths(issues)).toEqual(["x"]);
  });
});
