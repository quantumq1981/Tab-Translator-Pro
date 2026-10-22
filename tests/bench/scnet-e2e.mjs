/* SCNet end-to-end: the REAL app, REAL vendor bundle, REAL stem worker, REAL model — no stubs.
 *
 *   node bench/scnet-e2e.mjs --deps <dir> [--tracks 3] [--sec 40] [--out <dir>]
 *
 * 1. Renders known stems from the GP corpus (comp/"other", bass, drums), pans them into a
 *    stereo mix and writes mix.wav.
 * 2. Serves the repo, boots index.html in headless Chromium (/opt/pw-browsers), uploads the
 *    mix in Audio mode and presses "✂ Split this mix into stems". Only the boot CDNs the
 *    sandbox blocks are served locally (esm.sh React, unpkg Babel — see --deps); ONNX
 *    Runtime (jsDelivr) and the weights (Hugging Face) are fetched for real.
 * 3. Measures wall time, peak memory (summed PSS of every Chromium process, sampled), and
 *    SDR of each separated stem against its known source.
 * 4. Rebuilds the per-instrument charts from the separated stems with the same engine
 *    call the UI makes, and scores them against ground truth next to the perfect-stem and
 *    mix-only baselines.
 *
 * --deps must hold all.mjs (React 18.3.1 + react-dom/client bundled into ONE ESM module,
 * so there is one React) and babel.min.js (@babel/standalone 7.25.6). Build recipe in
 * tests/bench/README.md.
 */
import fs from "node:fs"; import path from "node:path"; import http from "node:http"; import os from "node:os";
import { createRequire } from "node:module";
import * as L from "./lib.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const DEPS = arg("deps"); if (!DEPS) { console.error("--deps <dir> is required"); process.exit(2); }
const NTRACKS = +arg("tracks", 3), SEC = +arg("sec", 40), OUT = arg("out", fs.mkdtempSync(path.join(os.tmpdir(), "scnet-e2e-")));
const TIMEOUT_MIN = +arg("timeout", 60);
const require = createRequire(import.meta.url);
const { chromium } = require(arg("playwright", "playwright"));

const eng = await L.loadEngine();
const SR = 44100, T = 16000;

/* ---------- 1. a mix from known stems ---------- */
function renderDrums(len, bpm, R) {
  const y = new Float32Array(len), spb = 60 / bpm, hits = [];
  for (let b = 0; b * spb * SR < len; b++) {
    const at = Math.floor(b * spb * SR);
    if (b % 2 === 0) { hits.push({ t: b * spb, type: "kick" }); for (let i = 0; i < 0.3 * SR && at + i < len; i++) { const t = i / SR; y[at + i] += 0.9 * Math.sin(2 * Math.PI * (50 + 70 * Math.exp(-t * 30)) * t) * Math.exp(-t * 9); } }
    else { hits.push({ t: b * spb, type: "snare" }); for (let i = 0; i < 0.18 * SR && at + i < len; i++) { const t = i / SR; y[at + i] += (0.5 * (R() * 2 - 1) + 0.3 * Math.sin(2 * Math.PI * 185 * t)) * Math.exp(-t * 22); } }
    for (const off of [0, 0.5]) { const tt = (b + off) * spb, h = Math.floor(tt * SR); if (h >= len) continue; hits.push({ t: tt, type: "hat" }); let hp = 0, prev = 0; for (let i = 0; i < 0.05 * SR && h + i < len; i++) { const w = R() * 2 - 1; hp = 0.85 * (hp + w - prev); prev = w; y[h + i] += 0.25 * hp * Math.exp(-i / (SR * 0.012)); } }
  }
  return { y, hits };
}
const rms = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / (a.length || 1)) || 1; };
const scaled = (a, r) => { const g = r / rms(a), o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] * g; return o; };
const pan = (m, p) => [Float32Array.from(m, (v) => v * Math.cos((p + 1) * Math.PI / 4) * Math.SQRT2), Float32Array.from(m, (v) => v * Math.sin((p + 1) * Math.PI / 4) * Math.SQRT2)];

const segs = [];
for (const [file, bassPart] of Object.entries(L.BASS_PART).slice(0, NTRACKS)) {
  const idx = L.CORPUS.findIndex(([f]) => f === file); const [, part, inst] = L.CORPUS[idx];
  const bytes = new Uint8Array(fs.readFileSync(path.join(L.repo, file)));
  const r = L.renderPart(eng, await eng.parseGuitarProOrXML(bytes, file, true, part), { sr: SR, instrument: inst, seed: 17 + idx, maxSec: SEC });
  const br = L.renderPart(eng, await eng.parseGuitarProOrXML(bytes, file, true, bassPart), { sr: SR, instrument: arg("bass-voice", "bass"), seed: 99, fromSec: r.t0, maxSec: SEC });
  const len = r.audio.length, R = L.rng(5 + idx);
  const comp = scaled(r.audio, 0.1), bass = scaled(Float32Array.from({ length: len }, (_, i) => br.audio[i] || 0), 0.08);
  const dr = renderDrums(len, r.bpm, R);
  segs.push({ file, len, bpm: r.bpm, gt: r.gt, hits: dr.hits, other: pan(comp, -0.4), bass: pan(bass, 0), drums: pan(scaled(dr.y, 0.08), 0.1) });
}
const GAP = SR;                                      // 1 s of silence between songs
const N = segs.reduce((s, g) => s + g.len + GAP, 0);
const ref = Object.fromEntries(["other", "bass", "drums"].map((k) => [k, [new Float32Array(N), new Float32Array(N)]]));
const gt = [], hits = [];
let off = 0;
for (const g of segs) {
  g.off = off;
  for (const k of ["other", "bass", "drums"]) for (let c = 0; c < 2; c++) ref[k][c].set(g[k][c], off);
  const t0 = off / SR;
  for (const x of g.gt) gt.push({ ...x, t0: x.t0 + t0, t1: x.t1 + t0 });
  for (const h of g.hits) if (h.t < g.len / SR - 0.1) hits.push({ ...h, t: h.t + t0 });
  gt.push({ t0: (off + g.len) / SR, t1: (off + g.len + GAP) / SR, label: null });
  off += g.len + GAP;
}
const mixLR = [0, 1].map((c) => Float32Array.from({ length: N }, (_, i) => ref.other[c][i] + ref.bass[c][i] + ref.drums[c][i]));
let peak = 0; for (const ch of mixLR) for (const v of ch) peak = Math.max(peak, Math.abs(v));
if (peak > 0.98) { const g = 0.98 / peak; for (const set of [mixLR, ...Object.values(ref)]) for (const ch of set) for (let i = 0; i < N; i++) ch[i] *= g; }
fs.writeFileSync(path.join(OUT, "mix.wav"), eng.encodeWav16(mixLR, SR));
const durSec = N / SR;
console.error(`mix: ${segs.map((s) => s.file).join(" + ")} — ${durSec.toFixed(1)} s → ${OUT}/mix.wav`);

/* ---------- 2. serve + drive the real app (or --reuse a previous run's stems) ---------- */
// 16-bit PCM WAV reader for --reuse (encodeWav16's own layout: 44-byte header, interleaved)
function readWav16(file) {
  const b = fs.readFileSync(file), ch = b.readUInt16LE(22), n = (b.length - 44) / 2 / ch, out = Array.from({ length: ch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) out[c][i] = b.readInt16LE(44 + 2 * (i * ch + c)) / 32768;
  return out;
}
async function driveApp() {
  const received = {};
  const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".tsx": "text/plain", ".json": "application/json", ".wav": "audio/wav", ".bin": "application/octet-stream" };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (req.method === "POST" && u.pathname.startsWith("/__e2e/stem/")) {
      const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => {
        const b = Buffer.concat(chunks); received[u.pathname.slice(12)] = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice(); res.end("ok");
      }); return;
    }
    if (req.method === "POST" && u.pathname === "/__e2e/meta") {
      const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => { received.meta = JSON.parse(Buffer.concat(chunks).toString()); res.end("ok"); }); return;
    }
    const f = u.pathname === "/__e2e/mix.wav" ? path.join(OUT, "mix.wav") : path.join(L.repo, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname));
    if (!f.startsWith(L.repo) && !f.startsWith(OUT)) { res.statusCode = 403; res.end(); return; }
    fs.readFile(f, (e, data) => { if (e) { res.statusCode = 404; res.end(); return; } res.setHeader("content-type", MIME[path.extname(f)] || "application/octet-stream"); res.end(data); });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const ORIGIN = `http://127.0.0.1:${server.address().port}`;

  // peak memory: summed PSS of all Chromium processes, sampled every 250 ms
  // match by executable path, not process name: the headless shell's comm is "headless_shell"
  const chromePids = () => fs.readdirSync("/proc").filter((p) => /^\d+$/.test(p)).filter((p) => { try { return /chrom|headless_shell/i.test(fs.readFileSync(`/proc/${p}/cmdline`, "utf8").split("\0")[0]); } catch (_) { return false; } });
  const pss = (p) => { try { const m = /Pss:\s+(\d+)/.exec(fs.readFileSync(`/proc/${p}/smaps_rollup`, "utf8")); return m ? +m[1] * 1024 : 0; } catch (_) { return 0; } };
  let memPeak = 0, memPeakProc = 0, memBase = 0;
  const sampleMem = () => { const v = chromePids().map(pss); const s = v.reduce((a, b) => a + b, 0); memPeak = Math.max(memPeak, s); memPeakProc = Math.max(memPeakProc, ...v, 0); return s; };

  const browser = await chromium.launch({ executablePath: arg("chromium", undefined), args: ["--enable-features=SharedArrayBuffer"] });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const ALL = fs.readFileSync(path.join(DEPS, "all.mjs"), "utf8"), BABEL = fs.readFileSync(path.join(DEPS, "babel.min.js"));
  const js = (body) => ({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body });
  await ctx.route("https://esm.sh/__e2e/all.mjs", (r) => r.fulfill(js(ALL)));
  await ctx.route(/^https:\/\/esm\.sh\/react@18\.3\.1(\?.*)?$/, (r) => r.fulfill(js('export * from "/__e2e/all.mjs"; export { React as default } from "/__e2e/all.mjs";')));
  await ctx.route(/^https:\/\/esm\.sh\/react-dom@18\.3\.1\/client.*/, (r) => r.fulfill(js('import { createRoot, hydrateRoot } from "/__e2e/all.mjs"; export { createRoot, hydrateRoot }; export default { createRoot, hydrateRoot };')));
  await ctx.route("https://unpkg.com/@babel/standalone@7.25.6/babel.min.js", (r) => r.fulfill({ ...js(""), body: BABEL }));
  await ctx.route(/^https:\/\/cdnjs\.cloudflare\.com\//, (r) => r.abort());        // PDF.js — not needed for audio
  const net = [];
  ctx.on("request", (q) => { if (/jsdelivr|huggingface|hf\.co/.test(q.url())) net.push({ url: q.url(), t: Date.now() }); });
  ctx.on("requestfailed", (q) => { if (/jsdelivr|huggingface|hf\.co/.test(q.url())) console.error("REQUEST FAILED", q.url().slice(0, 120), q.failure() && q.failure().errorText); });

  // --compact: start with the app's Low-memory toggle on (what an iPhone gets by default)
  if (arg("compact", null) !== null) await ctx.addInitScript(() => { try { localStorage.setItem("ttp:stems:compact", "1"); } catch (_) {} });
  // Record the real separator's call without replacing it: trap the global it publishes.
  await ctx.addInitScript(() => {
    let real = null;
    Object.defineProperty(window, "TTP_STEM_MODEL", {
      configurable: true,
      get() { return real && (async (L, R, sr, opts) => {
        const t0 = performance.now(); window.__stemProgress = [];
        const o = await real(L, R, sr, { ...opts, onProgress: (d, t) => { window.__stemProgress.push([performance.now() - t0, d, t]); if (opts && opts.onProgress) opts.onProgress(d, t); } });
        const ms = performance.now() - t0;
        for (const [k, chs] of Object.entries(o.stems)) for (let c = 0; c < chs.length; c++) await fetch(`/__e2e/stem/${k}_${c}`, { method: "POST", body: chs[c] });
        await fetch("/__e2e/meta", { method: "POST", body: JSON.stringify({ ms, device: o.device, compact: !!o.compact, sampleRate: o.sampleRate, progress: window.__stemProgress, keys: Object.keys(o.stems) }) });
        return o;
      }); },
      set(v) { real = v; },
    });
  });
  const page = await ctx.newPage();
  const logs = [];
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  page.on("worker", (w) => w.on("console", (m) => logs.push(`[worker ${m.type()}] ${m.text()}`)));

  memBase = (await page.goto(ORIGIN + "/"), await page.waitForTimeout(500), sampleMem());
  await page.getByRole("button", { name: "Audio 🎵" }).click({ timeout: 60000 });
  await page.locator('input[type="file"]:not([multiple])').first().setInputFiles(path.join(OUT, "mix.wav"));
  await page.getByRole("button", { name: "✂ Split this mix into stems" }).waitFor({ timeout: 120000 });
  await page.waitForFunction(() => typeof window.TTP_STEM_MODEL === "function", null, { timeout: 60000 });
  await page.waitForTimeout(1500);                    // let the upload's own chord pass settle
  memBase = sampleMem(); memPeak = memBase; memPeakProc = 0;
  const tClick = Date.now();
  await page.getByRole("button", { name: "✂ Split this mix into stems" }).click();
  const timer = setInterval(sampleMem, 250);
  const deadline = Date.now() + TIMEOUT_MIN * 60000;
  let uiErr = ""; const uiProg = [];
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    const st = await page.evaluate(() => {
      const t = document.body.innerText;
      const panel = (t.match(/STEMS → PER-INSTRUMENT CHARTS[\s\S]{0,700}/) || [""])[0];
    return { err: (t.match(/Stem separation failed[^\n]*|Charting the stems failed[^\n]*|Upload a song above first\.|The stem separator isn't loaded[^\n]*/) || [""])[0], busy: (t.match(/Separating stems[^\n]*|Charting every instrument[^\n]*/) || [""])[0], panel };
    }).catch(() => ({}));
    if (st.busy) uiProg.push([Date.now() - tClick, st.busy]);
    if (st.err) { uiErr = st.err; break; }
    if (received.meta && !st.busy) break;
    if ((Date.now() - tClick) % 30000 < 2100) console.error(`  … ${((Date.now() - tClick) / 1000).toFixed(0)} s ${st.busy || ""}`);
  if (!st.busy && !received.meta && Date.now() - tClick > 20000 && !st.err) { uiErr = "split never started; stems panel: " + JSON.stringify((st.panel || "").slice(0, 600)); break; }
  }
  clearInterval(timer);
  const wallMs = Date.now() - tClick;
  const uiText = await page.evaluate(() => document.body.innerText).catch(() => "");
  fs.writeFileSync(path.join(OUT, "console.log"), logs.join("\n"));
  fs.writeFileSync(path.join(OUT, "network.json"), JSON.stringify(net, null, 1));
  await browser.close(); server.close();

  if (uiErr || !received.meta) {
    console.log(JSON.stringify({ ok: false, uiErr, wallMs, network: net.map((n) => n.url.slice(0, 100)), lastLogs: logs.slice(-15) }, null, 1));
    process.exit(1);
  }
  fs.writeFileSync(path.join(OUT, "run.json"), JSON.stringify({ meta: received.meta, wallMs, uiText, network: net, uiProg, memory: { memBase, memPeak, memPeakProc } }));
  const est = Object.fromEntries(received.meta.keys.map((k) => [k, [received[k + "_0"], received[k + "_1"]]]));
  return { est, run: JSON.parse(fs.readFileSync(path.join(OUT, "run.json"), "utf8")) };

}
const REUSE = arg("reuse");
const { est, run } = REUSE
  ? { est: Object.fromEntries(["vocals", "drums", "bass", "other"].map((k) => [k, readWav16(path.join(REUSE, `sep-${k}.wav`))])), run: JSON.parse(fs.readFileSync(path.join(REUSE, "run.json"), "utf8")) }
  : await driveApp();
const { meta, wallMs, uiText, network: net, uiProg } = run, { memBase, memPeak, memPeakProc } = run.memory;

/* ---------- 3. SDR ---------- */
const sdr = (s, e) => { let a = 0, b = 0; for (let c = 0; c < 2; c++) for (let i = 0; i < s[c].length; i++) { const d = s[c][i] - (e[c][i] || 0); a += s[c][i] * s[c][i]; b += d * d; } return 10 * Math.log10(a / (b || 1e-12)); };
const frameSdr = (s, e) => {                         // museval-style: median over 1 s frames that carry signal
  const W = SR, v = [];
  for (let f = 0; f + W <= N; f += W) { let a = 0, b = 0; for (let c = 0; c < 2; c++) for (let i = f; i < f + W; i++) { const d = s[c][i] - (e[c][i] || 0); a += s[c][i] * s[c][i]; b += d * d; } if (a > 1e-6) v.push(10 * Math.log10(a / (b || 1e-12))); }
  v.sort((x, y) => x - y); return v.length ? v[v.length >> 1] : NaN;
};
const energy = (x) => { let a = 0; for (const ch of x) for (const v of ch) a += v * v; return a; };
const SDR = {};
for (const k of ["drums", "bass", "other"]) SDR[k] = { sdr: +sdr(ref[k], est[k]).toFixed(2), medianFrameSdr: +frameSdr(ref[k], est[k]).toFixed(2) };
for (const k of ["drums", "bass", "other", "vocals"]) { SDR[k] = { ...(SDR[k] || {}), energyDbRelMix: +(10 * Math.log10((energy(est[k]) || 1e-12) / energy(mixLR))).toFixed(1) }; if (!REUSE) fs.writeFileSync(path.join(OUT, `sep-${k}.wav`), eng.encodeWav16(est[k], SR)); }
for (const k of ["drums", "bass", "other"]) { SDR[k].refEnergyDbRelMix = +(10 * Math.log10(energy(ref[k]) / energy(mixLR))).toFixed(1); fs.writeFileSync(path.join(OUT, `ref-${k}.wav`), eng.encodeWav16(ref[k], SR)); }
SDR.vocalsLeakDb = +(10 * Math.log10(energy(est.vocals) / energy(mixLR))).toFixed(1);   // no vocals in the mix: anything here is leakage
let resid = 0; for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) { const d = mixLR[c][i] - est.vocals[c][i] - est.drums[c][i] - est.bass[c][i] - est.other[c][i]; resid += d * d; }
SDR.sumToMixDb = +(10 * Math.log10(resid / energy(mixLR))).toFixed(1);

/* ---------- 4. charts from the separated stems (the UI's exact inputs) ---------- */
const toMono16 = (lr) => eng.resampleTo(Float32Array.from(lr[0], (v, i) => 0.5 * (v + lr[1][i])), SR, T);
const uiInputs = (set) => { const byRole = {}, full = {}; for (const k of Object.keys(set)) { full[k] = Float32Array.from(set[k][0], (v, i) => 0.5 * (v + set[k][1][i])); byRole[k] = eng.resampleTo(full[k], SR, T); } return { byRole, fullRate: full.drums ? { drums: full.drums, sampleRate: SR } : undefined }; };
// Charts are scored PER SONG: the songs have different tempi, and one beat grid over the
// concatenation would measure the beat tracker, not the separation.
const slice = (set, a, b) => Object.fromEntries(Object.entries(set).map(([k, lr]) => [k, lr.map((c) => c.subarray(a, b))]));
const drumF = (gHits, est2) => Object.fromEntries(["kick", "snare", "hat"].map((type) => {
  const g = gHits.filter((h) => h.type === type), e = est2.filter((h) => h.type === type), used = new Set(); let tp = 0;
  for (const h of g) { const j = e.findIndex((x, k) => !used.has(k) && Math.abs(x.t - h.t) < 0.05); if (j >= 0) { used.add(j); tp++; } }
  const P = e.length ? tp / e.length : 0, R = g.length ? tp / g.length : 0; return [type, 2 * P * R / (P + R || 1)];
}));
const silent = () => [new Float32Array(N), new Float32Array(N)];
const configs = { separated: est, perfectStems: { ...ref, vocals: silent() } };
const perSong = segs.map((g) => {
  const a = g.off, b = g.off + g.len, sec = g.len / SR;
  const sgt = g.gt, shits = g.hits.filter((h) => h.t < sec - 0.1);
  const sc = (ev) => L.score(sgt, ev, eng.QUALITIES, sgt[sgt.length - 1].t1);
  const out = { song: g.file, bpm: g.bpm };
  for (const [name, set] of Object.entries(configs)) {
    const { byRole, fullRate } = uiInputs(slice(set, a, b));
    const r = eng.chartsFromStems(byRole, T, { useSharp: true, fullRate, ...JSON.parse(arg("chart-opts", "{}")) });
    const band = r.charts.find((c) => c.role === "band"), dr = r.charts.find((c) => c.kind === "drums"), bs = r.charts.find((c) => c.role === "bass");
    out[name] = { roles: r.charts.map((c) => `${c.role}:${c.kind}`), bpm: r.bpm && +r.bpm.toFixed(1), band: band ? sc(band.events) : null, drums: dr ? drumF(shits, dr.hits) : null, bassNotes: bs && bs.notes ? bs.notes.length : 0 };
  }
  out.mixOnly = { band: sc(eng.analyzeAudioChords(toMono16(slice({ m: mixLR }, a, b).m), T).events) };
  return out;
});
const avg = (name, field) => { const rows = perSong.map((p) => p[name] && p[name][field]).filter(Boolean); if (!rows.length) return null; return Object.fromEntries(Object.keys(rows[0]).map((k) => [k, +(100 * rows.reduce((s2, r) => s2 + r[k], 0) / rows.length).toFixed(1)])); };
const chartSummary = Object.fromEntries(["separated", "perfectStems", "mixOnly"].map((n) => [n, { band: avg(n, "band"), drums: avg(n, "drums") }]));
const result = {
  ok: true, songs: segs.map((s) => `${s.file} @${s.bpm}`), audioSec: +durSec.toFixed(1),
  device: meta.device, compact: !!meta.compact, separatorMs: Math.round(meta.ms), wallMs,
  secPerAudioMin: +((meta.ms / 1000) / (durSec / 60)).toFixed(1),
  realtimeFactor: +((meta.ms / 1000) / durSec).toFixed(2),
  memory: { baselineMB: Math.round(memBase / 2 ** 20), peakTotalMB: Math.round(memPeak / 2 ** 20), peakIncreaseMB: Math.round((memPeak - memBase) / 2 ** 20), peakSingleProcessMB: Math.round(memPeakProc / 2 ** 20) },
  sdr: SDR,
  charts: chartSummary,
  chartsPerSong: perSong.map((p) => ({ song: p.song, bpm: p.bpm, separatedBpm: p.separated.bpm, perfectBpm: p.perfectStems.bpm, roles: p.separated.roles, bassNotes: [p.separated.bassNotes, p.perfectStems.bassNotes], majmin: [p.separated.band, p.perfectStems.band, p.mixOnly.band].map((x) => x && +(100 * x.majmin).toFixed(1)) })),
  uiProgress: uiProg && uiProg.filter((_, i) => i % 10 === 0).map(([t, s2]) => `${(t / 1000).toFixed(0)}s ${s2.replace(/^[^…]*…\s*/, "")}`),
  uiTabs: (uiText.match(/STEMS → PER-INSTRUMENT CHARTS[\s\S]{0,1200}/) || [""])[0].split("\n").slice(0, 30),
  network: [...new Set(net.map((n) => new URL(n.url).host + new URL(n.url).pathname.replace(/[^/]+$/, "") ))],
};
fs.writeFileSync(path.join(OUT, "result.json"), JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
