import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs spike helper without types
import { checkSpec } from "../s5-check.mjs";

const repro = readFileSync(new URL("../s5/repro-block.md", import.meta.url), "utf8");
const good = `# Bugfix Requirements Document\n\n## Introduction\n\n${repro}\n## Bug Analysis\n\n### Current Behavior (Defect)\n\n1.1 x\n\n### Expected Behavior (Correct)\n\n2.1 y\n\n### Unchanged Behavior (Regression Prevention)\n\n3.1 z\n`;

describe("spike S5 checker", () => {
  it("passes a spec with the three headings and the untouched repro block", () => {
    expect(checkSpec(good, repro)).toEqual({ pass: true, problems: [] });
  });
  it("fails when the repro block is edited", () => {
    expect(checkSpec(good.replace('"temp_c": 21', '"temp_c": 22'), repro).problems).toContain("repro block edited");
  });
  it("fails when a heading is missing or the markers are gone", () => {
    const r = checkSpec(good.replace("### Expected Behavior (Correct)", "### Expected"), repro);
    expect(r.problems).toContain("missing heading: ### Expected Behavior (Correct)");
    expect(checkSpec("no block", repro).problems).toContain("repro block markers missing");
  });
});
