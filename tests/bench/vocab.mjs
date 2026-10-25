/* What vocabulary does the audio decoder actually emit?  node bench/vocab.mjs [conds] [--opts JSON] [--real]
 * Time-weighted quality histogram of the decode vs the ground truth (corpus), plus the share
 * of decoded time that is a chord-tone inversion or a triad over a FOREIGN bass. --real also
 * decodes the repo's real audio files (ffmpeg → 16 kHz mono) — no ground truth there. */
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import * as L from "./lib.mjs";
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf("--" + n); return i < 0 ? null : (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "1"); };
const eng = await L.loadEngine();
const opts = flag("opts") ? JSON.parse(flag("opts")) : {};
const conds = (argv[0] && !argv[0].startsWith("--") ? argv[0] : "clean").split(",");
const cache = path.join(L.here, ".cache");
const qOf = (sym) => { const l = L.parseLabel(sym, eng.QUALITIES); return l ? { q: l.suffix || "maj", slash: l.bass !== l.root, foreign: l.bass !== l.root && !l.pcs.has(l.bass) } : null; };
function tally(h, segs) { for (const s of segs) { const d = s.t1 - s.t0, x = qOf(s.label); if (!x) { h.N = (h.N || 0) + d; continue; } h[x.q] = (h[x.q] || 0) + d; if (x.slash) h["(slash)"] = (h["(slash)"] || 0) + d; if (x.foreign) h["(foreign)"] = (h["(foreign)"] || 0) + d; h._tot = (h._tot || 0) + d; } }
const show = (name, h) => { const tot = h._tot || 1; console.log(name.padEnd(10), Object.entries(h).filter(([k]) => k !== "_tot" && k !== "N").sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / tot).toFixed(1)}`).join(" · ")); };
const resample = (a, sr) => { const o = sr / Math.max(1, Math.floor(sr / 16000)); return { audio: eng.resampleTo(a, sr, o), sr: o }; };
for (const cond of conds) {
  const G = {}, D = {};
  for (let i = 0; i < L.CORPUS.length; i++) {
    const key = `${i}-${cond}`.replace(/\W/g, "_"); if (!fs.existsSync(path.join(cache, key + ".json"))) continue;
    const meta = JSON.parse(fs.readFileSync(path.join(cache, key + ".json"))); const b = fs.readFileSync(path.join(cache, key + ".f32"));
    const ds = resample(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4), meta.sr);
    const r = eng.analyzeAudioChordsV2(ds.audio, ds.sr, opts);
    tally(G, meta.gt); tally(D, r.events.map((e) => ({ t0: e.startSec, t1: e.startSec + e.durSec, label: e.symbol })));
  }
  console.log(`--- corpus ${cond}`); show("truth", G); show("decode", D);
}
if (flag("real")) {
  const files = fs.readdirSync(L.repo).filter((f) => /\.(mp3|m4a|wav)$/i.test(f));
  for (const f of files) {
    const raw = execFileSync("ffmpeg", ["-v", "quiet", "-i", path.join(L.repo, f), "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
    const a = new Float32Array(raw.buffer, raw.byteOffset, raw.length / 4);
    const r = eng.analyzeAudioChordsV2(a, 16000, opts), h = {};
    tally(h, r.events.map((e) => ({ t0: e.startSec, t1: e.startSec + e.durSec, label: e.symbol })));
    show(f.slice(0, 10), h); console.log("           e.g.", r.events.slice(0, 18).map((e) => e.symbol).join(" "));
  }
}
