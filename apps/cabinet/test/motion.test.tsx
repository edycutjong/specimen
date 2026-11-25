// @vitest-environment jsdom
/**
 * Requirements 2.3, 2.13, 2.14, 2.15 and 16.5 for the cold-open motion. The page is the real App
 * and the pacing is the real `reveal.ts`. The replay is the real hollow-inn over InMemoryTransport.
 * Only `window.matchMedia` is mocked, and only for the Reduced_Motion query. The MCP SDK is not
 * touched.
 *
 * Fake timers replace `setTimeout` only. The replay and React's scheduler keep the real
 * `setImmediate`, so the replay can finish while the Reveal's 250 ms steps are advanced by hand.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.js";
import { runReplay } from "../src/browser-replay.js";
import { revealOrder } from "../src/cabinet-model.js";
import {
  COLD_OPEN_BOUND_MS,
  COLD_OPEN_LEAD_MS,
  NO_MOTION_CLASS,
  REDUCED_MOTION_QUERY,
  REVEAL_INTERVAL_MS,
  STAMP_TEXT,
  revealIntervalFor,
  revealSpanMs,
} from "../src/reveal.js";
import { viewModelOf } from "./support/replays.js";

const IDLE_TEXT = /has not been replayed yet/;
const JAR_COUNT = 10;

type MediaListener = (event: MediaQueryListEvent) => void;

type MotionControl = {
  /** Changes the Reduced_Motion query and fires its `change` listeners, as a live OS setting would. */
  setReduced: (value: boolean) => void;
  /** The number of `change` listeners the page has attached to the Reduced_Motion query. */
  listenerCount: () => number;
};

/** Replaces `window.matchMedia` with a mock whose Reduced_Motion query can change while the page is open. */
function installReducedMotion(initial: boolean): MotionControl {
  let matches = initial;
  const listeners = new Set<MediaListener>();

  window.matchMedia = ((query: string) => ({
    get matches() {
      return query === REDUCED_MOTION_QUERY ? matches : false;
    },
    media: query,
    onchange: null,
    addEventListener: (type: string, listener: MediaListener) => {
      if (type === "change" && query === REDUCED_MOTION_QUERY) listeners.add(listener);
    },
    removeEventListener: (type: string, listener: MediaListener) => {
      if (type === "change") listeners.delete(listener);
    },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  return {
    setReduced: (value: boolean) => {
      matches = value;
      for (const listener of [...listeners]) {
        listener({ matches: value, media: REDUCED_MOTION_QUERY } as MediaQueryListEvent);
      }
    },
    listenerCount: () => listeners.size,
  };
}

/** The jar buttons in the DOM. Each one is labelled with its accessible name (Requirement 8.7). */
function jarButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(".jar__button"));
}

/** The accessions of the jars that have taken their state, in rack order. A jar not yet reached reads "not replayed". */
function revealedAccessions(): string[] {
  return jarButtons()
    .map((button) => button.getAttribute("aria-label") ?? "")
    .filter((label) => !label.endsWith("— not replayed"))
    .map((label) => label.split(" ")[0] ?? "");
}

/** The verdict word once it is shown. A plate still hidden for the Reveal reports null (design pass, item 3). */
function verdictWord(): string | null {
  if (document.querySelector(".verdict-plate__status--pending") !== null) return null;
  return document.querySelector(".verdict-plate__word")?.textContent ?? null;
}

/** Waits, on real timers, until the replay has reached the page. Fake timers never block this loop. */
async function settleReplay(): Promise<void> {
  for (let turn = 0; turn < 5000; turn += 1) {
    if (!IDLE_TEXT.test(document.body.textContent ?? "")) return;
    await act(async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
    });
  }
  throw new Error("the replay did not reach the page");
}

/** The clock moves in these steps. Both the lead-in and the Reveal_Interval are multiples of 10 ms. */
const CLOCK_STEP_MS = 10;

/**
 * Moves the fake clock forward by `ms`. Each Reveal timer schedules the next one from a React
 * effect, and that effect runs only when its `act` scope closes. The clock therefore moves in
 * steps of 10 ms, each inside its own `act`, so every timer is armed at its real time.
 */
function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(0);
  });
  let left = ms;
  while (left > 0) {
    const step = Math.min(left, CLOCK_STEP_MS);
    act(() => {
      vi.advanceTimersByTime(step);
    });
    left -= step;
  }
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (window as { matchMedia?: unknown }).matchMedia;
  document.documentElement.classList.remove(NO_MOTION_CLASS);
});

describe("Reduced_Motion class and live changes (Requirements 2.13, 2.14, 16.5)", () => {
  it("applies the no-motion class to html while the query matches, and removes it when it stops", () => {
    const motion = installReducedMotion(false);
    render(<App />);
    expect(document.documentElement.classList.contains(NO_MOTION_CLASS)).toBe(false);

    act(() => motion.setReduced(true));
    expect(document.documentElement.classList.contains(NO_MOTION_CLASS)).toBe(true);

    act(() => motion.setReduced(false));
    expect(document.documentElement.classList.contains(NO_MOTION_CLASS)).toBe(false);
  });

  it("applies the class on first render when the query already matches", () => {
    installReducedMotion(true);
    render(<App />);
    expect(document.documentElement.classList.contains(NO_MOTION_CLASS)).toBe(true);
  });

  it("removes its change listener on unmount", () => {
    const motion = installReducedMotion(false);
    const view = render(<App />);
    expect(motion.listenerCount()).toBe(1);
    view.unmount();
    expect(motion.listenerCount()).toBe(0);
  });

  it("sets the Reveal interval to 0 under Reduced_Motion, so every jar and the stamp show at once", async () => {
    expect(revealIntervalFor(true)).toBe(0);
    expect(revealIntervalFor(false)).toBe(REVEAL_INTERVAL_MS);

    installReducedMotion(true);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<App />);
    await settleReplay();

    expect(revealedAccessions()).toHaveLength(JAR_COUNT);
    expect(verdictWord()).toBe("HOLD");

    advance(0);
    expect(screen.getByText(STAMP_TEXT)).toBeTruthy();
  });

  it("honours a live change: a Reveal in progress completes at once when Reduced_Motion turns on", async () => {
    const motion = installReducedMotion(false);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<App />);
    await settleReplay();

    advance(COLD_OPEN_LEAD_MS + 500);
    expect(revealedAccessions()).toHaveLength(3);
    expect(verdictWord()).toBeNull();

    act(() => motion.setReduced(true));

    expect(document.documentElement.classList.contains(NO_MOTION_CLASS)).toBe(true);
    expect(revealedAccessions()).toHaveLength(JAR_COUNT);
    expect(verdictWord()).toBe("HOLD");
  });
});

describe("Reveal order and interval (Requirement 2.3)", () => {
  it("reveals one jar at a time in revealOrder, 250 ms apart, after the 620 ms cold-open lightning", async () => {
    const replay = await runReplay("v2");
    const expected = revealOrder(viewModelOf("v2", replay)).map((jar) => jar.accession);
    expect(expected).toHaveLength(JAR_COUNT);

    installReducedMotion(false);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<App />);
    await settleReplay();

    expect(revealedAccessions()).toEqual([]);

    advance(COLD_OPEN_LEAD_MS - 1);
    expect(revealedAccessions()).toEqual([]);

    advance(1);
    expect(revealedAccessions()).toEqual(expected.slice(0, 1));

    advance(REVEAL_INTERVAL_MS - 1);
    expect(revealedAccessions()).toEqual(expected.slice(0, 1));

    advance(1);
    expect(revealedAccessions()).toEqual(expected.slice(0, 2));

    for (let count = 3; count <= JAR_COUNT; count += 1) {
      advance(REVEAL_INTERVAL_MS);
      expect(revealedAccessions()).toEqual(expected.slice(0, count));
    }

    expect(verdictWord()).toBe("HOLD");
  });
});

describe("Completion on user action (Requirement 2.15)", () => {
  it("completes the Reveal at once when a jar is pressed, before the action takes effect", async () => {
    installReducedMotion(false);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<App />);
    await settleReplay();

    advance(COLD_OPEN_LEAD_MS + 750);
    expect(revealedAccessions()).toHaveLength(4);
    expect(verdictWord()).toBeNull();

    fireEvent.pointerDown(jarButtons()[JAR_COUNT - 1] as HTMLButtonElement);

    expect(revealedAccessions()).toHaveLength(JAR_COUNT);
    expect(verdictWord()).toBe("HOLD");
  });

  it("completes the Reveal at once on a key press", async () => {
    installReducedMotion(false);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<App />);
    await settleReplay();

    advance(COLD_OPEN_LEAD_MS + 250);
    expect(revealedAccessions()).toHaveLength(2);

    fireEvent.keyDown(document.body, { key: "ArrowDown" });

    expect(revealedAccessions()).toHaveLength(JAR_COUNT);
    expect(verdictWord()).toBe("HOLD");
  });
});

describe("Cold-open bound (design, 4.5 s)", () => {
  it("keeps the replay time plus the Reveal span inside COLD_OPEN_BOUND_MS", async () => {
    const replay = await runReplay("v2");
    const jarCount = revealOrder(viewModelOf("v2", replay)).length;

    expect(revealSpanMs(jarCount, false)).toBe((JAR_COUNT - 1) * REVEAL_INTERVAL_MS + 700);
    expect(replay.replayTimeMs + revealSpanMs(jarCount, false)).toBeLessThanOrEqual(COLD_OPEN_BOUND_MS);
  });

  it("finishes a real-time cold open, from render to the stamp and the verdict, inside the bound", async () => {
    installReducedMotion(false);
    const start = performance.now();
    render(<App />);

    await waitFor(() => expect(verdictWord()).toBe("HOLD"), { timeout: COLD_OPEN_BOUND_MS + 2000 });
    await screen.findByText(STAMP_TEXT, undefined, { timeout: COLD_OPEN_BOUND_MS + 2000 });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThanOrEqual(COLD_OPEN_BOUND_MS);
  }, 20_000);
});
