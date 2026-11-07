/* Guards for the score-informed tab (Guitar → Tab with a linked score) and stems × score parts.
 * Pure engine, synthetic inputs with known answers, plus UI/glue contracts. Accuracy is measured
 * by tests/bench/scoretab.mjs (GuitarSet) and tests/bench/stemscore.mjs — not asserted here. */
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { loadEngine } from "./bench/lib.mjs";
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, "..");
const E = await loadEngine();
let pass = 0, fail = 0;
const expect = (ok, msg) => { if (ok) pass++; else { fail++; console.log("  ✗ " + msg); } };
const STD = E.TUNINGS.Standard;

/* a linked "score" on a steady 120 bpm clock: quarter q at q × 0.5 s */
function fakeLink(nq, opts = {}) {
  const beatTimes = Array.from({ length: nq + 1 }, (_, i) => (opts.t0 || 0) + i * 0.5);
  const bars = []; for (let b = 0; b * 4 < nq; b++) bars.push({ index: b, sourceBar: b + 1, timeSig: [4, 4], q0: 4 * b, q1: 4 * b + 4, sec: beatTimes[4 * b], endSec: beatTimes[Math.min(nq, 4 * b + 4)], bpm: 120, matched: true });
  return { ok: true, transpose: opts.transpose || 0, confidence: 0.9, beatTimes, len: nq, bars, tempo: 120, coverage: { audioFrom: beatTimes[0], audioTo: beatTimes[nq], audioLen: beatTimes[nq] + 1 } };
}
/* a one-part tab score: [{ q, string, fret }] in 4/4 */
function tabScore(notes, nBars = 2, tuning = STD) {
  const bars = Array.from({ length: nBars }, (_, i) => ({ number: i + 1, timeSig: [4, 4], events: [] }));
  const byQ = new Map(); for (const n of notes) { if (!byQ.has(n.q)) byQ.set(n.q, []); byQ.get(n.q).push(n); }
  const qs = [...byQ.keys()].sort((a, b) => a - b);
  qs.forEach((q, i) => { const b = Math.floor(q / 4), ns = byQ.get(q), frets = {}, midis = []; for (const n of ns) { frets[n.string] = n.fret; midis.push(tuning[n.string] + n.fret); }
    bars[b].events.push({ symbol: E.symbolForMidis(midis, true), midis, frets, beat: Math.floor(q - 4 * b), qbeat: q - 4 * b, durBeats: 1, qdur: (qs[i + 1] ?? q + 1) - q }); });
  return { source: "gp", timeSig: [4, 4], tempo: 120, tuning: "Standard", tuningMidi: tuning.slice(), bars };
}

// ---- pins through the fingering --------------------------------------------------
{
  const plain = E.fingerSequence([{ midis: [64] }, { midis: [67] }], STD);
  const again = E.fingerSequence([{ midis: [64] }, { midis: [67] }], STD, {});
  expect(JSON.stringify(plain) === JSON.stringify(again), "no pins: fingerSequence unchanged");
  const pinned = E.fingerSequence([{ midis: [64], pins: { 64: { string: 2, fret: 14 } } }, { midis: [67] }], STD);
  expect(pinned.shapes[0][0].string === 2 && pinned.shapes[0][0].fret === 14, "a pin fixes the note's string/fret (E4 on the D string, 14th fret)");
  expect(pinned.shapes[1][0].fret > 5, "the next note is fingered near the pinned hand (G4 up the neck, not open)");
  const bad = E.fingerSequence([{ midis: [64], pins: { 64: { string: 2, fret: 3 } } }], STD);
  expect(!(bad.shapes[0][0].string === 2 && bad.shapes[0][0].fret === 3), "a pin that doesn't sound its pitch is ignored");
  const chord = E.fingerSequence([{ midis: [52, 59, 64], pins: { 64: { string: 4, fret: 5 } } }], STD).shapes[0];
  expect(chord.find((n) => n.midi === 64).string === 4 && new Set(chord.map((n) => n.string)).size === 3, "a partly pinned chord: the pin holds, the rest on free strings");
  const sc = E.polyNotesToScore([{ midi: 64, startSec: 0, durSec: 0.5, string: 2, fret: 14 }], { bpm: 120 });
  const ev = sc.bars[0].events[0];
  expect(ev.npin && ev.npin[64] && ev.npin[64].string === 2, "polyNotesToScore carries a note's string/fret as npin");
  const f = E.fingerScore(sc);
  expect(f.bars[0].events[0].frets[2] === 14, "fingerScore honours npin");
  const f0 = E.fingerScore(E.polyNotesToScore([{ midi: 64, startSec: 0, durSec: 0.5 }], { bpm: 120 }));
  expect(!f0.bars[0].events[0].npin && f0.bars[0].events[0].frets[5] === 0, "no npin: fingerScore unchanged (open high E)");
}

// ---- scoreTabNotes --------------------------------------------------------------
{
  const sc = tabScore([{ q: 0, string: 2, fret: 14 }, { q: 1, string: 3, fret: 12 }, { q: 4, string: 1, fret: 7 }]);
  const tn = E.scoreTabNotes(sc);
  expect(tn.notes.length === 3 && tn.notes[0].midi === 64 && tn.notes[0].string === 2 && tn.notes[0].fret === 14, "scoreTabNotes: each note's written string and fret");
  expect(tn.notes[2].t === 4 && tn.notes[2].bar === 2 && tn.len === 8, "scoreTabNotes: quarters from the start, bar numbers");
  const rep = { ...sc, bars: sc.bars.map((b, i) => ({ ...b, repeatStart: i === 0, repeatEnd: i === 0 })) };
  expect(E.scoreTabNotes(rep).notes.length === 5, "repeats unrolled exactly as the link (|: bar 1 :| plays twice: 2 + 2 + 1 notes)");
}

// ---- scoreInformedTab ----------------------------------------------------------
{
  // score: E4 on D string fret 14 (q0), G4 G string fret 12 (q1), B4 B string fret 12... (q2), D5 (q3)
  const notes = [{ q: 0, string: 2, fret: 14 }, { q: 1, string: 3, fret: 12 }, { q: 2, string: 4, fret: 12 }, { q: 3, string: 4, fret: 15 }];
  const sc = tabScore(notes, 1);
  const link = fakeLink(4);
  const heard = [{ midi: 64, startSec: 0.02, durSec: 0.4 }, { midi: 67, startSec: 0.51, durSec: 0.4 }, { midi: 74, startSec: 1.53, durSec: 0.4 }, { midi: 60, startSec: 1.75, durSec: 0.2 }];
  const r = E.scoreInformedTab(heard, link, { score: sc }, { follow: "recording", bpm: 120 });
  const by = (m) => r.notes.find((n) => n.midi === m);
  expect(by(64).string === 2 && by(64).fret === 14 && by(64).status === "matched", "matched note takes the score's string (E4 on the D string, 14th fret — not the open high E)");
  expect(by(67).string === 3 && by(74).fret === 15, "every matched note keeps the written fingering");
  expect(by(60).status === "extra" && by(60).string != null, "a heard note the score lacks stays, fingered");
  expect(!r.notes.some((n) => n.midi === 71), "Recording: the missed score note is not written in");
  expect(r.stats.matched === 3 && r.stats.missed === 1 && r.stats.extra === 1 && r.stats.scoreNotes === 4, "stats count matched / missed / extra");
  expect(r.differences.some((d) => d.kind === "missed" && d.midi === 71 && d.bar === 1) && r.differences.some((d) => d.kind === "extra" && d.midi === 60), "differences list the missed and the extra note with their bar");
  expect(r.score && r.score.bars[0].events.some((e) => e.frets && e.frets[2] === 14), "the tab score carries the score's fingering");
  const rs = E.scoreInformedTab(heard, link, { score: sc }, { follow: "score", bpm: 120 });
  expect(rs.notes.some((n) => n.midi === 71 && n.status === "score" && n.string === 4 && n.fret === 12) && !rs.notes.some((n) => n.midi === 60), "Score: the missed note written in with its string; the extra note left out");
  // recovery: a faint onset where the score says B4 should be
  const frames = 300, onset = new Float32Array(frames * 88); onset[Math.round(1.0 * 100) * 88 + (71 - 21)] = 0.15;
  const rb = E.scoreInformedTab(heard, link, { score: sc }, { follow: "balanced", out: { onset }, bpm: 120 });
  const rec = rb.notes.find((n) => n.midi === 71);
  expect(rec && rec.status === "recovered" && Math.abs(rec.startSec - 1.0) < 0.02 && rec.string === 4, "Balanced: a missed score note found again in the model's quieter onsets (at its own time)");
  const rb0 = E.scoreInformedTab(heard, link, { score: sc }, { follow: "balanced", out: { onset: new Float32Array(frames * 88) }, bpm: 120 });
  expect(!rb0.notes.some((n) => n.midi === 71), "no onset evidence → nothing recovered");
  // drift: the record runs 0.15 s late everywhere — the note-level re-alignment still matches
  const late = heard.map((n) => ({ ...n, startSec: n.startSec + 0.15 }));
  expect(E.scoreInformedTab(late, link, { score: sc }, { follow: "recording" }).stats.matched === 3, "a steady 0.15 s offset is absorbed by the note-level re-alignment");
  // the record two semitones up: a capo, same shapes
  const up = heard.map((n) => ({ ...n, midi: n.midi + 2 }));
  const ru = E.scoreInformedTab(up, fakeLink(4, { transpose: 2 }), { score: sc }, { follow: "recording" });
  expect(ru.capo === 2 && ru.notes.find((n) => n.midi === 66).fret === 14 && ru.score.soundingCapo === 2, "recording +2 semitones → capo 2, the score's frets kept");
  // pooled parts: notes from both guitar parts
  const sc2 = tabScore([{ q: 2, string: 4, fret: 12 }], 1);
  const rp = E.scoreInformedTab([...heard, { midi: 71, startSec: 1.0, durSec: 0.3 }], link, [{ score: sc }, { score: sc2 }], { follow: "recording" });
  expect(rp.stats.scoreNotes === 5, "several parts pool their notes");
  expect(E.scoreInformedTab([], link, { score: sc }, {}).notes.length === 0, "nothing heard → empty tab, no throw");
}

// ---- stems × score parts ------------------------------------------------------
{
  expect(E.scorePartRole({ name: "Electric Bass (finger)" }) === "bass" && E.scorePartRole({ name: "Bass Drum" }) !== "bass", "role by name: bass, not bass drum");
  expect(E.scorePartRole({ name: "Drums", drum: true }) === "drums" && E.scorePartRole({ name: "Lead Vocal" }) === "vocals" && E.scorePartRole({ name: "Rhodes" }) === "piano" && E.scorePartRole({ name: "Acoustic Guitar (nylon)" }) === "guitar", "role by name: drums, vocals, keys, guitar");
  expect(E.scorePartRole({ name: "Track 3", score: { tuningMidi: [28, 33, 38, 43] } }) === "bass", "role by tuning: a 4-string at E1 is a bass");
  const ps = [{ name: "Guitar" }, { name: "Piano" }, { name: "Bass" }, { name: "Drums", drum: true }];
  const m = E.matchStemsToParts(["other", "bass", "drums", "vocals"], ps);
  expect(JSON.stringify(m.other) === "[0,1]" && JSON.stringify(m.bass) === "[2]" && JSON.stringify(m.drums) === "[3]" && m.vocals.length === 0, "the separator's other stem ↔ guitar + keys; bass ↔ bass; vocals ↔ none");

  // two bars of a bass line: bar 1 played as written, bar 2 a fourth higher than written
  const bassNotes = [{ q: 0, string: 0, fret: 3 }, { q: 2, string: 0, fret: 5 }, { q: 4, string: 1, fret: 0 }, { q: 6, string: 1, fret: 2 }];
  const BT = [28, 33, 38, 43, null, null];
  const bassSc = tabScore(bassNotes, 2, BT);
  const link = fakeLink(8);
  const heardBass = [{ midi: 31, startSec: 0, durSec: 1 }, { midi: 33, startSec: 1, durSec: 1 }, { midi: 38, startSec: 2, durSec: 1 }, { midi: 40, startSec: 3, durSec: 1 }];
  const drumSc = { source: "gp", timeSig: [4, 4], tempo: 120, tuningMidi: [0, 0, 0, 0, 0, 0], bars: [0, 1].map((b) => ({ number: b + 1, timeSig: [4, 4], events: [0, 1, 2, 3].map((q) => ({ midis: [q % 2 ? 38 : 36, 42], beat: q, qbeat: q, durBeats: 1, qdur: 1 })) })) };
  const hits = []; for (let q = 0; q < 8; q++) { hits.push({ t: q * 0.5, type: q % 2 ? "snare" : "kick" }); hits.push({ t: q * 0.5 + 0.01, type: "hat" }); }
  const compSc = tabScore([{ q: 0, string: 3, fret: 0 }, { q: 0, string: 4, fret: 1 }, { q: 0, string: 5, fret: 0 }, { q: 4, string: 3, fret: 0 }, { q: 4, string: 4, fret: 1 }, { q: 4, string: 5, fret: 0 }], 2);
  const parts = [{ score: compSc, name: "Guitar" }, { score: bassSc, name: "Bass" }, { score: drumSc, name: "Drums", drum: true }];
  const charts = [{ role: "bass", kind: "notes", notes: heardBass.map((n) => ({ ...n, midi: n.startSec >= 2 ? n.midi + 5 : n.midi })) }, { role: "drums", kind: "drums", hits },
    { role: "other", kind: "chords", events: [{ symbol: "C", midis: [55, 60, 64], startSec: 0, durSec: 2 }, { symbol: "F#", midis: [54, 58, 61], startSec: 2, durSec: 2 }] }];
  const res = E.compareStemsToScore({ charts }, 16000, link, parts, {});
  const get = (r) => res.find((x) => x.role === r);
  expect(get("bass").bars[0].agreement > 0.9 && get("bass").bars[1].agreement < 0.2, "bass stem: bar 1 as written agrees, bar 2 (a fourth higher) doesn't");
  expect(get("drums").agreement > 0.9, "drums stem: the written groove agrees");
  expect(get("other").from === "chords" && get("other").bars[0].agreement > 0.9 && get("other").bars[1].agreement < 0.5, "guitar/keys stem from its chord chart: C as written agrees, F# against a written C doesn't");
  expect(get("bass").parts[0] === "Bass" && get("other").parts[0] === "Guitar", "each stem names its score part");
  const res2 = E.compareStemsToScore({ charts: [...charts, { role: "vocals", kind: "notes", notes: [] }] }, 16000, link, parts, {});
  expect(res2.find((x) => x.role === "vocals").note === "no matching part in the score", "a stem with no score part says so");
}

// ---- UI + glue contracts --------------------------------------------------------
{
  const ui = fs.readFileSync(path.join(repo, "TabDecoderPro.tsx"), "utf8");
  const gm = fs.readFileSync(path.join(repo, "guitar-model.js"), "utf8"), gw = fs.readFileSync(path.join(repo, "guitar-worker.js"), "utf8"), gc = fs.readFileSync(path.join(repo, "guitar-model-core.js"), "utf8");
  expect(/scoreInformedTab,/.test(ui) && /compareStemsToScore,/.test(ui) && /scorePartRole,/.test(ui), "the UI imports the score-informed tab and stem comparison");
  expect(/function ScoreTabPanel\(/.test(ui) && /function StemsVsScore\(/.test(ui), "the UI ships the tab-from-score panel and the stems-vs-score readout");
  expect(/keepOnset: true/.test(ui) && /keepOnset/.test(gm) && /keepOnset/.test(gw) && /keepOutputs: !!opts\.keepOnset/.test(gc), "the guitar model can hand back its onset matrix (for recovery)");
  expect(/\[res\.onset\.buffer\]/.test(gw), "the worker transfers the onset matrix (not a copy)");
  expect(/link=\{linked\} linkParts=/.test(ui) && /tracks\.offsetSec/.test(ui), "the stems panel gets the link, and shifts a section split by its offset");
}

console.log(`score-tab: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
