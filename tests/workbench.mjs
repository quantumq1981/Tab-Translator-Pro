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

console.log(`\nworkbench: ${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
