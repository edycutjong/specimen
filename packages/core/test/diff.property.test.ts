import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Change,
  type Json,
  type VolatilePolicy,
  diff,
  idKeyOf,
  normalize,
} from "../src/index.js";

type Obj = { [k: string]: Json };

const RUNS = { numRuns: 200 };
const DEEP_RUNS = { numRuns: 100 };
const EMPTY: VolatilePolicy = { volatile: [] };
const ESCAPED_POINTER = /^(\/([^/~]|~[01])*)*$/;
const KIND_ORDER = ["removed", "added", "value", "type", "length"];

// ---------------------------------------------------------------------------
// Helpers. Objects are built with defineProperty so that "__proto__" stays an own key.
// ---------------------------------------------------------------------------

function makeObject(entries: readonly (readonly [string, Json])[]): Obj {
  const out: Obj = {};
  for (const [key, value] of new Map(entries)) {
    Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

function ownValue(target: Obj, key: string): Json {
  return Object.getOwnPropertyDescriptor(target, key)?.value as Json;
}

function hasOwnKey(target: Obj, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(target, key);
}

function isObj(value: Json): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Independent RFC 6901 escaping of one reference token. */
function escapeToken(token: string): string {
  return token.split("~").join("~0").split("/").join("~1");
}

/** Deep copy through the JSON text, so the copy shares no reference with the original. */
function clone(value: Json): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

/** Path lookup on one Body. Keyed arrays are matched by key value, other arrays by index. */
function resolvePointer(root: Json, pointer: string): { found: boolean; value?: Json } {
  if (pointer === "") return { found: true, value: root };
  let node: Json = root;
  for (const escaped of pointer.slice(1).split("/")) {
    const token = escaped.split("~1").join("/").split("~0").join("~");
    if (Array.isArray(node)) {
      const idKey = idKeyOf(node);
      const keyed =
        idKey === undefined
          ? -1
          : node.findIndex((element) => isObj(element) && String(ownValue(element, idKey)) === token);
      const index = /^(0|[1-9][0-9]*)$/.test(token) ? Number(token) : -1;
      const position = keyed >= 0 ? keyed : index >= 0 && index < node.length ? index : -1;
      if (position < 0) return { found: false };
      node = node[position] as Json;
    } else if (isObj(node)) {
      if (!hasOwnKey(node, token)) return { found: false };
      node = ownValue(node, token);
    } else {
      return { found: false };
    }
  }
  return { found: true, value: node };
}

function sortChanges(changes: Change[]): Change[] {
  return changes.slice().sort((x, y) => {
    if (x.path !== y.path) return x.path < y.path ? -1 : 1;
    return KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind);
  });
}

/** Checks the kind rules of Requirement 4.1, 4.2 to 4.6 and 4.19 for every Change. */
function expectKindRules(was: Json, now: Json, changes: Change[]): void {
  for (const change of changes) {
    expect(change.path).toMatch(ESCAPED_POINTER);
    const inWas = resolvePointer(was, change.path);
    const inNow = resolvePointer(now, change.path);
    if (change.kind === "removed") {
      expect(inWas.found).toBe(true);
      expect(inNow.found).toBe(false);
    } else if (change.kind === "added") {
      expect(inWas.found).toBe(false);
      expect(inNow.found).toBe(true);
    } else if (change.kind === "length") {
      expect(Array.isArray(inWas.value)).toBe(true);
      expect(Array.isArray(inNow.value)).toBe(true);
      expect(change.was).toBe((inWas.value as Json[]).length);
      expect(change.now).toBe((inNow.value as Json[]).length);
      expect(change.was).not.toBe(change.now);
    } else {
      expect(inWas.found && inNow.found).toBe(true);
    }
  }
}

// ---------------------------------------------------------------------------
// Generators. Generic object keys never include "id" or a "*_id" name, so generic arrays
// have no Id_Key. Keyed arrays use the "k-" prefix, so their key values never look like an
// array index. Both choices keep the path lookup above unambiguous.
// ---------------------------------------------------------------------------

const KEY = fc.constantFrom("a", "b", "c", "created_at", "__proto__", "constructor", "x/y", "t~l", "0", "1");

const scalarArb: fc.Arbitrary<Json> = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer({ min: -999, max: 999 }),
  fc.integer({ min: -999, max: 999 }).map((n) => n / 100),
  fc.constantFrom("", "x", "100", "425.00", "a/b", "t~1"),
);

/** Array of objects that all carry the same Id_Key `id` with unique "k-" values. */
function keyedArrayArb(depth: number): fc.Arbitrary<Json> {
  return fc.uniqueArray(fc.string({ maxLength: 6 }), { maxLength: 4 }).chain((ids) =>
    fc
      .tuple(...ids.map(() => fc.array(fc.tuple(KEY, valueArb(depth - 1)), { maxLength: 3 })))
      .map((rows) => rows.map((entries, i) => makeObject([["id", `k-${ids[i] ?? ""}`], ...entries]))),
  );
}

function objectArb(depth: number): fc.Arbitrary<Json> {
  return fc
    .array(fc.tuple(KEY, valueArb(depth - 1)), { maxLength: 4 })
    .map((entries) => makeObject(entries));
}

function arrayArb(depth: number): fc.Arbitrary<Json> {
  return fc.array(valueArb(depth - 1), { maxLength: 4 });
}

function valueArb(depth: number): fc.Arbitrary<Json> {
  if (depth <= 0) return scalarArb;
  return fc.oneof(scalarArb, objectArb(depth), arrayArb(depth), keyedArrayArb(depth));
}

const containerArb: fc.Arbitrary<Json> = fc.oneof(objectArb(3), arrayArb(3), keyedArrayArb(3));

/** Two objects that share most keys, so that matched members are compared. */
const sharedKeyPairArb: fc.Arbitrary<[Json, Json]> = objectArb(3).chain((first) => {
  const keys = Object.keys(first as Obj);
  return fc
    .record({
      keep: fc.array(fc.boolean(), { minLength: keys.length, maxLength: keys.length }),
      values: fc.array(valueArb(2), { minLength: keys.length, maxLength: keys.length }),
      extras: objectArb(2),
    })
    .map(({ keep, values, extras }) => {
      const entries: [string, Json][] = keys.flatMap((key, i) =>
        keep[i] ? [[key, values[i] as Json] as [string, Json]] : [],
      );
      const extraEntries = Object.keys(extras as Obj).map((key): [string, Json] => [
        key,
        ownValue(extras as Obj, key),
      ]);
      return [first as Json, makeObject([...entries, ...extraEntries])];
    });
});

const pairArb: fc.Arbitrary<[Json, Json]> = fc.oneof(
  fc.tuple(containerArb, containerArb),
  sharedKeyPairArb,
);

// ---------------------------------------------------------------------------
// Property 7
// ---------------------------------------------------------------------------

describe("diff property tests", () => {
  // Feature: replay-engine, Property 7: Structural diff is identity-preserving, deterministic, and locates every field-level difference
  it("Property 7: Structural diff is identity-preserving, deterministic, and locates every field-level difference", () => {
    // Identity: diffing a value against itself, or against a deep copy, yields nothing.
    fc.assert(
      fc.property(valueArb(3), (value) => {
        expect(diff(value, value)).toEqual([]);
        expect(diff(value, clone(value))).toEqual([]);
      }),
      RUNS,
    );

    // Determinism and invariant: two calls agree, and every Change obeys the kind rules.
    fc.assert(
      fc.property(pairArb, ([was, now]) => {
        const first = diff(was, now);
        expect(diff(was, now)).toEqual(first);
        expect(sortChanges(first)).toEqual(first);
        expectKindRules(was, now, first);
      }),
      RUNS,
    );

    // Location: one mutation of one member yields exactly one Change at that member's path.
    const mutationArb = fc.tuple(objectArb(3), fc.nat(), fc.constantFrom("remove", "add", "change"));
    fc.assert(
      fc.property(mutationArb, ([object, pick, action]) => {
        const was = object as Obj;
        const keys = Object.keys(was);
        let now: Obj;
        let expected: Change;

        if (action === "add" || keys.length === 0) {
          const key = "new_key/~";
          now = makeObject([...entriesOf(was), [key, "added"]]);
          expected = { path: "/" + escapeToken(key), kind: "added", now: "added" };
        } else {
          const key = keys[pick % keys.length] as string;
          const current = ownValue(was, key);
          if (action === "remove") {
            now = makeObject(entriesOf(was).filter(([k]) => k !== key));
            expected = { path: "/" + escapeToken(key), kind: "removed", was: current };
          } else if (typeof current === "boolean") {
            now = makeObject(replaceEntry(was, key, !current));
            expected = { path: "/" + escapeToken(key), kind: "value", was: current, now: !current };
          } else if (typeof current === "number") {
            now = makeObject(replaceEntry(was, key, current + 1));
            expected = { path: "/" + escapeToken(key), kind: "value", was: current, now: current + 1 };
          } else if (typeof current === "string") {
            now = makeObject(replaceEntry(was, key, current + "!"));
            expected = { path: "/" + escapeToken(key), kind: "value", was: current, now: current + "!" };
          } else {
            now = makeObject(replaceEntry(was, key, 1));
            expected = { path: "/" + escapeToken(key), kind: "type", was: current, now: 1 };
          }
        }

        expect(diff(was, now)).toEqual([expected]);
      }),
      RUNS,
    );
  });

  // Feature: replay-engine, Property 9: Id_Key array matching reports stable per-element changes and one length Change
  it("Property 9: Id_Key array matching reports stable per-element changes and one length Change", () => {
    const idValueArb = fc.oneof(fc.integer({ min: 0, max: 9 }), fc.string({ maxLength: 4 }));
    const scenarioArb = fc.record({
      idName: fc.constantFrom("id", "booking_id"),
      ids: fc.uniqueArray(idValueArb, { selector: (value) => String(value), maxLength: 9 }),
      baseCount: fc.nat(9),
      keep: fc.array(fc.boolean(), { minLength: 9, maxLength: 9 }),
      changed: fc.array(fc.boolean(), { minLength: 9, maxLength: 9 }),
      fields: fc.array(fc.string({ maxLength: 3 }), { minLength: 9, maxLength: 9 }),
    });

    // Matching by key: removals, additions and field edits, with the length Change exactly when
    // the lengths differ. An empty array on either side is covered by the same rules.
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const { idName, ids, keep, changed, fields } = scenario;
        const baseCount = Math.min(scenario.baseCount, ids.length);
        const base = ids.slice(0, baseCount);
        const extra = ids.slice(baseCount);
        const element = (id: Json, field: string): Json =>
          makeObject([
            [idName, id],
            ["room_id", "r-1"],
            ["field", field],
          ]);

        const was: Obj = { items: base.map((id, i) => element(id, fields[i] ?? "")) };
        const kept = base.flatMap((id, i) => (keep[i] ? [[id, i] as const] : []));
        const nowItems: Json[] = [
          ...kept.map(([id, i]) => {
            const field = changed[i] ? `${fields[i] ?? ""}!` : (fields[i] ?? "");
            return element(id, field);
          }),
          ...extra.map((id) => element(id, "new")),
        ];
        const now: Obj = { items: nowItems };

        const path = (id: Json) => `/items/${escapeToken(String(id))}`;
        const expected: Change[] = [];
        base.forEach((id, i) => {
          if (!keep[i]) {
            expected.push({ path: path(id), kind: "removed", was: (was.items as Json[])[i] as Json });
          }
        });
        kept.forEach(([id, i]) => {
          if (changed[i]) {
            expected.push({
              path: `${path(id)}/field`,
              kind: "value",
              was: fields[i] ?? "",
              now: `${fields[i] ?? ""}!`,
            });
          }
        });
        extra.forEach((id) => expected.push({ path: path(id), kind: "added", now: element(id, "new") }));
        if (base.length !== nowItems.length) {
          expected.push({ path: "/items", kind: "length", was: base.length, now: nowItems.length });
        }

        expect(diff(was, now)).toEqual(sortChanges(expected));
      }),
      RUNS,
    );

    // Reordering: the same elements in another order give one value Change at the array path
    // with the two ordered key lists.
    fc.assert(
      fc.property(
        fc
          .uniqueArray(idValueArb, { selector: (value) => String(value), minLength: 2, maxLength: 6 })
          .chain((ids) =>
            fc.tuple(
              fc.constant(ids),
              fc.shuffledSubarray(ids, { minLength: ids.length, maxLength: ids.length }),
            ),
          ),
        ([ids, order]) => {
          const element = (id: Json): Json => makeObject([["booking_id", id], ["room_id", "r-1"]]);
          const was: Obj = { items: ids.map(element) };
          const now: Obj = { items: order.map(element) };
          const idsWas = ids.map((id) => String(id));
          const idsNow = order.map((id) => String(id));
          const reordered = idsWas.some((value, i) => value !== idsNow[i]);
          expect(diff(was, now)).toEqual(
            reordered ? [{ path: "/items", kind: "value", was: idsWas, now: idsNow }] : [],
          );
        },
      ),
      RUNS,
    );

    // No shared Id_Key name: elements are compared by index, so no Change names an element key.
    // Both arrays are non-empty, because an empty array matches by the other side's Id_Key.
    const plainArb = fc.tuple(
      fc.array(fc.string({ maxLength: 3 }), { minLength: 1, maxLength: 5 }),
      fc.array(fc.string({ maxLength: 3 }), { minLength: 1, maxLength: 5 }),
    );
    fc.assert(
      fc.property(plainArb, ([left, right]) => {
        const was: Obj = { items: left.map((value, i) => makeObject([["id", `k-${i}`], ["field", value]])) };
        const now: Obj = {
          items: right.map((value, i) => makeObject([["booking_id", `k-${i}`], ["field", value]])),
        };
        const changes = diff(was, now);
        for (const change of changes) {
          expect(change.path === "/items" || /^\/items\/[0-9]+(\/|$)/.test(change.path)).toBe(true);
        }
        const lengthChanges = changes.filter((change) => change.kind === "length");
        expect(lengthChanges.length).toBe(left.length === right.length ? 0 : 1);
      }),
      RUNS,
    );
  });

  // Feature: replay-engine, Property 26: Deeply nested bodies are bounded, not stack-overflowing
  it("Property 26: Deeply nested bodies are bounded, not stack-overflowing", () => {
    const depthArb = fc.integer({ min: 1001, max: 1010 });
    const parityArb = fc.constantFrom(0, 1);

    // A chain of `levels` containers around `leaf`. Parity picks arrays or objects at each level,
    // and the object keys are "__proto__" and "constructor".
    const nest = (levels: number, leaf: Json, parity: number): Json => {
      let node: Json = leaf;
      for (let level = levels - 1; level >= 0; level -= 1) {
        node =
          (level + parity) % 2 === 0
            ? [node]
            : makeObject([[level % 2 === 0 ? "__proto__" : "constructor", node]]);
      }
      return node;
    };

    // Identical deep values, each built separately, produce no Change and the normalise call
    // reports the limit without throwing.
    fc.assert(
      fc.property(depthArb, parityArb, (depth, parity) => {
        expect(diff(nest(depth, 1, parity), nest(depth, 1, parity))).toEqual([]);
        expect(normalize(nest(depth, 1, parity), EMPTY).depthLimited).toBe(true);
      }),
      DEEP_RUNS,
    );

    // Different leaves beyond the limit: one type Change with the depth note at the path of the
    // container where the limit was reached (1000 segments).
    fc.assert(
      fc.property(depthArb, parityArb, (depth, parity) => {
        const changes = diff(nest(depth, 1, parity), nest(depth, 2, parity));
        expect(changes.length).toBe(1);
        const [change] = changes as [Change];
        expect(change.kind).toBe("type");
        expect(change.note).toBe("depth limit 1000");
        expect(change.path.split("/").length - 1).toBe(1000);
      }),
      DEEP_RUNS,
    );

    // A deep container on one side and a scalar on the other, at the limit: the same single
    // type Change with the depth note. The side that holds the scalar is either side.
    fc.assert(
      fc.property(depthArb, parityArb, fc.boolean(), (depth, parity, deepIsFirst) => {
        const deep = nest(depth, 1, parity);
        const shallow = nest(1000, "x", parity);
        const changes = deepIsFirst ? diff(deep, shallow) : diff(shallow, deep);
        expect(changes.length).toBe(1);
        const [change] = changes as [Change];
        expect(change.kind).toBe("type");
        expect(change.note).toBe("depth limit 1000");
        expect(change.path.split("/").length - 1).toBe(1000);
      }),
      DEEP_RUNS,
    );

    // "__proto__" and "constructor" are ordinary keys in the diff.
    expect(diff(makeObject([["__proto__", { x: 1 }]]), makeObject([["constructor", 1]]))).toEqual([
      { path: "/__proto__", kind: "removed", was: { x: 1 } },
      { path: "/constructor", kind: "added", now: 1 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Small helpers used by the mutation check.
// ---------------------------------------------------------------------------

function entriesOf(object: Obj): [string, Json][] {
  return Object.keys(object).map((key): [string, Json] => [key, ownValue(object, key)]);
}

function replaceEntry(object: Obj, key: string, value: Json): [string, Json][] {
  return entriesOf(object).map(([k, v]): [string, Json] => (k === key ? [k, value] : [k, v]));
}
