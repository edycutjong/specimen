import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Change, type Json, diff, idKeyOf } from "../src/index.js";

const RUNS = { numRuns: 200 };

/** The rename note the design gives for a removed path and a factor of 10^n. */
function renameNote(removedPath: string, n: number): string {
  return `suspected rename from ${removedPath} ×${"1" + "0".repeat(n)}`;
}

function notesOf(changes: Change[]): string[] {
  return changes.flatMap((change) => (change.note === undefined ? [] : [change.note]));
}

describe("diff rename suspicion (property)", () => {
  // Feature: replay-engine, Property 8: Rename suspicion fires only for a matching numeric stem and factor, never otherwise
  it("annotates an added sibling only when stem, numeric value and factor 10^n (n from 1 to 3) all match", () => {
    const stem = fc.stringMatching(/^[a-z]{1,6}$/);
    const suffix = fc.stringMatching(/^[a-z]{1,4}$/);
    const was = fc.integer({ min: 1, max: 99999 });
    const n = fc.integer({ min: 0, max: 4 });

    fc.assert(
      fc.property(stem, suffix, was, n, (s, sfx, w, k) => {
        const factor = w * 10 ** k;
        const removedKey = s;
        const matchingKey = `${s}_${sfx}`;
        const expectNote = k >= 1 && k <= 3;

        // Matching stem and factor: the note fires only for n in 1..3.
        const matched = diff({ [removedKey]: w } as Json, { [matchingKey]: factor } as Json);
        const matchedNotes = notesOf(matched);
        if (expectNote) {
          expect(matchedNotes).toEqual([renameNote(`/${removedKey}`, k)]);
        } else {
          expect(matchedNotes).toEqual([]);
        }

        // Different stem with the same factor: never a note.
        const otherKey = `${s}z_${sfx}`;
        expect(notesOf(diff({ [removedKey]: w } as Json, { [otherKey]: factor } as Json))).toEqual([]);

        // Same stem, but the value is a string: never a note.
        const stringy = diff({ [removedKey]: w } as Json, { [matchingKey]: String(factor) } as Json);
        expect(notesOf(stringy)).toEqual([]);

        // Same stem, a numeric value that is not w times 10^n: never a note.
        const off = diff({ [removedKey]: w } as Json, { [matchingKey]: factor + 1 } as Json);
        expect(notesOf(off)).toEqual([]);
      }),
      RUNS,
    );
  });
});

describe("diff rename suspicion fixtures", () => {
  it("negative: the number 100 against the string \"100\" at one path is one type Change with no note", () => {
    const changes = diff({ amount: 100 } as Json, { amount: "100" } as Json);
    expect(changes).toEqual([{ path: "/amount", kind: "type", was: 100, now: "100" }]);
    expect(notesOf(changes)).toEqual([]);
  });

  it("negative: a removed numeric path and an added string sibling of the same stem add no note", () => {
    const changes = diff({ total: 425 } as Json, { total_cents: "42500" } as Json);
    expect(changes).toEqual([
      { path: "/total", kind: "removed", was: 425 },
      { path: "/total_cents", kind: "added", now: "42500" },
    ]);
    expect(notesOf(changes)).toEqual([]);
  });

  it("negative: unrelated stems total and tax_cents whose values differ by 10^n add no note", () => {
    const changes = diff({ total: 425 } as Json, { tax_cents: 42500 } as Json);
    expect(changes).toEqual([
      { path: "/tax_cents", kind: "added", now: 42500 },
      { path: "/total", kind: "removed", was: 425 },
    ]);
    expect(notesOf(changes)).toEqual([]);
  });

  it("positive: /total 425 against /total_cents 42500 notes suspected rename from /total ×100", () => {
    const changes = diff({ total: 425 } as Json, { total_cents: 42500 } as Json);
    expect(changes).toEqual([
      { path: "/total", kind: "removed", was: 425 },
      { path: "/total_cents", kind: "added", now: 42500, note: "suspected rename from /total ×100" },
    ]);
  });

  it("positive: was 4.35 against now 435 notes ×100 through exact decimal arithmetic", () => {
    const changes = diff({ total: 4.35 } as Json, { total_cents: 435 } as Json);
    expect(notesOf(changes)).toEqual(["suspected rename from /total ×100"]);
  });

  it("positive: two candidates for one removed path annotate only the lowest n", () => {
    // total_tenths is 425 × 10 (n = 1). total_cents is 425 × 100 (n = 2).
    const changes = diff(
      { total: 425 } as Json,
      { total_cents: 42500, total_tenths: 4250 } as Json,
    );
    const annotated = changes.filter((change) => change.note !== undefined);
    expect(annotated).toEqual([
      {
        path: "/total_tenths",
        kind: "added",
        now: 4250,
        note: "suspected rename from /total ×10",
      },
    ]);
    const cents = changes.find((change) => change.path === "/total_cents");
    expect(cents?.note).toBeUndefined();
  });
});

describe("diff Id_Key arrays", () => {
  it("reports a dropped element by its key together with one length Change", () => {
    const a = { rooms: [{ id: "r-07", beds: 2 }, { id: "r-08", beds: 1 }] } as Json;
    const b = { rooms: [{ id: "r-07", beds: 2 }] } as Json;
    expect(diff(a, b)).toEqual([
      { path: "/rooms", kind: "length", was: 2, now: 1 },
      { path: "/rooms/r-08", kind: "removed", was: { id: "r-08", beds: 1 } },
    ]);
  });

  it("reports a reordered Id_Key-matched array as one value Change with the two key lists", () => {
    const a = { rooms: [{ id: "a", n: 1 }, { id: "b", n: 2 }] } as Json;
    const b = { rooms: [{ id: "b", n: 2 }, { id: "a", n: 1 }] } as Json;
    expect(diff(a, b)).toEqual([
      { path: "/rooms", kind: "value", was: ["a", "b"], now: ["b", "a"] },
    ]);
  });

  it("gives no id key when 1 and \"1\" collide by string form", () => {
    expect(idKeyOf([{ id: 1 }, { id: "1" }])).toBeUndefined();
    expect(idKeyOf([{ id: 1 }, { id: 2 }])).toBe("id");
  });

  it("falls back to index by index when the colliding key is not an Id_Key", () => {
    const a = [{ id: 1, v: 1 }, { id: "1", v: 1 }] as Json;
    const b = [{ id: 1, v: 2 }, { id: "1", v: 1 }] as Json;
    expect(diff({ items: a } as Json, { items: b } as Json)).toEqual([
      { path: "/items/0/v", kind: "value", was: 1, now: 2 },
    ]);
  });

  it("picks the lowest *_id key, so booking_id wins over room_id", () => {
    const elements = [
      { booking_id: "b1", room_id: "r1" },
      { booking_id: "b2", room_id: "r1" },
    ] as Json[];
    expect(idKeyOf(elements)).toBe("booking_id");

    const a = { items: elements } as Json;
    const b = { items: [elements[0]] } as Json;
    expect(diff(a, b)).toEqual([
      { path: "/items", kind: "length", was: 2, now: 1 },
      { path: "/items/b2", kind: "removed", was: { booking_id: "b2", room_id: "r1" } },
    ]);
  });

  it("falls back to index by index when the two arrays use different Id_Key names", () => {
    const a = { items: [{ id: "x", n: 1 }] } as Json;
    const b = { items: [{ booking_id: "x", n: 2 }] } as Json;
    const paths = diff(a, b).map((change) => change.path);
    expect(paths.every((path) => path.startsWith("/items/0/"))).toBe(true);
    expect(diff(a, b).some((change) => change.kind === "length")).toBe(false);
  });

  it("matches an empty array against an Id_Key array by key", () => {
    expect(diff({ rooms: [] } as Json, { rooms: [{ id: "r-01" }] } as Json)).toEqual([
      { path: "/rooms", kind: "length", was: 0, now: 1 },
      { path: "/rooms/r-01", kind: "added", now: { id: "r-01" } },
    ]);
    expect(diff({ rooms: [{ id: "r-01" }] } as Json, { rooms: [] } as Json)).toEqual([
      { path: "/rooms", kind: "length", was: 1, now: 0 },
      { path: "/rooms/r-01", kind: "removed", was: { id: "r-01" } },
    ]);
  });
});
