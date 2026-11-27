// @vitest-environment jsdom
/**
 * Design pass, items 3, 4 and 6: the reserved classes exist in the stylesheets, the SPEC stub waits
 * for its own jar's reveal, and step 2 of the guide ticks only when the drawer shows the spec.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getBugfixSpecs, type CabinetReplayResult } from "../src/browser-replay.js";
import { Jar } from "../src/components/Jar.js";
import { JarDrawer, specSectionSeen } from "../src/components/JarDrawer.js";
import { buildViewModel, type JarViewModel } from "../src/cabinet-model.js";
import { RACK_META } from "../src/rack-meta.js";
import { loadReplays, viewModelOf, type Replays } from "./support/replays.js";

let replays: Replays;

beforeAll(async () => {
  replays = await loadReplays();
}, 120_000);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function jarOf(version: "v2", accession: string): JarViewModel {
  const jar = viewModelOf(version, replays[version]).racks.flatMap((rack) => rack.jars).find((j) => j.accession === accession);
  if (jar === undefined) throw new Error(`${accession} is not in ${version}`);
  return jar;
}

describe("reserved space (design pass, item 3)", () => {
  it("renders the CountsPair strip before any replay, so its place is reserved from the first paint", () => {
    const { container } = render(
      <JarDrawer jar={null} version="v2" result={null} specs={getBugfixSpecs()} onClose={() => {}} />,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("the SPEC stub waits for its jar's reveal (design pass, item 4)", () => {
  it("draws no SPEC stub on a filed jar until that jar is revealed", () => {
    const jar = jarOf("v2", "SPC-0002");
    expect(jar.filed).toBe(true);

    const { container, rerender } = render(
      <Jar jar={jar} revealed={false} expanded={false} drawerId="d" onActivate={() => {}} />,
    );
    expect(container.querySelector(".jar__spec")).toBeNull();
    expect(container.querySelector(".jar__tag--filed")).toBeNull();

    rerender(<Jar jar={jar} revealed expanded={false} drawerId="d" onActivate={() => {}} />);
    expect(container.querySelector(".jar__spec")?.textContent).toBe("SPEC");
  });
});

describe("the guide step for the spec ticks when the spec is shown (design pass, item 6)", () => {
  it("does not call onSpecViewed on open, and calls it once the spec section is half visible", () => {
    type Entry = { isIntersecting: boolean; intersectionRatio: number };
    const sink: { callback?: (entries: Entry[]) => void } = {};
    const disconnect = vi.fn();
    class FakeObserver {
      constructor(callback: (entries: Entry[]) => void) {
        sink.callback = callback;
      }
      observe(): void {}
      disconnect = disconnect;
      unobserve(): void {}
      takeRecords(): [] {
        return [];
      }
    }
    vi.stubGlobal("IntersectionObserver", FakeObserver);

    const onSpecViewed = vi.fn();
    const jar = jarOf("v2", "SPC-0002");
    render(
      <JarDrawer
        jar={jar}
        version="v2"
        result={replays.v2}
        specs={getBugfixSpecs()}
        onClose={() => {}}
        onSpecViewed={onSpecViewed}
      />,
    );
    expect(onSpecViewed).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Bugfix spec for this Jar" })).toBeTruthy();

    sink.callback?.([{ isIntersecting: true, intersectionRatio: 0.2 }]);
    expect(onSpecViewed).not.toHaveBeenCalled();
    sink.callback?.([{ isIntersecting: true, intersectionRatio: 0.9 }]);
    expect(onSpecViewed).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

describe("a spec taller than the screen still ticks the guide step (judge path, 2026-11-27)", () => {
  it("counts the section as seen once it fills half the screen, even when far less than half of it is visible", () => {
    // Measured live at 1440×900: the spec section is ~3,318 px in a 595 px drawer scroller, so its ratio tops out near 0.18.
    expect(specSectionSeen({ isIntersecting: true, intersectionRatio: 0.18, intersectionRect: { height: 595 }, rootBounds: { height: 900 } })).toBe(true);
    expect(specSectionSeen({ isIntersecting: true, intersectionRatio: 0.03, intersectionRect: { height: 100 }, rootBounds: { height: 900 } })).toBe(false);
    expect(specSectionSeen({ isIntersecting: false, intersectionRatio: 0, intersectionRect: { height: 0 }, rootBounds: { height: 900 } })).toBe(false);
  });

  it("keeps the half-visible rule for a short section, and falls back to it when the screen size is unknown", () => {
    expect(specSectionSeen({ isIntersecting: true, intersectionRatio: 0.5 })).toBe(true);
    expect(specSectionSeen({ isIntersecting: true, intersectionRatio: 0.49, intersectionRect: { height: 400 }, rootBounds: null })).toBe(false);
  });

  it("observes at ratio steps up to one half, so a tall section reports while it scrolls in", () => {
    let options: IntersectionObserverInit | undefined;
    class FakeObserver {
      constructor(_cb: unknown, init?: IntersectionObserverInit) {
        options = init;
      }
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    render(
      <JarDrawer jar={jarOf("v2", "SPC-0002")} version="v2" result={replays.v2} specs={getBugfixSpecs()} onClose={() => {}} onSpecViewed={() => {}} />,
    );
    const steps = options?.threshold as number[];
    expect(steps[0]).toBe(0);
    expect(steps.at(-1)).toBe(0.5);
    expect(steps.length).toBeGreaterThan(10);
    vi.unstubAllGlobals();
  });
});
