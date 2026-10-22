/* Stems benchmark: does separating a mix (and fusing the bass stem) help chords, and how
 * well are drums transcribed?  node bench/stems.mjs */
import fs from "node:fs"; import path from "node:path"; import * as L from "./lib.mjs";
const eng = await L.loadEngine();
const SR = 44100, T = 16000;
function renderDrums(len, bpm, R) {           // the lib's bleed kit, alone, with its hit list
  const y = new Float32Array(len), spb = 60 / bpm, hits = [];
  for (let b = 0; b * spb * SR < len; b++) {
    const at = Math.floor(b * spb * SR);
    if (b % 2 === 0) { hits.push({ t: b * spb, type: "kick" }); for (let i = 0; i < 0.3 * SR && at + i < len; i++) { const t = i / SR; y[at + i] += 0.9 * Math.sin(2 * Math.PI * (50 + 70 * Math.exp(-t * 30)) * t) * Math.exp(-t * 9); } }
    else { hits.push({ t: b * spb, type: "snare" }); for (let i = 0; i < 0.18 * SR && at + i < len; i++) { const t = i / SR; y[at + i] += (0.5 * (R() * 2 - 1) + 0.3 * Math.sin(2 * Math.PI * 185 * t)) * Math.exp(-t * 22); } }
    for (const off of [0, 0.5]) { const tt = (b + off) * spb, h = Math.floor(tt * SR); if (h >= len) continue; hits.push({ t: tt, type: "hat" }); let hp = 0, prev = 0; for (let i = 0; i < 0.05 * SR && h + i < len; i++) { const w = R() * 2 - 1; hp = 0.85 * (hp + w - prev); prev = w; y[h + i] += 0.25 * hp * Math.exp(-i / (SR * 0.012)); } }
  }
  return { y, hits };
}
const rms = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / (a.length || 1)) || 1; };
const scaled = (a, r) => { const g = r / rms(a), o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] * g; return o; };
const ds = (a) => eng.resampleTo(a, SR, T);
const res = { mix: [], perfect: [], fuse05: [], fuse025: [], noFusion: [], leaky: [], leakyNoFusion: [], otherOnly: [] }, drumF = [];
for (const [file, bassPart] of Object.entries(L.BASS_PART)) {
  const idx = L.CORPUS.findIndex(([f]) => f === file); const [, part, inst] = L.CORPUS[idx];
  const bytes = new Uint8Array(fs.readFileSync(path.join(L.repo, file)));
  const sc = await eng.parseGuitarProOrXML(bytes, file, true, part);
  const r = L.renderPart(eng, sc, { sr: SR, instrument: inst, seed: 17 + idx, maxSec: 45 });
  const bs = await eng.parseGuitarProOrXML(bytes, file, true, bassPart);
  const br = L.renderPart(eng, bs, { sr: SR, instrument: "guitar", seed: 99, fromSec: r.t0, maxSec: 45 });
  const len = r.audio.length, R = L.rng(5 + idx);
  const comp = scaled(r.audio, 0.1), bass = scaled(Float32Array.from({ length: len }, (_, i) => br.audio[i] || 0), 0.08);
  const dr = renderDrums(len, r.bpm, R), drums = scaled(dr.y, 0.08);
  const mix = Float32Array.from(comp, (v, i) => v + bass[i] + drums[i]);
  const leak = (a, others) => Float32Array.from(a, (v, i) => v + 0.25 * others.reduce((s, o) => s + o[i], 0));   // −12 dB cross-talk
  const S = { other: ds(comp), bass: ds(bass), drums: ds(drums) };
  const Lk = { other: ds(leak(comp, [bass, drums])), bass: ds(leak(bass, [comp, drums])), drums: ds(leak(drums, [comp, bass])) };
  const total = r.gt[r.gt.length - 1].t1, sc2 = (ev) => L.score(r.gt, ev, eng.QUALITIES, total);
  res.mix.push(sc2(eng.analyzeAudioChords(ds(mix), T).events));
  const band = (st, o = {}) => eng.chartsFromStems(st, T, o).charts.find((c) => c.role === "band").events;
  res.perfect.push(sc2(band(S, { bassFusion: true })));
  res.noFusion.push(sc2(band(S, { bassFusion: false })));
  res.fuse05.push(sc2(band(S, { bassFusion: true, bassFusionWeight: 0.5 })));
  res.fuse025.push(sc2(band(S, { bassFusion: true, bassFusionWeight: 0.25 })));
  res.leakyNoFusion.push(sc2(band(Lk, { bassFusion: false })));
  res.leaky.push(sc2(band(Lk, { bassFusion: true })));
  res.otherOnly.push(sc2(eng.analyzeAudioChords(S.other, T).events));
  // drums: F-measure at ±50 ms per type
  const est = eng.transcribeDrums(drums, SR);
  for (const type of ["kick", "snare", "hat"]) {
    const g = dr.hits.filter((h) => h.type === type && h.t < len / SR - 0.1), e = est.filter((h) => h.type === type);
    const used = new Set(); let tp = 0;
    for (const h of g) { const j = e.findIndex((x, k) => !used.has(k) && Math.abs(x.t - h.t) < 0.05); if (j >= 0) { used.add(j); tp++; } }
    drumF.push({ type, p: e.length ? tp / e.length : 0, r: g.length ? tp / g.length : 0 });
  }
  console.error("done", file);
}
const m = (a, k) => (100 * a.reduce((s, x) => s + x[k], 0) / a.length).toFixed(1).padStart(6);
console.log("config          root majmin sevenths  bass   seg");
for (const [k, a] of Object.entries(res)) console.log(k.padEnd(14), ["root", "majmin", "sevenths", "bass", "seg"].map((x) => m(a, x)).join(""));
for (const type of ["kick", "snare", "hat"]) { const a = drumF.filter((d) => d.type === type); const P = a.reduce((s, d) => s + d.p, 0) / a.length, Rr = a.reduce((s, d) => s + d.r, 0) / a.length; console.log(type.padEnd(6), "P", (100 * P).toFixed(1), "R", (100 * Rr).toFixed(1), "F", (200 * P * Rr / (P + Rr || 1)).toFixed(1)); }
