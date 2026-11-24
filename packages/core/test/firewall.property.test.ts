import { describe, it } from "vitest";
import fc from "fast-check";
import {
  candidatePaths,
  decideFirewall,
  lexicalResolve,
  type FirewallCandidate,
} from "../src/index.js";

// Feature: jar-capture, Property 17: Firewall decision
// **Validates: Requirements 8.1, 8.2, 8.3, 8.11, 8.12, 8.13, 8.14**

const RUNS = { numRuns: 200 };
const WS = "/ws";
const JARS = "/ws/jars";

/** A plain name: letters, digits, "_" and "-". No dots and no separators. */
const nameArb = fc.stringMatching(/^[A-Za-z0-9_-]{1,8}$/);

/** The first segment is often a jars spelling or a near miss, so the boundary gets tested. */
const headArb = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom("jars", "JARS", "Jars", "jArs") },
  { weight: 2, arbitrary: fc.constantFrom("jars-old", "jarsx", "xjars", "jars_", "src") },
  { weight: 2, arbitrary: nameArb },
);

/** A canonical path below the workspace. It is under jars exactly when `head` is "jars". */
const pathArb = fc.record({
  head: headArb,
  tail: fc.array(nameArb, { maxLength: 5 }),
});

/** An extra "." segment, or a "dir/.." pair that nets to nothing. */
const tokenArb = fc.oneof(
  fc.constant("."),
  nameArb.map((dir) => `${dir}/..`),
  fc.constant("jars/.."),
);

const insertionsArb = fc.array(fc.record({ at: fc.nat(), token: tokenArb }), {
  maxLength: 6,
});

/** Per-character case flips. Positions wrap around, so any length of flips is valid. */
const flipsArb = fc.array(fc.boolean(), { minLength: 1, maxLength: 40 });

/** Oracle: the canonical path /ws/<segments> is under /ws/jars exactly when head is jars. */
const expectedDecision = (head: string): "block" | "allow" =>
  head.toLowerCase() === "jars" ? "block" : "allow";

/** Builds the raw path string: segments, then tokens spliced in, then case flips. */
function buildRaw(
  head: string,
  tail: string[],
  insertions: { at: number; token: string }[],
  flips: boolean[],
  absolute: boolean,
): string {
  const items = [head, ...tail];
  for (const { at, token } of insertions) {
    items.splice(at % (items.length + 1), 0, token);
  }
  const body = items.join("/");
  const withPrefix = absolute ? `${WS}/${body}` : body;
  let out = "";
  for (let i = 0; i < withPrefix.length; i++) {
    const ch = withPrefix.charAt(i);
    const flip = flips[i % flips.length] === true;
    out += flip
      ? ch === ch.toLowerCase()
        ? ch.toUpperCase()
        : ch.toLowerCase()
      : ch;
  }
  return out;
}

/** Decides with lexical and real paths set to the same value, as for a plain path. */
const decideOne = (p: string): "block" | "allow" => {
  const lexical = lexicalResolve(WS, p);
  const candidates: FirewallCandidate[] = [{ lexical, real: lexical }];
  return decideFirewall({ jarsLexical: JARS, jarsReal: JARS, candidates });
};

/** Wraps a leaf in alternating objects and arrays, `depth` levels deep. */
function nest(leaf: unknown, depth: number): unknown {
  let node = leaf;
  for (let i = 0; i < depth; i++) {
    node = i % 2 === 0 ? { k: node } : [node];
  }
  return node;
}

describe("Property 17: firewall decision", () => {
  it("keeps the decision under extra '.' segments, 'dir/..' pairs and letter-case changes", () => {
    fc.assert(
      fc.property(
        pathArb,
        insertionsArb,
        flipsArb,
        fc.boolean(),
        ({ head, tail }, insertions, flips, absolute) => {
          const raw = buildRaw(head, tail, insertions, flips, absolute);
          const lexical = lexicalResolve(WS, raw);
          const canonical = `${WS}/${[head, ...tail].join("/")}`;

          // The collapse must reach the canonical path, ignoring letter case.
          if (lexical.toLowerCase() !== canonical.toLowerCase()) {
            throw new Error(`collapse drift: raw=${raw} lexical=${lexical}`);
          }
          return decideOne(raw) === expectedDecision(head);
        },
      ),
      RUNS,
    );
  });

  it("blocks a path at any depth inside tool_input and keeps the decision", () => {
    fc.assert(
      fc.property(
        pathArb,
        insertionsArb,
        flipsArb,
        fc.boolean(),
        fc.integer({ min: 0, max: 30 }),
        ({ head, tail }, insertions, flips, absolute, depth) => {
          const raw = buildRaw(head, tail, insertions, flips, absolute);
          const toolInput = nest(raw, depth);
          const found = candidatePaths(toolInput);
          if (found.length !== 1 || found[0] !== raw) return false;

          const candidates = found.map((p) => {
            const lexical = lexicalResolve(WS, p);
            return { lexical, real: lexical };
          });
          return (
            decideFirewall({ jarsLexical: JARS, jarsReal: JARS, candidates }) ===
            expectedDecision(head)
          );
        },
      ),
      RUNS,
    );
  });

  it("uses the real path as well as the lexical path", () => {
    fc.assert(
      fc.property(
        pathArb,
        insertionsArb,
        flipsArb,
        fc.boolean(),
        ({ head, tail }, insertions, flips, absolute) => {
          const raw = buildRaw(head, tail, insertions, flips, absolute);
          const variant = lexicalResolve(WS, raw);
          const expected = expectedDecision(head);

          // A safe lexical path with a real path that may point into jars.
          const viaRealOnly = decideFirewall({
            jarsLexical: JARS,
            jarsReal: JARS,
            candidates: [{ lexical: "/ws/src/a.txt", real: variant }],
          });
          // A lexical path into jars with a real path that points elsewhere.
          const viaLexicalOnly = decideFirewall({
            jarsLexical: JARS,
            jarsReal: JARS,
            candidates: [{ lexical: variant, real: "/elsewhere/a.txt" }],
          });
          return viaRealOnly === expected && viaLexicalOnly === expected;
        },
      ),
      RUNS,
    );
  });
});
