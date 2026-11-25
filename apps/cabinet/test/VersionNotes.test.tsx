// @vitest-environment jsdom
/**
 * Requirements 3.5 and 3.9 for the version notes under the CountsPair. The note is the CHANGES.md entry
 * of the selected Version: its heading, the v2.1 lead, and a collapsed "What changed" disclosure whose
 * body is rendered as markdown, so the CHANGES table is a real table with no raw pipes.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { v21FixLead } from "../src/changes.js";
import { VersionNotes } from "../src/components/VersionNotes.js";

afterEach(() => {
  cleanup();
});

describe("VersionNotes (Requirements 3.5, 3.9)", () => {
  it("shows the CHANGES.md heading and the v2.1 lead for v2.1 (3.5, 3.9)", () => {
    const { rerender } = render(<VersionNotes version="v2.1" verdict="HOLD" />);

    const note = screen.getByRole("region", { name: "Changes in v2.1" });
    expect(within(note).getByRole("heading", { name: /v2\.1\.0/ })).toBeTruthy();
    expect(within(note).getByText(v21FixLead("HOLD"))).toBeTruthy();
    expect(note.textContent).toContain("returns total (dollars, 425.00) again");

    rerender(<VersionNotes version="v1" />);
    const baseline = screen.getByRole("region", { name: "Changes in v1" });
    expect(within(baseline).queryByText(v21FixLead("HOLD"))).toBeNull();
  });

  it("collapses the body under a What changed disclosure", () => {
    render(<VersionNotes version="v2" />);

    const details = document.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toBe("What changed in v2");
  });

  it("renders the v2 CHANGES table as a real table with a header row and body rows, and no raw pipes", () => {
    const { container } = render(<VersionNotes version="v2" />);

    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(Array.from(table?.querySelectorAll("thead th") ?? []).map((th) => th.textContent)).toEqual([
      "#",
      "Tool",
      "Change",
      "Input schema in tools/list changes?",
    ]);
    expect(table?.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(table?.querySelector("tbody code")?.textContent).toBe("quote");
    expect(container.textContent ?? "").not.toMatch(/\|\s*#\s*\|/);
  });

  it("renders nothing for a Version with no CHANGES.md entry", () => {
    const { container } = render(<VersionNotes version={"v9" as never} />);
    expect(container.textContent).toBe("");
  });
});
