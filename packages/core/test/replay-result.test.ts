import { describe, expect, it } from "vitest";
import {
  type ReplayResult,
  type ResultEntry,
  buildReport,
  coverageString,
  quarantineFileSchema,
  replayResultSchema,
} from "../src/index.js";

const preserved: ResultEntry = {
  id: "SPC-0007",
  session_id: "4f1c9e",
  seq: 2,
  tool: "quote",
  state: "preserved",
  input: { room_id: "r-04", nights: 2 },
  response_text: '{"room_id":"r-04","nights":2,"total":425.00}',
  changes: [],
  compatible: [],
  ignored: ["/created_at"],
  replayed_text: '{"room_id":"r-04","nights":2,"total":425.00,"created_at":"2026-11-25T00:00:00Z"}',
  replayed: { room_id: "r-04", nights: 2, total: 425, created_at: "2026-11-25T00:00:00Z" },
  ms: 42,
};

const renamed: ResultEntry = {
  id: "SPC-0012",
  session_id: "9a01bb",
  seq: 1,
  tool: "quote",
  state: "rattled",
  input: { room_id: "r-04", nights: 2 },
  response_text: '{"room_id":"r-04","total":425.00}',
  changes: [
    {
      path: "/total_cents",
      kind: "added",
      now: 42500,
      note: "suspected rename from /total ×100",
    },
  ],
  compatible: [{ path: "/currency", kind: "added", now: "USD" }],
  ignored: [],
  replayed_text: '{"room_id":"r-04","total_cents":42500,"currency":"USD"}',
  replayed: { room_id: "r-04", total_cents: 42500, currency: "USD" },
  ms: 15,
};

const cracked: ResultEntry = {
  id: "SPC-0003",
  session_id: "9a01bb",
  seq: 2,
  tool: "cancel_booking",
  state: "cracked",
  input: { booking_id: "b-1" },
  response_text: '{"cancelled":true}',
  changes: [],
  compatible: [],
  ignored: [],
  replayed_text: null,
  replayed: null,
  reason: "tool not in tools/list",
  ms: 0,
};

const orphan: ResultEntry = {
  id: null,
  session_id: "c3d4",
  seq: 5,
  tool: "book_room",
  state: "unsealed",
  input: null,
  response_text: null,
  changes: [],
  compatible: [],
  ignored: [],
  replayed_text: null,
  replayed: null,
  reason: "orphan pre-event",
  ms: 0,
};

function result(overrides: Partial<ReplayResult>): ReplayResult {
  return {
    v: 1,
    server: "npx-tsx-servers-hollow-inn-src-main-ts-v2",
    started_at: "2026-11-25T00:00:00.000Z",
    strict: false,
    jars: [preserved, renamed, cracked, orphan],
    spoiled: [{ file: "jars/a.jsonl", line: 3, reason: "duplicate id" }],
    counts: { preserved: 1, rattled: 1, cracked: 1, unsealed: 1, skipped: 0 },
    schema_diff: { tools_removed: [], tools_added: [], input_schema_changed: [] },
    verdict: "HOLD",
    red: 2,
    filed: 0,
    covered: false,
    reason: "1 rattled, 1 cracked; 1 quarantined: orphan pre-event; 1 spoiled line",
    coverage: {
      compared: 3,
      tools_compared: ["quote", "cancel_booking"],
      tools_listed: ["quote", "search_rooms"],
      tools_unrecorded: ["search_rooms"],
    },
    ...overrides,
  };
}

const SHIP_COVERAGE = {
  compared: 2,
  tools_compared: ["quote"],
  tools_listed: ["quote", "search_rooms"],
  tools_unrecorded: ["search_rooms"],
};

describe("replayResultSchema", () => {
  it("round-trips a Replay_Result through JSON and back to a deep-equal object", () => {
    const sample = result({});
    const parsed = replayResultSchema.parse(JSON.parse(JSON.stringify(sample)));
    expect(parsed).toEqual(sample);
  });

  it("names the failing field when the verdict is not SHIP or HOLD", () => {
    const bad = { ...result({}), verdict: "MAYBE" };
    const outcome = replayResultSchema.safeParse(bad);
    expect(outcome.success).toBe(false);
    if (outcome.success) return;
    const paths = outcome.error.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("verdict");
  });

  it("names an unknown field as the failing field", () => {
    const bad = { ...result({}), extra: true };
    const outcome = replayResultSchema.safeParse(bad);
    expect(outcome.success).toBe(false);
    if (outcome.success) return;
    const unknown = outcome.error.issues.find((issue) => issue.code === "unrecognized_keys");
    expect(unknown !== undefined && "keys" in unknown ? unknown.keys : []).toEqual(["extra"]);
  });

  it("round-trips a quarantine file", () => {
    const quarantine = {
      v: 1 as const,
      items: [
        { id: null, session_id: "c3d4", seq: 5, tool: "book_room", reason: "orphan pre-event" },
        { id: "SPC-0009", session_id: "e5f6", seq: 1, tool: "quote", reason: "unpaired post-event" },
      ],
    };
    const parsed = quarantineFileSchema.parse(JSON.parse(JSON.stringify(quarantine)));
    expect(parsed).toEqual(quarantine);
  });
});

describe("coverageString", () => {
  it("uses the plural form and lists the unrecorded tools", () => {
    expect(coverageString(SHIP_COVERAGE)).toBe(
      "2 jars compared · 1 of 2 tools · not recorded: search_rooms",
    );
  });

  it("uses the singular form for one jar and 'none' for an empty unrecorded list", () => {
    expect(
      coverageString({
        compared: 1,
        tools_compared: ["quote"],
        tools_listed: ["quote"],
        tools_unrecorded: [],
      }),
    ).toBe("1 jar compared · 1 of 1 tools · not recorded: none");
  });
});

describe("buildReport first line", () => {
  it("writes the SHIP form", () => {
    const lines = buildReport(
      result({
        verdict: "SHIP",
        covered: false,
        red: 0,
        filed: 0,
        jars: [preserved],
        spoiled: [],
        coverage: SHIP_COVERAGE,
        reason: "",
      }),
    );
    expect(lines[0]).toBe(
      "SHIP · replay clean on the recorded set · 2 jars compared · 1 of 2 tools · not recorded: search_rooms",
    );
  });

  it("writes the HOLD form when covered is false", () => {
    const lines = buildReport(result({}));
    expect(lines[0]).toBe(
      "HOLD · 1 rattled, 1 cracked; 1 quarantined: orphan pre-event; 1 spoiled line · 3 jars compared · 2 of 2 tools · not recorded: search_rooms",
    );
  });

  it("writes the covered HOLD form when covered is true", () => {
    const lines = buildReport(
      result({
        covered: true,
        red: 1,
        filed: 1,
        jars: [renamed],
        spoiled: [],
        reason: "1 rattled",
        coverage: { ...SHIP_COVERAGE, compared: 1 },
      }),
    );
    expect(lines[0]).toBe(
      "HOLD · covered · 1 rattled · 1 jar compared · 1 of 2 tools · not recorded: search_rooms",
    );
  });
});

describe("buildReport jar and spoiled lines", () => {
  it("writes the fields, the rename note, the +N field text and the spoiled line", () => {
    const lines = buildReport(result({}));
    expect(lines.slice(1)).toEqual([
      "SPC-0007 · quote · preserved · - · -",
      "SPC-0012 · quote · rattled · /total_cents · suspected rename from /total ×100; +1 field",
      "SPC-0003 · cancel_booking · cracked · - · tool not in tools/list",
      "c3d4#5 · book_room · unsealed · - · orphan pre-event",
      "spoiled · jars/a.jsonl:3 · duplicate id",
    ]);
  });

  it("never contains the word safe in any report", () => {
    const reports = [
      buildReport(result({})),
      buildReport(result({ verdict: "SHIP", spoiled: [], jars: [preserved], reason: "" })),
      buildReport(result({ covered: true, red: 1, filed: 1, jars: [renamed], spoiled: [] })),
    ];
    for (const lines of reports) {
      for (const line of lines) {
        expect(line.toLowerCase()).not.toContain("safe");
      }
    }
  });
});
