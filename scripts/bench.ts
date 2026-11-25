// `npx tsx scripts/bench.ts detect` — the detection table (specs: complexity §3, Must).
// Replays the committed jars (jars/) against every hollow-inn version that exists, each time with
// v1 as the tools/list baseline, and writes the counts per version next to what an input-schema diff of tools/list
// (tools removed / added / inputSchema changed; descriptions are not compared) reports for the same change.
// Output: evidence/bench/detect.md (the table) + evidence/bench/detect.json (the raw counts).
// Every figure in the table comes from a real `specimen replay --json` run; nothing is typed in.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mode = process.argv[2];
if (mode !== "detect" && mode !== "hook" && mode !== "replay") {
  console.error("usage: tsx scripts/bench.ts detect | hook | replay");
  process.exit(2);
}

const root = process.cwd();

// ---- latency modes: wall-clock of whole CLI processes (`npx --no-install specimen ...`), p50/p95 over N runs ----
// Honest scope: these are cold-process times on this machine, including `npx` start-up. They are not in-process timings.
function pct(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!;
}
function stats(ms: number[]) {
  const sorted = [...ms].sort((a, b) => a - b);
  return { n: ms.length, min: sorted[0]!, p50: pct(sorted, 0.5), p95: pct(sorted, 0.95), max: sorted[sorted.length - 1]! };
}
function writeLatency(file: string, title: string, cmd: string, note: string, rows: Array<[string, ReturnType<typeof stats>]>) {
  const lines = [
    `# ${title}`,
    "",
    `Generated ${new Date().toISOString()} by \`${cmd}\` on ${process.platform}/${process.arch}, node ${process.version}. Wall-clock of whole CLI processes, milliseconds.`,
    "",
    "| case | runs | min | p50 | p95 | max |",
    "|---|---|---|---|---|---|",
    ...rows.map(([name, st]) => `| ${name} | ${st.n} | ${st.min} | ${st.p50} | ${st.p95} | ${st.max} |`),
    "",
    note,
    "",
  ];
  mkdirSync(join(root, "evidence/bench"), { recursive: true });
  writeFileSync(join(root, "evidence/bench", `${file}.md`), lines.join("\n"));
  writeFileSync(join(root, "evidence/bench", `${file}.json`), JSON.stringify(Object.fromEntries(rows), null, 2) + "\n");
}

if (mode === "hook") {
  const N = 30;
  const scratch = mkdtempSync(join(tmpdir(), "specimen-bench-hook-"));
  const run = (event: "pre" | "post", payload: object) => {
    const t0 = performance.now();
    execFileSync("npx", ["--no-install", "specimen", "hook", event, "--server", "hollowinn"], {
      cwd: root, input: JSON.stringify(payload), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    return Math.round(performance.now() - t0);
  };
  const pre: number[] = [];
  const post: number[] = [];
  for (let i = 0; i < N; i++) {
    const base = { session_id: `bench-${i}`, cwd: scratch, tool_name: "@hollowinn/quote" };
    pre.push(run("pre", { ...base, hook_event_name: "PreToolUse", tool_input: { room_id: "R-101", nights: 3 } }));
    post.push(run("post", {
      ...base, hook_event_name: "PostToolUse", tool_input: { room_id: "R-101", nights: 3 },
      tool_response: JSON.stringify({ room_id: "R-101", nights: 3, total: 425.0, currency: "USD" }),
    }));
  }
  rmSync(scratch, { recursive: true, force: true });
  writeLatency("hook", "Hook latency — `scripts/bench.ts hook`", "npx tsx scripts/bench.ts hook",
    "Each run is a fresh `npx --no-install specimen hook <pre|post> --server hollowinn` process fed one payload on stdin, in a throw-away `.specimen/` directory (cwd in the payload), so the committed jars are never touched. The Kiro hook adds the cost of its own process launch on top; the number to compare against the hook `timeout` in `.kiro/hooks/*.json`.",
    [["hook pre (PreToolUse)", stats(pre)], ["hook post (PostToolUse)", stats(post)]]);
  console.log(readFileSync(join(root, "evidence/bench/hook.md"), "utf8"));
  process.exit(0);
}

if (mode === "replay") {
  const N = 10;
  const out: Record<string, number[]> = {};
  for (const v of ["v1", "v2.1"]) {
    const server = `npx tsx servers/hollow-inn/src/main.ts ${v}`;
    out[v] = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      try {
        execFileSync("npx", ["--no-install", "specimen", "replay", "--server", server, "--baseline", "npx tsx servers/hollow-inn/src/main.ts v1", "--json",
          "--out", join(tmpdir(), `specimen-bench-replay-${v}.json`)], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      } catch { /* a non-zero exit (HOLD) still measures the run */ }
      out[v]!.push(Math.round(performance.now() - t0));
    }
  }
  writeLatency("replay", "Replay latency — `scripts/bench.ts replay`", "npx tsx scripts/bench.ts replay",
    "Each run replays all 10 committed jars (racks A and B, 5 jars each) against one hollow-inn version, with v1 as the tools/list baseline. A fresh server process per recorded session, started with `npx tsx`, so the figure includes TypeScript start-up of the server. With 10 runs per row the nearest-rank p95 is the slowest run. Machine-dependent; run on a laptop, not a CI box.",
    Object.entries(out).map(([v, ms]) => [`specimen replay, hollow-inn ${v}`, stats(ms)] as [string, ReturnType<typeof stats>]));
  console.log(readFileSync(join(root, "evidence/bench/replay.md"), "utf8"));
  process.exit(0);
}
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
  "| server | verdict | jars compared | preserved | rattled | cracked | unsealed | skipped | red jars | input-schema diff changes | what the input-schema diff saw | wall ms |",
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
  "Input-schema diff = tools removed, tools added, `inputSchema` changed in `tools/list` (descriptions are not compared). Wall ms = one cold `specimen replay` process including `npx tsx` start-up of the server per session; it is not a latency benchmark.",
  "",
];
mkdirSync(join(root, "evidence/bench"), { recursive: true });
writeFileSync(join(root, "evidence/bench/detect.md"), lines.join("\n"));
writeFileSync(join(root, "evidence/bench/detect.json"), JSON.stringify(rows, null, 2) + "\n");
console.log(lines.join("\n"));
