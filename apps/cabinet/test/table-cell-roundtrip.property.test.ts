import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { tableCell } from "../../../packages/cli/src/file.js";
import { splitTableRow } from "../src/markdown/render-markdown.js";

// `specimen file` writes jar ids, JSON paths and notes into the repro table of a bugfix spec; the cabinet's SpecViewer
// parses that table back. Whatever a value holds (pipes, backslashes, both), the cell must come back as the value.
const value = fc
  .array(fc.constantFrom("\\", "\\", "|", "|", "a", "/", "~", "-", " "), { maxLength: 24 })
  .map((parts) => parts.join(""));

describe("repro table cells round-trip through the cabinet's table parser", () => {
  it("returns every value, whatever pipes and backslashes it holds", () => {
    fc.assert(
      fc.property(value, value, (a, b) => {
        expect(splitTableRow(`| ${tableCell(a)} | ${tableCell(b)} |`)).toEqual([a.trim(), b.trim()]);
      }),
      { numRuns: 5_000 },
    );
  });

  it("keeps the committed rows as they were (no backslash in them)", () => {
    expect(splitTableRow("| SPC-0002 | /total | removed | suspected rename from /total ×100 |")).toEqual([
      "SPC-0002",
      "/total",
      "removed",
      "suspected rename from /total ×100",
    ]);
    expect(splitTableRow("| a \\| b | c |")).toEqual(["a | b", "c"]);
  });
});
