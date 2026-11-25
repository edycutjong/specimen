/**
 * The CountsPair (Requirement 6). The schema half sets the schema-diff count beside the replay
 * count, and each half has its own colour: the schema half in `--muted`, the replay half in
 * `--after`. The figures come from `buildViewModel`. This module builds only the display text.
 *
 * The two halves sit on a lab-notebook strip with a vertical rule between them. Each half shows its
 * label ("schema diff:" or "replay:") in the body face and its value after it. The values keep the
 * wording of `schemaDiffText`, `addedText` and `replayText`, so the text stays the same as the view
 * model's.
 */
import { pluralise, type CountsPairViewModel } from "../cabinet-model.js";
import "../styles/counts-pair.css";

export type CountsPairProps = {
  counts: CountsPairViewModel;
  /** False until the selected Version has a completed replay. Then no figure is shown (Requirement 6.8). */
  replayed: boolean;
};

const SCHEMA_LABEL = "schema diff:";
const REPLAY_LABEL = "replay:";

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

/** "replay: C tools · D jars changed" (Requirements 6.3 and 6.10). */
export function replayText(counts: CountsPairViewModel): string {
  const tools = pluralise(counts.replayToolCount, "tool", "tools");
  const jars = pluralise(counts.redJarCount, "jar", "jars");
  return `replay: ${tools} · ${jars} changed`;
}

/** The text after a label and its space, for example "1 of 6 tools changed" after "schema diff:". */
function valueAfter(text: string, label: string): string {
  return text.startsWith(`${label} `) ? text.slice(label.length + 1) : text;
}

export function CountsPair({ counts, replayed }: CountsPairProps) {
  if (!replayed) return null;
  const added = addedText(counts);
  return (
    <div className="counts-pair">
      <div className="counts-pair__side counts-pair__side--schema">
        <p className="counts-pair__schema" style={{ color: "var(--muted)" }}>
          <span className="counts-pair__label">{SCHEMA_LABEL}</span> <span className="counts-pair__value">{valueAfter(schemaDiffText(counts), SCHEMA_LABEL)}</span>
        </p>
        {added !== null ? <p className="counts-pair__added">{added}</p> : null}
      </div>
      <div className="counts-pair__divider" aria-hidden="true" />
      <div className="counts-pair__side counts-pair__side--replay">
        <p className="counts-pair__replay" style={{ color: "var(--after)" }}>
          <span className="counts-pair__label">{REPLAY_LABEL}</span> <span className="counts-pair__value">{valueAfter(replayText(counts), REPLAY_LABEL)}</span>
        </p>
      </div>
    </div>
  );
}
