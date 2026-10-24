/* Tab viewer end to end: the REAL app, the REAL vendored alphaTab (worker + worklet + font +
 * sound font, same-origin), no stubs. Dev-only, Node + headless Chromium.
 *
 *   node bench/tab-view-e2e.mjs --deps <dir> [--gp blue-sky.gp] [--tex saved.alphatex] [--ua "<UA>"] [--out <dir>]
 *
 * --width/--height set the viewport (default 820×1180, an iPad).
 * 1. MusicXML / GP mode → upload --gp → the chart's "Tab" view → waits for the bar count,
 *    screenshots it, presses ▶ Play and checks the clock advances.
 * 2. Uploads --tex (a saved .alphatex, e.g. from guitar-e2e.mjs --tex) in the same mode →
 *    the standalone viewer → screenshot, and "Tab only".
 * --deps is the React + Babel bundle scnet-e2e.mjs describes (the sandbox blocks esm.sh / unpkg).
 * Reports which alphaTab files loaded and any console errors.
 */
import fs from "node:fs"; import path from "node:path"; import http from "node:http";
import { createRequire } from "node:module";
import * as L from "./lib.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const DEPS = arg("deps"); if (!DEPS) { console.error("--deps <dir> is required"); process.exit(2); }
const GP = path.resolve(L.repo, arg("gp", "blue-sky.gp")), TEX = arg("tex"), OUT = arg("out", process.cwd());
const require = createRequire(import.meta.url);
const { chromium } = require(arg("playwright", "/opt/node-tools/node_modules/playwright"));

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".tsx": "text/plain", ".woff2": "font/woff2", ".woff": "font/woff", ".sf3": "application/octet-stream" };
const served = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const f = path.join(L.repo, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname));
  if (!f.startsWith(L.repo)) { res.statusCode = 403; res.end(); return; }
  if (/alphatab|tab-view/.test(u.pathname)) served.push(u.pathname);
  fs.readFile(f, (e, data) => { if (e) { res.statusCode = 404; res.end(); return; } res.setHeader("content-type", MIME[path.extname(f)] || "application/octet-stream"); res.end(data); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: arg("chromium", "/opt/pw-browsers/chromium") });
const ctx = await browser.newContext({ viewport: { width: +arg("width", 820), height: +arg("height", 1180) }, deviceScaleFactor: 2, ...(arg("ua") ? { userAgent: arg("ua") } : {}) });
const ALL = fs.readFileSync(path.join(DEPS, "all.mjs"), "utf8"), BABEL = fs.readFileSync(path.join(DEPS, "babel.min.js"));
const js = (body) => ({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body });
await ctx.route("https://esm.sh/__e2e/all.mjs", (r) => r.fulfill(js(ALL)));
await ctx.route(/^https:\/\/esm\.sh\/react@18\.3\.1(\?.*)?$/, (r) => r.fulfill(js('export * from "/__e2e/all.mjs"; export { React as default } from "/__e2e/all.mjs";')));
await ctx.route(/^https:\/\/esm\.sh\/react-dom@18\.3\.1\/client.*/, (r) => r.fulfill(js('import { createRoot, hydrateRoot } from "/__e2e/all.mjs"; export { createRoot, hydrateRoot }; export default { createRoot, hydrateRoot };')));
await ctx.route("https://unpkg.com/@babel/standalone@7.25.6/babel.min.js", (r) => r.fulfill({ ...js(""), body: BABEL }));
await ctx.route(/^https:\/\/cdnjs\.cloudflare\.com\//, (r) => r.abort());
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(`[${m.type()}] ${m.text()}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
const failed = []; page.on("requestfailed", (q) => failed.push(q.url()));

const result = {};
await page.goto(ORIGIN + "/"); await page.waitForTimeout(500);
await page.getByRole("button", { name: "MusicXML / GP" }).click({ timeout: 60000 });
const up = page.locator('input[type="file"]').first();
await up.setInputFiles(GP);
await page.getByRole("button", { name: "Tab", exact: true }).first().click({ timeout: 60000 });
const t0 = Date.now();
const view = page.locator("[data-tab-view]").first();
await view.getByText(/bars drawn/).waitFor({ timeout: 120000 });
result.gp = { file: path.basename(GP), firstDrawSec: +((Date.now() - t0) / 1000).toFixed(1), status: await view.getByText(/bars drawn/).innerText(), svgs: await view.locator("svg").count() };
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, "tab-view-gp.png") });
const play = view.getByRole("button", { name: /▶ Play/ });
await page.waitForFunction(() => { const b = [...document.querySelectorAll("[data-tab-view] button")].find((x) => /▶ Play/.test(x.textContent)); return b && !b.disabled; }, null, { timeout: 60000 });
await play.click(); await page.waitForTimeout(4000);
result.gp.clockAfter4s = await view.getByText(/^\d+:\d\d \/ \d+:\d\d$/).innerText().catch(() => null);
result.gp.playing = await view.getByRole("button", { name: /⏸ Pause/ }).count() === 1;
await page.screenshot({ path: path.join(OUT, "tab-view-playing.png") });
await view.getByRole("button", { name: /⏸ Pause/ }).click().catch(() => {});

if (TEX) {
  await up.setInputFiles(path.resolve(TEX));
  await page.getByText(/^TAB · /).waitFor({ timeout: 60000 });
  const tv = page.locator("[data-tab-view]").first();
  await tv.getByText(/bars drawn/).waitFor({ timeout: 120000 });
  result.tex = { file: path.basename(TEX), status: await tv.getByText(/bars drawn/).innerText() };
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, "tab-view-alphatex.png") });
  await tv.getByRole("button", { name: "Tab only" }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, "tab-view-tab-only.png") });
}
result.alphaTabFiles = [...new Set(served)];
// cdnjs (PDF.js) is aborted on purpose above — this run doesn't need it
result.failedRequests = failed.filter((u) => !/cdnjs\.cloudflare\.com/.test(u));
result.consoleErrors = logs.filter((l) => !(/ERR_FAILED/.test(l) && failed.length && failed.every((u) => /cdnjs/.test(u)))).slice(0, 10);
console.log(JSON.stringify(result, null, 1));
await browser.close(); server.close();
