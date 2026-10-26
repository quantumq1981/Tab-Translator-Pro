/* Tempo & bars end-to-end: the REAL app in headless Chromium, a real GuitarSet recording, the REAL
 * beat_this worker + 24.1 MB model + ONNX Runtime Web 1.23.2 (jsDelivr) — no stubs. Dev-only.
 *
 *   node bench/tempo-e2e.mjs --deps <dir> --gs <dir with <track>.wav + .json> [--track 05_SS3-98-C_solo] [--shot out.png]
 *
 * Checks, in the order a user would do them: the panel appears with a detected tempo; ×2 doubles
 * ♩= and ÷2 brings it back; "One fixed tempo" / "Follow the performance" toggle; 🥁 Find bar 1 (ML)
 * loads only the beat files + the pinned runtime and switches the grid to beat_this (with its
 * downbeat); the chart's first bar line vs the annotation's; 🎧 Check by ear starts and stops.
 */
import fs from "node:fs"; import path from "node:path"; import http from "node:http";
import { createRequire } from "node:module";
import * as L from "./lib.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const DEPS = arg("deps"), GS = arg("gs"), TRACK = arg("track", "05_SS3-98-C_solo");
if (!DEPS || !GS) { console.error("--deps <dir> and --gs <dir> are required"); process.exit(2); }
const require = createRequire(import.meta.url);
const { chromium } = require(arg("playwright", "/opt/node-tools/node_modules/playwright"));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".tsx": "text/plain", ".json": "application/json", ".onnx": "application/octet-stream", ".wav": "audio/wav" };
const served = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const f = path.join(L.repo, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname));
  if (!f.startsWith(L.repo)) { res.statusCode = 403; res.end(); return; }
  if (/beat-/.test(u.pathname)) served.push(u.pathname);
  fs.readFile(f, (e, data) => { if (e) { res.statusCode = 404; res.end(); return; } res.setHeader("content-type", MIME[path.extname(f)] || "application/octet-stream"); res.end(data); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });
const ALL = fs.readFileSync(path.join(DEPS, "all.mjs"), "utf8"), BABEL = fs.readFileSync(path.join(DEPS, "babel.min.js"));
const js = (body) => ({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body });
await ctx.route("https://esm.sh/__e2e/all.mjs", (r) => r.fulfill(js(ALL)));
await ctx.route(/^https:\/\/esm\.sh\/react@18\.3\.1(\?.*)?$/, (r) => r.fulfill(js('export * from "/__e2e/all.mjs"; export { React as default } from "/__e2e/all.mjs";')));
await ctx.route(/^https:\/\/esm\.sh\/react-dom@18\.3\.1\/client.*/, (r) => r.fulfill(js('import { createRoot, hydrateRoot } from "/__e2e/all.mjs"; export { createRoot, hydrateRoot }; export default { createRoot, hydrateRoot };')));
await ctx.route("https://unpkg.com/@babel/standalone@7.25.6/babel.min.js", (r) => r.fulfill({ ...js(""), body: BABEL }));
await ctx.route(/^https:\/\/cdnjs\.cloudflare\.com\//, (r) => r.abort());
const net = []; ctx.on("request", (q) => { if (/jsdelivr|onnxruntime/.test(q.url())) net.push(q.url().replace(/^https:\/\/cdn\.jsdelivr\.net\/npm\//, "")); });
const page = await ctx.newPage();
const logs = []; page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`)); page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
const out = { track: TRACK };
const panelText = async () => (await page.getByText(/^TEMPO & BARS$/).locator("xpath=..").innerText());
const tempoOf = (t) => { const m = /♩=~?([\d.]+)/.exec(t); return m ? +m[1] : null; };

await page.goto(ORIGIN + "/"); await page.waitForTimeout(500);
await page.getByRole("button", { name: "Audio 🎵" }).click({ timeout: 60000 });
await page.locator('input[type="file"]:not([multiple])').first().setInputFiles(path.join(GS, TRACK + ".wav"));
await page.getByText(/^TEMPO & BARS$/).waitFor({ timeout: 300000 });
await page.waitForFunction(() => !document.body.innerText.includes("⏳ Analyzing"), null, { timeout: 300000 });
let t = await panelText(); out.detected = t.split("\n").slice(1, 2).join(" "); out.bpm0 = tempoOf(t);
await page.getByRole("button", { name: "×2" }).click(); out.bpmX2 = tempoOf(await panelText());
await page.getByRole("button", { name: "÷2" }).click(); out.bpmBack = tempoOf(await panelText());
if (await page.getByRole("button", { name: "One fixed tempo" }).count()) {
  await page.getByRole("button", { name: "One fixed tempo" }).click(); out.fixed = /Detected/.test(await panelText());
  await page.getByRole("button", { name: "Follow the performance" }).click(); out.follow = /follow the performance/.test(await panelText());
}
const chartMeta = async () => { const m = await page.getByText(/bars · ♩=/).first().innerText(); return m; };
out.chartBefore = await chartMeta();
const t0 = Date.now();
await page.getByRole("button", { name: /Find bar 1/ }).click();
await page.getByRole("button", { name: "🥁 beat_this" }).waitFor({ timeout: 1200000 }).catch(async (e) => { out.findError = (await panelText()).slice(-300); });
out.findBarsSec = +((Date.now() - t0) / 1000).toFixed(1);
t = await panelText(); out.afterML = t.split("\n").slice(1, 2).join(" "); out.bpmML = tempoOf(t);
const m = /Bar line at ([\d:.]+)/.exec(t); out.barLine = m && m[1];
out.chartAfter = await chartMeta();
const ann = JSON.parse(fs.readFileSync(path.join(GS, TRACK + ".json"), "utf8"));
out.annotated = { tempo: ann.tempo_bpm, firstBeat: ann.beats_s[0] };
// check by ear: starts, says Stop, stops
const cbe = page.getByRole("button", { name: "🎧 Check by ear" }).first();
await cbe.click(); await page.waitForTimeout(800);
out.checkByEar = await page.getByRole("button", { name: "■ Stop check" }).count() > 0;
if (out.checkByEar) await page.getByRole("button", { name: "■ Stop check" }).first().click();
if (arg("shot")) await page.getByText(/^TEMPO & BARS$/).locator("xpath=..").screenshot({ path: arg("shot") });
out.beatFiles = [...new Set(served)]; out.ortFiles = [...new Set(net)];
out.errors = logs.filter((l) => /pageerror|\berror\b/i.test(l)).slice(0, 6);
console.log(JSON.stringify(out, null, 1));
await browser.close(); server.close();
