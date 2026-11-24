import { describe, expect, it } from "vitest";
import { type Json, diff } from "../src/index.js";

// Smoke tests: one example per Change kind plus the rename note, so the module is exercised.
// The property and fixture tests for the diff are written by tasks 2.4 and 2.5.
describe("diff smoke", () => {
  it("reports a removed member with its jarred value", () => {
    expect(diff({ a: 1, b: 2 }, { a: 1 })).toEqual([{ path: "/b", kind: "removed", was: 2 }]);
  });

  it("reports an added member with its replayed value", () => {
    expect(diff({ a: 1 }, { a: 1, c: "x" })).toEqual([{ path: "/c", kind: "added", now: "x" }]);
  });

  it("reports a value change for two scalars of one type", () => {
    expect(diff({ a: 1 }, { a: 2 })).toEqual([{ path: "/a", kind: "value", was: 1, now: 2 }]);
  });

  it("reports a type change without descending when the types differ", () => {
    expect(diff({ a: 100 }, { a: "100" })).toEqual([{ path: "/a", kind: "type", was: 100, now: "100" }]);
  });

  it("reports a length change for arrays of different lengths", () => {
    expect(diff([1, 2], [1])).toEqual([
      { path: "", kind: "length", was: 2, now: 1 },
      { path: "/1", kind: "removed", was: 2 },
    ]);
  });

  it("annotates an added sibling with a rename note for a power-of-ten factor", () => {
    const changes = diff({ total: 425 } as Json, { total_cents: 42500 } as Json);
    expect(changes).toEqual([
      { path: "/total", kind: "removed", was: 425 },
      { path: "/total_cents", kind: "added", now: 42500, note: "suspected rename from /total ×100" },
    ]);
  });
});
