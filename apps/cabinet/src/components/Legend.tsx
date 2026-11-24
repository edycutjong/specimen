/**
 * The legend of the Jar_States (Requirement 14.4). Each state is drawn as a small CSS shape with
 * its printed word, so the word is never the only cue. SKIPPED appears only when the replay has a
 * skipped jar (14.5).
 */
import type { ReactElement } from "react";
import "../styles/shelf.css";

export type LegendProps = {
  /** True when at least one jar of the Replay_Result is skipped. */
  skippedToolsPresent: boolean;
};

type LegendEntry = { word: string; markClass: string };

const ENTRIES: readonly LegendEntry[] = [
  { word: "PRESERVED", markClass: "legend__mark--preserved" },
  { word: "RATTLED", markClass: "legend__mark--rattled" },
  { word: "CRACKED", markClass: "legend__mark--cracked" },
  { word: "UNSEALED", markClass: "legend__mark--unsealed" },
  { word: "NOT REPLAYED", markClass: "legend__mark--not-replayed" },
];

const SKIPPED_ENTRY: LegendEntry = { word: "SKIPPED", markClass: "legend__mark--skipped" };

export function Legend({ skippedToolsPresent }: LegendProps): ReactElement {
  const entries = skippedToolsPresent ? [...ENTRIES, SKIPPED_ENTRY] : ENTRIES;
  return (
    <ul className="legend" aria-label="Jar states">
      {entries.map((entry) => (
        <li key={entry.word} className="legend__item">
          <span className={`legend__mark ${entry.markClass}`} aria-hidden="true" />
          <span>{entry.word}</span>
        </li>
      ))}
    </ul>
  );
}
