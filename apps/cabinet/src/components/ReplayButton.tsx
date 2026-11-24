/**
 * The ReplayButton (Requirement 3.6, 3.7). While a replay runs it sets `aria-disabled="true"`,
 * stays focusable, ignores activation, and shows the elapsed milliseconds as a display-only
 * counter. The counter is a view of the clock only. It is never a replay input, and the
 * Replay_Time shown on the VerdictPlate comes from `runReplay`, not from this component.
 */
import { useEffect, useState } from "react";
import type { HollowInnVersion } from "../browser-replay.js";

export const ELAPSED_TICK_MS = 16;

/** Whole milliseconds since `startedAt`, never negative. */
export function elapsedMs(startedAt: number, now: number): number {
  return Math.max(0, Math.round(now - startedAt));
}

export type ReplayButtonProps = {
  version: HollowInnVersion;
  running: boolean;
  onReplay: () => void;
};

export function ReplayButton({ version, running, onReplay }: ReplayButtonProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!running) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(elapsedMs(startedAt, Date.now())), ELAPSED_TICK_MS);
    return () => clearInterval(timer);
  }, [running]);

  return (
    <div className="replay-button">
      <button
        type="button"
        className="replay-button__control"
        aria-disabled={running ? "true" : "false"}
        onClick={() => {
          if (!running) onReplay();
        }}
      >
        Replay {version}
      </button>
      {running ? (
        <span className="replay-button__elapsed" aria-hidden="true">
          {elapsed} ms
        </span>
      ) : null}
    </div>
  );
}
