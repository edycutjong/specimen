// @vitest-environment jsdom
/**
 * Requirements 11.1 to 11.12 and 16.4 for the LabReportTable. Each entry is taken from a real
 * runReplay() result for v1, v2 and v2.1. Nothing is mocked.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ResultEntry } from "@specimen/core";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { LabReportTable } from "../src/components/LabReportTable.js";
import { loadReplays, type Replays } from "./support/replays.js";

let replays: Replays;

beforeAll(async () => {
  replays = await loadReplays();
}, 120_000);

afterEach(() => {
  cleanup();
});

const FLAG_OF: Record<ResultEntry["changes"][number]["kind"], string> = {
  removed: "REMOVED",
  added: "ADDED",
  value: "VALUE",
  type: "TYPE",
  length: "LENGTH",
};

/** The Result_Entry of one accession in one Version's real replay. */
function entryOf(version: keyof Replays, id: string): ResultEntry {
  const entry = replays[version].jars.find((jar) => jar.id === id);
  if (entry === undefined) throw new Error(`${id} is not in ${version}`);
  return entry;
}

describe("LabReportTable (Requirement 11, 16.4)", () => {
  it("shows the literal 425.00 and the rename note for SPC-0002 in v2 (11.5, 11.6)", () => {
    const entry = entryOf("v2", "SPC-0002");
    render(<LabReportTable entry={entry} />);

    const table = screen.getByRole("table", { name: /field-by-field diff/i });
    const header = within(table).getAllByRole("columnheader").map((th) => th.textContent);
    expect(header).toEqual(["Path", "Flag", "Values"]);

    // The values cell shows the jarred literal on its own line, not the parsed number 425.
    const literal = within(table).getByText("425.00");
    expect(literal.tagName).toBe("SPAN");
    expect(literal.closest("td")?.className).toBe("lab-report__values");
    expect(literal.parentElement?.textContent).toBe("jarred 425.00");
    expect(within(table).queryByText("425")).toBeNull();

    expect(screen.getByText("suspected rename from /total ×100").tagName).toBe("TD");
  });

  it("strikes through and flags each changed row of SPC-0002 in v2 (11.3, 11.4, 11.12)", () => {
    const entry = entryOf("v2", "SPC-0002");
    render(<LabReportTable entry={entry} />);

    const rows = entry.changes.map((change) => change.path);
    expect(rows.length).toBeGreaterThan(0);
    for (const path of rows) {
      const cell = screen.getByText(path, { selector: "s" });
      expect(cell.tagName).toBe("S");
    }
    const flags = Array.from(document.querySelectorAll(".lab-report__flag")).map((cell) => cell.textContent);
    expect(flags).toEqual(entry.changes.map((change) => FLAG_OF[change.kind]));
  });

  it("shows SPC-0002 in v2.1 as a compatible addition without strike-through (11.8)", () => {
    const entry = entryOf("v2.1", "SPC-0002");
    expect(entry.changes).toEqual([]);
    expect(entry.compatible.length).toBeGreaterThan(0);

    render(<LabReportTable entry={entry} />);

    expect(screen.getByText("compatible additions").tagName).toBe("TH");
    const addition = entry.compatible[0];
    if (addition === undefined) throw new Error("SPC-0002 in v2.1 has no compatible change");
    const cell = screen.getByText(addition.path);
    expect(cell.closest("s")).toBeNull();
    expect(cell.closest("tr")?.className).toContain("lab-report__row--compatible");
    expect(cell.closest("tr")?.className).not.toContain("lab-report__row--changed");

    const row = cell.closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("ADDED")).toBeTruthy();
    expect(screen.queryByText("No field differs after normalisation.")).toBeNull();
  });

  it("shows 'tool not in tools/list' as the reason for the cracked SPC-0009 in v2 (11.10)", () => {
    const entry = entryOf("v2", "SPC-0009");
    expect(entry.state).toBe("cracked");
    render(<LabReportTable entry={entry} />);

    expect(screen.getByText("tool not in tools/list")).toBeTruthy();
    expect(screen.queryByText("No field differs after normalisation.")).toBeNull();
  });

  it("states that no field differs for a preserved jar with no changes (11.9)", () => {
    const entry = entryOf("v1", "SPC-0001");
    expect(entry.changes).toEqual([]);
    expect(entry.compatible).toEqual([]);
    render(<LabReportTable entry={entry} />);

    expect(screen.getByText("No field differs after normalisation.")).toBeTruthy();
  });
});
