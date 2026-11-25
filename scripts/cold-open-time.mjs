// Measures the cabinet's cold open in a real browser: ms from navigation start to the verdict word on the plate
// (the end of the cold open: lightning, Reveal, settle, count-up) and to the "IT'S MOVING" stamp.
// Needs puppeteer and a Chrome: PUP=<dir that has node_modules/puppeteer>/ (default: this repo), CHROME=<binary>.
// Run: node scripts/cold-open-time.mjs [url] [runs]   — fresh browser context (empty cache) per run, 1440x900.
import { createRequire } from "node:module";

const PUP = process.env.PUP || `${process.cwd()}/`;
const puppeteer = (await import(createRequire(PUP).resolve("puppeteer"))).default;
const [url = "https://specimen.edycu.dev/", runsArg = "5"] = process.argv.slice(2);
const runs = Number(runsArg);

const browser = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const rows = [];
for (let i = 0; i < runs; i++) {
  const ctx = await (browser.createBrowserContext ? browser.createBrowserContext() : browser.createIncognitoBrowserContext()); // fresh cache each run
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => {
    window.__marks = {};
    const tick = () => {
      const t = performance.now();
      const text = document.body ? document.body.innerText : "";
      if (window.__marks.stamp === undefined && text.includes("IT'S MOVING")) window.__marks.stamp = t;
      const pending = document.querySelector(".verdict-plate__status--pending");
      const word = document.querySelector(".verdict-plate__word");
      if (window.__marks.verdict === undefined && !pending && word && /\b(HOLD|SHIP)\b/.test(word.textContent)) window.__marks.verdict = t;
      if (window.__marks.stamp === undefined || window.__marks.verdict === undefined) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__marks.stamp !== undefined && window.__marks.verdict !== undefined, { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 600));
  const m = await page.evaluate(() => ({
    ...window.__marks,
    dcl: performance.getEntriesByType("navigation")[0]?.domContentLoadedEventEnd,
    replayMs: (document.body.innerText.match(/replayed in ([\d.,]+) ?ms/i) || [])[1] ?? null,
  }));
  rows.push(m);
  await ctx.close();
}
await browser.close();
const r = (x) => (x === undefined ? "—" : Math.round(x));
console.log(`url ${url} · 1440x900 · ${runs} fresh-context runs · ms from navigation start`);
console.log("run · DOMContentLoaded · verdict word · stamp");
rows.forEach((m, i) => console.log(`${i + 1} · ${r(m.dcl)} · ${r(m.verdict)} · ${r(m.stamp)}`));
for (const k of ["verdict", "stamp"]) {
  const v = rows.map((m) => m[k]).sort((a, b) => a - b);
  console.log(`${k} min ${r(v[0])} · median ${r(v[Math.floor(v.length / 2)])} · max ${r(v[v.length - 1])}`);
}
