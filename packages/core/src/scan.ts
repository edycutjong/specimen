/**
 * Strict RFC 8259 scanner. It accepts exactly the texts that JSON.parse accepts and, for
 * every value, reports the character span it occupies in the raw text. Redaction uses the
 * spans to splice replacements into the raw text, so number literals such as `425.00`
 * outside a replaced span keep their exact characters.
 *
 * Object members are kept in text order, including duplicate keys.
 */

/** One JSON value and the half-open character range [start, end) it occupies. */
export type ScanNode =
  | { kind: "scalar"; start: number; end: number }
  | { kind: "string"; start: number; end: number; decoded: string }
  | { kind: "array"; start: number; end: number; items: ScanNode[] }
  | { kind: "object"; start: number; end: number; members: ScanMember[] };

/** One object member. `key` is the decoded key text. Duplicate keys each get their own member. */
export type ScanMember = { key: string; value: ScanNode };

/** Raised for any text that is not strict JSON. The message carries only the offset, never input text. */
export class ScanError extends Error {
  readonly offset: number;

  constructor(offset: number) {
    super(`invalid JSON at offset ${offset}`);
    this.name = "ScanError";
    this.offset = offset;
  }
}

interface Cursor {
  readonly text: string;
  pos: number;
}

const NUMBER_RE = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const ESCAPE_RE = /\\(?:["\\/bfnrt]|u[0-9A-Fa-f]{4})/y;
const LITERALS = ["true", "false", "null"] as const;

function fail(c: Cursor): never {
  throw new ScanError(c.pos);
}

function skipWhitespace(c: Cursor): void {
  while (c.pos < c.text.length) {
    const code = c.text.charCodeAt(c.pos);
    // space, tab, line feed, carriage return: the only whitespace RFC 8259 allows.
    if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
      c.pos += 1;
    } else {
      return;
    }
  }
}

function expectChar(c: Cursor, ch: string): void {
  if (c.text[c.pos] !== ch) fail(c);
  c.pos += 1;
}

function scanString(c: Cursor): { start: number; end: number; decoded: string } {
  const start = c.pos;
  expectChar(c, '"');
  for (;;) {
    const code = c.text.charCodeAt(c.pos);
    if (Number.isNaN(code)) fail(c);
    if (code === 0x22) {
      c.pos += 1;
      break;
    }
    // Raw control characters U+0000 to U+001F are not allowed inside a string.
    if (code < 0x20) fail(c);
    if (code === 0x5c) {
      ESCAPE_RE.lastIndex = c.pos;
      const escape = ESCAPE_RE.exec(c.text);
      if (escape === null) fail(c);
      c.pos += escape[0].length;
      continue;
    }
    c.pos += 1;
  }
  const end = c.pos;
  // The raw literal has been validated above, so JSON.parse only decodes escapes here.
  const decoded: unknown = JSON.parse(c.text.slice(start, end));
  if (typeof decoded !== "string") fail(c);
  return { start, end, decoded: decoded as string };
}

function scanNumber(c: Cursor): void {
  NUMBER_RE.lastIndex = c.pos;
  const match = NUMBER_RE.exec(c.text);
  if (match === null) fail(c);
  c.pos += match[0].length;
}

function scanLiteral(c: Cursor): void {
  for (const word of LITERALS) {
    if (c.text.startsWith(word, c.pos)) {
      c.pos += word.length;
      return;
    }
  }
  fail(c);
}

function parseValue(c: Cursor): ScanNode {
  const ch = c.text[c.pos];
  if (ch === "{") return parseObject(c);
  if (ch === "[") return parseArray(c);
  if (ch === '"') {
    const s = scanString(c);
    return { kind: "string", start: s.start, end: s.end, decoded: s.decoded };
  }
  if (ch === "-" || (ch !== undefined && ch >= "0" && ch <= "9")) {
    const start = c.pos;
    scanNumber(c);
    return { kind: "scalar", start, end: c.pos };
  }
  const start = c.pos;
  scanLiteral(c);
  return { kind: "scalar", start, end: c.pos };
}

function parseArray(c: Cursor): ScanNode {
  const start = c.pos;
  expectChar(c, "[");
  skipWhitespace(c);
  const items: ScanNode[] = [];
  if (c.text[c.pos] === "]") {
    c.pos += 1;
    return { kind: "array", start, end: c.pos, items };
  }
  for (;;) {
    skipWhitespace(c);
    items.push(parseValue(c));
    skipWhitespace(c);
    const ch = c.text[c.pos];
    if (ch === ",") {
      c.pos += 1;
      continue;
    }
    if (ch === "]") {
      c.pos += 1;
      break;
    }
    fail(c);
  }
  return { kind: "array", start, end: c.pos, items };
}

function parseObject(c: Cursor): ScanNode {
  const start = c.pos;
  expectChar(c, "{");
  skipWhitespace(c);
  const members: ScanMember[] = [];
  if (c.text[c.pos] === "}") {
    c.pos += 1;
    return { kind: "object", start, end: c.pos, members };
  }
  for (;;) {
    skipWhitespace(c);
    const key = scanString(c);
    skipWhitespace(c);
    expectChar(c, ":");
    skipWhitespace(c);
    const value = parseValue(c);
    members.push({ key: key.decoded, value });
    skipWhitespace(c);
    const ch = c.text[c.pos];
    if (ch === ",") {
      c.pos += 1;
      continue;
    }
    if (ch === "}") {
      c.pos += 1;
      break;
    }
    fail(c);
  }
  return { kind: "object", start, end: c.pos, members };
}

/**
 * Scans one complete JSON text. Leading and trailing whitespace is allowed. Any other
 * trailing character, trailing commas, leading zeros, raw control characters in strings
 * and unknown escapes are errors. Throws ScanError.
 */
export function scanJson(text: string): ScanNode {
  const c: Cursor = { text, pos: 0 };
  skipWhitespace(c);
  const node = parseValue(c);
  skipWhitespace(c);
  if (c.pos !== text.length) fail(c);
  return node;
}
