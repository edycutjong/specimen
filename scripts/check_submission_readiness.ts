// Submission readiness gate. Run: npx tsx scripts/check_submission_readiness.ts [--allow-pending-video] [--submission <file>]...
// Exit 0 = every check passed (a pending video URL passes only with --allow-pending-video and is printed as PENDING),
// exit 1 = at least one FAIL. Read-only: it never edits a file. Needs `git`; the check-spec check also runs the real `specimen` CLI.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const allowPendingVideo = args.includes("--allow-pending-video");
const extraFiles = args.flatMap((a, i) => (a === "--submission" && args[i + 1] ? [resolve(args[i + 1])] : []));

type Row = { name: string; status: "PASS" | "FAIL" | "PENDING"; detail: string };
const rows: Row[] = [];
const add = (name: string, status: Row["status"], detail: string): void => void rows.push({ name, status, detail });
const git = (...a: string[]): { code: number; out: string } => {
  const r = spawnSync("git", ["-C", root, ...a], { encoding: "utf8" });
  return { code: r.status ?? 1, out: (r.stdout ?? "").trim() };
};
const read = (p: string): string => readFileSync(p, "utf8");
const prose = ["README.md", "JUDGE.md", "DEMO.md", "ARCHITECTURE.md", "docs/DX-REPORT.md", "docs/EXPERIMENT.md"].map((f) => join(root, f)).concat(extraFiles);

// 1. /.kiro and prompts/ exist, are not ignored, and are tracked (rules: /.kiro at the repo root, not gitignored; tool-scored prompts).
for (const dir of [".kiro", "prompts"]) {
  const exists = existsSync(join(root, dir));
  const ignored = git("check-ignore", "-q", dir).code === 0;
  const tracked = git("ls-files", dir).out.split("\n").filter(Boolean).length;
  add(`${dir}/ present, not ignored, tracked`, exists && !ignored && tracked > 0 ? "PASS" : "FAIL", `exists=${exists} ignored=${ignored} tracked files=${tracked}`);
}

// 2. Placeholder fields in the judge-facing prose.
const placeholder = /\b(TODO|TBD|FIXME|XXX|lorem ipsum|coming soon|work in progress|placeholder)\b|\[(video|url|link|your)[^\]]*\]|<(video|url|link)[^>]*>/i;
const hits: string[] = [];
for (const f of prose) {
  if (!existsSync(f)) {
    hits.push(`${f}: missing`);
    continue;
  }
  read(f).split("\n").forEach((line, i) => {
    const m = placeholder.exec(line);
    if (m) hits.push(`${f.replace(root + "/", "")}:${i + 1} "${m[0]}"`);
  });
}
add("no placeholder fields in README/JUDGE/DEMO/ARCHITECTURE/docs", hits.length === 0 ? "PASS" : "FAIL", hits.length === 0 ? `${prose.length} files scanned` : hits.slice(0, 8).join("; "));

// 3. Video URL in the README (the only field allowed to stay pending until the human uploads it).
const readme = existsSync(join(root, "README.md")) ? read(join(root, "README.md")) : "";
const hasVideo = /https:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{6,}/.test(readme);
add("demo video URL in README", hasVideo ? "PASS" : allowPendingVideo ? "PENDING" : "FAIL", hasVideo ? "YouTube link found" : "no YouTube link yet (the upload is a human step)");

// 4. Every spec folder is complete; every bugfix spec passes check-spec against the newest v2 replay.
const specsDir = join(root, ".kiro/specs");
const specDirs = existsSync(specsDir) ? readdirSync(specsDir).filter((d) => statSync(join(specsDir, d)).isDirectory()) : [];
const executed = existsSync(join(root, "servers/hollow-inn/src/v2_1.ts")); // v2.1 exists -> every bugfix spec was executed
const incomplete: string[] = [];
for (const d of specDirs) {
  const need = existsSync(join(specsDir, d, "bugfix.md")) ? ["bugfix.md", ...(executed ? ["design.md", "tasks.md"] : [])] : ["requirements.md", "design.md", "tasks.md"];
  for (const f of need) if (!existsSync(join(specsDir, d, f)) || statSync(join(specsDir, d, f)).size < 200) incomplete.push(`${d}/${f}`);
}
add(`.kiro/specs complete (${specDirs.length} specs)`, specDirs.length > 0 && incomplete.length === 0 ? "PASS" : "FAIL", incomplete.length ? `missing or tiny: ${incomplete.join(", ")}` : "every feature spec has requirements/design/tasks; every bugfix spec has bugfix/design/tasks");

const replays = existsSync(join(root, "replays")) ? readdirSync(join(root, "replays")).filter((f) => /-v2-\d{4}-/.test(f) && f.endsWith(".json")).sort() : [];
const newestV2 = replays.at(-1);
const bad: string[] = [];
let checked = 0;
let jarsChecked = 0;
for (const d of specDirs) {
  const bf = join(specsDir, d, "bugfix.md");
  if (!existsSync(bf) || !newestV2) continue;
  const ids = [...new Set([...read(bf).matchAll(/"id":\s*"(SPC-\d+)"/g)].map((m) => m[1]!))];
  if (ids.length === 0) {
    bad.push(`${d}: no jar id`);
    continue;
  }
  checked++;
  // a2a r07: every jar the spec names, not only the first (the quote spec names three)
  for (const id of ids) {
    jarsChecked++;
    const r = spawnSync("npx", ["--no-install", "specimen", "check-spec", bf, "--jar", id, "--replay", join(root, "replays", newestV2)], { cwd: root, encoding: "utf8" });
    if (r.status !== 0) bad.push(`${d} (${id}) exit ${r.status}`);
  }
}
add("every bugfix spec passes `specimen check-spec`", checked > 0 && bad.length === 0 ? "PASS" : "FAIL", bad.length ? bad.join("; ") : `${checked} specs, ${jarsChecked} jars against ${newestV2}`);

// 5. "Kiro filed" claims need the curator command's provenance.
const claim = /Kiro has filed|filed by Kiro|Kiro-filed/i;
const claimed = prose.filter((f) => existsSync(f) && claim.test(read(f)));
const provenance = existsSync(join(root, ".kiro/agents/specimen-curator.json")) && existsSync(join(root, "evidence/slice/01-specimen-file.md"));
add("\"Kiro filed\" claims have curator provenance", claimed.length === 0 || provenance ? "PASS" : "FAIL", claimed.length === 0 ? "no such claim on any scanned surface" : `claim in ${claimed.length} files; provenance=${provenance}`);

// 6. The built cabinet loads no third-party host.
const dist = join(root, "apps/cabinet/dist");
if (existsSync(dist)) {
  const files = execFileSync("find", [dist, "-type", "f", "(", "-name", "*.html", "-o", "-name", "*.css", "-o", "-name", "*.js", ")"], { encoding: "utf8" }).split("\n").filter(Boolean);
  // a2a r07: only an <a href> is navigation. Every other src/href (script, link, img, iframe, …), url(), @import and
  // fetch() is a request, and a request to any host but our own fails the check, whichever host it is.
  const OWN = "specimen.edycu.dev";
  const hosts = new Set<string>();
  const nav = new Set<string>();
  for (const f of files) {
    const t = read(f);
    for (const m of t.matchAll(/<([a-zA-Z][\w-]*)\b[^>]*?\s(?:src|href)=["']https?:\/\/([^/"'?#]+)/g)) {
      (m[1]!.toLowerCase() === "a" ? nav : hosts).add(m[2]!);
    }
    for (const m of t.matchAll(/url\(["']?https?:\/\/([^/)"']+)|@import\s+["']https?:\/\/([^/"']+)|fetch\(["']https?:\/\/([^/"']+)/g)) {
      hosts.add((m[1] ?? m[2] ?? m[3])!);
    }
  }
  const other = [...hosts].filter((h) => h !== OWN && !/(^|\.)w3\.org$/.test(h));
  add("built site requests no third-party host", other.length === 0 ? "PASS" : "FAIL", other.length ? other.join(", ") : `${files.length} built files scanned (cabinet, /landing/, /deck/); <a> links only: ${[...nav].sort().join(", ") || "none"}`);

  // The deploy is the cabinet plus the landing and the deck (vercel.json): a cabinet-only dist is not the live site.
  const need = ["index.html", "landing/index.html", "deck/index.html", "static/replay.js", "static/repo.json"];
  const missing = need.filter((p) => !existsSync(join(dist, p)));
  let repoPublic: unknown = null;
  try { repoPublic = (JSON.parse(read(join(dist, "static/repo.json"))) as { public?: unknown }).public; } catch { /* reported as missing */ }
  add("built site has the cabinet, landing, deck and replay bundle", missing.length === 0 ? "PASS" : "FAIL", missing.length ? `missing in apps/cabinet/dist: ${missing.join(", ")} — run the vercel.json buildCommand` : `${need.length} files; repo links ${repoPublic === true ? "ON" : "off (VITE_REPO_PUBLIC unset: turn on at the public flip)"}`);
} else add("built site requests no third-party host", "FAIL", "apps/cabinet/dist missing: run the vercel.json buildCommand first");

// 7. A kitchen file never sits in the repository.
const leak = git("ls-files").out.split("\n").filter((p) => !p.startsWith(".kiro/") && /(^|\/)(CLAUDE|AGENTS)\.md$|^PRODUCT\.md$|(^|\/)\.claude\/|^specs\/|(^|\/)progress\.md$|graphify-out\/|(^|\/)\.env(\.[\w-]+)?$/.test(p) && !p.endsWith(".env.example"));
add("no kitchen file tracked", leak.length === 0 ? "PASS" : "FAIL", leak.length ? leak.join(", ") : "ls-files grep empty");

for (const r of rows) console.log(`${r.status.padEnd(7)} ${r.name} — ${r.detail}`);
const failed = rows.filter((r) => r.status === "FAIL").length;
console.log(`\n${rows.length - failed - rows.filter((r) => r.status === "PENDING").length} pass · ${rows.filter((r) => r.status === "PENDING").length} pending · ${failed} fail`);
process.exit(failed === 0 ? 0 : 1);
