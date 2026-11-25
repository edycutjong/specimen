// @vitest-environment jsdom
/**
 * Requirements 10.8, 10.10, 10.11 and 16.11: keyboard behaviour of the JarDrawer in jsdom.
 *
 * Escape and the Close control close the drawer and return focus to the Jar that opened it (10.8).
 * A modal drawer (bottom or full-screen sheet) keeps Tab inside itself and makes the page behind it
 * inert (10.10). A non-modal right panel leaves the Jars, the ServerSwitch and the ReplayButton
 * operable (10.11).
 *
 * The App tests run the real replay of hollow-inn over the committed jars. The JarDrawer tests
 * render the component directly with real Replay_Results. Nothing is mocked.
 *
 * jsdom does not move focus on Tab and does not enforce `inert`. The tests therefore check the
 * focus that the component sets on keydown: `fireEvent.keyDown` returns false when the handler
 * called preventDefault, which is how the trap intervenes at the edges.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, Fragment, useState, type ReactElement } from "react";
import type { BugfixSpec } from "@specimen/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { App } from "../src/App.js";
import { getBugfixSpecs, type CabinetReplayResult, type HollowInnVersion } from "../src/browser-replay.js";
import type { JarViewModel } from "../src/cabinet-model.js";
import { JarDrawer } from "../src/components/JarDrawer.js";
import { loadReplays, viewModelOf, type Replays } from "./support/replays.js";

/** drawerFormFor(800) is the bottom sheet: modal. */
const SHEET_WIDTH = 800;
/** drawerFormFor(1440) is the wide right panel: non-modal. */
const PANEL_WIDTH = 1440;

/** The VerdictPlate counts line of hollow-inn v2 over the committed jars (evidence/replay/racks-vs-v2.txt). */
const V2_COUNTS = /5 preserved · 4 rattled · 1 cracked/;
/** SPC-0002 is preserved and SPC-0009 is cracked in v2. Both are on the shelves. */
const PRESERVED_JAR = "SPC-0002";
const CRACKED_JAR = "SPC-0009";

/** The same selector the JarDrawer uses to find its focusable elements. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const APP_TIMEOUT = 60_000;

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

function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
}

function drawerEl(): HTMLElement {
  const drawer = document.querySelector<HTMLElement>(".jar-drawer");
  if (drawer === null) throw new Error("the JarDrawer is not open");
  return drawer;
}

function headingEl(): HTMLElement {
  const heading = document.querySelector<HTMLElement>(".jar-drawer__heading");
  if (heading === null) throw new Error("the drawer heading is not rendered");
  return heading;
}

/** The Jar button of an accession. Its name starts with the accession in every state. */
function jarButton(accession: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(`^${accession} `) });
}

/** Focuses a Jar and clicks it, as a keyboard user would activate it. Returns the Jar button. */
function openJar(accession: string): HTMLElement {
  const button = jarButton(accession);
  button.focus();
  fireEvent.click(button);
  expect(document.activeElement).toBe(headingEl());
  return button;
}

/** Renders the real App at a viewport width and waits until the v2 replay has revealed every Jar. */
async function renderReplayedApp(width: number): Promise<void> {
  window.innerWidth = width;
  render(createElement(App));
  await screen.findByText(V2_COUNTS, undefined, { timeout: 15_000 });
  await waitFor(() => expect(screen.queryAllByRole("button", { name: /— not replayed$/ })).toHaveLength(0), {
    timeout: 15_000,
  });
}

/** Body children that are not the drawer. In a modal drawer each must be inert. */
function pageBehindDrawer(drawer: HTMLElement): Element[] {
  return Array.from(document.body.children).filter((child) => child !== drawer && !child.contains(drawer));
}

describe("App: Escape and Close (Requirement 10.8)", () => {
  describe.each([
    ["sheet (modal)", SHEET_WIDTH],
    ["right panel (non-modal)", PANEL_WIDTH],
  ])("in the %s form", (_form, width) => {
    it(
      "Escape closes the drawer and returns focus to the Jar that opened it",
      async () => {
        await renderReplayedApp(width);
        const opener = openJar(PRESERVED_JAR);

        fireEvent.keyDown(document, { key: "Escape" });

        expect(document.querySelector(".jar-drawer")).toBeNull();
        expect(document.activeElement).toBe(opener);
      },
      APP_TIMEOUT,
    );

    it(
      "the Close control closes the drawer and returns focus to the Jar that opened it",
      async () => {
        await renderReplayedApp(width);
        const opener = openJar(PRESERVED_JAR);

        fireEvent.click(screen.getByRole("button", { name: "Close" }));

        expect(document.querySelector(".jar-drawer")).toBeNull();
        expect(document.activeElement).toBe(opener);
      },
      APP_TIMEOUT,
    );
  });

  it(
    "after several Jars are activated in turn, Escape returns focus to the most recently activated one",
    async () => {
      await renderReplayedApp(PANEL_WIDTH);
      openJar(PRESERVED_JAR);

      // The right panel is non-modal, so the second Jar is reachable while the first drawer is open.
      const second = jarButton(CRACKED_JAR);
      second.focus();
      fireEvent.click(second);
      expect(headingEl().textContent).toBe(CRACKED_JAR);

      // A focused Jar shows its tooltip, and the first Escape closes only the tooltip (Requirement 8.8).
      expect(screen.queryByRole("tooltip")).not.toBeNull();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("tooltip")).toBeNull();
      expect(document.querySelector(".jar-drawer")).not.toBeNull();

      fireEvent.keyDown(document, { key: "Escape" });

      expect(document.querySelector(".jar-drawer")).toBeNull();
      expect(document.activeElement).toBe(second);
    },
    APP_TIMEOUT,
  );
});

describe("App: modal sheet keeps Tab inside (Requirement 10.10)", () => {
  it(
    "is a modal dialog, and every page element outside it is inert",
    async () => {
      await renderReplayedApp(SHEET_WIDTH);
      openJar(PRESERVED_JAR);

      const drawer = drawerEl();
      expect(drawer.getAttribute("role")).toBe("dialog");
      expect(drawer.getAttribute("aria-modal")).toBe("true");

      const behind = pageBehindDrawer(drawer);
      expect(behind.length).toBeGreaterThan(0);
      for (const element of behind) expect(element.hasAttribute("inert")).toBe(true);
      expect(jarButton(CRACKED_JAR).closest("[inert]")).not.toBeNull();
    },
    APP_TIMEOUT,
  );

  it(
    "wraps Tab and Shift+Tab at the edges of the drawer and never hands focus to the page",
    async () => {
      await renderReplayedApp(SHEET_WIDTH);
      const opener = openJar(PRESERVED_JAR);
      const items = focusablesIn(drawerEl());
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined || first === last) throw new Error("the drawer needs several controls");

      // Tab on the last control wraps to the first (the handler prevents the default move).
      last.focus();
      expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(false);
      expect(document.activeElement).toBe(first);

      // Shift+Tab on the first control wraps to the last.
      first.focus();
      expect(fireEvent.keyDown(first, { key: "Tab", shiftKey: true })).toBe(false);
      expect(document.activeElement).toBe(last);

      // A Tab between two inner controls is left to the browser.
      const middle = items[1];
      if (middle !== undefined && middle !== last) {
        middle.focus();
        expect(fireEvent.keyDown(middle, { key: "Tab" })).toBe(true);
        expect(document.activeElement).toBe(middle);
      }

      // Focus outside the drawer (the Jar behind the sheet) is pulled back in on Tab.
      opener.focus();
      expect(fireEvent.keyDown(opener, { key: "Tab" })).toBe(false);
      expect(drawerEl().contains(document.activeElement)).toBe(true);
    },
    APP_TIMEOUT,
  );
});

describe("App: non-modal right panel leaves the page operable (Requirement 10.11, 16.11)", () => {
  it(
    "is a non-modal region, does not inert the page, and does not trap Tab",
    async () => {
      await renderReplayedApp(PANEL_WIDTH);
      openJar(PRESERVED_JAR);

      const drawer = drawerEl();
      expect(drawer.getAttribute("role")).toBe("region");
      expect(drawer.hasAttribute("aria-modal")).toBe(false);
      for (const element of pageBehindDrawer(drawer)) expect(element.hasAttribute("inert")).toBe(false);

      const items = focusablesIn(drawer);
      const last = items[items.length - 1];
      if (last === undefined) throw new Error("the drawer has no focusable control");
      last.focus();
      expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(true);
    },
    APP_TIMEOUT,
  );

  it(
    "keeps the Jars, the ServerSwitch and the ReplayButton focusable while the drawer is open",
    async () => {
      await renderReplayedApp(PANEL_WIDTH);
      openJar(PRESERVED_JAR);

      const targets: HTMLElement[] = [
        jarButton(CRACKED_JAR),
        screen.getByRole("radio", { name: "v1" }),
        screen.getByRole("button", { name: "Replay cabinet v2" }),
      ];
      for (const target of targets) {
        expect(target.closest("[inert]")).toBeNull();
        expect(target.hasAttribute("disabled")).toBe(false);
        expect(target.getAttribute("aria-disabled")).not.toBe("true");
        target.focus();
        expect(document.activeElement).toBe(target);
      }

      // Focus moved away from the drawer, so the drawer stays open.
      expect(document.querySelector(".jar-drawer")).not.toBeNull();
    },
    APP_TIMEOUT,
  );
});

/** Renders the real JarDrawer with a Jar opened from a button, the way the page opens it. */
function DrawerHarness({ jar, version, result }: { jar: JarViewModel; version: HollowInnVersion; result: CabinetReplayResult }): ReactElement {
  const [open, setOpen] = useState<JarViewModel | null>(null);
  return createElement(
    Fragment,
    null,
    createElement(
      "button",
      { type: "button", onClick: () => setOpen(jar) },
      `open ${jar.accession}`,
    ),
    createElement(JarDrawer, {
      jar: open,
      version,
      result,
      specs,
      onClose: () => setOpen(null),
    }),
  );
}

function jarOf(version: keyof Replays, id: string): JarViewModel {
  const model = viewModelOf(version, replays[version]);
  const jar = model.racks.flatMap((rack) => rack.jars).find((candidate) => candidate.id === id);
  if (jar === undefined) throw new Error(`${id} is not on a shelf`);
  return jar;
}

describe("JarDrawer: modal focus trap on a replayed jar (Requirement 10.8, 10.10)", () => {
  it("wraps Tab across the tabs, the panel and the spec, and the Close control returns focus", () => {
    window.innerWidth = SHEET_WIDTH;
    const jar = jarOf("v2", PRESERVED_JAR);
    render(createElement(DrawerHarness, { jar, version: "v2", result: replays.v2 }));

    const opener = screen.getByRole("button", { name: `open ${PRESERVED_JAR}` });
    opener.focus();
    fireEvent.click(opener);

    const drawer = drawerEl();
    expect(drawer.getAttribute("aria-modal")).toBe("true");
    const items = focusablesIn(drawer);
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) throw new Error("the drawer has no focusable control");

    last.focus();
    expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(false);
    expect(document.activeElement).toBe(first);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(document.querySelector(".jar-drawer")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe("JarDrawer: body inert is released on close", () => {
  it("removes inert from the page once a modal drawer closes", () => {
    window.innerWidth = SHEET_WIDTH;
    const jar = jarOf("v2", PRESERVED_JAR);
    render(createElement(DrawerHarness, { jar, version: "v2", result: replays.v2 }));

    const opener = screen.getByRole("button", { name: `open ${PRESERVED_JAR}` });
    opener.focus();
    fireEvent.click(opener);
    expect(opener.closest("[inert]")).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(opener.closest("[inert]")).toBeNull();
    expect(document.body.querySelectorAll("[inert]")).toHaveLength(0);
    expect(document.activeElement).toBe(opener);
  });
});
