import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  type ResultEntry,
  type VerdictArgs,
  coverageString,
  verdict,
} from "../src/index.js";

const RUNS = { numRuns: 200 };

const STATES = ["preserved", "rattled", "cracked", "unsealed", "skipped"] as const;
const TOOLS = ["quote", "search_rooms", "book_room", "cancel_booking"] as const;
const EXTRA_TOOLS = ["legacy_tool", "zz_tool"] as const;

type Item = {
  state: (typeof STATES)[number];
  tool: string;
  orphan: boolean;
  filed: boolean;
};

const itemArb: fc.Arbitrary<Item> = fc.record({
  state: fc.constantFrom(...STATES),
  tool: fc.constantFrom(...TOOLS),
  orphan: fc.boolean(),
  filed: fc.boolean(),
});

/** Builds Result_Entries with unique ids. Orphans only occur as unsealed entries with id null. */
function toEntries(items: Item[]): { entries: ResultEntry[]; filedIds: Set<string> } {
  const filedIds = new Set<string>();
  const entries = items.map((item, index): ResultEntry => {
    const isOrphan = item.state === "unsealed" && item.orphan;
    const id = isOrphan ? null : `SPC-${String(index + 1).padStart(4, "0")}`;
    if (id !== null && item.filed) filedIds.add(id);
    const base = {
      id,
      session_id: "s1",
      seq: index + 1,
      tool: item.tool,
      state: item.state,
      input: null,
      response_text: null,
      changes: [],
      compatible: [],
      ignored: [],
      replayed_text: null,
      replayed: null,
      ms: 0,
    };
    if (item.state !== "unsealed") return base;
    return { ...base, reason: isOrphan ? "orphan pre-event" : "unpaired post-event" };
  });
  return { entries, filedIds };
}

const argsArb: fc.Arbitrary<VerdictArgs> = fc
  .record({
    items: fc.array(itemArb, { maxLength: 8 }),
    spoiledCount: fc.integer({ min: 0, max: 3 }),
    extraListed: fc.subarray([...EXTRA_TOOLS]),
    listedFromTools: fc.subarray([...TOOLS]),
  })
  .map(({ items, spoiledCount, extraListed, listedFromTools }) => {
    const { entries, filedIds } = toEntries(items);
    return {
      entries,
      spoiledCount,
      toolsListed: [...listedFromTools, ...extraListed],
      filedIds,
    };
  });

/** Independent model of the SHIP rule (Requirement 5 criterion 2). */
function modelShips(args: VerdictArgs): boolean {
  const compared = args.entries.filter((e) =>
    ["preserved", "rattled", "cracked"].includes(e.state),
  ).length;
  const blocked = args.entries.some((e) =>
    ["rattled", "cracked", "unsealed", "skipped"].includes(e.state),
  );
  return compared > 0 && !blocked && args.spoiledCount === 0;
}

/** Independent model of the HOLD reason parts (Requirement 5 criteria 3 to 8). */
function modelReasonParts(args: VerdictArgs): string[] {
  const { entries, spoiledCount } = args;
  const parts: string[] = [];
  if (entries.length === 0 && spoiledCount === 0) parts.push("no jars");

  const rattled = entries.filter((e) => e.state === "rattled").length;
  const cracked = entries.filter((e) => e.state === "cracked").length;
  const red: string[] = [];
  if (rattled > 0) red.push(`${rattled} rattled`);
  if (cracked > 0) red.push(`${cracked} cracked`);
  if (red.length > 0) parts.push(red.join(", "));

  const skipped = entries.filter((e) => e.state === "skipped");
  if (skipped.length > 0) {
    const tools = [...new Set(skipped.map((e) => e.tool))].sort();
    parts.push(
      `${skipped.length} not replayed: not in replay.json — allow ${tools.join(", ")} in .specimen/replay.json to replay them against your disposable test instance`,
    );
  }

  const orphans = entries.filter((e) => e.reason === "orphan pre-event").length;
  const unpaired = entries.filter((e) => e.reason === "unpaired post-event").length;
  if (orphans > 0) parts.push(`${orphans} quarantined: orphan pre-event — re-record the session`);
  if (unpaired > 0) {
    parts.push(`${unpaired} quarantined: unpaired post-event — re-record the session`);
  }

  if (spoiledCount === 1) parts.push("1 spoiled line");
  if (spoiledCount > 1) parts.push(`${spoiledCount} spoiled lines`);
  return parts;
}

describe("verdict SHIP rule (property)", () => {
  // Feature: replay-engine, Property 14: The verdict is SHIP under exactly one rule, and is deterministic
  it("returns SHIP exactly when the SHIP rule holds, and the same result when called twice", () => {
    fc.assert(
      fc.property(argsArb, (args) => {
        const snapshot = structuredClone(args);
        const first = verdict(args);
        const second = verdict(args);

        expect(first.verdict).toBe(modelShips(args) ? "SHIP" : "HOLD");
        expect(first).toEqual(second);
        // Inputs are not mutated.
        expect(args).toEqual(snapshot);
      }),
      RUNS,
    );
  });
});

describe("verdict HOLD reason (property)", () => {
  // Feature: replay-engine, Property 15: The HOLD reason is composed from present parts in a fixed order
  it("composes the reason from the present parts in the fixed order, joined by '; '", () => {
    fc.assert(
      fc.property(argsArb, (args) => {
        const result = verdict(args);
        if (result.verdict === "SHIP") {
          expect(result.reason).toBe("");
          return;
        }
        const parts = modelReasonParts(args);
        expect(result.reason).toBe(parts.join("; "));
        if (args.entries.length > 0 || args.spoiledCount > 0) {
          expect(result.reason).not.toContain("no jars");
        }
      }),
      RUNS,
    );
  });
});

describe("verdict coverage (property)", () => {
  // Feature: replay-engine, Property 16: Coverage is computed consistently from compared jars and listed tools
  it("derives compared, tools_compared, tools_listed and tools_unrecorded from the inputs", () => {
    fc.assert(
      fc.property(argsArb, (args) => {
        const { coverage } = verdict(args);
        const compared = args.entries.filter((e) =>
          ["preserved", "rattled", "cracked"].includes(e.state),
        );
        const listed = [...new Set(args.toolsListed)].sort();
        const recorded = new Set(args.entries.filter((e) => e.id !== null).map((e) => e.tool));

        expect(coverage.compared).toBe(compared.length);
        expect(coverage.tools_listed).toEqual(listed);
        expect(coverage.tools_compared).toEqual(
          [...new Set(compared.map((e) => e.tool).filter((t) => listed.includes(t)))].sort(),
        );
        expect(coverage.tools_unrecorded).toEqual(listed.filter((t) => !recorded.has(t)));

        for (const list of [coverage.tools_compared, coverage.tools_listed, coverage.tools_unrecorded]) {
          expect([...list].sort()).toEqual(list);
          expect(new Set(list).size).toBe(list.length);
        }
        expect(coverageString(coverage)).toContain(
          `${coverage.tools_compared.length} of ${coverage.tools_listed.length} tools`,
        );
      }),
      RUNS,
    );
  });
});

function entry(
  overrides: Partial<ResultEntry> & Pick<ResultEntry, "state" | "tool">,
  index: number,
): ResultEntry {
  return {
    id: `SPC-${String(index).padStart(4, "0")}`,
    session_id: "s1",
    seq: index,
    input: null,
    response_text: null,
    changes: [],
    compatible: [],
    ignored: [],
    replayed_text: null,
    replayed: null,
    ms: 0,
    ...overrides,
  };
}

describe("verdict fixtures", () => {
  it("E3c: empty jars with no spoiled line give HOLD with 'no jars'", () => {
    const result = verdict({
      entries: [],
      spoiledCount: 0,
      toolsListed: ["quote"],
      filedIds: new Set(),
    });
    expect(result.verdict).toBe("HOLD");
    expect(result.reason).toBe("no jars");
    expect(result.covered).toBe(false);
    expect(coverageString(result.coverage)).toBe(
      "0 jars compared · 0 of 1 tools · not recorded: quote",
    );
  });

  it("E3d: every tool not allowed gives 'N not replayed' with the allow hint and no 'no jars'", () => {
    const result = verdict({
      entries: [
        entry({ state: "skipped", tool: "book_room" }, 1),
        entry({ state: "skipped", tool: "quote" }, 2),
      ],
      spoiledCount: 0,
      toolsListed: ["quote", "book_room"],
      filedIds: new Set(),
    });
    expect(result.verdict).toBe("HOLD");
    expect(result.reason).toBe(
      "2 not replayed: not in replay.json — allow book_room, quote in .specimen/replay.json to replay them against your disposable test instance",
    );
    expect(result.reason).not.toContain("no jars");
    expect(result.covered).toBe(false);
  });

  it("E3d: one skipped jar among preserved jars gives '1 not replayed'", () => {
    const result = verdict({
      entries: [
        entry({ state: "preserved", tool: "quote" }, 1),
        entry({ state: "skipped", tool: "search_rooms" }, 2),
      ],
      spoiledCount: 0,
      toolsListed: ["quote", "search_rooms"],
      filedIds: new Set(),
    });
    expect(result.verdict).toBe("HOLD");
    expect(result.reason).toContain("1 not replayed: not in replay.json — allow search_rooms");
    expect(result.reason).not.toContain("no jars");
  });

  it("E3e: an orphan and a spoiled line give the quarantine and spoiled parts with a coverage string", () => {
    const orphan: ResultEntry = {
      ...entry({ state: "unsealed", tool: "quote" }, 2),
      id: null,
      session_id: "s9",
      seq: 4,
      reason: "orphan pre-event",
    };
    const result = verdict({
      entries: [entry({ state: "preserved", tool: "quote" }, 1), orphan],
      spoiledCount: 1,
      toolsListed: ["quote"],
      filedIds: new Set(),
    });
    expect(result.verdict).toBe("HOLD");
    expect(result.reason).toBe(
      "1 quarantined: orphan pre-event — re-record the session; 1 spoiled line",
    );
    expect(coverageString(result.coverage)).toBe(
      "1 jar compared · 1 of 1 tools · not recorded: none",
    );
  });

  it("E3e: an unpaired post-event is quarantined after the orphan part", () => {
    const unpaired: ResultEntry = {
      ...entry({ state: "unsealed", tool: "quote" }, 3),
      reason: "unpaired post-event",
    };
    const orphan: ResultEntry = {
      ...entry({ state: "unsealed", tool: "quote" }, 2),
      id: null,
      reason: "orphan pre-event",
    };
    const result = verdict({
      entries: [unpaired, orphan],
      spoiledCount: 2,
      toolsListed: [],
      filedIds: new Set(),
    });
    expect(result.reason).toBe(
      "1 quarantined: orphan pre-event — re-record the session; 1 quarantined: unpaired post-event — re-record the session; 2 spoiled lines",
    );
  });

  it("covered is true when every Red_Jar is filed and reason lists rattled and cracked counts", () => {
    const rattled = entry({ state: "rattled", tool: "quote" }, 1);
    const cracked = entry({ state: "cracked", tool: "book_room" }, 2);
    const result = verdict({
      entries: [rattled, cracked, entry({ state: "preserved", tool: "quote" }, 3)],
      spoiledCount: 0,
      toolsListed: ["quote", "book_room"],
      filedIds: new Set([rattled.id as string, cracked.id as string]),
    });
    expect(result.reason).toBe("1 rattled, 1 cracked");
    expect(result.red).toBe(2);
    expect(result.filed).toBe(2);
    expect(result.covered).toBe(true);
  });

  it("SHIP for preserved jars only, with the coverage text", () => {
    const result = verdict({
      entries: [entry({ state: "preserved", tool: "quote" }, 1)],
      spoiledCount: 0,
      toolsListed: ["quote"],
      filedIds: new Set(),
    });
    expect(result.verdict).toBe("SHIP");
    expect(result.covered).toBe(false);
    expect(coverageString(result.coverage)).toBe(
      "1 jar compared · 1 of 1 tools · not recorded: none",
    );
  });
});
