/* Workbench suite — the TTP Audit & work-order roadmap (docs/TTP Audit & work order roadmap.md).
 *
 * Headless, fast (seconds, not minutes), and run by `npm test` after the Path A smoke suite.
 * Every feature here is ADDITIVE: the guard at the top of each block is that the feature, when
 * off / given no input, leaves the engine's output byte-identical.
 *
 * Loads the real engine.tsx (no copy → no drift), exactly like path-a-smoke.mjs. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
globalThis.DOMParser = (await import("@xmldom/xmldom")).DOMParser;
const enginePath = path.join(here, ".engine.workbench.mjs");
fs.writeFileSync(enginePath, fs.readFileSync(path.join(repo, "engine.tsx"), "utf8"));
const eng = await import(enginePath + "?t=" + Date.now());
const uiSrc = fs.readFileSync(path.join(repo, "TabDecoderPro.tsx"), "utf8");
const alphaTab = await import("@coderline/alphatab");

let failures = 0, passes = 0;
const expect = (cond, msg) => { if (cond) passes++; else { failures++; console.error("FAIL:", msg); } };
const J = (x) => JSON.stringify(x);
const section = (name) => console.log(`\n— ${name}`);
const readTex = (tex) => { const imp = new alphaTab.importer.AlphaTexImporter(); imp.initFromString(tex, new alphaTab.Settings()); return imp.readScore(); };
const bytesOf = (f) => new Uint8Array(fs.readFileSync(path.join(repo, f)));

/* ============================================================================
 *  WO-1 — note-level correction: the ScoreEdit layer
 * ========================================================================== */
section("WO-1 ScoreEdit layer");
{
  const gp = await eng.parseGuitarProOrXML(bytesOf("blue-sky.gp"), "blue-sky.gp", true, 1);
  const snap = J(gp);
  // passthrough: no edit / empty edit / foreign junk → the very same object
  expect(eng.applyScoreEdits(gp, null) === gp && eng.applyScoreEdits(gp, eng.emptyScoreEdit()) === gp && eng.applyScoreEdits(gp, { ops: [] }) === gp,
    "no edit → applyScoreEdits returns the input score itself (byte-identical corpus)");

  // ids: positional, unique, deterministic across a re-parse
  const list = eng.scoreNoteList(gp);
  const ids = list.notes.map((n) => n.id);
  expect(ids.length > 500 && new Set(ids).size === ids.length, `every note has a unique id (${ids.length} notes)`);
  const gp2 = await eng.parseGuitarProOrXML(bytesOf("blue-sky.gp"), "blue-sky.gp", true, 1);
  expect(J(eng.scoreNoteList(gp2).notes.map((n) => n.id)) === J(ids), "ids are reproduced exactly by a re-parse (edits survive reload)");
  expect(list.notes.every((n) => n.string == null || list.tuning[n.string] + n.fret === n.midi), "every derived string/fret reconstructs its pitch");
  expect(list.notes.filter((n) => n.string != null).length / list.notes.length > 0.95, "GP notes carry their written string");

  // a real edit: bar 2's first chord — move its top note up a whole step, lock bar 3, add a note
  const b2 = list.notes.filter((n) => n.bar === 2 && n.onTick === list.notes.find((m) => m.bar === 2).onTick);
  const top = b2[b2.length - 1];
  let edit = eng.editPush(null, { t: "note.move", id: top.id, midi: top.midi + 2 });
  const s1 = eng.applyScoreEdits(gp, edit);
  expect(J(gp) === snap, "applyScoreEdits never mutates its input");
  expect(s1 !== gp && s1.bars[0] === gp.bars[0] && s1.bars[5] === gp.bars[5] && s1.bars[1] !== gp.bars[1], "only the edited bar is replaced; every other bar is the same object");
  const e1 = s1.bars[1].events[0];
  expect(e1.midis.includes(top.midi + 2) && !e1.midis.includes(top.midi) && e1.edited, "the moved pitch is in the event, the old one gone");
  expect(e1.symbol === eng.symbolForMidis(e1.midis, true), `the edited chord is re-recognised from its notes (${gp.bars[1].events[0].symbol} → ${e1.symbol})`);
  expect(e1.notes.find((n) => n.id === top.id).midi === top.midi + 2, "the moved note keeps its id");
  const tn = e1.notes.find((n) => n.id === top.id);
  expect(tn.string == null || eng.scoreNoteList(s1).tuning[tn.string] + tn.fret === tn.midi, "a pitch move keeps the string when the new fret is playable, re-deriving the fret");

  // lock: the label survives a later note change, the chart-vocabulary respell, and transposes as text
  const ev3 = list.onsets.find((o) => o.bar === 3);
  edit = eng.editPush(edit, { t: "symbol.lock", bar: 3, onsetTicks: ev3.onTick, symbol: "A7" });
  const n3 = list.notes.find((n) => n.bar === 3 && n.onTick === ev3.onTick);
  edit = eng.editPush(edit, { t: "note.remove", id: n3.id });
  const s2 = eng.applyScoreEdits(gp, edit);
  const e3 = s2.bars[2].events.find((e) => e.locked);
  expect(e3 && e3.symbol === "A7" && e3.reviewed, "a locked chord keeps its symbol when its notes change");
  expect(eng.respellScore(s2, "chart").bars[2].events.find((e) => e.locked).symbol === "A7", "the Pro respell leaves a locked chord alone");
  expect(eng.transposeScore(s2, 2, true).bars[2].events.find((e) => e.locked).symbol === "B7", "transpose moves a locked chord's TEXT (A7 → B7), not a re-name");
  expect(eng.transposeScore(s2, 2, true).bars[1].events[0].notes === undefined, "transpose drops the position-specific note ids");
  expect(eng.transposeSymbol("Bb7/D", 2, true) === "C7/E" && eng.transposeSymbol("F#m7♭5", -1, false) === "Fm7♭5" && eng.transposeSymbol("N.C.", 3) === "N.C.", "transposeSymbol moves root + slash bass");

  // idempotent: replaying the edit over its own output changes nothing
  const add = { t: "note.add", id: "u1", bar: 4, onsetTicks: 240, midi: 64, durTicks: 120 };
  edit = eng.editPush(edit, add);
  const s3 = eng.applyScoreEdits(gp, edit);
  expect(J(eng.applyScoreEdits(s3, edit).bars) === J(s3.bars), "applyScoreEdits is idempotent (re-applying the same edit is a no-op)");
  // the add: a new onset with an explicit length → a rest behind it, the previous onset cut to the new one
  const b4 = s3.bars[3], tpb = 480 * 4 / b4.timeSig[1];
  const added = b4.events.find((e) => e.notes && e.notes.some((n) => n.id === "u1"));
  expect(added && Math.abs(added.qbeat - 240 / tpb) < 1e-9 && Math.abs(added.qdur - 120 / tpb) < 1e-9, "note.add lands at its tick with its explicit length");
  const before = b4.events[b4.events.indexOf(added) - 1];
  expect(!before || Math.abs(before.qbeat + before.qdur - added.qbeat) < 1e-9, "the onset before a new note now ends where it starts (gap-filling)");
  expect(b4.events.every((e, i) => i === 0 || e.beat > b4.events[i - 1].beat || e.beat === b4.timeSig[0] - 1), "the integer chart grid stays strictly increasing");
  expect(s3.editReport && s3.editReport.applied === 4 && s3.editReport.skipped === 0, "editReport counts applied ops");

  // unknown id → skipped, counted, harmless
  const sk = eng.applyScoreEdits(gp, [{ t: "note.remove", id: "n999.0.40" }]);
  expect(sk.editReport.skipped === 1 && J(sk.bars) === J(gp.bars), "an op whose note no longer exists is skipped and reported");

  // undo / redo
  let u = eng.emptyScoreEdit();
  u = eng.editPush(u, { t: "note.remove", id: ids[0] });
  u = eng.editPush(u, [{ t: "note.remove", id: ids[1] }, { t: "note.remove", id: ids[2] }]);
  expect(u.ops.length === 3 && u.groups.length === 2 && eng.isScoreEdit(u), "editPush records one undo step per call");
  const uu = eng.editUndo(u);
  expect(uu.ops.length === 1 && eng.editCanRedo(uu) && !eng.editCanRedo(u), "undo removes the last step as a unit");
  expect(J(eng.editRedo(uu).ops) === J(u.ops) && !eng.editCanRedo(eng.editRedo(uu)), "redo restores it");
  expect(eng.editPush(uu, { t: "note.remove", id: ids[5] }).redo.length === 0, "a new step clears redo");
  expect(!eng.isScoreEdit({ v: 1, ops: [{ t: "rm -rf" }], groups: [1] }) && !eng.isScoreEdit({ v: 2, ops: [], groups: [] }), "isScoreEdit rejects unknown ops and versions (a stale cache can't wedge restore)");
  expect(eng.describeScoreEdit(u) === "3 notes removed", "describeScoreEdit summarises");
  expect(eng.snapTicks(130, "1/16") === 120 && eng.snapTicks(170, "1/8T") === 160 && eng.snapTicks(77, 0) === 77, "snapTicks");
}

{ /* string / tab edits, the AlphaTex round trip (alphaTab re-reads the edited positions) */
  // an audio-style solo: 32 eighth notes from a simple melody, fingered automatically
  const mel = [64, 67, 69, 71, 72, 71, 69, 67, 64, 62, 60, 62, 64, 67, 64, 62];
  const notes = []; for (let i = 0; i < 32; i++) notes.push({ midi: mel[i % mel.length], startSec: i * 0.25, durSec: 0.24 });
  const ml = eng.fingerScore(eng.polyNotesToScore(notes, { bpm: 120, beatsPerBar: 4 }));
  const L = eng.scoreNoteList(ml);
  expect(L.notes.length === 32 && L.notes.every((n) => n.string != null), "an ML tab enters the editor fully fingered");
  // move 5 notes to a different string (same pitch) — the "wrong string" correction
  const tun = L.tuning, picks = [], ops = [];
  for (const n of L.notes) {
    if (picks.length >= 5) break;
    const alt = [0, 1, 2, 3, 4, 5].find((s) => s !== n.string && n.midi - tun[s] >= 0 && n.midi - tun[s] <= 15);
    if (alt == null) continue;
    picks.push({ id: n.id, bar: n.bar, onTick: n.onTick, string: alt, fret: n.midi - tun[alt], midi: n.midi });
    ops.push({ t: "note.string", id: n.id, engIdx: alt, fret: n.midi - tun[alt] });
  }
  const ed = eng.applyScoreEdits(ml, eng.editPush(null, ops));
  const tex = eng.scoreToAlphaTex(ed, { title: "solo" });
  const sc = readTex(tex);
  const st = sc.tracks[0].staves[0];
  let found = 0;
  for (const p of picks) {
    const bar = st.bars[p.bar - 1];
    const hit = bar.voices[0].beats.flatMap((b) => b.notes).find((nt) => nt.fret === p.fret && nt.string === p.string + 1 && nt.realValue === p.midi);
    if (hit) found++;
  }
  expect(found === picks.length && picks.length === 5, `all 5 string corrections survive scoreToAlphaTex → alphaTab (${found}/${picks.length})`);
  // a pitch edit survives the same round trip at the right onset
  const target = L.notes[9];
  const ed2 = eng.applyScoreEdits(ml, [{ t: "note.move", id: target.id, midi: target.midi + 5 }]);
  const st2 = readTex(eng.scoreToAlphaTex(ed2)).tracks[0].staves[0];
  const vals = st2.bars[target.bar - 1].voices[0].beats.flatMap((b) => b.notes.map((nt) => nt.realValue));
  expect(vals.includes(target.midi + 5), "an edited pitch reaches alphaTab");
  // note.dur → a rest appears behind the note in the exported tab
  const ed3 = eng.applyScoreEdits(ml, [{ t: "note.dur", id: L.notes[0].id, durTicks: 60 }]);
  expect(ed3.bars[0].events[0].qdur < 0.2, "note.dur shortens the onset");
  const tex3 = eng.scoreToAlphaTex(ed3);
  expect(/\br\.\d+/.test(tex3.split("\n").find((l) => /\|\s*$/.test(l))), "the shortened note leaves a rest in the tab");
  expect(/<rest\/>/.test(eng.scoreToMusicXML(ed3).split("</measure>")[0]), "…and in MusicXML");
  // technique on an edited note
  const ed4 = eng.applyScoreEdits(ml, [{ t: "note.tech", id: L.notes[2].id, tech: ["bend"], bend: 2 }, { t: "note.tech", id: L.notes[3].id, tech: ["hammer"] }]);
  const st4 = readTex(eng.scoreToAlphaTex(ed4)).tracks[0].staves[0];
  const bnotes = st4.bars[0].voices[0].beats.flatMap((b) => b.notes);
  expect(bnotes.some((n) => n.hasBend) && bnotes.some((n) => n.isHammerPullOrigin), "note.tech writes a bend and a hammer-on into the tab");
  // refinger: strings forgotten → fingerScore decides again
  const rf = eng.applyScoreEdits(ed, [{ t: "chord.refinger", bar: picks[0].bar, onsetTicks: picks[0].onTick }]);
  const rfe = rf.bars[picks[0].bar - 1].events.find((e) => Math.round(e.qbeat * 480) === picks[0].onTick);
  expect(rfe && !rfe.frets && eng.fingerScore(rf).bars[picks[0].bar - 1].events.find((e) => e === rfe || Math.round(e.qbeat * 480) === picks[0].onTick).frets, "chord.refinger clears the strings and the fingering DP refills them");
  // moving a note across bars
  const last = L.notes[L.notes.length - 1];
  const mv = eng.applyScoreEdits(ml, [{ t: "note.move", id: last.id, bar: 1, onsetTicks: 0 }]);
  expect(mv.bars[0].events[0].midis.includes(last.midi) && mv.bars[0].events[0].midis.length === 2 && !mv.bars[last.barIndex].events.some((e) => e.notes && e.notes.some((n) => n.id === last.id)), "a note moved to another bar joins the chord at that onset");

  // latency: a 400-event score, 60 ops, apply + export
  const big = []; for (let i = 0; i < 400; i++) big.push({ midi: 52 + (i * 7) % 20, startSec: i * 0.25, durSec: 0.24 });
  const bigS = eng.fingerScore(eng.polyNotesToScore(big, { bpm: 120 }));
  const BL = eng.scoreNoteList(bigS);
  const bops = []; for (let i = 0; i < 60; i++) { const n = BL.notes[(i * 37) % BL.notes.length]; bops.push(i % 3 ? { t: "note.move", id: n.id, midi: n.midi + 1 } : { t: "note.dur", id: n.id, durTicks: 120 }); }
  const bigEdit = eng.editPush(null, bops);
  eng.applyScoreEdits(bigS, bigEdit);                               // warm
  const t0 = performance.now(); const bigEd = eng.applyScoreEdits(bigS, bigEdit); const tApply = performance.now() - t0;
  const t1 = performance.now(); eng.scoreToAlphaTex(bigEd); const tTex = performance.now() - t1;
  expect(tApply < 150, `edit latency: apply 60 ops to a 400-event score in ${tApply.toFixed(1)} ms (< 150 ms)`);
  console.log(`  latency · apply ${tApply.toFixed(1)} ms · apply→AlphaTex ${(tApply + tTex).toFixed(1)} ms (400 events, 60 ops)`);
}

{ /* spectrogram underlay on the editor grid + the tick↔second map */
  const sr = 16000, bpm = 120;
  // A4 for beat 1, C5 for beat 2 (one bar of 4/4 at 120 bpm = 2 s), audio starts 0.5 s before bar 1
  const pcm = new Float32Array(sr * 3);
  for (let i = 0; i < pcm.length; i++) { const t = i / sr; const f = t >= 0.5 && t < 1.0 ? 440 : t >= 1.0 && t < 1.5 ? 523.25 : 0; pcm[i] = f ? 0.5 * Math.sin(2 * Math.PI * f * t) : 0; }
  const sc = { timeSig: [4, 4], tempo: bpm, audioOffset: 0.5, bars: [{ number: 1, timeSig: [4, 4], events: [{ symbol: "A", midis: [69], qbeat: 0, qdur: 1, beat: 0, durBeats: 1 }, { symbol: "C", midis: [72], qbeat: 1, qdur: 3, beat: 1, durBeats: 3 }] }] };
  const tm = eng.scoreTimeMap(sc, bpm);
  expect(Math.abs(tm.tickToSec(0) - 0.5) < 1e-9 && Math.abs(tm.tickToSec(480) - 1.0) < 1e-9 && Math.abs(tm.secToTick(1.25) - 720) < 1e-6, "scoreTimeMap: bar 1 at audioOffset, 0.5 s per quarter at 120 bpm, invertible");
  const sp = eng.noteRollSpectrogram(pcm, sr, sc, { bpm, minMidi: 48, maxMidi: 84, colTicks: 120 });
  const at = (col, midi) => sp.data[col * sp.rows + (midi - sp.minMidi)];
  const argmax = (col) => { let b = 0; for (let r = 1; r < sp.rows; r++) if (sp.data[col * sp.rows + r] > sp.data[col * sp.rows + b]) b = r; return sp.minMidi + b; };
  expect(sp.cols === 16 && sp.rows === 37, `noteRollSpectrogram: one column per 16th, one row per semitone (${sp.cols}×${sp.rows})`);
  expect(argmax(1) === 69 && argmax(5) === 72 && at(1, 69) > 0.6 && at(12, 69) < 0.1, `the A4 sits under beat 1 and the C5 under beat 2 (peaks ${argmax(1)}, ${argmax(5)})`);
}

{ /* UI contracts for the note editor */
  expect(/function NoteEditorView\(/.test(uiSrc), "UI ships NoteEditorView");
  expect(/applyScoreEdits\(/.test(uiSrc) && /\["edit", "Notes"\]/.test(uiSrc), "ChartPanel applies the score edit and offers a Notes view");
  expect(/scoreEdit/.test(uiSrc) && /isScoreEdit\(meta\.scoreEdit\)/.test(uiSrc), "the score edit is persisted in the session meta and validated on restore");
  expect(/editUndo\(/.test(uiSrc) && /editRedo\(/.test(uiSrc), "the editor has undo/redo");
}

/* ============================================================================
 *  WO-2 — practice & real-time coach
 * ========================================================================== */
section("WO-2 practice");
{
  const cents = (f, ref) => 1200 * Math.log2(f / ref);
  const tone = (f, sec, sr, a = 0.5) => { const x = new Float32Array(Math.round(sec * sr)); for (let i = 0; i < x.length; i++) x[i] = a * Math.sin(2 * Math.PI * f * i / sr); return x; };
  const pitchAt = (x, sr) => { const mid = x.subarray(Math.floor(x.length / 2) - 2048, Math.floor(x.length / 2) + 2048); return eng.detectPitch(mid, sr).freq; };
  // WSOLA: 1 s of A4 at 0.6× → 1.667 s, still A4
  const sr = 44100, a4 = tone(440, 1, sr);
  const slow = eng.timeStretch(a4, sr, 0.6);
  expect(Math.abs(slow.length / sr - 1 / 0.6) < 0.01, `0.6× stretch: 1 s → ${(slow.length / sr).toFixed(3)} s (1.667)`);
  const fs = pitchAt(slow, sr);
  expect(Math.abs(cents(fs, 440)) <= 5, `0.6× keeps the pitch: ${fs.toFixed(2)} Hz (${cents(fs, 440).toFixed(2)}¢, ±5¢)`);
  const fast = eng.timeStretch(a4, sr, 1.25);
  expect(Math.abs(fast.length / sr - 0.8) < 0.01 && Math.abs(cents(pitchAt(fast, sr), 440)) <= 5, "1.25× shortens to 0.8 s at the same pitch");
  // pitch shift +2 semitones at the original speed → B4, same length
  const up = eng.timeStretch(a4, sr, 1, { pitchSemitones: 2 }), fu = pitchAt(up, sr), want = 440 * Math.pow(2, 2 / 12);
  expect(Math.abs(up.length - a4.length) <= 1 && Math.abs(cents(fu, want)) <= 5, `+2 st pitch shift: ${fu.toFixed(2)} Hz vs ${want.toFixed(2)} (${cents(fu, want).toFixed(2)}¢), length kept`);
  const both = eng.timeStretch(a4, sr, 0.75, { pitchSemitones: -3 }), fb = pitchAt(both, sr), wb = 440 * Math.pow(2, -3 / 12);
  expect(Math.abs(both.length / sr - 1 / 0.75) < 0.01 && Math.abs(cents(fb, wb)) <= 5, `0.75× and −3 st together (${cents(fb, wb).toFixed(2)}¢)`);
  // a stereo "music" loop (C-major triad + a little noise, panned) at 0.5×: no pitch change, channels stay aligned
  const L = new Float32Array(sr * 2), R = new Float32Array(sr * 2); let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  for (let i = 0; i < L.length; i++) { const t = i / sr, ch = 0.3 * (Math.sin(2 * Math.PI * 261.63 * t) + Math.sin(2 * Math.PI * 329.63 * t) + Math.sin(2 * Math.PI * 392 * t)) / 3; L[i] = ch + 0.02 * rnd(); R[i] = 0.7 * ch + 0.02 * rnd(); }
  const [sl, srr] = eng.timeStretchChannels([L, R], sr, 0.5);
  const chOf = (x) => eng.pcmToChroma(x.subarray(sr, sr + 8192), sr);
  const cs = chOf(sl);
  expect(sl.length === srr.length && Math.abs(sl.length / sr - 4) < 0.02 && cs[0] > 0.6 && cs[4] > 0.4 && cs[7] > 0.4 && Math.max(cs[1], cs[3], cs[6], cs[10]) < 0.3, "stereo 0.5×: both channels 4 s, the chord's pitch classes unchanged");
  expect(eng.timeStretch(a4, sr, 1) !== a4 && eng.timeStretch(a4, sr, 1).length === a4.length, "rate 1 = an untouched copy");

  // loop + count-in on a fixed-tempo chart: 2 bars at 100 bpm
  const chart = { timeSig: [4, 4], tempo: 100, bars: [1, 2, 3, 4].map((n) => ({ number: n, timeSig: [4, 4], events: [{ symbol: "C", midis: [60, 64, 67], beat: 0, durBeats: 4, qbeat: 0, qdur: 4 }] })) };
  const reg = eng.loopRegion(chart, { startBar: 2, endBar: 3, bpm: 100 });
  expect(Math.abs(reg.startSec - 2.4) < 1e-9 && Math.abs(reg.endSec - 7.2) < 1e-9, `loop bars 2–3 at 100 bpm: ${reg.startSec}–${reg.endSec} s`);
  const clicks = eng.clickTimes(reg, { countInBars: 1 });
  const ci = clicks.filter((c) => c.countIn), main = clicks.filter((c) => !c.countIn);
  expect(ci.length === 4 && Math.abs(ci[0].t + 2.4) < 1e-9 && Math.abs(ci[3].t + 0.6) < 1e-9 && ci[0].accent === 2, "count-in is exactly one bar (4 clicks, −2.4 … −0.6 s, downbeat accented)");
  expect(main.length === 8 && main.every((c, i) => Math.abs(c.t - i * 0.6) < 0.01) && main[4].accent === 2, "the loop's clicks sit on the beat grid within ±10 ms");
  const r68 = eng.loopRegion({ ...chart, bars: [{ number: 1, timeSig: [6, 8], events: [] }] }, { bpm: 120 });
  expect(eng.clickTimes(r68).map((c) => c.accent).join("") === "200100", "6/8 clicks accent beats 1 and 4");
  // a tempo-mapped audio chart: the loop follows the recording's clock
  const aud = eng.audioEventsToScore([{ symbol: "C", midis: [60, 64, 67], startSec: 1.0, durSec: 2.2 }, { symbol: "G", midis: [55, 59, 62], startSec: 3.2, durSec: 2.2 }], { timeline: { times: [1.0, 1.5, 2.1, 2.6, 3.2, 3.7, 4.3, 4.8, 5.4], positions: [0, 1, 2, 3, 4, 5, 6, 7, 8] } });
  const ra = eng.loopRegion(aud, { startBar: 2, endBar: 2 });
  expect(Math.abs(ra.startSec - 3.2) < 0.02 && Math.abs(ra.endSec - 5.4) < 0.05, `an audio chart's loop lands on the recording's bar lines (${ra.startSec.toFixed(2)}–${ra.endSec.toFixed(2)} s)`);
  const wav = eng.clickTrackWav(chart, { bpm: 100, sampleRate: 22050 });
  expect(wav && String.fromCharCode(...wav.subarray(0, 4)) === "RIFF" && wav.length > 44 + 22050 * 2 * 9, "clickTrackWav writes a WAV of the whole chart");
  const syn = eng.renderScorePcm(chart, { startBar: 1, endBar: 1, bpm: 100, sampleRate: 16000 });
  const sch = eng.pcmToChroma(syn.subarray(4000, 8096), 16000);
  expect(Math.abs(syn.length / 16000 - 2.7) < 0.05 && sch[0] > 0.5 && sch[4] > 0.4 && sch[7] > 0.3 && sch[2] < 0.2, "renderScorePcm synthesises the chart's chord");
  expect(eng.renderScorePcm(chart, { startBar: 1, endBar: 1, bpm: 100, sampleRate: 16000, transpose: 2 }).length === syn.length, "renderScorePcm transposes without changing length");
}

{ /* live chord tracker: 16 bars of C–G–Am–F, 100–140 bpm, strummed */
  const sr = 16000, prog = [[48, 52, 55, 60, 64], [43, 47, 50, 55, 59], [45, 52, 57, 60, 64], [41, 48, 53, 57, 60]], names = ["C", "G", "Am", "F"];
  for (const bpm of [100, 140]) {
    const bar = (60 / bpm) * 4, total = 16 * bar + 1, x = new Float32Array(Math.round(total * sr));
    for (let b = 0; b < 16; b++) for (let k = 0; k < 4; k++) {
      const t0 = b * bar + (k * bar) / 4;
      for (const m of prog[b % 4]) {
        const f = 440 * Math.pow(2, (m - 69) / 12), i0 = Math.round(t0 * sr), n = Math.round((bar / 4) * sr);
        for (let i = 0; i < n && i0 + i < x.length; i++) { const t = i / sr, e = Math.exp(-t * 3); x[i0 + i] += 0.08 * e * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(4 * Math.PI * f * t) + 0.25 * Math.sin(6 * Math.PI * f * t)); }
      }
    }
    const tr = eng.createLiveChordTracker({ vocabulary: "chart" }), hop = 0.05, N = 4096, labels = [];
    for (let t = N / sr; t < total; t += hop) {
      const end = Math.round(t * sr), fr = x.subarray(end - N, end);
      let e = 0; for (let i = 0; i < fr.length; i++) e += fr[i] * fr[i];
      const out = tr.push(eng.pcmToChroma(fr, sr), t, Math.sqrt(e / N));
      labels.push({ t, symbol: out.symbol });
    }
    const at = (sec) => labels.reduce((a, l) => (l.t <= sec ? l : a), labels[0]).symbol;
    const right = Array.from({ length: 16 }, (_, b) => at(b * bar + bar * 0.75) === names[b % 4]).filter(Boolean).length;
    const changes = tr.history.filter((h) => h.symbol).length;
    const lat = tr.history.filter((h) => h.symbol).map((h) => { const b = Math.round(h.startSec / bar); return h.startSec - b * bar; }).filter((d) => d >= 0 && d < bar / 2).sort((a, b) => a - b);
    const medLat = lat[lat.length >> 1];
    expect(right === 16, `live tracker at ${bpm} bpm: ${right}/16 bars labelled right`);
    expect(changes <= 17, `live tracker at ${bpm} bpm: ${changes} chord changes for 16 bars (≤ 1 spurious)`);
    expect(medLat <= 0.3, `live tracker at ${bpm} bpm: median latency ${(medLat * 1000).toFixed(0)} ms (≤ 300)`);
  }
  // noise → no chord; silence → no chord
  const tr = eng.createLiveChordTracker();
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  let last = null;
  for (let k = 0; k < 40; k++) { const fr = new Float32Array(4096); for (let i = 0; i < fr.length; i++) fr[i] = 0.3 * rnd(); last = tr.push(eng.pcmToChroma(fr, 16000), k * 0.05, 0.08); }
  expect(last.symbol === null, `white noise reads as no chord (got ${last.symbol})`);
  const tr2 = eng.createLiveChordTracker(); let s2 = null; for (let k = 0; k < 10; k++) s2 = tr2.push(new Array(12).fill(0), k * 0.05, 0);
  expect(s2.symbol === null, "silence reads as no chord");
}

{ /* practiceCompare */
  const scale = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60, 62, 64, 65, 67, 69];
  const exp = scale.map((m, i) => ({ startSec: i * 0.5, durSec: 0.5, midis: [m] }));
  const heard = { notes: scale.map((m, i) => ({ midi: i === 4 || i === 13 ? m + 1 : m, startSec: i * 0.5 + (i % 3 ? 0.03 : -0.04), durSec: 0.45 })) };
  const r = eng.practiceCompare(exp, heard);
  expect(r.hits === 18 && r.misses === 2 && r.extras === 2 && r.wrongPitch === 2, `scale with 10% wrong notes: ${r.hits} hits, ${r.misses} misses, ${r.extras} extras, ${r.wrongPitch} wrong pitch`);
  expect(Math.abs(r.meanOffsetMs - ((11 * 30 - 7 * 40) / 18)) < 0.5 && r.score === 90, `timing offset ${r.meanOffsetMs.toFixed(1)} ms, score ${r.score}`);
  const late = eng.practiceCompare(exp, { notes: scale.map((m, i) => ({ midi: m, startSec: i * 0.5 + 0.35, durSec: 0.4 })) });
  expect(late.hits === 0 && late.misses === 20, "notes outside the timing window are misses");
  expect(eng.practiceCompare(exp, { notes: scale.map((m, i) => ({ midi: m + 12, startSec: i * 0.5, durSec: 0.4 })) }, { octave: true }).hits === 20, "octave-tolerant mode accepts the octave");
  // end to end: synthesise the expected line, transcribe it with YIN, score it
  const line = { timeSig: [4, 4], tempo: 120, bars: [0, 1].map((b) => ({ number: b + 1, timeSig: [4, 4], events: [0, 1, 2, 3].map((k) => ({ symbol: "", midis: [scale[b * 4 + k]], beat: k, durBeats: 1, qbeat: k, qdur: 1 })) })) };
  const pcm = eng.renderScorePcm(line, { bpm: 120, sampleRate: 16000 });
  const tx = eng.transcribeMonophonic(pcm, 16000, { minClarity: 0.6 });
  const tg = eng.practiceTargets(line, eng.loopRegion(line, { bpm: 120 }), 120);
  const e2e = eng.practiceCompare(tg, { notes: tx }, { tolSec: 0.15 });
  expect(tg.length === 8 && e2e.hits >= 7, `synthesised line → YIN → practiceCompare: ${e2e.hits}/8 hits`);
  // chords mode
  const cExp = [{ startSec: 0, durSec: 1, midis: [60, 64, 67] }, { startSec: 1, durSec: 1, midis: [55, 59, 62] }];
  const frames = []; for (let t = 0; t < 2; t += 0.1) { const c = new Array(12).fill(0); (t < 1 ? [0, 4, 7] : [9, 0, 4]).forEach((p) => (c[p] = 1)); frames.push({ t, chroma: c }); }
  const rc = eng.practiceCompare(cExp, { frames });
  expect(rc.mode === "chords" && rc.hits === 1 && rc.misses === 1, "chords mode: the C matches, an Am played over the G does not");
}

{ /* WO-2 UI contracts */
  expect(/function PracticePlayer\(/.test(uiSrc) && /timeStretchChannels/.test(uiSrc) && /clickTimes\(/.test(uiSrc) && /loop = true/.test(uiSrc), "UI ships a PracticePlayer (stretch, clicks, seamless loop)");
  expect(/function LiveChords\(/.test(uiSrc) && /createLiveChordTracker\(/.test(uiSrc) && /\["live", "Live chords/.test(uiSrc), "UI ships a Live chords mode on the tracker");
  expect(/function WaitForMe\(/.test(uiSrc) && /practiceTargets\(/.test(uiSrc), "UI ships the wait-for-me coach on the loop's targets");
  expect(/clickTrackWav\(/.test(uiSrc), "UI exports a click-track WAV");
}

/* ============================================================================
 *  WO-3 — lyric alignment + chords-over-lyrics
 * ========================================================================== */
section("WO-3 lyrics");
{
  const syl = (s) => eng.countSyllables(s);
  expect(syl("Hello world") === 3 && syl("beautiful") === 3 && syl("the fire") === 2 && syl("corazón") === 3 && syl("さくら") === 3 && syl("") === 0,
    `syllable heuristic (Hello world ${syl("Hello world")}, beautiful ${syl("beautiful")}, the fire ${syl("the fire")}, corazón ${syl("corazón")}, さくら ${syl("さくら")})`);
  // a synthetic "sung" stem: each syllable a 0.28 s vibrato tone, 30 ms between syllables, a breath
  // between lines — except lines 2+3, sung in one breath (a phrase shared by two lines)
  const text = "[Verse 1]\nI walked along the river\nThe water running slow\nAnd every stone I counted\nWas a place I used to know\n\n[Chorus]\nCarry me home\nCarry me home tonight\n";
  const parsed = eng.parseLyrics(text);
  const lines = eng.lyricLines(parsed);
  const sr = 16000, x = new Float32Array(sr * 26), truth = [];
  let t = 1.0;
  lines.forEach((l, i) => {
    truth.push(t);
    for (let k = 0; k < l.syllables; k++) {
      const f = 220 * Math.pow(2, ((i * 3 + k * 2) % 12) / 12), i0 = Math.round(t * sr), n = Math.round(0.28 * sr);
      for (let j = 0; j < n; j++) { const tt = j / sr, env = Math.min(1, tt / 0.03, (0.28 - tt) / 0.03); x[i0 + j] += 0.3 * env * Math.sin(2 * Math.PI * f * tt + 0.6 * Math.sin(2 * Math.PI * 5.5 * tt)); }
      t += 0.31;
    }
    t += i === 1 ? 0.05 : 0.7;                                      // line 2 → 3 without a breath
  });
  let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  for (let i = 0; i < x.length; i++) x[i] += 0.001 * rnd();
  const ph = eng.voicedPhrases(x, sr);
  expect(ph.length === lines.length - 1 && Math.abs(ph[0].startSec - 1.0) < 0.06, `voicedPhrases finds the sung phrases (${ph.length} for ${lines.length} lines, one shared; first at ${ph[0] && ph[0].startSec}s)`);
  const chart = { timeSig: [4, 4], tempo: 120, bars: Array.from({ length: 13 }, (_, b) => ({ number: b + 1, timeSig: [4, 4], section: b === 0 ? "Verse 1" : b === 8 ? "Chorus" : undefined, events: [{ symbol: ["C", "G", "Am", "F"][b % 4], midis: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]][b % 4], beat: 0, durBeats: 4, qbeat: 0, qdur: 4 }] })) };
  const map = eng.alignLyrics(parsed, chart, { samples: x, sampleRate: sr }, { bpm: 120, useSections: false });
  const errs = map.lines.map((l, i) => Math.abs(l.startSec - truth[i])).sort((a, b) => a - b), med = errs[errs.length >> 1];
  expect(map.source === "vocal" && map.lines.length === lines.length && med <= 0.5, `alignLyrics: median line-start error ${med.toFixed(2)} s (≤ 0.5 s = 1 beat at 120), worst ${errs[errs.length - 1].toFixed(2)} s`);
  expect(map.lines.every((l, i) => i === 0 || l.startSec > map.lines[i - 1].startSec) && map.lines.every((l) => l.endSec > l.startSec), "line times are strictly increasing with positive lengths");
  expect(map.lines.every((l) => l.startBar >= 1 && l.startBeat >= 1 && l.startBeat <= 4), "every line knows its bar and beat");
  expect(Math.abs(map.lines[2].startSec - truth[2]) < 1.2, `a line sung in the same breath as the one before still lands near its start (${map.lines[2].startSec.toFixed(2)} vs ${truth[2].toFixed(2)})`);
  // no recording → the chart's bars, low confidence
  const g = eng.alignLyrics(parsed, chart, null, { bpm: 120 });
  expect(g.source === "grid" && g.confidence < 0.4 && g.lines.every((l, i) => i === 0 || l.startSec > g.lines[i - 1].startSec), "no recording: lines spread over the chart, monotonic, low confidence");
  const gs = eng.alignLyrics(parsed, chart, null, { bpm: 120, snapBeats: true });
  expect(gs.lines.find((l) => l.section === "Chorus").startBar === 9, `section anchors: the sheet's Chorus starts on the chart's Chorus bar (${gs.lines.find((l) => l.section === "Chorus").startBar})`);
  // nudge
  const nd = eng.nudgeLyricLine(map, 1, 0.5);
  expect(Math.abs(nd.lines[1].startSec - map.lines[1].startSec - 0.5) < 1e-6 && nd.lines[0].endSec <= nd.lines[1].startSec && nd.lines[1].manual && map.lines[1].manual === undefined, "nudgeLyricLine moves one line, keeps order, doesn't mutate");
  const nb = eng.nudgeLyricLine(map, 1, 2.0, chart, 120);
  expect(nb.lines[1].startBar === Math.floor(nb.lines[1].startSec / 2) + 1, "nudgeLyricLine refreshes the bar/beat when given the chart");
  expect(eng.lyricLineAt(map, map.lines[3].startSec + 0.1) === 3 && eng.lyricLineAt(map, 0) === -1, "lyricLineAt");
  // LRC
  const lrc = eng.lyricsToLRC(map, { title: "River", artist: "Test" });
  const stamps = lrc.split("\n").map((l) => l.match(/^\[(\d\d):(\d\d\.\d\d)\](.*)$/)).filter(Boolean);
  expect(/^\[ti:River\]$/m.test(lrc) && /^\[ar:Test\]$/m.test(lrc) && stamps.length === lines.length && stamps.every((m, i) => m[3] === lines[i].text && (i === 0 || +m[1] * 60 + +m[2] >= +stamps[i - 1][1] * 60 + +stamps[i - 1][2])), "LRC: ti/ar tags, one increasing [mm:ss.xx] stamp per line, texts intact");
  // ChordPro with inline chords → round-trips through parseLyrics
  const cp = eng.scoreToChordProWithLyrics(chart, map, { title: "River", bpm: 120 });
  const back = eng.lyricLines(eng.parseLyrics(cp));
  expect(J(back.map((l) => l.text)) === J(lines.map((l) => l.text)) && J(back.map((l) => l.section)) === J(lines.map((l) => l.section)), "ChordPro with inline chords round-trips through parseLyrics (same lines + sections)");
  expect(/\{start_of_verse: Verse 1\}/.test(cp) && /\{start_of_chorus: Chorus\}/.test(cp) && /^\[C\]I walked/m.test(cp) && (cp.match(/\[[A-G][#b]?m?\]/g) || []).length >= 8, "ChordPro: verse/chorus environments, the chord at each line start, chords inline");
  // chords-over-lyrics sheet
  const sheet = eng.scoreToLyricsSheet(chart, map);
  const sl = sheet.split("\n"), li = sl.indexOf(sl.find((l) => /I walked along/.test(l)));
  expect(/^\[Verse 1\]$/m.test(sheet) && /^\[Chorus\]$/m.test(sheet) && /^C\b/.test(sl[li - 1]) && eng.isChordLine(sl[li - 1]), "sheet: section headers, a chord line above each lyric line");
  expect(J(eng.lyricLines(eng.parseLyrics(sheet)).map((l) => l.text.replace(/\s+/g, " "))) === J(lines.map((l) => l.text)), "the chords-over-lyrics sheet parses back to the same lyrics");
  // collisions: two chords a syllable apart are pushed apart, not overprinted
  const tight = { lines: [{ text: "Go now", section: null, stanza: 0, startSec: 0, endSec: 1 }] };
  const tsc = { timeSig: [4, 4], tempo: 120, bars: [{ number: 1, timeSig: [4, 4], events: [{ symbol: "Cmaj7", midis: [60, 64, 67, 71], beat: 0, qbeat: 0, durBeats: 1, qdur: 1 }, { symbol: "Dm7", midis: [62, 65, 69, 72], beat: 1, qbeat: 1, durBeats: 3, qdur: 3 }] }] };
  const ts = eng.scoreToLyricsSheet(tsc, tight).trim().split("\n");
  expect(ts[0] === "Cmaj7 Dm7" && ts[1].startsWith("Go") && ts[1].indexOf("now") === 6, `collision padding: ${J(ts)}`);
  const last = sheet.trim().split("\n").slice(-3);
  expect(/tonight$/.test(last[0]) && last[1] === "" && eng.isChordLine(last[2]), `chords after the last line go on their own line, not piled onto it (${J(last)})`);
  expect(!/[ \t]$/m.test(sheet), "no trailing spaces in the sheet");
}

{ /* WO-3 UI contracts */
  expect(/function LyricsSheetView\(/.test(uiSrc) && /\["lyrics", "Lyrics"\]/.test(uiSrc) && /alignLyrics/.test(uiSrc), "ChartPanel has a Lyrics view that aligns lyrics");
  expect(/lyricsToLRC\(/.test(uiSrc) && /scoreToChordProWithLyrics\(/.test(uiSrc) && /scoreToLyricsSheet\(/.test(uiSrc), "LRC / ChordPro-with-lyrics / chords-over-lyrics exports are wired");
  expect(/timing: \{ v: 1, lines:/.test(uiSrc) && /csm:lyrics:v1/.test(uiSrc), "the Perform Lyrics handoff carries optional line timing");
}

/* ============================================================================
 *  WO-4 — instrument voicings + arrangement levels
 * ========================================================================== */
section("WO-4 instruments");
{
  const sufs = eng.QUALITIES.map((q) => q.suffix);
  const pcSet = (sym) => { const p = eng.parseChordSymbolForVoicings(sym); return { p, pcs: new Set(p.formula.tones.map((t) => (p.rootPc + t.semi) % 12)) }; };
  for (const id of ["ukulele", "mandolin", "baritone", "bass4"]) {
    const inst = eng.INSTRUMENTS[id], short = [], bad = [];
    for (const root of ["C", "F#", "Bb"]) for (const suf of sufs) {
      const sym = root + suf, r = eng.voicingsForInstrument(sym, id);
      if (!r.ok) { bad.push(`${sym}:parse`); continue; }
      const { p, pcs } = pcSet(sym), all = r.groups.flatMap((g) => g.voicings);
      // dim7 is symmetric: on 4 strings it is one grip moved every 3 frets — 5 fit in 15 frets
      if (all.length < (suf === "dim7" && id === "baritone" ? 5 : 6)) short.push(`${sym}=${all.length}`);
      for (const v of all) {
        const fr = v.frets.filter((f) => f > 0), sp = fr.length ? Math.max(...fr) - Math.min(...fr) + 1 : 0;
        const ok = v.midi.every((m) => pcs.has(m % 12)) && sp <= inst.maxSpan + (v.stretch ? 1 : 0) && v.fingers.every((f) => f <= 4) && v.frets.length === inst.strings.length
          && v.frets.every((f, s) => f < 0 || inst.strings[s] + f === v.midi.find((m) => m === inst.strings[s] + f));
        if (!ok) { bad.push(`${sym}:${v.frets.join(",")}`); break; }
      }
    }
    expect(!short.length, `${inst.name}: every quality × C/F#/Bb has ≥ 6 playable shapes (short: ${short.slice(0, 8).join(" ")})`);
    expect(!bad.length, `${inst.name}: every shape sounds only chord tones, within the hand span (+1 fret where marked stretch), ≤ 4 fingers (bad: ${bad.slice(0, 5).join(" ")})`);
  }
  const uk = eng.voicingsForInstrument("C", "ukulele").groups[0].voicings.map((v) => v.frets.join(""));
  const md = eng.voicingsForInstrument("G", "mandolin").groups[0].voicings.map((v) => v.frets.join(""));
  const uf = eng.voicingsForInstrument("F", "ukulele").groups[0].voicings.map((v) => v.frets.join(""));
  expect(uk[0] === "0003" && uf.includes("2010") && md.includes("0023"), `the textbook shapes come first: uke C ${uk[0]}, uke F has 2010, mandolin G has 0023`);
  const b7 = eng.voicingsForInstrument("C7", "bass4").groups.flatMap((g) => g.voicings);
  expect(b7.every((v) => v.midi.length >= 2 && v.midi.length <= 3 && v.midi[0] % 12 === 0), "bass: double-stops with the root lowest");
  const capo = eng.voicingsForInstrument("D", "ukulele", { capo: 2 }).groups[0].voicings[0];
  expect(capo.frets.join("") === "0003" && capo.capo === 2, `capo 2 on a uke: D is the C shape (${capo.frets.join("")})`);
  const slash = eng.voicingsForInstrument("C/E", "mandolin").groups.flatMap((g) => g.voicings);
  expect(slash.length && slash.every((v) => v.midi[0] % 12 === 4), "a slash chord's bass is the lowest note on a non-re-entrant instrument");
  // piano
  const shortP = [], badP = [];
  for (const suf of sufs) {
    const sym = "C" + suf, r = eng.voicingsForInstrument(sym, "piano"), { p, pcs } = pcSet(sym), all = r.groups.flatMap((g) => g.voicings);
    if (all.length < 6) shortP.push(`${sym}=${all.length}`);
    for (const v of all) {
      const hl = v.hands.left, hr = v.hands.right;
      const ok = v.midi.every((m) => pcs.has(m % 12)) && (!hl.length || hl[hl.length - 1] - hl[0] <= 14) && (!hr.length || hr[hr.length - 1] - hr[0] <= 14);
      if (!ok) { badP.push(`${sym}:${v.label}`); break; }
    }
    const rp = all.find((v) => v.label === "root position");
    if (rp && !p.formula.required.filter((x) => x !== 7).every((x) => rp.midi.some((m) => (m - p.rootPc - x) % 12 === 0)) && !all.some((v) => p.formula.required.every((x) => v.midi.some((m) => ((m - p.rootPc - x) % 12 + 12) % 12 === 0)))) badP.push(`${sym}:required`);
  }
  expect(!shortP.length, `piano: every quality has ≥ 6 voicings (short: ${shortP.join(" ")})`);
  expect(!badP.length, `piano: every voicing is chord tones, each hand within a 9th (bad: ${badP.slice(0, 5).join(" ")})`);
  const g7 = eng.voicingsForInstrument("G7", "piano", { previous: [60, 64, 67] }).groups.flatMap((g) => g.voicings);
  const dists = g7.map((v) => eng.voiceLeadingDistance([60, 64, 67], v.midi));
  const g7c = eng.voicingsForInstrument("G7", "piano", { previous: [60, 64, 67] }).groups[0].voicings;
  expect(g7c.every((v, i) => i === 0 || v.distance >= g7c[i - 1].distance) && Math.min(...dists) <= 4, `piano voicings rank by voice-leading from the previous chord (best ${Math.min(...dists)} semitones from C)`);
  expect(eng.voiceLeadingDistance([60, 64, 67], [59, 65, 67]) === 2, "voiceLeadingDistance (C → G7 shell: B, F move one step each)");
  // left-handed diagram mirrors the strings
  const v = eng.voicingsForInstrument("C", "ukulele").groups[0].voicings[0];
  const rh = eng.voicingToSVGuitar(v), lh = eng.voicingToSVGuitar(v, "fingers", { leftHanded: true });
  expect(rh.fingers.find((f) => f[1] === 3)[0] === 1 && lh.fingers.find((f) => f[1] === 3)[0] === 4, "left-handed diagrams mirror the strings");
  expect(J(eng.assignChordFingers([-1, 3, 2, 0, 1, 0])) === J({ fingers: [0, 3, 2, 0, 1, 0], barres: [] }), "the 6-string finger model is unchanged");
}

{ /* arrangement levels */
  const gp = await eng.parseGuitarProOrXML(bytesOf("blue-sky.gp"), "blue-sky.gp", true, 1);
  const snap = J(gp);
  const beg = eng.arrangementLevels(gp, "beginner");
  const syms = new Set(beg.score.bars.flatMap((b) => b.events.map((e) => e.symbol)));
  expect(J(gp) === snap, "arrangementLevels never mutates its source");
  expect([...syms].every((s) => /^[A-G][#b]?m?$/.test(s) || s === "—"), `beginner: plain triads only (${[...syms].join(" ")})`);
  expect(beg.score.bars.every((b) => b.events.every((e) => Math.abs((e.qdur ?? e.durBeats) - 1) < 1e-6)), "beginner: quarter-note strums");
  expect(beg.transposedBy === 0 && beg.capo === 0, "beginner: Blue Sky (E) is already an open-chord key");
  const again = eng.arrangementLevels(beg.score, "beginner");
  expect(J(again.score.bars.map((b) => b.events.map((e) => e.symbol))) === J(beg.score.bars.map((b) => b.events.map((e) => e.symbol))), "re-applying a level is stable (idempotent)");
  const bb = eng.transposeScore(gp, 6, true);                          // E → Bb: a barre-chord key
  const begBb = eng.arrangementLevels(bb, "beginner");
  const anth = await eng.parseGuitarProOrXML(bytesOf("Charlie Parker - Anthropology.gp5"), "a.gp5", true, 0);
  const ba = eng.arrangementLevels(anth, "beginner");
  expect(ba.transposedBy === -1 && ba.capo === 1 && Object.is(eng.arrangementLevels(gp, "beginner").transposedBy, 0), `beginner reads the key of the chart as written (Anthropology's melody: B♭ → A shapes, capo 1; got ${ba.transposedBy})`);
  expect(begBb.transposedBy === -1 && begBb.capo === 1, `beginner: Bb moves to A shapes with capo 1 (t ${begBb.transposedBy}, capo ${begBb.capo})`);
  const mid = eng.arrangementLevels(gp, "intermediate");
  const ms = new Set(mid.score.bars.flatMap((b) => b.events.map((e) => e.symbol)));
  expect([...ms].every((s) => !/(9|11|13|6\/9)/.test(s)), `intermediate: 7ths, no extensions (${[...ms].slice(0, 10).join(" ")})`);
  expect(mid.score.bars[2].events.length === 4, "intermediate: straight eighths (2/4 bar → 4 hits)");
  expect(eng.arrangementLevels(gp, "advanced").score === gp, "advanced: the chart as written (same object)");
  expect(/^- Chart|^- /m.test(eng.scoreToCSMPN(beg.score, { title: "x" })) && eng.scoreToMidi(mid.score).length > 100, "levels export (CSMPN, MIDI)");
}

{ /* WO-4 UI contracts */
  expect(/INSTRUMENT_ORDER/.test(uiSrc) && /voicingsForInstrument\(/.test(uiSrc) && /function KeyboardDiagram\(/.test(uiSrc), "the voicing modal has an instrument picker and a keyboard view");
  expect(/leftHanded/.test(uiSrc) && /ttp:leftHanded/.test(uiSrc), "left-handed diagrams are a remembered toggle");
  expect(/arrangementLevels\(/.test(uiSrc) && /ARRANGEMENT_LEVELS/.test(uiSrc), "ChartPanel has arrangement level chips");
}

/* ============================================================================
 *  WO-5 — drum + piano notation, all-parts deliverables
 * ========================================================================== */
section("WO-5 drums + piano");
function renderKit(sr, seed = 5) {
  let s = seed; const R = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const bpm = 100, spb = 60 / bpm, bars = 8, x = new Float32Array(Math.round((bars * 4 * spb + 2.5) * sr)), truth = [];
  const add = (t, type, fn, dur) => { truth.push({ t, type }); const i0 = Math.round(t * sr); let hp = 0, prev = 0; for (let i = 0; i < dur * sr && i0 + i < x.length; i++) { const w = R(); hp = 0.85 * (hp + w - prev); prev = w; x[i0 + i] += fn(i / sr, w, hp); } };
  const kick = (t) => add(t, "kick", (u) => 0.9 * Math.sin(2 * Math.PI * (50 + 70 * Math.exp(-u * 30)) * u) * Math.exp(-u * 9), 0.3);
  const snare = (t) => add(t, "snare", (u, w) => (0.5 * w + 0.3 * Math.sin(2 * Math.PI * 185 * u)) * Math.exp(-u * 22), 0.18);
  const hat = (t) => add(t, "hat", (u, w, hp) => 0.25 * hp * Math.exp(-u / 0.012), 0.05);
  const openHat = (t) => add(t, "openHat", (u, w, hp) => 0.22 * hp * Math.exp(-u / 0.16), 0.5);
  const crash = (t) => add(t, "crash", (u, w, hp) => (0.35 * w + 0.25 * hp) * Math.exp(-u / 0.7), 2.0);
  const ride = (t) => add(t, "ride", (u, w, hp) => (0.07 * (Math.sin(2 * Math.PI * 3100 * u) + Math.sin(2 * Math.PI * 4430 * u) + 0.8 * Math.sin(2 * Math.PI * 5680 * u) + 0.6 * Math.sin(2 * Math.PI * 7210 * u)) * Math.exp(-u / 0.6) + 0.12 * hp * Math.exp(-u / 0.01)), 1.2);
  const tom = (t, f0, type) => add(t, type, (u, w) => (0.8 * Math.sin(2 * Math.PI * f0 * (1 + 0.15 * Math.exp(-u * 20)) * u) * Math.exp(-u * 6) + 0.2 * w * Math.exp(-u * 300)), 0.45);
  for (let b = 0; b < bars; b++) {
    const t0 = 1 + b * 4 * spb;
    for (const k of [0, 2]) kick(t0 + k * spb);
    if (b % 4 !== 3) for (const k of [1, 3]) snare(t0 + k * spb);
    else snare(t0 + spb);
    if (b === 0 || b === 4) crash(t0);
    if (b >= 4 && b <= 5) { for (let k = 0; k < 4; k++) if (!(b === 4 && k === 0)) ride(t0 + k * spb); }
    else if (b % 4 !== 3) for (let k = 0; k < 8; k++) { if ((b % 2 === 1 && k === 7) || ((b === 2 || b === 6) && k === 3)) openHat(t0 + k * spb / 2); else if (!(k === 0 && (b === 0 || b === 4))) hat(t0 + k * spb / 2); }
    if (b % 4 === 3) { const fill = [[200, "tomHigh"], [200, "tomHigh"], [135, "tomMid"], [135, "tomMid"], [95, "tomLow"], [95, "tomLow"]]; fill.forEach(([f, ty], i) => tom(t0 + 2 * spb + i * spb / 4, f, ty)); for (let k = 0; k < 4; k++) (k === 3 ? openHat : hat)(t0 + k * spb / 2); }
  }
  return { x, truth: truth.sort((a, b) => a.t - b.t), bpm };
}
function f1(truth, est, type, tol = 0.03) {
  const g = truth.filter((h) => h.type === type), e = est.filter((h) => h.type === type), used = new Set(); let tp = 0;
  for (const h of g) { const k = e.findIndex((x, i) => !used.has(i) && Math.abs(x.t - h.t) <= tol); if (k >= 0) { used.add(k); tp++; } }
  return g.length + e.length ? (2 * tp) / (g.length + e.length) : 1;
}

{
  const types = ["kick", "snare", "hat", "openHat", "crash", "ride", "tomHigh", "tomMid", "tomLow"];
  for (const seed of [5, 23]) {
    const { x, truth } = renderKit(44100, seed), hits = eng.transcribeDrums(x, 44100, { kit: "full" });
    const scores = types.map((ty) => [ty, f1(truth, hits, ty)]), low = scores.filter(([, v]) => v < 0.85);
    expect(!low.length, `full kit (rendered, seed ${seed}): every class F1 ≥ 0.85 — ${scores.map(([k, v]) => `${k} ${v.toFixed(2)}`).join(" · ")}`);
  }
  const { x, truth } = renderKit(44100, 5);
  const base = eng.transcribeDrums(x, 44100);
  expect(base.every((h) => ["kick", "snare", "hat"].includes(h.type)) && !base.some((h) => h.features), "without kit:\"full\" transcribeDrums is the 3-class path, unchanged");
  const hits = eng.transcribeDrums(x, 44100, { kit: "full" });
  const bpm = 100, beats = hits.map((h) => ({ type: h.type, beat: (h.t - 1) * bpm / 60 })).filter((h) => h.beat > -0.1);
  // MusicXML percussion part
  const xml = eng.drumHitsToMusicXML(beats, { tempo: 100, title: "Kit" });
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const ms = Array.from(doc.getElementsByTagName("measure"));
  const voiceSums = ms.map((m) => { const s = { 1: 0, 2: 0 }; Array.from(m.getElementsByTagName("note")).forEach((n) => { if (n.getElementsByTagName("chord").length) return; s[n.getElementsByTagName("voice")[0].textContent] += +n.getElementsByTagName("duration")[0].textContent; }); return s; });
  expect(/<sign>percussion<\/sign>/.test(xml) && ms.length === 8 && voiceSums.every((s) => s[1] === 16 && s[2] === 16), `drum MusicXML: percussion clef, 8 bars, both voices fill every bar (${J(voiceSums.slice(0, 2))})`);
  const unp = Array.from(doc.getElementsByTagName("note")).filter((n) => n.getElementsByTagName("unpitched").length);
  const inst = new Set(unp.map((n) => n.getElementsByTagName("instrument")[0].getAttribute("id")));
  expect(unp.length === beats.filter((h) => Math.round(h.beat * 4) < 8 * 16).length && inst.size >= 8 && /<midi-unpitched>37<\/midi-unpitched>/.test(xml) && /<notehead>x<\/notehead>/.test(xml) && /<notehead>circle-x<\/notehead>/.test(xml), `every hit is an unpitched note on its GM instrument (${unp.length} notes, ${inst.size} instruments), cymbals with x heads`);
  expect(unp.filter((n) => /kick/.test(n.getElementsByTagName("instrument")[0].getAttribute("id"))).every((n) => n.getElementsByTagName("stem")[0].textContent === "down" && n.getElementsByTagName("voice")[0].textContent === "2"), "kick in the feet voice, stems down");
  // ASCII tab matches the MIDI
  const tab = eng.drumHitsToAsciiTab(beats, { title: "Kit" });
  const rowCount = (r) => tab.split("\n").filter((l) => l.startsWith(r + "|") || l.startsWith(r + " |")).join("").replace(/[^xoO]/g, "").length;
  const midi = eng.drumKitToMidi(beats, { bpm: 100 });
  const ons = {}; for (let i = 0; i + 2 < midi.length; i++) if (midi[i] === 0x99) { ons[midi[i + 1]] = (ons[midi[i + 1]] || 0) + 1; i += 2; }
  const byRow = (row) => beats.filter((h) => eng.DRUM_KIT[h.type].row === row).length;
  expect(["CR", "RD", "HH", "SD", "T1", "T2", "FT", "BD"].every((r) => rowCount(r) === byRow(r)), "drum tab: one mark per hit on its row");
  expect(Object.entries(eng.DRUM_KIT).every(([ty, k]) => (ons[k.gm] || 0) === beats.filter((h) => h.type === ty).length), "drum MIDI: one GM note-on per hit (channel 10)");
  expect(/^BD\|o---/m.test(tab) && /x = cymbal/.test(tab), "the tab reads like a drum tab (BD on the downbeat)");
  // drumPattern tolerates the new kit pieces, and adds them only when present
  const pat = eng.drumPattern(hits, { bpm: 100 });
  expect(pat.bars.some((b) => b.tomLow) && eng.drumPattern(base, { bpm: 100 }).bars.every((b) => Object.keys(b).join(",") === "number,startSec,kick,snare,hat"), "drumPattern: extra rows only for full-kit pieces");
}

{ /* piano: hands + grand staff */
  // LH: C2/G2 bass, RH: C-major triads around C5, plus a melody note
  const notes = [];
  for (let b = 0; b < 4; b++) {
    const root = [36, 41, 43, 36][b];
    notes.push({ midi: root, startSec: b * 2, durSec: 1.9 }, { midi: root + 7, startSec: b * 2 + 1, durSec: 0.9 });
    for (const m of [[64, 67, 72], [65, 69, 72], [67, 71, 74], [64, 67, 72]][b]) notes.push({ midi: m, startSec: b * 2, durSec: 0.95 }, { midi: m, startSec: b * 2 + 1, durSec: 0.95 });
  }
  const hands = eng.pianoScoreFromNotes(notes);
  expect(hands.right.every((n) => n.midi >= 60) && hands.left.every((n) => n.midi < 60) && hands.left.length === 8 && hands.right.length === 24, `hands split at the hinge (${hands.hinge}): LH ${hands.left.length}, RH ${hands.right.length}`);
  const wide = eng.pianoScoreFromNotes([{ midi: 62, startSec: 0, durSec: 1 }, { midi: 64, startSec: 0, durSec: 1 }, { midi: 84, startSec: 0, durSec: 1 }], { hinge: 60 });
  expect(wide.right.length === 1 && wide.right[0].midi === 84 && wide.left.length === 2, "a chord wider than a hand spills its lower notes to the left hand");
  const px = eng.scoreToPianoMusicXML(hands, { bpm: 120, tempo: 120, title: "Piano" });
  const pd = new DOMParser().parseFromString(px, "text/xml");
  const pn = Array.from(pd.getElementsByTagName("note")).filter((n) => n.getElementsByTagName("pitch").length);
  const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const pm = pn.filter((n) => !n.getElementsByTagName("tie").length || n.getElementsByTagName("tie")[0].getAttribute("type") === "start").map((n) => { const p = n.getElementsByTagName("pitch")[0], al = p.getElementsByTagName("alter")[0]; return { midi: 12 * (+p.getElementsByTagName("octave")[0].textContent + 1) + STEP[p.getElementsByTagName("step")[0].textContent] + (al ? +al.textContent : 0), staff: n.getElementsByTagName("staff")[0].textContent }; });
  expect(/<staves>2<\/staves>/.test(px) && /<clef number="2"><sign>F<\/sign>/.test(px) && pd.getElementsByTagName("part").length === 1, "grand staff: one part, two staves, treble + bass clef");
  expect(J(pm.map((n) => n.midi).sort((a, b) => a - b)) === J(notes.map((n) => n.midi).sort((a, b) => a - b)) && pm.every((n) => (n.staff === "1") === (n.midi >= 60)), "every note is written once, with its pitch, on its hand's staff");
  const sums = Array.from(pd.getElementsByTagName("measure")).map((m) => { const s = { 1: 0, 2: 0 }; Array.from(m.getElementsByTagName("note")).forEach((n) => { if (n.getElementsByTagName("chord").length) return; s[n.getElementsByTagName("staff")[0].textContent] += +n.getElementsByTagName("duration")[0].textContent; }); return s; });
  expect(sums.length === 4 && sums.every((s) => s[1] === 1920 && s[2] === 1920), `both staves fill every bar (${J(sums[0])})`);
}

{ /* all-parts zip: drums + piano join the deliverables */
  const band = { timeSig: [4, 4], tempo: 100, bars: [1, 2].map((n) => ({ number: n, timeSig: [4, 4], events: [{ symbol: "C", midis: [48, 60, 64, 67], beat: 0, durBeats: 4, qbeat: 0, qdur: 4 }] })) };
  const drums = [0, 1, 2, 3, 4, 5, 6, 7].map((b) => ({ type: b % 2 ? "snare" : "kick", beat: b })).concat([0, 2, 4, 6].map((b) => ({ type: "crash", beat: b })));
  const zip = eng.partsZip([{ name: "Band", score: band }, { name: "Piano", role: "piano", score: band }, { name: "Drums", drums }], { title: "T", tempo: 100 });
  const names = eng._zipEntries(zip).map((e) => e.name);
  expect(["03_Drums.musicxml", "03_Drums.txt", "03_Drums.mid", "02_Piano_grand-staff.musicxml", "full_score.musicxml", "score.mid"].every((n) => names.includes(n)), `zip: drum notation + tab + MIDI, piano grand staff, full score (${names.join(", ")})`);
  const full = new TextDecoder().decode(await eng._zipRead(zip, eng._zipEntries(zip).find((e) => e.name === "full_score.musicxml")));
  const fd = new DOMParser().parseFromString(full, "text/xml");
  expect(fd.getElementsByTagName("part").length === 3 && /<sign>percussion<\/sign>/.test(full) && /id="P3-crash"/.test(full), "full_score.musicxml carries the drum part as a third, percussion part");
  const back = await eng.parseScoreZip(zip, true, 0);
  expect(back && back.bars.length === 2 && back.parts.length === 3, `the zip re-imports through parseScoreZip (${back && back.parts.map((p) => p.name).join(", ")})`);
}

{ /* WO-5 UI contracts */
  expect(/kit: fullKit \? "full"/.test(uiSrc) && /drumHitsToMusicXML\(/.test(uiSrc) && /drumHitsToAsciiTab\(/.test(uiSrc), "the drum chart offers the full kit + notation / tab downloads");
  expect(/scoreToPianoMusicXML\(/.test(uiSrc) && /pianoScoreFromNotes\(/.test(uiSrc), "Voices (ML) can save a piano grand staff");
}

/* ============================================================================
 *  WO-6 — project library, setlists, bundles
 * ========================================================================== */
section("WO-6 library");
{
  const keys = ["C", "G", "D", "A", "E", "F", "Bb", "Eb", "Am", "Em"], words = ["Blue", "Sky", "River", "Night", "Song", "Road", "Fire", "Rain", "Moon", "Peg"];
  const recs = Array.from({ length: 200 }, (_, i) => eng.makeProjectRecord({ id: "p" + i, title: `${words[i % 10]} ${words[(i * 7) % 10]} ${i}`, artist: i % 3 ? "The Band" : "Allman Brothers", filename: `f${i}.gp`, kind: i % 4 ? "xml" : "audio", key: keys[i % 10], bpm: 80 + (i % 60), tags: i % 5 ? ["gig"] : ["gig", "jazz"], now: 1e12 + i * 1000 }));
  expect(recs.every(eng.isProjectRecord) && !eng.isProjectRecord({ v: 9 }), "makeProjectRecord / isProjectRecord");
  const t0 = performance.now(); let r; for (let k = 0; k < 20; k++) r = eng.searchProjects(recs, { q: "river allman", sort: "title" }); const dt = (performance.now() - t0) / 20;
  expect(r.length > 0 && r.every((x) => /river/i.test(x.title) && x.artist === "Allman Brothers") && r.every((x, i) => i === 0 || x.title.toLowerCase() >= r[i - 1].title.toLowerCase()), `search: every word must match, sorted by title (${r.length} hits)`);
  expect(dt < 100, `200 projects searchable in ${dt.toFixed(2)} ms (< 100 ms)`);
  expect(eng.searchProjects(recs, { tags: ["jazz"] }).length === 40 && eng.searchProjects(recs, { q: "Bb" }).length === 20 && eng.searchProjects(recs, { sort: "updated" })[0].id === "p199", "tag filter, key search, newest first by default");
  expect(eng.searchProjects([eng.makeProjectRecord({ title: "Corazón Espinado" })], { q: "corazon" }).length === 1, "search folds accents");
  expect(J(eng.projectTags(recs)) === J([{ tag: "gig", count: 200 }, { tag: "jazz", count: 40 }]), "projectTags counts, most used first");
  // setlists
  let set = eng.createSetlist("Friday");
  set = eng.setlistAdd(set, "p1", { transpose: 2 }); set = eng.setlistAdd(set, "p2"); set = eng.setlistAdd(set, "p3", { capo: 3 });
  set = eng.setlistMove(set, 2, 0); set = eng.setlistUpdateItem(set, 1, { transpose: -3, capo: 2 });
  expect(J(set.items.map((x) => [x.projectId, x.transpose, x.capo])) === J([["p3", 0, 3], ["p1", -3, 2], ["p2", 0, 0]]), "setlist add / move / per-item transpose + capo");
  expect(eng.setlistRemove(set, 0).items.length === 2 && eng.setlistPrune(set, ["p1"]).items.length === 1 && eng.setlistUpdateItem(set, 0, { transpose: 40 }).items[0].transpose === 11, "remove / prune / clamped transpose");
  const re = JSON.parse(JSON.stringify(set));
  expect(J(re) === J(set), "a setlist survives a JSON round trip (what IndexedDB stores)");
  // project bundle round trip
  const src = bytesOf("Charlie Parker - Anthropology.gp5");
  const edit = eng.editPush(null, { t: "note.remove", id: "n1.0.55" });
  const proj = eng.makeProjectRecord({ title: "Anthropology", filename: "Charlie Parker - Anthropology.gp5", kind: "xml", key: "Bb", bpm: 220, tags: ["bebop"], meta: { v: 1, kind: "xml", overrides: { "2.0": "Cm7" }, scoreEdit: { ...edit, target: "xml:x:0" }, keyOverride: "Bb" } });
  const zip = eng.exportProjectBundle(proj, { source: src });
  const back = await eng.importProjectBundle(zip);
  expect(back.source && back.source.bytes.length === src.length && back.source.bytes.every((b, i) => b === src[i]) && back.source.name === proj.filename, "bundle round-trips the source file byte-for-byte");
  expect(J(back.meta) === J(proj.meta) && back.project.title === "Anthropology" && back.project.id !== proj.id && J(back.project.tags) === J(["bebop"]) && eng.isScoreEdit(back.meta.scoreEdit), "…and the edits (overrides, note edits, key), as a new project");
  expect((await eng.importProjectBundle(zip, { keepId: true })).project.id === proj.id, "keepId keeps the project id");
  let bad = ""; try { await eng.importProjectBundle(eng.zipStore([{ name: "x.txt", data: new Uint8Array([1]) }])); } catch (e) { bad = e.message; }
  expect(/not a tab translator pro project bundle/i.test(bad), "a foreign zip is refused with a clear message");
  const sc = await eng.parseGuitarProOrXML(back.source.bytes, back.source.name, true, 0);
  expect(sc.bars.length > 10, "the bundled source re-parses");
}

{ /* WO-6 UI contracts */
  expect(/function LibraryPanel\(/.test(uiSrc) && /\["library", "Library/.test(uiSrc) && /indexedDB/.test(uiSrc), "UI ships a Library mode on IndexedDB");
  expect(/navigator\.storage/.test(uiSrc) && /projectFilePut/.test(uiSrc), "project bytes go to OPFS (IndexedDB fallback)");
  expect(/function PrintSheet\(/.test(uiSrc) && /window\.print\(\)/.test(uiSrc) && /@page/.test(uiSrc), "a print view (window.print, @page setup)");
  expect(/navigator\.share/.test(uiSrc) && /canShare/.test(uiSrc), "exports can go to the share sheet");
  expect(/exportProjectBundle\(/.test(uiSrc) && /importProjectBundle\(/.test(uiSrc) && /setlistAdd\(/.test(uiSrc), "bundles + setlists wired");
}

/* ============================================================================
 *  WO-7 — playing techniques from audio + tuning / capo
 * ========================================================================== */
section("WO-7 techniques + tuning");
function renderLine(sr, seed = 3) {
  let s = seed; const R = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const x = new Float32Array(Math.round(sr * 9)), notes = [], truth = [];
  // a phrase: [startSec, durSec, pitchFn(t) in midi, attack?, harmonic rolloff, decay, amp, expected tag]
  let ph = 0, cur = null;
  const plucks = [];
  const seg = (t0, dur, pitch, o = {}) => plucks.push({ t0, dur, pitch, ...o });
  const n = (t, d, m, tag, o) => { notes.push({ midi: m, startSec: t, durSec: d }); truth.push(tag || null); };
  // 1 plain E4
  seg(0.5, 0.4, () => 64); n(0.5, 0.4, 64);
  // 2 bend G4 +2 st
  seg(1.1, 0.5, (t) => 67 + (t < 0.08 ? 0 : Math.min(2, (t - 0.08) / 0.12 * 2))); n(1.1, 0.5, 67, "bend");
  // 3 vibrato A4
  seg(1.9, 0.6, (t) => 69 + 0.3 * Math.sin(2 * Math.PI * 6 * t) * Math.min(1, t / 0.1)); n(1.9, 0.6, 69, "vibrato");
  // 4 hammer C5 → D5 (no new attack, a jump)
  seg(2.8, 0.5, (t) => (t < 0.25 ? 72 : 74)); n(2.8, 0.25, 72, "hammer"); n(3.05, 0.25, 74);
  // 5 slide E5 → G5 (glide 120 ms, no new attack)
  seg(3.6, 0.6, (t) => (t < 0.22 ? 76 : t < 0.34 ? 76 + 3 * (t - 0.22) / 0.12 : 79)); n(3.6, 0.22, 76, "slide"); n(3.82, 0.38, 79);
  // 6 palm-muted E3 x2
  seg(4.5, 0.25, () => 52, { mute: true }); n(4.5, 0.25, 52, "palmMute");
  seg(4.85, 0.25, () => 52, { mute: true }); n(4.85, 0.25, 52, "palmMute");
  // 7 ghost A3 between plain notes
  seg(5.3, 0.3, () => 57); n(5.3, 0.3, 57);
  seg(5.65, 0.12, () => 57, { amp: 0.08 }); n(5.65, 0.12, 57, "ghost");
  seg(5.85, 0.3, () => 59); n(5.85, 0.3, 59);
  // 8 pull-off D5 → C5 and plain picked notes (negatives)
  seg(6.4, 0.5, (t) => (t < 0.25 ? 74 : 72)); n(6.4, 0.25, 74, "hammer"); n(6.65, 0.25, 72);
  seg(7.1, 0.3, () => 67); n(7.1, 0.3, 67); seg(7.45, 0.3, () => 69); n(7.45, 0.3, 69); seg(7.8, 0.4, () => 71); n(7.8, 0.4, 71);
  for (const p of plucks) {
    const i0 = Math.round(p.t0 * sr), len = Math.round(p.dur * sr), amp = p.amp || 0.35; let phase = 0;
    for (let i = 0; i < len && i0 + i < x.length; i++) {
      const t = i / sr, f = 440 * Math.pow(2, (p.pitch(t) - 69) / 12); phase += 2 * Math.PI * f / sr;
      const env = Math.min(1, t / 0.004) * (p.mute ? Math.exp(-t * 18) : Math.exp(-t * 2.2)) * Math.min(1, (p.dur - t) / 0.01);
      let v = 0; for (let h = 1; h <= 10; h++) v += Math.sin(h * phase) / (p.mute ? Math.pow(h, 2.6) : h);
      x[i0 + i] += amp * env * v * 0.5 + (t < 0.004 ? amp * 0.4 * R() * (1 - t / 0.004) : 0);
    }
  }
  return { x, notes, truth };
}

{
  for (const [sr, snr] of [[16000, Infinity], [22050, Infinity], [16000, 20]]) {
    const { x, notes, truth } = renderLine(sr); let e = 0; for (const v of x) e += v * v; const rms = Math.sqrt(e / x.length);
    let sd = 9; const R = () => ((sd = (sd * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const y = Float32Array.from(x, (v) => v + (isFinite(snr) ? rms * Math.pow(10, -snr / 20) * R() * 1.73 : 0));
    const snap = J(notes), out = eng.detectGuitarTechniques(y, sr, notes);
    let tp = 0, fp = 0, fn = 0; out.forEach((n, i) => { const got = n.tech || [], want = truth[i]; if (want && got.includes(want)) tp++; else if (want) fn++; fp += got.filter((g) => g !== want).length; });
    expect(tp === 8 && fn === 0 && fp === 0 && J(notes) === snap, `techniques (${sr} Hz${isFinite(snr) ? `, ${snr} dB SNR` : ""}): bend · vibrato · hammer · slide · 2 palm mutes · ghost · pull-off — ${tp}/8 found, ${fp} false, input untouched`);
  }
  const { x, notes } = renderLine(16000), out = eng.detectGuitarTechniques(x, 16000, notes);
  expect(out[1].bend === 4, `the bend's size: a whole step = 4 quarter-tones (${out[1].bend})`);
  const chord = [{ midi: 60, startSec: 0.5, durSec: 0.5 }, { midi: 64, startSec: 0.5, durSec: 0.5 }];
  expect(eng.detectGuitarTechniques(x, 16000, chord).every((n) => !n.tech), "notes struck together (a chord) are left alone");
  const tr = eng.pitchTrack(x, 16000, [notes[2]]);
  const voiced = tr.filter((f) => f.clarity > 0.6 && f.t > 2.0 && f.t < 2.4);
  expect(voiced.length > 20 && Math.max(...voiced.map((f) => f.midi)) - Math.min(...voiced.map((f) => f.midi)) > 0.4, "pitchTrack follows the vibrato (±0.3 st)");
  // carried into the tab: notes → score → fingering → AlphaTex → alphaTab sees them
  const sc = eng.fingerScore(eng.polyNotesToScore(out, { bpm: 120 }));
  const techs = sc.bars.flatMap((b) => b.events.flatMap((e) => Object.values(e.tech || {}).flat()));
  expect(["bend", "vibrato", "hammer", "slide", "palmMute", "ghost"].every((t) => techs.includes(t)), `the techniques reach the tab's strings (${[...new Set(techs)].join(", ")})`);
  const st = readTex(eng.scoreToAlphaTex(sc)).tracks[0].staves[0], an = st.bars.flatMap((b) => b.voices[0].beats.flatMap((bt) => bt.notes.map((n) => ({ n, bt }))));
  expect(an.some(({ n }) => n.hasBend) && an.some(({ n, bt }) => n.vibrato || bt.vibrato) && an.some(({ n }) => n.isHammerPullOrigin) && an.some(({ n }) => n.slideOutType) && an.some(({ n }) => n.isPalmMute) && an.some(({ n }) => n.isGhost), "alphaTab reads bend, vibrato, hammer-on, slide, palm mute and ghost from the AlphaTex");
  const plain = eng.polyNotesToScore(notes, { bpm: 120 });
  expect(plain.bars.every((b) => b.events.every((e) => !("ntech" in e))), "without techniques the score is unchanged (no ntech field)");
  // tuning + capo
  const schism = await eng.parseGuitarProOrXML(bytesOf("Tool - Schism.gp5"), "s.gp5", true, 1);      // Adam Jones (Guitar I), Drop D
  const dd = eng.detectTuningAndCapo(schism, { maxEvents: 400 });
  expect(dd.tuning && dd.tuning.id === "dropD" && dd.tuning.confidence > 0.6 && !dd.capo, `Drop D part → Drop D (${dd.tuning && dd.tuning.id}, ${dd.tuning && Math.round(dd.tuning.confidence * 100)}%), no capo`);
  let fpN = 0, nStd = 0;
  for (const f of ["blue-sky.gp", "Steely Dan - Peg.gp4", "Charlie Parker - Anthropology.gp5", "Lynyrd Skynyrd - Sweet Home Alabama.gp5", "The Eagles - Hotel California.gp5"]) {
    const s0 = await eng.parseGuitarProOrXML(bytesOf(f), f, true, 0); if (s0.tuning !== "Standard") continue;
    nStd++; const d = eng.detectTuningAndCapo(s0, { maxEvents: 300 }); if (d.capo || d.tuning) fpN++;
  }
  expect(nStd >= 4 && fpN === 0, `standard parts: no tuning or capo suggested (${fpN}/${nStd})`);
}

{ /* WO-7 UI contracts */
  expect(/detectGuitarTechniques/.test(uiSrc) && /detectTuningAndCapo\(/.test(uiSrc), "Guitar → Tab reads techniques and ranks tuning / capo");
  expect(/Apply/.test(uiSrc) && /gtrTechOn/.test(uiSrc), "technique detection is a toggle; tuning / capo suggestions apply on a tap");
}

console.log(`\nworkbench: ${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
