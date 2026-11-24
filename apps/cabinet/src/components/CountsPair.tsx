/**
 * The CountsPair (Requirement 6). The schema half sets the schema-diff count beside the replay
 * count, and each half has its own colour: the schema half in `--muted`, the replay half in
 * `--after`. The figures come from `buildViewModel`. This module builds only the display text.
 */
import { pluralise, type CountsPairViewModel } from "../cabinet-model.js";

export type CountsPairProps = {
  counts: CountsPairViewModel;
  /** False until the selected Version has a completed replay. Then no figure is shown (Requirement 6.8). */
  replayed: boolean;
};

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

export function CountsPair({ counts, replayed }: CountsPairProps) {
  if (!replayed) return null;
  const added = addedText(counts);
  return (
    <p className="counts-pair">
      <span className="counts-pair__schema" style={{ color: "var(--muted)" }}>
        {schemaDiffText(counts)}
      </span>
      {added !== null ? (
        <>
          {" "}
          <span className="counts-pair__added" style={{ color: "var(--muted)" }}>
            {added}
          </span>
        </>
      ) : null}
      {" "}
      <span className="counts-pair__replay" style={{ color: "var(--after)" }}>
        {replayText(counts)}
      </span>
    </p>
  );
}
