import { z } from "zod";
import { isJsonResponse, type Json } from "./json.js";
import { scanJson, type ScanNode } from "./scan.js";
import { sha256Hex } from "./sha256.js";

/** Strict schema for `.specimen/redact.json`. Unknown keys are rejected. */
export const redactConfigSchema = z.strictObject({
  keys: z.array(z.string()),
  patterns: z.array(z.string()),
  text: z.enum(["redact", "hash"]),
});

export type RedactConfig = z.infer<typeof redactConfigSchema>;

/** Replacement text for every redacted value. */
export const MARKER = "[REDACTED]";

/** Built-in default. The shipped `.specimen/redact.json` must equal this value. */
export const DEFAULT_REDACT_CONFIG: RedactConfig = {
  keys: ["authorization", "password", "secret", "token", "api_key"],
  patterns: [
    "Bearer\\s+[A-Za-z0-9._~+/=-]+",
    "sk-[A-Za-z0-9]{20,}",
    "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}",
  ],
  text: "redact",
};

/** Decides whether an object key is sensitive. */
export type KeyMatcher = { has(key: string): boolean };

/**
 * The lowercase words of a key: camelCase, PascalCase, snake_case, kebab-case and dotted keys all
 * split the same way, so `accessToken`, `access_token`, `Access-Token` and `ACCESS_TOKEN` are all
 * ["access", "token"].
 */
export function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
}

/** True when `words` holds `run` as a contiguous run. */
function hasRun(words: readonly string[], run: readonly string[]): boolean {
  for (let start = 0; start + run.length <= words.length; start += 1) {
    if (run.every((word, offset) => words[start + offset] === word)) return true;
  }
  return false;
}

/**
 * The sensitive-key rule (a2a round 05; it replaced the exact, case-sensitive match). A key is
 * sensitive when it equals a configured key, or when its words contain a configured key's words as
 * a contiguous run, ignoring case and separators: `token` covers `Token`, `access_token` and
 * `X-Auth-Token` but not `tokens_used` or `max_tokens`; `api_key` covers `apiKey` and `x-api-key`;
 * `authorization` covers the HTTP header's canonical `Authorization`. A configured key with no
 * letters or digits matches only itself. Jars are committed to git, so the rule errs towards
 * redacting.
 */
export function keyMatcher(keys: readonly string[]): KeyMatcher {
  const exact = new Set(keys);
  const runs = keys.map(keyWords).filter((words) => words.length > 0);
  return {
    has(key: string): boolean {
      if (exact.has(key)) return true;
      if (runs.length === 0) return false;
      const words = keyWords(key);
      return runs.some((run) => hasRun(words, run));
    },
  };
}

/** A Redact_Config whose patterns compiled as global, case-sensitive RegExp objects. */
export type Compiled = {
  keys: KeyMatcher;
  res: readonly RegExp[];
  text: "redact" | "hash";
};

/**
 * Compiles every pattern. A pattern fails when its source is not a valid regular
 * expression or when it matches the empty string. The result names the failing index.
 */
export function compileRedact(
  c: RedactConfig,
): { ok: true; value: Compiled } | { ok: false; patternIndex: number } {
  const res: RegExp[] = [];
  for (let index = 0; index < c.patterns.length; index += 1) {
    const source = c.patterns[index] ?? "";
    let re: RegExp;
    try {
      re = new RegExp(source, "g");
    } catch {
      return { ok: false, patternIndex: index };
    }
    if (new RegExp(source).test("")) {
      return { ok: false, patternIndex: index };
    }
    res.push(re);
  }
  return { ok: true, value: { keys: keyMatcher(c.keys), res, text: c.text } };
}

/** True when a non-empty match of any pattern occurs in the string. */
function matchesAny(s: string, res: readonly RegExp[]): boolean {
  for (const re of res) {
    for (const match of s.matchAll(re)) {
      if (match[0].length > 0) return true;
    }
  }
  return false;
}

/**
 * True when a string value is itself JSON (an object or array) that holds a sensitive key, at any
 * depth, including inside further stringified JSON. Such a string is replaced whole: its
 * characters cannot be spliced without re-serialising what the server wrote.
 */
function stringifiedSensitive(s: string, c: Compiled, depth = 0): boolean {
  if (depth > 8) return false;
  const t = s.trimStart();
  if (t[0] !== "{" && t[0] !== "[") return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return false;
  }
  return holdsSensitiveKey(parsed, c, depth);
}

function holdsSensitiveKey(v: unknown, c: Compiled, depth: number): boolean {
  if (typeof v === "string") return stringifiedSensitive(v, c, depth + 1);
  if (Array.isArray(v)) return v.some((item) => holdsSensitiveKey(item, c, depth));
  if (v !== null && typeof v === "object") {
    return Object.keys(v).some(
      (key) =>
        c.keys.has(key) ||
        holdsSensitiveKey(Object.getOwnPropertyDescriptor(v, key)?.value, c, depth),
    );
  }
  return false;
}

/** True when a string value must be replaced: a pattern matches it, or it is JSON with a sensitive key. */
function stringSensitive(s: string, c: Compiled): boolean {
  return matchesAny(s, c.res) || stringifiedSensitive(s, c);
}

/** Replaces every non-empty match of every pattern with the marker, one pattern after another. */
function replaceAll(s: string, res: readonly RegExp[]): string {
  let out = s;
  for (const re of res) {
    out = out.replace(re, (m) => (m.length > 0 ? MARKER : m));
  }
  return out;
}

/** RFC 6901 token escaping: `~` becomes `~0` first, then `/` becomes `~1`. */
function pointerToken(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Redacts a parsed tool input. Returns the redacted value and the RFC 6901 pointers of the
 * replaced values, relative to the input root (the caller adds the `/input` prefix).
 * Output objects are built with Object.defineProperty, so a key named `__proto__` stays an
 * own data property.
 */
export function redactInput(input: Json, c: Compiled): { value: Json; pointers: string[] } {
  const pointers: string[] = [];
  const value = redactInputValue(input, "", c, pointers);
  return { value, pointers };
}

function redactInputValue(v: Json, ptr: string, c: Compiled, pointers: string[]): Json {
  if (typeof v === "string") {
    if (stringSensitive(v, c)) {
      pointers.push(ptr);
      return MARKER;
    }
    return v;
  }
  if (Array.isArray(v)) {
    return v.map((item, index) => redactInputValue(item, `${ptr}/${index}`, c, pointers));
  }
  if (v !== null && typeof v === "object") {
    const out: { [k: string]: Json } = {};
    for (const key of Object.keys(v)) {
      const childPtr = `${ptr}/${pointerToken(key)}`;
      let next: Json;
      if (c.keys.has(key)) {
        pointers.push(childPtr);
        next = MARKER;
      } else {
        const child = Object.getOwnPropertyDescriptor(v, key)?.value as Json;
        next = redactInputValue(child, childPtr, c, pointers);
      }
      Object.defineProperty(out, key, {
        value: next,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return out;
  }
  return v;
}

/** Result of redacting a tool response. Pointers are relative to the response root. */
export type ResponseResult = {
  responseText: string;
  response: Json | null;
  /** Sorted by code-unit order, without duplicates. The caller adds the `/response` prefix. */
  pointers: string[];
  textRedacted: boolean;
  /** UTF-16 length of the replaced text. Present only for a hashed non-JSON response. */
  responseLength?: number;
};

/**
 * Redacts a tool response. A JSON_Response is spliced at the character spans of the values
 * to replace, so every byte outside those spans is kept. Other text is pattern-replaced,
 * and in `hash` mode replaced by its SHA-256.
 */
export function redactResponse(toolResponse: string, c: Compiled): ResponseResult {
  if (isJsonResponse(toolResponse)) {
    return redactJsonResponse(toolResponse, c);
  }
  return redactText(toolResponse, c);
}

type Span = { start: number; end: number; ptr: string };

function redactJsonResponse(text: string, c: Compiled): ResponseResult {
  const root = scanJson(text);
  const spans: Span[] = [];
  locate(root, "", c, spans);

  // Splice from the end so earlier offsets stay valid.
  spans.sort((a, b) => b.start - a.start);
  let responseText = text;
  for (const span of spans) {
    responseText =
      responseText.slice(0, span.start) + JSON.stringify(MARKER) + responseText.slice(span.end);
  }

  const pointers = [...new Set(spans.map((span) => span.ptr))].sort();
  const response = JSON.parse(responseText) as Json;
  return { responseText, response, pointers, textRedacted: false };
}

/** True when the value, or any value inside it, would be replaced. */
function containsRedaction(value: ScanNode, c: Compiled): boolean {
  switch (value.kind) {
    case "scalar":
      return false;
    case "string":
      return stringSensitive(value.decoded, c);
    case "array":
      return value.items.some((item) => containsRedaction(item, c));
    case "object":
      return value.members.some(
        (member) => c.keys.has(member.key) || containsRedaction(member.value, c),
      );
  }
}

/**
 * Collects the outermost values to replace. A located value is not searched further.
 * A key that appears more than once in one object is replaced in every member when any of
 * its members is redacted. JSON.parse keeps only the last duplicate, so replacing just the
 * redacted member would leave a recorded pointer resolving to an unredacted value.
 */
function locate(value: ScanNode, ptr: string, c: Compiled, spans: Span[]): void {
  switch (value.kind) {
    case "scalar":
      return;
    case "string":
      if (stringSensitive(value.decoded, c)) {
        spans.push({ start: value.start, end: value.end, ptr });
      }
      return;
    case "array":
      value.items.forEach((item, index) => locate(item, `${ptr}/${index}`, c, spans));
      return;
    case "object": {
      const counts = new Map<string, number>();
      for (const member of value.members) {
        counts.set(member.key, (counts.get(member.key) ?? 0) + 1);
      }
      const redactedDuplicates = new Set<string>();
      for (const member of value.members) {
        if ((counts.get(member.key) ?? 0) > 1 && containsRedaction(member.value, c)) {
          redactedDuplicates.add(member.key);
        }
      }
      for (const member of value.members) {
        const childPtr = `${ptr}/${pointerToken(member.key)}`;
        if (c.keys.has(member.key) || redactedDuplicates.has(member.key)) {
          spans.push({ start: member.value.start, end: member.value.end, ptr: childPtr });
        } else {
          locate(member.value, childPtr, c, spans);
        }
      }
      return;
    }
  }
}

/**
 * Redacts a response that is not a JSON_Response. In mode `hash` the result is the `sha256:`
 * text of the replaced text, exactly as jar-capture stores a Hashed_Jar (Requirement 7 criterion
 * 20). The replay engine calls this directly so that a replayed text is hashed by the same code.
 */
export function redactText(text: string, c: Compiled): ResponseResult {
  const replaced = replaceAll(text, c.res);
  if (c.text === "hash") {
    return {
      responseText: `sha256:${sha256Hex(replaced)}`,
      response: null,
      pointers: [],
      textRedacted: true,
      responseLength: replaced.length,
    };
  }
  return { responseText: replaced, response: null, pointers: [], textRedacted: true };
}
