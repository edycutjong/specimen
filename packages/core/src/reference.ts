/**
 * Reference by code (Requirement 8). The Reference names the recorded facts that a bugfix spec
 * must state again. It is derived from one Result_Entry only: its `changes`, `state`, `tool` and
 * `response_text`. It never reads the prose of a Bugfix_Spec, and no other field of the entry
 * affects it.
 *
 * Literal text is copied from `response_text` through jar-capture's scanJson, so `425.00` stays
 * `425.00`. The parsed number is never used to render a literal.
 *
 * Pure logic: no clock, no randomness, no I/O and no Node built-in import.
 */
import { DIFF_MAX_DEPTH, type Change, idKeyOf } from "./diff.js";
import { type Json, isJsonResponse } from "./json.js";
import type { ResultEntry } from "./replay-result.js";
import { type ScanMember, type ScanNode, scanJson } from "./scan.js";

/** One element of the Reference. A bugfix spec must contain every element it renders to. */
export type ReferenceElement =
  /** A Change path together with the jarred literal text found at that path. */
  | { kind: "path-literal"; path: string; literal: string }
  /** A Change path with no literal, for example an added field or a length Change. */
  | { kind: "path"; path: string }
  /** The key of a removed array element, collapsed under a length Change. */
  | { kind: "key"; key: string }
  /** The tool name, for a cracked jar or a change of the whole Body. */
  | { kind: "tool"; tool: string };

const DEPTH_NOTE = `depth limit ${DIFF_MAX_DEPTH}`;
const LINE_POINTER = /^\/line\/([1-9]\d*)$/;
const INDEX_TOKEN = /^(0|[1-9]\d*)$/;

/**
 * The Reference of one jar, as the deduplicated union of the elements of its Changes. A cracked
 * jar has the tool name as its only element. Each element keeps the order of the Changes it came
 * from.
 *
 * Throws when a Change path cannot be located in `response_text`. A Replay_Result that fails
 * this check is not one the Reference can be built from.
 */
export function referenceOf(entry: ResultEntry): ReferenceElement[] {
  if (entry.state === "cracked") return [{ kind: "tool", tool: entry.tool }];
  if (entry.changes.length === 0) return [];

  const lengthPaths = new Set(
    entry.changes.filter((change) => change.kind === "length").map((change) => change.path),
  );
  const body = new JarredBody(entry);
  const elements: ReferenceElement[] = [];
  const seen = new Set<string>();
  for (const change of entry.changes) {
    for (const element of elementsOf(change, entry.changes, lengthPaths, body)) {
      const id = JSON.stringify(element);
      if (!seen.has(id)) {
        seen.add(id);
        elements.push(element);
      }
    }
  }
  return elements;
}

/**
 * The substrings that a Section must contain for one element: both the path and the literal of
 * a path-literal element, and the single text of every other element.
 */
export function referenceSubstrings(ref: ReferenceElement): string[] {
  switch (ref.kind) {
    case "path-literal":
      return [ref.path, ref.literal];
    case "path":
      return [ref.path];
    case "key":
      return [ref.key];
    case "tool":
      return [ref.tool];
  }
}

/** The Reference elements that one Change contributes, following Requirement 8 criteria 2 to 11. */
function elementsOf(
  change: Change,
  changes: readonly Change[],
  lengthPaths: ReadonlySet<string>,
  body: JarredBody,
): ReferenceElement[] {
  const { path } = change;
  switch (change.kind) {
    case "removed": {
      // Criterion 4: a removed element of an array that has a length Change is a key element.
      if (lengthPaths.has(parentPath(path))) return [{ kind: "key", key: lastToken(path) }];
      return [{ kind: "path-literal", path, literal: body.literalAt(path) }];
    }
    case "added":
      return [{ kind: "path", path }];
    case "value": {
      // Criterion 11: the Hashed_Jar change of /response_text carries the whole jarred text.
      if (!body.isJson && path === "/response_text") {
        return [{ kind: "path-literal", path, literal: body.text() }];
      }
      // Criterion 11: a value change at /line/<n> of a non-JSON Body carries the jarred line.
      const line = body.isJson ? undefined : LINE_POINTER.exec(path);
      if (line !== null && line !== undefined) {
        return [{ kind: "path-literal", path, literal: body.lineAt(Number(line[1])) }];
      }
      return [{ kind: "path-literal", path, literal: body.literalAt(path) }];
    }
    case "type": {
      // Criterion 11: a type change of the whole Body names the tool.
      if (path === "") return [{ kind: "tool", tool: body.tool }];
      // Criterion 11: a type change at the depth limit names the path only.
      if (change.note === DEPTH_NOTE) return [{ kind: "path", path }];
      return [{ kind: "path-literal", path, literal: body.literalAt(path) }];
    }
    case "length": {
      // A length Change with removed elements under it is covered by their key elements.
      const hasRemoved = changes.some(
        (other) => other.kind === "removed" && parentPath(other.path) === path,
      );
      return hasRemoved ? [] : [{ kind: "path", path }];
    }
  }
}

/**
 * The jarred response of one entry, read lazily. The parsed value and the scan tree are built
 * once, on first use.
 */
class JarredBody {
  readonly tool: string;
  readonly isJson: boolean;
  private readonly raw: string;
  private scanned: { root: ScanNode; parsed: Json } | undefined;

  constructor(entry: ResultEntry) {
    if (entry.response_text === null) {
      throw new Error(`jar ${entry.id ?? entry.session_id} has no response_text`);
    }
    this.tool = entry.tool;
    this.raw = entry.response_text;
    this.isJson = isJsonResponse(this.raw);
  }

  text(): string {
    return this.raw;
  }

  /** The line of the jarred text, with CRLF read as LF, as the non-JSON diff reads it. */
  lineAt(lineNumber: number): string {
    const lines = this.raw.replace(/\r\n/g, "\n").split("\n");
    const line = lines[lineNumber - 1];
    if (line === undefined) {
      throw new Error(`line ${lineNumber} is not in response_text`);
    }
    return line;
  }

  /** The exact characters of the jarred value at `path`, located through scanJson. */
  literalAt(path: string): string {
    const tokens = pointerTokens(path);
    const scanned = this.scan();
    let at: ScanNode = scanned.root;
    let value: Json = scanned.parsed;
    for (const token of tokens) {
      const next = step(at, value, token);
      if (next === undefined) {
        throw new Error(`path ${path} is not in response_text`);
      }
      at = next.at;
      value = next.value;
    }
    return this.raw.slice(at.start, at.end);
  }

  private scan(): { root: ScanNode; parsed: Json } {
    if (this.scanned === undefined) {
      this.scanned = { root: scanJson(this.raw), parsed: JSON.parse(this.raw) as Json };
    }
    return this.scanned;
  }
}

/**
 * One step of a pointer through the scan tree and the parsed value in step. An array element is
 * found by its Id_Key value when the array has one, and by index otherwise. An object member is
 * the last member with that key, the same member JSON.parse keeps.
 */
function step(at: ScanNode, value: Json, token: string): { at: ScanNode; value: Json } | undefined {
  if (at.kind === "array" && Array.isArray(value)) {
    const index = arrayIndex(value, token);
    if (index === undefined) return undefined;
    const child = at.items[index];
    const element = value[index];
    if (child === undefined || element === undefined) return undefined;
    return { at: child, value: element };
  }
  if (at.kind === "object" && isObject(value)) {
    let member: ScanMember | undefined;
    for (const candidate of at.members) {
      if (candidate.key === token) member = candidate;
    }
    if (member === undefined) return undefined;
    return { at: member.value, value: ownValue(value, token) };
  }
  return undefined;
}

/** The index of the element that a segment names. Id_Key matches first, then a plain index. */
function arrayIndex(elements: Json[], token: string): number | undefined {
  const key = idKeyOf(elements);
  if (key !== undefined) {
    const index = elements.findIndex(
      (element) => isObject(element) && String(ownValue(element, key)) === token,
    );
    if (index !== -1) return index;
  }
  if (INDEX_TOKEN.test(token)) {
    const index = Number(token);
    if (index < elements.length) return index;
  }
  return undefined;
}

/** The pointer split into unescaped tokens. The empty pointer has none. */
function pointerTokens(path: string): string[] {
  if (path === "") return [];
  if (!path.startsWith("/")) throw new Error(`invalid pointer ${path}`);
  return path
    .slice(1)
    .split("/")
    .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/** The pointer of the parent, `""` for the whole Body. Escaped `/` never appears in a token. */
function parentPath(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

/** The last unescaped token of a pointer. */
function lastToken(path: string): string {
  const tokens = pointerTokens(path);
  return tokens[tokens.length - 1] ?? "";
}

function isObject(value: Json): value is { [k: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads an own property through its descriptor, so "__proto__" is an ordinary key. */
function ownValue(target: { [k: string]: Json }, key: string): Json {
  return Object.getOwnPropertyDescriptor(target, key)?.value as Json;
}
