#!/usr/bin/env node
// Sums Kiro credits (usage_summary.promptTurnSummaries[].usage) for v3 sessions whose workspace path starts with a prefix
// and that were modified after <sinceISO>. Usage: node credits.mjs <sinceISO> <prefix>...
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
const [since, ...prefixes] = process.argv.slice(2);
const root = `${process.env.HOME}/.kiro/sessions`;
const walk = (o, f) => { if (o && typeof o === "object") { f(o); for (const v of Object.values(o)) walk(v, f); } };
const rows = [];
for (const ws of readdirSync(root)) for (const s of readdirSync(`${root}/${ws}`)) {
  const dir = `${root}/${ws}/${s}`; if (!existsSync(`${dir}/session.json`)) continue;
  const cwd = (JSON.parse(readFileSync(`${dir}/session.json`, "utf8")).workspacePaths || [])[0] || "";
  if (!prefixes.some((p) => cwd.startsWith(p)) || statSync(dir).mtime < new Date(since)) continue;
  let credits = 0, turns = 0; const tools = [];
  for (const line of (existsSync(`${dir}/messages.jsonl`) ? readFileSync(`${dir}/messages.jsonl`, "utf8") : "").split("\n")) {
    if (!line.includes("usage_summary")) continue;
    walk(JSON.parse(line), (o) => { if (o.type === "usage_summary") for (const t of o.promptTurnSummaries || []) { turns++; credits += t.usage || 0; tools.push(...(t.usedTools || [])); } });
  }
  rows.push({ s, cwd, mtime: statSync(dir).mtime.toISOString(), credits, turns, tools: tools.length });
}
rows.sort((a, b) => a.mtime.localeCompare(b.mtime));
for (const r of rows) console.log(`${r.mtime}  ${r.credits.toFixed(4)}  turns=${r.turns} tools=${r.tools}  ${r.cwd}  ${r.s}`);
console.log(`TOTAL ${rows.reduce((a, r) => a + r.credits, 0).toFixed(4)} credits over ${rows.length} sessions`);
