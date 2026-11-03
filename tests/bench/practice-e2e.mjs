/* WO-2 practice end to end: the REAL app in headless Chromium.
 *
 *   node bench/practice-e2e.mjs --deps <dir> [--gp blue-sky.gp] [--out <dir>]
 *
 * 1. MusicXML / GP mode → upload --gp → 🎯 Practice → 75 % + metronome + count-in → ▶ Practice:
 *    the loop renders (WSOLA in the engine worker) and plays; the chart highlight moves.
 * 2. ⬇ Click track (WAV) downloads a RIFF file.
 * 3. Live chords: Chromium's fake microphone plays a synthesized, strummed C – G – Am – F (2 s each,
 *    looped); the in-app tracker must name the four chords in order.
 * --deps is the React + Babel bundle bench/README.md describes.
 */
import fs from "node:fs"; import path from "node:path"; import http from "node:http"; import os from "node:os";
import { createRequire } from "node:module";
import * as L from "./lib.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const DEPS = arg("deps"); if (!DEPS) { console.error("--deps <dir> is required"); process.exit(2); }
const GP = path.resolve(L.repo, arg("gp", "blue-sky.gp")), OUT = arg("out", process.cwd());
const require = createRequire(import.meta.url);
const { chromium } = require(arg("playwright", "/opt/node-tools/node_modules/playwright"));
globalThis.DOMParser = (await import("@xmldom/xmldom")).DOMParser;
const engPath = path.join(L.repo, "tests", ".engine.practice-e2e.mjs");
fs.writeFileSync(engPath, fs.readFileSync(path.join(L.repo, "engine.tsx"), "utf8"));
const eng = await import(engPath);

// the fake microphone: C G Am F, strummed on every beat at 120 bpm, 2 s per chord, 16 s
const SR = 48000, prog = [[48, 52, 55, 60, 64], [43, 47, 50, 55, 59], [45, 52, 57, 60, 64], [41, 48, 53, 57, 60]];
const mic = new Float32Array(SR * 16);
for (let c = 0; c < 8; c++) for (let k = 0; k < 4; k++) {
  const t0 = c * 2 + k * 0.5;
  for (const m of prog[c % 4]) {
    const f = 440 * Math.pow(2, (m - 69) / 12), i0 = Math.round(t0 * SR);
    for (let i = 0; i < SR * 0.5; i++) { const t = i / SR; mic[i0 + i] += 0.07 * Math.exp(-t * 3) * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.25 * Math.sin(6 * Math.PI * f * t)); }
  }
}
const micWav = path.join(os.tmpdir(), `ttp-fake-mic-${process.pid}.wav`);
fs.writeFileSync(micWav, eng.encodeWav16([mic], SR));

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".tsx": "text/plain", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const f = path.join(L.repo, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname));
  if (!f.startsWith(L.repo)) { res.statusCode = 403; res.end(); return; }
  fs.readFile(f, (e, data) => { if (e) { res.statusCode = 404; res.end(); return; } res.setHeader("content-type", MIME[path.extname(f)] || "application/octet-stream"); res.end(data); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: arg("chromium", "/opt/pw-browsers/chromium"),
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${micWav}`, "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, permissions: ["microphone"], acceptDownloads: true });
const ALL = fs.readFileSync(path.join(DEPS, "all.mjs"), "utf8"), BABEL = fs.readFileSync(path.join(DEPS, "babel.min.js"));
const js = (body) => ({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body });
// routes registered LATER win in Playwright: the blanket abort goes first
await ctx.route(/^https:\/\/(cdnjs\.cloudflare\.com|fonts\.googleapis\.com)\//, (r) => r.abort());
await ctx.route("https://esm.sh/__e2e/all.mjs", (r) => r.fulfill(js(ALL)));
await ctx.route(/^https:\/\/esm\.sh\/react@18\.3\.1(\?.*)?$/, (r) => r.fulfill(js('export * from "/__e2e/all.mjs"; export { React as default } from "/__e2e/all.mjs";')));
await ctx.route(/^https:\/\/esm\.sh\/react-dom@18\.3\.1\/client.*/, (r) => r.fulfill(js('import { createRoot, hydrateRoot } from "/__e2e/all.mjs"; export { createRoot, hydrateRoot }; export default { createRoot, hydrateRoot };')));
await ctx.route("https://unpkg.com/@babel/standalone@7.25.6/babel.min.js", (r) => r.fulfill({ ...js(""), body: BABEL }));
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => { if (m.type() === "error") logs.push(`[error] ${m.text()}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
const result = { steps: [] };
const ok = (name, cond, extra) => { result.steps.push({ name, ok: !!cond, ...(extra !== undefined ? { extra } : {}) }); if (!cond) console.error("FAIL:", name, extra ?? ""); };

await page.goto(ORIGIN + "/"); await page.waitForTimeout(400);
await page.getByRole("button", { name: "MusicXML / GP" }).click({ timeout: 60000 });
await page.locator('input[type="file"]').first().setInputFiles(GP);
await page.getByRole("button", { name: "🎯 Practice" }).click({ timeout: 60000 });
await page.locator("select").filter({ has: page.locator("option[value='75']") }).selectOption("75");
await page.getByRole("button", { name: "♩ metronome" }).click();
const t0 = Date.now();
await page.getByRole("button", { name: "▶ Practice" }).click();
await page.getByRole("button", { name: "■ Stop" }).first().waitFor({ timeout: 60000 });
result.renderSec = +((Date.now() - t0) / 1000).toFixed(2);
ok("the 75 % loop renders and starts", true, result.renderSec);
await page.waitForTimeout(3500);
result.highlighted = await page.evaluate(() => [...document.querySelectorAll("*")].filter((el) => /rgb\(152, 195, 121\)/.test(getComputedStyle(el).borderColor) && el.children.length < 4).length);
await page.screenshot({ path: path.join(OUT, "practice.png") });
ok("the chart's playhead highlight follows the loop", result.highlighted > 0, result.highlighted);
await page.getByRole("button", { name: "■ Stop" }).first().click();
const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), page.getByRole("button", { name: /Click track \(WAV\)/ }).click()]);
const wavPath = path.join(OUT, "click-track.wav"); await dl.saveAs(wavPath);
const head = fs.readFileSync(wavPath).subarray(0, 4).toString("latin1");
ok("⬇ Click track (WAV) downloads a WAV", head === "RIFF" && fs.statSync(wavPath).size > 100000, { head, bytes: fs.statSync(wavPath).size });

// Live chords on the fake microphone
await page.getByRole("button", { name: "Live chords 🎶" }).click();
await page.getByRole("button", { name: "🎤 Listen" }).click();
await page.waitForTimeout(9000);
const chips = await page.locator("section span").evaluateAll((els) => els.map((e) => e.textContent.trim()).filter((t) => /^[A-G][#b]?(m|7|maj7|m7)?$/.test(t)));
result.liveHistory = chips;
await page.screenshot({ path: path.join(OUT, "live-chords.png") });
const seq = chips.join(" ");
ok("Live chords names the fake mic's C – G – Am – F in order", /C G Am F|G Am F C|Am F C G|F C G Am/.test(seq), seq);
await page.getByRole("button", { name: "■ Stop" }).click();
result.consoleErrors = logs.filter((l) => !/fonts\.googleapis|ERR_FAILED|net::|\[BABEL\] Note/.test(l));
ok("no console errors", result.consoleErrors.length === 0, result.consoleErrors);
console.log(JSON.stringify(result, null, 2));
await browser.close(); server.close(); fs.rmSync(micWav, { force: true }); fs.rmSync(engPath, { force: true });
process.exit(result.steps.every((s) => s.ok) ? 0 : 1);
