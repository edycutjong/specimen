#!/usr/bin/env node
// Spike S5 throwaway checker (the real `specimen check-spec` lands on day 3): the three bugfix headings exist, in order,
// and the repro block between the markers is byte-identical to the block the CLI wrote.
import { readFileSync } from "node:fs";
const START = "<!-- specimen:repro:start -->", END = "<!-- specimen:repro:end -->";
const HEADINGS = ["### Current Behavior (Defect)", "### Expected Behavior (Correct)", "### Unchanged Behavior (Regression Prevention)"];
const block = (s) => { const a = s.indexOf(START), b = s.indexOf(END); return a < 0 || b < a ? null : s.slice(a, b + END.length); };
export function checkSpec(spec, repro) {
  const pos = HEADINGS.map((h) => spec.indexOf(h));
  const problems = HEADINGS.filter((_, i) => pos[i] < 0).map((h) => `missing heading: ${h}`);
  if (!problems.length && pos.some((p, i) => i > 0 && p < pos[i - 1])) problems.push("headings out of order");
  if (block(spec) === null) problems.push("repro block markers missing");
  else if (block(spec) !== block(repro)) problems.push("repro block edited");
  return { pass: problems.length === 0, problems };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = checkSpec(readFileSync(process.argv[2], "utf8"), readFileSync(process.argv[3], "utf8"));
  console.log(r.pass ? "S5-CHECK PASS" : `S5-CHECK FAIL: ${r.problems.join("; ")}`);
  process.exit(r.pass ? 0 : 1);
}
