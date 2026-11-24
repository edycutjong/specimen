// Serves the PRODUCTION build (vite preview, not the dev server) and reads the in-page result with headless Chromium.
import { preview } from "vite";
import { chromium } from "playwright";

const server = await preview({ preview: { port: 4317, strictPort: true }, logLevel: "silent" });
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url);
await page.waitForFunction(() => document.getElementById("result")?.dataset.status !== "RUNNING", null, { timeout: 15000 });
const status = await page.$eval("#result", (el) => el.dataset.status);
const text = await page.$eval("#result", (el) => el.textContent);
console.log(`url ${url}`);
console.log(`status ${status}`);
console.log(text);
if (errors.length) console.log(`page errors: ${errors.join(" | ")}`);
await browser.close();
await server.close();
process.exit(status === "PASS" ? 0 : 1);
