/**
 * The pure view model of the Cabinet (Requirements 4, 6, 7, 8, 10 and 13). It turns one
 * Replay_Result, the committed Bugfix_Specs and the rack metadata into plain data that the React
 * components render. Every figure comes from those inputs. There is no clock, no randomness, no
 * DOM access and no Node built-in import, so the same inputs always give the same output.
 *
 * The rack metadata is imported as a type only, so this module has no build-time `?raw` import.
 */
import {
  checkSpec,
  citesId,
  coverageString,
  filedJarIds,
  type BugfixSpec,
  type Change,
  type Json,
  type ResultEntry,
} from "@specimen/core";
import type { CabinetReplayResult, HollowInnVersion } from "./browser-replay.js";
import type { RackJar, RackMeta } from "./rack-meta.js";

export type { HollowInnVersion };

export type JarState = "not replayed" | "preserved" | "rattled" | "cracked" | "unsealed" | "skipped";

export type JarViewModel = {
  /** The accession, or null for an Orphan_Entry. */
  id: string | null;
  /** The accession, or `${session_id}#${seq}` for an Orphan_Entry. Used in names and tooltips. */
  accession: string;
  tool: string;
  /** "RACK A" or "RACK B". */
  rackCode: string;
  /** The rack code's last letter plus the 1-based seq position, for example "A5". */
  positionCode: string;
  seq: number;
  state: JarState;
  isRed: boolean;
  flagWord: "ABNORMAL" | "CRACKED" | null;
  /** Degrees, between 0.5 and 1.5, derived from the accession. */
  tilt: number;
  /** "<accession> <tool> — <state>[, <details>]" (Requirement 8.7). */
  accessibleName: string;
  tooltip: string;
  /** True only for a Red_Jar whose id is filed (Requirement 5). */
  filed: boolean;
  changes: Change[];
  compatible: Change[];
  ignored: string[];
  /** The failure reason of a cracked, unsealed or skipped jar. */
  reason?: string;
  input: Json | null;
  responseText: string | null;
  replayedText: string | null;
};

export type RackViewModel = {
  code: string;
  task: string;
  /** The same-session follow-up prompt that produced one of the rack's calls, or undefined when none did. */
  followUp?: string;
  sessionId: string;
  shortSessionId: string;
  callCount: number;
  jars: JarViewModel[];
};

export type VerdictPlateViewModel = {
  /** Null while no replay has completed for the selected Version. */
  verdict: "SHIP" | "HOLD" | null;
  version: HollowInnVersion;
  /** "P preserved · R rattled · C cracked[, U unsealed]", or "" before a replay. */
  countsLine: string;
  /** coverageString() of @specimen/core, or "" before a replay. */
  coverageLine: string;
  /**
   * "R red · F covered by N filed Kiro bugfix spec(s)", or "R red · all red jars covered by N filed …" when
   * every red jar is filed. "" before a replay.
   */
  filedLine: string;
  skippedLine?: string;
  quarantinedLine?: string;
  spoiledLine?: string;
  reason: string;
  replayTimeMs: number | null;
  compared: number;
};

export type CountsPairViewModel = {
  /** A: tools removed plus tools with a changed input schema. */
  schemaChanged: number;
  /** B: the baseline tool count. */
  schemaTotal: number;
  addedToolNames: string[];
  /** The tools the schema diff removed, in diff order. */
  removedToolNames: string[];
  /**
   * The rename, when the schema diff removed exactly one tool and added exactly one. With more than one
   * removed or added tool the cabinet cannot pair them, so this is null.
   */
  renamed: { from: string; to: string } | null;
  /** Recorded calls (every jar, any state) to a tool the schema diff flagged. */
  flaggedCallCount: number;
  /** Red jars that call a tool the schema diff flagged. */
  flaggedRedCount: number;
  /** Red jars that call a tool whose inputs did not change (not flagged by the schema diff). */
  unchangedRedCount: number;
  schemaDiffError?: string;
  /** C: the distinct tools among the Red_Jars. */
  replayToolCount: number;
  /** D: the Red_Jar count, equal to `red` of verdict(). */
  redJarCount: number;
};

export type GuideStepState = { label: string; done: boolean };

export type CabinetViewModel = {
  version: HollowInnVersion;
  replayed: boolean;
  racks: RackViewModel[];
  plate: VerdictPlateViewModel;
  counts: CountsPairViewModel;
  guide: GuideStepState[];
  spoiled: { file: string; line: number; reason: string }[];
  skippedToolsPresent: boolean;
};

export type BuildViewModelInput = {
  /** Null before the first replay of the selected Version. */
  result: CabinetReplayResult | null;
  version: HollowInnVersion;
  bugfixSpecs: BugfixSpec[];
  racks: RackMeta[];
  guideFlags: { openedRedJar: boolean; viewedSpec: boolean; replayedFixedVersion: boolean };
  /** The schemaDiffError of the replay, when the schema diff could not be computed. */
  schemaDiffError?: string;
};

/** Reasons that verdict() counts as quarantined. They mirror the constants in verdict.ts. */
/**
 * The same-session follow-ups of the racks, keyed by rack code. RACK A's fifth call (A5, SPC-0010) came from
 * prompts/rack-a-followup.md, the one follow-up the recording gate allows, so the shelf says so under the task.
 */
export const RACK_FOLLOW_UPS: Readonly<Record<string, string>> = {
  "RACK A":
    "+ one follow-up in the same session (A5): “call search_rooms without the limit argument”, because the first search sent limit: 50.",
};

const ORPHAN_REASON = "orphan pre-event";
const UNPAIRED_REASON = "unpaired post-event";

const KIND_WORDS: Record<Change["kind"], string> = {
  removed: "removed",
  added: "added",
  value: "changed",
  type: "type changed",
  length: "length changed",
};

/** "<count> <word>", with the singular word when count is 1. */
export function pluralise(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * A tilt between 0.5 and 1.5 degrees, from a 32-bit FNV-1a hash of the accession. The same id
 * always gives the same angle.
 */
export function jarTiltDeg(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return 0.5 + ((hash >>> 0) % 1000) / 1000;
}

/** The changed paths with their kinds, then the distinct notes (for example a rename note). */
function changeDetails(changes: readonly Change[]): string[] {
  const details = changes.map((change) => `${change.path} ${KIND_WORDS[change.kind]}`);
  for (const change of changes) {
    if (change.note !== undefined && !details.includes(change.note)) details.push(change.note);
  }
  return details;
}

/** The details that a name and a tooltip list after the state word. */
function detailsOf(
  state: JarState,
  changes: readonly Change[],
  compatible: readonly Change[],
  reason: string | undefined,
): string[] {
  switch (state) {
    case "rattled":
      return changeDetails(changes);
    case "cracked":
    case "unsealed":
    case "skipped":
      return reason === undefined ? [] : [reason];
    case "preserved":
      return compatible.length > 0
        ? [`${pluralise(compatible.length, "field", "fields")} added`]
        : [];
    case "not replayed":
      return [];
  }
}

function nameFor(jar: Omit<JarViewModel, "accessibleName" | "tooltip">): string {
  const details = detailsOf(jar.state, jar.changes, jar.compatible, jar.reason);
  const head = `${jar.accession} ${jar.tool} — ${jar.state}`;
  return details.length === 0 ? head : `${head}, ${details.join(", ")}`;
}

/** The accessible name of a jar (Requirement 8.7). */
export function jarAccessibleName(jar: JarViewModel): string {
  return nameFor(jar);
}

/** Adds the name and the tooltip. A red jar's tooltip names its details; any other jar shows its state word. */
function finishJar(jar: Omit<JarViewModel, "accessibleName" | "tooltip">): JarViewModel {
  const details = detailsOf(jar.state, jar.changes, jar.compatible, jar.reason);
  const tooltip = jar.isRed && details.length > 0 ? details.join(", ") : jar.state;
  return { ...jar, accessibleName: nameFor(jar), tooltip };
}

function flagFor(state: JarState): JarViewModel["flagWord"] {
  if (state === "rattled") return "ABNORMAL";
  if (state === "cracked") return "CRACKED";
  return null;
}

/** A jar before any replay: its state is "not replayed" and only the jarred data is shown. */
function notReplayedJar(meta: RackJar, rackCode: string, positionCode: string): JarViewModel {
  return finishJar({
    id: meta.id,
    accession: meta.id,
    tool: meta.tool,
    rackCode,
    positionCode,
    seq: meta.seq,
    state: "not replayed",
    isRed: false,
    flagWord: null,
    tilt: jarTiltDeg(meta.id),
    filed: false,
    changes: [],
    compatible: [],
    ignored: [],
    input: meta.input,
    responseText: meta.responseText,
    replayedText: null,
  });
}

/** A jar of a completed replay. */
function replayedJar(
  entry: ResultEntry,
  rackCode: string,
  positionCode: string,
  filedIds: ReadonlySet<string>,
): JarViewModel {
  const accession = entry.id ?? `${entry.session_id}#${entry.seq}`;
  const isRed = entry.state === "rattled" || entry.state === "cracked";
  const reason = entry.reason ?? entry.error;
  return finishJar({
    id: entry.id,
    accession,
    tool: entry.tool,
    rackCode,
    positionCode,
    seq: entry.seq,
    state: entry.state,
    isRed,
    flagWord: flagFor(entry.state),
    tilt: jarTiltDeg(accession),
    filed: isRed && entry.id !== null && filedIds.has(entry.id),
    changes: entry.changes,
    compatible: entry.compatible,
    ignored: entry.ignored,
    reason,
    input: entry.input,
    responseText: entry.response_text,
    replayedText: entry.replayed_text,
  });
}

function plateFor(
  result: CabinetReplayResult | null,
  version: HollowInnVersion,
  bugfixSpecs: readonly BugfixSpec[],
): VerdictPlateViewModel {
  if (result === null) {
    return {
      verdict: null,
      version,
      countsLine: "",
      coverageLine: "",
      filedLine: "",
      reason: "",
      replayTimeMs: null,
      compared: 0,
    };
  }

  const { counts } = result;
  const quarantined = result.jars.filter(
    (entry) =>
      entry.state === "unsealed" &&
      (entry.reason === ORPHAN_REASON || entry.reason === UNPAIRED_REASON),
  ).length;
  const allFiled = result.red > 0 && result.filed === result.red;
  const covering = pluralise(
    coveringSpecCount(bugfixSpecs, result.jars),
    "filed Kiro bugfix spec",
    "filed Kiro bugfix specs",
  );

  const plate: VerdictPlateViewModel = {
    verdict: result.verdict,
    version,
    countsLine:
      `${counts.preserved} preserved · ${counts.rattled} rattled · ${counts.cracked} cracked` +
      (counts.unsealed > 0 ? `, ${counts.unsealed} unsealed` : ""),
    coverageLine: coverageString(result.coverage),
    filedLine:
      result.filed === 0
        ? `${result.red} red · 0 filed as Kiro bugfix specs`
        : `${result.red} red · ${allFiled ? "all red jars covered by" : `${result.filed} covered by`} ${covering}`,
    reason: result.reason,
    replayTimeMs: result.replayTimeMs,
    compared: result.coverage.compared,
  };
  if (counts.skipped > 0) plate.skippedLine = `${counts.skipped} skipped`;
  if (quarantined > 0) plate.quarantinedLine = `${quarantined} quarantined`;
  if (result.spoiled.length > 0) plate.spoiledLine = `${result.spoiled.length} spoiled`;
  return plate;
}

/**
 * The number of distinct spec files that cover a red jar of `jars`. A spec covers a jar when it cites the
 * jar's id and `checkSpec()` passes against `jars`, the same test that `filedJarIds()` applies.
 */
export function coveringSpecCount(bugfixSpecs: readonly BugfixSpec[], jars: readonly ResultEntry[]): number {
  const redIds = jars
    .filter((entry) => (entry.state === "rattled" || entry.state === "cracked") && entry.id !== null)
    .map((entry) => entry.id as string);
  const covering = new Set<string>();
  for (const spec of bugfixSpecs) {
    for (const id of redIds) {
      if (citesId(spec.text, id) && checkSpec(spec.text, id, [...jars]) === "pass") covering.add(spec.name);
    }
  }
  return covering.size;
}

/**
 * The CountsPair figures (Requirement 6.1 and 6.3). Zero figures when no replay has completed.
 *
 * "Flagged" means a tool the schema diff removed, added or changed the inputs of. A rename is one removed
 * tool and one added tool. It is named only when the diff has exactly that pair, so a larger change keeps
 * the separate removed and added lists.
 */
function countsFor(
  result: CabinetReplayResult | null,
  schemaDiffError: string | undefined,
): CountsPairViewModel {
  const counts: CountsPairViewModel = {
    schemaChanged: 0,
    schemaTotal: 0,
    addedToolNames: [],
    removedToolNames: [],
    renamed: null,
    flaggedCallCount: 0,
    flaggedRedCount: 0,
    unchangedRedCount: 0,
    replayToolCount: 0,
    redJarCount: 0,
  };
  if (result !== null) {
    const diff = result.schema_diff;
    const flagged = new Set<string>([...diff.tools_removed, ...diff.tools_added, ...diff.input_schema_changed]);
    const redJars = result.jars.filter((entry) => entry.state === "rattled" || entry.state === "cracked");
    const redTools = new Set(redJars.map((entry) => entry.tool));
    const flaggedRed = redJars.filter((entry) => flagged.has(entry.tool)).length;
    const onlyPair = diff.tools_removed.length === 1 && diff.tools_added.length === 1;

    counts.schemaChanged = diff.tools_removed.length + diff.input_schema_changed.length;
    counts.schemaTotal =
      result.coverage.tools_listed.length - diff.tools_added.length + diff.tools_removed.length;
    counts.addedToolNames = [...diff.tools_added];
    counts.removedToolNames = [...diff.tools_removed];
    counts.renamed = onlyPair ? { from: diff.tools_removed[0] ?? "", to: diff.tools_added[0] ?? "" } : null;
    counts.flaggedCallCount = result.jars.filter((entry) => flagged.has(entry.tool)).length;
    counts.flaggedRedCount = flaggedRed;
    counts.unchangedRedCount = redJars.length - flaggedRed;
    counts.replayToolCount = redTools.size;
    counts.redJarCount = result.red;
  }
  if (schemaDiffError !== undefined) counts.schemaDiffError = schemaDiffError;
  return counts;
}

/**
 * The single derivation point of the Cabinet. With a null `result`, every jar is "not replayed",
 * the plate and the counts are empty, and the shelves still list every jar of the racks.
 *
 * A rack's jars are the Replay_Result entries whose session_id is the rack's session, in seq
 * order. An entry whose session is no rack in `racks` is not shown on a shelf, but the plate and
 * the counts still include it.
 */
export function buildViewModel(input: BuildViewModelInput): CabinetViewModel {
  const { result, version, bugfixSpecs, racks, guideFlags, schemaDiffError } = input;
  const filedIds: ReadonlySet<string> =
    result === null ? new Set<string>() : filedJarIds(bugfixSpecs, result.jars);

  const rackViews: RackViewModel[] = racks.map((rack) => {
    const letter = rack.code.slice(-1);
    const positionOf = (index: number): string => `${letter}${index + 1}`;
    const jars =
      result === null
        ? rack.jars.map((meta, index) => notReplayedJar(meta, rack.code, positionOf(index)))
        : result.jars
            .filter((entry) => entry.session_id === rack.sessionId)
            .sort((a, b) => a.seq - b.seq)
            .map((entry, index) => replayedJar(entry, rack.code, positionOf(index), filedIds));
    return {
      code: rack.code,
      task: rack.task,
      followUp: RACK_FOLLOW_UPS[rack.code],
      sessionId: rack.sessionId,
      shortSessionId: rack.shortSessionId,
      callCount: rack.callCount,
      jars,
    };
  });

  const spoiled = result === null ? [] : result.spoiled.map((item) => ({ ...item }));

  return {
    version,
    replayed: result !== null,
    racks: rackViews,
    plate: plateFor(result, version, bugfixSpecs),
    counts: countsFor(result, schemaDiffError),
    guide: [
      { label: "Open a red jar", done: guideFlags.openedRedJar },
      { label: "Read the bugfix spec filed for it", done: guideFlags.viewedSpec },
      { label: "Switch to v2.1 and replay", done: guideFlags.replayedFixedVersion },
    ],
    spoiled,
    skippedToolsPresent: result !== null && result.counts.skipped > 0,
  };
}

/** Every jar in reveal order: rack order, then seq order within each rack (Requirements 2.3, 7.5). */
export function revealOrder(viewModel: CabinetViewModel): JarViewModel[] {
  return viewModel.racks.flatMap((rack) => rack.jars);
}
