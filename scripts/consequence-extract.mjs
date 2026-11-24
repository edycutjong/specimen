#!/usr/bin/env node
// Consequence run, part 2: pull what the agent actually SENT and SAW from the Kiro v3 session store, next to the
// stdout transcripts written by scripts/consequence-run.sh. For every session whose workspace is a
// specimen-consequence-<version>-<rack>-* scratch dir, writes evidence/consequence-v2/<version>-rack-<rack>.calls.jsonl:
//   {"n":1,"tool":"quote","description":"<the tool description the agent loaded>","input":{…},"response_text":"…"}
// one line per @hollowinn tool call in order. Nothing is edited; descriptions come from the agent's own load_resource.
//   node scripts/consequence-extract.mjs
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "evidence", "consequence-v2");
const root = `${process.env.HOME}/.kiro/sessions`;
const found = [];
for (const ws of readdirSync(root)) for (const s of readdirSync(join(root, ws))) {
  const dir = join(root, ws, s);
  if (!existsSync(join(dir, "session.json"))) continue;
  const cwd = (JSON.parse(readFileSync(join(dir, "session.json"), "utf8")).workspacePaths || [])[0] || "";
  const m = /specimen-consequence-(v[0-9.]+)-([ab])-/.exec(cwd);
  if (!m) continue;
  const [, version, rack] = m;
  const calls = new Map(), descriptions = new Map(), rows = [];
  for (const line of readFileSync(join(dir, "messages.jsonl"), "utf8").split("\n").filter(Boolean)) {
    const p = JSON.parse(line).payload || {};
    if (p.type === "tool_call" && p.toolName === "tool_call" && String(p.args?.tool_id).startsWith("tool::hollowinn::")) {
      calls.set(p.toolCallId, { tool: p.args.tool_id.split("::")[2], input: p.args.arguments });
    } else if (p.type === "tool_result" && calls.has(p.toolCallId)) {
      const c = calls.get(p.toolCallId);
      rows.push({ n: rows.length + 1, tool: c.tool, description: descriptions.get(c.tool) ?? null, input: c.input, response_text: p.content, success: p.success });
    } else if (p.type === "tool_result" && typeof p.content === "string" && p.content.includes('"loaded"')) {
      try { for (const t of JSON.parse(p.content).loaded || []) descriptions.set(t.resource_identity?.toolName, t.description); } catch { /* not a load_resource result */ }
    }
  }
  const file = join(out, `${version}-rack-${rack}.calls.jsonl`);
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  found.push(`${version} rack ${rack}: ${rows.length} calls → ${file.slice(file.indexOf("evidence/"))} (session ${s})`);
}
console.log(found.sort().join("\n") || "no consequence sessions found");
