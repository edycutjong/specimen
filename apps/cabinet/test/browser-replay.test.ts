/**
 * Requirements 1.7 to 1.9, 5.6, 5.8 and 16.1: the Replay_Module against the committed evidence.
 * Node environment, no jsdom. The replays use the real hollow-inn modules over InMemoryTransport
 * and the real jars. Nothing is written.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildReport,
  filedJarIds,
  verdict,
  type ReplayResult,
} from "@specimen/core";
import { getBugfixSpecs, runReplay, type CabinetReplayResult, type HollowInnVersion } from "../src/browser-replay.js";

const EVIDENCE_DIR = fileURLToPath(new URL("../../../evidence/replay/", import.meta.url));

/**
 * The committed evidence files, without the `exit=N` line that the capture appended. Each file is
 * the report text followed by a newline.
 */
function evidence(name: string): string {
  const text = readFileSync(`${EVIDENCE_DIR}${name}`, "utf8");
  return text
    .split("\n")
    .filter((line) => !/^exit=\d+$/.test(line))
    .join("\n")
    .replace(/\n+$/, "");
}

/**
 * The "not filed" line of the CLI (packages/cli/src/replay.ts, reportText). The CLI keeps this
 * function private, and core has no equivalent, so the rule is repeated here. The jar lines and the
 * verdict line come from core's buildReport.
 */
function reportText(result: ReplayResult, filedIds: ReadonlySet<string>): string {
  const lines = buildReport(result);
  if (!result.covered && result.red > result.filed) {
    const unfiled = result.jars.flatMap((entry) =>
      (entry.state === "rattled" || entry.state === "cracked") && entry.id !== null && !filedIds.has(entry.id)
        ? [entry.id]
        : [],
    );
    lines.push(`not filed · ${unfiled.join(", ")}`);
  }
  return lines.join("\n");
}

/**
 * The replay entries do not depend on the Bugfix_Specs; the specs only decide Filed_Ids. So the
 * empty-spec case reuses the replay of `runReplay("v2")` and recomputes the filing and verdict with
 * no specs. `runReplay` takes no spec list, and browser-replay.ts is left unchanged.
 */
function judgeWithoutSpecs(result: CabinetReplayResult): { result: CabinetReplayResult; filedIds: Set<string> } {
  const filedIds = filedJarIds([], result.jars);
  const judged = verdict({
    entries: result.jars,
    spoiledCount: result.spoiled.length,
    toolsListed: result.coverage.tools_listed,
    filedIds,
  });
  return { result: { ...result, ...judged }, filedIds };
}

function count(result: ReplayResult, state: ReplayResult["jars"][number]["state"]): number {
  return result.jars.filter((entry) => entry.state === state).length;
}

function summaryLine(version: HollowInnVersion, result: ReplayResult, filedIds: ReadonlySet<string>): string {
  const filed = filedIds.size === 0 ? "none" : [...filedIds].sort().join(", ");
  return [
    `browser-replay ${version}`,
    result.verdict,
    `preserved ${count(result, "preserved")}`,
    `rattled ${count(result, "rattled")}`,
    `cracked ${count(result, "cracked")}`,
    `skipped ${count(result, "skipped")}`,
    `unsealed ${count(result, "unsealed")}`,
    `filed ${filed}`,
  ].join(" · ");
}

/** The Filed_Ids of the committed specs for `result`, computed by the core rule. */
function committedFiledIds(result: CabinetReplayResult): Set<string> {
  return filedJarIds(getBugfixSpecs(), result.jars);
}

describe("browser-replay against the committed evidence", () => {
  it("v1 gives SHIP with 10 preserved jars and matches racks-vs-v1.txt (1.7)", async () => {
    const result = await runReplay("v1");
    const filedIds = committedFiledIds(result);

    expect(result.verdict).toBe("SHIP");
    expect(count(result, "preserved")).toBe(10);
    expect(count(result, "rattled")).toBe(0);
    expect(count(result, "cracked")).toBe(0);
    expect(count(result, "skipped")).toBe(0);
    expect(count(result, "unsealed")).toBe(0);
    expect(filedIds.size).toBe(0);

    console.log(summaryLine("v1", result, filedIds));
    expect(reportText(result, filedIds)).toBe(evidence("racks-vs-v1.txt"));
  });

  it("v2 with the committed specs gives HOLD, 5 preserved, 4 rattled, 1 cracked, and files all five red jars (1.8, 5.6)", async () => {
    const result = await runReplay("v2");
    const filedIds = committedFiledIds(result);

    expect(result.verdict).toBe("HOLD");
    expect(count(result, "preserved")).toBe(5);
    expect(count(result, "rattled")).toBe(4);
    expect(count(result, "cracked")).toBe(1);
    expect(count(result, "skipped")).toBe(0);
    expect(count(result, "unsealed")).toBe(0);
    expect([...filedIds].sort()).toEqual(["SPC-0002", "SPC-0006", "SPC-0007", "SPC-0009", "SPC-0010"]);
    expect(result.filed).toBe(5);

    console.log(summaryLine("v2", result, filedIds));
    expect(reportText(result, filedIds)).toBe(evidence("racks-vs-v2-after-filing-all.txt"));
  });

  it("v2 with an empty spec list matches racks-vs-v2.txt, which predates filing (16.1, 5.8 context)", async () => {
    const replay = await runReplay("v2");
    const { result, filedIds } = judgeWithoutSpecs(replay);

    expect(filedIds.size).toBe(0);
    expect(result.verdict).toBe("HOLD");
    expect(reportText(result, filedIds)).toBe(evidence("racks-vs-v2.txt"));
  });

  it("v2.1 gives SHIP with all 10 preserved and matches racks-vs-v2.1-ship.txt (1.9, 5.8)", async () => {
    const result = await runReplay("v2.1");
    const filedIds = committedFiledIds(result);

    expect(result.verdict).toBe("SHIP");
    expect(count(result, "preserved")).toBe(10);
    expect(count(result, "rattled")).toBe(0);
    expect(count(result, "cracked")).toBe(0);
    expect(count(result, "skipped")).toBe(0);
    expect(count(result, "unsealed")).toBe(0);
    expect(result.red).toBe(0);

    console.log(summaryLine("v2.1", result, filedIds));
    expect(reportText(result, filedIds)).toBe(evidence("racks-vs-v2.1-ship.txt"));
  });
});
