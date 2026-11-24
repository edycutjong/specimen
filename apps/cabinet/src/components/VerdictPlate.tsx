/**
 * The VerdictPlate (Requirements 2.5, 2.16, 2.17 and 4). It shows the figures that
 * `buildViewModel` derived from `verdict()` and the Replay_Result. The component computes no
 * figure of its own, except the Replay_Time rounded to whole milliseconds for display.
 *
 * The status region is always in the page, so a screen reader sees the region exist before the
 * Reveal completes. Its content is added once, when `revealed` becomes true, and only while a
 * replay has a verdict (Requirement 2.17). Before that, the plate shows no verdict word.
 */
import { pluralise, type VerdictPlateViewModel } from "../cabinet-model.js";

export type VerdictPlateProps = {
  plate: VerdictPlateViewModel;
  /** True once the Reveal of the current replay has completed (Requirement 2.16). */
  revealed: boolean;
  /**
   * The Reveal_Interval in ms that the timing line states. The App passes the page constant of
   * 250 ms, not the Reduced_Motion value of 0, so the line matches Requirement 2.5.
   */
  revealIntervalMs: number;
};

/** The SHIP wording of Requirement 4.14. The line never calls the server safe (Requirement 4.13). */
export const SHIP_WORDING = "replay clean on the recorded set";

/** The verdict word colour: `--after` for HOLD and `--before` for SHIP (Requirements 4.2, 4.3). */
export function verdictColour(verdict: "SHIP" | "HOLD"): string {
  return verdict === "HOLD" ? "var(--after)" : "var(--before)";
}

/** The Reveal timing line of Requirement 2.5, with N from `coverage.compared` and T from the Replay_Time. */
export function timingLine(plate: VerdictPlateViewModel, revealIntervalMs: number): string | null {
  if (plate.replayTimeMs === null) return null;
  const jars = pluralise(plate.compared, "jar", "jars");
  return (
    `${jars} replayed in ${Math.round(plate.replayTimeMs)} ms · in this browser · ` +
    `hollow-inn ${plate.version} in memory · reveal paced at ${revealIntervalMs} ms per jar`
  );
}

function ResultLines({ plate, revealIntervalMs }: { plate: VerdictPlateViewModel; revealIntervalMs: number }) {
  const verdict = plate.verdict;
  if (verdict === null) return null;
  const timing = timingLine(plate, revealIntervalMs);
  return (
    <>
      <p className="verdict-plate__word" style={{ color: verdictColour(verdict) }}>
        {verdict}
      </p>
      <p className="verdict-plate__version">hollow-inn {plate.version}</p>
      <p className="verdict-plate__counts">{plate.countsLine}</p>
      <p className="verdict-plate__coverage">{plate.coverageLine}</p>
      <p className="verdict-plate__filed">{plate.filedLine}</p>
      {plate.skippedLine !== undefined ? <p className="verdict-plate__skipped">{plate.skippedLine}</p> : null}
      {plate.quarantinedLine !== undefined ? (
        <p className="verdict-plate__quarantined">{plate.quarantinedLine}</p>
      ) : null}
      {plate.spoiledLine !== undefined ? <p className="verdict-plate__spoiled">{plate.spoiledLine}</p> : null}
      {verdict === "SHIP" ? (
        <p className="verdict-plate__ship">SHIP: {SHIP_WORDING}.</p>
      ) : (
        <p className="verdict-plate__reason">{plate.reason}</p>
      )}
      {timing !== null ? <p className="verdict-plate__timing">{timing}</p> : null}
    </>
  );
}

export function VerdictPlate({ plate, revealed, revealIntervalMs }: VerdictPlateProps) {
  const showResult = revealed && plate.verdict !== null;
  return (
    <section className="verdict-plate" aria-label="Verdict">
      {plate.verdict === null ? (
        <p className="verdict-plate__idle">hollow-inn {plate.version} has not been replayed yet.</p>
      ) : null}
      <div role="status" className="verdict-plate__status">
        {showResult ? <ResultLines plate={plate} revealIntervalMs={revealIntervalMs} /> : null}
      </div>
    </section>
  );
}
