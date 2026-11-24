/**
 * Structural diff of two normalised Bodies (Requirement 4). Each Change names the RFC 6901
 * path of one difference.
 *
 * Pure logic: no clock, no randomness, no I/O and no Node built-in import. Inputs are never
 * mutated. Object keys are read through own property descriptors and are stored only in Maps,
 * so a key such as "__proto__" or "constructor" stays an ordinary key.
 */
import type { Json } from "./json.js";

export type ChangeKind = "removed" | "added" | "value" | "type" | "length";

/** One difference. `was` and `now` are set only for the kinds that carry them. */
export type Change = {
  /** RFC 6901 pointer, `""` for the whole Body. */
  path: string;
  kind: ChangeKind;
  was?: Json;
  now?: Json;
  note?: string;
};

/** Containers at this depth are compared as a whole and never descended into. */
export const DIFF_MAX_DEPTH = 1000;

const DEPTH_NOTE = `depth limit ${DIFF_MAX_DEPTH}`;

const KIND_RANK: Record<ChangeKind, number> = {
  removed: 0,
  added: 1,
  value: 2,
  type: 3,
  length: 4,
};

type JsonObject = { [k: string]: Json };

/** A removed or added member, with the parent path and the raw key for rename detection. */
type Candidate = { change: Change; parent: string; key: string };

type Sink = {
  removed: Candidate[];
  added: Candidate[];
  others: Change[];
};

/**
 * Diff of two normalised Bodies, sorted by path in code-unit order and then by kind in the
 * order removed, added, value, type, length.
 *
 * Two strings at the top level are non-JSON bodies and are compared line by line. In any
 * other place a string is a scalar.
 */
export function diff(was: Json, now: Json): Change[] {
  const sink: Sink = { removed: [], added: [], others: [] };
  if (typeof was === "string" && typeof now === "string") {
    lineChanges(was, now, sink.others);
  } else {
    diffValue(was, now, "", 0, sink);
  }
  return finish(sink);
}

/**
 * The Id_Key of an array of objects, or undefined when no key qualifies. A key qualifies when
 * it is present in every element, is `id` or ends in `_id`, and holds a string or number whose
 * string form is unique across the elements. `id` wins. Otherwise the lowest `*_id` key in
 * code-unit order wins. An empty array has no Id_Key.
 */
export function idKeyOf(elements: Json[]): string | undefined {
  const first = elements[0];
  if (first === undefined || !isObject(first) || !elements.every((el) => isObject(el))) {
    return undefined;
  }
  const candidates = Object.keys(first).filter((key) => key === "id" || key.endsWith("_id"));
  const qualifying = candidates.filter((key) => qualifies(elements, key));
  if (qualifying.includes("id")) return "id";
  qualifying.sort(compareText);
  return qualifying[0];
}

function qualifies(elements: Json[], key: string): boolean {
  const seen = new Set<string>();
  for (const element of elements) {
    if (!isObject(element) || !hasOwn(element, key)) return false;
    const value = own(element, key);
    if (typeof value !== "string" && typeof value !== "number") return false;
    const text = String(value);
    if (seen.has(text)) return false;
    seen.add(text);
  }
  return true;
}

function finish(sink: Sink): Change[] {
  const removed = sink.removed.slice().sort((x, y) => compareText(x.change.path, y.change.path));
  for (const gone of removed) {
    annotateRename(gone, sink.added);
  }
  const changes = [
    ...removed.map((candidate) => candidate.change),
    ...sink.added.map((candidate) => candidate.change),
    ...sink.others,
  ];
  return changes.sort(compareChanges);
}

/**
 * Attaches a rename note to at most one added member for one removed member. The chosen
 * member has the lowest factor n, then the lowest code-unit path. Members that already carry a
 * note are skipped.
 */
function annotateRename(gone: Candidate, added: Candidate[]): void {
  const was = gone.change.was;
  if (typeof was !== "number") return;
  let best: { n: number; target: Candidate } | undefined;
  for (const candidate of added) {
    const now = candidate.change.now;
    if (candidate.change.note !== undefined || candidate.parent !== gone.parent) continue;
    if (typeof now !== "number" || !candidate.key.startsWith(gone.key + "_")) continue;
    const n = powerOfTenFactor(was, now);
    if (n === undefined) continue;
    if (
      best === undefined ||
      n < best.n ||
      (n === best.n && compareText(candidate.change.path, best.target.change.path) < 0)
    ) {
      best = { n, target: candidate };
    }
  }
  if (best !== undefined) {
    const written = "1" + "0".repeat(best.n);
    best.target.change.note = `suspected rename from ${gone.change.path} ×${written}`;
  }
}

/**
 * The n in 1..3 for which `now` equals `was` × 10^n, or undefined. The test runs on the
 * shortest decimal text of each number, so it is exact and uses no binary multiplication.
 * Zero matches only zero, and then with n = 1.
 */
function powerOfTenFactor(was: number, now: number): number | undefined {
  const w = decimalOf(was);
  const v = decimalOf(now);
  if (w.digits === "" || v.digits === "") {
    return w.digits === "" && v.digits === "" ? 1 : undefined;
  }
  if (w.neg !== v.neg || w.digits !== v.digits) return undefined;
  const shift = v.exp - w.exp;
  return shift >= 1 && shift <= 3 ? shift : undefined;
}

type Decimal = { neg: boolean; digits: string; exp: number };

/**
 * Splits the shortest round-tripping text of `x` into significant digits and a power of ten,
 * so that |x| = digits × 10^exp. The digits carry no leading or trailing zeros. Zero has empty
 * digits.
 */
function decimalOf(x: number): Decimal {
  const text = String(Math.abs(x));
  const [mantissa = "", exponentText] = text.split("e");
  const [whole = "", fraction = ""] = mantissa.split(".");
  const digits = (whole + fraction).replace(/^0+/, "");
  if (digits === "") return { neg: false, digits: "", exp: 0 };
  const significant = digits.replace(/0+$/, "");
  const exp =
    (exponentText === undefined ? 0 : Number(exponentText)) -
    fraction.length +
    (digits.length - significant.length);
  return { neg: x < 0, digits: significant, exp };
}

/** Compares two non-JSON bodies line by line. Lines are split on "\n". */
function lineChanges(was: string, now: string, out: Change[]): void {
  const before = was.split("\n");
  const after = now.split("\n");
  const shared = Math.min(before.length, after.length);
  for (let i = 0; i < shared; i += 1) {
    const x = before[i];
    const y = after[i];
    if (x !== undefined && y !== undefined && x !== y) {
      out.push({ path: `/line/${i + 1}`, kind: "value", was: x, now: y });
    }
  }
  if (before.length !== after.length) {
    out.push({ path: "/line", kind: "length", was: before.length, now: after.length });
  }
}

function diffValue(a: Json, b: Json, path: string, depth: number, sink: Sink): void {
  if (depth >= DIFF_MAX_DEPTH && (isContainer(a) || isContainer(b))) {
    // Checked before any type test, so the limit also applies when one side is a container and
    // the other is a scalar or a container of another kind. The subtrees are compared
    // iteratively, so no stack depth is used here.
    if (!sameJson(a, b)) {
      sink.others.push({ path, kind: "type", was: a, now: b, note: DEPTH_NOTE });
    }
    return;
  }
  if (typeName(a) !== typeName(b)) {
    sink.others.push({ path, kind: "type", was: a, now: b });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    diffArray(a, b, path, depth, sink);
    return;
  }
  if (isObject(a) && isObject(b)) {
    diffObject(a, b, path, depth, sink);
    return;
  }
  if (a !== b) {
    sink.others.push({ path, kind: "value", was: a, now: b });
  }
}

function diffObject(a: JsonObject, b: JsonObject, path: string, depth: number, sink: Sink): void {
  for (const key of Object.keys(a)) {
    const childPath = path + "/" + escapeToken(key);
    if (!hasOwn(b, key)) {
      sink.removed.push({
        change: { path: childPath, kind: "removed", was: own(a, key) },
        parent: path,
        key,
      });
    } else {
      diffValue(own(a, key), own(b, key), childPath, depth + 1, sink);
    }
  }
  for (const key of Object.keys(b)) {
    if (!hasOwn(a, key)) {
      sink.added.push({
        change: { path: path + "/" + escapeToken(key), kind: "added", now: own(b, key) },
        parent: path,
        key,
      });
    }
  }
}

function diffArray(a: Json[], b: Json[], path: string, depth: number, sink: Sink): void {
  if (a.length !== b.length) {
    sink.others.push({ path, kind: "length", was: a.length, now: b.length });
  }
  const idA = idKeyOf(a);
  const idB = idKeyOf(b);
  const name = matchName(a, b, idA, idB);
  if (name !== undefined) {
    diffKeyed(a, b, name, path, depth, sink);
  } else {
    diffByIndex(a, b, path, depth, sink);
  }
}

/**
 * The key name used to match two arrays, or undefined when they are not matched by key. The
 * names must be equal when both arrays have an Id_Key. An empty array matches the Id_Key of the
 * other array.
 */
function matchName(a: Json[], b: Json[], idA: string | undefined, idB: string | undefined): string | undefined {
  if (idA !== undefined && idB !== undefined) return idA === idB ? idA : undefined;
  if (a.length === 0) return idB;
  if (b.length === 0) return idA;
  return undefined;
}

/** Matches elements by the string form of their key value. */
function diffKeyed(a: Json[], b: Json[], name: string, path: string, depth: number, sink: Sink): void {
  const keysA = a.map((element) => keyOf(element, name));
  const keysB = b.map((element) => keyOf(element, name));
  const byKeyA = new Map<string, Json>();
  const byKeyB = new Map<string, Json>();
  keysA.forEach((key, i) => byKeyA.set(key, a[i] as Json));
  keysB.forEach((key, i) => byKeyB.set(key, b[i] as Json));

  keysA.forEach((key, i) => {
    const element = a[i] as Json;
    const childPath = path + "/" + escapeToken(key);
    const counterpart = byKeyB.get(key);
    if (counterpart === undefined) {
      sink.removed.push({ change: { path: childPath, kind: "removed", was: element }, parent: path, key });
    } else {
      diffValue(element, counterpart, childPath, depth + 1, sink);
    }
  });
  keysB.forEach((key, i) => {
    if (!byKeyA.has(key)) {
      sink.added.push({
        change: { path: path + "/" + escapeToken(key), kind: "added", now: b[i] as Json },
        parent: path,
        key,
      });
    }
  });

  const commonA = keysA.filter((key) => byKeyB.has(key));
  const commonB = keysB.filter((key) => byKeyA.has(key));
  if (!sameSequence(commonA, commonB)) {
    sink.others.push({ path, kind: "value", was: commonA, now: commonB });
  }
}

/** Compares elements index by index. Elements beyond the shorter length are removed or added. */
function diffByIndex(a: Json[], b: Json[], path: string, depth: number, sink: Sink): void {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    diffValue(a[i] as Json, b[i] as Json, `${path}/${i}`, depth + 1, sink);
  }
  for (let i = shared; i < a.length; i += 1) {
    sink.removed.push({
      change: { path: `${path}/${i}`, kind: "removed", was: a[i] as Json },
      parent: path,
      key: String(i),
    });
  }
  for (let i = shared; i < b.length; i += 1) {
    sink.added.push({
      change: { path: `${path}/${i}`, kind: "added", now: b[i] as Json },
      parent: path,
      key: String(i),
    });
  }
}

/** The string form of an element's key value. Only called after idKeyOf validated the key. */
function keyOf(element: Json, name: string): string {
  return isObject(element) ? String(own(element, name)) : "";
}

/** RFC 6901 escaping: `~` becomes `~0` first, then `/` becomes `~1`. */
function escapeToken(key: string): string {
  return key.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Deep equality of two JSON values with an explicit stack, so the depth of the values does not
 * affect the call stack. Key order is ignored.
 */
function sameJson(first: Json, second: Json): boolean {
  const stack: [Json, Json][] = [[first, second]];
  for (let pair = stack.pop(); pair !== undefined; pair = stack.pop()) {
    const [x, y] = pair;
    if (Array.isArray(x)) {
      if (!Array.isArray(y) || x.length !== y.length) return false;
      for (let i = 0; i < x.length; i += 1) stack.push([x[i] as Json, y[i] as Json]);
    } else if (isObject(x)) {
      if (!isObject(y)) return false;
      const keys = Object.keys(x);
      if (keys.length !== Object.keys(y).length) return false;
      for (const key of keys) {
        if (!hasOwn(y, key)) return false;
        stack.push([own(x, key), own(y, key)]);
      }
    } else if (x !== y) {
      return false;
    }
  }
  return true;
}

function sameSequence(x: string[], y: string[]): boolean {
  return x.length === y.length && x.every((value, i) => value === y[i]);
}

function typeName(v: Json): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "object") return "object";
  return typeof v;
}

function isObject(v: Json): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isContainer(v: Json): boolean {
  return typeof v === "object" && v !== null;
}

function hasOwn(target: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

/** Value of an own key, read through the descriptor so that "__proto__" is an ordinary key. */
function own(target: JsonObject, key: string): Json {
  return Object.getOwnPropertyDescriptor(target, key)?.value as Json;
}

function compareText(x: string, y: string): number {
  if (x === y) return 0;
  return x < y ? -1 : 1;
}

function compareChanges(x: Change, y: Change): number {
  if (x.path !== y.path) return compareText(x.path, y.path);
  return KIND_RANK[x.kind] - KIND_RANK[y.kind];
}
