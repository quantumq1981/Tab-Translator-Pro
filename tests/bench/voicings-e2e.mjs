/* Chord-voicing modal end to end: the REAL app, the REAL bundled svguitar UMD and data/chords.json,
 * no stubs. Dev-only, Node + headless Chromium.
 *
 *   node bench/voicings-e2e.mjs --deps <dir> [--gp "Steely Dan - Peg.gp4"] [--part 1] [--width 390 --height 844] [--ua "<UA>"] [--out <dir>]
 *
 * MusicXML / GP mode → upload --gp → tap the first lead-sheet chord → waits for the modal's
 * diagrams, screenshots Fingers + Intervals, taps a substitution, re-opens a second chord (the
 * dictionary must be fetched ONCE), and reports what was fetched + any console errors.
 * --deps is the React + Babel bundle scnet-e2e.mjs describes (the sandbox blocks esm.sh / unpkg).
 */
import fs from "node:fs"; import path from "node:path"; import http from "node:http";
import { createRequire } from "node:module";
import * as L from "./lib.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const DEPS = arg("deps"); if (!DEPS) { console.error("--deps <dir> is required"); process.exit(2); }
const GP = path.resolve(L.repo, arg("gp", "Steely Dan - Peg.gp4")), OUT = arg("out", process.cwd());
const require = createRequire(import.meta.url);
const { chromium } = require(arg("playwright", "/opt/node-tools/node_modules/playwright"));

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".tsx": "text/plain", ".json": "application/json" };
const served = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const f = path.join(L.repo, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname));
  if (!f.startsWith(L.repo)) { res.statusCode = 403; res.end(); return; }
  if (/svguitar|chords\.json/.test(u.pathname)) served.push(u.pathname);
  fs.readFile(f, (e, data) => { if (e) { res.statusCode = 404; res.end(); return; } res.setHeader("content-type", MIME[path.extname(f)] || "application/octet-stream"); res.end(data); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: arg("chromium", "/opt/pw-browsers/chromium") });
const ctx = await browser.newContext({ viewport: { width: +arg("width", 390), height: +arg("height", 844) }, deviceScaleFactor: 2, hasTouch: true, ...(arg("ua") ? { userAgent: arg("ua") } : {}) });
const ALL = fs.readFileSync(path.join(DEPS, "all.mjs"), "utf8"), BABEL = fs.readFileSync(path.join(DEPS, "babel.min.js"));
const js = (body) => ({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body });
await ctx.route("https://esm.sh/__e2e/all.mjs", (r) => r.fulfill(js(ALL)));
await ctx.route(/^https:\/\/esm\.sh\/react@18\.3\.1(\?.*)?$/, (r) => r.fulfill(js('export * from "/__e2e/all.mjs"; export { React as default } from "/__e2e/all.mjs";')));
await ctx.route(/^https:\/\/esm\.sh\/react-dom@18\.3\.1\/client.*/, (r) => r.fulfill(js('import { createRoot, hydrateRoot } from "/__e2e/all.mjs"; export { createRoot, hydrateRoot }; export default { createRoot, hydrateRoot };')));
await ctx.route("https://unpkg.com/@babel/standalone@7.25.6/babel.min.js", (r) => r.fulfill({ ...js(""), body: BABEL }));
const external = [];
await ctx.route(/^https:\/\/(?!esm\.sh|unpkg\.com)/, (r) => { external.push(r.request().url()); r.abort(); });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => { if (m.type() === "error") logs.push(`[error] ${m.text()}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

const result = {};
await page.goto(ORIGIN + "/"); await page.waitForTimeout(500);
await page.getByRole("button", { name: "MusicXML / GP" }).click({ timeout: 60000 });
await page.locator('input[type="file"]').first().setInputFiles(GP);
if (arg("part")) { await page.locator('button[title^="chart the "]').nth(+arg("part")).click(); await page.waitForTimeout(800); }
const chordBtn = page.locator('button[title*="guitar voicings"]');
await chordBtn.first().waitFor({ timeout: 60000 });
const sym0 = (await chordBtn.first().innerText()).trim().split("\n")[0];
const t0 = Date.now();
await chordBtn.first().click();
const modal = page.getByRole("dialog");
await modal.locator("svg").first().waitFor({ timeout: 30000 });
await page.waitForTimeout(600);
result.first = { chord: sym0, openSec: +((Date.now() - t0) / 1000).toFixed(2), count: await modal.getByText(/\d+ voicings?$/).innerText(),
  diagrams: await modal.locator("svg").count(), groups: await modal.locator("section > div:first-child").allInnerTexts() };
await page.screenshot({ path: path.join(OUT, "voicings-fingers.png") });
await modal.getByRole("button", { name: "Intervals", exact: true }).click();
await page.waitForTimeout(500);
result.first.intervalLabels = [...new Set((await modal.locator("svg text").evaluateAll((ns) => ns.map((n) => n.textContent))).filter((t) => /^(R|b?\d+|#\d+|bb7)$/.test(t)))];
result.first.overlay = await modal.evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, height: r.height, vh: innerHeight }; });
await page.screenshot({ path: path.join(OUT, "voicings-intervals.png") });
const subBtn = modal.locator("section").last().locator("button").first();
if (await subBtn.count()) {
  const subSym = (await subBtn.locator("span").first().innerText()).trim();
  await subBtn.click(); await page.waitForTimeout(800);
  result.substitution = { opened: subSym, header: (await modal.locator("span").first().innerText()).trim(), diagrams: await modal.locator("svg").count() };
  await page.screenshot({ path: path.join(OUT, "voicings-sub-top.png") });
  await modal.locator("section").last().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, "voicings-sub.png") });
}
await modal.getByRole("button", { name: "close" }).click();
await page.waitForTimeout(300);
result.closed = (await page.getByRole("dialog").count()) === 0;
// a second chord: the dictionary must NOT be fetched again
const n = await chordBtn.count();
await chordBtn.nth(Math.min(5, n - 1)).click();
await modal.locator("svg").first().waitFor({ timeout: 30000 });
result.second = { chord: (await modal.locator("span").first().innerText()).trim(), diagrams: await modal.locator("svg").count() };
await page.screenshot({ path: path.join(OUT, "voicings-second.png") });

result.served = served; result.externalBlocked = external; result.consoleErrors = logs;
console.log(JSON.stringify(result, null, 2));
await browser.close(); server.close();
