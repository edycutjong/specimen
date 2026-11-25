/**
 * The cold-open timeline and motion (Requirements 2.2 to 2.17, 13.5, 13.6).
 *
 * The Replay_Module runs at full speed. Only the Reveal waits, and only in this file:
 *   - jar k in `revealOrder` takes its state at k × REVEAL_INTERVAL_MS (the first at 0 ms);
 *   - any user action completes the Reveal at once, before the action takes effect;
 *   - the VerdictPlate and the GuideStrip pulse read `complete`, which is false until every jar
 *     has taken its state;
 *   - the "IT'S MOVING" stamp appears once per page load, REVEAL_SETTLE_MS after the first
 *     rattled jar is revealed, so its flood has settled.
 *
 * Under Reduced_Motion the interval is 0, so every jar takes its state at once, and the stamp
 * appears without waiting. The `no-motion` class on `<html>` lets CSS switch off every animation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JarViewModel } from "./cabinet-model.js";

/** The fixed delay between one Jar's reveal and the next (Requirement 2.3, 2.5). */
export const REVEAL_INTERVAL_MS = 250;

/** The longest rattled-jar animation, the 700 ms flood (Requirement 2.8). */
export const REVEAL_SETTLE_MS = 700;

/** The cold-open lightning: a 300 ms hold, then two 120 ms flashes 80 ms apart (design pass, item 2). */
export const LIGHTNING_HOLD_MS = 300;
export const LIGHTNING_FLASH_MS = 120;
export const LIGHTNING_GAP_MS = 80;

/** The lead-in before the first jar takes its state: the hold and both flashes. */
export const COLD_OPEN_LEAD_MS = LIGHTNING_HOLD_MS + LIGHTNING_FLASH_MS + LIGHTNING_GAP_MS + LIGHTNING_FLASH_MS;

/** The one flash the moment the first red jar flips. */
export const RED_FLIP_FLASH_MS = 120;

/** The storm at replay start: a --storm overlay over the shelves and a window flash, for this long (design pass, item 10). */
export const STORM_MS = 120;

/** The replay count counts up over this many ms, after the settle (design pass, item 2). */
export const COUNT_UP_MS = 400;

/** The whole cold open, Replay_Time included, must finish inside this bound (design, Testing Strategy). */
export const COLD_OPEN_BOUND_MS = 4500;

/** The Reduced_Motion media condition (Requirement 2.14, 13). */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** The class that `useReducedMotion` puts on `<html>` while Reduced_Motion is active. */
export const NO_MOTION_CLASS = "no-motion";

/** The rubber stamp text (Requirement 2.10). */
export const STAMP_TEXT = "IT'S MOVING";

/** The Reveal_Interval in ms for the given motion setting. Reduced_Motion makes it 0 (Requirement 13). */
export function revealIntervalFor(reducedMotion: boolean): number {
  return reducedMotion ? 0 : REVEAL_INTERVAL_MS;
}

/**
 * The time from the start of the Reveal until the last jar's animation has settled. Ten jars
 * give 2250 ms of reveal and 700 ms of settle, 2950 ms in all.
 */
export function revealSpanMs(jarCount: number, reducedMotion: boolean): number {
  if (jarCount <= 0) return 0;
  const settle = reducedMotion ? 0 : REVEAL_SETTLE_MS;
  return (jarCount - 1) * revealIntervalFor(reducedMotion) + settle;
}

/**
 * Tracks the Reduced_Motion query and follows its live changes (Requirement 2.14). It also sets
 * the `no-motion` class on `<html>`, so CSS in `motion.css` can switch off every animation.
 */
export function useReducedMotion(): boolean {
  const supported = typeof window !== "undefined" && typeof window.matchMedia === "function";
  const [reduced, setReduced] = useState<boolean>(() =>
    supported ? window.matchMedia(REDUCED_MOTION_QUERY).matches : false,
  );

  useEffect(() => {
    if (!supported) return undefined;
    const list = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches);
    setReduced(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [supported]);

  useEffect(() => {
    document.documentElement.classList.toggle(NO_MOTION_CLASS, reduced);
  }, [reduced]);

  return reduced;
}

export type Reveal = {
  /** True once the Reveal has reached this jar. A jar not yet reached shows "not replayed". */
  isRevealed: (jar: JarViewModel) => boolean;
  /** True once every jar has taken its state. False while no result is shown. */
  complete: boolean;
  /** The accession of the rattled jar that the stamp sits beside, or null until the stamp is due. */
  stampAccession: string | null;
};

type RunState = {
  /** The result this run reveals. A new result starts a new run. */
  source: object | null;
  /** How many jars, in reveal order, the timer has reached. */
  count: number;
  /** True after a user action has completed the Reveal at once. */
  skipped: boolean;
};

/**
 * Paces the Reveal of one replay result over `order` (the jars in `revealOrder`). `source` is the
 * current Replay_Result, or null when none is shown. A new `source` restarts the Reveal from the
 * first jar.
 */
export function useReveal(
  order: readonly JarViewModel[],
  source: object | null,
  reducedMotion: boolean,
  leadMs = 0,
): Reveal {
  const total = order.length;
  const interval = revealIntervalFor(reducedMotion);
  const active = source !== null;

  const [stored, setStored] = useState<RunState>({ source, count: 0, skipped: false });
  let run = stored;
  if (stored.source !== source) {
    run = { source, count: 0, skipped: false };
    setStored(run);
  }

  const { count, skipped } = run;
  const effectiveCount = !active ? 0 : reducedMotion || skipped ? total : count;
  const complete = active && effectiveCount >= total;

  // One timer per jar. The first jar takes its state after the lead-in (the lightning), and each
  // later jar waits one interval.
  useEffect(() => {
    if (!active || reducedMotion || skipped || count >= total) return undefined;
    const delay = count === 0 ? leadMs : interval;
    const id = window.setTimeout(() => {
      setStored((current) =>
        current.source === source && !current.skipped ? { ...current, count: current.count + 1 } : current,
      );
    }, delay);
    return () => window.clearTimeout(id);
  }, [active, source, count, skipped, total, reducedMotion, interval, leadMs]);

  // Any user action completes the Reveal at once. The listeners sit in the capture phase, so the
  // Reveal is complete before a Jar, the ReplayButton or the ServerSwitch takes its action.
  const skip = useCallback((): void => {
    setStored((current) =>
      current.source === source && !current.skipped ? { ...current, skipped: true } : current,
    );
  }, [source]);

  useEffect(() => {
    if (!active || complete) return undefined;
    window.addEventListener("pointerdown", skip, true);
    window.addEventListener("keydown", skip, true);
    return () => {
      window.removeEventListener("pointerdown", skip, true);
      window.removeEventListener("keydown", skip, true);
    };
  }, [active, complete, skip]);

  const rank = useMemo(() => new Map(order.map((jar, index) => [jar, index] as const)), [order]);
  const isRevealed = useCallback(
    (jar: JarViewModel): boolean => {
      const index = rank.get(jar);
      return index !== undefined && index < effectiveCount;
    },
    [rank, effectiveCount],
  );

  // The stamp is due once, when the first rattled jar is revealed, after its flood has settled.
  const firstRattledIndex = useMemo(() => order.findIndex((jar) => jar.state === "rattled"), [order]);
  const firstRattled = firstRattledIndex >= 0 ? order[firstRattledIndex] : undefined;
  const firstRattledRevealed = firstRattled !== undefined && firstRattledIndex < effectiveCount;

  const [stampAccession, setStampAccession] = useState<string | null>(null);
  const stampStarted = useRef(false);
  const stampTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!firstRattledRevealed || firstRattled === undefined || stampStarted.current) return;
    stampStarted.current = true;
    const delay = reducedMotion ? 0 : REVEAL_SETTLE_MS;
    stampTimer.current = window.setTimeout(() => {
      stampTimer.current = null;
      setStampAccession(firstRattled.accession);
    }, delay);
  }, [firstRattled, firstRattledRevealed, reducedMotion]);

  useEffect(
    () => () => {
      if (stampTimer.current !== null) window.clearTimeout(stampTimer.current);
    },
    [],
  );

  return { isRevealed, complete, stampAccession };
}

/**
 * The cold-open lightning and the red-flip flash (design pass, item 2). `source` is the Replay_Result
 * shown, so each new result runs the cold-open lightning once: a flash at the end of the hold and
 * another after the gap. `firstRedRevealed` turns true when the first red jar takes its state, and
 * that fires one more flash. Under Reduced_Motion nothing flashes. Returns true while the wall and
 * the window are lit.
 */
export function useLightning(source: object | null, reducedMotion: boolean, firstRedRevealed: boolean): boolean {
  const [coldOpenLit, setColdOpenLit] = useState(false);
  const [redLit, setRedLit] = useState(false);

  useEffect(() => {
    setColdOpenLit(false);
    if (source === null || reducedMotion) return undefined;
    const firstStart = LIGHTNING_HOLD_MS;
    const secondStart = firstStart + LIGHTNING_FLASH_MS + LIGHTNING_GAP_MS;
    const timers = [
      window.setTimeout(() => setColdOpenLit(true), firstStart),
      window.setTimeout(() => setColdOpenLit(false), firstStart + LIGHTNING_FLASH_MS),
      window.setTimeout(() => setColdOpenLit(true), secondStart),
      window.setTimeout(() => setColdOpenLit(false), secondStart + LIGHTNING_FLASH_MS),
    ];
    return () => {
      for (const id of timers) window.clearTimeout(id);
      setColdOpenLit(false);
    };
  }, [source, reducedMotion]);

  useEffect(() => {
    setRedLit(false);
    if (!firstRedRevealed || reducedMotion) return undefined;
    setRedLit(true);
    const id = window.setTimeout(() => setRedLit(false), RED_FLIP_FLASH_MS);
    return () => {
      window.clearTimeout(id);
      setRedLit(false);
    };
  }, [firstRedRevealed, reducedMotion, source]);

  return coldOpenLit || redLit;
}
