/* Where does a vocabulary lose/gain vs full?  node bench/vocabdiff.mjs '<optsJSON>' [cond] [split]
 * Per 50 ms frame on the cached corpus: frames where full has the right ROOT and the variant
 * doesn't (and vice versa), tallied by "truth → variant decode" quality pair. */
import fs from "node:fs"; import path from "node:path"; import * as L from "./lib.mjs";
const eng = await L.loadEngine();
const opts = JSON.parse(process.argv[2] || '{"vocabulary":"chart"}'), cond = process.argv[3] || "clean", split = process.argv[4] || "dev";
const cache = path.join(L.here, ".cache");
const resample = (a, sr) => { const o = sr / Math.max(1, Math.floor(sr / 16000)); return { audio: eng.resampleTo(a, sr, o), sr: o }; };
const at = (segs, t) => { for (const s of segs) if (t >= s.t0 && t < s.t1) return s.label; return null; };
const lose = new Map(), gain = new Map(); let tot = 0;
const nm = (l) => l ? l.suffix || "maj" : "N";
for (let i = split === "dev" ? 0 : 1; i < L.CORPUS.length; i += 2) {
  const key = `${i}-${cond}`.replace(/\W/g, "_"); if (!fs.existsSync(path.join(cache, key + ".json"))) continue;
  const meta = JSON.parse(fs.readFileSync(path.join(cache, key + ".json"))); const b = fs.readFileSync(path.join(cache, key + ".f32"));
  const ds = resample(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4), meta.sr);
  const seg = (r) => r.events.map((e) => ({ t0: e.startSec, t1: e.startSec + e.durSec, label: e.symbol }));
  const F = seg(eng.analyzeAudioChordsV2(ds.audio, ds.sr, {})), V = seg(eng.analyzeAudioChordsV2(ds.audio, ds.sr, opts));
  for (let t = 0; t < meta.gt[meta.gt.length - 1].t1; t += 0.05) {
    const g = L.parseLabel(at(meta.gt, t), eng.QUALITIES); if (!g) continue; tot++;
    const f = L.parseLabel(at(F, t), eng.QUALITIES), v = L.parseLabel(at(V, t), eng.QUALITIES);
    const fo = f && f.root === g.root, vo = v && v.root === g.root;
    const k = `${at(meta.gt, t)}  full:${at(F, t)}  var:${at(V, t)}`;
    if (fo && !vo) lose.set(k, (lose.get(k) || 0) + 1);
    if (!fo && vo) gain.set(k, (gain.get(k) || 0) + 1);
  }
}
const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22).map(([k, v]) => `${(100 * v / tot).toFixed(2).padStart(5)}  ${k}`).join("\n");
const sum = (m) => [...m.values()].reduce((a, b) => a + b, 0);
console.log(`root lost ${(100 * sum(lose) / tot).toFixed(1)}%  gained ${(100 * sum(gain) / tot).toFixed(1)}%\n-- LOST\n${top(lose)}\n-- GAINED\n${top(gain)}`);
