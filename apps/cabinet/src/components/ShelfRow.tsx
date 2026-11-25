/**
 * One rack on its iron shelf (Requirement 7). The rack plate shows the rack code at 28 px, the
 * task given to the agent, the shortened session id and the call count. The jars sit in `seq`
 * order, never in accession order (7.5), and each shelf cell has a stencilled position code from
 * the last letter of the rack code and the 1-based `seq` position (7.6).
 *
 * The view model supplies the order (`rack.jars` is already in seq order), so this component does
 * not sort. Reveal state, the open drawer and activation come from the parent. The "IT'S MOVING"
 * stamp sits on the cell of the first rattled jar, at its top-right corner, and never over the plate.
 */
import type { ReactElement } from "react";
import { pluralise, type JarViewModel, type RackViewModel } from "../cabinet-model.js";
import { STAMP_TEXT } from "../reveal.js";
import "../styles/shelf.css";
import { Jar } from "./Jar.js";

export type ShelfRowProps = {
  rack: RackViewModel;
  /** True for a jar the Reveal has reached. Every other jar reads as "not replayed". */
  isRevealed: (jar: JarViewModel) => boolean;
  /** The accession of the jar whose JarDrawer is open, or null when no drawer is open. */
  expandedAccession: string | null;
  /** The accession of the first rattled jar once the stamp is due, or null. The stamp sits on its cell. */
  stampAccession?: string | null;
  /** The accession of the filed red jar that glows as the "open me" cue, or null (design pass, item 4). */
  cueAccession?: string | null;
  /** The id of the JarDrawer that each jar controls. */
  drawerId: string;
  onActivate: (jar: JarViewModel) => void;
};

export function ShelfRow({
  rack,
  isRevealed,
  expandedAccession,
  stampAccession = null,
  cueAccession = null,
  drawerId,
  onActivate,
}: ShelfRowProps): ReactElement {
  const headingId = `shelf-${rack.code.replace(/ /g, "-").toLowerCase()}`;
  return (
    <section className="shelf" aria-labelledby={headingId}>
      <div className="shelf-plate">
        <header className="shelf-head">
          <h2 id={headingId} className="shelf-title">
            {rack.code}
          </h2>
          <p className="shelf-meta">
            <span className="data" title={rack.sessionId}>
              {rack.shortSessionId}
            </span>
            <span>{pluralise(rack.callCount, "call", "calls")}</span>
          </p>
        </header>
        <p className="shelf-task">
          <q>{rack.task}</q>
        </p>
      </div>
      <ol className="shelf-grid" aria-label={`${rack.code} jars in call order`}>
        {rack.jars.map((jar) => (
          <li key={jar.accession} className="shelf-cell">
            <Jar
              jar={jar}
              revealed={isRevealed(jar)}
              expanded={expandedAccession === jar.accession}
              cue={cueAccession === jar.accession}
              drawerId={drawerId}
              onActivate={onActivate}
            />
            {stampAccession === jar.accession ? (
              <span className="its-moving-stamp" aria-hidden="true">
                {STAMP_TEXT}
              </span>
            ) : null}
            <div className="shelf-lip" aria-hidden="true" />
            <span className="shelf-code">{jar.positionCode}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
