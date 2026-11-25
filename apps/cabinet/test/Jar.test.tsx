// @vitest-environment jsdom
/**
 * Requirements 2.16, 8.4 to 8.9, 8.12, 8.13 and 7.8 for the Jar button. The jar view models come
 * from real replays through `runReplay()` and `buildViewModel()`, so the names and tooltips are the
 * ones the Cabinet shows. jsdom does no layout, so the focus-ring width is checked on the CSS text.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { getBugfixSpecs, runReplay, type CabinetReplayResult } from "../src/browser-replay.js";
import {
  buildViewModel,
  revealOrder,
  type CabinetViewModel,
  type JarViewModel,
} from "../src/cabinet-model.js";
import { Jar } from "../src/components/Jar.js";
import { RACK_META } from "../src/rack-meta.js";

const DRAWER_ID = "jar-drawer";
const NO_GUIDE = { openedRedJar: false, viewedSpec: false, replayedFixedVersion: false };

let v2: CabinetReplayResult;

beforeAll(async () => {
  v2 = await runReplay("v2");
}, 60_000);

afterEach(() => {
  cleanup();
});

function modelFor(result: CabinetReplayResult | null, version: "v2" | "v1" = "v2"): CabinetViewModel {
  return buildViewModel({
    result,
    version,
    bugfixSpecs: getBugfixSpecs(),
    racks: RACK_META,
    guideFlags: NO_GUIDE,
  });
}

function jarById(viewModel: CabinetViewModel, id: string): JarViewModel {
  const jar = revealOrder(viewModel).find((candidate) => candidate.id === id);
  if (jar === undefined) throw new Error(`${id} is not on any shelf`);
  return jar;
}

function firstWithState(viewModel: CabinetViewModel, state: JarViewModel["state"]): JarViewModel {
  const jar = revealOrder(viewModel).find((candidate) => candidate.state === state);
  if (jar === undefined) throw new Error(`no ${state} jar in this replay`);
  return jar;
}

function renderJar(jar: JarViewModel, props: { revealed?: boolean; expanded?: boolean } = {}) {
  return render(
    <Jar
      jar={jar}
      revealed={props.revealed ?? true}
      expanded={props.expanded ?? false}
      drawerId={DRAWER_ID}
      onActivate={() => undefined}
    />,
  );
}

describe("Jar accessible name per state (Requirement 8.7)", () => {
  it("names a rattled red jar with its accession, tool, state and changed details", () => {
    const jar = jarById(modelFor(v2), "SPC-0002");
    renderJar(jar);

    const button = screen.getByRole("button", { name: jar.accessibleName });
    expect(jar.accessibleName).toMatch(/^SPC-0002 quote SPEC ABNORMAL — rattled, /);
    expect(button.getAttribute("aria-label")).toBe(jar.accessibleName);
  });

  it("names a preserved jar with its state word only", () => {
    const jar = firstWithState(modelFor(v2), "preserved");
    renderJar(jar);

    expect(screen.getByRole("button", { name: jar.accessibleName })).toBeTruthy();
    expect(jar.accessibleName.endsWith(` ${jar.tool} — preserved`)).toBe(true);
  });

  it("names a cracked jar with its failure reason", () => {
    const jar = jarById(modelFor(v2), "SPC-0009");
    renderJar(jar);

    expect(jar.state).toBe("cracked");
    expect(screen.getByRole("button", { name: jar.accessibleName })).toBeTruthy();
    expect(jar.accessibleName).toMatch(/^SPC-0009 \S+ SPEC CRACKED — cracked, /);
  });

  it("names a jar that is not yet revealed as not replayed, even when its replayed state is rattled", () => {
    const jar = jarById(modelFor(v2), "SPC-0002");
    renderJar(jar, { revealed: false });

    expect(screen.getByRole("button", { name: `SPC-0002 quote — not replayed` })).toBeTruthy();
    expect(screen.queryByText("ABNORMAL")).toBeNull();
  });

  it("names every jar as not replayed when no replay has run", () => {
    const jar = revealOrder(modelFor(null))[0];
    if (jar === undefined) throw new Error("the racks list no jars");
    renderJar(jar);

    expect(screen.getByRole("button", { name: `${jar.accession} ${jar.tool} — not replayed` })).toBeTruthy();
  });
});

describe("Jar expanded state (Requirement 8.13)", () => {
  it("exposes aria-expanded false and no aria-controls while its drawer is closed", () => {
    renderJar(jarById(modelFor(v2), "SPC-0002"));

    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.hasAttribute("aria-controls")).toBe(false);
  });

  it("exposes aria-expanded true and aria-controls naming the drawer while it is open", () => {
    renderJar(jarById(modelFor(v2), "SPC-0002"), { expanded: true });

    const button = screen.getByRole("button");
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-controls")).toBe(DRAWER_ID);
  });
});

describe("Jar tooltip (Requirement 8.8)", () => {
  it("shows the tooltip on focus and closes it on Escape", () => {
    const jar = jarById(modelFor(v2), "SPC-0002");
    renderJar(jar);
    const button = screen.getByRole("button");

    act(() => {
      button.focus();
    });
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toBe(jar.tooltip);
    expect(button.getAttribute("aria-describedby")).toBe(tip.id);

    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(button.hasAttribute("aria-describedby")).toBe(false);
  });

  it("stops the first Escape at the tooltip so no other Escape listener receives it", () => {
    renderJar(jarById(modelFor(v2), "SPC-0002"));
    const button = screen.getByRole("button");
    const seen: string[] = [];
    const spy = (event: KeyboardEvent) => seen.push(event.key);
    document.addEventListener("keydown", spy);

    try {
      act(() => {
        button.focus();
      });
      fireEvent.keyDown(button, { key: "Escape" });
      expect(seen).toEqual([]);
      expect(screen.queryByRole("tooltip")).toBeNull();

      fireEvent.keyDown(button, { key: "Escape" });
      expect(seen).toEqual(["Escape"]);
    } finally {
      document.removeEventListener("keydown", spy);
    }
  });

  it("shows the state word as the tooltip of a jar that is not red", () => {
    const jar = firstWithState(modelFor(v2), "preserved");
    renderJar(jar);

    act(() => {
      screen.getByRole("button").focus();
    });
    expect(screen.getByRole("tooltip").textContent).toBe("preserved");
  });

  it("shows not replayed as the tooltip while a jar is not yet revealed", () => {
    renderJar(jarById(modelFor(v2), "SPC-0002"), { revealed: false });

    act(() => {
      screen.getByRole("button").focus();
    });
    expect(screen.getByRole("tooltip").textContent).toBe("not replayed");
  });
});

describe("Jar toe-tag and strips as HTML (Requirements 8.4, 8.5, 8.6, 8.9)", () => {
  it("renders the accession and tool name as HTML text, not SVG text", () => {
    const jar = jarById(modelFor(v2), "SPC-0002");
    const { container } = renderJar(jar);

    const accession = screen.getByText("SPC-0002");
    expect(accession.tagName).toBe("SPAN");
    expect(accession.closest("svg")).toBeNull();
    expect(container.querySelector("svg text")).toBeNull();

    const tool = container.querySelector(".jar__tool");
    expect(tool?.textContent).toBe(jar.tool);
    expect(tool?.closest("svg")).toBeNull();
  });

  it("keeps a tool name as one unbreakable word, with no break opportunity inside it (QA round 3, item 12)", () => {
    const jar = { ...jarById(modelFor(v2), "SPC-0002"), tool: "cancel_booking" };
    const { container } = renderJar(jar);

    const tool = container.querySelector(".jar__tool");
    expect(tool?.textContent).toBe("cancel_booking");
    expect(tool?.querySelectorAll("wbr")).toHaveLength(0);
  });

  it("carries an ABNORMAL strip as HTML on a rattled jar", () => {
    renderJar(jarById(modelFor(v2), "SPC-0002"));
    expect(screen.getByText("ABNORMAL").tagName).toBe("SPAN");
  });

  it("carries a CRACKED strip as HTML on a cracked jar", () => {
    renderJar(jarById(modelFor(v2), "SPC-0009"));
    expect(screen.getByText("CRACKED").tagName).toBe("SPAN");
  });

  it("shows no strip on a preserved jar", () => {
    renderJar(firstWithState(modelFor(v2), "preserved"));
    expect(screen.queryByText("ABNORMAL")).toBeNull();
    expect(screen.queryByText("CRACKED")).toBeNull();
  });

  it("hides the barcode from assistive technology", () => {
    const { container } = renderJar(jarById(modelFor(v2), "SPC-0002"));
    const barcode = container.querySelector(".jar__barcode");
    expect(barcode?.getAttribute("aria-hidden")).toBe("true");
  });

  it("does not tilt the jar again: the tilt is set once on the JarArt svg", () => {
    const jar = jarById(modelFor(v2), "SPC-0002");
    const { container } = renderJar(jar);
    const svg = container.querySelector("svg");
    expect(svg?.style.transform).toBe(`rotate(${jar.tilt}deg)`);
    expect(container.querySelector(".jar__art")?.getAttribute("style")).toBeNull();
  });
});

describe("Jar focus ring (Requirement 8.12)", () => {
  it("draws a 3 px --before outline on the focused button in the stylesheet", () => {
    // Vitest skips CSS processing, so the stylesheet is read from disk. `npm test` runs at the repo root.
    const jarCss = readFileSync(resolve("apps/cabinet/src/components/Jar.css"), "utf8");
    expect(jarCss).toMatch(/\.jar__button:focus-visible[\s\S]*?outline:\s*3px solid var\(--before\)/);
  });
});

describe("Jar accessible name starts with the visible toe-tag text (WCAG 2.5.3)", () => {
  it("starts every v2 jar's accessible name with the text its toe-tag shows", () => {
    const jars = revealOrder(modelFor(v2));
    expect(jars.length).toBeGreaterThan(0);
    for (const jar of jars) {
      const { container, unmount } = renderJar(jar, { revealed: true });
      const tag = container.querySelector(".jar__tag");
      const name = jar.accession;
      expect(tag, name).not.toBeNull();
      const visible = (tag?.textContent ?? "").replace(/\s+/g, " ").trim();
      expect(visible.length, name).toBeGreaterThan(0);
      expect(jar.accessibleName.startsWith(visible), `${name}: "${visible}"`).toBe(true);
      unmount();
    }
  });
});
