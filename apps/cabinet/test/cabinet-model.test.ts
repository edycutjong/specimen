/**
 * Requirements 6.5, 6.6, 6.7, 7.3, 7.5, 7.6, 16.2 and 16.3: the view model against real replays.
 * Node environment, no jsdom. Every Replay_Result comes from `runReplay()` in browser-replay.ts,
 * which runs the real hollow-inn server modules over InMemoryTransport. Nothing is written.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  getBugfixSpecs,
  runReplay,
  type CabinetReplayResult,
  type HollowInnVersion,
} from "../src/browser-replay.js";
import {
  buildViewModel,
  revealOrder,
  type CabinetViewModel,
  type CountsPairViewModel,
  type JarViewModel,
} from "../src/cabinet-model.js";
import { RACK_META } from "../src/rack-meta.js";

const PROMPTS_DIR = fileURLToPath(new URL("../../../prompts/", import.meta.url));

const results = {} as Record<HollowInnVersion, CabinetReplayResult>;

beforeAll(async () => {
  // Sequential, so each replay starts from a clean process state.
  for (const version of ["v1", "v2", "v2.1"] as const) {
    results[version] = await runReplay(version);
  }
});

function viewModelFor(version: HollowInnVersion, result: CabinetReplayResult | null): CabinetViewModel {
  return buildViewModel({
    result,
    version,
    bugfixSpecs: getBugfixSpecs(),
    racks: RACK_META,
    guideFlags: { openedRedJar: false, viewedSpec: false, replayedFixedVersion: false },
  });
}

function jarById(viewModel: CabinetViewModel, id: string): JarViewModel {
  const jar = revealOrder(viewModel).find((candidate) => candidate.id === id);
  if (jar === undefined) throw new Error(`${id} is not on any shelf`);
  return jar;
}

const EXPECTED_POSITIONS = ["A1", "A2", "A3", "A4", "A5", "B1", "B2", "B3", "B4", "B5"];

describe("view model names, counts and positions against real replays", () => {
  it("names SPC-0002 in v2 as rattled with the removed, added and rename details (8.7, 16.3)", () => {
    const jar = jarById(viewModelFor("v2", results.v2), "SPC-0002");

    expect(jar.state).toBe("rattled");
    expect(jar.isRed).toBe(true);
    expect(jar.flagWord).toBe("ABNORMAL");
    expect(jar.filed).toBe(true);
    expect(jar.accessibleName).toBe(
      "SPC-0002 quote — rattled, /total removed, /total_cents added, suspected rename from /total ×100",
    );
    expect(jar.tooltip).toBe("/total removed, /total_cents added, suspected rename from /total ×100");
  });

  it("names SPC-0002 in v2.1 as preserved with one field added, not as a red jar (6.6, 16.3)", () => {
    const jar = jarById(viewModelFor("v2.1", results["v2.1"]), "SPC-0002");

    expect(jar.state).toBe("preserved");
    expect(jar.isRed).toBe(false);
    expect(jar.flagWord).toBeNull();
    expect(jar.filed).toBe(false);
    expect(jar.compatible).toHaveLength(1);
    expect(jar.accessibleName).toBe("SPC-0002 quote — preserved, 1 field added");
    expect(jar.tooltip).toBe("preserved");
  });

  it("names SPC-0009 in v2 as cracked with the tool-missing reason (6.7, 16.3)", () => {
    const jar = jarById(viewModelFor("v2", results.v2), "SPC-0009");

    expect(jar.state).toBe("cracked");
    expect(jar.isRed).toBe(true);
    expect(jar.flagWord).toBe("CRACKED");
    expect(jar.accessibleName).toBe("SPC-0009 cancel_booking — cracked, tool not in tools/list");
    expect(jar.tooltip).toBe("tool not in tools/list");
  });

  it("shows every jar as 'not replayed' with no figures when no result exists (6.8, 8.10)", () => {
    const viewModel = viewModelFor("v2", null);

    expect(viewModel.replayed).toBe(false);
    expect(viewModel.plate.verdict).toBeNull();
    expect(viewModel.plate.countsLine).toBe("");
    expect(viewModel.counts).toMatchObject({
      schemaChanged: 0,
      schemaTotal: 0,
      addedToolNames: [],
      replayToolCount: 0,
      redJarCount: 0,
    });

    const jars = revealOrder(viewModel);
    expect(jars).toHaveLength(10);
    for (const jar of jars) {
      expect(jar.state).toBe("not replayed");
      expect(jar.isRed).toBe(false);
      expect(jar.flagWord).toBeNull();
      expect(jar.replayedText).toBeNull();
    }
    expect(jarById(viewModel, "SPC-0002").accessibleName).toBe("SPC-0002 quote — not replayed");
  });

  it("gives the CountsPair figures for v1 (6.7, 16.2)", () => {
    const counts: CountsPairViewModel = viewModelFor("v1", results.v1).counts;

    expect(counts).toMatchObject({
      schemaChanged: 0,
      schemaTotal: 6,
      addedToolNames: [],
      replayToolCount: 0,
      redJarCount: 0,
    });
    expect(counts.redJarCount).toBe(results.v1.red);
  });

  it("gives the CountsPair figures for v2 (6.5, 16.2)", () => {
    const counts = viewModelFor("v2", results.v2).counts;

    expect(counts).toMatchObject({
      schemaChanged: 1,
      schemaTotal: 6,
      addedToolNames: ["booking_cancel"],
      replayToolCount: 3,
      redJarCount: 5,
    });
    expect(counts.redJarCount).toBe(results.v2.red);
  });

  it("gives the CountsPair figures for v2.1 (6.6, 16.2)", () => {
    const counts = viewModelFor("v2.1", results["v2.1"]).counts;

    expect(counts).toMatchObject({
      schemaChanged: 0,
      schemaTotal: 6,
      addedToolNames: [],
      replayToolCount: 0,
      redJarCount: 0,
    });
    expect(counts.redJarCount).toBe(results["v2.1"].red);
  });

  it("stencils the position codes A1 to B5 in seq order, with SPC-0010 at A5 (7.5, 7.6)", () => {
    for (const version of ["v1", "v2", "v2.1"] as const) {
      const viewModel = viewModelFor(version, results[version]);
      const jars = revealOrder(viewModel);

      expect(jars.map((jar) => jar.positionCode)).toEqual(EXPECTED_POSITIONS);
      expect(jars.map((jar) => jar.seq)).toEqual([1, 2, 3, 4, 5, 1, 2, 3, 4, 5]);
      expect(jars[4]?.id).toBe("SPC-0010");
      expect(jars[4]?.positionCode).toBe("A5");
    }
  });

  it("stencils the same position codes before a replay, from the jarred data (7.6)", () => {
    const jars = revealOrder(viewModelFor("v2", null));

    expect(jars.map((jar) => jar.positionCode)).toEqual(EXPECTED_POSITIONS);
    expect(jars[4]?.id).toBe("SPC-0010");
  });

  it("shows the rack prompt text without its HTML header comment (7.3)", () => {
    const racks = viewModelFor("v1", results.v1).racks;

    expect(racks.map((rack) => rack.code)).toEqual(["RACK A", "RACK B"]);
    for (const rack of racks) {
      const file = `${PROMPTS_DIR}${rack.code.toLowerCase().replace(/ /g, "-")}.md`;
      const [header, ...body] = readFileSync(file, "utf8").split("\n");
      expect(header?.startsWith("<!--")).toBe(true);
      expect(rack.task).toBe(body.join("\n").trim());
      expect(rack.task).not.toContain("<!--");
    }
    expect(racks[0]?.task.startsWith("Find a room with a fireplace for 3 guests")).toBe(true);
    expect(racks[1]?.task.startsWith("Show at most 3 rooms for 2 guests")).toBe(true);
    expect(racks[0]?.shortSessionId).toBe("sess_2e9b7313");
    expect(racks[0]?.callCount).toBe(5);
  });
});
