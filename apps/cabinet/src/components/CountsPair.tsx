/**
 * The CountsPair (Requirement 6). The schema half sets the schema-diff count beside the replay
 * count, with a connector between them that compares the two. The lede above the strip names the
 * recorded calls. The figures come from `buildViewModel`. This module builds only the display text.
 *
 * The two halves sit on a lab-notebook strip. Each half shows its label ("schema diff:" or
 * "replay:") in the body face and its value after it. The values keep the wording of
 * `schemaDiffText`, `addedText` and `replayText`, so the text stays the same as the view model's.
 *
 * The values and the connector are hidden until the Reveal has settled. Then the replay count
 * counts up from 0 over COUNT_UP_MS (design pass, item 2). Without `countUp`, every value is shown
 * at once, which is also the Reduced_Motion behaviour.
 */
import { useEffect, useState, type ReactElement } from "react";
import { pluralise, type CountsPairViewModel } from "../cabinet-model.js";
import type { CabinetReplayResult } from "../browser-replay.js";
import { COUNT_UP_MS, REVEAL_SETTLE_MS } from "../reveal.js";
import "../styles/counts-pair.css";

export type CountsPairProps = {
  counts: CountsPairViewModel;
  /** False until the selected Version has a completed replay. Then no figure is shown (Requirement 6.8). */
  replayed: boolean;
  /** The replay result, which the connector reads for the schema-diff tools and the recorded calls. */
  result?: CabinetReplayResult | null;
  /** The number of jars of the recorded session, for the lede. Omitted, the lede is not shown. */
  jarCount?: number;
  /** True once the Reveal has completed. Before that the count-up has not started. */
  revealed?: boolean;
  /** True to count the replay figures up from 0 after the settle. False shows the figures at once. */
  countUp?: boolean;
};

const SCHEMA_LABEL = "schema diff:";
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
 * "schema diff: A of B tools changed" (Requirement 6.1), or "schema diff: unavailable — <error>"
 * when the replay reported a schemaDiffError (Requirement 6.9).
 */
export function schemaDiffText(counts: CountsPairViewModel): string {
  if (counts.schemaDiffError !== undefined) {
    return `schema diff: unavailable — ${counts.schemaDiffError}`;
  }
  return `schema diff: ${counts.schemaChanged} of ${pluralise(counts.schemaTotal, "tool", "tools")} changed`;
}

/** "added <names>" for the tools in `schema_diff.tools_added` (Requirement 6.2), or null when there are none. */
export function addedText(counts: CountsPairViewModel): string | null {
  return counts.addedToolNames.length === 0 ? null : `added ${counts.addedToolNames.join(", ")}`;
}

/** "replay: C tools · D jars changed" (Requirements 6.3 and 6.10), built from the two counts. */
export function replayValueText(tools: number, jars: number): string {
  return `${pluralise(tools, "tool", "tools")} · ${pluralise(jars, "jar", "jars")} changed`;
}

/** "replay: C tools · D jars changed" (Requirements 6.3 and 6.10). */
export function replayText(counts: CountsPairViewModel): string {
  return `replay: ${replayValueText(counts.replayToolCount, counts.redJarCount)}`;
}

/** The text after a label and its space, for example "1 of 6 tools changed" after "schema diff:". */
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

/** The names the schema diff saw in the new version: tools added and tools whose input schema changed. */
function diffToolNames(result: CabinetReplayResult): string[] {
  const names = [...result.schema_diff.tools_added, ...result.schema_diff.input_schema_changed];
  return [...new Set(names)];
}

/**
 * The connector between the two halves (design pass, item 1). It counts how many of the schema-diff
 * tools appear among the recorded calls, and how many jars are red. v1 with nothing changed reads
 * as one line. Null when there is no result to read.
 */
export function connectorText(counts: CountsPairViewModel, result: CabinetReplayResult | null): string | null {
  if (result === null) return null;
  const named = diffToolNames(result);
  if (named.length === 0 && counts.schemaChanged === 0 && counts.redJarCount === 0) {
    return "Nothing changed — every recorded call came back the same.";
  }
  const broken = `The replay found ${pluralise(counts.redJarCount, "broken call", "broken calls")}.`;
  if (named.length === 0) {
    return `The schema diff saw ${countWord(counts.schemaChanged)} ${counts.schemaChanged === 1 ? "tool" : "tools"} removed. ${broken}`;
  }

  const recorded = new Set(result.jars.map((entry) => entry.tool));
  const appearing = named.filter((tool) => recorded.has(tool)).length;
  const toolWord = named.length === 1 ? "tool" : "tools";
  let saw: string;
  if (appearing === 0) {
    saw = `The schema diff saw ${countWord(named.length)} ${toolWord}, and ${named.length === 1 ? "no recorded call uses it" : "no recorded call uses them"}.`;
  } else if (appearing === named.length) {
    saw = `The schema diff saw ${countWord(named.length)} ${toolWord}, and ${named.length === 1 ? "a recorded call uses it" : `all ${named.length} appear in recorded calls`}.`;
  } else {
    saw = `The schema diff saw ${countWord(named.length)} ${toolWord}, and ${countWord(appearing)} of them ${appearing === 1 ? "appears" : "appear"} in a recorded call.`;
  }
  return `${saw} ${broken}`;
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
  result = null,
  jarCount,
  revealed = true,
  countUp = false,
}: CountsPairProps): ReactElement | null {
  const frame = useCountFrame(countUp && revealed);
  if (!replayed) return null;

  const added = addedText(counts);
  const connector = connectorText(counts, result);
  const hidden = countUp && frame === 0;
  const valueClass = hidden ? "counts-pair__value counts-pair__value--hidden" : "counts-pair__value";
  const tools = countedAt(counts.replayToolCount, frame, countUp);
  const jars = countedAt(counts.redJarCount, frame, countUp);
  const lede = jarCount === undefined ? null : ledeText(jarCount);

  return (
    <div className="counts-pair-group">
      <div className="counts-pair">
        <div className="counts-pair__side counts-pair__side--schema">
          <p className="counts-pair__schema" style={{ color: "var(--muted)" }}>
            <span className="counts-pair__label">{SCHEMA_LABEL}</span>{" "}
            <span className={valueClass}>{valueAfter(schemaDiffText(counts), SCHEMA_LABEL)}</span>
          </p>
          {added !== null ? <p className="counts-pair__added">{added}</p> : null}
        </div>
        {connector !== null ? (
          <p className={hidden ? "counts-pair__connector counts-pair__connector--hidden" : "counts-pair__connector"}>
            {connector}
          </p>
        ) : null}
        <div className="counts-pair__side counts-pair__side--replay">
          <p className="counts-pair__replay" style={{ color: "var(--after)" }}>
            <span className="counts-pair__label">{REPLAY_LABEL}</span>{" "}
            <span className={valueClass}>{replayValueText(tools, jars)}</span>
          </p>
        </div>
      </div>
      {lede !== null ? <p className="counts-pair__lede">{lede}</p> : null}
    </div>
  );
}
