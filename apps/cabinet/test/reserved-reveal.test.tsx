// @vitest-environment jsdom
/**
 * Design pass, items 3, 4 and 6: the reserved classes exist in the stylesheets, the SPEC stub waits
 * for its own jar's reveal, and step 2 of the guide ticks only when the drawer shows the spec.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getBugfixSpecs, type CabinetReplayResult } from "../src/browser-replay.js";
import { Jar } from "../src/components/Jar.js";
import { JarDrawer } from "../src/components/JarDrawer.js";
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
