/* scoretab.mjs — Guitar → Tab WITH a linked score, measured on GuitarSet (real recorded guitar,
 * every note's string annotated by a hexaphonic pickup; Xi et al. 2018, CC-BY 4.0).
 *
 * For each track a "score" is written from its own annotation the way a transcriber would: notes
 * on a 16th grid at the track's tempo (best grid phase), strings and frets as played. Then it is
 * spoiled the ways a real tab differs from a real performance:
 *   --flip p   a share p of notes written on ANOTHER string (same pitch) — the transcriber's own
 *              fingering; the audio can't tell, so this caps what any score can give;
 *   --wrong p  a share p of chords/notes wrong — a note dropped, a pitch a step off, an extra note.
 * The score is linked to the recording (linkScoreToAudio, the app's own path, tempo from the file
 * name), the shipped CRNN's notes are re-made from saved activations (crnnNotesFromOutputs), and
 * the tab is built three ways: the shipped Guitar → Tab (fingerSequence alone), and
 * scoreInformedTab following the Recording / Balanced / Score. Metrics as bench/guitarset.mjs: a
 * note counts when onset ±50 ms and pitch agree (note F1), and the string too (Tab P/R/F1).
 * Players 0–2 = dev, 3–5 = test (the shipped fingering prior saw dev).
 *
 *   node bench/scoretab.mjs --gs <gs_ex dir> --acts <activations dir> [--flip 0.1] [--wrong 0.1]
 *        [--every 3] [--limit N] [--split dev|test|all] [--params '{"tolSec":0.1}'] [--follow balanced,score]
 * <gs_ex> = scripts/guitarset_extract.py, <acts> = scripts/guitarset_activations.py. Dev-only. */
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process";
import { loadEngine } from "./lib.mjs";

const E = await loadEngine();
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const GS = arg("gs"), ACTS = arg("acts");
if (!GS || !ACTS) { console.error("--gs and --acts are required"); process.exit(2); }
const FLIP = +arg("flip", 0), WRONG = +arg("wrong", 0), LIMIT = +arg("limit", 0), SPLIT = arg("split", "all");
const PARAMS = JSON.parse(arg("params", "{}")), FOLLOWS = arg("follow", "recording,balanced,score").split(",");
const STD = E.TUNINGS.Standard, ONSET_TOL = 0.05, CHORD_TOL = 0.035;

function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function hash(str) { let h = 2166136261; for (const c of str) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function half2float(u16) {
  const out = new Float32Array(u16.length);
  for (let i = 0; i < u16.length; i++) {
    const h = u16[i], s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
    out[i] = e === 0 ? s * f * 2 ** -24 : e === 31 ? (f ? NaN : s * Infinity) : s * (1 + f / 1024) * 2 ** (e - 15);
  }
  return out;
}
function loadActs(id) {
  const meta = JSON.parse(fs.readFileSync(path.join(ACTS, id + ".json"), "utf8"));
  const raw = fs.readFileSync(path.join(ACTS, id + ".f16"));
  const all = half2float(new Uint16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2)), n = meta.frames * meta.classes;
  const out = {}; meta.heads.forEach((h, i) => { out[h] = all.subarray(i * n, (i + 1) * n); });
  return out;
}
function loadPcm(id) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", path.join(GS, id + ".wav"), "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], { maxBuffer: 2 ** 30 });
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

/* The annotation as a transcriber's tab: 16th grid at the file's tempo, best phase. */
function writeScore(t, r) {
  const spq = 60 / t.bpm, step = spq / 4;
  let bestPhi = 0, bestErr = Infinity;
  for (let phi = 0; phi < spq; phi += 0.005) {
    let err = 0; for (const n of t.notes) { const x = (n.onset - phi) / step; err += Math.abs(x - Math.round(x)); }
    if (err < bestErr) { bestErr = err; bestPhi = phi; }
  }
  let notes = t.notes.map((n) => ({ midi: n.midi, string: n.string, q: Math.max(0, Math.round((n.onset - bestPhi) / step) / 4) }));
  // the transcriber's own fingering: another playable string for the same pitch
  if (FLIP) notes = notes.map((n) => {
    if (r() >= FLIP) return n;
    const alts = []; for (let s = 0; s < 6; s++) { const f = n.midi - STD[s]; if (s !== n.string && f >= 0 && f <= 19) alts.push(s); }
    return alts.length ? { ...n, string: alts[Math.floor(r() * alts.length)] } : n;
  });
  // wrong notes: dropped, a step off, or an extra one
  if (WRONG) {
    const out = [];
    for (const n of notes) {
      if (r() >= WRONG) { out.push(n); continue; }
      const kind = r();
      if (kind < 0.34) continue;
      if (kind < 0.67) { const m = n.midi + (r() < 0.5 ? -1 : 1) * (1 + Math.floor(r() * 2)), f = m - STD[n.string]; out.push(f >= 0 && f <= 20 ? { ...n, midi: m } : n); continue; }
      out.push(n); const m = n.midi + (r() < 0.5 ? 3 : 4); let s = n.string + 1; if (s > 5) s = 4;
      if (m - STD[s] >= 0 && m - STD[s] <= 20) out.push({ midi: m, string: s, q: n.q + 0.5 });
    }
    notes = out;
  }
  const byQ = new Map();
  for (const n of notes) { if (!byQ.has(n.q)) byQ.set(n.q, []); byQ.get(n.q).push(n); }
  const qs = [...byQ.keys()].sort((a, b) => a - b), nb = Math.floor((qs[qs.length - 1] || 0) / 4) + 1;
  const bars = Array.from({ length: nb }, (_, i) => ({ number: i + 1, timeSig: [4, 4], events: [] }));
  qs.forEach((q, i) => {
    const ns = byQ.get(q), frets = {}, midis = [];
    for (const n of ns) { if (frets[n.string] != null) continue; frets[n.string] = n.midi - STD[n.string]; midis.push(n.midi); }
    const qdur = (qs[i + 1] != null ? qs[i + 1] : q + 1) - q, b = Math.floor(q / 4);
    bars[b].events.push({ symbol: E.symbolForMidis(midis, true), midis: midis.sort((a, c) => a - c), frets, beat: Math.floor(q - 4 * b), durBeats: 1, qbeat: q - 4 * b, qdur });
  });
  return { score: { source: "gp", timeSig: [4, 4], tempo: t.bpm, tuning: "Standard", tuningMidi: STD.slice(), bars }, phi: bestPhi };
}

function fingerNotes(notes, bpm) {         // the shipped Guitar → Tab fingering (= bench/guitarset.mjs)
  const sorted = [...notes].sort((a, b) => a.onset - b.onset || a.midi - b.midi), groups = [];
  for (const n of sorted) { const g = groups[groups.length - 1]; if (g && n.onset - g.onset <= CHORD_TOL && g.notes.length < 6 && !g.notes.some((x) => x.midi === n.midi)) g.notes.push(n); else groups.push({ onset: n.onset, notes: [n] }); }
  const spb = 60 / (bpm || 120); let lastEnd = null;
  const events = groups.map((g) => { const end = Math.max(...g.notes.map((n) => n.offset)); const ev = { midis: g.notes.map((n) => n.midi), gap: lastEnd == null ? 0 : Math.max(0, (g.onset - lastEnd) / spb) }; lastEnd = end; return ev; });
  const { shapes } = E.fingerSequence(events, STD, {});
  const out = [];
  groups.forEach((g, i) => { const used = new Set(); for (const n of g.notes) { const sh = shapes[i] || []; const j = sh.findIndex((x, xi) => !used.has(xi) && x.midi === n.midi); if (j >= 0) used.add(j); out.push({ ...n, string: j >= 0 ? sh[j].string : -1 }); } });
  return out;
}
function match(ref, est) {
  const pairs = [];
  for (let i = 0; i < ref.length; i++) for (let j = 0; j < est.length; j++) { const d = Math.abs(ref[i].onset - est[j].onset); if (d <= ONSET_TOL && ref[i].midi === est[j].midi) pairs.push([d, i, j]); }
  pairs.sort((a, b) => a[0] - b[0]);
  const ri = new Set(), ej = new Set(), out = [];
  for (const [, i, j] of pairs) if (!ri.has(i) && !ej.has(j)) { ri.add(i); ej.add(j); out.push([i, j]); }
  return out;
}

const EVERY = +arg("every", 1);
const tracks = fs.readdirSync(GS).filter((f) => f.endsWith(".json")).sort().filter((_, i) => i % EVERY === 0).map((f) => {
  const d = JSON.parse(fs.readFileSync(path.join(GS, f), "utf8"));
  return { id: d.track_id, style: d.style, bpm: d.tempo_bpm, split: d.player <= 2 ? "dev" : "test",
    notes: d.notes.map((n) => ({ onset: n.onset_s, offset: Math.max(n.offset_s, n.onset_s + 0.01), midi: Math.round(n.midi), string: n.string })) };
}).filter((t) => (SPLIT === "all" || t.split === SPLIT) && fs.existsSync(path.join(ACTS, t.id + ".f16")));
const use = LIMIT ? tracks.filter((_, i) => i % Math.max(1, Math.floor(tracks.length / LIMIT)) === 0).slice(0, LIMIT) : tracks;

const methods = ["shipped", ...FOLLOWS];
const z = () => ({ n: 0, tp: 0, tpNote: 0, nEst: 0, nRef: 0 });
const tot = {}; for (const m of methods) for (const k of ["all", "dev", "test", "comp", "solo"]) tot[m + "|" + k] = z();
const linkErr = [], linkFail = []; let stats = { matched: 0, recovered: 0, extra: 0, missed: 0, scoreNotes: 0 };
const t0 = Date.now();
for (const t of use) {
  const r = rng(hash(t.id) ^ Math.round(FLIP * 1000) ^ (Math.round(WRONG * 1000) << 10));
  const { score } = writeScore(t, r);
  const pcm = loadPcm(t.id), out = loadActs(t.id);
  const notes = E.crnnNotesFromOutputs(out);
  const link = E.linkScoreToAudio(pcm, 16000, [{ score, name: "Guitar" }], { tempo: t.bpm });
  const ests = { shipped: fingerNotes(notes.map((n) => ({ onset: n.startSec, offset: n.endSec, midi: n.midi })), t.bpm) };
  if (link.ok) {
    // link accuracy: the link's time for each annotated note's grid position vs the real onset
    const sn = E.scoreTabNotes(score);
    const errs = []; for (const n of t.notes) { let b = Infinity; for (const x of sn.notes) if (x.midi === n.midi) b = Math.min(b, Math.abs(E.linkQToSec(link, x.t) - n.onset)); if (b < 0.5) errs.push(b); }
    errs.sort((a, b) => a - b); if (errs.length) linkErr.push(errs[errs.length >> 1]);
    for (const f of FOLLOWS) {
      const res = E.scoreInformedTab(notes, link, { score }, { follow: f, out, params: PARAMS, bpm: t.bpm });
      ests[f] = res.notes.map((n) => ({ onset: n.startSec, midi: n.midi, string: n.string == null ? -1 : n.string }));
      if (f === "balanced") for (const k of Object.keys(stats)) stats[k] += res.stats[k] || 0;
    }
  } else { linkFail.push(t.id); for (const f of FOLLOWS) ests[f] = ests.shipped; }
  for (const m of methods) {
    const fe = ests[m], mm = match(t.notes, fe);
    let tp = 0; for (const [i, j] of mm) if (t.notes[i].string === fe[j].string) tp++;
    for (const k of ["all", t.split, t.style]) { const c = tot[m + "|" + k]; c.n++; c.nEst += fe.length; c.nRef += t.notes.length; c.tpNote += mm.length; c.tp += tp; }
  }
}
const f1 = (a, p, r) => (p + r ? (200 * a) / (p + r) : 0);
console.log(`GuitarSet ${use.length} tracks · score: flip ${FLIP} wrong ${WRONG} · params ${JSON.stringify(PARAMS)} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
linkErr.sort((a, b) => a - b);
console.log(`link: ${use.length - linkFail.length}/${use.length} linked · median per-track note error ${(1000 * (linkErr[linkErr.length >> 1] || 0)).toFixed(0)} ms (p90 ${(1000 * (linkErr[Math.floor(linkErr.length * 0.9)] || 0)).toFixed(0)} ms)`);
console.log(`balanced: ${stats.scoreNotes} score notes → matched ${stats.matched} · recovered ${stats.recovered} · missed ${stats.missed} · extra heard ${stats.extra}`);
for (const k of ["all", "dev", "test", "comp", "solo"]) {
  if (!tot["shipped|" + k].n) continue;
  console.log(`  ${k.padEnd(4)} ` + methods.map((m) => { const c = tot[m + "|" + k]; return `${m} note ${f1(c.tpNote, c.nEst, c.nRef).toFixed(1)} tab ${f1(c.tp, c.nEst, c.nRef).toFixed(1)}`; }).join("  ·  "));
}
