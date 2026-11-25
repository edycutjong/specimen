/**
 * The CountsPair (Requirement 6). The schema half sets the schema-diff count beside the replay
 * count, with a connector between them that compares the two. The figures come from `buildViewModel`.
 * This module builds only the display text.
 *
 * The two halves sit on a lab-notebook strip. Each half shows its label ("input-schema diff:" or
 * "replay:") in the body face and its value after it. The strip is always in the page, so its size is
 * the same before and after a replay. Before a replay the values and the connector are empty.
 *
 * The values, the schema detail and the connector are hidden with `visibility: hidden` until the
 * Reveal has settled, so they keep their space. Then the replay count counts up from 0 over
 * COUNT_UP_MS (design pass, item 2). Without `countUp`, every value is shown once revealed, which is
 * also the Reduced_Motion behaviour.
 */
import { useEffect, useState, type ReactElement } from "react";
import { pluralise, type CountsPairViewModel } from "../cabinet-model.js";
import { COUNT_UP_MS, REVEAL_SETTLE_MS } from "../reveal.js";
import "../styles/counts-pair.css";

export type CountsPairProps = {
  counts: CountsPairViewModel;
  /** False until the selected Version has a completed replay. Then no figure is shown (Requirement 6.8). */
  replayed: boolean;
  /** True once the Reveal has completed. Before that the figures stay hidden. */
  revealed?: boolean;
  /** True to count the replay figures up from 0 after the settle. False shows the figures at once. */
  countUp?: boolean;
};

const SCHEMA_LABEL = "input-schema diff:";
const REPLAY_LABEL = "replay:";

/** The count-up has this many steps, so each step is COUNT_UP_MS / FRAMES ms apart. */
const FRAMES = 10;
const FRAME_MS = COUNT_UP_MS / FRAMES;

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

/** A count written as a word up to twelve, and as digits above that. */
function countWord(count: number): string {
  return WORDS[count] ?? String(count);
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * "input-schema diff: A of B tools changed" (Requirement 6.1), or "input-schema diff: unavailable — <error>"
 * when the replay reported a schemaDiffError (Requirement 6.9). The diff compares input schemas only.
 */
export function schemaDiffText(counts: CountsPairViewModel): string {
  if (counts.schemaDiffError !== undefined) {
    return `input-schema diff: unavailable — ${counts.schemaDiffError}`;
  }
  return `input-schema diff: ${counts.schemaChanged} of ${pluralise(counts.schemaTotal, "tool", "tools")} changed`;
}

/**
 * The detail after the schema value (design pass, item 1): "renamed X → Y" for a rename, "removed X,
 * added Y" when the diff has removed and added tools that do not pair up, or "added Y" / "removed X" on
 * their own. Null when the diff added and removed nothing.
 */
export function addedText(counts: CountsPairViewModel): string | null {
  if (counts.renamed !== null) return `renamed ${counts.renamed.from} → ${counts.renamed.to}`;
  const removed = counts.removedToolNames;
  const added = counts.addedToolNames;
  if (removed.length > 0 && added.length > 0) {
    return `removed ${removed.join(", ")}, added ${added.join(", ")}`;
  }
  if (added.length > 0) return `added ${added.join(", ")}`;
  if (removed.length > 0) return `removed ${removed.join(", ")}`;
  return null;
}

/** "C tools · D jars changed", built from the two counts. */
export function replayValueText(tools: number, jars: number): string {
  return `${pluralise(tools, "tool", "tools")} · ${pluralise(jars, "jar", "jars")} changed`;
}

/** "replay: C tools · D jars changed" (Requirements 6.3 and 6.10). */
export function replayText(counts: CountsPairViewModel): string {
  return `replay: ${replayValueText(counts.replayToolCount, counts.redJarCount)}`;
}

/** The text after a label and its space, for example "1 of 6 tools changed" after "input-schema diff:". */
function valueAfter(text: string, label: string): string {
  return text.startsWith(`${label} `) ? text.slice(label.length + 1) : text;
}

/**
 * The lede under the strip (design pass, item 1). It names the recorded calls and the jar count from
 * the view model. The recording always ran against hollow-inn v1.
 */
export function ledeText(jarCount: number): string {
  const calls = jarCount === 1 ? "real Kiro tool call was" : "real Kiro tool calls were";
  return `${capitalise(countWord(jarCount))} ${calls} recorded against hollow-inn v1. We replayed them against the version you selected.`;
}

/** The break count sentence: "5 calls came back different — 4 in tools whose inputs never changed." */
function brokenSentence(counts: CountsPairViewModel): string {
  const different = pluralise(counts.redJarCount, "call came back different", "calls came back different");
  if (counts.redJarCount === 0) return `${different}.`;
  const unchanged = counts.unchangedRedCount;
  const tail =
    unchanged === 0
      ? "none in tools whose inputs never changed"
      : `${unchanged} in tools whose inputs never changed`;
  return `${different} — ${tail}.`;
}

/**
 * The connector between the two halves (design pass, item 1). A rename reads as one sentence about the
 * renamed tool and its recorded calls. Otherwise it lists the removed and added tools. Both end with the
 * replay's break count. With no schema change and no broken call, it reads as one line. Empty when no
 * replay has completed.
 */
export function connectorText(counts: CountsPairViewModel): string {
  if (counts.redJarCount === 0 && counts.schemaChanged === 0 && counts.addedToolNames.length === 0) {
    return "Nothing changed — every recorded call came back the same.";
  }
  if (counts.renamed !== null) {
    const { from, to } = counts.renamed;
    const used = `${pluralise(counts.flaggedCallCount, "recorded call", "recorded calls")} used it`;
    return `The schema diff saw one renamed tool (${from} → ${to}); ${used}. ${brokenSentence(counts)}`;
  }
  const changed = counts.schemaChanged + counts.addedToolNames.length;
  const detail = addedText(counts);
  const saw =
    detail === null
      ? `The schema diff saw ${pluralise(changed, "changed tool", "changed tools")}`
      : `The schema diff saw ${pluralise(changed, "changed tool", "changed tools")}: ${detail}`;
  const used = `${pluralise(counts.flaggedCallCount, "recorded call", "recorded calls")} used a changed tool`;
  return `${saw}; ${used}. ${brokenSentence(counts)}`;
}

/** The number of the count-up steps shown so far: 0 until the Reveal settles, then FRAMES at the end. */
function useCountFrame(active: boolean): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) {
      setFrame(0);
      return undefined;
    }
    let current = 0;
    let id = 0;
    const tick = (): void => {
      current += 1;
      setFrame(current);
      if (current < FRAMES) id = window.setTimeout(tick, FRAME_MS);
    };
    id = window.setTimeout(tick, REVEAL_SETTLE_MS);
    return () => window.clearTimeout(id);
  }, [active]);
  return frame;
}

/** A count, shown as it stands at this step of the count-up. Without a count-up, the final count. */
function countedAt(target: number, frame: number, countUp: boolean): number {
  return countUp ? Math.round((target * Math.min(frame, FRAMES)) / FRAMES) : target;
}

export function CountsPair({
  counts,
  replayed,
  revealed = true,
  countUp = false,
}: CountsPairProps): ReactElement {
  const frame = useCountFrame(countUp && revealed);
  // Hidden until the Reveal has settled. With a count-up, the figures stay hidden through the first step.
  const hidden = countUp ? frame === 0 : !revealed;
  const figureClass = hidden ? "counts-pair__value counts-pair__value--hidden" : "counts-pair__value";
  const tools = countedAt(counts.replayToolCount, frame, countUp);
  const jars = countedAt(counts.redJarCount, frame, countUp);
  // The connector names the final figures, so it waits until the count-up has reached them (no early final number).
  const settled = countUp ? frame >= FRAMES : revealed;

  return (
    <div className="counts-pair-group">
      <div className="counts-pair">
        <div className="counts-pair__side counts-pair__side--schema">
          <p className="counts-pair__schema" style={{ color: "var(--muted)" }}>
            <span className="counts-pair__label">{SCHEMA_LABEL}</span>{" "}
            <span className={figureClass}>{replayed ? valueAfter(schemaDiffText(counts), SCHEMA_LABEL) : ""}</span>
          </p>
        </div>
        <p
          className={settled ? "counts-pair__connector" : "counts-pair__connector counts-pair__connector--hidden"}
        >
          {replayed ? connectorText(counts) : ""}
        </p>
        <div className="counts-pair__side counts-pair__side--replay">
          <p className="counts-pair__replay" style={{ color: "var(--after)" }}>
            <span className="counts-pair__label">{REPLAY_LABEL}</span>{" "}
            <span className={figureClass}>{replayed ? replayValueText(tools, jars) : ""}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
