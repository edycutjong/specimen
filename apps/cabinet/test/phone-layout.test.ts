/**
 * The first jar on a 375 x 812 phone (QA turn-46, item 5). The first jar button must start at or above y = 460 px.
 * That position is measured in a browser, not here. This test fails if the <= 480 px rules that make room for it
 * are removed. It reads the stylesheet, so it does not measure layout. Node environment.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

/** The body of every `@media (max-width: 480px)` block in the stylesheet, with its braces matched. */
function phoneBlocks(css: string): string {
  const start = /@media \(max-width: 480px\)\s*\{/g;
  let out = "";
  let m: RegExpExecArray | null;
  while ((m = start.exec(css)) !== null) {
    let depth = 1;
    let i = start.lastIndex;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    out += css.slice(start.lastIndex, i - 1);
  }
  return out;
}

describe("phone layout at 480 px and below (first jar at or above 460 px)", () => {
  const phone = phoneBlocks(read("../src/styles/phone.css"));

  it("has a max-width 480 px block that tightens the header, tagline, plate, task and follow-up", () => {
    expect(phone.length).toBeGreaterThan(0);
    for (const selector of [".cabinet-header", ".cabinet-tagline", ".verdict-plate--plaque", ".shelf-task", ".shelf-followup"]) {
      expect(phone, selector).toContain(selector);
    }
  });

  it("moves the CountsPair below the shelves by order only", () => {
    expect(phone).toMatch(/\.counts-pair-group\s*\{\s*order:\s*3;/);
  });

  it("is loaded after the component stylesheets", () => {
    const main = read("../src/main.tsx");
    expect(main.indexOf('"./styles/phone.css"')).toBeGreaterThan(main.indexOf('"./App.js"'));
  });
});
