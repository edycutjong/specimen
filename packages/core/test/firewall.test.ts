import { describe, expect, it } from "vitest";
import {
  candidatePaths,
  decideFirewall,
  lexicalResolve,
  type FirewallCandidate,
} from "../src/index.js";

const JARS = "/ws/jars";

/** Lexical and real paths are equal here, because no symbolic link is involved. */
const cand = (p: string): FirewallCandidate => ({ lexical: p, real: p });

const decide = (candidates: FirewallCandidate[]) =>
  decideFirewall({ jarsLexical: JARS, jarsReal: JARS, candidates });

describe("lexicalResolve", () => {
  it("makes a relative path absolute against cwd", () => {
    expect(lexicalResolve("/ws", "jars/a.jsonl")).toBe("/ws/jars/a.jsonl");
  });

  it("keeps an absolute path as it is", () => {
    expect(lexicalResolve("/ws", "/elsewhere/x")).toBe("/elsewhere/x");
  });

  it("drops '.' segments and empty segments", () => {
    expect(lexicalResolve("/ws", "./jars//./a")).toBe("/ws/jars/a");
    expect(lexicalResolve("/ws/", "jars/a")).toBe("/ws/jars/a");
  });

  it("collapses '..' so a path that leaves and re-enters jars resolves inside it", () => {
    expect(lexicalResolve("/ws", "x/../jars/a.jsonl")).toBe("/ws/jars/a.jsonl");
    expect(lexicalResolve("/ws/sub", "../jars")).toBe("/ws/jars");
  });

  it("clamps '..' above the root at the root", () => {
    expect(lexicalResolve("/ws", "../../../..")).toBe("/");
  });

  it("treats a backslash as a separator", () => {
    expect(lexicalResolve("/ws", "jars\\a.jsonl")).toBe("/ws/jars/a.jsonl");
    expect(lexicalResolve("\\ws", "jars")).toBe("/ws/jars");
  });

  it("keeps letter case", () => {
    expect(lexicalResolve("/ws", "Jars/A.jsonl")).toBe("/ws/Jars/A.jsonl");
  });
});

describe("candidatePaths", () => {
  it("returns a top-level string", () => {
    expect(candidatePaths({ path: "jars/a" })).toEqual(["jars/a"]);
  });

  it("returns strings nested at depth, including array elements", () => {
    const input = { a: { b: [{ c: "jars/x" }, "jars/y"] }, n: 1, t: true, z: null };
    expect(candidatePaths(input).sort()).toEqual(["jars/x", "jars/y"]);
  });

  it("does not return object keys", () => {
    expect(candidatePaths({ "jars/key": 1 })).toEqual([]);
  });

  it("treats a __proto__ key as an ordinary key and walks its value", () => {
    const input = JSON.parse('{"__proto__":{"p":"jars/z"}}') as unknown;
    expect(candidatePaths(input)).toEqual(["jars/z"]);
  });

  it("returns nothing for a value with no strings", () => {
    expect(candidatePaths(42)).toEqual([]);
    expect(candidatePaths(null)).toEqual([]);
  });

  it("walks a deeply nested value without recursion failure", () => {
    let node: unknown = "jars/deep";
    for (let i = 0; i < 50_000; i++) node = [node];
    expect(candidatePaths(node)).toEqual(["jars/deep"]);
  });
});

describe("decideFirewall", () => {
  it("blocks a path directly under jars", () => {
    expect(decide([cand("/ws/jars/a.jsonl")])).toBe("block");
  });

  it("blocks the jars directory itself", () => {
    expect(decide([cand("/ws/jars")])).toBe("block");
  });

  it("allows a path outside jars", () => {
    expect(decide([cand("/ws/src/a.ts")])).toBe("allow");
  });

  it("allows a sibling whose name only starts with 'jars'", () => {
    expect(decide([cand("/ws/jars-old/a.jsonl")])).toBe("allow");
    expect(decide([cand("/ws/jarsx")])).toBe("allow");
  });

  it("blocks a '..' path that resolves into jars", () => {
    const lexical = lexicalResolve("/ws/src", "../jars/MANIFEST.sha256");
    expect(decide([{ lexical, real: lexical }])).toBe("block");
  });

  it("blocks a path with extra '.' segments and 'dir/..' pairs", () => {
    expect(decide([cand(lexicalResolve("/ws", "./jars/./a.jsonl"))])).toBe("block");
    expect(decide([cand(lexicalResolve("/ws", "src/../jars/a.jsonl"))])).toBe("block");
  });

  it("ignores letter case on both sides", () => {
    expect(decide([cand("/WS/Jars/a.jsonl")])).toBe("block");
    expect(
      decideFirewall({ jarsLexical: "/WS/JARS", jarsReal: "/WS/JARS", candidates: [cand("/ws/jars/a")] }),
    ).toBe("block");
  });

  it("blocks when only the real path is under jars (a symbolic link into jars)", () => {
    const candidates = [{ lexical: "/ws/link.jsonl", real: "/ws/jars/a.jsonl" }];
    expect(decide(candidates)).toBe("block");
  });

  it("blocks when only the lexical path is under jars", () => {
    const candidates = [{ lexical: "/ws/jars/a.jsonl", real: "/elsewhere/a.jsonl" }];
    expect(decide(candidates)).toBe("block");
  });

  it("blocks when any one of several candidates is under jars", () => {
    expect(decide([cand("/ws/src/a.ts"), cand("/ws/jars/MANIFEST.sha256")])).toBe("block");
  });

  it("allows when there are no candidates", () => {
    expect(decide([])).toBe("allow");
  });

  it("compares the real jars path against the real candidate path", () => {
    const decision = decideFirewall({
      jarsLexical: "/ws/jars",
      jarsReal: "/private/ws/jars",
      candidates: [{ lexical: "/ws/src/x", real: "/private/ws/jars/x" }],
    });
    expect(decision).toBe("block");
  });

  it("treats a backslash in a candidate as a separator", () => {
    expect(decide([cand("\\ws\\jars\\a.jsonl")])).toBe("block");
  });
});

describe("firewall end to end over tool input", () => {
  it("blocks a nested string that resolves into jars", () => {
    const toolInput = { edits: [{ path: "../jars/a.jsonl", text: "x" }] };
    const candidates = candidatePaths(toolInput).map((p) => {
      const lexical = lexicalResolve("/ws/src", p);
      return { lexical, real: lexical };
    });
    expect(decide(candidates)).toBe("block");
  });
});
