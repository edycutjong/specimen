// @vitest-environment jsdom
/**
 * Requirements 7.1 to 7.9, 14.4 to 14.7 and 15.4 for ShelfRow, Legend and SpoiledTray. The view
 * models come from real replays of v1, v2 and v2.1 and from the committed jar files. The spoiled
 * line is produced by core's loadJars over a real jar file with one line appended, so nothing is
 * invented.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadJars } from "@specimen/core";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { CabinetReplayResult } from "../src/browser-replay.js";
import { revealOrder, type JarViewModel } from "../src/cabinet-model.js";
import { Legend } from "../src/components/Legend.js";
import { ShelfRow } from "../src/components/ShelfRow.js";
import { SpoiledTray } from "../src/components/SpoiledTray.js";
import { RACK_META } from "../src/rack-meta.js";
import { loadReplays, viewModelOf, type Replays } from "./support/replays.js";

const DRAWER_ID = "jar-drawer";
let replays: Replays;

beforeAll(async () => {
  replays = await loadReplays();
}, 120_000);

afterEach(() => {
  cleanup();
});

/** The accession that a jar button names first in its accessible name. */
function accessionOfButton(button: HTMLElement): string {
  return (button.getAttribute("aria-label") ?? "").split(" ")[0] ?? "";
}

function renderRack(result: CabinetReplayResult | null, code: string, revealed = true) {
  const view = viewModelOf("v2", result);
  const rack = view.racks.find((candidate) => candidate.code === code);
  if (rack === undefined) throw new Error(`${code} is not in racks.json`);
  const utils = render(
    <ShelfRow
      rack={rack}
      isRevealed={() => revealed}
      expandedAccession={null}
      drawerId={DRAWER_ID}
      onActivate={() => undefined}
    />,
  );
  return { ...utils, rack };
}

/** Accession order of the jar buttons as they appear in the DOM. */
function domAccessions(container: HTMLElement): string[] {
  return within(container)
    .getAllByRole("button")
    .map((button) => accessionOfButton(button));
}

describe("ShelfRow jar order (Requirement 7.5)", () => {
  it("lists the jars in seq order across the shelves, not in accession order", () => {
    const view = viewModelOf("v2", replays.v2);
    const { container } = render(
      <>
        {view.racks.map((rack) => (
          <ShelfRow
            key={rack.code}
            rack={rack}
            isRevealed={() => true}
            expandedAccession={null}
            drawerId={DRAWER_ID}
            onActivate={() => undefined}
          />
        ))}
      </>,
    );

    // Rack order, then seq order within each rack: RACK A is 1, 2, 3, 4, 10 and RACK B is 5 to 9.
    const seqOrder = RACK_META.flatMap((meta) =>
      [...meta.jars].sort((a, b) => a.seq - b.seq).map((jar) => jar.id),
    );
    const dom = domAccessions(container);
    const byAccession = [...dom].sort();

    expect(dom).toEqual(seqOrder);
    expect(dom).toEqual(["SPC-0001", "SPC-0002", "SPC-0003", "SPC-0004", "SPC-0010", "SPC-0005", "SPC-0006", "SPC-0007", "SPC-0008", "SPC-0009"]);
    expect(dom).not.toEqual(byAccession);
  });

  it("keeps seq order before any replay, when every jar reads as not replayed", () => {
    const { container, rack } = renderRack(null, "RACK A", false);
    const seqOrder = [...rack.jars].sort((a, b) => a.seq - b.seq).map((jar) => jar.accession);

    expect(domAccessions(container)).toEqual(seqOrder);
    expect(screen.getAllByRole("button")[0]?.getAttribute("aria-label")).toMatch(/ — not replayed$/);
  });
});

describe("ShelfRow plate and stencilled position codes (Requirements 7.2 to 7.6)", () => {
  it("shows the rack code, the task, the short session id and the call count", () => {
    const { rack, container } = renderRack(replays.v2, "RACK A");

    expect(screen.getByRole("heading", { name: "RACK A" })).toBeTruthy();
    expect(within(container).getByText(rack.task)).toBeTruthy();
    expect(within(container).getByText(rack.shortSessionId)).toBeTruthy();
    expect(rack.shortSessionId).toMatch(/^sess_[A-Za-z0-9]{8}$/);
    expect(within(container).queryByText(rack.sessionId)).toBeNull();
    expect(within(container).getByText(`${rack.callCount} calls`)).toBeTruthy();
  });

  it("stencils position codes A1 to A5 on RACK A and B1 to B5 on RACK B, in seq order", () => {
    for (const code of ["RACK A", "RACK B"]) {
      const letter = code.slice(-1);
      const { container, unmount } = renderRack(replays.v2, code);
      const codes = Array.from(container.querySelectorAll(".shelf-code")).map((node) => node.textContent);

      expect(codes).toEqual([1, 2, 3, 4, 5].map((n) => `${letter}${n}`));
      unmount();
    }
  });

  it("uses one jar cell per jar of the rack, with the Jar component inside each cell", () => {
    const { container, rack } = renderRack(replays.v1, "RACK B");

    expect(container.querySelectorAll("li.shelf-cell")).toHaveLength(rack.jars.length);
    expect(within(container).getAllByRole("button")).toHaveLength(rack.jars.length);
  });

  it("lays out the jar cells in a grid whose minimum cell width is 140 px (7.7)", () => {
    const css = readFileSync(resolve("apps/cabinet/src/styles/shelf.css"), "utf8");

    expect(css).toMatch(/grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(140px,\s*1fr\)\)/);
  });
});

describe("Legend (Requirements 14.4, 14.5)", () => {
  it("draws the five Jar_State words", () => {
    render(<Legend skippedToolsPresent={false} />);

    for (const word of ["PRESERVED", "RATTLED", "CRACKED", "UNSEALED", "NOT REPLAYED"]) {
      expect(screen.getByText(word)).toBeTruthy();
    }
  });

  it("omits SKIPPED when no jar is skipped, and shows it when one is", () => {
    const { unmount } = render(<Legend skippedToolsPresent={false} />);
    expect(screen.queryByText("SKIPPED")).toBeNull();
    unmount();

    render(<Legend skippedToolsPresent={true} />);
    expect(screen.getByText("SKIPPED")).toBeTruthy();
  });

  it("omits SKIPPED for the real v2 replay, which skips nothing", () => {
    expect(viewModelOf("v2", replays.v2).skippedToolsPresent).toBe(false);
  });
});

describe("SpoiledTray (Requirements 14.6, 14.7, 15.4)", () => {
  it("is omitted when the replay has no spoiled line", () => {
    const view = viewModelOf("v2", replays.v2);
    expect(view.spoiled).toEqual([]);

    const { container } = render(<SpoiledTray spoiled={view.spoiled} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText("Spoiled lines")).toBeNull();
  });

  it("shows each spoiled line with its file:line and its reason", () => {
    const sessionFile = `${RACK_META[0]?.sessionId ?? ""}.jsonl`;
    const original = readFileSync(resolve("jars", sessionFile), "utf8");
    const withBadLine = `${original.replace(/\n+$/, "")}\nnot json\n`;
    const badLine = original.replace(/\n+$/, "").split("\n").length + 1;

    const loaded = loadJars([{ file: sessionFile, text: withBadLine }]);
    const view = viewModelOf("v2", { ...replays.v2, spoiled: loaded.spoiled });
    render(<SpoiledTray spoiled={view.spoiled} />);

    expect(loaded.spoiled).toEqual([{ file: sessionFile, line: badLine, reason: "not valid JSON" }]);
    expect(screen.getByText("Spoiled lines")).toBeTruthy();
    expect(screen.getByText(`${sessionFile}:${badLine}`)).toBeTruthy();
    expect(screen.getByText("not valid JSON")).toBeTruthy();
  });
});

describe("ShelfRow reveal wiring", () => {
  it("passes the reveal state of each jar to its button", () => {
    const { container } = renderRack(replays.v2, "RACK A", false);
    const states = within(container)
      .getAllByRole("button")
      .map((button) => button.getAttribute("data-state"));

    expect(states.every((state) => state === "not replayed")).toBe(true);
  });

  it("uses the jars of revealOrder as the jars of the shelves", () => {
    const view = viewModelOf("v2", replays.v2);
    const ids = revealOrder(view).map((jar: JarViewModel) => jar.accession);
    const rendered = view.racks.flatMap((rack) => rack.jars.map((jar) => jar.accession));

    expect(rendered).toEqual(ids);
  });
});
