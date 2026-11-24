import { describe, expect, it } from "vitest";
import { mcpConfigSchema, resolveServer, sanitiseKey } from "../src/index.js";

describe("sanitiseKey", () => {
  it("replaces each hyphen with an underscore and leaves other characters alone", () => {
    expect(sanitiseKey("hollow-inn")).toBe("hollow_inn");
    expect(sanitiseKey("a-b-c")).toBe("a_b_c");
    expect(sanitiseKey("hollowinn")).toBe("hollowinn");
    expect(sanitiseKey("x_y")).toBe("x_y");
  });
});

describe("resolveServer with a --server flag", () => {
  it("uses the flag as the server and strips its sanitised prefix from the tool name", () => {
    expect(resolveServer({ toolName: "mcp_hollowinn_quote", serverFlag: "hollowinn" })).toEqual({
      ok: true,
      server: "hollowinn",
      tool: "quote",
    });
  });

  it("keeps the full tool name when the prefix does not match", () => {
    expect(resolveServer({ toolName: "quote", serverFlag: "hollowinn" })).toEqual({
      ok: true,
      server: "hollowinn",
      tool: "quote",
    });
  });
});

describe("resolveServer by name", () => {
  it("resolves a plain key", () => {
    expect(resolveServer({ toolName: "mcp_hollowinn_quote", keys: ["hollowinn"] })).toEqual({
      ok: true,
      server: "hollowinn",
      tool: "quote",
    });
  });

  it("resolves a hyphenated key through its sanitised form", () => {
    expect(resolveServer({ toolName: "mcp_hollow_inn_quote", keys: ["hollow-inn"] })).toEqual({
      ok: true,
      server: "hollow-inn",
      tool: "quote",
    });
  });

  it("reports ambiguity for nested-prefix keys", () => {
    const result = resolveServer({
      toolName: "mcp_hollow_inn_quote",
      keys: ["hollow", "hollow-inn"],
    });
    expect(result).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("reports ambiguity when two keys share one sanitised form", () => {
    const result = resolveServer({
      toolName: "mcp_hollow_inn_quote",
      keys: ["hollow-inn", "hollow_inn"],
    });
    expect(result).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("reports no_match when no key is a prefix of the tool name", () => {
    expect(resolveServer({ toolName: "mcp_other_quote", keys: ["hollowinn"] })).toEqual({
      ok: false,
      reason: "no_match",
    });
    expect(resolveServer({ toolName: "quote", keys: [] })).toEqual({
      ok: false,
      reason: "no_match",
    });
  });

  it("never matches a key that contains a character outside [A-Za-z0-9_-]", () => {
    expect(resolveServer({ toolName: "mcp_hollow.inn_quote", keys: ["hollow.inn"] })).toEqual({
      ok: false,
      reason: "no_match",
    });
    expect(resolveServer({ toolName: "mcp_hollow_inn_quote", keys: ["hollow inn"] })).toEqual({
      ok: false,
      reason: "no_match",
    });
  });
});

describe("mcpConfigSchema", () => {
  it("accepts an object with an mcpServers record and ignores other fields", () => {
    const parsed = mcpConfigSchema.safeParse({
      mcpServers: { hollowinn: { command: "npx" } },
      other: true,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a document without mcpServers, or with a non-object mcpServers", () => {
    expect(mcpConfigSchema.safeParse({}).success).toBe(false);
    expect(mcpConfigSchema.safeParse({ mcpServers: [] }).success).toBe(false);
    expect(mcpConfigSchema.safeParse(null).success).toBe(false);
  });
});
