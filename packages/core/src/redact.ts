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

/** Stringified JSON nested deeper than this is redacted without being inspected. */
const MAX_STRINGIFIED_DEPTH = 8;

/**
 * True when a string value is itself JSON (an object or array) that holds a sensitive key or a
 * pattern match, at any depth, including inside further stringified JSON. Such a string is
 * replaced whole: its characters cannot be spliced without re-serialising what the server wrote.
 * Fails closed (a2a round 07): JSON-looking text past the depth limit, or too deep to walk (a
 * RangeError), counts as sensitive. Text that does not parse as JSON is not JSON and is left to
 * the patterns.
 */
function stringifiedSensitive(s: string, c: Compiled, depth = 0): boolean {
  const t = s.trimStart();
  if (t[0] !== "{" && t[0] !== "[") return false;
  if (depth > MAX_STRINGIFIED_DEPTH) return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch (err) {
    return err instanceof RangeError;
  }
  try {
    return holdsSensitiveKey(parsed, c, depth);
  } catch (err) {
    if (err instanceof RangeError) return true;
    throw err;
  }
}

function holdsSensitiveKey(v: unknown, c: Compiled, depth: number): boolean {
  // A decoded string is checked like any other value: an escape such as `sk-…` only reads as
  // a key after JSON.parse, so the patterns run here too, not only on the outer raw text.
  if (typeof v === "string") return matchesAny(v, c.res) || stringifiedSensitive(v, c, depth + 1);
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
  return { responseText: redactTextMembers(replaced, c), response: null, pointers: [], textRedacted: true };
}

/** A JSON member found in free text: `"key"`, the colon with its whitespace, and the value or the container's first char. */
export interface TextMember {
  readonly start: number;
  readonly end: number;
  readonly rawKey: string;
  readonly colon: string;
  readonly value: string;
}

const isLineTerminator = (ch: string): boolean => ch === "\n" || ch === "\r" || ch === " " || ch === " ";
const isSpace = (ch: string): boolean => /\s/.test(ch);
const isDigit = (ch: string | undefined): boolean => ch !== undefined && ch >= "0" && ch <= "9";

/**
 * Scans a string literal body from `from` (just after its opening quote): any char but `"`, `\` and `\n`, or a `\`
 * followed by any char but a line terminator. Returns the index of the closing quote, or -1 and where the scan stopped.
 */
function scanQuoted(text: string, from: number): { close: number; stop: number } {
  let i = from;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (ch === '"') return { close: i, stop: i };
    if (ch === "\n") return { close: -1, stop: i };
    if (ch === "\\") {
      if (i + 1 >= text.length || isLineTerminator(text.charAt(i + 1))) return { close: -1, stop: i };
      i += 2;
    } else {
      i += 1;
    }
  }
  return { close: -1, stop: i };
}

/** The end (exclusive) of a value at `at`: a string, a JSON number, true, false, null, or `{` / `[`; -1 if none. */
function valueEnd(text: string, at: number): number {
  const ch = text.charAt(at);
  if (ch === '"') {
    const { close } = scanQuoted(text, at + 1);
    return close < 0 ? -1 : close + 1;
  }
  if (ch === "-" || isDigit(ch)) {
    let j = ch === "-" ? at + 1 : at;
    if (!isDigit(text[j])) return -1;
    while (isDigit(text[j])) j += 1;
    if (text[j] === "." && isDigit(text[j + 1])) {
      j += 1;
      while (isDigit(text[j])) j += 1;
    }
    if (text[j] === "e" || text[j] === "E") {
      let k = j + 1;
      if (text[k] === "+" || text[k] === "-") k += 1;
      if (isDigit(text[k])) {
        while (isDigit(text[k])) k += 1;
        j = k;
      }
    }
    return j;
  }
  for (const word of ["true", "false", "null"]) if (text.startsWith(word, at)) return at + word.length;
  return ch === "{" || ch === "[" ? at + 1 : -1;
}

/**
 * Every JSON member written in free text, left to right and not overlapping: a quoted key, a colon, then a scalar or
 * the start of a container. It finds exactly what the global pattern
 * `/"((?:[^"\\\n]|\\.)*)"(\s*:\s*)("(?:[^"\\\n]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{[])/g`
 * finds, in linear time. That pattern retried an unterminated string from every escaped quote inside it (quadratic,
 * CodeQL js/polynomial-redos). A quote the key scan consumed as `\"` starts a scan in step with that one, so it ends
 * where that one ended: no match can start before the key's closing quote (or before the stop of a failed scan).
 */
export function findTextMembers(text: string): TextMember[] {
  const members: TextMember[] = [];
  let p = text.indexOf('"');
  while (p >= 0 && p < text.length) {
    const key = scanQuoted(text, p + 1);
    if (key.close < 0) {
      p = text.indexOf('"', key.stop + 1);
      continue;
    }
    let j = key.close + 1;
    while (j < text.length && isSpace(text.charAt(j))) j += 1;
    let end = -1;
    let colonEnd = j;
    if (text.charAt(j) === ":") {
      colonEnd = j + 1;
      while (colonEnd < text.length && isSpace(text.charAt(colonEnd))) colonEnd += 1;
      end = valueEnd(text, colonEnd);
    }
    if (end < 0) {
      // no member starts at p, nor at any quote inside the key: the next try is the key's closing quote
      p = key.close;
      continue;
    }
    members.push({
      start: p,
      end,
      rawKey: text.slice(p + 1, key.close),
      colon: text.slice(key.close + 1, colonEnd),
      value: text.slice(colonEnd, end),
    });
    p = text.indexOf('"', end);
  }
  return members;
}

/**
 * The sensitive-key rule for a text response kept in plain text (redact mode; a2a round 07): an
 * error message such as `Error: {"password":"hunter2"}` is not a JSON_Response, so the key rule
 * never saw it and only the patterns ran. A sensitive key's scalar value becomes the quoted marker;
 * a sensitive key whose value is an object or an array cannot be bounded safely in free text, so
 * the whole text becomes the marker (fail closed). Hash mode is unchanged: no plain text is stored.
 */
function redactTextMembers(text: string, c: Compiled): string {
  let whole = false;
  let out = "";
  let last = 0;
  for (const { start, end, rawKey, colon, value } of findTextMembers(text)) {
    let key = rawKey;
    try {
      key = JSON.parse(`"${rawKey}"`) as string;
    } catch {
      // not a valid JSON string literal: match the key as written
    }
    if (!c.keys.has(key)) continue;
    if (value === "{" || value === "[") {
      whole = true;
      continue;
    }
    out += `${text.slice(last, start)}"${rawKey}"${colon}${JSON.stringify(MARKER)}`;
    last = end;
  }
  out += text.slice(last);
  return whole ? MARKER : out;
}
