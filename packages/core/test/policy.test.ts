import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SHIPPED_VOLATILE_POLICY,
  decideTool,
  isPointerGlob,
  matchesGlob,
  replayPolicySchema,
  volatilePolicySchema,
} from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..", "..");

describe("replayPolicySchema", () => {
  it("accepts the allow and watch lists", () => {
    const parsed = replayPolicySchema.parse({ allow: ["quote"], watch: [] });
    expect(parsed).toEqual({ allow: ["quote"], watch: [] });
  });

  it("rejects an unknown key such as note", () => {
    expect(replayPolicySchema.safeParse({ allow: [], watch: [], note: "x" }).success).toBe(false);
  });

  it("rejects a missing list", () => {
    expect(replayPolicySchema.safeParse({ allow: [] }).success).toBe(false);
  });
});

describe("volatilePolicySchema", () => {
  it("accepts well-formed Pointer_Globs", () => {
    expect(volatilePolicySchema.safeParse({ volatile: ["/created_at", "/a/*/b"] }).success).toBe(
      true,
    );
  });

  it("rejects an unknown key", () => {
    expect(volatilePolicySchema.safeParse({ volatile: [], note: "x" }).success).toBe(false);
  });

  it("rejects an entry that is not a Pointer_Glob", () => {
    expect(volatilePolicySchema.safeParse({ volatile: ["created_at"] }).success).toBe(false);
    expect(volatilePolicySchema.safeParse({ volatile: ["/a~2b"] }).success).toBe(false);
  });
});

describe("shipped .specimen/volatile.json", () => {
  it("parses strictly and equals SHIPPED_VOLATILE_POLICY", () => {
    const text = readFileSync(join(repoRoot, ".specimen", "volatile.json"), "utf8");
    const parsed = volatilePolicySchema.parse(JSON.parse(text));
    expect(parsed).toEqual(SHIPPED_VOLATILE_POLICY);
    expect(parsed.volatile).toEqual(expect.arrayContaining(["/created_at", "/bookings/*/created_at"]));
  });
});

describe("matchesGlob for the shipped globs", () => {
  it("matches the top-level created_at only at that exact path", () => {
    expect(matchesGlob("/created_at", "/created_at")).toBe(true);
    expect(matchesGlob("/bookings/created_at", "/created_at")).toBe(false);
    expect(matchesGlob("/created_at/x", "/created_at")).toBe(false);
  });

  it("matches /bookings/*/created_at with exactly one segment in the wildcard", () => {
    expect(matchesGlob("/bookings/b-1/created_at", "/bookings/*/created_at")).toBe(true);
    expect(matchesGlob("/bookings/created_at", "/bookings/*/created_at")).toBe(false);
    expect(matchesGlob("/bookings/b-1/x/created_at", "/bookings/*/created_at")).toBe(false);
    expect(matchesGlob("/bookings/b-1/created_at_x", "/bookings/*/created_at")).toBe(false);
  });

  it("unescapes RFC 6901 segments before comparing literal segments", () => {
    expect(matchesGlob("/a~1b", "/a~1b")).toBe(true);
    expect(matchesGlob("/a/b", "/a~1b")).toBe(false);
    expect(matchesGlob("/a~0b", "/a~0b")).toBe(true);
    expect(matchesGlob("/a~1b/c", "/a~1b/*")).toBe(true);
  });

  it("never matches the empty pointer or an invalid glob", () => {
    expect(matchesGlob("", "/created_at")).toBe(false);
    expect(matchesGlob("/created_at", "created_at")).toBe(false);
    expect(isPointerGlob("/bookings/*/created_at")).toBe(true);
    expect(isPointerGlob("")).toBe(false);
  });
});

describe("decideTool", () => {
  it("reports allowed, watched, both and skipped tools", () => {
    const policy = { allow: ["book", "both"], watch: ["quote", "both"] };
    expect(decideTool("book", policy)).toBe("allowed");
    expect(decideTool("quote", policy)).toBe("watched");
    expect(decideTool("both", policy)).toBe("both");
    expect(decideTool("cancel_booking", policy)).toBe("skipped");
  });
});
