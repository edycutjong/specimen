/**
 * The VerdictPlate (Requirements 2.5, 2.16, 2.17 and 4). It shows the figures that
 * `buildViewModel` derived from `verdict()` and the Replay_Result. The component computes no
 * figure of its own, except the Replay_Time rounded to whole milliseconds for display.
 *
 * The result has two halves. The plaque is the verdict word, the version and the counts line, and
 * it sits in the page header. The ledger is the coverage, filed counter, skipped, quarantined and
 * spoiled lines, the reason or SHIP wording, and the timing line. It sits under the CountsPair. The
 * App renders each half with its own `part`. With the default `part="both"` the plate holds the
 * whole result in one status region, which is the standalone form.
 *
 * The status region is always in the page, so a screen reader sees the region exist before the
 * Reveal completes. Its content is added once, when `revealed` becomes true, and only while a
 * replay has a verdict (Requirement 2.17). Before that, the plate shows no verdict word.
 */
import { Fragment } from "react";
import { pluralise, type VerdictPlateViewModel } from "../cabinet-model.js";
import "../styles/verdict.css";

export type VerdictPlateProps = {
  plate: VerdictPlateViewModel;
  /** True once the Reveal of the current replay has completed (Requirement 2.16). */
  revealed: boolean;
  /**
   * The Reveal_Interval in ms that the timing line states. The App passes the page constant of
   * 250 ms, not the Reduced_Motion value of 0, so the line matches Requirement 2.5.
   */
  revealIntervalMs: number;
  /** Which half of the result to render. "both" renders the whole result in one status region. */
  part?: "plaque" | "ledger" | "both";
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

/**
 * The counts line without its preserved figure, split into its facts for the one-row plate on a phone
 * (design pass, item 11): ["4 rattled", "1 cracked"]. The full line stays in the DOM for screen readers.
 */
export function compactCountsParts(countsLine: string): string[] {
  return countsLine.replace(/^\d+ preserved · /, "").split(" · ");
}

/**
 * The counts line split into its facts, each in its own nowrap span with " · " between them, so a line break can only
 * fall between two counts ("5 preserved · 4 rattled" / "1 cracked"), never inside one (QA round 3, item 8).
 */
function CountFacts({ facts }: { facts: string[] }) {
  return (
    <>
      {facts.map((fact, index) => (
        <Fragment key={index}>
          {index > 0 ? " · " : null}
          <span className="verdict-plate__count">{fact}</span>
        </Fragment>
      ))}
    </>
  );
}

/** The verdict word, the version and the counts line: the plaque half. */
function PlaqueLines({ plate }: { plate: VerdictPlateViewModel }) {
  const verdict = plate.verdict;
  if (verdict === null) return null;
  const wordClass = verdict === "HOLD" ? "verdict-plate__word verdict-plate__word--hold" : "verdict-plate__word verdict-plate__word--ship";
  return (
    <>
      <p className={wordClass} style={{ color: verdictColour(verdict) }}>
        {verdict}
      </p>
      <p className="verdict-plate__version">{plate.version}</p>
      <p className="verdict-plate__counts">
        <CountFacts facts={plate.countsLine === "" ? [] : plate.countsLine.split(" · ")} />
      </p>
      <p className="verdict-plate__compact" aria-hidden="true">
        {compactCountsParts(plate.countsLine).map((fact, index) => (
          <span key={index} className="verdict-plate__count">
            {fact}
          </span>
        ))}
      </p>
    </>
  );
}

/** The coverage, filed, skipped, quarantined, spoiled, reason or SHIP, and timing lines: the ledger half. */
function LedgerLines({ plate, revealIntervalMs }: { plate: VerdictPlateViewModel; revealIntervalMs: number }) {
  const verdict = plate.verdict;
  if (verdict === null) return null;
  const timing = timingLine(plate, revealIntervalMs);
  return (
    <>
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

export function VerdictPlate({ plate, revealed, revealIntervalMs, part = "both" }: VerdictPlateProps) {
  const hasVerdict = plate.verdict !== null;
  const showPlaque = part !== "ledger";
  const showLedger = part !== "plaque";
  const label = part === "ledger" ? "Verdict details" : "Verdict";
  // The lines are in the page as soon as a verdict exists, but they stay hidden (visibility, not display) until the
  // Reveal has ended. So the plate keeps its final size from the first paint (design pass, item 3).
  const statusClass = revealed ? "verdict-plate__status" : "verdict-plate__status verdict-plate__status--pending";
  return (
    <section className={`verdict-plate verdict-plate--${part}`} aria-label={label}>
      {plate.verdict === null && showPlaque ? (
        <p className="verdict-plate__idle">hollow-inn {plate.version} has not been replayed yet.</p>
      ) : null}
      <div role="status" className={statusClass}>
        {hasVerdict && showPlaque ? <PlaqueLines plate={plate} /> : null}
        {hasVerdict && showLedger ? <LedgerLines plate={plate} revealIntervalMs={revealIntervalMs} /> : null}
      </div>
    </section>
  );
}
