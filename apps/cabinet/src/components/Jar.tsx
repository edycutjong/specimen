/**
 * One jar as a keyboard-operable button (Requirements 2.16, 8.4 to 8.9, 8.12, 8.13 and 7.8).
 *
 * The SVG comes from `JarArt`, which applies the jar tilt (Requirement 8.2). This component does
 * not tilt the jar again. The toe-tag text, the ABNORMAL or CRACKED strip and the barcode are HTML
 * placed over `TOE_TAG_BOX` and `FLAG_STRIP_BOX` from jar-art.tsx. The tag and strip overlays
 * rotate with the toe-tag angle of the drawing, so the text stays on the tag.
 *
 * The accessible name is set with `aria-label`, so the visible toe-tag text does not change it.
 */
import { Fragment, useEffect, useId, useState, type CSSProperties, type ReactElement } from "react";
import { jarAccessibleName, type JarState, type JarViewModel } from "../cabinet-model.js";
import { FLAG_STRIP_BOX, JarArt, TOE_TAG_BOX, toeTagRotation } from "../jar-art.js";
import "./Jar.css";

export type JarProps = {
  jar: JarViewModel;
  /** False until the Reveal reaches this jar. A jar not yet revealed reads as "not replayed". */
  revealed: boolean;
  /** True while this jar's JarDrawer is open (Requirement 8.13). */
  expanded: boolean;
  /** The id of the JarDrawer that this jar controls. */
  drawerId: string;
  /** Called on activation. The parent toggles the drawer and completes any running Reveal. */
  onActivate: (jar: JarViewModel) => void;
};

/** The viewBox of `JarArt` (`JAR_VIEW_BOX`), as x, y, width and height. */
const VIEW = { x: -26, y: -16, width: 172, height: 222 } as const;

/** The toe-tag pivot in jar viewBox units. It matches `translate(62 140)` in jar-art.tsx. */
const TAG_PIVOT = { x: 62, y: 140 } as const;

/** Percentage box of a viewBox rectangle, relative to the whole jar. */
function jarBoxStyle(box: { x: number; y: number; width: number; height: number }): CSSProperties {
  return {
    left: `${((box.x - VIEW.x) / VIEW.width) * 100}%`,
    top: `${((box.y - VIEW.y) / VIEW.height) * 100}%`,
    width: `${(box.width / VIEW.width) * 100}%`,
    height: `${(box.height / VIEW.height) * 100}%`,
  };
}

/** Percentage box of a viewBox rectangle, relative to the toe-tag box. */
function tagBoxStyle(box: { x: number; y: number; width: number; height: number }): CSSProperties {
  return {
    left: `${((box.x - TOE_TAG_BOX.x) / TOE_TAG_BOX.width) * 100}%`,
    top: `${((box.y - TOE_TAG_BOX.y) / TOE_TAG_BOX.height) * 100}%`,
    width: `${(box.width / TOE_TAG_BOX.width) * 100}%`,
    height: `${(box.height / TOE_TAG_BOX.height) * 100}%`,
  };
}

/** The tool name split after each underscore, so the browser may wrap it there (Requirement 7.8). */
function ToolName({ tool }: { tool: string }): ReactElement {
  const parts = tool.split("_");
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index < parts.length - 1 ? (
            <>
              {part}_<wbr />
            </>
          ) : (
            part
          )}
        </Fragment>
      ))}
    </>
  );
}

/** A decorative barcode. Its bar widths come from the accession, so they do not change per render. */
function Barcode({ accession }: { accession: string }): ReactElement {
  const bars = [...accession].map((char) => 1 + (char.charCodeAt(0) % 3));
  return (
    <span className="jar__barcode" aria-hidden="true">
      {bars.map((width, index) => (
        <span key={index} style={{ width: `${width}px` }} />
      ))}
    </span>
  );
}

export function Jar({ jar, revealed, expanded, drawerId, onActivate }: JarProps): ReactElement {
  const tipId = useId();
  const [tipOpen, setTipOpen] = useState(false);

  const shownState: JarState = revealed ? jar.state : "not replayed";
  const flagWord = revealed ? jar.flagWord : null;
  const accessibleName = revealed
    ? jar.accessibleName
    : jarAccessibleName({ ...jar, state: "not replayed", changes: [], compatible: [], reason: undefined });
  const tipText = revealed ? jar.tooltip : "not replayed";

  // While the tooltip is open, the first Escape closes it and no other handler sees that key press.
  // The listener sits on window in the capture phase, so it runs before any handler further down.
  useEffect(() => {
    if (!tipOpen) return undefined;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setTipOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [tipOpen]);

  const tagStyle: CSSProperties = {
    ...jarBoxStyle(TOE_TAG_BOX),
    transform: `rotate(${toeTagRotation(shownState)}deg)`,
    transformOrigin: `${((TAG_PIVOT.x - TOE_TAG_BOX.x) / TOE_TAG_BOX.width) * 100}% ${
      ((TAG_PIVOT.y - TOE_TAG_BOX.y) / TOE_TAG_BOX.height) * 100
    }%`,
  };

  return (
    <span className="jar" onMouseEnter={() => setTipOpen(true)} onMouseLeave={() => setTipOpen(false)}>
      <button
        type="button"
        className="jar__button"
        aria-label={accessibleName}
        aria-expanded={expanded}
        aria-controls={expanded ? drawerId : undefined}
        aria-describedby={tipOpen ? tipId : undefined}
        data-state={shownState}
        onClick={() => onActivate(jar)}
        onFocus={() => setTipOpen(true)}
        onBlur={() => setTipOpen(false)}
      >
        <span className="jar__art">
          <JarArt
            className="jar__svg"
            state={shownState}
            accession={jar.accession}
            tool={jar.tool}
            tilt={jar.tilt}
          />
          <span className="jar__overlay">
            <span className="jar__tag" style={tagStyle}>
              <span className="jar__accession">{jar.accession}</span>
              <span className="jar__tool">
                <ToolName tool={jar.tool} />
              </span>
              <Barcode accession={jar.accession} />
              {flagWord !== null && (
                <span
                  className={`jar__flag jar__flag--${flagWord === "ABNORMAL" ? "abnormal" : "cracked"}`}
                  style={tagBoxStyle(FLAG_STRIP_BOX)}
                >
                  {flagWord}
                </span>
              )}
            </span>
          </span>
        </span>
      </button>
      {tipOpen && (
        <span id={tipId} role="tooltip" className="jar__tip">
          {tipText}
        </span>
      )}
    </span>
  );
}
