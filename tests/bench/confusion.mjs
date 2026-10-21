import fs from "node:fs"; import path from "node:path"; import * as L from "./lib.mjs";
const eng = await L.loadEngine();
const cache = path.join(L.here, ".cache"); const conds = (process.argv[2] || "clean").split(",");
const conf = new Map(); let tot = 0;
const qn = (lab) => lab ? (lab.suffix || "maj") : "N";
for (const cond of conds) for (let i = 0; i < L.CORPUS.length; i += 2) {
  const key = `${i}-${cond}`.replace(/\W/g, "_"); if (!fs.existsSync(path.join(cache, key + ".json"))) continue;
  const meta = JSON.parse(fs.readFileSync(path.join(cache, key + ".json"))); const b = fs.readFileSync(path.join(cache, key + ".f32"));
  const ds = L.boxDecimate(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4), meta.sr, 16000);
  const r = eng.transcribeChordsV2(ds.audio, ds.sr, {});
  const est = r.events.map((e) => ({ t0: e.startSec, t1: e.startSec + e.durSec, label: e.symbol }));
  const at = (segs, t) => { for (const s of segs) if (t >= s.t0 && t < s.t1) return s.label; return null; };
  for (let t = 0; t < meta.gt[meta.gt.length - 1].t1; t += 0.05) {
    const g = L.parseLabel(at(meta.gt, t), eng.QUALITIES), e = L.parseLabel(at(est, t), eng.QUALITIES); tot++;
    let k;
    if (!g) k = e ? "gtN→chord" : "ok"; else if (!e) k = "chord→N";
    else if (g.root === e.root && g.suffix === e.suffix) k = g.bass === e.bass ? "ok" : "inversion only";
    else if (g.root === e.root) k = `rootOK ${qn(g)}→${qn(e)}`;
    else { const d = (e.root - g.root + 12) % 12; k = `root+${d} ${qn(g)}→${qn(e)}${e.bass===g.bass?" (sameBass)":""}`; }
    conf.set(k, (conf.get(k) || 0) + 1);
  }
}
for (const [k, v] of [...conf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log((100 * v / tot).toFixed(2).padStart(6), k);
