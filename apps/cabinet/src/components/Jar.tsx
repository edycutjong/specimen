/**
 * One jar as a keyboard-operable button (Requirements 2.16, 8.4 to 8.9, 8.12, 8.13 and 7.8).
 *
 * The SVG comes from `JarArt`, which applies the jar tilt (Requirement 8.2). The toe-tag is HTML over
 * the jar: a manila tag with the accession, the tool name, a decorative barcode and, after a replay,
 * the ABNORMAL or CRACKED flag strip. The tag's string is drawn in the SVG and ends at the tag's eyelet.
 * The overlay turns with the seeded jar tilt, so the tag stays on the jar, and the tag adds its own
 * hang angle on top.
 *
 * The accessible name is set with `aria-label`, so the visible toe-tag text does not change it.
 */
import { useEffect, useId, useState, type CSSProperties, type ReactElement } from "react";
import { jarAccessibleName, type JarState, type JarViewModel } from "../cabinet-model.js";
import { JarArt, toeTagRotation } from "../jar-art.js";
import "./Jar.css";

export type JarProps = {
  jar: JarViewModel;
  /** False until the Reveal reaches this jar. A jar not yet revealed reads as "not replayed". */
  revealed: boolean;
  /** True while this jar's JarDrawer is open (Requirement 8.13). */
  expanded: boolean;
  /** True while the "open me" glow plays on this filed red jar (design pass, item 4). */
  cue?: boolean;
  /** The id of the JarDrawer that this jar controls. */
  drawerId: string;
  /** Called on activation. The parent toggles the drawer and completes any running Reveal. */
  onActivate: (jar: JarViewModel) => void;
};

/**
 * The tool name as one unbreakable word. The tag is sized so the longest tool name fits one line, so the name never
 * breaks at an underscore (QA round 3, item 12).
 */
function ToolName({ tool }: { tool: string }): ReactElement {
  return <>{tool}</>;
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

export function Jar({ jar, revealed, expanded, cue = false, drawerId, onActivate }: JarProps): ReactElement {
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

  // The SPEC stub and its band wait for this jar's own reveal, so a filed jar gives nothing away early (design pass, item 4).
  const filedShown = revealed && jar.filed;
  const tagClass = [
    "jar__tag",
    flagWord === null ? "" : "jar__tag--flagged",
    filedShown ? "jar__tag--filed" : "",
  ]
    .filter((name) => name !== "")
    .join(" ");

  // The hang angle of the tag is a custom property, so the stylesheet owns the transform.
  const tagStyle = { "--tag-rotate": `${toeTagRotation(shownState)}deg` } as CSSProperties;
  const overlayStyle: CSSProperties | undefined = jar.tilt === 0 ? undefined : { transform: `rotate(${jar.tilt}deg)` };

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
          <span className={cue ? "jar__overlay jar__overlay--cue" : "jar__overlay"} style={overlayStyle}>
            <span className={tagClass} style={tagStyle}>
              <span className="jar__eyelet" aria-hidden="true" />
              <span className="jar__accession">{jar.accession}</span>
              <span className="jar__tool">
                <ToolName tool={jar.tool} />
              </span>
              <Barcode accession={jar.accession} />
              {filedShown ? (
                <span className="jar__spec" aria-hidden="true">
                  SPEC
                </span>
              ) : null}
              {flagWord !== null && (
                <span
                  className={`jar__flag jar__flag--${flagWord === "ABNORMAL" ? "abnormal" : "cracked"} jar-art__strip`}
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
