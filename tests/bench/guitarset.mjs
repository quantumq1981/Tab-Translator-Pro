/* guitarset.mjs — the audio→TAB pipeline scored on GuitarSet (real recorded guitar).
 *
 *  Dev-only, Node. Nothing here ships. GuitarSet (Xi et al. 2018, CC-BY 4.0) records every
 *  note with its STRING (hexaphonic pickup), so it scores both halves of the pipeline:
 *    • Stage 3 alone: the annotated MIDI goes in, `fingerSequence` picks strings, and we count
 *      notes on the annotated string ("oracle-MIDI Tab accuracy").
 *    • End to end: a transcription model's notes go in (written by scripts/guitarset_infer.py — see
 *      docs/AUDIO-TO-TAB-PLAN.md), are fingered, and are matched to the annotation:
 *      a note counts when onset ±50 ms, pitch and STRING all agree (Tab P/R/F1, the TART
 *      metric). Note F1 (string ignored) is reported alongside.
 *  The shipped FINGER_PRIOR was learned from the DEV halves of both corpora (GP even files +
 *  GuitarSet players 0–2), so only players 3–5 are held out — and they play the same pieces
 *  as players 0–2, which flatters a GuitarSet-trained prior. The honest zero-shot read is
 *  `fingering.mjs --gs … --with-prior --prior-from gp --prior-parts cell,move` (prior trained on
 *  Guitar Pro only), or `--prior-file` below for the end-to-end lines.
 *
 *  Data: `hf download jhartquist/guitarset --repo-type dataset` (HF_HUB_DISABLE_XET=1 if the
 *  Xet CAS host is not allowed), then extract with scripts/guitarset_extract.py into one <track>.json
 *  (annotation) + <track>.wav per track.
 *
 *    node bench/guitarset.mjs <extracted dir> [<predictions dir> …] [--opts '{…}'] [--prior-file p.json]
 *
 *  --opts '{"prior":null}' scores the cost model alone; --prior-file swaps in a table printed by
 *  `fingering.mjs --gs … --learn-prior --prior-from gp --prior-parts cell,move` (GP-only = zero-
 *  shot here). Every line is reported for all tracks and per split (players 0–2 dev, 3–5 test).
 */
import fs from "node:fs";
import path from "node:path";
import { loadEngine } from "./lib.mjs";

const eng = await loadEngine();
const STD = eng.TUNINGS.Standard;
const argv = process.argv.slice(2);
const oi = argv.indexOf("--opts");
const opts = oi >= 0 ? JSON.parse(argv[oi + 1]) : {};
const pfi = argv.indexOf("--prior-file");
if (pfi >= 0) opts.prior = JSON.parse(fs.readFileSync(argv[pfi + 1], "utf8"));
const valueIdx = new Set([oi, pfi].filter((i) => i >= 0).map((i) => i + 1));
const dirs = argv.filter((a, i) => !a.startsWith("--") && !valueIdx.has(i));
const [gsDir, ...predDirs] = dirs;
if (!gsDir) { console.error("usage: guitarset.mjs <extracted dir> [<pred dir> …] [--opts json]"); process.exit(2); }

const CHORD_TOL = 0.035;   // notes starting within 35 ms are one strum
const ONSET_TOL = 0.05;    // mir_eval's default onset tolerance

/** Group notes into chord events and finger them; returns notes with a `string` assigned. */
function fingerNotes(notes, bpm) {
  const sorted = [...notes].sort((a, b) => a.onset - b.onset || a.midi - b.midi);
  const groups = [];
  for (const n of sorted) {
    const g = groups[groups.length - 1];
    if (g && n.onset - g.onset <= CHORD_TOL && g.notes.length < 6 && !g.notes.some((x) => x.midi === n.midi)) g.notes.push(n);
    else groups.push({ onset: n.onset, notes: [n] });
  }
  const spb = 60 / (bpm || 120);
  let lastEnd = null;
  const events = groups.map((g) => {
    const end = Math.max(...g.notes.map((n) => n.offset));
    const ev = { midis: g.notes.map((n) => n.midi), gap: lastEnd == null ? 0 : Math.max(0, (g.onset - lastEnd) / spb) };
    lastEnd = end;
    return ev;
  });
  const { shapes } = eng.fingerSequence(events, STD, opts);
  const out = [];
  groups.forEach((g, i) => {
    const used = new Set();
    for (const n of g.notes) {
      const sh = shapes[i] || [];
      const j = sh.findIndex((x, xi) => !used.has(xi) && x.midi === n.midi);
      if (j >= 0) used.add(j);
      out.push({ ...n, string: j >= 0 ? sh[j].string : -1 });
    }
  });
  return out;
}

/** Greedy one-to-one match on onset ±50 ms + exact pitch (closest onset first). */
function match(ref, est) {
  const pairs = [];
  for (let i = 0; i < ref.length; i++) for (let j = 0; j < est.length; j++) {
    const d = Math.abs(ref[i].onset - est[j].onset);
    if (d <= ONSET_TOL && ref[i].midi === est[j].midi) pairs.push([d, i, j]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  const ri = new Set(), ej = new Set(), out = [];
  for (const [, i, j] of pairs) if (!ri.has(i) && !ej.has(j)) { ri.add(i); ej.add(j); out.push([i, j]); }
  return out;
}

const tracks = fs.readdirSync(gsDir).filter((f) => f.endsWith(".json")).sort().map((f) => {
  const d = JSON.parse(fs.readFileSync(path.join(gsDir, f), "utf8"));
  return { id: d.track_id, style: d.style, bpm: d.tempo_bpm, split: d.player <= 2 ? "dev" : "test",
    notes: d.notes.map((n) => ({ onset: n.onset_s, offset: Math.max(n.offset_s, n.onset_s + 0.01), midi: Math.round(n.midi), string: n.string })) };
});

// ---- Stage 3 alone, oracle MIDI -------------------------------------------------
const acc = { all: [0, 0], comp: [0, 0], solo: [0, 0], dev: [0, 0], test: [0, 0] }, low = [0, 0];
for (const t of tracks) {
  const f = fingerNotes(t.notes, t.bpm);
  const ok = f.filter((n) => n.string >= 0);
  for (const n of ok) {
    const hit = n.string === t.notes.find((m) => m.onset === n.onset && m.midi === n.midi)?.string;
    for (const k of ["all", t.style, t.split]) { acc[k][1]++; if (hit) acc[k][0]++; }
  }
  for (const n of t.notes) {
    const c = eng.fingerCandidates(n.midi, STD);
    let lo = 0; for (let k = 2; k < c.length; k += 2) if (c[k + 1] < c[lo + 1]) lo = k;
    low[1]++; if (c[lo] === n.string) low[0]++;
  }
}
const pct = ([a, b]) => (b ? ((100 * a) / b).toFixed(1) + "%" : "—");
console.log(`GuitarSet ${tracks.length} tracks, ${acc.all[1]} notes — Stage 3 on annotated MIDI`);
console.log(`  string accuracy  fingerSequence ${pct(acc.all)}  (comp ${pct(acc.comp)} · solo ${pct(acc.solo)} · dev ${pct(acc.dev)} · test ${pct(acc.test)})   lowest-fret ${pct(low)}`);

// ---- End to end, model notes -----------------------------------------------------
for (const pd of predDirs) {
  const z = () => ({ tp: 0, tpNote: 0, nEst: 0, nRef: 0, covered: 0 });
  const tot = { all: z(), dev: z(), test: z() };
  for (const t of tracks) {
    const p = path.join(pd, t.id + ".json");
    if (!fs.existsSync(p)) continue;
    const est = JSON.parse(fs.readFileSync(p, "utf8")).map((n) => ({ onset: n.onset, offset: Math.max(n.offset, n.onset + 0.01), midi: n.midi }));
    const fe = fingerNotes(est, t.bpm);
    const m = match(t.notes, fe);
    let tp = 0; for (const [i, j] of m) if (t.notes[i].string === fe[j].string) tp++;
    for (const c of [tot.all, tot[t.split]]) { c.covered++; c.nEst += fe.length; c.nRef += t.notes.length; c.tpNote += m.length; c.tp += tp; }
  }
  const f1 = (a, p, r) => (p + r ? (200 * a) / (p + r) : 0);
  for (const [k, c] of Object.entries(tot)) {
    if (!c.covered) continue;
    console.log(`${path.basename(pd)} ${k.padEnd(4)} (${c.covered} tracks):  note F1 ${f1(c.tpNote, c.nEst, c.nRef).toFixed(1)}%   ` +
      `Tab P ${(100 * c.tp / c.nEst).toFixed(1)}%  R ${(100 * c.tp / c.nRef).toFixed(1)}%  F1 ${f1(c.tp, c.nEst, c.nRef).toFixed(1)}%`);
  }
}
