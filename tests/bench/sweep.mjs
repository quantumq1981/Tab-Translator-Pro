/* Ablation / tuning sweep on the DEV split (even corpus indices). Front-end frames and
 * beats are computed once per (song, condition, front-end config); decoder configs then
 * sweep on top.   node bench/sweep.mjs <sweep-name> [--conds ...] [--split dev|test|all] */
import fs from "node:fs"; import path from "node:path"; import * as L from "./lib.mjs";
const eng = await L.loadEngine();
const argv = process.argv.slice(2);
const name = argv[0];
const opt = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const conds = opt("conds", "clean,noise,room,detune,bleed").split(",");
const split = opt("split", "dev");
const cache = path.join(L.here, ".cache");
const items = [];
for (const cond of conds) for (let i = 0; i < L.CORPUS.length; i++) {
  if (split === "dev" && i % 2) continue; if (split === "test" && !(i % 2)) continue;
  const key = `${i}-${cond}`.replace(/\W/g, "_");
  if (!fs.existsSync(path.join(cache, key + ".json"))) continue;
  const meta = JSON.parse(fs.readFileSync(path.join(cache, key + ".json")));
  const b = fs.readFileSync(path.join(cache, key + ".f32"));
  const ds = L.boxDecimate(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4), meta.sr, 16000);
  items.push({ i, cond, meta, ds, total: meta.gt[meta.gt.length - 1].t1, beats: eng.detectBeats(ds.audio, ds.sr).beats });
}
const fcache = new Map();
const frontKey = (fe) => JSON.stringify(fe);
function run(fe, dec) {
  const res = [];
  for (const it of items) {
    const k = it.i + it.cond + frontKey(fe);
    let fr = fcache.get(k);
    if (!fr) { fr = eng.nnlsChromagram(it.ds.audio, it.ds.sr, fe); fcache.set(k, fr); }
    const r = eng.transcribeChordsV2(it.ds.audio, it.ds.sr, { ...fe, ...dec, beats: it.beats, _frames: fr });
    res.push(L.score(it.meta.gt, r.events, eng.QUALITIES, it.total));
  }
  const m = {}; for (const k of ["root", "majmin", "sevenths", "pcs", "bass", "seg"]) m[k] = res.reduce((a, s) => a + s[k], 0) / res.length;
  return m;
}
const show = (label, m) => console.log(label.padEnd(44), ["root", "majmin", "sevenths", "pcs", "bass", "seg"].map((k) => (100 * m[k]).toFixed(1).padStart(6)).join(""));
const SW = {
  frontend: () => {
    for (const fe of [{}, { nnls: false }, { hpss: false }, { whitenBins: 0 }, { estimateTuning: false }, { spectralShape: 0.6 }, { spectralShape: 0.8 }, { winSec: 0.25 }, { partials: 8 }, { hpssFreqBins: 9 }, { hpssFreqBins: 25 }, { hpssTimeSec: 1.2 }, { whitening: 0.5 }])
      show("fe " + JSON.stringify(fe), run(fe, {}));
  },
  decoder: () => {
    for (const dec of [{}, { repetition: false }, { inversions: false }, { maxRank: 14 }, { bassWeight: 0.15 }, { bassWeight: 0.5 }, { changePenalty: 0.06 }, { changePenalty: 0.2 }, { ncScore: 0.45 }, { ncScore: 0.65 }, { rankBias: 0 }, { rankBias: 0.01 }, { inversionPenalty: 0.03 }, { inversionPenalty: 0.12 }, { gateDb: 35 }, { gateDb: 60 }, { subdivide: 2 }])
      show("dec " + JSON.stringify(dec), run({}, dec));
  },
  ablate: () => {
    const rows = [["full v2", {}, {}], ["treble = NNLS only", { treble: "nnls" }, {}], ["− NNLS (salience only)", { nnls: false }, {}], ["− HPSS", { hpss: false }, {}], ["− tuning compensation", { estimateTuning: false }, {}],
      ["− lowest-note bass (profile only)", { bassMode: "profile" }, {}], ["− sub-octave guard", { fundamentalRatio: 0 }, {}], ["− inversion states", {}, { inversions: false }],
      ["− foreign-bass slash states", {}, { slashChords: false }], ["− power-chord prior", {}, { powerPenalty: 0 }], ["− beat subdivision", {}, { subdivide: 1 }],
      ["− short-gap carry", {}, { minRestSec: 0 }], ["+ Stage D repetition (opt-in)", {}, { repetition: true }]];
    for (const [label, fe, dec] of rows) show(label, run(fe, dec));
  },
  custom: () => { const fe = JSON.parse(opt("fe", "{}")); for (const d of JSON.parse(opt("decs", "[{}]"))) show(JSON.stringify(fe) + " " + JSON.stringify(d), run(fe, d)); },
};
SW[name]();
