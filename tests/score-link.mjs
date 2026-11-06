/* SCORE ↔ RECORDING LINK suite (2026-11-06) — notation and audio read together:
 *   · repeats as performed (unrollRepeatOrder) and the score's notes in quarters;
 *   · the score's harmony for the chord prior (comping parts, harmony carry, the oracle's naming);
 *   · linkScoreToAudio on synthesized audio with a tempo warp + lead-in: bar times, key, transposition;
 *   · analyzeAudioWithScore: agreement with an exact score; a WRONG bar in the score is overruled by
 *     clear audio and listed for review with the score's chord first;
 *   · linkedChartScore: the score's bars, sections, recording offset, tempo map;
 *   · Harmony (all parts) for Guitar Pro / Power Tab, drum kits left out;
 *   · the UI contract (Link a score / Link a recording, worker RPC with fallback, no accept filter).
 * Accuracy lives in tests/bench/scorelink.mjs (dev/test split) — see docs/SCORE-AUDIO-LINK.md. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
globalThis.DOMParser = (await import("@xmldom/xmldom")).DOMParser;
const enginePath = path.join(here, ".engine.scorelink.mjs");
fs.writeFileSync(enginePath, fs.readFileSync(path.join(repo, "engine.tsx"), "utf8"));
const eng = await import(enginePath + "?t=" + Date.now());
const uiSrc = fs.readFileSync(path.join(repo, "TabDecoderPro.tsx"), "utf8");

let failures = 0, passes = 0;
const expect = (cond, msg) => { if (cond) passes++; else { failures++; console.error("FAIL:", msg); } };
const section = (name) => console.log(`\n— ${name}`);

/* ---- a small score + its rendering ---------------------------------------- */
const CH = { C: [48, 52, 55, 60], Am: [45, 52, 57, 60], F: [41, 53, 57, 60], G: [43, 55, 59, 62], Dm: [50, 53, 57, 62], Em: [40, 52, 55, 59], E7: [40, 56, 59, 62] };
const ev = (sym, q, d) => ({ symbol: sym, midis: CH[sym], beat: Math.round(q), durBeats: d, qbeat: q, qdur: d, frets: {} });
function makeScore(prog, opts = {}) {
  return { source: "gp", timeSig: [4, 4], tempo: opts.tempo || 100, tuningMidi: [40, 45, 50, 55, 59, 64],
    bars: prog.map((b, i) => ({ number: i + 1, timeSig: [4, 4], section: opts.sections ? opts.sections[i] || null : null, repeatStart: false, repeatEnd: false, ending: null,
      events: Array.isArray(b) ? b.map(([s, q, d]) => ev(s, q, d)) : [ev(b, 0, 4)] })) };
}
const SR = 16000;
// additive "electric piano": 5 partials, decaying; bpms[b] = the recording's tempo in bar b
function render(score, bpms, leadIn = 1.5, transpose = 0) {
  let t = leadIn; const notes = [], barSec = [];
  score.bars.forEach((bar, bi) => {
    const spq = 60 / bpms[bi % bpms.length]; barSec.push(t);
    for (const e of bar.events) notes.push({ t: t + e.qbeat * spq, d: e.qdur * spq, midis: e.midis.map((m) => m + transpose) });
    t += 4 * spq;
  });
  const out = new Float32Array(Math.ceil((t + 1) * SR));
  for (const n of notes) for (const m of n.midis) {
    const f = 440 * Math.pow(2, (m - 69) / 12), s0 = Math.floor(n.t * SR), len = Math.floor(n.d * SR);
    for (let i = 0; i < len && s0 + i < out.length; i++) {
      const tt = i / SR, env = Math.exp(-tt * 1.2) * Math.min(1, tt * 200) * Math.min(1, (len - i) / 200);
      let v = 0; for (let h = 1; h <= 5; h++) v += Math.sin(2 * Math.PI * f * h * tt) / (h * h);
      out[s0 + i] += 0.08 * env * v;
    }
  }
  return { audio: out, barSec, end: t };
}
const PROG = ["C", "Am", "F", "G", "C", "Am", "Dm", "G", "C", "Am", "F", "G"];
const BPM = [100, 104, 98, 101, 106, 99, 95, 100, 103, 97, 100, 102];         // the score says ♩=100
const score = makeScore(PROG, { sections: { 0: "Verse", 8: "Chorus" } });
const rec = render(score, BPM);

/* ---------------------------------------------------------------------------- */
section("repeats as performed + the score's notes");
{
  const b = (o) => ({ number: 0, events: [], ...o });
  const plain = [b({}), b({}), b({})];
  expect(JSON.stringify(eng.unrollRepeatOrder(plain)) === "[0,1,2]", "no repeats → written order");
  const rep = [b({ repeatStart: true }), b({ repeatEnd: true }), b({})];
  expect(JSON.stringify(eng.unrollRepeatOrder(rep)) === "[0,1,0,1,2]", `|: a b :| c → a b a b c (got ${JSON.stringify(eng.unrollRepeatOrder(rep))})`);
  const endings = [b({ repeatStart: true }), b({ ending: "1", repeatEnd: true }), b({ ending: "2" }), b({})];
  expect(JSON.stringify(eng.unrollRepeatOrder(endings)) === "[0,1,0,2,3]", `1st/2nd endings → a 1 a 2 d (got ${JSON.stringify(eng.unrollRepeatOrder(endings))})`);
  const pn = eng.scorePartNotes(score);
  expect(pn.len === 48 && pn.bars.length === 12 && pn.bars[8].section === "Chorus", "12 bars of 4/4 = 48 quarters, sections carried");
  expect(pn.notes.filter((n) => n.t === 4).length === 4, "bar 2's Am sounds at quarter 4");
}

section("the score's harmony for the chord prior");
{
  const comp = makeScore(["C"]);
  const melody = { ...makeScore(["C"]), bars: [{ number: 1, timeSig: [4, 4], events: [0, 1, 2, 3].map((q) => ({ symbol: "D", midis: [74], qbeat: q, qdur: 1, beat: q, durBeats: 1 })) }] };
  const parts = eng.scoreLinkParts([{ score: comp, name: "Piano" }, { score: melody, name: "Lead guitar" }, { score: makeScore(["C"]), name: "Drums" }, { score: melody, name: "Vocals" }]);
  expect(parts.length === 3 && !parts.some((p) => p.name === "Drums"), "drum kits are left out (by name)");
  expect(parts.find((p) => p.name === "Piano").weight === 1 && parts.find((p) => p.name === "Lead guitar").weight < 1, "a chordal part counts fully, a single line less");
  const grid = eng.scoreLinkPriorGrid(parts, 4, 0.5);
  expect(grid[0].chroma[2] === 0, "the prior reads the comping part only — the melody's D does not vote");
  expect(eng.scoreLinkParts([{ score: comp, name: "x", drum: true }]).length === 0, "a part the parser flagged as a drum kit is left out");
  // harmony carry: an arpeggio holds the chord it spells
  const arp = { ...makeScore(["C"]), bars: [{ number: 1, timeSig: [4, 4], events: [[48, 0], [52, 0.5], [55, 1], [60, 1.5], [52, 2], [55, 2.5], [48, 3]].map(([m, q]) => ({ symbol: "x", midis: [m], qbeat: q, qdur: 0.5, beat: Math.floor(q), durBeats: 1 })) },
    { number: 2, timeSig: [4, 4], events: [{ symbol: "x", midis: [45, 52, 57], qbeat: 0, qdur: 4, beat: 0, durBeats: 4 }] }] };
  const ag = eng.scoreLinkPriorGrid(eng.scoreLinkParts([{ score: arp, name: "Guitar" }]), 8, 0.5);
  const states = eng.chordStatesV2({ vocabulary: "chart" });
  const name = (c) => { const r = eng._scorePriorBonus(c, states, { vocabulary: "chart" }); const st = states[r.best]; return ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"][st.root] + (st.writeQ || st.quality).suffix; };
  expect(ag.slice(2, 7).every((c) => name(c) === "C"), `an arpeggiated C reads C on every half-beat once spelled (${ag.slice(0, 8).map(name).join(" ")})`);
  // the oracle names a pitch set the way the app names notation
  const c6 = { chroma: Float64Array.from([1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0]), bass: Float64Array.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) };
  expect(name(c6) === "Cmaj7", `C-E-G-A over C reads Cmaj7 in the Pro vocabulary (the C6 → maj7 convention), not Am7 (got ${name(c6)})`);
  const r = eng._scorePriorBonus(c6, states, { vocabulary: "chart" });
  expect(r.bonus[r.best] === Math.max(...r.bonus), "the oracle's chord gets the largest bonus");
  expect(eng._scorePriorBonus({ chroma: new Float64Array(12), bass: new Float64Array(12) }, states, {}) === null, "a silent score beat gives no evidence either way");
}

section("linkScoreToAudio — synthesized recording, tempo warp + lead-in");
let link;
{
  link = eng.linkScoreToAudio(rec.audio, SR, [{ score, name: "Keys" }], { tempo: 100 });
  expect(link.ok && link.transpose === 0, `links in the same key (ok ${link.ok}, transpose ${link.transpose})`);
  expect(link.confidence > 0.8 && link.runnerUp && link.confidence - link.runnerUp.confidence > 0.15, `a clear match: ${link.confidence} vs next best key ${link.runnerUp && link.runnerUp.confidence}`);
  const errs = link.bars.map((b, i) => Math.abs(b.sec - rec.barSec[i]));
  const med = errs.slice().sort((a, b) => a - b)[errs.length >> 1];
  expect(med < 0.12 && Math.max(...errs.slice(1)) < 0.3, `bar lines follow the warped recording (median ${(1000 * med).toFixed(0)} ms, worst ${(1000 * Math.max(...errs.slice(1))).toFixed(0)} ms)`);
  expect(Math.abs(link.bars[0].sec - 1.5) < 0.2, `the lead-in is skipped: bar 1 at ${link.bars[0].sec}s (1.5 s in the recording)`);
  expect(Math.abs(link.tempo - 100) < 5 && link.scoreTempo === 100, `tempo read from the recording ≈ ${link.tempo}`);
  for (let j = 1; j < link.beatTimes.length; j++) if (!(link.beatTimes[j] > link.beatTimes[j - 1])) { expect(false, "beat times strictly increase"); break; }
  expect(Math.abs(eng.linkQToSec(link, eng.linkSecToQ(link, 7.3)) - 7.3) < 1e-6, "linkSecToQ / linkQToSec are inverses");
  const up = makeScore(PROG.map((s) => s)); up.bars.forEach((b) => b.events.forEach((e) => { e.midis = e.midis.map((m) => m + 3); }));
  const lt = eng.linkScoreToAudio(rec.audio, SR, [{ score: up, name: "Keys" }], { tempo: 100 });
  expect(lt.ok && lt.transpose === -3, `a score written 3 semitones up is found and reported (transpose ${lt.transpose})`);
  const bad = eng.linkScoreToAudio(rec.audio, SR, [{ score: makeScore(["E7", "E7", "E7", "E7"]), name: "x" }], { tempo: 100 });
  expect(!bad.ok || bad.confidence < link.confidence - 0.1, `an unrelated score matches far worse (${bad.confidence})`);
  expect(eng.linkScoreToAudio(rec.audio, SR, [{ score: makeScore(["C"]), name: "Drums" }], {}).ok === false, "a score with nothing pitched to match is refused with a reason");
}

section("analyzeAudioWithScore — agreement, and clear audio overrules a wrong bar");
{
  const r = eng.analyzeAudioWithScore(rec.audio, SR, [{ score, name: "Keys" }], { tempo: 100, vocabulary: "chart" });
  expect(r.link && r.link.ok && r.events.length > 0, "a linked decode");
  expect(r.agreement >= 0.85, `the recording agrees with an exact score (${r.agreement})`);
  const at = (evs, t) => evs.find((e) => t >= e.startSec && t < e.startSec + e.durSec);
  const mid = (i) => (rec.barSec[i] + (rec.barSec[i + 1] || rec.end)) / 2;
  expect(PROG.every((s, i) => { const e = at(r.events, mid(i)); return e && e.symbol.replace(/\/.*/, "") === s; }), `every bar reads its chord (${PROG.map((_, i) => (at(r.events, mid(i)) || {}).symbol).join(" ")})`);
  // the score is wrong in bar 6 (Em written, Am played)
  const wrong = makeScore(PROG.map((s, i) => (i === 5 ? "Em" : s)));
  const w = eng.analyzeAudioWithScore(rec.audio, SR, [{ score: wrong, name: "Keys" }], { tempo: 100, vocabulary: "chart" });
  const e6 = at(w.events, mid(5));
  expect(e6 && e6.symbol === "Am", `balanced: the recording's Am stands against the score's Em (got ${e6 && e6.symbol})`);
  expect(e6 && e6.disagree && e6.ambiguous && e6.scoreSymbol === "Em" && e6.alternatives[0].symbol === "Em" && e6.alternatives[0].fromScore, "…and goes to review with the score's Em as the first alternative");
  expect(w.disagreements >= 1, `disagreements counted (${w.disagreements})`);
  const pick = eng.commitChordChoices(w.events, [{ index: w.events.indexOf(e6), symbol: "Em" }]);
  expect(pick[w.events.indexOf(e6)].symbol === "Em" && pick[w.events.indexOf(e6)].reviewed, "one tap commits the score's chord");
  const trusting = eng.analyzeAudioWithScore(rec.audio, SR, [{ score: wrong, name: "Keys" }], { tempo: 100, vocabulary: "chart", scoreWeight: 2, scoreBassWeight: 1 });
  expect((at(trusting.events, mid(5)) || {}).symbol === "Em", "trusting the score fully writes the score's chord");
  // the decoder without a score is unchanged by the link code
  const plain = eng.analyzeAudioChordsV2(rec.audio, SR, { vocabulary: "chart" });
  expect(plain.events.every((e) => e.scoreSymbol === undefined && e.agree === undefined), "without a score, events carry no link fields (decoder untouched)");
}

section("linkedChartScore — the score's bars on the recording's clock");
{
  const r = eng.analyzeAudioWithScore(rec.audio, SR, [{ score, name: "Keys" }], { tempo: 100, vocabulary: "chart" });
  const chart = eng.linkedChartScore(r.link, r.events);
  expect(chart.source === "audio+score" && chart.bars.length === 12, "one chart bar per score bar");
  expect(chart.bars[0].section === "Verse" && chart.bars[8].section === "Chorus", "the score's sections come along");
  expect(Math.abs(chart.audioOffset - 1.5) < 0.2, `audioOffset = bar 1 in the recording (${chart.audioOffset})`);
  expect(chart.bars.every((b, i) => b.events.length && b.events[0].symbol.replace(/\/.*/, "") === PROG[i]), `each bar holds its chord (${chart.bars.map((b) => b.events.map((e) => e.symbol).join("_")).join(" | ")})`);
  const t = eng.scoreRecordingTimes(chart);
  const starts = chart.bars.map((b) => t.find((x) => x.bar === b.number)).map((x) => x && x.start);
  const off = starts.map((s, i) => Math.abs(s - r.link.bars[i].sec));
  expect(Math.max(...off) < 0.15, `playback on the recording's clock follows the link at every bar line (worst ${(1000 * Math.max(...off)).toFixed(0)} ms)`);
  expect(!chart.tempoMap || chart.tempoMap.every((m) => m.bar >= 1 && m.bpm > 60 && m.bpm < 160), "tempo map on bar lines, sane values");
  const csmpn = eng.scoreToCSMPN(chart, { title: "Link" });
  expect(/- Verse/.test(csmpn) && /- Chorus/.test(csmpn), "exports carry the score's sections (CSMPN)");
}

section("Harmony (all parts) for Guitar Pro / Power Tab, drum kits out");
{
  const read = (f) => new Uint8Array(fs.readFileSync(path.join(repo, f)));
  const bc = await eng.parseGuitarProOrXML(read("Steely Dan - Black Cow.gp"), "x.gp", true, 0);
  expect(bc.parts.some((p) => p.drum), "GP7 drum kit flagged (InstrumentSet drumKit)");
  const h = await eng.parseGuitarProOrXML(read("Steely Dan - Black Cow.gp"), "x.gp", true, eng.HARMONY_PART);
  expect(h.partIndex === eng.HARMONY_PART && h.merged && h.bars.length === bc.bars.length && !h.mergedParts.some((n) => /drum/i.test(n)), `GP7 Harmony merges every pitched track (${h.mergedParts.join(", ")})`);
  const gpx = await eng.parseGuitarProOrXML(read("boz-scaggs-lowdown.gpx"), "x.gpx", true, eng.HARMONY_PART);
  expect(gpx.merged && !gpx.mergedParts.includes("Drumkit2"), "GP6 drum kits (Instrument ref drmkt) left out — even one named 'Drumkit2'");
  const g4 = await eng.parseGuitarProOrXML(read("steely-dan-hey_nineteen.gp3"), "x.gp3", true, 0);
  expect(g4.parts.some((p) => p.drum), "GP3/4/5 percussion track flag read");
  const g4h = await eng.parseGuitarProOrXML(read("steely-dan-hey_nineteen.gp3"), "x.gp3", true, eng.HARMONY_PART);
  expect(g4h.merged && g4h.partIndex === eng.HARMONY_PART, "GP3 Harmony");
  const ptb = await eng.parseGuitarProOrXML(read("tests/fixtures/house-of-the-rising-sun.ptb"), "x.ptb", true, eng.HARMONY_PART);
  expect(ptb.merged && ptb.bars.length > 0, "Power Tab Harmony");
  const one = await eng.parseGuitarProOrXML(read("blue-sky.gp"), "x.gp", true, 1);
  expect(one.partIndex === 1 && !one.merged, "a single part is still a single part");
}

section("UI contract");
{
  expect(/import\s*\{[^}]*\banalyzeAudioWithScore\b[^}]*\}\s*from\s*"\.\/engine\.tsx"/.test(uiSrc) && /\blinkedChartScore\b/.test(uiSrc), "UI imports the link engine");
  expect(/_engineRPC\("analyzeAudioWithScore"/.test(uiSrc) && /catch \(_\) \{ return analyzeAudioWithScore\(/.test(uiSrc), "linked analysis runs off-thread with the main-thread fallback");
  expect(/function ScoreLinkPanel\(/.test(uiSrc) && /<ScoreLinkPanel /.test(uiSrc), "Audio panel renders the 📎 score link panel");
  const panel = uiSrc.slice(uiSrc.indexOf("function ScoreLinkPanel("), uiSrc.indexOf("function AudioImport("));
  expect(/<input type="file" onChange=\{onPick\}/.test(panel) && !/accept=/.test(panel), "the score picker has no accept filter (iOS greys out .gp/.gpx/.ptb)");
  expect(/Link a recording/.test(uiSrc) && /setLinkAsk\(/.test(uiSrc) && /scoreFile=\{scoreFile\}/.test(uiSrc), "the score panel offers 🎧 Link a recording and hands its file to the Audio panel");
  expect(/recording: \{ label: "Recording", w: 0\.15/.test(uiSrc) && /balanced: \{ label: "Balanced", w: 0\.3/.test(uiSrc) && /score: \{ label: "Score", w: 1,/.test(uiSrc), "Chords follow: Recording / Balanced / Score weights (measured on the bench)");
  expect(/fromScore \? "📄 score"/.test(uiSrc), "review rows mark the score's chord");
  expect(/if \(\(\n?\s*<button onClick=\{\(\) => selectPart\(HARMONY_PART\)\}/.test(uiSrc) || !/xmlScore\.source === "musicxml" \|\| xmlScore\.source === "midi"\) && \(\s*<button onClick=\{\(\) => selectPart\(HARMONY_PART\)/.test(uiSrc), "the Harmony chip is offered for every multi-part format");
}

fs.rmSync(enginePath, { force: true });
console.log(`\nscore-link: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
