/**
 * Shared fixtures for the component tests (Requirements 4, 6, 16.2). Every Replay_Result comes
 * from `runReplay()` over the real hollow-inn modules and the committed jars. Nothing is mocked.
 * The one derived result, a single-jar subset, reruns core `verdict()` on real v2 entries so the
 * singular forms can be checked.
 */
import { verdict, type ResultEntry } from "@specimen/core";
import {
  getBugfixSpecs,
  runReplay,
  type CabinetReplayResult,
  type HollowInnVersion,
} from "../../src/browser-replay.js";
import { buildViewModel, type CabinetViewModel } from "../../src/cabinet-model.js";
import { RACK_META } from "../../src/rack-meta.js";

export type Replays = Record<HollowInnVersion, CabinetReplayResult>;

/** Runs v1, v2 and v2.1 in turn. Each replay closes its own clients and servers. */
export async function loadReplays(): Promise<Replays> {
  const v1 = await runReplay("v1");
  const v2 = await runReplay("v2");
  const v21 = await runReplay("v2.1");
  return { v1, v2, "v2.1": v21 };
}

/** The view model of a Version. A null result gives the before-replay model. */
export function viewModelOf(version: HollowInnVersion, result: CabinetReplayResult | null): CabinetViewModel {
  return buildViewModel({
    result,
    version,
    bugfixSpecs: getBugfixSpecs(),
    racks: RACK_META,
    guideFlags: { openedRedJar: false, viewedSpec: false, replayedFixedVersion: false },
  });
}

/**
 * A real v2 Replay_Result reduced to one cracked jar (SPC-0009). The entry is the recorded
 * entry, and `verdict()` judges it again, so the counts are one tool and one jar.
 */
export function singleJarResult(v2: CabinetReplayResult): CabinetReplayResult {
  const entries: ResultEntry[] = v2.jars.filter((entry) => entry.id === "SPC-0009");
  if (entries.length !== 1) throw new Error("SPC-0009 is not in the v2 replay");
  const judged = verdict({
    entries,
    spoiledCount: 0,
    toolsListed: v2.coverage.tools_listed,
    filedIds: new Set<string>(),
  });
  return {
    ...v2,
    ...judged,
    jars: entries,
    counts: { preserved: 0, rattled: 0, cracked: 1, unsealed: 0, skipped: 0 },
    spoiled: [],
  };
}
