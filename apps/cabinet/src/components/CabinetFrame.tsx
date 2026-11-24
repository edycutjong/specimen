/**
 * The cabinet frame (Requirements 14.1 to 14.3): a green-black stone wall with an inline SVG
 * grain, a riveted iron frame, the barred storm window, the stamp, and the four organs MCP,
 * HOOKS, REPLAY and SPEC joined by sutures and bolted in place.
 *
 * The frame is decorative apart from its text. It takes children, which the page places inside
 * the iron frame, and it derives nothing from the replay.
 */
import { Fragment, useId, type ReactElement, type ReactNode } from "react";
import { StormWindow, Suture } from "../jar-art.js";
import "../styles/frame.css";

/** The stamp across the top of the frame (Requirement 14.2). */
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

        <header className="cabinet-frame__top">
          <p className="cabinet-frame__stamp">{FRAME_STAMP}</p>
          <StormWindow className="cabinet-frame__window" />
        </header>

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

        <div className="cabinet-frame__content">{children}</div>
      </div>
    </div>
  );
}
