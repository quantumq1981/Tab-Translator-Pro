/* DRUM EVENTS suite — work order WPO-ADT-001 Phase 0 (2026-11-09).
 *   · transcribeDrumEvents: the §4 per-event schema (t_raw, t_quantized, bar, beat, slot,
 *     drum_class, velocity, confidence, is_ghost, grid_confidence), ranges, renderability;
 *   · quantisation onto the tracked beat grid, velocity ordering, ghost-note candidates;
 *   · the §3.1 low_onset_confidence flag + suppression; the detector seam (opts.hits);
 *   · transcribeDrums without softFloor is unchanged (the validated default path);
 *   · the evaluation harness: matchEvents is a MAXIMUM matching (brute force), scoreTrack counts.
 * Accuracy on real drums lives in tests/bench/adt.mjs (E-GMD) — see docs/DRUM-TRANSCRIPTION.md. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchEvents, newTally, scoreTrack, summary, gmToClass, CLASSES5 } from "./bench/adt-metrics.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
globalThis.DOMParser = (await import("@xmldom/xmldom")).DOMParser;
const enginePath = path.join(here, ".engine.drumevents.mjs");
fs.writeFileSync(enginePath, fs.readFileSync(path.join(repo, "engine.tsx"), "utf8"));
const eng = await import(enginePath + "?t=" + Date.now());

let failures = 0, passes = 0;
const expect = (cond, msg) => { if (cond) passes++; else { failures++; console.error("FAIL:", msg); } };
const section = (name) => console.log(`\n— ${name}`);
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

/* a small rendered kit: kick 1 & 3, snare 2 & 4 (amp per hit), 8th hats, at `bpm` */
function render(sr, { bpm = 100, bars = 6, snareAmp = () => 1, ghosts = false, seed = 3 } = {}) {
  const R = rng(seed), spb = 60 / bpm, lead = 0.5, x = new Float32Array(Math.round((lead + bars * 4 * spb + 1.5) * sr)), truth = [];
  const add = (t, type, amp, fn, dur) => { truth.push({ t, type, amp }); const i0 = Math.round(t * sr); let hp = 0, prev = 0; for (let i = 0; i < dur * sr && i0 + i < x.length; i++) { const w = R() * 2 - 1; hp = 0.85 * (hp + w - prev); prev = w; x[i0 + i] += amp * fn(i / sr, w, hp); } };
  const kick = (t) => add(t, "kick", 1, (u) => 0.9 * Math.sin(2 * Math.PI * (50 + 70 * Math.exp(-u * 30)) * u) * Math.exp(-u * 9), 0.3);
  const snare = (t, a) => add(t, "snare", a, (u, w) => (0.5 * w + 0.3 * Math.sin(2 * Math.PI * 185 * u)) * Math.exp(-u * 22), 0.18);
  const hat = (t) => add(t, "hat", 1, (u, w, hp) => 0.25 * hp * Math.exp(-u / 0.012), 0.05);
  for (let b = 0; b < bars; b++) {
    const t0 = lead + b * 4 * spb;
    kick(t0); kick(t0 + 2 * spb);
    snare(t0 + spb, snareAmp(b, 1)); snare(t0 + 3 * spb, snareAmp(b, 3));
    if (ghosts) { snare(t0 + 1.75 * spb, 0.16); snare(t0 + 3.75 * spb, 0.16); }
    for (let k = 0; k < 8; k++) hat(t0 + k * spb / 2);
  }
  return { x, truth: truth.sort((a, b) => a.t - b.t), spb, lead };
}
const near = (list, t, type, tol = 0.035) => list.find((e) => Math.abs((e.t_raw ?? e.t) - t) <= tol && (e.drum_class || e.type) === type);

section("transcribeDrums — the default path is unchanged; softFloor is opt-in");
{
  const { x } = render(44100);
  const a = eng.transcribeDrums(x, 44100), b = eng.transcribeDrums(x, 44100, {});
  expect(JSON.stringify(a) === JSON.stringify(b), "no options = {} (deterministic)");
  expect(a.every((h) => Object.keys(h).sort().join() === "strength,t,type"), "default hits carry only { t, type, strength } (no soft / local fields)");
  const s = eng.transcribeDrums(x, 44100, { softFloor: 0.15 });
  expect(a.every((h) => s.some((o) => o.type === h.type && Math.abs(o.t - h.t) < 0.012)), "softFloor keeps every default hit");
  expect(s.every((h) => h.soft || a.some((o) => o.type === h.type && Math.abs(o.t - h.t) < 0.012)), "every extra hit is flagged soft");
  const sn = eng.transcribeDrums(x, 44100, { softFloor: 0.15, softTypes: ["snare"] });
  expect(sn.filter((h) => h.soft).every((h) => h.type === "snare"), "softTypes limits soft hits to the listed pieces");
}

section("transcribeDrumEvents — the §4 schema");
const sr = 44100, kit = render(sr, { snareAmp: (b, k) => (k === 1 ? 0.45 : 1) });
const r = eng.transcribeDrumEvents(kit.x, sr);
{
  const keys = "t_raw,t_quantized,bar,beat,slot,drum_class,velocity,confidence,is_ghost,grid_confidence,piece";
  expect(r.events.length > 40, `events found (${r.events.length})`);
  expect(r.events.every((e) => Object.keys(e).join() === keys), "every event has exactly the §4 fields (+ piece)");
  expect(r.events.every((e) => eng.DRUM_CLASSES.includes(e.drum_class) && eng.DRUM_NOTATION[e.drum_class]), "every drum_class is in the enum AND has a notation entry (renderable without inference)");
  expect(eng.DRUM_CLASSES.join() === "kick,snare,hihat,tom,cymbal,crash,ride", "the enum is the work order's");
  expect(eng.DRUM_CLASSES.every((c) => { const n = eng.DRUM_NOTATION[c]; return Number.isInteger(n.line) && ["normal", "x"].includes(n.head) && n.gm >= 35 && n.gm <= 59; }), "every class: staff line, notehead and GM note");
  expect(r.events.every((e) => Number.isInteger(e.velocity) && e.velocity >= 1 && e.velocity <= 127), "velocity is an integer in 1–127");
  expect(r.events.every((e) => e.confidence >= 0 && e.confidence <= 1 && e.grid_confidence >= 0 && e.grid_confidence <= 1), "confidences in [0,1]");
  expect(r.events.every((e) => Number.isInteger(e.slot) && e.slot >= 0 && e.slot < r.slotsPerBar && Math.abs(e.beat - (1 + e.slot / r.subdivisions)) < 1e-9 && e.bar >= 1), "slot / beat / bar consistent (beat = 1 + slot/4)");
  expect(r.events.every((e, i, a) => i === 0 || a[i - 1].t_raw <= e.t_raw), "events in time order");
  expect(Math.abs(r.bpm - 100) < 2 && r.gridFit > 0.8, `tracked grid: ${r.bpm} bpm, fit ${r.gridFit}`);
  const half = 60 / r.bpm / r.subdivisions / 2;
  expect(r.events.every((e) => Math.abs(e.t_quantized - e.t_raw) <= half + 0.002), "t_quantized within half a sixteenth of t_raw");
}

section("quantisation — the backbeat lands on beats 2 and 4");
{
  const sn = r.events.filter((e) => e.drum_class === "snare" && !e.is_ghost);
  const onBack = sn.filter((e) => e.slot === 4 || e.slot === 12).length;
  expect(sn.length >= 10 && onBack / sn.length >= 0.9, `snares on slots 4/12: ${onBack}/${sn.length}`);
  const kk = r.events.filter((e) => e.drum_class === "kick"), on13 = kk.filter((e) => e.slot === 0 || e.slot === 8).length;
  expect(kk.length >= 10 && on13 / kk.length >= 0.9, `kicks on slots 0/8: ${on13}/${kk.length}`);
  expect(new Set(sn.map((e) => e.bar)).size >= 5, "snares spread over the bars");
}

section("velocity — a softer hit gets a lower velocity");
{
  const soft = [], loud = [];
  for (const h of kit.truth.filter((h) => h.type === "snare")) { const e = near(r.events, h.t, "snare"); if (e) (h.amp < 1 ? soft : loud).push(e.velocity); }
  const med = (a) => a.slice().sort((p, q) => p - q)[a.length >> 1];
  expect(soft.length >= 4 && loud.length >= 4 && med(soft) < med(loud) - 5, `beat-2 snares (amp 0.45) ${med(soft)} < beat-4 snares ${med(loud)}`);
}

section("ghost notes — quiet snare taps are kept and flagged");
{
  const g = render(sr, { ghosts: true, seed: 11 }), rg = eng.transcribeDrumEvents(g.x, sr);
  const ghostT = g.truth.filter((h) => h.type === "snare" && h.amp < 0.2);
  const found = ghostT.map((h) => near(rg.events, h.t, "snare")).filter(Boolean);
  expect(found.length >= 0.6 * ghostT.length, `ghost taps detected: ${found.length}/${ghostT.length}`);
  expect(found.filter((e) => e.is_ghost).length >= 0.8 * found.length, "detected taps are flagged is_ghost");
  const accents = g.truth.filter((h) => h.type === "snare" && h.amp === 1).map((h) => near(rg.events, h.t, "snare")).filter(Boolean);
  expect(accents.length >= 10 && accents.filter((e) => e.is_ghost).length <= 1, "backbeat accents are not flagged");
  const plain = eng.transcribeDrums(g.x, sr);
  expect(ghostT.filter((h) => plain.some((p) => p.type === "snare" && Math.abs(p.t - h.t) < 0.035)).length < found.length, "the default detector drops taps the interface keeps");
}

section("§3.1 low_onset_confidence — a weak stretch > 2 s is flagged and suppressed");
{
  const hits = [];
  for (let t = 0.5; t < 3; t += 0.3) hits.push({ t, type: "snare", strength: 1, local: 1 });
  for (let t = 3.3; t < 6.9; t += 0.3) hits.push({ t, type: "hat", strength: 0.05, local: 0.12, soft: true });
  for (let t = 7.2; t < 9; t += 0.3) hits.push({ t, type: "snare", strength: 1, local: 1 });
  const beats = Array.from({ length: 20 }, (_, i) => 0.5 + i * 0.6);
  const a = eng.transcribeDrumEvents(null, 44100, { hits, beats, bpm: 100 });
  expect(a.method === "external", "opts.hits replaces the built-in detector (the model seam)");
  expect(a.flags.length === 1 && a.flags[0].flag === "low_onset_confidence" && a.flags[0].start < 3.3 && a.flags[0].end > 6.8, `one flag over the weak stretch ${JSON.stringify(a.flags)}`);
  expect(!a.events.some((e) => e.t_raw > 3.2 && e.t_raw < 7), "its events are suppressed");
  expect(a.events.filter((e) => e.drum_class === "snare").length >= 13, "confident events around it stay");
  const b = eng.transcribeDrumEvents(null, 44100, { hits, beats, bpm: 100, suppressLow: false });
  expect(b.flags.length === 1 && b.events.some((e) => e.t_raw > 3.2 && e.t_raw < 7), "suppressLow:false keeps them (flag still reported)");
  const short = hits.filter((h) => !(h.t > 4.2 && h.t < 6.9));
  expect(!eng.transcribeDrumEvents(null, 44100, { hits: short, beats, bpm: 100 }).flags.length, "a weak stretch under 2 s is not flagged");
  const none = eng.transcribeDrumEvents(null, 44100, { hits: [], beats, bpm: 100 });
  expect(none.events.length === 0 && none.flags.length === 0, "no hits → no events, no flags, no throw");
}

section("evaluation harness — mir_eval-style matching");
{
  const R = rng(9);
  const brute = (r, e, w) => { let best = 0; const used = new Set(); const go = (i, n) => { if (i === r.length) { best = Math.max(best, n); return; } go(i + 1, n); for (let j = 0; j < e.length; j++) if (!used.has(j) && Math.abs(r[i] - e[j]) <= w) { used.add(j); go(i + 1, n + 1); used.delete(j); } }; go(0, 0); return best; };
  let ok = true;
  for (let k = 0; k < 150; k++) {
    const r = Array.from({ length: 1 + Math.floor(R() * 6) }, () => +(R() * 1).toFixed(2)), e = Array.from({ length: 1 + Math.floor(R() * 6) }, () => +(R() * 1).toFixed(2));
    const m = matchEvents(r, e, 0.1);
    const valid = new Set(m.map((p) => p[0])).size === m.length && new Set(m.map((p) => p[1])).size === m.length && m.every(([a, b]) => Math.abs(r[a] - e[b]) <= 0.1);
    if (!valid || m.length !== brute(r, e, 0.1)) ok = false;
  }
  expect(ok, "matchEvents = maximum one-to-one matching (150 random cases vs brute force)");
  const T = newTally(CLASSES5);
  scoreTrack(T, [{ t: 1, cls: "kick", vel: 100 }, { t: 1.005, cls: "hihat", vel: 80 }, { t: 1.01, cls: "hihat", vel: 60 }, { t: 2, cls: "snare", vel: 30 }, { t: 2.5, cls: "snare", vel: 100 }, { t: 3, cls: "snare", vel: 100 }],
    [{ t: 1.02, cls: "kick", vel: 90 }, { t: 1.0, cls: "hihat", vel: 70 }, { t: 2.6, cls: "snare", vel: 95, is_ghost: true }, { t: 4, cls: "tom", vel: 50 }], {});
  const S = summary(T);
  expect(S.cls.hihat.nRef === 1, "two same-class hits 5 ms apart are merged into one reference");
  expect(S.cls.kick.f === 1 && S.cls.snare.tp === 0 && S.cls.snare.nRef === 3 && S.cls.tom.nEst === 1, "per-class counts (50 ms window: the 2.6 s snare misses 2.5 s)");
  expect(S.simulN === 2 && S.simulRecall === 1, "simultaneous onsets: kick + hat within 30 ms, both found");
  expect(S.ghostN === 1 && S.ghostRecall === 0, "ghost recall: the 30-velocity snare is a ghost, missed");
  expect(gmToClass(44) === "hihat" && gmToClass(37) === "snare" && gmToClass(58) === "tom" && gmToClass(53) === "ride" && gmToClass(54) === null, "GM → class map (pedal hat, side stick, floor tom, ride bell; tambourine out of scope)");
}

section("contract guards");
{
  const doc = fs.readFileSync(path.join(repo, "docs", "DRUM-TRANSCRIPTION.md"), "utf8");
  expect(/WPO-ADT-001/.test(doc) && /E-GMD/.test(doc) && /CC BY 4\.0/.test(doc), "docs/DRUM-TRANSCRIPTION.md records the work order, the dataset and its licence");
  expect(fs.existsSync(path.join(repo, "scripts", "egmd_subset.py")) && fs.existsSync(path.join(repo, "scripts", "adt_mireval_check.py")), "the subset builder and the mir_eval cross-check ship with the harness");
  const src = fs.readFileSync(path.join(repo, "engine.tsx"), "utf8");
  expect(/transcribeDrumEvents, DRUM_CLASSES, DRUM_PIECE_CLASS, DRUM_NOTATION/.test(src), "the interface is exported");
}

try { fs.unlinkSync(enginePath); } catch {}
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
