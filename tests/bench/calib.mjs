/* Stage C calibration on the DEV split: is an event's `prob` a calibrated probability
 * that the label is right (root + majmin over the majority of its span)?  Reports ECE
 * per temperature and accuracy of events flagged ambiguous vs not. */
import fs from "node:fs"; import path from "node:path"; import * as L from "./lib.mjs";
const eng = await L.loadEngine(); const cache = path.join(L.here, ".cache");
const split = process.argv[2] || "dev", taus = (process.argv[3] || "0.03,0.05,0.08,0.12,0.2").split(",").map(Number);
const items = [];
for (const cond of ["clean", "bleed", "room", "noise", "detune"]) for (let i = 0; i < L.CORPUS.length; i++) {
  if ((split === "dev") === !!(i % 2)) continue;
  const key = `${i}_${cond}`; const meta = JSON.parse(fs.readFileSync(path.join(cache, key + ".json"))); const b = fs.readFileSync(path.join(cache, key + ".f32"));
  const ds = L.boxDecimate(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4), meta.sr, 16000);
  const beats = eng.detectBeats(ds.audio, ds.sr).beats; const fr = eng.nnlsChromagram(ds.audio, ds.sr, {});
  items.push({ meta, ds, beats, fr });
}
const at = (segs, t) => { for (const s of segs) if (t >= s.t0 && t < s.t1) return s.label; return null; };
for (const tau of taus) {
  const rows = [];
  for (const it of items) {
    const r = eng.transcribeChordsV2(it.ds.audio, it.ds.sr, { beats: it.beats, _frames: it.fr, temperature: tau });
    for (const e of r.events) {
      let ok = 0, n = 0;
      for (let t = e.startSec; t < e.startSec + e.durSec; t += 0.05) {
        const g = L.parseLabel(at(it.meta.gt, t), eng.QUALITIES), x = L.parseLabel(e.symbol, eng.QUALITIES); n++;
        if (g && x && g.root === x.root && (L.triadClass(g) || "o") === (L.triadClass(x) || "o")) ok++;
      }
      if (n) rows.push({ p: e.prob, c: e.confidence, ok: ok / n >= 0.5 ? 1 : 0, w: e.durSec, amb: e.ambiguous });
    }
  }
  const B = 10, bins = Array.from({ length: B }, () => ({ w: 0, p: 0, a: 0 }));
  let W = 0; for (const r of rows) { const k = Math.min(B - 1, Math.floor(r.p * B)); bins[k].w += r.w; bins[k].p += r.p * r.w; bins[k].a += r.ok * r.w; W += r.w; }
  const ece = bins.reduce((s, b) => s + (b.w ? (b.w / W) * Math.abs(b.p / b.w - b.a / b.w) : 0), 0);
  const nll = -rows.reduce((s, r) => s + r.w * Math.log(Math.max(1e-6, r.ok ? r.p : 1 - r.p)), 0) / W;
  const acc = (f) => { const s = rows.filter(f); const w = s.reduce((a, r) => a + r.w, 0); return [s.length, w ? (s.reduce((a, r) => a + r.ok * r.w, 0) / w * 100).toFixed(1) : "-"]; };
  console.log(`tau ${tau}: ECE ${(ece * 100).toFixed(1)}%  NLL ${nll.toFixed(3)}  events ${rows.length}  | p<0.3 ${acc((r) => r.p < 0.3)} | 0.3–0.5 ${acc((r) => r.p >= 0.3 && r.p < 0.5)} | 0.5–0.7 ${acc((r) => r.p >= 0.5 && r.p < 0.7)} | ≥0.7 ${acc((r) => r.p >= 0.7)}`);
  if (process.argv[4]) console.log(bins.map((b, k) => `${k / B}-${(k + 1) / B}: w${b.w.toFixed(0)} p${b.w ? (b.p / b.w).toFixed(2) : "-"} acc${b.w ? (b.a / b.w).toFixed(2) : "-"}`).join("\n"));
}
