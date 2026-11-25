/**
 * The cabinet wall (Requirements 14.1 to 14.3): a green-black stone wall with an inline SVG grain,
 * a riveted iron frame, and the stamp and the four organs MCP, HOOKS, REPLAY and SPEC joined by sutures.
 *
 * The wall is one composition. The page places its content on the iron, and `FrameSuture` closes the
 * wall at the bottom with the stamp on the left and the organs on the right. The barred storm window is
 * not part of the frame. The App places it in the wall grid beside the verdict text (see `cabinet-wall`).
 *
 * Below 1280 px there is no window, so the lightning flash falls back to a wash over the iron. The
 * frame is decorative apart from its text. It takes children, which the page places on the wall, and it
 * derives nothing from the replay.
 */
import { Fragment, useId, type ReactElement, type ReactNode } from "react";
import { Suture } from "../jar-art.js";
import "../styles/frame.css";

/** The stamp across the bottom of the wall (Requirement 14.2). */
export const FRAME_STAMP = "KIROWEEN 2026 · FRANKENSTEIN";

/** The four organs in the order they are joined (Requirement 14.3). */
export const ORGANS = ["MCP", "HOOKS", "REPLAY", "SPEC"] as const;

const RIVETS = ["tl", "tr", "bl", "br"] as const;

/** React's useId output can contain characters that are unsafe in `url(#…)` references. */
const safeId = (raw: string): string => raw.replace(/[^A-Za-z0-9_-]/g, "");

export type CabinetFrameProps = {
  children?: ReactNode;
};

export function CabinetFrame({ children }: CabinetFrameProps): ReactElement {
  const grainId = `frame-grain-${safeId(useId())}`;

  return (
    <div className="cabinet-frame">
      <svg className="cabinet-frame__grain" aria-hidden="true" focusable="false">
        <defs>
          <filter id={grainId} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={3} stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </defs>
        <rect width="100%" height="100%" filter={`url(#${grainId})`} />
      </svg>

      <div className="cabinet-frame__iron">
        {RIVETS.map((corner) => (
          <span key={corner} aria-hidden="true" className={`cabinet-frame__rivet cabinet-frame__rivet--${corner}`} />
        ))}

        {/* The lightning wash. It shows only below 1280 px, where the storm window is hidden. */}
        <span aria-hidden="true" className="storm-window__wash" />

        <div className="cabinet-frame__content">{children}</div>
      </div>
    </div>
  );
}

/** The bottom row of the wall: the stamp on the left, the four organs joined by sutures on the right. */
export function FrameSuture(): ReactElement {
  return (
    <div className="cabinet-frame__suture-row">
      <p className="cabinet-frame__stamp">{FRAME_STAMP}</p>
      <div className="cabinet-frame__organs" role="group" aria-label="Organs">
        {ORGANS.map((organ, index) => (
          <Fragment key={organ}>
            {index > 0 ? <Suture w={48} className="cabinet-frame__suture" /> : null}
            <span className="cabinet-frame__organ">
              <span aria-hidden="true" className="cabinet-frame__bolt cabinet-frame__bolt--left" />
              <span>{organ}</span>
              <span aria-hidden="true" className="cabinet-frame__bolt cabinet-frame__bolt--right" />
            </span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}
