/* Guitar → Tab end-to-end: the REAL app, REAL guitar worker, REAL 25 MB model, REAL ONNX Runtime
 * Web 1.23.2 (jsDelivr) — no stubs. Dev-only, Node + headless Chromium.
 *
 *   node bench/guitar-e2e.mjs --deps <dir> --gs <guitarset_extract.py dir> [--track 00_BN1-129-Eb_comp] [--ua "<UA>"]
 *
 * 1. Serves the repo, boots index.html (only the boot CDNs the sandbox blocks are served
 *    locally — React/Babel from --deps, same recipe as scnet-e2e.mjs), opens Audio mode, uploads
 *    a GuitarSet mic recording and presses "🎸 Guitar → Tab (ML)".
 * 2. Records the call (wall time, progress, notes) by trapping window.TTP_GUITAR_MODEL, samples
 *    peak memory (summed PSS of every Chromium process), and logs which ORT / guitar files loaded.
 * 3. Opens the chart's "AlphaTex (tab)" export, parses it with alphaTab, and scores the notes
 *    against the GuitarSet annotation: note F1 (onset ±50 ms + pitch) and Tab F1 (+ string).
 */
import fs from "node:fs"; import path from "node:path"; import http from "node:http";
import { createRequire } from "node:module";
import * as L from "./lib.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const DEPS = arg("deps"), GS = arg("gs");
if (!DEPS || !GS) { console.error("--deps <dir> and --gs <dir> are required"); process.exit(2); }
const TRACK = arg("track", "00_BN1-129-Eb_comp");
const require = createRequire(import.meta.url);
const { chromium } = require(arg("playwright", "/opt/node-tools/node_modules/playwright"));
const alphaTab = await import("@coderline/alphatab");
const eng = await L.loadEngine();

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".tsx": "text/plain", ".json": "application/json", ".onnx": "application/octet-stream", ".wav": "audio/wav", ".bin": "application/octet-stream" };
const served = [], received = {};
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (req.method === "POST" && u.pathname === "/__e2e/meta") {
    const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => { received.meta = JSON.parse(Buffer.concat(chunks).toString()); res.end("ok"); }); return;
  }
  const f = path.join(L.repo, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname));
  if (!f.startsWith(L.repo)) { res.statusCode = 403; res.end(); return; }
  if (/guitar/.test(u.pathname)) served.push(u.pathname + u.search);
  fs.readFile(f, (e, data) => { if (e) { res.statusCode = 404; res.end(); return; } res.setHeader("content-type", MIME[path.extname(f)] || "application/octet-stream"); res.end(data); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const chromePids = () => fs.readdirSync("/proc").filter((p) => /^\d+$/.test(p)).filter((p) => { try { return /chrom|headless_shell/i.test(fs.readFileSync(`/proc/${p}/cmdline`, "utf8").split("\0")[0]); } catch (_) { return false; } });
const pss = (p) => { try { const m = /Pss:\s+(\d+)/.exec(fs.readFileSync(`/proc/${p}/smaps_rollup`, "utf8")); return m ? +m[1] * 1024 : 0; } catch (_) { return 0; } };
let memPeak = 0;
const sampleMem = () => { const s = chromePids().map(pss).reduce((a, b) => a + b, 0); memPeak = Math.max(memPeak, s); return s; };

const browser = await chromium.launch({ executablePath: arg("chromium", undefined) });
const ctx = await browser.newContext({ ...(arg("ua") ? { userAgent: arg("ua") } : {}) });
const ALL = fs.readFileSync(path.join(DEPS, "all.mjs"), "utf8"), BABEL = fs.readFileSync(path.join(DEPS, "babel.min.js"));
const js = (body) => ({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body });
await ctx.route("https://esm.sh/__e2e/all.mjs", (r) => r.fulfill(js(ALL)));
await ctx.route(/^https:\/\/esm\.sh\/react@18\.3\.1(\?.*)?$/, (r) => r.fulfill(js('export * from "/__e2e/all.mjs"; export { React as default } from "/__e2e/all.mjs";')));
await ctx.route(/^https:\/\/esm\.sh\/react-dom@18\.3\.1\/client.*/, (r) => r.fulfill(js('import { createRoot, hydrateRoot } from "/__e2e/all.mjs"; export { createRoot, hydrateRoot }; export default { createRoot, hydrateRoot };')));
await ctx.route("https://unpkg.com/@babel/standalone@7.25.6/babel.min.js", (r) => r.fulfill({ ...js(""), body: BABEL }));
await ctx.route(/^https:\/\/cdnjs\.cloudflare\.com\//, (r) => r.abort());
const net = [];
ctx.on("request", (q) => { if (/jsdelivr|onnxruntime/.test(q.url())) net.push(q.url()); });
await ctx.addInitScript(() => {
  let real = null;
  Object.defineProperty(window, "TTP_GUITAR_MODEL", {
    configurable: true,
    get() { return real && (async (pcm, opts) => {
      const t0 = performance.now(), prog = [];
      const o = await real(pcm, { ...opts, onProgress: (d, t) => { prog.push([Math.round(performance.now() - t0), d, t]); if (opts && opts.onProgress) opts.onProgress(d, t); } });
      await fetch("/__e2e/meta", { method: "POST", body: JSON.stringify({ ms: performance.now() - t0, samples: pcm.length, prog, notes: o.notes }) });
      return o;
    }); },
    set(v) { real = v; },
  });
});
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
let workers = 0; page.on("worker", (w) => { workers++; w.on("console", (m) => logs.push(`[worker] ${m.text()}`)); });

await page.goto(ORIGIN + "/"); await page.waitForTimeout(500);
const memBase = sampleMem();
await page.getByRole("button", { name: "Audio 🎵" }).click({ timeout: 60000 });
await page.locator('input[type="file"]:not([multiple])').first().setInputFiles(path.join(GS, TRACK + ".wav"));
const btn = page.getByRole("button", { name: "🎸 Guitar → Tab (ML)" });
await btn.waitFor({ timeout: 120000 });
await page.waitForFunction(() => !document.body.innerText.includes("⏳ Analyzing"), null, { timeout: 300000 });
const tick = setInterval(sampleMem, 250);
const t0 = Date.now();
await btn.click();
await page.getByText(/notes from the guitar model/).waitFor({ timeout: 1800000 }).catch(async (e) => { console.error("no chart:", (await page.locator("body").innerText()).slice(0, 600)); throw e; });
const wall = Date.now() - t0;
clearInterval(tick);

// AlphaTex from the UI's own export button (the chart for this track)
const panel = page.locator("div", { has: page.getByText(/notes from the guitar model/) }).last();
await page.getByRole("button", { name: "AlphaTex (tab)" }).last().click();
const tex = await page.locator("textarea").last().inputValue();
const imp = new alphaTab.importer.AlphaTexImporter(); imp.initFromString(tex, new alphaTab.Settings());
let atBars = 0, atNotes = 0, atErr = null;
try { const sc = imp.readScore(); const st = sc.tracks[0].staves[0]; atBars = st.bars.length; for (const b of st.bars) for (const v of b.voices) for (const bt of v.beats) atNotes += bt.notes.filter((n) => !n.isTieDestination).length; } catch (e) { atErr = e.message; }

// score the UI's notes against the annotation (note F1 + Tab F1 with the engine's fingering)
const gt = JSON.parse(fs.readFileSync(path.join(GS, TRACK + ".json"), "utf8"));
const ref = gt.notes.map((n) => ({ onset: n.onset_s, midi: Math.round(n.midi), string: n.string }));
const est = (received.meta && received.meta.notes || []).map((n) => ({ onset: n.startSec, offset: n.endSec, midi: n.midi }));
const groups = [];
for (const n of [...est].sort((a, b) => a.onset - b.onset || a.midi - b.midi)) { const g = groups[groups.length - 1]; if (g && n.onset - g.onset <= 0.035 && g.notes.length < 6 && !g.notes.some((x) => x.midi === n.midi)) g.notes.push(n); else groups.push({ onset: n.onset, notes: [n] }); }
const { shapes } = eng.fingerSequence(groups.map((g) => ({ midis: g.notes.map((n) => n.midi) })), eng.TUNINGS.Standard);
groups.forEach((g, i) => { const used = new Set(); for (const n of g.notes) { const sh = shapes[i] || []; const j = sh.findIndex((x, xi) => !used.has(xi) && x.midi === n.midi); if (j >= 0) { used.add(j); n.string = sh[j].string; } } });
const pairs = [];
ref.forEach((r, i) => est.forEach((e, j) => { const d = Math.abs(r.onset - e.onset); if (d <= 0.05 && r.midi === e.midi) pairs.push([d, i, j]); }));
pairs.sort((a, b) => a[0] - b[0]);
const ri = new Set(), ej = new Set(); let tp = 0, tpTab = 0;
for (const [, i, j] of pairs) if (!ri.has(i) && !ej.has(j)) { ri.add(i); ej.add(j); tp++; if (ref[i].string === est[j].string) tpTab++; }
const f1 = (a) => (est.length + ref.length ? (200 * a) / (est.length + ref.length) : 0);
const audioSec = received.meta ? received.meta.samples / 16000 : 0;
console.log(JSON.stringify({
  track: TRACK, audioSec: +audioSec.toFixed(1), wallSec: +(wall / 1000).toFixed(1), modelSec: received.meta ? +(received.meta.ms / 1000).toFixed(1) : null,
  xRealTime: received.meta ? +(received.meta.ms / 1000 / audioSec).toFixed(2) : null, progress: received.meta && received.meta.prog,
  peakOverPageMB: Math.round((memPeak - memBase) / 2 ** 20), workersSpawned: workers,
  ortFiles: [...new Set(net.map((u) => u.replace(/^https:\/\/cdn\.jsdelivr\.net\/npm\//, "")))], guitarFiles: [...new Set(served)],
  notes: est.length, annotated: ref.length, noteF1: +f1(tp).toFixed(1), tabF1: +f1(tpTab).toFixed(1),
  alphaTex: { bars: atBars, notes: atNotes, parseError: atErr },
}, null, 1));
const bad = logs.filter((l) => /error|fail/i.test(l)); if (bad.length) console.log("console:", bad.slice(0, 8).join("\n"));
await browser.close(); server.close();
