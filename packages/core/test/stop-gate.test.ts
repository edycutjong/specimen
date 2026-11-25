import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MAX_REASON_LENGTH, decideStop, type StopInput } from "../src/stop-gate.js";
import type { VerdictResult } from "../src/verdict.js";

const VERDICT: VerdictResult = {
  verdict: "HOLD",
  reason: "",
  red: 0,
  filed: 0,
  covered: false,
  coverage: { compared: 0, tools_compared: [], tools_listed: [], tools_unrecorded: [] },
};

function input(overrides: Partial<StopInput> = {}): StopInput {
  return {
    changedThisTurn: true,
    verdict: VERDICT,
    redIds: ["SPC-0002"],
    unfiledIds: ["SPC-0002"],
    blocksSoFar: 0,
    maxBlocks: 3,
    ...overrides,
  };
}

describe("decideStop", () => {
  it("allows when the server did not change this turn", () => {
    expect(decideStop(input({ changedThisTurn: false }))).toEqual({ action: "allow" });
  });

  it("allows when no red jar is unfiled", () => {
    expect(decideStop(input({ unfiledIds: [] }))).toEqual({ action: "allow" });
  });

  it("allows when the unfiled ids are not red", () => {
    expect(decideStop(input({ redIds: [], unfiledIds: ["SPC-0002"] }))).toEqual({ action: "allow" });
  });

  it("blocks and names every unfiled red jar, sorted, in the reason", () => {
    const decision = decideStop(input({ redIds: ["SPC-0010", "SPC-0002"], unfiledIds: ["SPC-0010", "SPC-0002"] }));
    expect(decision.action).toBe("block");
    if (decision.action !== "block") return;
    expect(decision.reason.startsWith("jars rattled or cracked: SPC-0002, SPC-0010")).toBe(true);
    expect(decision.reason).toContain("Keep the old contract so the jars replay calm.");
    expect(decision.reason).toContain("specimen file <id>");
    expect(decision.reason.length).toBeLessThanOrEqual(MAX_REASON_LENGTH);
  });

  it("names only the ids that are unfiled when some red jars are filed", () => {
    const decision = decideStop(
      input({ redIds: ["SPC-0002", "SPC-0006"], unfiledIds: ["SPC-0006"] }),
    );
    expect(decision.action).toBe("block");
    if (decision.action !== "block") return;
    expect(decision.reason).toContain("SPC-0006");
    expect(decision.reason).not.toContain("SPC-0002");
  });

  it("allows with unresolved text once blocksSoFar reaches maxBlocks", () => {
    const decision = decideStop(input({ blocksSoFar: 3, maxBlocks: 3 }));
    expect(decision).toEqual({
      action: "allow",
      unresolved: "jars still rattled or cracked and unfiled after 3 blocks: SPC-0002",
    });
  });

  it("still blocks while blocksSoFar is below maxBlocks", () => {
    expect(decideStop(input({ blocksSoFar: 2, maxBlocks: 3 })).action).toBe("block");
  });

  it("keeps the reason within 600 characters and says how many ids it left out", () => {
    const ids = Array.from({ length: 200 }, (_, i) => `SPC-${String(i + 1).padStart(4, "0")}`);
    const decision = decideStop(input({ redIds: ids, unfiledIds: ids }));
    expect(decision.action).toBe("block");
    if (decision.action !== "block") return;
    expect(decision.reason.length).toBeLessThanOrEqual(MAX_REASON_LENGTH);
    expect(decision.reason).toMatch(/and \d+ more\./);
  });
});

describe("decideStop properties", () => {
  const idArb = fc.stringMatching(/^[A-Z]{3}-[0-9]{4}$/);

  it("never blocks when unfiledIds is empty or changedThisTurn is false", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.array(idArb),
        fc.nat(5),
        fc.nat(5),
        (changedThisTurn, redIds, blocksSoFar, maxBlocks) => {
          const unfiledIds: string[] = [];
          const emptyUnfiled = decideStop(input({ changedThisTurn, redIds, unfiledIds, blocksSoFar, maxBlocks }));
          expect(emptyUnfiled.action).not.toBe("block");

          const notChanged = decideStop(
            input({ changedThisTurn: false, redIds, unfiledIds: redIds, blocksSoFar, maxBlocks }),
          );
          expect(notChanged.action).not.toBe("block");
        },
      ),
    );
  });

  it("keeps every block reason within 600 characters", () => {
    fc.assert(
      fc.property(fc.array(idArb, { minLength: 1, maxLength: 300 }), (ids) => {
        const decision = decideStop(input({ redIds: ids, unfiledIds: ids }));
        if (decision.action === "block") {
          expect(decision.reason.length).toBeLessThanOrEqual(MAX_REASON_LENGTH);
        }
      }),
    );
  });
});
