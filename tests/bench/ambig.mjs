/* Where is the right answer for UNCERTAIN chords?  rank of the GT label among
 * [chosen, alt1, alt2, alt3] (majority-of-span GT, root+triad-class match). */
import fs from "node:fs"; import path from "node:path"; import * as L from "./lib.mjs";
const eng = await L.loadEngine(); const cache = path.join(L.here, ".cache");
const split = process.argv[2] || "dev"; const hist = { amb: [0, 0, 0, 0, 0], sure: [0, 0, 0, 0, 0] };
const at = (segs, t) => { for (const s of segs) if (t >= s.t0 && t < s.t1) return s.label; return null; };
const same = (a, b) => a && b && a.root === b.root && (L.triadClass(a) || a.suffix) === (L.triadClass(b) || b.suffix);
for (const cond of ["clean", "noise", "room", "detune", "bleed"]) for (let i = 0; i < L.CORPUS.length; i++) {
  if ((split === "dev") === !!(i % 2)) continue;
  const meta = JSON.parse(fs.readFileSync(path.join(cache, `${i}_${cond}.json`))); const b = fs.readFileSync(path.join(cache, `${i}_${cond}.f32`));
  const ds = L.boxDecimate(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4), meta.sr);
  for (const e of eng.analyzeAudioChords(ds.audio, ds.sr).events) {
    const votes = new Map(); for (let t = e.startSec; t < e.startSec + e.durSec; t += 0.05) { const g = at(meta.gt, t); if (g) votes.set(g, (votes.get(g) || 0) + 1); }
    const gt = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]; if (!gt) continue;
    const G = L.parseLabel(gt[0], eng.QUALITIES); const cands = [e.symbol, ...e.alternatives.map((a) => a.symbol)];
    let r = cands.findIndex((c) => same(L.parseLabel(c, eng.QUALITIES), G)); if (r < 0) r = 4;
    hist[e.ambiguous ? "amb" : "sure"][r] += e.durSec;
  }
}
for (const k of ["amb", "sure"]) { const h = hist[k], T = h.reduce((a, b) => a + b, 0); console.log(k.padEnd(5), "top1", (100 * h[0] / T).toFixed(1), "alt1", (100 * h[1] / T).toFixed(1), "alt2", (100 * h[2] / T).toFixed(1), "alt3", (100 * h[3] / T).toFixed(1), "none", (100 * h[4] / T).toFixed(1), "| share of time", (100 * T / (hist.amb.reduce((a, b) => a + b, 0) + hist.sure.reduce((a, b) => a + b, 0))).toFixed(1) + "%"); }
