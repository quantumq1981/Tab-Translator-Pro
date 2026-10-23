/* fingering.mjs — Stage 3 (string/fret assignment) on the repo's own Guitar Pro files.
 *
 *  Dev-only, Node. Nothing here ships. Every GP track in the repo carries the fingering a
 *  transcriber WROTE (string + fret per note), so it is audio-free ground truth for the
 *  "which string is this pitch on" problem. We strip the fingering, keep the pitches, run the
 *  engine's `fingerSequence`, and count how many notes land on the written string.
 *
 *  Scope: standard-tuned 6-string tracks, no capo, events whose every pitch carries a fret.
 *  Split: even file index = dev (tune here), odd = test (report only) — same rule as run.mjs.
 *
 *    node bench/fingering.mjs                         # engine defaults, both splits
 *    node bench/fingering.mjs --split test
 *    node bench/fingering.mjs --opts '{"move":0.8}'   # override weights
 *    node bench/fingering.mjs --sweep                 # coordinate search on DEV only
 *    node bench/fingering.mjs --learn-prior           # print a dev-trained prior table
 *    … --no-prior   disable the engine's embedded FINGER_PRIOR (pure cost model)
 *    … --gs <dir>   also load GuitarSet (scripts/guitarset_extract.py output): players 0–2 = dev, 3–5 = test.
 *                   The sweep then maximises the MEAN of the two dev scores.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEngine } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const eng = await loadEngine();
const STD = eng.TUNINGS.Standard;

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const splitArg = arg("--split", "all");
const baseOpts = JSON.parse(arg("--opts", "{}"));

/** Load every qualifying track once: [{ split, file, part, events:[{midis,gap}], truth:[[{string,fret,midi}]] }] */
async function loadCorpus() {
  const files = fs.readdirSync(repo).filter((f) => /\.(gp|gp3|gp4|gp5|gpx)$/i.test(f)).sort();
  const tracks = [];
  for (const [fi, file] of files.entries()) {
    const split = fi % 2 === 0 ? "dev" : "test";
    const bytes = new Uint8Array(fs.readFileSync(path.join(repo, file)));
    let first;
    try { first = await eng.parseGuitarProOrXML(bytes, file, true, 0); } catch { continue; }
    for (const { index } of first.parts || [{ index: 0 }]) {
      let score;
      try { score = await eng.parseGuitarProOrXML(bytes, file, true, index); } catch { continue; }
      if ((score.tuning && score.tuning !== "Standard") || score.capo) continue;
      const events = [], truth = [];
      let lastEnd = null;
      score.bars.forEach((b, bi) => b.events.forEach((e) => {
        const bpb = (b.timeSig || score.timeSig || [4, 4])[0];
        const on = bi * bpb + (e.qbeat ?? e.beat ?? 0), dur = e.qdur ?? e.durBeats ?? 1;
        const ok = e.frets && Object.keys(e.frets).length && Object.keys(e.frets).length === e.midis.length;
        if (ok) {
          events.push({ midis: e.midis, gap: lastEnd == null ? 0 : Math.max(0, on - lastEnd) });
          truth.push(Object.entries(e.frets).map(([s, fret]) => ({ string: +s, fret, midi: STD[+s] + fret })));
        }
        lastEnd = on + dur;
      }));
      if (events.length >= 20) tracks.push({ split, file, part: index, events, truth });
    }
  }
  return tracks;
}

/** GuitarSet annotations as tracks (same shape as the GP loader). Notes starting within
 *  35 ms form one chord event; a duplicate pitch in a strum starts a new event. */
function loadGuitarSet(dir) {
  const tracks = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const notes = d.notes.map((n) => ({ onset: n.onset_s, offset: Math.max(n.offset_s, n.onset_s + 0.01), midi: Math.round(n.midi), string: n.string }))
      .sort((a, b) => a.onset - b.onset || a.midi - b.midi);
    const groups = [];
    for (const n of notes) {
      const g = groups[groups.length - 1];
      if (g && n.onset - g.onset <= 0.035 && g.notes.length < 6 && !g.notes.some((x) => x.midi === n.midi || x.string === n.string)) g.notes.push(n);
      else groups.push({ onset: n.onset, notes: [n] });
    }
    const spb = 60 / (d.tempo_bpm || 120);
    let lastEnd = null;
    const events = [], truth = [];
    for (const g of groups) {
      events.push({ midis: g.notes.map((n) => n.midi), gap: lastEnd == null ? 0 : Math.max(0, (g.onset - lastEnd) / spb) });
      truth.push(g.notes.map((n) => ({ string: n.string, fret: n.midi - STD[n.string], midi: n.midi })));
      lastEnd = Math.max(...g.notes.map((n) => n.offset));
    }
    tracks.push({ corpus: "gs", split: d.player < 3 ? "dev" : "test", file: d.track_id, style: d.style, events, truth });
  }
  return tracks;
}

/** % of notes on the written string, per split. */
function score(tracks, opts, which = ["dev", "test"], corpus = "gp") {
  const t = { dev: [0, 0], test: [0, 0], lowest: { dev: [0, 0], test: [0, 0] } };
  for (const tr of tracks) {
    if (!which.includes(tr.split) || (tr.corpus || "gp") !== corpus) continue;
    const { shapes } = eng.fingerSequence(tr.events, STD, opts);
    tr.truth.forEach((notes, i) => {
      const used = new Set();
      for (const n of notes) {
        t[tr.split][1]++; t.lowest[tr.split][1]++;
        const c = eng.fingerCandidates(n.midi, STD);
        let lo = 0; for (let k = 2; k < c.length; k += 2) if (c[k + 1] < c[lo + 1]) lo = k;
        if (c[lo] === n.string) t.lowest[tr.split][0]++;
        const sh = shapes[i] || [];
        const j = sh.findIndex((x, xi) => !used.has(xi) && x.midi === n.midi);
        if (j >= 0) { used.add(j); if (sh[j].string === n.string) t[tr.split][0]++; }
      }
    });
  }
  const pct = ([a, b]) => (b ? (100 * a) / b : NaN);
  return { dev: pct(t.dev), test: pct(t.test), lowestDev: pct(t.lowest.dev), lowestTest: pct(t.lowest.test), notes: { dev: t.dev[1], test: t.test[1] } };
}

/** −log p tables for fret height and hand movement, trained on the DEV split's written tab. */
function learnPrior(tracks) {
  const fret = new Float64Array(23).fill(1), move = new Float64Array(13).fill(1);
  const cell = Array.from({ length: 6 }, () => new Float64Array(23).fill(1));
  const from = arg("--prior-from", "both");       // gp | gs | both — which DEV halves train the prior
  for (const tr of tracks) {
    if (tr.split !== "dev") continue;
    if (from !== "both" && (tr.corpus || "gp") !== from) continue;
    let prev = null;
    for (const notes of tr.truth) {
      for (const n of notes) { fret[Math.min(n.fret, 22)]++; cell[n.string][Math.min(n.fret, 22)]++; }
      const pos = notes.reduce((lo, n) => (n.fret > 0 && n.fret < lo ? n.fret : lo), Infinity);
      if (pos !== Infinity) { if (prev != null) move[Math.min(Math.abs(pos - prev), 12)]++; prev = pos; }
    }
  }
  const nlog = (h) => { const s = h.reduce((a, b) => a + b, 0), out = [...h].map((x) => -Math.log(x / s)); const m = Math.min(...out); return out.map((x) => +(x - m).toFixed(3)); };
  const parts = (arg("--prior-parts", "fret,move,cell")).split(",");
  const out = {};
  if (parts.includes("fret")) out.fret = nlog(fret);
  if (parts.includes("move")) out.move = nlog(move);
  if (parts.includes("cell")) out.cell = cell.map(nlog);
  return out;
}

const tracks = await loadCorpus();
if (arg("--gs", null)) tracks.push(...loadGuitarSet(arg("--gs")));
const withGs = tracks.some((t) => t.corpus === "gs");
const fmt = (x) => (Number.isFinite(x) ? x.toFixed(1) + "%" : "—");
// The sweep objective: GP dev, or the mean of GP dev and GuitarSet dev when both are loaded.
const objective = (o) => withGs ? (score(tracks, o, ["dev"]).dev + score(tracks, o, ["dev"], "gs").dev) / 2 : score(tracks, o, ["dev"]).dev;
const report = (o) => {
  const r = score(tracks, o);
  let line = `GP dev ${fmt(r.dev)}  test ${fmt(r.test)}`;
  if (withGs) { const g = score(tracks, o, ["dev", "test"], "gs"); line += `   ·   GuitarSet dev ${fmt(g.dev)}  test ${fmt(g.test)}`; }
  return line;
};

if (has("--learn-prior")) {
  console.log(JSON.stringify(learnPrior(tracks)));
} else if (has("--sweep")) {
  // Coordinate search on DEV only; the test split is printed once at the end, never used to choose.
  let best = { ...eng.FINGER_DEFAULTS, ...baseOpts };
  if (has("--with-prior")) best.prior = learnPrior(tracks);
  if (has("--no-prior")) best.prior = null;
  let bestDev = objective(best);
  console.log(`start dev ${fmt(bestDev)}`);
  const grid = {
    span: [0, 0.15, 0.3, 0.5, 0.8], fretSum: [0, 0.02, 0.04, 0.08, 0.12], open: [0, 0.1, 0.2, 0.4, 0.7],
    move: [0.2, 0.35, 0.5, 0.8, 1.2], cross: [0, 0.05, 0.1, 0.2, 0.4], restBeats: [1, 2, 4, 99], maxSpan: [3, 4, 5],
    window: [0, 3, 4, 5], beam: [24, 48, 96], ...(has("--with-prior") ? { priorWeight: [0, 0.5, 1, 1.5, 2, 3] } : {}),
  };
  for (let round = 0; round < 2; round++) {
    for (const [k, vals] of Object.entries(grid)) {
      for (const v of vals) {
        if (v === best[k]) continue;
        const cand = { ...best, [k]: v }, d = objective(cand);
        if (d > bestDev + 0.05) { bestDev = d; best = cand; console.log(`  ${k}=${v} → dev ${fmt(d)}`); }
      }
    }
  }
  const { prior, ...shown } = best;
  console.log("best", JSON.stringify(shown), prior ? "(+ dev prior)" : "");
  console.log(report(best));
} else {
  const opts = { ...baseOpts };
  if (has("--with-prior")) opts.prior = learnPrior(tracks);
  if (has("--no-prior")) opts.prior = null;
  const which = splitArg === "all" ? ["dev", "test"] : [splitArg];
  const t0 = Date.now(), r = score(tracks, opts, which);
  const n = (s) => tracks.filter((t) => t.split === s).length;
  for (const s of which) {
    console.log(`${s.padEnd(4)}  tracks ${String(n(s)).padStart(3)}  notes ${String(r.notes[s]).padStart(6)}  ` +
      `lowest-fret ${fmt(s === "dev" ? r.lowestDev : r.lowestTest).padStart(6)}  fingerSequence ${fmt(r[s]).padStart(6)}`);
  }
  if (withGs) console.log(report(opts));
  console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
