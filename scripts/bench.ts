// `npx tsx scripts/bench.ts detect` — the detection table (specs: complexity §3, Must).
// Replays the committed jars (jars/) against every hollow-inn version that exists, each time with
// v1 as the tools/list baseline, and writes the counts per version next to what a pure schema diff
// (tools removed / added / input schema changed) would have reported for the same change.
// Output: evidence/bench/detect.md (the table) + evidence/bench/detect.json (the raw counts).
// Every figure in the table comes from a real `specimen replay --json` run; nothing is typed in.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const mode = process.argv[2];
if (mode !== "detect") {
  console.error("usage: tsx scripts/bench.ts detect");
  process.exit(2);
}

const root = process.cwd();
const versions = ["v1", "v2", "v2.1"].filter((v) => {
  const file = join(root, "servers/hollow-inn/src", `${v.replace(".", "_")}.ts`);
  return existsSync(file);
});
const serverCmd = (v: string) => `npx tsx servers/hollow-inn/src/main.ts ${v}`;

type Row = {
  version: string;
  verdict: string;
  compared: number;
  preserved: number;
  rattled: number;
  cracked: number;
  unsealed: number;
  skipped: number;
  red_ids: string[];
  schema_removed: string[];
  schema_added: string[];
  schema_input_changed: string[];
  ms: number;
};

const rows: Row[] = [];
for (const v of versions) {
  const t0 = performance.now();
  let out: string;
  try {
    out = execFileSync(
      "npx",
      ["--no-install", "specimen", "replay", "--server", serverCmd(v), "--baseline", serverCmd("v1"), "--json",
        "--out", join("/tmp", `specimen-bench-${v}.json`)],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (err) {
    // `specimen replay` exits 1 on HOLD; the JSON is still on stdout.
    out = (err as { stdout?: string }).stdout ?? "";
  }
  const ms = Math.round(performance.now() - t0);
  const json = out.trim() === "" ? undefined : JSON.parse(out);
  if (json === undefined) {
    console.error(`no Replay_Result for ${v}`);
    process.exit(1);
  }
  rows.push({
    version: v,
    verdict: json.verdict,
    compared: json.coverage.compared,
    preserved: json.counts.preserved,
    rattled: json.counts.rattled,
    cracked: json.counts.cracked,
    unsealed: json.counts.unsealed,
    skipped: json.counts.skipped,
    red_ids: json.jars.filter((j: { state: string }) => j.state === "rattled" || j.state === "cracked")
      .map((j: { id: string }) => j.id),
    schema_removed: json.schema_diff.tools_removed,
    schema_added: json.schema_diff.tools_added,
    schema_input_changed: json.schema_diff.input_schema_changed,
    ms,
  });
}

const schemaCount = (r: Row) => r.schema_removed.length + r.schema_added.length + r.schema_input_changed.length;
const lines = [
  "# Detection table — `scripts/bench.ts detect`",
  "",
  `Generated ${new Date().toISOString()} by \`npx tsx scripts/bench.ts detect\` from the committed jars (\`jars/\`), baseline v1 for tools/list.`,
  "",
  "| server | verdict | jars compared | preserved | rattled | cracked | unsealed | skipped | red jars | schema-diff changes | what the schema diff saw | wall ms |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map((r) => {
    const saw = [
      ...r.schema_removed.map((t) => `removed ${t}`),
      ...r.schema_added.map((t) => `added ${t}`),
      ...r.schema_input_changed.map((t) => `input of ${t}`),
    ].join(", ") || "nothing";
    return `| hollow-inn ${r.version} | ${r.verdict} | ${r.compared} | ${r.preserved} | ${r.rattled} | ${r.cracked} | ${r.unsealed} | ${r.skipped} | ${r.red_ids.join(", ") || "-"} | ${schemaCount(r)} | ${saw} | ${r.ms} |`;
  }),
  "",
  "Wall ms = one cold `specimen replay` process including `npx tsx` start-up of the server per session; it is not a latency benchmark.",
  "",
];
mkdirSync(join(root, "evidence/bench"), { recursive: true });
writeFileSync(join(root, "evidence/bench/detect.md"), lines.join("\n"));
writeFileSync(join(root, "evidence/bench/detect.json"), JSON.stringify(rows, null, 2) + "\n");
console.log(lines.join("\n"));
