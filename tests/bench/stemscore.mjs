/* stemscore.mjs — stems × score parts, measured with KNOWN differences.
 *
 * For each song in L.BASS_PART: the comp part, the bass part and the drum part are rendered as
 * separate stems from the Guitar Pro file (the drums from the file's own drum track), mixed, and
 * linked to the file. Then the SCORE given to the comparator is spoiled in a share of its bars, per
 * part, as a transcription that is wrong there (bass +5 semitones, comp +3, drums: snares moved to
 * kicks an eighth later) — the recording still plays the original. A good comparator flags exactly
 * those bars. Stems: perfect (rendered apart) or leaky (each + every other stem at −12 dB).
 * Reported per stem: agreement on untouched bars, on spoiled bars, and flag precision / recall.
 *
 *   node bench/stemscore.mjs [--wrong 0.2] [--leak 0.25] [--sec 45] [--params '{"margin":0.15}'] [--songs N]
 * Dev-only. */
import fs from "node:fs"; import path from "node:path"; import * as L from "./lib.mjs";
const E = await L.loadEngine();
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const WRONG = +arg("wrong", 0.2), LEAK = +arg("leak", 0), SEC = +arg("sec", 45), PARAMS = JSON.parse(arg("params", "{}")), NSONGS = +arg("songs", 99);
const SR = 44100, T = 16000;

function drumHit(y, at, cls, R) {
  const len = y.length;
  if (cls === "kick") { for (let i = 0; i < 0.3 * SR && at + i < len; i++) { const t = i / SR; y[at + i] += 0.9 * Math.sin(2 * Math.PI * (50 + 70 * Math.exp(-t * 30)) * t) * Math.exp(-t * 9); } }
  else if (cls === "snare") { for (let i = 0; i < 0.18 * SR && at + i < len; i++) { const t = i / SR; y[at + i] += (0.5 * (R() * 2 - 1) + 0.3 * Math.sin(2 * Math.PI * 185 * t)) * Math.exp(-t * 22); } }
  else { let hp = 0, prev = 0; for (let i = 0; i < 0.05 * SR && at + i < len; i++) { const w = R() * 2 - 1; hp = 0.85 * (hp + w - prev); prev = w; y[at + i] += 0.25 * hp * Math.exp(-i / (SR * 0.012)); } }
}
function renderDrumPart(score, t0, len, R) {
  const y = new Float32Array(len), ev = E.scoreEventTimes(score, score.tempo || 100).events;
  for (const e of ev) { const st = e.start - t0; if (st < 0 || st * SR >= len) continue; for (const m of e.midis || []) { const c = E._GM_DRUM_CLASS(m); if (c) drumHit(y, Math.floor(st * SR), c, R); } }
  return y;
}
const rms = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / (a.length || 1)) || 1; };
const scaled = (a, r, n) => { const g = r / rms(a), o = new Float32Array(n); for (let i = 0; i < Math.min(n, a.length); i++) o[i] = a[i] * g; return o; };
const ds = (a) => E.resampleTo(a, SR, T);

/* spoil a share of bars of one part score: returns { score, bars:Set(sourceBar) } */
function spoil(score, kind, R) {
  const bad = new Set();
  const bars = score.bars.map((b) => {
    if (!(b.events || []).some((e) => e.midis && e.midis.length) || R() >= WRONG) return b;
    bad.add(b.number);
    if (kind === "drums") return { ...b, events: b.events.map((e) => ({ ...e, midis: (e.midis || []).map((m) => (E._GM_DRUM_CLASS(m) === "snare" ? 36 : m)), qbeat: (e.qbeat ?? e.beat) + ((e.midis || []).some((m) => E._GM_DRUM_CLASS(m) === "snare") ? 0.5 : 0) })) };
    const d = kind === "bass" ? 5 : 3;
    return { ...b, events: b.events.map((e) => ({ ...e, midis: (e.midis || []).map((m) => m + d), frets: undefined })) };
  });
  return { score: { ...score, bars }, bad };
}

const acc = {}; const add = (role, key, v) => { acc[role] = acc[role] || {}; (acc[role][key] = acc[role][key] || []).push(v); };
let n = 0;
for (const [file, bassPart] of Object.entries(L.BASS_PART)) {
  if (n >= NSONGS) break;
  const idx = L.CORPUS.findIndex(([f]) => f === file); if (idx < 0) continue;
  const [, compPart, inst] = L.CORPUS[idx];
  const bytes = new Uint8Array(fs.readFileSync(path.join(L.repo, file)));
  const first = await E.parseGuitarProOrXML(bytes, file, true);
  const parts = first.parts || [];
  const drumIdxs = parts.filter((p) => p.drum).map((p) => p.index), drumIdx = drumIdxs[0];
  if (!drumIdxs.length) { console.log(`${file}: no drum part, skipped`); continue; }
  const all = [];
  for (const p of parts) all.push({ score: p.index === first.partIndex ? first : await E.parseGuitarProOrXML(bytes, file, true, p.index), name: p.name, drum: !!p.drum, index: p.index });
  const comp = all.find((p) => p.index === compPart), bass = all.find((p) => p.index === bassPart), drums = all.filter((p) => drumIdxs.includes(p.index));
  const R = L.rng(31 + idx);
  const rc = L.renderPart(E, comp.score, { sr: SR, instrument: inst, seed: 7 + idx, maxSec: SEC });
  if (!rc) continue;
  const rb = L.renderPart(E, bass.score, { sr: SR, instrument: "bass", seed: 9 + idx, fromSec: rc.t0, maxSec: SEC });
  const len = rc.audio.length;
  const sComp = scaled(rc.audio, 0.1, len), sBass = rb ? scaled(rb.audio, 0.08, len) : new Float32Array(len), sDrum = scaled(drums.map((d) => renderDrumPart(d.score, rc.t0, len, R)).reduce((a, b) => a.map((v, i) => v + b[i])), 0.08, len);
  const mix = Float32Array.from(sComp, (v, i) => v + sBass[i] + sDrum[i]);
  const leaky = (a, o1, o2) => (LEAK ? Float32Array.from(a, (v, i) => v + LEAK * (o1[i] + o2[i])) : a);
  const st = { other: leaky(sComp, sBass, sDrum), bass: leaky(sBass, sComp, sDrum), drums: leaky(sDrum, sComp, sBass) };
  // the spoiled score (each part on its own; everything else as written)
  const R2 = L.rng(101 + idx), truth = {};
  const given = all.map((p) => {
    const kind = p.index === compPart ? "other" : p.index === bassPart ? "bass" : drumIdxs.includes(p.index) ? "drums" : null;
    if (!kind || !WRONG) return p;
    const sp = spoil(p.score, kind, R2); truth[kind] = new Set([...(truth[kind] || []), ...sp.bad]); return { ...p, score: sp.score };
  });
  // only the three rendered parts exist in this recording: the comparator sees those, labelled
  const ps = given.filter((p) => p.index === compPart || p.index === bassPart || drumIdxs.includes(p.index)).map((p) => ({ ...p, name: p.index === bassPart ? "Bass" : drumIdxs.includes(p.index) ? "Drums" : (inst === "piano" ? "Piano" : "Guitar") }));
  const link = E.linkScoreToAudio(ds(mix), T, ps, { tempo: comp.score.tempo, unroll: false });   // the renderer plays bars as written
  if (!link.ok) { console.log(`${file}: link failed`); continue; }
  const st16 = { other: ds(st.other), bass: ds(st.bass), drums: ds(st.drums) };
  const charts = E.chartsFromStems(st16, T, { perStemChords: !!process.env.FROM_CHORDS, fullRate: { drums: st.drums, sampleRate: SR } });
  const res = E.compareStemsToScore(charts, T, link, ps, { audio: process.env.FROM_CHORDS ? {} : { other: st16.other }, params: PARAMS, unroll: false, debug: !!process.env.DIAG });
  if (process.env.DIAG) { const d = res.find((r) => r.role === "drums"); for (const b of d.bars.slice(0, 6)) console.log(b.bar, b.agreement, "exp", (b._exp || []).join(" "), "| hits", (b._hits || []).join(" ")); }
  const line = [];
  for (const r of res) {
    const bad = truth[r.role] || new Set();
    const inWin = r.bars.filter((b) => b.agreement != null);
    const pos = inWin.filter((b) => bad.has(b.sourceBar)), negs = inWin.filter((b) => !bad.has(b.sourceBar));
    const flagged = new Set(r.differs), tp = pos.filter((b) => flagged.has(b.bar)).length, fp = negs.filter((b) => flagged.has(b.bar)).length;
    const mean = (a) => (a.length ? a.reduce((s, b) => s + b.agreement, 0) / a.length : NaN);
    add(r.role, "good", mean(negs)); if (pos.length) add(r.role, "bad", mean(pos));
    add(r.role, "tp", tp); add(r.role, "fp", fp); add(r.role, "pos", pos.length); add(r.role, "neg", negs.length);
    line.push(`${r.role} ${r.parts.join("+")}: ok ${mean(negs).toFixed(2)} bad ${pos.length ? mean(pos).toFixed(2) : "—"} flags ${tp}/${pos.length} (+${fp} false of ${negs.length})`);
  }
  console.log(`${file.slice(0, 34).padEnd(34)} link ${link.confidence} ${line.join(" · ")}`);
  n++;
}
const sum = (a) => (a || []).reduce((s, v) => s + v, 0), avg = (a) => { const b = (a || []).filter((x) => !isNaN(x)); return b.length ? sum(b) / b.length : NaN; };
console.log(`\nwrong ${WRONG} · leak ${LEAK} · params ${JSON.stringify(PARAMS)} — ${n} songs`);
for (const [role, a] of Object.entries(acc)) {
  const tp = sum(a.tp), fp = sum(a.fp), pos = sum(a.pos), neg = sum(a.neg);
  console.log(`  ${role.padEnd(6)} agreement ok ${avg(a.good).toFixed(3)}  spoiled ${avg(a.bad).toFixed(3)}  ·  flag recall ${pos ? (100 * tp / pos).toFixed(1) : "—"}%  precision ${tp + fp ? (100 * tp / (tp + fp)).toFixed(1) : "—"}%  false-flag rate ${neg ? (100 * fp / neg).toFixed(1) : "—"}%`);
}
