import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type Change,
  type Json,
  type ReferenceElement,
  type ResultEntry,
  diff,
  referenceOf,
  referenceSubstrings,
} from "../src/index.js";

const RUNS = { numRuns: 200 };

/** A ResultEntry with the fields the Reference reads, and neutral values for the rest. */
function entryOf(overrides: Partial<ResultEntry> & Pick<ResultEntry, "changes">): ResultEntry {
  return {
    id: "SPC-0001",
    session_id: "s1",
    seq: 1,
    tool: "quote",
    state: "rattled",
    input: null,
    response_text: null,
    compatible: [],
    ignored: [],
    replayed_text: null,
    replayed: null,
    ms: 0,
    ...overrides,
  };
}

/** The changes of a real diff between a jarred JSON text and a replayed JSON text. */
function changesBetween(jarred: string, replayed: string): Change[] {
  return diff(JSON.parse(jarred) as Json, JSON.parse(replayed) as Json);
}

/** True when a Section text contains every substring of every element. */
function sectionAccepts(section: string, ref: ReferenceElement[]): boolean {
  return ref.every((element) => referenceSubstrings(element).every((s) => section.includes(s)));
}

const numberLiteral = fc
  .record({
    negative: fc.boolean(),
    whole: fc.integer({ min: 0, max: 9999 }),
    decimals: fc.stringMatching(/^[0-9]{0,3}$/),
  })
  .map(({ negative, whole, decimals }) => {
    const sign = negative ? "-" : "";
    return decimals === "" ? `${sign}${whole}` : `${sign}${whole}.${decimals}`;
  });

describe("referenceOf and referenceSubstrings", () => {
  // Feature: replay-engine, Property 23: The Reference is derived only from the Result_Entry and matched only by its exact elements
  it("Property 23: depends only on the derivation fields and accepts only the exact literal", () => {
    fc.assert(
      fc.property(numberLiteral, numberLiteral, fc.string({ maxLength: 12 }), (litA, litB, noise) => {
        const responseText = `{"a":${litA},"b":${litB},"c":"s"}`;
        const parsed = JSON.parse(responseText) as { a: number; b: number; c: string };
        const replayed = { a: parsed.a + 1, b: parsed.b, c: "s" };
        const changes = diff(parsed, replayed);
        const entry = entryOf({ changes, response_text: responseText });

        // Only changes, state, tool and response_text may affect the Reference.
        const noisy = entryOf({
          ...entry,
          id: "SPC-9999",
          session_id: `s-${noise}`,
          seq: 77,
          input: { noise },
          replayed_text: `{"a":${noise}}`,
          replayed: { a: noise },
          ignored: ["/created_at"],
          compatible: [{ path: "/extra", kind: "added", now: noise }],
          reason: noise,
          error: `secret ${noise}`,
          ms: 12,
        });
        expect(referenceOf(noisy)).toEqual(referenceOf(entry));

        // A cracked jar's Reference is its tool name, whatever the error text says.
        const cracked = entryOf({ ...entry, state: "cracked", error: `boom ${noise}` });
        expect(referenceOf(cracked)).toEqual([{ kind: "tool", tool: "quote" }]);

        // The literal of /a is copied from the jarred text, and only that rendering matches.
        const element = referenceOf(entry).find((ref) => ref.kind === "path-literal" && ref.path === "/a");
        expect(element).toEqual({ kind: "path-literal", path: "/a", literal: litA });
        expect(responseText.includes(litA)).toBe(true);

        const rendered = String(JSON.parse(litA) as number);
        expect(sectionAccepts(`/a ${litA}`, referenceOf(entry))).toBe(true);
        expect(sectionAccepts(`/a ${rendered}`, referenceOf(entry))).toBe(rendered === litA);
      }),
      RUNS,
    );
  });

  it("accepts 425.00 for /total and rejects the re-rendered 425", () => {
    const responseText = '{"room_id":"r-04","total":425.00}';
    const changes = changesBetween(responseText, '{"room_id":"r-04","total":430}');
    const ref = referenceOf(entryOf({ changes, response_text: responseText }));

    expect(ref).toEqual([{ kind: "path-literal", path: "/total", literal: "425.00" }]);
    expect(sectionAccepts("The total must be /total 425.00 again.", ref)).toBe(true);
    expect(sectionAccepts("The total must be /total 425 again.", ref)).toBe(false);
  });

  it("gives r-08 and r-09 as key elements next to a length Change, with no path or literal", () => {
    const responseText =
      '{"rooms":[{"id":"r-04","nightly":212.50},{"id":"r-08","nightly":99.00},{"id":"r-09","nightly":120.00}]}';
    const changes = changesBetween(responseText, '{"rooms":[{"id":"r-04","nightly":212.50}]}');
    expect(changes.map((c) => `${c.kind} ${c.path}`)).toEqual([
      "length /rooms",
      "removed /rooms/r-08",
      "removed /rooms/r-09",
    ]);

    const ref = referenceOf(entryOf({ changes, response_text: responseText }));
    expect(ref).toEqual([
      { kind: "key", key: "r-08" },
      { kind: "key", key: "r-09" },
    ]);
    expect(ref.flatMap(referenceSubstrings)).toEqual(["r-08", "r-09"]);
  });

  it("gives the tool name for a cracked jar whose tool is missing and for an Error_Result without error text", () => {
    const missing = entryOf({
      changes: [],
      tool: "cancel_booking",
      state: "cracked",
      response_text: '{"ok":true}',
      error: "tool not in tools/list",
    });
    expect(referenceOf(missing)).toEqual([{ kind: "tool", tool: "cancel_booking" }]);

    const errorResult = entryOf({
      changes: [],
      tool: "book_room",
      state: "cracked",
      response_text: '{"ok":true}',
    });
    expect(referenceOf(errorResult)).toEqual([{ kind: "tool", tool: "book_room" }]);
  });

  it("gives the path and the jarred line for a value Change at /line/<n> of a non-JSON Body", () => {
    const responseText = "alpha\nbeta\ngamma";
    const changes = diff("alpha\nbeta\ngamma", "alpha\nBETA\ngamma");
    const ref = referenceOf(entryOf({ changes, response_text: responseText }));
    expect(ref).toEqual([{ kind: "path-literal", path: "/line/2", literal: "beta" }]);
  });

  it("gives /response_text with the jarred sha256 text for a Hashed_Jar", () => {
    const jarredHash = `sha256:${"a".repeat(64)}`;
    const replayedHash = `sha256:${"b".repeat(64)}`;
    const changes: Change[] = [
      { path: "/response_text", kind: "value", was: jarredHash, now: replayedHash },
    ];
    const ref = referenceOf(entryOf({ changes, response_text: jarredHash }));
    expect(ref).toEqual([{ kind: "path-literal", path: "/response_text", literal: jarredHash }]);
  });

  it("resolves an Id_Key path segment to the element with that key value", () => {
    const responseText =
      '{"rooms":[{"id":"r-04","price":10.50},{"id":"r-08","price":7.00}]}';
    const changes = changesBetween(responseText, '{"rooms":[{"id":"r-04","price":10.50},{"id":"r-08","price":8}]}');
    const ref = referenceOf(entryOf({ changes, response_text: responseText }));
    expect(ref).toEqual([{ kind: "path-literal", path: "/rooms/r-08/price", literal: "7.00" }]);
  });

  it("gives the tool name for a type Change of the whole Body and the path for an added field", () => {
    const whole = referenceOf(
      entryOf({
        changes: diff({ a: 1 }, "plain text") as Change[],
        response_text: '{"a":1}',
        tool: "quote",
      }),
    );
    expect(whole).toEqual([{ kind: "tool", tool: "quote" }]);

    const added = referenceOf(
      entryOf({
        changes: [{ path: "/total_cents", kind: "added", now: 42500 }],
        response_text: '{"total":425.00}',
      }),
    );
    expect(added).toEqual([{ kind: "path", path: "/total_cents" }]);
  });

  it("returns no element for a jar with no Change", () => {
    expect(referenceOf(entryOf({ changes: [], state: "preserved", response_text: "{}" }))).toEqual([]);
  });
});
