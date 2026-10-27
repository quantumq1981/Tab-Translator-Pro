/* Memory curve of a REAL split of a REAL recording — where does the page peak?
 *
 *   node bench/split-mem-e2e.mjs --deps <dir> --input song.mp3 [--ua "<UA>"] [--compact 1] [--fast 1]
 *                                [--pre ab,beat] [--no-split 1] [--out <dir>] [--timeout 60]
 *
 * Boots the real app in headless Chromium (as scnet-e2e.mjs does: only the boot CDNs are served
 * locally), uploads --input in Audio mode, optionally runs what a user does first (--pre ab = ⚖ A/B
 * clarity, beat = 🥁 Find bar 1 (ML)), then presses ✂ Split and samples the PSS of every Chromium
 * process every 250 ms until the stem charts are on screen. Chromium runs workers inside the page's
 * renderer process, as Safari does, so the largest process is the number iOS judges.
 * Writes mem.json ({ t, totalMB, maxProcMB, phase }[]) and prints the peak per phase.
 */
import fs from "node:fs"; import path from "node:path"; import http from "node:http"; import os from "node:os";
import { createRequire } from "node:module";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const DEPS = arg("deps"), INPUT = arg("input");
if (!DEPS || !INPUT) { console.error("--deps <dir> and --input <file> are required"); process.exit(2); }
const OUT = arg("out", fs.mkdtempSync(path.join(os.tmpdir(), "split-mem-"))); fs.mkdirSync(OUT, { recursive: true });
const TIMEOUT_MIN = +arg("timeout", 60), PRE = String(arg("pre", "")).split(",").filter(Boolean);
// --repo: serve another checkout (e.g. a worktree of the previous commit) to compare before/after
const repo = path.resolve(arg("repo", path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..")));
const require = createRequire(import.meta.url);
const { chromium } = require(arg("playwright", "playwright"));

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".tsx": "text/plain", ".json": "application/json", ".onnx": "application/octet-stream", ".wasm": "application/wasm" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const f = path.join(repo, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname));
  if (!f.startsWith(repo)) { res.statusCode = 403; res.end(); return; }
  fs.readFile(f, (e, data) => {
    if (e) { res.statusCode = 404; res.end(); return; }
    res.setHeader("content-type", MIME[path.extname(f)] || "application/octet-stream"); res.end(data);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const chromePids = () => fs.readdirSync("/proc").filter((p) => /^\d+$/.test(p)).filter((p) => { try { return /chrom|headless_shell/i.test(fs.readFileSync(`/proc/${p}/cmdline`, "utf8").split("\0")[0]); } catch (_) { return false; } });
const pss = (p) => { try { const m = /Pss:\s+(\d+)/.exec(fs.readFileSync(`/proc/${p}/smaps_rollup`, "utf8")); return m ? +m[1] * 1024 : 0; } catch (_) { return 0; } };
const line = []; let phase = "boot", t0 = Date.now();
const sample = () => { const v = chromePids().map(pss); line.push({ t: +((Date.now() - t0) / 1000).toFixed(1), totalMB: Math.round(v.reduce((a, b) => a + b, 0) / 2 ** 20), maxProcMB: Math.round(Math.max(0, ...v) / 2 ** 20), phase }); };
const timer = setInterval(sample, 250);
// written every 10 s too, so a crash or a killed run still leaves the curve
const flush = setInterval(() => { try { fs.writeFileSync(path.join(OUT, "mem.json"), JSON.stringify(line)); } catch (_) {} }, 10000);

const browser = await chromium.launch({ executablePath: arg("chromium", undefined), args: ["--enable-features=SharedArrayBuffer", "--js-flags=--expose-gc"] });
const ctx = await browser.newContext({ ...(arg("ua") ? { userAgent: arg("ua") } : {}) });
const ALL = fs.readFileSync(path.join(DEPS, "all.mjs"), "utf8"), BABEL = fs.readFileSync(path.join(DEPS, "babel.min.js"));
const js = (body) => ({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body });
await ctx.route("https://esm.sh/__e2e/all.mjs", (r) => r.fulfill(js(ALL)));
await ctx.route(/^https:\/\/esm\.sh\/react@18\.3\.1(\?.*)?$/, (r) => r.fulfill(js('export * from "/__e2e/all.mjs"; export { React as default } from "/__e2e/all.mjs";')));
await ctx.route(/^https:\/\/esm\.sh\/react-dom@18\.3\.1\/client.*/, (r) => r.fulfill(js('import { createRoot, hydrateRoot } from "/__e2e/all.mjs"; export { createRoot, hydrateRoot }; export default { createRoot, hydrateRoot };')));
await ctx.route("https://unpkg.com/@babel/standalone@7.25.6/babel.min.js", (r) => r.fulfill({ ...js(""), body: BABEL }));
await ctx.route(/^https:\/\/cdnjs\.cloudflare\.com\//, (r) => r.abort());
if (arg("compact", null) !== null) await ctx.addInitScript(() => { try { localStorage.setItem("ttp:stems:compact", "1"); } catch (_) {} });
if (arg("fast", null) !== null) await ctx.addInitScript(() => { try { localStorage.setItem("ttp:stems:fast", "1"); } catch (_) {} });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("crash", () => logs.push("[CRASH] renderer crashed"));

const text = () => page.evaluate(() => document.body.innerText).catch(() => "");
const waitText = async (re, min = 30) => { const end = Date.now() + min * 60000; while (Date.now() < end) { const t = await text(); if (re.test(t)) return t; await page.waitForTimeout(1000); } throw new Error("timed out waiting for " + re); };

await page.goto(ORIGIN + "/");
await page.getByRole("button", { name: "Audio 🎵" }).click({ timeout: 60000 });
phase = "decode+chords";
await page.locator('input[type="file"]:not([multiple])').first().setInputFiles(INPUT);
await page.getByRole("button", { name: "✂ Split this mix into stems" }).waitFor({ timeout: 300000 });
await waitText(/TEMPO\s*&\s*BARS/i, 10);
await page.waitForTimeout(3000);
for (const p of PRE) {
  if (p === "ab") { phase = "ab-clarity"; await page.getByRole("button", { name: /A\/B clarity/ }).click(); await waitText(/Harmony clarity/, 10); }
  if (p === "beat") {
    phase = "beat_this"; await page.getByRole("button", { name: /Find bar 1/ }).click();
    // phase per beat_this window ("Finding bars… k/N × 30 s"), so a per-window climb shows in mem.json
    const end = Date.now() + 20 * 60000;
    while (Date.now() < end) {
      const t = await text(), m = /Finding bars… (\d+)\/(\d+)/.exec(t);
      const st = /Finding bars… ([A-Za-z][A-Za-z0-9 ]*)/.exec(t);
      if (m) phase = `beat_this w${m[1]}/${m[2]}`; else if (st) phase = `beat_this ${st[1]}`;
      if (/beat_this/.test(t) && !/Finding bars…/.test(t)) break;
      await page.waitForTimeout(250);
    }
    phase = "beat_this done"; await page.waitForTimeout(2000);
  }
}
if (arg("no-split", null) !== null) {
  phase = "idle"; await page.waitForTimeout(3000);
  clearInterval(timer); clearInterval(flush); await browser.close(); server.close();
  const pk = {}; for (const s of line) { pk[s.phase] = Math.max(pk[s.phase] || 0, s.maxProcMB); }
  fs.writeFileSync(path.join(OUT, "mem.json"), JSON.stringify(line)); fs.writeFileSync(path.join(OUT, "console.log"), logs.join("\n"));
  console.log(JSON.stringify({ largestProcessMB: pk, out: OUT, lastLogs: logs.slice(-6) }, null, 1));
  process.exit(0);
}
phase = "separating"; const tSplit = Date.now();
await page.getByRole("button", { name: "✂ Split this mix into stems" }).click();
const end = Date.now() + TIMEOUT_MIN * 60000; let err = "";
while (Date.now() < end) {
  await page.waitForTimeout(1000);
  const t = await text();
  if (/Charting every instrument/.test(t)) phase = "charting";
  const e = (t.match(/Stem separation failed[^\n]*|Charting the stems failed[^\n]*/) || [""])[0];
  if (e) { err = e; break; }
  if (phase === "charting" && !/Charting every instrument/.test(t) && /⬇ All parts/.test(t)) { phase = "done"; break; }
  if ((Date.now() - tSplit) % 60000 < 1100) { const l = line[line.length - 1] || {}; console.error(`  … ${((Date.now() - tSplit) / 1000).toFixed(0)} s ${phase} · ${l.maxProcMB} MB largest process`); }
}
await page.waitForTimeout(5000);
clearInterval(timer); clearInterval(flush);
await browser.close(); server.close();

const peaks = {};
for (const s of line) { const k = s.phase; peaks[k] = peaks[k] || { totalMB: 0, maxProcMB: 0, from: s.t, to: s.t }; peaks[k].totalMB = Math.max(peaks[k].totalMB, s.totalMB); peaks[k].maxProcMB = Math.max(peaks[k].maxProcMB, s.maxProcMB); peaks[k].to = s.t; }
fs.writeFileSync(path.join(OUT, "mem.json"), JSON.stringify(line));
fs.writeFileSync(path.join(OUT, "console.log"), logs.join("\n"));
console.log(JSON.stringify({ ok: !err && phase === "done", err, splitSec: Math.round((Date.now() - tSplit) / 1000), peaks, out: OUT, lastLogs: logs.slice(-8) }, null, 1));
