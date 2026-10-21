/* Benchmark runner:  node bench/run.mjs [--variants a,b] [--conds clean,noise,...] [--songs N]
 * Renders the corpus once (cached in bench/.cache), then scores each pipeline variant
 * on each condition. Prints per-condition means + an overall mean. */
import fs from "node:fs"; import path from "node:path";
import * as L from "./lib.mjs";
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "1"] : null).filter(Boolean));
const eng = await L.loadEngine(args.engine ? path.resolve(args.engine) : undefined);
const cacheDir = path.join(L.here, ".cache"); fs.mkdirSync(cacheDir, { recursive: true });
const CONDS = (args.conds || "clean,noise,room,detune,bleed").split(",");
const SONGS = L.CORPUS.map((c, i) => [...c, i]).filter(([, , , i]) => args.split === "dev" ? i % 2 === 0 : args.split === "test" ? i % 2 === 1 : true);

async function getItem(file, part, inst, cond, idx) {
  const key = `${idx}-${cond}`.replace(/\W/g, "_");
  const fa = path.join(cacheDir, key + ".f32"), fj = path.join(cacheDir, key + ".json");
  if (fs.existsSync(fa) && fs.existsSync(fj)) {
    const meta = JSON.parse(fs.readFileSync(fj, "utf8"));
    const b = fs.readFileSync(fa); return { ...meta, audio: new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4) };
  }
  const bytes = new Uint8Array(fs.readFileSync(path.join(L.repo, file)));
  const sc = await eng.parseGuitarProOrXML(bytes, file, true, part);
  const R = L.rng(1000 + idx * 7 + CONDS.indexOf(cond));
  const r = L.renderPart(eng, sc, { sr: 44100, instrument: inst, seed: 17 + idx, cents: cond === "detune" ? 40 : 0, maxSec: +(args.sec || 60) });
  if (!r) return null;
  let a = r.audio;
  if (cond === "noise") a = L.addNoise(a, 20, R);
  if (cond === "room") a = L.addRoom(eng, a, r.sr, 1.4, 0.35, R);
  if (cond === "bleed") {
    let bass = null;
    if (L.BASS_PART[file] != null) {
      const bs = await eng.parseGuitarProOrXML(bytes, file, true, L.BASS_PART[file]);
      const br = L.renderPart(eng, bs, { sr: 44100, instrument: "guitar", seed: 99, fromSec: r.t0, maxSec: +(args.sec || 60) });
      if (br) bass = br.audio;
    }
    a = L.addBleed(a, r.sr, r.bpm, 0.6, R, bass);
  }
  let pk = 0; for (let i = 0; i < a.length; i++) pk = Math.max(pk, Math.abs(a[i]));
  const out = new Float32Array(a.length); for (let i = 0; i < a.length; i++) out[i] = (0.8 * a[i]) / (pk || 1);
  const meta = { gt: r.gt, sr: r.sr, bpm: r.bpm, file, part, inst, cond };
  fs.writeFileSync(fa, Buffer.from(out.buffer)); fs.writeFileSync(fj, JSON.stringify(meta));
  return { ...meta, audio: out };
}

/* Pipeline variants. `v1` = the Audio panel's decoder before SynHarmonics v2 (as it ran
 * then, incl. its knobs); `v2` = the shipped default. */
const VARIANTS = {
  v1: (x, sr) => eng.analyzeAudioChords(x, sr, { engine: "v1", hopSec: 0.12, smoothSec: 0.5, recoverGaps: true }),
  v1Simple: (x, sr) => eng.analyzeAudioChords(x, sr, { engine: "v1", hopSec: 0.12, smoothSec: 0.5, recoverGaps: true, maxRank: 14 }),
  sliding: (x, sr) => ({ events: eng.transcribeChords(x, sr, { hopSec: 0.12, smoothSec: 0.5, recoverGaps: true }) }),
};
if (eng.analyzeAudioChordsV2) {
  VARIANTS.v2 = (x, sr) => eng.analyzeAudioChordsV2(x, sr, {});
  VARIANTS.v2Simple = (x, sr) => eng.analyzeAudioChordsV2(x, sr, { maxRank: 14 });
  VARIANTS.v2nokey = (x, sr) => eng.analyzeAudioChordsV2(x, sr, { keyPrior: false });
  VARIANTS.v2rep = (x, sr) => eng.analyzeAudioChordsV2(x, sr, { repetition: true });
  }
const names = (args.variants || Object.keys(VARIANTS).join(",")).split(",");
const resample = args.resample === "sinc" && eng.resampleTo ? (a, sr) => { const o = sr / Math.max(1, Math.floor(sr / 16000)); return { audio: eng.resampleTo(a, sr, o), sr: o }; } : (a, sr) => L.boxDecimate(a, sr, 16000);

const metrics = ["root", "majmin", "sevenths", "pcs", "bass", "seg"];
const agg = {};
const perSong = [];
for (const cond of CONDS) {
  for (let i = 0; i < SONGS.length; i++) {
    const [file, part, inst, ci] = SONGS[i];
    const it = await getItem(file, part, inst, cond, ci);
    if (!it) continue;
    const ds = resample(it.audio, it.sr);
    const total = it.gt[it.gt.length - 1].t1;
    for (const v of names) {
      const t = Date.now();
      const r = VARIANTS[v](ds.audio, ds.sr);
      const ms = Date.now() - t;
      const s = L.score(it.gt, r.events || [], eng.QUALITIES, total);
      s.rtf = ms / 1000 / total;
      const k = `${v}|${cond}`;
      (agg[k] = agg[k] || []).push(s);
      perSong.push({ v, cond, song: `${ci}:${file.slice(0, 28)}:${part}`, ...s });
    }
  }
}
const mean = (arr, m) => arr.reduce((a, s) => a + s[m], 0) / arr.length;
const pct = (x) => (100 * x).toFixed(1).padStart(5);
console.log("variant    cond     " + metrics.map((m) => m.padStart(8)).join("") + "     rtf");
for (const v of names) {
  const all = [];
  for (const cond of CONDS) { const a = agg[`${v}|${cond}`] || []; all.push(...a); if (a.length) console.log(v.padEnd(10), cond.padEnd(8), metrics.map((m) => pct(mean(a, m)).padStart(8)).join(""), mean(a, "rtf").toFixed(3).padStart(7)); }
  console.log(v.padEnd(10), "ALL".padEnd(8), metrics.map((m) => pct(mean(all, m)).padStart(8)).join(""), mean(all, "rtf").toFixed(3).padStart(7));
}
if (args.out) fs.writeFileSync(args.out, JSON.stringify({ agg, perSong }, null, 1));
