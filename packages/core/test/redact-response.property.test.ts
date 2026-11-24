import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { canonicalJson, type Json } from "../src/json.js";
import { DEFAULT_REDACT_CONFIG, MARKER, compileRedact, redactResponse } from "../src/redact.js";

// Feature: jar-capture, Property 13: Raw-text fidelity of response redaction
// **Validates: Requirements 7.9, 7.10, 7.11, 7.12, 7.13, 7.14, 7.15, 7.16, 7.21, 11.5, 11.6**

const RUNS = { numRuns: 200 };

/** Keys the generator draws from. Sensitive keys recur, duplicates are common, and some need escaping. */
const KEY_POOL = [
  "token",
  "password",
  "authorization",
  "secret",
  "api_key",
  "custom",
  "Token",
  "room",
  "note",
  "a/b~c",
  "__proto__",
  "constructor",
  "n",
];

/** Patterns: the shipped default plus one custom pattern. */
const PATTERNS: string[] = [...DEFAULT_REDACT_CONFIG.patterns, "ZZ\\d{2}"];

/** String fragments. Several match a pattern, so redacted and kept strings both occur. */
const SEGMENTS = [
  "Bearer tok9",
  "Bearer  x.y",
  "sk-abcdefghijklmnopqrst",
  "a@b.co",
  "ZZ42",
  "ZZ4",
  "425.00",
  "1e3",
  "plain",
  "x",
  " ",
  '"',
  "\\",
  "/",
  "\n",
  "\t",
  "é",
  "€",
  "token",
  "~",
  "{",
  "]",
  ",",
  ":",
];

/** Number literals in several formats. None is a match for any pattern. */
const NUMBERS = [
  "425.00",
  "212.50",
  "1e3",
  "1E+2",
  "-0",
  "0",
  "3.14159",
  "-12.5e-3",
  "7",
  "0.5",
  "2e-7",
  "-1.0E2",
  "10",
];

const LITERALS = ["true", "false", "null"];

const SHORT_ESCAPES = new Map<string, string>([
  ['"', '\\"'],
  ["\\", "\\\\"],
  ["/", "\\/"],
  ["\n", "\\n"],
  ["\t", "\\t"],
]);

type GStr = { kind: "str"; text: string; seed: number };
type GNum = { kind: "num"; raw: string };
type GLit = { kind: "lit"; raw: string };
type GArr = { kind: "arr"; items: { ws: string; node: GNode }[]; close: string };
type GMember = { ws: string; key: string; keySeed: number; ws1: string; ws2: string; value: GNode };
type GObj = { kind: "obj"; members: GMember[]; close: string };
type GNode = GStr | GNum | GLit | GArr | GObj;
type GDoc = { lead: string; root: GArr | GObj; trail: string };

/**
 * Encodes decoded text as the body of a JSON string. The seed picks, per character, between
 * a raw character, a \uXXXX escape, and a short escape, so one decoded value has many spellings.
 */
function encodeString(s: string, seed: number): string {
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    const ch = s.charAt(i);
    const code = s.charCodeAt(i);
    const hex = `\\u${code.toString(16).padStart(4, "0")}`;
    const raw = code >= 0x20 && ch !== '"' && ch !== "\\";
    const short = SHORT_ESCAPES.get(ch);
    const choice = ((seed + i * 7919) >>> 0) % 4;
    if (choice === 0) out += raw ? ch : hex;
    else if (choice === 1) out += hex;
    else if (choice === 2) out += short ?? (raw ? ch : hex);
    else out += short ?? hex;
  }
  return out;
}

const wsArb = fc
  .array(fc.constantFrom(" ", "\t", "\n", "\r"), { maxLength: 3 })
  .map((chars) => chars.join(""));
const seedArb = fc.nat({ max: 1_000_000 });

const strArb: fc.Arbitrary<GNode> = fc.record({
  kind: fc.constant("str" as const),
  text: fc.array(fc.constantFrom(...SEGMENTS), { maxLength: 3 }).map((parts) => parts.join("")),
  seed: seedArb,
});

const numArb: fc.Arbitrary<GNode> = fc.oneof(
  fc.constantFrom(...NUMBERS),
  fc.integer({ min: -999, max: 999 }).map(String),
).map((raw) => ({ kind: "num" as const, raw }));

const litArb: fc.Arbitrary<GNode> = fc
  .constantFrom(...LITERALS)
  .map((raw) => ({ kind: "lit" as const, raw }));

const leafArb: fc.Arbitrary<GNode> = fc.oneof(
  { weight: 3, arbitrary: strArb },
  { weight: 2, arbitrary: numArb },
  { weight: 1, arbitrary: litArb },
);

/** Random response documents: objects and arrays with random whitespace and duplicate keys. */
const docArb: fc.Arbitrary<GDoc> = fc.letrec<{
  node: GNode;
  arr: GArr;
  obj: GObj;
  doc: GDoc;
}>((tie) => ({
  node: fc.oneof({ maxDepth: 4 }, leafArb, tie("arr"), tie("obj")),
  arr: fc.record({
    kind: fc.constant("arr" as const),
    items: fc.array(
      fc.record({ ws: wsArb, node: tie("node") as fc.Arbitrary<GNode> }),
      { maxLength: 4 },
    ),
    close: wsArb,
  }),
  obj: fc.record({
    kind: fc.constant("obj" as const),
    members: fc.array(
      fc.record({
        ws: wsArb,
        key: fc.constantFrom(...KEY_POOL),
        keySeed: seedArb,
        ws1: wsArb,
        ws2: wsArb,
        value: tie("node") as fc.Arbitrary<GNode>,
      }),
      { maxLength: 5 },
    ),
    close: wsArb,
  }),
  doc: fc.record({
    lead: wsArb,
    root: fc.oneof(tie("obj") as fc.Arbitrary<GArr | GObj>, tie("arr") as fc.Arbitrary<GArr | GObj>),
    trail: wsArb,
  }),
})).doc;

/** The sensitive keys in a config. Any subset of the pool, so a key is sometimes sensitive. */
const configKeysArb = fc.uniqueArray(fc.constantFrom(...KEY_POOL), { maxLength: 5 });

type Span = { start: number; end: number };

/**
 * Serialises a document and records the character span of every node. The whitespace
 * slots sit outside the value spans, so a span covers exactly one JSON value.
 */
function serialize(doc: GDoc): { text: string; spans: Map<GNode, Span> } {
  const spans = new Map<GNode, Span>();
  let text = doc.lead;
  const emit = (n: GNode): void => {
    const start = text.length;
    if (n.kind === "str") {
      text += `"${encodeString(n.text, n.seed)}"`;
    } else if (n.kind === "num" || n.kind === "lit") {
      text += n.raw;
    } else if (n.kind === "arr") {
      text += "[";
      n.items.forEach((item, i) => {
        text += (i > 0 ? "," : "") + item.ws;
        emit(item.node);
      });
      text += `${n.close}]`;
    } else {
      text += "{";
      n.members.forEach((m, i) => {
        text += `${i > 0 ? "," : ""}${m.ws}"${encodeString(m.key, m.keySeed)}"${m.ws1}:${m.ws2}`;
        emit(m.value);
      });
      text += `${n.close}}`;
    }
    spans.set(n, { start, end: text.length });
  };
  emit(doc.root);
  text += doc.trail;
  return { text, spans };
}

function spanOf(spans: Map<GNode, Span>, node: GNode): Span {
  const span = spans.get(node);
  if (span === undefined) throw new Error("node has no span");
  return span;
}

/** RFC 6901 escape, the inverse of the unescape in resolvePointer. */
const escapeToken = (key: string): string => key.replace(/~/g, "~0").replace(/\//g, "~1");

/** True when a non-empty match of any pattern occurs in the decoded string. */
function matchesOracle(s: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => [...s.matchAll(new RegExp(p, "g"))].some((m) => m[0].length > 0));
}

type Located = { node: GNode; ptr: string; visible: boolean };
type Oracle = { located: Located[]; numbers: GNum[] };

/**
 * Oracle for the redaction rules, written from the decoded document. It collects the outermost
 * values to replace and every number that is kept. A located value is not searched further.
 * `visible` is true when JSON.parse exposes the value at its pointer. For a duplicated key,
 * JSON.parse keeps only the last member, so an earlier duplicate is not visible.
 */
function oracle(
  node: GNode,
  ptr: string,
  visible: boolean,
  keys: ReadonlySet<string>,
  patterns: readonly string[],
  out: Oracle,
): void {
  if (node.kind === "str") {
    if (matchesOracle(node.text, patterns)) out.located.push({ node, ptr, visible });
    return;
  }
  if (node.kind === "num") {
    out.numbers.push(node);
    return;
  }
  if (node.kind === "lit") return;
  if (node.kind === "arr") {
    node.items.forEach((item, i) =>
      oracle(item.node, `${ptr}/${i}`, visible, keys, patterns, out),
    );
    return;
  }
  for (const [index, m] of node.members.entries()) {
    const childPtr = `${ptr}/${escapeToken(m.key)}`;
    const isLast = node.members.slice(index + 1).every((other) => other.key !== m.key);
    const childVisible = visible && isLast;
    if (keys.has(m.key)) {
      out.located.push({ node: m.value, ptr: childPtr, visible: childVisible });
    } else {
      oracle(m.value, childPtr, childVisible, keys, patterns, out);
    }
  }
}

/** Resolves an RFC 6901 pointer against a value using own properties only. */
function resolvePointer(root: Json, ptr: string): Json | undefined {
  if (ptr === "") return root;
  let cur: Json | undefined = root;
  for (const raw of ptr.slice(1).split("/")) {
    const token = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(cur)) {
      cur = cur[Number(token)];
    } else if (cur !== null && typeof cur === "object") {
      cur = Object.getOwnPropertyDescriptor(cur, token)?.value as Json | undefined;
    } else {
      return undefined;
    }
  }
  return cur;
}

const MARKER_JSON = JSON.stringify(MARKER);

describe("redactResponse property: raw-text fidelity", () => {
  it("changes only redacted value bytes, keeps number literals, and still parses as JSON", () => {
    fc.assert(
      fc.property(docArb, configKeysArb, (doc, keyList) => {
        const { text, spans } = serialize(doc);
        // The generator must produce valid input, otherwise the rest of the check is meaningless.
        expect(() => JSON.parse(text)).not.toThrow();

        const compiled = compileRedact({ keys: keyList, patterns: PATTERNS, text: "redact" });
        expect(compiled.ok).toBe(true);
        if (!compiled.ok) return;

        const out: Oracle = { located: [], numbers: [] };
        oracle(doc.root, "", true, new Set(keyList), PATTERNS, out);
        const located = out.located
          .map((l) => ({ ...l, span: spanOf(spans, l.node) }))
          .sort((a, b) => a.span.start - b.span.start);

        // Expected text: each located span becomes the marker, all other characters are kept.
        let expected = "";
        let cursor = 0;
        for (const l of located) {
          expected += text.slice(cursor, l.span.start) + MARKER_JSON;
          cursor = l.span.end;
        }
        expected += text.slice(cursor);

        const result = redactResponse(text, compiled.value);

        // Only the bytes of redacted values change. Everything else is byte-identical.
        expect(result.responseText).toBe(expected);
        expect(result.textRedacted).toBe(false);
        if (located.length === 0) {
          expect(result.responseText).toBe(text);
          expect(result.pointers).toEqual([]);
        }

        // Pointers are sorted, unique, and match the located values.
        const expectedPointers = [...new Set(located.map((l) => l.ptr))].sort();
        expect(result.pointers).toEqual(expectedPointers);

        // The output parses as JSON and matches the expected document.
        expect(() => JSON.parse(result.responseText)).not.toThrow();
        const parsed = result.response as Json;
        expect(canonicalJson(parsed)).toBe(canonicalJson(JSON.parse(expected) as Json));

        // Every number that was not redacted keeps its original literal text at its shifted offset.
        for (const n of out.numbers) {
          const span = spanOf(spans, n);
          const shift = located
            .filter((l) => l.span.end <= span.start)
            .reduce((acc, l) => acc + MARKER_JSON.length - (l.span.end - l.span.start), 0);
          const at = span.start + shift;
          expect(result.responseText.slice(at, at + n.raw.length)).toBe(n.raw);
        }

        // Each visible pointer resolves to the marker in the parsed output. A hidden duplicate is skipped.
        for (const l of located) {
          if (l.visible) expect(resolvePointer(parsed, l.ptr)).toBe(MARKER);
        }
      }),
      RUNS,
    );
  });
});
