#!/usr/bin/env node
// Spike hook: appends {label, at, payload} for every hook event to <outdir>/<label>.jsonl. Always exits 0.
import { appendFileSync, mkdirSync } from "node:fs";
const [label, outdir] = process.argv.slice(2);
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = raw; }
  mkdirSync(outdir, { recursive: true });
  appendFileSync(`${outdir}/${label}.jsonl`, JSON.stringify({ label, at: new Date().toISOString(), payload }) + "\n");
});
