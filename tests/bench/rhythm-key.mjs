/* Harmonic rhythm + key lock benchmark (2026-11-04).
 *   node bench/rhythm-key.mjs [--split dev|test] [--conds clean,noise,...] [--variants name,…]
 * Reads the renders `run.mjs` caches in bench/.cache (run that first). Scores each variant
 * MIREX-style against the vocabulary truth (as `run.mjs --gtvocab chart`) and adds:
 *   chg/min  chord changes per minute (decoded) vs the truth's own rate,
 *   short    share of decoded chords shorter than one beat,
 *   outkey   share of decoded TIME on chords with a tone outside the song's key.
 * "Oracle key" = analyzeKey over the notated ground-truth chords, i.e. the key a player
 * who knows the song would type in. Songs are tagged jazz (Parker / Coltrane / Robben Ford
 * jazz-blues) or pop, because a key lock is expected to help one and cost the other. */
import fs from "node:fs"; import path from "node:path";
import * as L from "./lib.mjs";
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "1"] : null).filter(Boolean));
const eng = await L.loadEngine();
const cacheDir = path.join(L.here, ".cache");
const CONDS = (args.conds || "clean,noise,room,detune,bleed").split(",");
const SONGS = L.CORPUS.map((c, i) => [...c, i]).filter(([, , , i]) => args.split === "dev" ? i % 2 === 0 : args.split === "test" ? i % 2 === 1 : true);
const JAZZ = /Parker|Coltrane|Robben Ford|cheryl|Anthropology/i;
const vocab = args.vocab || "chart";

const VARIANTS = {
  base: {},
  old: { adaptive: false },
  min1: { minChordBeats: 1 },
  min2: { minChordBeats: 2 },
  min4: { minChordBeats: 4 },
  keyGuide: { key: "ORACLE" },
  keyStrict: { key: "ORACLE", keyLock: "strict" },
  min2keyGuide: { minChordBeats: 2, key: "ORACLE" },
  min2keyStrict: { minChordBeats: 2, key: "ORACLE", keyLock: "strict" },
};
if (args.opts) VARIANTS.x = JSON.parse(args.opts);
const names = (args.variants || Object.keys(VARIANTS).join(",")).split(",");

function load(idx, cond) {
  const key = `${idx}-${cond}`.replace(/\W/g, "_");
  const fa = path.join(cacheDir, key + ".f32"), fj = path.join(cacheDir, key + ".json");
  if (!fs.existsSync(fa)) return null;
  const meta = JSON.parse(fs.readFileSync(fj, "utf8"));
  const b = fs.readFileSync(fa);
  return { ...meta, audio: new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4) };
}
function oracleKey(gt, bpm) {
  const spb = 60 / (bpm || 120);
  const bars = gt.filter((g) => g.label).map((g, i) => ({ number: i + 1, events: [{ symbol: g.label, durBeats: Math.max(1, Math.round((g.t1 - g.t0) / spb)) }] }));
  return eng.analyzeKey({ bars, timeSig: [4, 4] });
}
function outKeyShare(events, key, total) {
  if (!key) return 0;
  const sc = new Set((key.mode === "minor" ? [0, 2, 3, 5, 7, 8, 10, 11] : [0, 2, 4, 5, 7, 9, 11]).map((r) => (r + key.tonic) % 12));
  let out = 0;
  for (const e of events) {
    const l = L.parseLabel(e.symbol, eng.QUALITIES);
    if (l && [...l.pcs, l.bass].some((p) => !sc.has(p))) out += e.durSec;
  }
  return out / total;
}

const agg = {};
const add = (k, s) => (agg[k] = agg[k] || []).push(s);
for (const cond of CONDS) for (const [file, part, inst, ci] of SONGS) {
  const it = load(ci, cond);
  if (!it) continue;
  const o = it.sr / Math.max(1, Math.floor(it.sr / 16000));
  const x = eng.resampleTo(it.audio, it.sr, o);
  const total = it.gt[it.gt.length - 1].t1;
  const gt = it.gt.map((g) => ({ ...g, label: L.relabelForVocabulary(eng, g.label, vocab) }));
  const okey = oracleKey(it.gt, it.bpm);
  let gtChg = 0; for (let i = 1; i < gt.length; i++) if (gt[i].label !== gt[i - 1].label) gtChg++;
  const fr = eng.nnlsChromagram(x, o, {});                       // shared front end
  const bt = eng.detectBeats(x, o, {});
  // "diatonic" = less than 20 % of the TRUE chart's time outside the oracle key (the songs a key lock is for)
  const truthOut = outKeyShare(it.gt.filter((g) => g.label).map((g) => ({ symbol: g.label, durSec: g.t1 - g.t0 })), okey, total);
  const tag = truthOut < 0.2 ? "diaton" : JAZZ.test(file) ? "jazz" : "pop";
  for (const v of names) {
    const opts = { vocabulary: vocab, ...VARIANTS[v], _frames: fr, beats: bt.beats, bpm: bt.bpm };
    if (opts.key === "ORACLE") opts.key = okey ? { tonic: okey.tonic, mode: okey.mode } : null;
    const t = Date.now();
    const r = eng.analyzeAudioChordsV2(x, o, opts);
    const ms = Date.now() - t;
    const ev = r.events || [];
    const s = L.score(gt, ev, eng.QUALITIES, total);
    const spb = 60 / (it.bpm || 120);
    s.chg = (ev.length / total) * 60; s.gtChg = (gtChg / total) * 60;
    s.short = ev.length ? ev.filter((e) => e.durSec < 0.9 * spb).length / ev.length : 0;
    s.outkey = outKeyShare(ev, okey, total);
    s.ms = ms;
    add(`${v}|ALL`, s); add(`${v}|${tag}`, s); add(`${v}|${cond}`, s);
  }
}
const mean = (a, m) => a.reduce((x, s) => x + s[m], 0) / a.length;
const M = ["root", "majmin", "sevenths", "pcs", "bass", "seg"];
console.log(`vocab=${vocab} split=${args.split || "all"} conds=${CONDS.join(",")}`);
console.log("variant          group   n " + M.map((m) => m.padStart(8)).join("") + "  chg/min (truth)  short  outkey     ms");
for (const v of names) for (const g of ["ALL", "diaton", "pop", "jazz", ...(args.byCond ? CONDS : [])]) {
  const a = agg[`${v}|${g}`]; if (!a || !a.length) continue;
  console.log(v.padEnd(16), g.padEnd(6), String(a.length).padStart(3), M.map((m) => (100 * mean(a, m)).toFixed(1).padStart(8)).join(""),
    `${mean(a, "chg").toFixed(1).padStart(8)} (${mean(a, "gtChg").toFixed(1).padStart(5)})`, (100 * mean(a, "short")).toFixed(1).padStart(6), (100 * mean(a, "outkey")).toFixed(1).padStart(7), mean(a, "ms").toFixed(0).padStart(6));
}
