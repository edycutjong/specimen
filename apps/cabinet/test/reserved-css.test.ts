/**
 * Design pass, item 3: the classes that reserve the final size of each late-appearing block exist in
 * the stylesheets, with the rule that holds the space. Read from the CSS files, so no browser is needed.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = (name: string): string => readFileSync(fileURLToPath(new URL(`../src/styles/${name}`, import.meta.url)), "utf8");

describe("reserved space classes (design pass, item 3)", () => {
  it("reserves the plate width and height at 1024 px and wider", () => {
    const header = css("header.css");
    expect(header).toMatch(/@media \(min-width: 1024px\)[\s\S]*?\.cabinet-plate-slot \{[^}]*width: 360px/);
    expect(header).toMatch(/\.cabinet-plate-slot > \.verdict-plate--plaque \{\s*min-height: 66px/);
  });

  it("holds the CountsPair strip and its hidden values in place", () => {
    const counts = css("counts-pair.css");
    expect(counts).toMatch(/\.counts-pair \{[^}]*min-height: 180px/);
    expect(counts).toMatch(/\.counts-pair__value--hidden,\s*\.counts-pair__added--hidden,\s*\.counts-pair__connector--hidden \{\s*visibility: hidden/);
  });

  it("holds the ledger lines and the version notes with visibility, not display", () => {
    expect(css("frame.css")).toMatch(/\.cabinet-ledger \{\s*min-height: 158px/);
    expect(css("verdict.css")).toMatch(/\.verdict-plate__status--pending \{\s*visibility: hidden/);
    expect(css("version-notes.css")).toMatch(/\.version-notes--pending \{\s*visibility: hidden/);
  });
});
