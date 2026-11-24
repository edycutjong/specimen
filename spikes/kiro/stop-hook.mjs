#!/usr/bin/env node
// Spike S2 Stop hook. Records the STDIN payload, then (once per outdir) asks the agent to keep working.
//   mode json  : print {"decision":"block","reason":...} and exit 0 on the first call
//   mode exit1 : print the reason as plain text and exit 1 on the first call
//   mode slow  : sleep <sleepMs> first, then behave like json (timeout probe)
// Every later call exits 0 with no output, so the loop always ends.
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
const [outdir, mode = "json", sleepMs = "0"] = process.argv.slice(2);
const REASON = "SPIKE-S2-GATE: before you stop, call the search_rooms tool on the hollowinn server with guests=1 and reply with the line GATE-SEEN <number of rooms>.";
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", async () => {
  mkdirSync(outdir, { recursive: true });
  const started = Date.now();
  if (mode === "slow") await new Promise((r) => setTimeout(r, Number(sleepMs)));
  const flag = `${outdir}/blocked-once`;
  const first = !existsSync(flag);
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = raw; }
  appendFileSync(`${outdir}/stop.jsonl`, JSON.stringify({ at: new Date().toISOString(), mode, first, waitedMs: Date.now() - started, payload }) + "\n");
  if (!first) process.exit(0);
  writeFileSync(flag, "1");
  if (mode === "exit1") { process.stdout.write(REASON + "\n"); process.exit(1); }
  process.stdout.write(JSON.stringify({ decision: "block", reason: REASON }) + "\n");
  process.exit(0);
});
