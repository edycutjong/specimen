// @vitest-environment jsdom
/**
 * Requirements 10.1 to 10.15 and 3.12 for the JarDrawer. The jars come from real runReplay()
 * results for v2 and v2.1 over the committed jars. Nothing is mocked.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import type { BugfixSpec } from "@specimen/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getBugfixSpecs, type CabinetReplayResult } from "../src/browser-replay.js";
import type { CabinetViewModel, JarViewModel } from "../src/cabinet-model.js";
import { drawerFormFor, JarDrawer } from "../src/components/JarDrawer.js";
import { loadReplays, viewModelOf, type Replays } from "./support/replays.js";

let replays: Replays;
let specs: BugfixSpec[];
const originalWidth = window.innerWidth;

beforeAll(async () => {
  replays = await loadReplays();
  specs = getBugfixSpecs();
}, 120_000);

afterEach(() => {
  cleanup();
  window.innerWidth = originalWidth;
});

afterAll(() => {
  window.innerWidth = originalWidth;
});

/** The JarViewModel of one accession in a view model. */
function jarIn(model: CabinetViewModel, id: string): JarViewModel {
  const jar = model.racks.flatMap((rack) => rack.jars).find((candidate) => candidate.id === id);
  if (jar === undefined) throw new Error(`${id} is not on a shelf`);
  return jar;
}

/** The JarViewModel of an accession replayed in one Version. */
function replayedJar(version: keyof Replays, id: string): JarViewModel {
  return jarIn(viewModelOf(version, replays[version]), id);
}

function drawerFor(
  jar: JarViewModel | null,
  version: "v2" | "v2.1",
  result: CabinetReplayResult | null = null,
  onClose: () => void = () => {},
) {
  return <JarDrawer jar={jar} version={version} result={result} specs={specs} onClose={onClose} />;
}

/** The drawer heading. The spec body below it can hold other level-2 headings, so the class is used. */
function headingOf(): HTMLElement {
  const heading = document.querySelector<HTMLElement>(".jar-drawer__heading");
  if (heading === null) throw new Error("the drawer heading is not rendered");
  return heading;
}

function tabsOf(): { jarred: HTMLElement; replayed: HTMLElement } {
  const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
  const [jarred, replayed] = tabs;
  if (jarred === undefined || replayed === undefined) throw new Error("expected two tabs");
  return { jarred, replayed };
}

describe("JarDrawer tabs (Requirement 10.12)", () => {
  it("exposes Jarred and Replayed as tabs and moves between them with arrow keys, Home and End", () => {
    const jar = replayedJar("v2", "SPC-0002");
    render(drawerFor(jar, "v2", replays.v2));

    const { jarred, replayed } = tabsOf();
    expect(jarred.textContent).toBe("Jarred");
    expect(replayed.textContent).toBe("Replayed");
    expect(jarred.getAttribute("aria-selected")).toBe("true");
    expect(replayed.getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tabpanel").textContent).toContain(jar.responseText ?? "");

    fireEvent.keyDown(jarred, { key: "ArrowRight" });
    expect(replayed.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(replayed);
    expect(screen.getByRole("tabpanel").textContent).toContain(jar.replayedText ?? "");

    fireEvent.keyDown(replayed, { key: "ArrowRight" });
    expect(jarred.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(jarred);

    fireEvent.keyDown(jarred, { key: "End" });
    expect(replayed.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(replayed, { key: "Home" });
    expect(jarred.getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(jarred, { key: "ArrowLeft" });
    expect(replayed.getAttribute("aria-selected")).toBe("true");
  });

  it("shows the failure reason under Replayed when replayed_text is null", () => {
    const jar = replayedJar("v2", "SPC-0009");
    expect(jar.replayedText).toBeNull();
    render(drawerFor(jar, "v2", replays.v2));

    const { replayed } = tabsOf();
    fireEvent.click(replayed);
    expect(within(screen.getByRole("tabpanel")).getByText("tool not in tools/list")).toBeTruthy();
  });
});

describe("JarDrawer not replayed (Requirement 10.14, 3.12)", () => {
  it("shows the jarred content, disables the Replayed tab and states that no replay was made", () => {
    const jar = jarIn(viewModelOf("v2", null), "SPC-0002");
    render(drawerFor(jar, "v2", null));

    const { jarred, replayed } = tabsOf();
    expect(replayed.hasAttribute("disabled")).toBe(true);
    expect(jarred.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Jarred input")).toBeTruthy();
    expect(screen.getByText(/no replay has been made for this version/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("stays open on the same Jar when the Version changes to a not-replayed state", () => {
    const replayedFirst = replayedJar("v2", "SPC-0002");
    const { rerender } = render(drawerFor(replayedFirst, "v2", replays.v2));
    expect(screen.getByRole("table")).toBeTruthy();

    const notReplayed = jarIn(viewModelOf("v2.1", null), "SPC-0002");
    rerender(drawerFor(notReplayed, "v2.1", null));

    expect(headingOf().textContent).toBe("SPC-0002");
    expect(tabsOf().replayed.hasAttribute("disabled")).toBe(true);
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("JarDrawer focus (Requirements 10.8, 10.9, 10.15)", () => {
  it("moves focus to the heading when the drawer opens", () => {
    render(drawerFor(replayedJar("v2", "SPC-0002"), "v2", replays.v2));

    const heading = headingOf();
    expect(heading.textContent).toBe("SPC-0002");
    expect(document.activeElement).toBe(heading);
  });

  it("returns focus to the activating control when Escape closes the drawer", () => {
    function Harness() {
      const [jar, setJar] = useState<JarViewModel | null>(null);
      const jarOf = replayedJar("v2", "SPC-0002");
      return (
        <>
          <button type="button" onClick={() => setJar(jarOf)}>
            open SPC-0002
          </button>
          {drawerFor(jar, "v2", replays.v2, () => setJar(null))}
        </>
      );
    }
    render(<Harness />);

    const opener = screen.getByRole("button", { name: "open SPC-0002" });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(headingOf());

    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.querySelector(".jar-drawer")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("keeps focus on the same control when a new replay result refreshes the entry", () => {
    const { rerender } = render(drawerFor(replayedJar("v2", "SPC-0002"), "v2", replays.v2));

    const { replayed } = tabsOf();
    fireEvent.click(replayed);
    replayed.focus();
    expect(document.activeElement).toBe(replayed);

    rerender(drawerFor(replayedJar("v2.1", "SPC-0002"), "v2.1", replays["v2.1"]));

    expect(document.activeElement).toBe(replayed);
    expect(tabsOf().replayed).toBe(replayed);
    expect(headingOf().textContent).toBe("SPC-0002");
    // The entry now shows the v2.1 result: the old ABNORMAL flag is gone.
    expect(screen.queryByText("ABNORMAL")).toBeNull();
    expect(screen.getByText("compatible additions")).toBeTruthy();
  });
});

describe("JarDrawer form (Requirements 10.2 to 10.5, 10.10, 10.11)", () => {
  it("maps viewport widths to the four forms with inclusive edges", () => {
    expect(drawerFormFor(1280)).toBe("panel-wide");
    expect(drawerFormFor(1279)).toBe("panel-narrow");
    expect(drawerFormFor(1024)).toBe("panel-narrow");
    expect(drawerFormFor(1023)).toBe("sheet");
    expect(drawerFormFor(600)).toBe("sheet");
    expect(drawerFormFor(599)).toBe("fullscreen");
  });

  it("is a non-modal region in the right panel and a modal dialog that inerts the page in a sheet", () => {
    window.innerWidth = 1440;
    const { unmount } = render(drawerFor(replayedJar("v2", "SPC-0002"), "v2", replays.v2));
    let drawer = document.querySelector(".jar-drawer");
    expect(drawer?.getAttribute("data-form")).toBe("panel-wide");
    expect(drawer?.getAttribute("role")).toBe("region");
    expect(drawer?.hasAttribute("aria-modal")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--jar-drawer-inset")).toBe("480px");
    unmount();

    window.innerWidth = 800;
    render(drawerFor(replayedJar("v2", "SPC-0002"), "v2", replays.v2));
    drawer = document.querySelector(".jar-drawer");
    expect(drawer?.getAttribute("data-form")).toBe("sheet");
    expect(drawer?.getAttribute("role")).toBe("dialog");
    expect(drawer?.getAttribute("aria-modal")).toBe("true");
    const others = Array.from(document.body.children).filter((child) => child !== drawer);
    expect(others.length).toBeGreaterThan(0);
    for (const other of others) expect(other.hasAttribute("inert")).toBe(true);
  });
});
