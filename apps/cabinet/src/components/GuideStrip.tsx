/**
 * The GuideStrip (Requirement 13): the three-step "60-second judge path".
 *
 * Ticks live in component state for the page load only. Nothing is written to a cookie, to
 * localStorage or to any other storage (13.7). The numerals are inline SVG paths, so no glyph
 * falls back to a system font (13.1). Each tick is shown as a mark plus the visible text "done"
 * (13.8). The Cold_Open pulse fires once on step 1. Under Reduced_Motion it becomes a static
 * highlight (13.6). Reduced_Motion arrives as a prop, read by the App. This module never reads
 * matchMedia.
 */
import { useEffect, useState, type ReactElement } from "react";
import type { GuideStepState } from "../cabinet-model.js";
import "../styles/guide-strip.css";

export type GuideStripProps = {
  /** The three steps, labels and done flags from the view model. */
  steps: GuideStepState[];
  /** True once the Cold_Open replay and the Reveal have ended (13.5). */
  coldOpenDone: boolean;
  /** True while Reduced_Motion is active. The pulse then becomes a static highlight (13.6). */
  reducedMotion: boolean;
};

/**
 * Numeral paths in a 24 by 24 box, one per step. Stroked, so they draw without any font.
 */
const NUMERAL_PATHS: readonly string[] = [
  "M9 7 L12 4 L12 20",
  "M7 9 Q7 4 12 4 Q17 4 17 9 Q17 12 7 20 L17 20",
  "M7 5 L17 5 L11 11 Q18 12 18 15.5 Q18 20 12 20 Q8 20 7 17",
];

/** The pulse on step 1 is idle until the Cold_Open ends, active once, then spent. */
type PulseState = "idle" | "active" | "spent";

export function GuideStrip({ steps, coldOpenDone, reducedMotion }: GuideStripProps): ReactElement {
  const visible = steps.slice(0, NUMERAL_PATHS.length);
  const [ticked, setTicked] = useState<boolean[]>(() => visible.map((step) => step.done));
  const [pulse, setPulse] = useState<PulseState>("idle");

  // Ticks only go up during a page load. A step that reports done stays done. The effect keys
  // on the `steps` prop, not on the sliced copy, so it does not rerun on every render.
  useEffect(() => {
    setTicked((previous) =>
      steps
        .slice(0, NUMERAL_PATHS.length)
        .map((step, index) => previous[index] === true || step.done),
    );
  }, [steps]);

  // The pulse starts once, when the Cold_Open ends. It never restarts.
  useEffect(() => {
    if (coldOpenDone) {
      setPulse((previous) => (previous === "idle" ? "active" : previous));
    }
  }, [coldOpenDone]);

  function pulseClass(index: number): string {
    if (index !== 0 || pulse !== "active") return "";
    return reducedMotion ? "guide-strip__step--highlight" : "guide-strip__step--pulse";
  }

  return (
    <ol className="guide-strip" aria-label="The 60-second judge path">
      {visible.map((step, index) => {
        const done = ticked[index] === true;
        const classes = [
          "guide-strip__step",
          done ? "guide-strip__step--done" : "",
          pulseClass(index),
        ]
          .filter((name) => name !== "")
          .join(" ");
        return (
          <li
            key={index}
            className={classes}
            data-done={done ? "true" : "false"}
            onAnimationEnd={index === 0 && !reducedMotion ? () => setPulse("spent") : undefined}
          >
            <svg
              className="guide-strip__numeral"
              viewBox="0 0 24 24"
              role="img"
              aria-label={String(index + 1)}
              focusable="false"
            >
              <path d={NUMERAL_PATHS[index] ?? ""} />
            </svg>
            <span className="guide-strip__label">{step.label}</span>
            <span className="guide-strip__tick">
              {done ? (
                <svg className="guide-strip__mark" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <path d="M3 8.5 L6.5 12 L13 4.5" />
                </svg>
              ) : null}
              <span className="guide-strip__state">{done ? "done" : "to do"}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
