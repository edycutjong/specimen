/**
 * The decision of the Agent Stop gate. Pure logic: no clock, no randomness, no I/O and no Node
 * built-in import. The caller computes the red and unfiled ids and the count of blocks already
 * issued in the session. This module only decides.
 */
import type { VerdictResult } from "./verdict.js";

/** The longest reason that the gate prints. Kiro shows it to the agent. */
export const MAX_REASON_LENGTH = 600;

export type StopInput = {
  /** True when the watched server source changed during the turn. */
  changedThisTurn: boolean;
  /** The verdict of the replay. The rules below read the ids, not the verdict. */
  verdict: VerdictResult;
  /** Ids of every rattled or cracked jar. */
  redIds: string[];
  /** Ids of the red jars that no passing filed spec covers. */
  unfiledIds: string[];
  /** Blocks that the gate has already issued in this session. */
  blocksSoFar: number;
  /** The number of blocks after which the gate stops blocking. */
  maxBlocks: number;
};

export type StopDecision =
  | { action: "allow" }
  | { action: "block"; reason: string }
  | { action: "allow"; unresolved: string };

const REASON_HEAD = "jars rattled or cracked:";
const TAIL_CALM = " Keep the old contract so the jars replay calm.";
const TAIL_FILE = " Or run `specimen file <id>` for each jar to file a bugfix spec.";

/** Code-unit order, the order every list in the gate uses. */
function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** The block reason for `ids` (sorted). Ids that do not fit in 600 characters are counted, not listed. */
function blockReason(ids: readonly string[]): string {
  const build = (shown: readonly string[], rest: number): string => {
    const list = shown.length === 0 ? `${ids.length} jars` : shown.join(", ");
    const more = rest > 0 ? `, and ${rest} more` : "";
    return `${REASON_HEAD} ${list}${more}.${TAIL_CALM}${TAIL_FILE}`;
  };
  let shown: string[] = [];
  for (const id of ids) {
    const candidate = [...shown, id];
    if (build(candidate, ids.length - candidate.length).length > MAX_REASON_LENGTH) break;
    shown = candidate;
  }
  return build(shown, ids.length - shown.length);
}

/**
 * Decides whether the agent may finish its turn. The rules run in this order:
 * 1. No change to the watched server this turn: allow.
 * 2. No red jar is unfiled (this covers SHIP, an empty jar set, all skipped, quarantined orphans
 *    and spoiled lines, because none of them leaves a red jar unfiled): allow.
 * 3. The blocks already issued reached maxBlocks: allow, and name the unfiled ids in `unresolved`.
 * 4. Otherwise block, and name every unfiled red jar id in the reason.
 *
 * Only ids that are in `redIds` count as unfiled, so an id that is not red never causes a block.
 */
export function decideStop(input: StopInput): StopDecision {
  if (!input.changedThisTurn) return { action: "allow" };

  const red = new Set(input.redIds);
  const open = [...new Set(input.unfiledIds)].filter((id) => red.has(id)).sort(compareCodeUnits);
  if (open.length === 0) return { action: "allow" };

  if (input.blocksSoFar >= input.maxBlocks) {
    return {
      action: "allow",
      unresolved: `jars still rattled or cracked and unfiled after ${input.maxBlocks} blocks: ${open.join(", ")}`,
    };
  }

  return { action: "block", reason: blockReason(open) };
}
