/**
 * The ServerSwitch (Requirement 3). It offers exactly the Versions v1, v2 and v2.1. At 600 px and
 * wider it is a segmented control (radio group with roving tabindex, arrow keys move and select).
 * Below 600 px it is a native select. The selected Version is exposed as `aria-checked` in the
 * segmented form and as the select value in the narrow form. The matching CHANGES.md entry is not
 * part of this control: the App shows it under the CountsPair (see VersionNotes).
 *
 * The switch never takes a running flag: it stays enabled while a replay runs (Requirement 3.11).
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { HollowInnVersion } from "../browser-replay.js";
import "../styles/controls.css";

/** The Versions the switch offers, in display order (Requirement 3.1). */
export const SWITCH_VERSIONS: readonly HollowInnVersion[] = ["v1", "v2", "v2.1"];

/** Width at and above which the segmented control replaces the select (Requirements 3.2, 3.3). */
export const SEGMENTED_MIN_WIDTH_PX = 600;

const WIDE_QUERY = `(min-width: ${SEGMENTED_MIN_WIDTH_PX}px)`;

/**
 * True when the viewport is at least 600 px wide. Without `matchMedia` (jsdom by default) the
 * wide form is used. The hook follows live changes of the media query.
 */
export function useWideViewport(): boolean {
  const [wide, setWide] = useState<boolean>(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
    return window.matchMedia(WIDE_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(WIDE_QUERY);
    const onChange = (event: { matches: boolean }) => setWide(event.matches);
    setWide(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, []);

  return wide;
}

export type ServerSwitchProps = {
  version: HollowInnVersion;
  onVersionChange: (version: HollowInnVersion) => void;
};

export function ServerSwitch({ version, onVersionChange }: ServerSwitchProps) {
  const wide = useWideViewport();

  return (
    <div className="server-switch">
      {wide ? (
        <SegmentedSwitch version={version} onVersionChange={onVersionChange} />
      ) : (
        <select
          className="server-switch__select"
          aria-label="Server version"
          value={version}
          onChange={(event) => onVersionChange(event.target.value as HollowInnVersion)}
        >
          {SWITCH_VERSIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

type SegmentedProps = ServerSwitchProps;

function SegmentedSwitch({ version, onVersionChange }: SegmentedProps) {
  const buttons = useRef<Map<HollowInnVersion, HTMLButtonElement>>(new Map());

  const select = (next: HollowInnVersion) => {
    onVersionChange(next);
    buttons.current.get(next)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = SWITCH_VERSIONS.indexOf(version);
    const last = SWITCH_VERSIONS.length - 1;
    let next: number | null = null;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        next = index === last ? 0 : index + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        next = index === 0 ? last : index - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = SWITCH_VERSIONS[next];
    if (target !== undefined) select(target);
  };

  return (
    <div className="server-switch__segments" role="radiogroup" aria-label="Server version">
      {SWITCH_VERSIONS.map((v) => {
        const checked = v === version;
        return (
          <button
            key={v}
            ref={(node) => {
              if (node === null) buttons.current.delete(v);
              else buttons.current.set(v, node);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className="server-switch__segment"
            onClick={() => onVersionChange(v)}
            onKeyDown={onKeyDown}
          >
            {v}
          </button>
        );
      })}
    </div>
  );
}
