/* ============================================================================
 *  Path A — headless smoke test of the PDF pipeline.
 *
 *  Purpose: exercise "the one untested link" (CLAUDE.md) — the in-browser
 *  PDF.js extraction in extractTokens() — without a browser. It reproduces
 *  that function with pdfjs-dist@3.11.174, the EXACT version the app loads
 *  from the CDN (pdf.min.js 3.11.174). getTextContent()'s item.str + .transform
 *  layout is the stable public text API and is identical between the CDN and
 *  npm builds, so the tokens produced here match what the browser produces.
 *
 *  The engine + parser functions are loaded straight out of TabDecoderPro.tsx
 *  (not copied) so this test cannot drift from the real code. It then asserts
 *  the documented Blue Sky validation: 165 bars, verse E|A|A|E, the V (B) at
 *  section turns, and the C#m / F#m7 bridge.
 *
 *  Run:  cd tests && npm install && npm test
 * ==========================================================================*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const SRC = path.join(repo, "engine.tsx");          // the pure engine module (Wave 1 #1)
const UI = path.join(repo, "TabDecoderPro.tsx");    // the React UI that imports it
const HTML = path.join(repo, "index.html");         // the in-browser loader
const PDF = path.join(repo, "Blue Sky - The Allman Brothers Band.pdf");

const LOG_TOKENS = process.argv.includes("--log-tokens");

/* ---- load the real engine module from source (no copy = no drift) --------
 * The engine is now its OWN pure ES module (engine.tsx, Roadmap Wave 1 #1) with
 * its own `export {...}` surface, so we import it directly — no string-slicing.
 * It stays plain ES (zero TS syntax, zero React) by invariant, so Node runs it
 * verbatim after a .mjs rename. */
const engineSrc = fs.readFileSync(SRC, "utf8");

/* parseMusicXML uses the browser's global DOMParser; the app loads it natively.
 * Headlessly we install @xmldom/xmldom (a TEST-only dep) as that global so the
 * exact same source runs here. The app itself stays zero-dependency. */
globalThis.DOMParser = (await import("@xmldom/xmldom")).DOMParser;
const enginePath = path.join(here, ".engine.generated.mjs");
fs.writeFileSync(enginePath, engineSrc);
const eng = await import(enginePath + "?t=" + Date.now());

/* ---- faithful reproduction of extractTokens() (the untested link) -------- */
const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
async function extractTokens(buf) {
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const tokens = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      const s = (it.str || "").trim();
      // alphaTab PDFs can emit this text-layer artifact between note names; it
      // is not tablature data and must not enter downstream chord clustering.
      if (s === "(single)") continue;
      const m = s.match(/\d+/);
      if (!m) continue;
      tokens.push({ x: it.transform[4], y: vp.height - it.transform[5], val: parseInt(m[0], 10), page: p });
    }
  }
  return { tokens, pages: pdf.numPages };
}

/* ---- run ----------------------------------------------------------------- */
const data = new Uint8Array(fs.readFileSync(PDF));
const { tokens, pages } = await extractTokens(data);
const chart = eng.buildChart(tokens);
const bars = chart.measures.map((m) => {
  const syms = m.columns.map((c) => eng.symbolForFrets(c.frets, true));
  return { number: m.number, bar: syms.filter((s, i) => i === 0 || s !== syms[i - 1]).join(" ") };
});

if (LOG_TOKENS) {
  console.log(`# raw token stream (${tokens.length} tokens, ${pages} pages)`);
  tokens.forEach((t) => console.log(`${t.page}\t${t.x.toFixed(2)}\t${t.y.toFixed(2)}\t${t.val}`));
}

/* ---- assertions (CLAUDE.md "Validation · Path A") ------------------------ */
const fails = [];
const expect = (cond, msg) => { if (!cond) fails.push(msg); };

expect(bars.length === 165, `expected 165 bars, got ${bars.length}`);
expect(bars[0]?.number === 1 && bars[bars.length - 1]?.number === 165,
  `expected measure numbers 1..165, got ${bars[0]?.number}..${bars[bars.length - 1]?.number}`);

const verse = bars.slice(0, 8).map((b) => b.bar).join(" ");
expect(verse === "E A A E E A A E", `expected verse "E A A E E A A E", got "${verse}"`);

expect(bars.some((b) => b.bar.split(" ").includes("B")), "expected a V chord (B) at a section turn");
expect(bars.some((b) => /\bC#m\b/.test(b.bar)), "expected a C#m in the bridge");
expect(bars.some((b) => /\bF#m7\b/.test(b.bar)), "expected an F#m7 in the bridge");

/* ---- score model: chords placed on beats (assume 4/4) -------------------- */
const score = eng.buildScore(chart, true);
expect(score.timeSig[0] === 4 && score.timeSig[1] === 4, `expected 4/4, got ${score.timeSig.join("/")}`);
expect(score.bars.length === 165, `expected 165 scored bars, got ${score.bars.length}`);

for (const b of score.bars) {
  const ev = b.events;
  if (!ev.length) { fails.push(`bar ${b.number} has no chord events`); continue; }
  if (ev[0].beat !== 0) fails.push(`bar ${b.number}: first chord not on the downbeat (beat ${ev[0].beat})`);
  for (let i = 0; i < ev.length; i++) {
    if (ev[i].beat < 0 || ev[i].beat > 3) fails.push(`bar ${b.number}: beat ${ev[i].beat} out of 0..3`);
    if (i > 0 && ev[i].beat <= ev[i - 1].beat) fails.push(`bar ${b.number}: beats not strictly increasing`);
  }
  const sum = ev.reduce((s, e) => s + e.durBeats, 0);
  if (sum !== 4) fails.push(`bar ${b.number}: durations sum to ${sum}, expected 4`);
}

// at least one bar must place multiple chords on distinct beats
const multi = score.bars.filter((b) => b.events.length >= 2);
expect(multi.length > 0, "expected at least one multi-chord bar with beat placement");

// the bridge turn (bar 126 = "B C#m A") should be three chords in order on rising beats
const b126 = score.bars.find((b) => b.number === 126);
if (b126) {
  const syms = b126.events.map((e) => e.symbol);
  expect(JSON.stringify(syms) === JSON.stringify(["B", "C#m", "A"]),
    `bar 126 events expected [B, C#m, A], got [${syms.join(", ")}]`);
}

/* ---- simplify: aggregate each bar to one chord (dense-transcription mode) -- */
const simp = eng.simplifyScore(score, true);
expect(simp.bars.length === 165 && simp.bars.every((b) => b.events.length <= 1), "simplify → at most one chord per bar");
const sv = simp.bars.slice(0, 8).map((b) => (b.events[0] ? b.events[0].symbol : "-")).join(" ");
expect(sv === "E A A E E A A E", `simplified verse expected "E A A E E A A E", got "${sv}"`);
expect(simp.bars[0].events[0].beat === 0 && simp.bars[0].events[0].durBeats === 4, "simplified bar = one downbeat chord filling the bar");

/* ---- isMelodicScore: auto-Simplify gate for arpeggiated / single-note charts -- */
// A block-harmony chart (Blue Sky PDF, all multi-note voicings) is NOT melodic.
expect(eng.isMelodicScore(score) === false, "block-harmony chart should not read as melodic");
expect(eng.melodicFraction(score) < 0.5, "Blue Sky single-note fraction should be < 0.5");
// An arpeggiated bar (each event one note) reads as melodic → auto-Simplify.
const arpScore = { timeSig: [4, 4], bars: [{ number: 1, events: [
  { symbol: "B", beat: 0, durBeats: 1, midis: [59] }, { symbol: "Ab", beat: 1, durBeats: 1, midis: [56] },
  { symbol: "F#", beat: 2, durBeats: 1, midis: [54] }, { symbol: "B", beat: 3, durBeats: 1, midis: [59] },
] }] };
expect(eng.isMelodicScore(arpScore) === true, "an all-single-note (arpeggiated) chart should read as melodic");
expect(eng.melodicFraction(arpScore) === 1, "a pure single-note chart is 100% melodic");
// too few events → not melodic (avoids over-triggering on a tiny chart)
expect(eng.isMelodicScore({ timeSig: [4, 4], bars: [{ number: 1, events: [{ symbol: "B", beat: 0, durBeats: 4, midis: [59] }] }] }) === false, "a single-event chart is below the minEvents gate");
// a mixed chart under threshold stays non-melodic (block chords dominate)
const mixed = { timeSig: [4, 4], bars: [{ number: 1, events: [
  { symbol: "C", beat: 0, durBeats: 1, midis: [48, 52, 55] }, { symbol: "G", beat: 1, durBeats: 1, midis: [55, 59, 62] },
  { symbol: "A", beat: 2, durBeats: 1, midis: [57] }, { symbol: "F", beat: 3, durBeats: 1, midis: [53, 57, 60] },
] }] };
expect(eng.isMelodicScore(mixed) === false, "a mostly-block-chord chart (25% single) is not melodic");

/* ---- Path C: MusicXML import (explicit meter + tuning + rhythm) ----------- */
const xml = fs.readFileSync(path.join(here, "fixtures", "sample.musicxml"), "utf8");
const mx = eng.parseMusicXML(xml, true);
expect(mx.source === "musicxml", "MusicXML score should be tagged source=musicxml");
expect(mx.tuning === "Standard", `expected Standard tuning from staff-tuning, got ${mx.tuning}`);
expect(mx.bars.length === 3, `expected 3 bars, got ${mx.bars.length}`);

const mxSyms = mx.bars.map((b) => b.events.map((e) => e.symbol).join(" "));
expect(mxSyms[0] === "C G", `bar 1 expected "C G", got "${mxSyms[0]}"`);
expect(mxSyms[1] === "Am", `bar 2 expected "Am", got "${mxSyms[1]}"`);
expect(mxSyms[2] === "F", `bar 3 expected "F", got "${mxSyms[2]}"`);

// bar 1: C on beat 1 (dur 2), G on beat 3 (dur 2) in 4/4
const e1 = mx.bars[0].events;
expect(e1[0].beat === 0 && e1[0].durBeats === 2, `bar1 C expected beat0/dur2, got beat${e1[0].beat}/dur${e1[0].durBeats}`);
expect(e1[1].beat === 2 && e1[1].durBeats === 2, `bar1 G expected beat2/dur2, got beat${e1[1].beat}/dur${e1[1].durBeats}`);
// mid-tune meter change: bar 3 is 3/4 and its single chord fills all 3 beats
expect(JSON.stringify(mx.bars[2].timeSig) === JSON.stringify([3, 4]), `bar3 expected 3/4, got ${mx.bars[2].timeSig.join("/")}`);
expect(mx.bars[2].events[0].durBeats === 3, `bar3 F expected dur3 (fills 3/4), got ${mx.bars[2].events[0].durBeats}`);
// pitch present → real MIDI carried through (C major = C3 E3 G3 = 48,52,55)
expect(JSON.stringify(e1[0].midis) === JSON.stringify([48, 52, 55]), `bar1 C midis expected [48,52,55], got [${e1[0].midis}]`);
// the pitch-less note (E3 via string4/fret2) resolved through the tuning fallback
expect(e1[0].midis.includes(52), "fret-only note (string4/fret2) should resolve to E3=52 via tuning");

/* ---- exporters: ChordPro + ABC, with an edit override applied ------------- */
const overrides = { "2.0": "A7" }; // user re-spells bar 2's Am as A7
const cp = eng.scoreToChordPro(mx, { overrides });
expect(/\{start_of_grid\}/.test(cp) && /\{end_of_grid\}/.test(cp), "ChordPro should wrap a grid");
expect(/\| C G \| A7 \| F \|/.test(cp), `ChordPro grid should reflect the override, got:\n${cp}`);
const abc = eng.scoreToABC(mx, { overrides });
expect(/^X:1/m.test(abc) && /M:4\/4/.test(abc) && /K:C/.test(abc), "ABC should have a valid header");
expect(/\[M:3\/4\]/.test(abc), "ABC should mark the mid-tune 3/4 change");
expect(/"A7"/.test(abc), "ABC should carry the A7 override as a chord annotation");
// C3-E3-G3 → ABC [C,E,G,] (C4/middle-C is "C", so C3 is "C,"), half note = 2 L-units
expect(/"C"\[C,E,G,\]2/.test(abc), `ABC should voice C3 major as [C,E,G,] half-note, got:\n${abc}`);

/* ---- CSMPN export (Chord Sheet Maker Pro's native source) ----------------- */
const csmpn = eng.scoreToCSMPN(mx, { overrides, title: "Demo", tempo: 120, key: eng.analyzeKey(mx) });
expect(/^Title: Demo$/m.test(csmpn), `CSMPN should carry a Title header, got:\n${csmpn}`);
expect(/^Time: 4\/4$/m.test(csmpn), "CSMPN should carry the Time header");
expect(/^Tempo: 120$/m.test(csmpn), "CSMPN should carry the Tempo header");
expect(/^Key: C$/m.test(csmpn), "CSMPN should carry the detected key");
expect(/^- Chart$/m.test(csmpn), "CSMPN should emit a section marker");
// CSMPN native (chordsheet.com) grammar: bars are delimited by explicit `|` barlines
// (`||` at the section/chart end), and a multi-chord bar joins chords with `_` (Bb7_A7),
// NOT spaces (which CSMP's parseBarStructures would read as separate bars). mx bar1 =
// {C,G} → "C_G"; bar2 override A7; bar3 F; last bar closes with `||`.
expect(/^C_G \| A7 \| F \|\|$/m.test(csmpn), `CSMPN bars: pipe-delimited, multi-chord bar uses _ (got:\n${csmpn})`);
// round-trip: feed the CSMPN bars back as MusicXML-free text — the chord grid survives.
expect(!/\{start_of_grid\}/.test(csmpn), "CSMPN must NOT use ChordPro grid directives (native pipe bars only)");

/* ---- ChordSlashML export (CSMP's beat-slotted notation) ------------------- */
const csml = eng.scoreToCSML(mx, { overrides, title: "Demo", key: eng.analyzeKey(mx) });
expect(/^Title: Demo$/m.test(csml) && /^Time: 4\/4$/m.test(csml), "CSML should carry headers");
expect(/^\[Chart\]$/m.test(csml), "CSML should use [Section] labels (square brackets)");
// Beat slots follow each bar's own meter: bar1 4/4 C@0 G@2 → "C _ G _"; bar2 4/4 A7;
// bar3 is the mid-tune 3/4 change → only 3 slots ("F _ _"). `_` holds the prev chord.
expect(/^\| C _ G _ \| A7 _ _ _ \| F _ _ \|$/m.test(csml), `CSML measures should be beat-slotted (per-bar meter), got:\n${csml}`);
expect(!/\{/.test(csml), "CSML must NOT emit CSMPN {tab}/{hybrid} blocks (different format)");
// compound meter: 12/8 → 4 dotted-quarter slots; a chord at qbeat 6 lands on slot 2.
const c128 = eng.scoreToCSML({ timeSig: [12, 8], bars: [{ number: 1, events: [
  { symbol: "Bb7", beat: 0, durBeats: 6, qbeat: 0, qdur: 6, midis: [58] },
  { symbol: "A7", beat: 6, durBeats: 6, qbeat: 6, qdur: 6, midis: [57] },
] }] }, {});
expect(/^\| Bb7 _ A7 _ \|$/m.test(c128), `CSML 12/8 should map to 4 slots, got:\n${c128}`);

/* ---- sections + repeats + endings carry into both exports --------------- */
// A score with section labels, a |: … :| repeat, and 1st/2nd endings (the markers
// GP/MusicXML carry but the export used to drop). Mirrors the GP measure-header /
// gpif <Section>/<Repeat>/<AlternateEndings> data.
const structScore = { timeSig: [4, 4], bars: [
  { number: 1, section: "Intro", repeatStart: true, events: [{ symbol: "C", beat: 0, durBeats: 4, qbeat: 0, qdur: 4, midis: [48] }] },
  { number: 2, repeatEnd: true, events: [{ symbol: "G", beat: 0, durBeats: 4, qbeat: 0, qdur: 4, midis: [55] }] },
  { number: 3, section: "Verse", ending: "1", events: [{ symbol: "Am", beat: 0, durBeats: 4, qbeat: 0, qdur: 4, midis: [57] }] },
  { number: 4, ending: "2", events: [{ symbol: "F", beat: 0, durBeats: 4, qbeat: 0, qdur: 4, midis: [53] }] },
] };
const sc = eng.scoreToCSMPN(structScore, { tab: false, hybrid: false });
expect(/^- Intro$/m.test(sc) && /^- Verse$/m.test(sc), `CSMPN should emit section markers, got:\n${sc}`);
expect(/\|: C/.test(sc) && /G :\|/.test(sc), `CSMPN should emit |: … :| repeat barlines, got:\n${sc}`);
expect(/(^|\s)1\. Am(\s|$)/m.test(sc) && /(^|\s)2\. F(\s|$)/m.test(sc), `CSMPN should emit 1./2. ending tokens, got:\n${sc}`);
const sl = eng.scoreToCSML(structScore, {});
expect(/^\[Intro\]$/m.test(sl) && /^\[Verse\]$/m.test(sl), `CSML should emit [Section] labels, got:\n${sl}`);
expect(/^\|: C _ _ _ \| G _ _ _ :\|$/m.test(sl), `CSML should emit |: … :| repeat barlines, got:\n${sl}`);
expect(/^\[1st Ending\]$/m.test(sl) && /^\[2nd Ending\]$/m.test(sl), `CSML should emit [Nth Ending] labels, got:\n${sl}`);
// a section-less score still falls back to one - Chart / [Chart] block (mx fixture, above)
expect(/^- Chart$/m.test(csmpn) && /^\[Chart\]$/m.test(csml), "section-less score → - Chart / [Chart]");

/* ---- CSMPN {tab} + {hybrid} fidelity blocks (deterministic synthetic score) -- */
// Event.frets is {engIdx→fret}, engIdx 0 = low E … 5 = high e. The {tab} voicing
// must come out high-e→low-E, with absent strings muted ("x").
const richScore = { timeSig: [4, 4], bars: [
  { number: 1, events: [
    { symbol: "G", beat: 0, durBeats: 2, qbeat: 0, qdur: 2, midis: [55, 59, 62], frets: { 0: 3, 1: 2, 2: 0, 3: 0, 4: 0, 5: 3 } },
    { symbol: "C", beat: 2, durBeats: 2, qbeat: 2, qdur: 2, midis: [48, 52, 55], frets: { 1: 3, 2: 2, 4: 1 } },
  ] },
] };
const rich = eng.scoreToCSMPN(richScore, { title: "Rich" });
// {tab}: G frets {0:3,1:2,2:0,3:0,4:0,5:3} → eng 5,4,3,2,1,0 = 3,0,0,0,2,3
expect(/\{tab\b/.test(rich) && /\}/.test(rich), `CSMPN should emit a {tab} block, got:\n${rich}`);
expect(/^ {2}G: 3,0,0,0,2,3$/m.test(rich), `G voicing should be high-e→low-E "3,0,0,0,2,3", got:\n${rich}`);
// C frets {1:3,2:2,4:1} → eng 5=x,4=1,3=x,2=2,1=3,0=x = x,1,x,2,3,x
expect(/^ {2}C: x,1,x,2,3,x$/m.test(rich), `C voicing should mute absent strings, got:\n${rich}`);
// {hybrid}: G@beat1 (2 beats=half), C@beat3 (2 beats=half) → "bar1: 1:h(G) 3:h(C)"
expect(/\{hybrid\b/.test(rich), `CSMPN should emit a {hybrid} block, got:\n${rich}`);
expect(/^ {2}bar1: 1:h\(G\) 3:h\(C\)$/m.test(rich), `hybrid rhythm should place G/C as half-note slashes on beats 1 & 3, got:\n${rich}`);
// opt-outs: the blocks can be suppressed (plain fakebook)
const plain = eng.scoreToCSMPN(richScore, { title: "Plain", tab: false, hybrid: false });
expect(!/\{tab\b/.test(plain) && !/\{hybrid\b/.test(plain), "tab:false/hybrid:false should suppress both blocks");
// transposed scores drop frets → no {tab} block (a transposed fingering would be wrong)
const richT = eng.transposeScore(richScore, 2, true);
expect(!/\{tab\b/.test(eng.scoreToCSMPN(richT, {})), "transposed score should NOT emit {tab} (frets are dropped)");

/* ---- CSMPN {hybrid} tuplet `tN` flag (Phase 1 fidelity) ------------------- */
// An eighth-note triplet of three distinct chords filling beat 1, then a chord on
// beat 2. Triplet events carry tuplet:3 and notate as eighths (sounding 1/3 quarter
// → written `e` via the N/normal recovery); the lone beat-2 chord stays un-flagged.
const tupScore = { timeSig: [4, 4], bars: [
  { number: 1, events: [
    { symbol: "Dm7", beat: 0, durBeats: 1, qbeat: 0, qdur: 1 / 3, midis: [50, 53, 57, 60], tuplet: 3 },
    { symbol: "G7", beat: 0, durBeats: 1, qbeat: 1 / 3, qdur: 1 / 3, midis: [43, 47, 50, 53], tuplet: 3 },
    { symbol: "C", beat: 1, durBeats: 1, qbeat: 2 / 3, qdur: 1 / 3, midis: [48, 52, 55], tuplet: 3 },
    { symbol: "F", beat: 1, durBeats: 3, qbeat: 1, qdur: 3, midis: [53, 57, 60], tuplet: 0 },
  ] },
] };
const tcsmpn = eng.scoreToCSMPN(tupScore, { title: "Trip" });
expect(/bar1: 1:e\(Dm7\)t3 1:e\(G7\)t3 1&:e\(C\)t3 2:h\(F\)/.test(tcsmpn), `triplet run should emit t3 on each grouped eighth (written value e) and leave the lone chord un-flagged, got:\n${tcsmpn}`);
// a lone tuplet event (no same-tuplet neighbour) must NOT draw a bracket
const loneScore = { timeSig: [4, 4], bars: [{ number: 1, events: [
  { symbol: "C", beat: 0, durBeats: 2, qbeat: 0, qdur: 2, midis: [48, 52, 55], tuplet: 3 },
  { symbol: "G", beat: 2, durBeats: 2, qbeat: 2, qdur: 2, midis: [55, 59, 62], tuplet: 0 },
] }] };
expect(!/t3/.test(eng.scoreToCSMPN(loneScore, {})), "a lone tuplet event must not emit a tN bracket");

/* ---- procedural arranger (Roadmap Wave 2 #8) ----------------------------- */
// quarters: one strum per beat; a multi-chord bar follows its changes (C..G..)
const arrQ = eng.arrangeScore(mx, "quarters"); // mx = C G | Am | F (bar3 in 3/4)
expect(arrQ.arrangedAs === "quarters", "arrangeScore tags arrangedAs");
expect(arrQ.bars[0].events.length === 4, `quarters bar1 expected 4 hits, got ${arrQ.bars[0].events.length}`);
expect(arrQ.bars[0].events.map((e) => e.symbol).join(" ") === "C C G G", `quarters bar1 should track the changes "C C G G", got "${arrQ.bars[0].events.map((e) => e.symbol).join(" ")}"`);
// meter honoured: bar3 is 3/4 → exactly 3 hits
expect(arrQ.bars[2].timeSig.join("/") === "3/4" && arrQ.bars[2].events.length === 3, `quarters bar3 (3/4) expected 3 hits, got ${arrQ.bars[2].events.length}`);
// each hit carries the chord's pitches → MIDI/playback/ABC all work downstream
expect(JSON.stringify(arrQ.bars[0].events[0].midis) === JSON.stringify([48, 52, 55]), "quarters hits carry the chord's midis (C triad)");
// eighths: two per beat → 8 hits in a 4/4 bar
expect(eng.arrangeScore(mx, "eighths").bars[0].events.length === 8, "eighths bar1 expected 8 hits");
// block: keep the existing onsets (the harmonic rhythm) → C G
expect(eng.arrangeScore(mx, "block").bars[0].events.map((e) => e.symbol).join(" ") === "C G", "block keeps the existing onsets (C G)");
// shuffle: swung eighths flagged tuplet 3 → CSMPN {hybrid} draws t3 brackets
const arrS = eng.arrangeScore(mx, "shuffle");
expect(arrS.bars[0].events.length === 8 && arrS.bars[0].events.every((e) => e.tuplet === 3), "shuffle bar1 expected 8 tuplet-3 hits");
expect(/t3/.test(eng.scoreToCSMPN(arrS, {})), "shuffle arrangement should export t3 tuplet flags in CSMPN {hybrid}");
// sixteenths: four hits per beat → 16 in a 4/4 bar, on true quarter-beat positions
const arr16 = eng.arrangeScore(mx, "sixteenths");
expect(arr16.bars[0].events.length === 16, `sixteenths bar1 expected 16 hits, got ${arr16.bars[0].events.length}`);
expect(Math.abs(arr16.bars[0].events[1].qbeat - 0.25) < 1e-9, `sixteenths 2nd hit qbeat expected 0.25, got ${arr16.bars[0].events[1].qbeat}`);
expect(arr16.bars[2].events.length === 12, `sixteenths bar3 (3/4) expected 12 hits, got ${arr16.bars[2].events.length}`);
// skank: reggae off-beat — one hit per beat on the "&" (first onset at qbeat 0.5), tracks changes
const arrK = eng.arrangeScore(mx, "skank");
expect(arrK.bars[0].events.length === 4 && Math.abs(arrK.bars[0].events[0].qbeat - 0.5) < 1e-9, `skank bar1 expected 4 off-beat hits starting at 0.5, got ${arrK.bars[0].events.length}@${arrK.bars[0].events[0].qbeat}`);
expect(arrK.bars[0].events.map((e) => e.symbol).join(" ") === "C C G G", `skank bar1 should track the changes, got "${arrK.bars[0].events.map((e) => e.symbol).join(" ")}"`);
expect(arrK.bars[2].events.length === 3, `skank bar3 (3/4) expected 3 hits, got ${arrK.bars[2].events.length}`);
// arranged score flows through the existing exporters unchanged
expect(/\{hybrid\b/.test(eng.scoreToCSMPN(arrQ, {})), "arranged score still exports a {hybrid} block");
// playback/MIDI scale with the added hits (4 + 4 + 3 = 11 events for quarters)
expect(eng.scoreEventTimes(arrQ, 120).events.length === 11, `arranged quarters expected 11 timed events, got ${eng.scoreEventTimes(arrQ, 120).events.length}`);
// unknown template → safe passthrough (returns the same object, never throws)
expect(eng.arrangeScore(mx, "nope") === mx, "unknown template is a passthrough");
// deterministic
expect(JSON.stringify(eng.arrangeScore(mx, "quarters")) === JSON.stringify(arrQ), "arrangeScore is deterministic");

/* ---- multi-part: the part picker selects which instrument to chart -------- */
const mpXml = fs.readFileSync(path.join(here, "fixtures", "sample-multipart.musicxml"), "utf8");
const p0 = eng.parseMusicXML(mpXml, true, 0);
expect(p0.parts.length === 2 && p0.parts.map((p) => p.name).join(",") === "Guitar,Rhythm",
  `expected 2 parts [Guitar,Rhythm], got [${p0.parts.map((p) => p.name)}]`);
expect(p0.partIndex === 0 && p0.bars[0].events[0].symbol === "C", `part 0 (Guitar) should chart C, got ${p0.bars[0].events[0].symbol}`);
const p1 = eng.parseMusicXML(mpXml, true, 1);
expect(p1.partIndex === 1 && p1.bars[0].events[0].symbol === "G", `part 1 (Rhythm) should chart G, got ${p1.bars[0].events[0].symbol}`);
// single-part files still report one part (no picker shown)
expect(mx.parts.length === 1, `single-part file should report 1 part, got ${mx.parts.length}`);

/* ---- transpose: re-recognise from shifted MIDI --------------------------- */
const up2 = eng.transposeScore(mx, 2, true); // C G | Am | F  ->  D A | Bm | G
expect(up2.bars[0].events.map((e) => e.symbol).join(" ") === "D A", `+2 st bar1 expected "D A", got "${up2.bars[0].events.map((e) => e.symbol).join(" ")}"`);
expect(up2.bars[1].events[0].symbol === "Bm", `+2 st bar2 expected "Bm", got "${up2.bars[1].events[0].symbol}"`);
expect(up2.bars[2].events[0].symbol === "G", `+2 st bar3 expected "G", got "${up2.bars[2].events[0].symbol}"`);
expect(eng.transposeScore(mx, 0, true) === mx, "transpose by 0 should be a passthrough");

/* ---- playback scheduling (pure timing math) ------------------------------ */
expect(mx.tempo === 120, `expected tempo 120 from <sound>, got ${mx.tempo}`);
const sched = eng.scoreEventTimes(mx, mx.tempo); // 120 BPM → 0.5s per quarter
const ev = sched.events;
expect(ev.length === 4, `expected 4 scheduled events (C G Am F), got ${ev.length}`);
expect(Math.abs(ev[0].start - 0) < 1e-9 && Math.abs(ev[0].dur - 1) < 1e-9, `C: expected start0/dur1s, got ${ev[0].start}/${ev[0].dur}`);
expect(Math.abs(ev[1].start - 1) < 1e-9, `G: expected start 1.0s (beat 3), got ${ev[1].start}`);
expect(Math.abs(ev[2].start - 2) < 1e-9 && Math.abs(ev[2].dur - 2) < 1e-9, `Am: expected start2/dur2s (whole bar), got ${ev[2].start}/${ev[2].dur}`);
// bar 3 is 3/4 → starts at 8 quarters = 4.0s; its dotted-half fills 3 quarters = 1.5s
expect(Math.abs(ev[3].start - 4) < 1e-9 && Math.abs(ev[3].dur - 1.5) < 1e-9, `F: expected start4/dur1.5s, got ${ev[3].start}/${ev[3].dur}`);
expect(Math.abs(sched.duration - 5.5) < 1e-9, `total expected 5.5s (4+4+3 quarters @0.5), got ${sched.duration}`);
expect(JSON.stringify(ev[0].midis) === JSON.stringify([48, 52, 55]), `C event should carry MIDI [48,52,55], got [${ev[0].midis}]`);

/* ---- MusicXML export round-trip (export → re-parse → identical) ---------- */
const xmlOut = eng.scoreToMusicXML(mx, { tempo: 120, useSharp: true });
expect(/<score-partwise/.test(xmlOut) && /<harmony>/.test(xmlOut), "MusicXML export should be score-partwise with <harmony> chord symbols");
expect(/<sound tempo="120"\/>/.test(xmlOut), "MusicXML export should carry the tempo");
const rt = eng.parseMusicXML(xmlOut, true);
expect(rt.bars.length === mx.bars.length, `round-trip bar count ${rt.bars.length} != ${mx.bars.length}`);
const rtSyms = rt.bars.map((b) => b.events.map((e) => e.symbol).join(" "));
expect(JSON.stringify(rtSyms) === JSON.stringify(mxSyms), `round-trip chords drifted: ${rtSyms.join(" | ")} vs ${mxSyms.join(" | ")}`);
expect(JSON.stringify(rt.bars[2].timeSig) === JSON.stringify([3, 4]), `round-trip should preserve the 3/4 change, got ${rt.bars[2].timeSig.join("/")}`);
expect(rt.tempo === 120, `round-trip tempo expected 120, got ${rt.tempo}`);
// an edit override flows into the <harmony> symbol (the notes stay the original
// voicing, so a notes-based re-parse still reads Am — that's expected)
const xmlEdit = eng.scoreToMusicXML(mx, { overrides: { "2.0": "A7" } });
expect(/<kind>dominant<\/kind>/.test(xmlEdit), "override A7 should appear as a dominant <harmony> in MusicXML");
expect(!/<kind>dominant<\/kind>/.test(xmlOut), "baseline export (C G | Am | F) has no dominant chord");
// scale check: round-trip the full Blue Sky score through MusicXML
const bsRt = eng.parseMusicXML(eng.scoreToMusicXML(score, { useSharp: true }), true);
expect(bsRt.bars.length === 165, `Blue Sky MusicXML round-trip expected 165 bars, got ${bsRt.bars.length}`);
const bsVerse = bsRt.bars.slice(0, 8).map((b) => b.events.map((e) => e.symbol).join(" ")).join(" ");
expect(bsVerse === "E A A E E A A E", `Blue Sky round-trip verse drifted: "${bsVerse}"`);

/* ---- MIDI export (deterministic SMF; same timing model as ABC/playback) --- */
function _parseMidi(bytes) {
  // minimal SMF format-0 walker: returns header facts + noteOn pitches + noteOff count
  const u8 = bytes; let i = 0;
  const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  if (tag(0) !== "MThd") throw new Error("missing MThd");
  const division = (u8[12] << 8) | u8[13];
  i = 8 + ((u8[4] << 24) | (u8[5] << 16) | (u8[6] << 8) | u8[7]); // past header chunk
  if (tag(i) !== "MTrk") throw new Error("missing MTrk");
  const trkLen = (u8[i + 4] << 24) | (u8[i + 5] << 16) | (u8[i + 6] << 8) | u8[i + 7];
  let p = i + 8; const end = p + trkLen;
  const readVar = () => { let v = 0, b; do { b = u8[p++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
  const ons = []; let offs = 0, tempo = 0, endOfTrack = false;
  while (p < end) {
    readVar(); // delta
    const status = u8[p++];
    if (status === 0xFF) { const type = u8[p++]; const len = readVar(); if (type === 0x51) tempo = (u8[p] << 16) | (u8[p + 1] << 8) | u8[p + 2]; if (type === 0x2F) { endOfTrack = true; p += len; break; } p += len; }
    else if ((status & 0xf0) === 0x90) { const n = u8[p++], vel = u8[p++]; if (vel > 0) ons.push(n); else offs++; }
    else if ((status & 0xf0) === 0x80) { p++; p++; offs++; }
    else { p += 2; } // unexpected — skip 2 data bytes
  }
  return { division, ons, offs, tempo, endOfTrack };
}
const midiBytes = eng.scoreToMidi(mx, { tempo: 120 });
expect(midiBytes instanceof Uint8Array && midiBytes.length > 22, "scoreToMidi returns a non-trivial Uint8Array");
const midi = _parseMidi(midiBytes);
expect(midi.division === 480, `MIDI division expected 480, got ${midi.division}`);
expect(midi.tempo === 500000, `MIDI tempo at 120bpm expected 500000us/qtr, got ${midi.tempo}`);
expect(midi.endOfTrack, "MIDI track must end with an End-of-Track meta");
const mxNotes = mx.bars.flatMap((b) => b.events).reduce((s, e) => s + (e.midis ? e.midis.length : 0), 0);
expect(midi.ons.length === mxNotes, `MIDI note-on count ${midi.ons.length} should match the ${mxNotes} voiced pitches`);
expect(midi.offs === midi.ons.length, `every MIDI note-on must have a note-off (${midi.ons.length} on / ${midi.offs} off)`);
// the C-major triad on the downbeat (bar1 = [48,52,55]) must appear as note-ons
expect([48, 52, 55].every((n) => midi.ons.includes(n)), `MIDI should contain the C triad pitches, got [${midi.ons.slice(0, 6).join(",")}]`);
// transpose +2 then export: pitches shift up a tone (50/54/57)
const midiT = _parseMidi(eng.scoreToMidi(eng.transposeScore(mx, 2, true), { tempo: 120 }));
expect([50, 54, 57].every((n) => midiT.ons.includes(n)), "transposed MIDI should contain the D triad pitches");
// deterministic
expect(eng.scoreToMidi(mx, { tempo: 120 }).join(",") === midiBytes.join(","), "scoreToMidi must be deterministic");

/* ---- key + roman-numeral analysis ---------------------------------------- */
const mxKey = eng.analyzeKey(mx); // C G | Am | F  ->  C major
expect(mxKey && eng.keyName(mxKey, true) === "C", `expected key of C major, got ${mxKey && eng.keyName(mxKey, true)}`);
const mxRomans = mx.bars.flatMap((b) => b.events.map((e) => eng.romanFor(e.symbol, mxKey))).join(" ");
expect(mxRomans === "I V vi IV", `expected "I V vi IV", got "${mxRomans}"`);

const bsKey = eng.analyzeKey(score); // Blue Sky verse E A … -> E major
expect(bsKey && eng.keyName(bsKey, true) === "E", `expected Blue Sky key of E major, got ${bsKey && eng.keyName(bsKey, true)}`);
expect(eng.romanFor("E", bsKey) === "I" && eng.romanFor("A", bsKey) === "IV" && eng.romanFor("B", bsKey) === "V",
  `E/A/B should be I/IV/V, got ${eng.romanFor("E", bsKey)}/${eng.romanFor("A", bsKey)}/${eng.romanFor("B", bsKey)}`);
expect(eng.romanFor("C#m", bsKey) === "vi", `C#m should be vi in E, got ${eng.romanFor("C#m", bsKey)}`);
expect(eng.romanFor("F#m7", bsKey) === "ii7", `F#m7 should be ii7 in E, got ${eng.romanFor("F#m7", bsKey)}`);

// detected key flows into exports (K: line / {key:} directive)
const abcK = eng.scoreToABC(mx, { key: mxKey, useSharp: true });
expect(/^K:C$/m.test(abcK), `ABC should carry K:C, got header:\n${abcK.split("\n").slice(0, 5).join("\n")}`);
const cpK = eng.scoreToChordPro(mx, { key: mxKey, useSharp: true });
expect(/\{key: C\}/.test(cpK), "ChordPro should carry {key: C}");

/* ---- Path D: Guitar Pro (GP7/8 .gp) import — cross-validates against the
 *      same Blue Sky ground truth the PDF path asserts, straight from the .gp
 *      ZIP (native unzip + gpif XML, no geometry). Rhythm-guitar track = #1.  */
const gpBuf = new Uint8Array(fs.readFileSync(path.join(repo, "blue-sky.gp")));
const gpXml = await eng.gpUnzip(gpBuf);
expect(/score\.gpif|<GPIF/.test(gpXml) || gpXml.includes("<MasterBar"), "gpUnzip should yield gpif XML");
const gp = await eng.parseGP(gpBuf, true, 1); // track 1 = Acoustic Guitar (the chord part)
expect(gp.source === "gp", "GP score should be tagged source=gp");
expect(gp.parts.length === 3, `expected 3 tracks, got ${gp.parts.length}`);
expect(gp.tuning === "Standard", `expected Standard tuning, got ${gp.tuning}`);
expect(gp.tempo === 100, `expected tempo 100, got ${gp.tempo}`);
expect(gp.bars.length === 165, `expected 165 bars, got ${gp.bars.length}`);
const gpBars = gp.bars.map((b) => [...new Set(b.events.map((e) => e.symbol))].join(" "));
const gpVerse = gpBars.slice(0, 8).join(" ");
expect(gpVerse === "E A A E E A A E", `GP verse expected "E A A E E A A E", got "${gpVerse}"`);
expect(gpBars[25] === "B C#m", `GP bar 26 expected "B C#m", got "${gpBars[25]}"`); // the bridge turn
// frets reconstruct exactly (fret + standard-tuning open string === the MIDI)
const STD = [40, 45, 50, 55, 59, 64];
let gpFretOk = true;
gp.bars.forEach((b) => b.events.forEach((e) => { if (e.frets) for (const [eng2, f] of Object.entries(e.frets)) if (!e.midis.includes(STD[+eng2] + f)) gpFretOk = false; }));
expect(gpFretOk, "GP frets should reconstruct their MIDI via standard tuning (String 0 = low E)");
// per-bar meter read straight from the file (Blue Sky opens 2/4)
expect(JSON.stringify(gp.bars[0].timeSig) === JSON.stringify([2, 4]), `GP bar1 meter expected 2/4, got ${gp.bars[0].timeSig.join("/")}`);
// ♯/♭ re-spell keeps the same part; export round-trips through MusicXML
const gpFlat = eng.parseGPIF(gpXml, false, 1);
expect(gpFlat.partIndex === 1 && gpFlat.bars.length === 165, "GP re-parse (flats) keeps part 1 and bar count");

/* ---- Path E: Guitar Pro 3/4/5 legacy BINARY import (parseGP345) ----------
 *      Cross-validates the binary reader against the SAME ground truth: Blue
 *      Sky gp3 reproduces the verse, Kid Charlemagne gp3 resolves the bars the
 *      PDF mis-anchored to the correct C7, and Peg gp4 reads Steely Dan jazz. */
const bs3 = eng.parseGP345(new Uint8Array(fs.readFileSync(path.join(repo, "the-allman-brothers-band-blue_sky.gp3"))), true, 2);
expect(bs3.source === "gp", "GP3 score tagged source=gp");
expect(bs3.tempo === 100 && bs3.tuning === "Standard", `GP3 expected tempo 100 / Standard, got ${bs3.tempo} / ${bs3.tuning}`);
const bs3Verse = bs3.bars.slice(0, 8).map((b) => [...new Set(b.events.map((e) => e.symbol))].join(" ")).join(" ");
expect(bs3Verse === "E A A E E A A E", `GP3 Blue Sky (track 3) verse expected "E A A E E A A E", got "${bs3Verse}"`);

const kc3 = eng.parseGP345(new Uint8Array(fs.readFileSync(path.join(repo, "steely-dan-kid_charlemegne.gp3"))), true, 0);
expect(kc3.parts[0].name === "Rhythm Guitar", `KC track 0 expected "Rhythm Guitar", got "${kc3.parts[0].name}"`);
const kc27 = [...new Set(kc3.bars[26].events.map((e) => e.symbol))].join(" ");
const kc28 = [...new Set(kc3.bars[27].events.map((e) => e.symbol))].join(" ");
expect(kc27 === "C7" && kc28 === "C7", `KC bars 27-28 expected C7/C7 (the PDF mis-read these as Fm7), got ${kc27}/${kc28}`);

/* ---- manual per-system string shift (Wave 2 #7) ------------------------------
 * The escape hatch for a mis-anchored staff. `topY` anchors to the highest digit row,
 * which is only right when the system plays the high e; when it doesn't, every note in
 * that system reads a string too high and the chords come out CONFIDENTLY WRONG. This
 * is validated against real ground truth: the Kid Charlemagne PDF reads bars 27-28 as
 * Fm7, the .gp3 says C7, and shift −1 on that one system fixes it.
 *
 * Per-SYSTEM (not global) is the whole point: the very next system in the same file is
 * already correct, and shifting it breaks it. */
{
  const kcTokens = (await extractTokens(new Uint8Array(fs.readFileSync(path.join(repo, "Kid Charlemagne - Steeley Dan.pdf"))))).tokens;
  const base = eng.buildChart(kcTokens);
  expect(Array.isArray(base.systems) && base.systems.length > 0, "buildChart reports the systems it found");
  const symAt = (chart, n) => {
    const bar = eng.buildScore(chart, true).bars.find((b) => b.number === n);
    return bar ? [...new Set(bar.events.map((e) => e.symbol))].join(" ") : "(none)";
  };
  expect(symAt(base, 27) === "Fm7", `baseline: the PDF mis-reads bar 27 as Fm7, got ${symAt(base, 27)}`);
  const sys27 = base.systems.find((s) => s.measures.indexOf(27) >= 0);
  expect(sys27 && sys27.firstMeasure === 26 && sys27.lastMeasure === 28,
    `bar 27's system should cover bars 26-28, got ${sys27 && sys27.firstMeasure}-${sys27 && sys27.lastMeasure}`);
  const fixed = eng.buildChart(kcTokens, { systemShifts: { [sys27.index]: -1 } });
  expect(symAt(fixed, 27) === "C7" && symAt(fixed, 28) === "C7",
    `shift −1 should recover the .gp3 truth C7/C7, got ${symAt(fixed, 27)}/${symAt(fixed, 28)}`);
  // the NEXT system is already correct — shifting it must break it (why this is per-system)
  const sys29 = base.systems.find((s) => s.measures.indexOf(29) >= 0);
  expect(symAt(base, 29) === "Am/C", `bar 29 is already correct at shift 0, got ${symAt(base, 29)}`);
  const overShifted = eng.buildChart(kcTokens, { systemShifts: { [sys29.index]: -1 } });
  expect(symAt(overShifted, 29) !== "Am/C", "shifting an already-correct system changes it (per-system granularity is load-bearing)");
  // and a shift on one system must not touch another
  expect(symAt(fixed, 29) === symAt(base, 29), "a shift is scoped to its own system");
}

const peg4 = eng.parseGP345(new Uint8Array(fs.readFileSync(path.join(repo, "Steely Dan - Peg.gp4"))), true, 3);
expect(peg4.parts[3].name === "Rhythm guitar", `Peg gp4 track 3 expected "Rhythm guitar", got "${peg4.parts[3].name}"`);
const peg4Bars = peg4.bars.slice(0, 5).map((b) => [...new Set(b.events.map((e) => e.symbol))].join(" ")).join(" | ");
expect(peg4Bars === "Gmaj7 | F#7 | Fmaj7 | E7 | Ebmaj7", `Peg gp4 bars 1-5 expected jazz changes, got "${peg4Bars}"`);

// GP5 — both sub-formats: Anthropology (v5.00, 2 tracks, part picker) + Au Privave (v5.10)
const anth5 = eng.parseGP345(new Uint8Array(fs.readFileSync(path.join(repo, "Charlie Parker - Anthropology.gp5"))), true, 1);
expect(anth5.source === "gp" && anth5.tempo === 184 && anth5.tuning === "Standard", `GP5 v5.00 expected tempo 184 / Standard, got ${anth5.tempo} / ${anth5.tuning}`);
expect(anth5.parts.length === 2 && anth5.parts[1].name === "Chords", `GP5 expected 2 parts incl. "Chords", got ${anth5.parts.map((p) => p.name).join(", ")}`);
const anth5Bars = anth5.bars.slice(0, 4).map((b) => [...new Set(b.events.map((e) => e.symbol))].join(" ")).join(" | ");
expect(anth5Bars === "Gm7/Bb G7 | Cm7 F7 | Gm7/Bb Gm7 | C7 F7", `GP5 Anthropology "Chords" bars 1-4 expected rhythm changes, got "${anth5Bars}"`);
const auPriv5 = eng.parseGP345(new Uint8Array(fs.readFileSync(path.join(repo, "Charlie Parker - Au Privave.gp5"))), true, 0);
expect(auPriv5.bars.length === 14 && auPriv5.tempo === 220 && auPriv5.tuning === "Standard", `GP5 v5.10 Au Privave expected 14 bars / tempo 220 / Standard, got ${auPriv5.bars.length} / ${auPriv5.tempo} / ${auPriv5.tuning}`);

/* ---- Tuning/Capo export headers (Integration idea #3) -------------------- */
// The GP parsers now carry the detected tuning + capo onto the score. The capo bytes
// were already being read+discarded, so this capture is alignment-neutral — the verse
// assertions above still pass, which is the proof it didn't shift the cursor.
expect(typeof bs3.capo === "number" && bs3.tuning === "Standard", `gp3 score should carry a numeric capo + Standard tuning, got capo=${bs3.capo} tuning=${bs3.tuning}`);
expect(typeof anth5.capo === "number", `gp5 score should carry a numeric capo, got ${anth5.capo}`);
// CSMPN + CSML emit "Tuning:" from score.tuning (Standard included → explicit + round-trips)
expect(/^Tuning: Standard$/m.test(eng.scoreToCSMPN(bs3, {})), "CSMPN should emit the detected Tuning header");
expect(/^Tuning: Standard$/m.test(eng.scoreToCSML(bs3, {})), "CSML should emit the detected Tuning header");
// synthetic score: a non-standard tuning + capo both surface in both formats
const perfScore = { timeSig: [4, 4], tuning: "Drop D", capo: 2, bars: [{ number: 1, events: [{ symbol: "D5", beat: 0, durBeats: 4, qbeat: 0, qdur: 4, midis: [38, 45, 50] }] }] };
const perfCsmpn = eng.scoreToCSMPN(perfScore, {});
expect(/^Tuning: Drop D$/m.test(perfCsmpn) && /^Capo: 2$/m.test(perfCsmpn), `CSMPN should emit Drop D tuning + Capo 2, got:\n${perfCsmpn}`);
expect(/^Tuning: Drop D$/m.test(eng.scoreToCSML(perfScore, {})) && /^Capo: 2$/m.test(eng.scoreToCSML(perfScore, {})), "CSML should emit Drop D tuning + Capo 2");
// opts override the score values
expect(/^Capo: 5$/m.test(eng.scoreToCSMPN(perfScore, { capo: 5 })), "opts.capo overrides score.capo");
// a score with no tuning/capo (e.g. a PDF chart) emits neither header
const plainPerf = { timeSig: [4, 4], bars: [{ number: 1, events: [{ symbol: "C", beat: 0, durBeats: 4, qbeat: 0, qdur: 4, midis: [48, 52, 55] }] }] };
expect(!/Tuning:/.test(eng.scoreToCSMPN(plainPerf, {})) && !/Capo:/.test(eng.scoreToCSMPN(plainPerf, {})), "no tuning/capo on the score → no headers (PDF-style)");
// capo 0 is omitted (never "Capo: 0")
expect(!/Capo:/.test(eng.scoreToCSMPN({ ...plainPerf, tuning: "Standard", capo: 0 }, {})), "capo 0 must be omitted");

/* ---- ABC export of a DENSE melodic line must never emit a 0 duration --------
 * Anthropology's track-0 head is straight eighths: ~8 onsets per 4/4 bar. The
 * integer beat/durBeats keep the chart grid happy, but the ABC exporter must use
 * the TRUE per-note duration (e.qdur) so eighths render as "/2", not an invalid
 * "0" multiplier (which collapses layout / drops notes in ABC renderers). */
const anthMelody = eng.parseGP345(new Uint8Array(fs.readFileSync(path.join(repo, "Charlie Parker - Anthropology.gp5"))), true, 0);
const anthAbc = eng.scoreToABC(anthMelody, { title: "Anthropology", tempo: anthMelody.tempo, useSharp: true });
const zeroDur = /(?:\]|[a-gA-G][,'^_=]*)0(?=[\s|]|$)/.test(anthAbc); // a note/chord followed by a bare 0 length
expect(!zeroDur, "ABC export of a dense melody must not contain any 0-duration multiplier (invalid ABC)");
expect(anthAbc.includes("/2"), "ABC export of an eighth-note line should render eighths as /2");
// every event's true duration is strictly positive
expect(anthMelody.bars.every((b) => b.events.every((e) => (e.qdur ?? e.durBeats) > 0)), "every event must have a strictly-positive true duration (qdur)");

/* ---- Path F: Guitar Pro 6 (.gpx) — BCFZ/BCFS container → gpif → parseGPIF.
 *      PyGuitarPro can't read GPX, so we validate that the bit-level decompressor
 *      + sector filesystem yield a coherent score: a single decompression error
 *      cascades into garbage, so recognizable chords across encodings is a strong
 *      check. Covers all three GP6 note encodings: String+Fret, and Tone+Octave. */
const yard6 = await eng.parseGPX(new Uint8Array(fs.readFileSync(path.join(repo, "Charlie Parker - Yardbird Suite.gpx"))), true, 1);
expect(yard6.source === "gp" && yard6.tempo === 224 && yard6.tuning === "Standard", `GP6 Yardbird expected tempo 224 / Standard, got ${yard6.tempo} / ${yard6.tuning}`);
expect(yard6.bars.length === 17, `GP6 Yardbird expected 17 bars, got ${yard6.bars.length}`);
const yard6Bars = yard6.bars.slice(1, 7).map((b) => [...new Set(b.events.map((e) => e.symbol))].join(" ")).join(" | ");
// Bars 2 and 6 were `Am6/F#` and `Gm6/E` before the narrow half-diminished bass rule.
// Same pitch classes either way (Am6 = A C E F# = F#m7♭5); with the bass ON the m7♭5
// root, `F#m7♭5` / `Em7♭5` is the reading every jazz lead sheet uses — the iiø of a
// minor ii–V — and `Am6/F#` is what a naive analyzer emits. This expectation was
// deliberately updated; see the halfDimBass rule in recognise().
expect(yard6Bars === "Em7 | F#m7♭5 Ebaug/B | Em7 | C#aug/A | Dm7 | Em7♭5 C#aug/A", `GP6 Yardbird "simple chords" (String+Fret) unexpected: "${yard6Bars}"`);
// The Weight — String+Fret guitar, key of A (recognizable chords)
const weight6 = await eng.parseGPX(new Uint8Array(fs.readFileSync(path.join(repo, "band-the_weight.gpx"))), true, 0);
expect(weight6.bars[0].events.some((e) => e.symbol === "C#m") && weight6.bars[0].events.some((e) => e.symbol === "F#m"), `GP6 The Weight bar 1 expected C#m + F#m, got ${weight6.bars[0].events.map((e) => e.symbol).join(" ")}`);
// My Favorite Things — piano part, Tone+Octave pitch encoding (no String/Fret)
const mft6 = await eng.parseGPX(new Uint8Array(fs.readFileSync(path.join(repo, "John Coltrane - My Favorite Things.gpx"))), true, 0);
const mft6NonEmpty = mft6.bars.filter((b) => b.events.length).length;
expect(mft6.parts[0].name.includes("Piano") && mft6NonEmpty > 30, `GP6 My Favorite Things (Tone+Octave) expected a populated piano part, got ${mft6NonEmpty} bars on "${mft6.parts[0].name}"`);
// decompression integrity: every scored bar maps to a real MasterBar (no truncation)
expect(yard6.bars.length === 17 && weight6.bars.length === 63, `GP6 bar counts should match MasterBars (Yardbird 17, Weight 63), got ${yard6.bars.length} / ${weight6.bars.length}`);

/* ---- Path G: Power Tab (.ptb) — MFC-style binary deserialization ----------
 *      No oracle exists (like GP6); the validation is the same: the MFC
 *      serialization must consume every object exactly, and the notes
 *      (string+fret → MIDI via tuning) must reconstruct recognizable music. */
const tunePtb = eng.parsePowerTab(new Uint8Array(fs.readFileSync(path.join(here, "fixtures", "tune.ptb"))), true);
expect(tunePtb.source === "gp" && tunePtb.tuning === "Standard", `PTB tune expected source=gp / Standard, got ${tunePtb.source} / ${tunePtb.tuning}`);
// single-note events are now the bare note ("E"), NOT "E (single)" — so no .replace() needed.
const tuneSyms = tunePtb.bars[0].events.map((e) => e.symbol).join(" ");
expect(tuneSyms === "E B G D A E", `PTB tune (open strings, proves string+fret+tuning math) expected "E B G D A E", got "${tuneSyms}"`);
// House of the Rising Sun — recognizable 6/8 Am arpeggio; proves measure segmentation + meter
const hotrs = eng.parsePowerTab(new Uint8Array(fs.readFileSync(path.join(here, "fixtures", "house-of-the-rising-sun.ptb"))), true);
expect(JSON.stringify(hotrs.bars[0].timeSig) === JSON.stringify([6, 8]), `PTB HotRS expected 6/8 meter, got ${hotrs.bars[0].timeSig.join("/")}`);
const hotrsBar1 = hotrs.bars[0].events.map((e) => e.symbol).join(" ");
expect(hotrsBar1 === "A E A C E C G", `PTB HotRS bar 1 expected the Am arpeggio "A E A C E C G", got "${hotrsBar1}"`);
// the song's chords (Am, C, D, F) appear across the opening bars
const hotrsRoots = new Set(hotrs.bars.slice(0, 4).flatMap((b) => b.events.map((e) => e.symbol[0])));
expect(["A", "C", "D", "F"].every((r) => hotrsRoots.has(r)), `PTB HotRS opening should span A/C/D/F roots, got ${[...hotrsRoots].join("")}`);

/* ---- extended/altered chord qualities (additive QUALITIES expansion) ------
 * The new qualities must recognise their own voicings AND must NOT over-label the
 * plainer chords (a triad stays a triad, a 7th stays a 7th — they only win when the
 * voicing genuinely contains the extension). Roots at C: useSharp leaves the literal
 * ♭/♯ in the suffix. The validated-corpus progressions above are the regression guard
 * that none of these displaced an existing recognition. */
const q = (midis) => eng.symbolForMidis(midis, true);
// each NEW quality recognises its canonical voicing
expect(q([48, 52, 55, 62]) === "Cadd9", `add9 {C E G D} expected Cadd9, got ${q([48, 52, 55, 62])}`);
expect(q([48, 52, 55, 57, 62]) === "C6/9", `6/9 {C E G A D} expected C6/9, got ${q([48, 52, 55, 57, 62])}`);
expect(q([48, 51, 55, 59]) === "Cm(maj7)", `minor-major7 {C Eb G B} expected Cm(maj7), got ${q([48, 51, 55, 59])}`);
expect(q([48, 52, 55, 58, 62]) === "C9", `dom9 {C E G Bb D} expected C9, got ${q([48, 52, 55, 58, 62])}`);
expect(q([48, 51, 55, 58, 62]) === "Cm9", `min9 {C Eb G Bb D} expected Cm9, got ${q([48, 51, 55, 58, 62])}`);
expect(q([48, 52, 55, 59, 62]) === "Cmaj9", `maj9 {C E G B D} expected Cmaj9, got ${q([48, 52, 55, 59, 62])}`);
expect(q([48, 52, 55, 58, 61]) === "C7♭9", `7b9 {C E G Bb Db} expected C7♭9, got ${q([48, 52, 55, 58, 61])}`);
expect(q([48, 52, 55, 58, 63]) === "C7♯9", `7#9 {C E G Bb D#} expected C7♯9, got ${q([48, 52, 55, 58, 63])}`);
// plainer chords are NOT over-labelled by the new richer qualities
expect(q([48, 52, 55]) === "C", `plain triad must stay C, got ${q([48, 52, 55])}`);
expect(q([48, 52, 55, 59]) === "Cmaj7", `maj7 must stay Cmaj7 (not maj9), got ${q([48, 52, 55, 59])}`);
expect(q([48, 52, 55, 58]) === "C7", `dom7 must stay C7 (not 9), got ${q([48, 52, 55, 58])}`);
expect(q([48, 51, 55, 58]) === "Cm7", `m7 must stay Cm7 (not m9), got ${q([48, 51, 55, 58])}`);
// {C E G A} is enharmonic with Am7 (rooted on the 6th); m7 (rank 3) out-ranks 6 (rank 9)
// on that tie → Am7/C. PRE-EXISTING behavior — the 6/9 addition scores lower here, so it
// doesn't change this; the assertion just guards that 6/9 didn't start grabbing plain 6ths.
expect(q([48, 52, 55, 57]) === "Am7/C", `{C E G A} stays Am7/C (m7 out-ranks the enharmonic 6; 6/9 must not override), got ${q([48, 52, 55, 57])}`);

/* ---- opt-in `maxRank` triad/7th bias (audio over-labelling fix) -----------
 * Polyphonic vocal/instrument chroma lights 4+ pcs, so the scorer over-labels 9ths/
 * extensions. `recognise(..., { maxRank })` caps complexity (basic chords ≤14, jazz
 * extensions ≥15) — OPT-IN so the tab/PDF/GP/XML oracle stays byte-identical. */
{
  const pcs = [0, 2, 4, 7, 10];                                 // C D E G Bb = C9
  const def = eng.recognise(pcs, eng.makeMask(pcs), null);      // default (no opts)
  expect(def.best.quality.suffix === "9", `default still recognises the 9 (oracle unchanged), got "${def.best.quality.suffix}"`);
  const cap = eng.recognise(pcs, eng.makeMask(pcs), null, { maxRank: 14 });
  expect(cap.best.quality.rank <= 14 && cap.best.quality.suffix !== "9", `maxRank 14 drops the extension (got rank ${cap.best.quality.rank} "${cap.best.quality.suffix}")`);
  // flows through chordFromChroma → transcribeChords (the audio path)
  const ch = new Array(12).fill(0); for (const p of pcs) ch[p] = 1;
  expect(eng.chordFromChroma(ch, {}).symbol === "C9", "chordFromChroma default → C9");
  expect(eng.chordFromChroma(ch, { maxRank: 14 }).symbol !== "C9", "chordFromChroma maxRank 14 → not C9");
}

/* ---- Wave 3 #10: chord-quality classifier + confidence-gated arbiter -------
 * Pure-JS 2-layer MLP brain (weights code-gen'd by scripts/train_chord_classifier.py).
 * The engine stays the ORACLE; the classifier is a gated second opinion. */
const vec = (pcs) => { const v = new Array(12).fill(0); pcs.forEach((p) => { v[((p % 12) + 12) % 12] = 1; }); return v; };
const reco = (midis) => { const n = eng.normalise(midis.map((m) => ({ midi: m }))); return eng.recognise(n.chroma, n.chordMask, n.bassPc); };
// the classifier recognises every canonical (root-relative) quality in its 22-class vocab
const canon = [[[0, 4, 7], ""], [[0, 3, 7], "m"], [[0, 4, 7, 10], "7"], [[0, 4, 7, 11], "maj7"],
  [[0, 3, 7, 10], "m7"], [[0, 3, 6], "dim"], [[0, 4, 8], "aug"], [[0, 5, 7], "sus4"],
  [[0, 2, 7], "sus2"], [[0, 4, 7, 9], "6"], [[0, 3, 7, 9], "m6"], [[0, 3, 6, 10], "m7♭5"],
  [[0, 3, 6, 9], "dim7"], [[0, 5, 7, 10], "7sus4"], [[0, 2, 4, 7], "add9"], [[0, 3, 7, 11], "m(maj7)"],
  [[0, 2, 4, 7, 9], "6/9"], [[0, 2, 4, 7, 10], "9"], [[0, 2, 3, 7, 10], "m9"], [[0, 2, 4, 7, 11], "maj9"],
  [[0, 1, 4, 7, 10], "7♭9"], [[0, 3, 4, 7, 10], "7♯9"]];
for (const [pcs, suf] of canon) {
  const got = eng.classifyChromaQuality(vec(pcs), 0).suffix;
  expect(got === suf, `classifier canonical {${pcs}} expected "${suf}", got "${got}"`);
}
// root-relative: a D-minor voicing classified at root 2 → m
expect(eng.classifyChromaQuality(vec([2, 5, 9]), 2).suffix === "m", "classifier root-relative: D minor -> m");
expect(eng.classifyChromaQuality([0, 0, 0], 0) === null, "classifier rejects a non-12-length input");
// arbiter CONTRACT: a confident engine is NEVER overridden
const confident = reco([48, 52, 55]); // clean C major → conf ≈ 1
expect(confident.best.confidence >= 0.999, `clean C major engine conf should be ~1, got ${confident.best.confidence}`);
expect(eng.arbitrateChord(confident, vec([0, 4, 7])).source === "engine", "confident engine is never overridden");
// unsure engine + a clearly-minor chroma → classifier second opinion adopted (same root, quality m)
const unsure = reco([48, 52, 55]); unsure.best = { ...unsure.best, confidence: 0.5 };
const a2 = eng.arbitrateChord(unsure, vec([0, 3, 7]));
expect(a2.source === "classifier" && a2.result.best.quality.suffix === "m", `unsure engine + minor chroma -> classifier m, got ${a2.source}/${a2.result.best.quality.suffix}`);
// ...but only if the model clears minModel — raise the bar and the oracle stands
expect(eng.arbitrateChord(unsure, vec([0, 3, 7]), { minModel: 0.999 }).source === "engine", "model below minModel -> keep the oracle");
// single-note / null results bypass the classifier entirely
expect(eng.arbitrateChord({ single: true }, vec([0])).source === "engine", "single-note -> engine");
expect(eng.arbitrateChord(null, vec([0, 4, 7])).source === "engine", "null result -> engine");

/* ---- Wave 3 #11: pitch detection (YIN) + monophonic transcription ----------
 * Pure DSP — fed synthesized tones (the browser-only seam is mic capture). */
const SR = 44100;
const tone = (freq, secs, harmonics = [1, 0.5, 0.25]) => {
  const n = Math.floor(secs * SR), a = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; harmonics.forEach((amp, h) => { s += amp * Math.sin(2 * Math.PI * freq * (h + 1) * i / SR); }); a[i] = s * 0.4; }
  return a;
};
expect(Math.round(eng.freqToMidi(440)) === 69, "freqToMidi(440) = A4 = 69");
expect(Math.abs(eng.midiToFreq(69) - 440) < 1e-9, "midiToFreq(69) = 440");
expect(eng.midiToNoteName(69, true) === "A4" && eng.midiToNoteName(40, true) === "E2" && eng.midiToNoteName(60, true) === "C4", "midiToNoteName: 69→A4, 40→E2, 60→C4");
// detect a clear A4 (with harmonics) — fundamental, not an overtone
const a4 = eng.detectPitch(tone(440, 0.05), SR);
expect(a4 && a4.midi === 69, `detectPitch A4 → midi 69, got ${a4 && a4.midi}`);
expect(a4 && a4.clarity > 0.8, `A4 clarity should be high, got ${a4 && a4.clarity}`);
// guitar low E2 (82.41 Hz) with strong harmonics — YIN must lock the fundamental, not 2×
const e2 = eng.detectPitch(tone(82.41, 0.07), SR);
expect(e2 && e2.midi === 40, `detectPitch E2 → midi 40, got ${e2 && e2.midi}`);
// across the range
for (const [f, m] of [[110, 45], [261.63, 60], [329.63, 64], [493.88, 71]]) {
  const r = eng.detectPitch(tone(f, 0.05), SR);
  expect(r && r.midi === m, `detectPitch ${f}Hz → midi ${m}, got ${r && r.midi}`);
}
// silence → no confident pitch
expect(eng.detectPitch(new Float32Array(2048), SR) === null, "silence → no pitch");
// monophonic transcription: A4 (0.3s) then C5 (0.3s) → two note events 69, 72
const buf = new Float32Array(Math.floor(0.6 * SR));
buf.set(tone(440, 0.3), 0); buf.set(tone(523.25, 0.3), Math.floor(0.3 * SR));
const notes = eng.transcribeMonophonic(buf, SR);
const tmidis = notes.map((n) => n.midi);
expect(tmidis.includes(69) && tmidis.includes(72), `transcribe A4→C5 should yield 69 & 72, got [${tmidis}]`);
expect(notes.every((n) => n.durSec > 0 && typeof n.note === "string"), "transcription notes carry positive durations + names");

/* ---- staff layout (digital staff view math) --------------------------------
 * Pure pitch→position math for the UI's SVG staff (StaffView). Steps count
 * from the clef's bottom line (treble E4 / bass G2), +1 per line-or-space. */
{
  const e4 = eng.midiToStaffPos(64);
  expect(e4.letter === "E" && e4.acc === "" && e4.octave === 4 && e4.diat === 30 && e4.name === "E4", `midiToStaffPos E4, got ${JSON.stringify(e4)}`);
  const cs4 = eng.midiToStaffPos(61);
  expect(cs4.letter === "C" && cs4.acc === "#" && cs4.diat === 28, `C#4 spells C + ♯ on C4's position, got ${JSON.stringify(cs4)}`);
  const db4 = eng.midiToStaffPos(61, false);
  expect(db4.letter === "D" && db4.acc === "b" && db4.diat === 29, `flats: 61 spells Db4 on D4's position, got ${JSON.stringify(db4)}`);
  const bb3 = eng.midiToStaffPos(58);
  expect(bb3.letter === "B" && bb3.acc === "b" && bb3.octave === 3, `family default spells 58 as Bb3, got ${JSON.stringify(bb3)}`);
  const t = eng.staffLayout([64, 60, 66, 77]); // E4 C4 F#4 F5 → a vocal register → treble
  expect(t.clef === "treble", `vocal register picks treble clef, got ${t.clef}`);
  expect(t.notes[0].step === 0, `E4 = treble bottom line (step 0), got ${t.notes[0].step}`);
  expect(t.notes[1].step === -2, `middle C = first ledger below treble (step −2), got ${t.notes[1].step}`);
  expect(t.notes[2].step === 1 && t.notes[2].acc === "#", `F#4 = bottom space + ♯, got ${JSON.stringify(t.notes[2])}`);
  expect(t.notes[3].step === 8, `F5 = treble top line (step 8), got ${t.notes[3].step}`);
  const b = eng.staffLayout([40, 45, 43]); // E2 A2 G2 → a bass register → bass clef
  expect(b.clef === "bass", `bass register picks bass clef, got ${b.clef}`);
  expect(b.notes[2].step === 0, `G2 = bass bottom line (step 0), got ${b.notes[2].step}`);
  expect(eng.staffLayout([40], true, { clef: "treble" }).clef === "treble", "clef override is honoured");
  expect(eng.staffLayout([]).notes.length === 0, "empty note list → empty layout");
}

/* ---- audio → chroma → CHORD (clean isolated chordal stem) ------------------
 * Pure DSP: FFT → 12-bin chromagram → the SAME chord engine. Fed synthesized
 * chord tones (each note + 2 harmonics, like a real instrument). The MP3→PCM
 * decode is the only browser-only step. */
const chordSig = (freqs, secs) => {
  const n = Math.floor(secs * SR), a = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (const f of freqs) { s += Math.sin(2 * Math.PI * f * i / SR) + 0.35 * Math.sin(2 * Math.PI * 2 * f * i / SR) + 0.18 * Math.sin(2 * Math.PI * 3 * f * i / SR); } a[i] = (s / freqs.length) * 0.4; }
  return a;
};
// _fft sanity: a pure cosine at bin 4 has its magnitude peak at bin 4
{
  const N = 64, re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = Math.cos(2 * Math.PI * 4 * i / N);
  eng._fft(re, im);
  let peak = 1; for (let k = 2; k < N / 2; k++) if (Math.hypot(re[k], im[k]) > Math.hypot(re[peak], im[peak])) peak = k;
  expect(peak === 4, `_fft cosine@4 should peak at bin 4, got ${peak}`);
}
// detectChord on synthesized triads/7ths (with harmonics)
expect(eng.detectChord(chordSig([261.63, 329.63, 392.00], 0.25), SR).symbol === "C", `detectChord C major → C, got ${eng.detectChord(chordSig([261.63, 329.63, 392.00], 0.25), SR).symbol}`);
expect(eng.detectChord(chordSig([220.00, 261.63, 329.63], 0.25), SR).symbol === "Am", `detectChord A minor → Am, got ${eng.detectChord(chordSig([220.00, 261.63, 329.63], 0.25), SR).symbol}`);
expect(eng.detectChord(chordSig([196.00, 246.94, 293.66, 349.23], 0.25), SR).symbol === "G7", `detectChord G7 → G7, got ${eng.detectChord(chordSig([196.00, 246.94, 293.66, 349.23], 0.25), SR).symbol}`);
// pcmToChroma peaks at the chord tones (C/E/G for C major)
const ch = eng.pcmToChroma(chordSig([261.63, 329.63, 392.00], 0.2), SR);
expect(ch[0] > 0.5 && ch[4] > 0.5 && ch[7] > 0.5, `C-major chroma should peak at C,E,G, got [${ch.map((v) => v.toFixed(2))}]`);
// transcribeChords over a C (0.5s) → G (0.5s) progression → two chord events
const cg = new Float32Array(Math.floor(1.0 * SR));
cg.set(chordSig([261.63, 329.63, 392.00], 0.5), 0);
cg.set(chordSig([196.00, 246.94, 293.66], 0.5), Math.floor(0.5 * SR));
const chords = eng.transcribeChords(cg, SR);
expect(chords.some((c) => c.symbol === "C") && chords.some((c) => c.symbol === "G"), `transcribeChords C→G should yield C and G, got [${chords.map((c) => c.symbol)}]`);
// events carry a voiced MIDI set (so the chart/export/playback work)
expect(chords.every((c) => Array.isArray(c.midis) && c.midis.length >= 2), "transcribeChords events carry a voiced midis[]");
// noise robustness: a clean sustained chord stays stable (not a flood of flips)
const cev = eng.transcribeChords(chordSig([261.63, 329.63, 392.00], 1.2), SR);
expect(cev.length >= 1 && cev.every((c) => c.symbol === "C"), `clean sustained C should stay stable "C", got [${cev.map((c) => c.symbol)}]`);
// energy gate: silence → no chords (no garbage from a quiet/rest passage)
expect(eng.transcribeChords(new Float32Array(SR), SR).length === 0, "silence → no chords (energy gate)");

/* ---- center-channel (vocal) isolation ------------------------------------
 * Vocals sit in the CENTER (equal L/R); instruments are panned. extractCenter keeps the
 * centered content and drops the panned content, spectral-domain — the zero-dep karaoke
 * trick, so an isolated vocal stem can be charted for its sung harmony. */
{
  const tone = (freq, secs, amp = 0.4) => { const n = Math.floor(secs * SR), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = amp * Math.sin(2 * Math.PI * freq * i / SR); return a; };
  const A = tone(440, 1.2), E = tone(329.63, 1.2);              // A4 (centered), E4 (panned left)
  const L = new Float32Array(A.length), R = new Float32Array(A.length);
  for (let i = 0; i < A.length; i++) { L[i] = A[i] + E[i]; R[i] = A[i]; } // A centered, E only in L
  const out = eng.extractCenter(L, R, SR);
  const ch = eng.pcmToChroma(out.subarray(4096, 8192), SR);
  expect(out.length === L.length, `extractCenter preserves length, got ${out.length} vs ${L.length}`);
  expect(ch[9] > 0.9 && ch[4] < 0.15, `center isolation keeps A (pc9=${ch[9].toFixed(2)}) and drops panned E (pc4=${ch[4].toFixed(2)})`);
  // identity: a purely centered signal (L==R) reconstructs ~unchanged (center weight ~1)
  const id = eng.extractCenter(A, A, SR);
  let eIn = 0, eOut = 0; for (let i = 4096; i < 8192; i++) { eIn += A[i] * A[i]; eOut += id[i] * id[i]; }
  expect(eOut / eIn > 0.9 && eOut / eIn < 1.1, `centered-only signal reconstructs ~unchanged, energy ratio ${(eOut / eIn).toFixed(3)}`);
}

/* ---- harmonicClarity + the A/B (mix vs isolated) --------------------------
 * The per-file yardstick for whether center-extraction actually cleans up the harmony
 * (and thus whether a heavy ML separator would be worth its download): clarity = mean
 * chroma participation ratio, high for a clean chord, low for noise/mud. The A/B reads
 * clarity of the raw downmix vs. the isolated center — isolation should RAISE it when the
 * mud is panned/incoherent (which extractCenter removes). */
{
  const tone = (freq, secs, amp = 0.4) => { const n = Math.floor(secs * SR), a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = amp * Math.sin(2 * Math.PI * freq * i / SR); return a; };
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const triad = new Float32Array(Math.floor(1.5 * SR));
  for (const m of [48, 52, 55]) { const t = tone(hz(m), 1.5, 0.4); for (let i = 0; i < t.length; i++) triad[i] += t[i]; }
  const noise = new Float32Array(triad.length); for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() * 2 - 1) * 0.5; // broadband mud (drums/bleed)
  const clClean = eng.harmonicClarity(triad, SR);
  const mud = new Float32Array(triad.length); for (let i = 0; i < mud.length; i++) mud[i] = triad[i] + noise[i];
  const clMud = eng.harmonicClarity(mud, SR);
  expect(clClean > clMud, `clarity: a clean triad (${clClean}) reads higher than the same triad + noise (${clMud})`);
  expect(eng.harmonicClarity(noise, SR) < clClean, "clarity: broadband noise reads lower than a clean chord");
  expect(eng.harmonicClarity(new Float32Array(SR), SR) === 0, "clarity: silence → 0 (energy gate)");
  // A/B: centered triad + LEFT-panned noise → isolation should raise clarity vs the downmix
  const L = mud, R = triad;                                    // noise only in L (panned)
  const mono = new Float32Array(L.length); for (let i = 0; i < L.length; i++) mono[i] = (L[i] + R[i]) / 2;
  const iso = eng.extractCenter(L, R, SR);
  const clMix = eng.harmonicClarity(mono, SR), clIso = eng.harmonicClarity(iso, SR);
  expect(clIso > clMix, `A/B: isolating the center raises clarity vs the downmix (iso ${clIso} > mix ${clMix})`);
}

/* ---- audioEventsToScore: timed chord events → the shared score shape -------- */
const aev = [
  { symbol: "C", midis: [48, 52, 55], startSec: 0.0, durSec: 1.0 },
  { symbol: "G", midis: [55, 59, 62], startSec: 1.0, durSec: 1.0 },
  { symbol: "Am", midis: [57, 60, 64], startSec: 2.0, durSec: 2.0 },
]; // at 120bpm (0.5s/beat, 4/4): C bar1 beat1, G bar1 beat3, Am bar2 beat1
const asc = eng.audioEventsToScore(aev, { bpm: 120, beatsPerBar: 4 });
expect(asc.source === "audio" && asc.tempo === 120, "audioEventsToScore tags source=audio + tempo");
expect(asc.bars.length === 2, `expected 2 bars, got ${asc.bars.length}`);
expect(asc.bars[0].events.map((e) => e.symbol).join(" ") === "C G", `bar1 expected "C G", got "${asc.bars[0].events.map((e) => e.symbol).join(" ")}"`);
expect(asc.bars[0].events[0].beat === 0 && asc.bars[0].events[1].beat === 2, `bar1 beats expected 0 & 2, got ${asc.bars[0].events[0].beat} & ${asc.bars[0].events[1].beat}`);
expect(asc.bars[1].events[0].symbol === "Am" && asc.bars[1].events[0].midis.length === 3, "bar2 = Am with voiced midis");
// flows through the existing exporters (the whole point — audio → CSMPN handoff)
const acsmpn = eng.scoreToCSMPN(asc, { title: "From Audio", tempo: 120 });
expect(/Title: From Audio/.test(acsmpn), "audio score exports to CSMPN");
expect(eng.scoreToMidi(asc, { tempo: 120 }) instanceof Uint8Array, "audio score exports to MIDI");
// faster tempo (240bpm → 0.25s/beat) packs the same seconds into more bars
expect(eng.audioEventsToScore(aev, { bpm: 240, beatsPerBar: 4 }).bars.length === 3, "bpm changes the beat grid (240bpm → 3 bars)");

/* ---- held chords fill their bars (a sustain is NOT "no chord") ---------------
 * Keying bars off ONSETS alone made every bar inside a multi-bar hold export as a
 * false `N.C.` — on a real stem at 160bpm that was 9 of 14 N.C. bars. A bar with no
 * onset but covered by a sustaining event now carries that event (flagged `held`), so
 * scoreToCSMPN collapses it to `%` (simile) and playback/MIDI/ABC sustain. A bar NO
 * event covers stays empty: genuinely unlabelled must stay honestly N.C. */
const hev = [
  { symbol: "C", midis: [48, 52, 55], startSec: 0, durSec: 8 },   // 4 bars at 120bpm
  { symbol: "G", midis: [43, 47, 50], startSec: 8, durSec: 2 },
  // 10–12s: nothing — a real hole
  { symbol: "F", midis: [41, 45, 48], startSec: 12, durSec: 2 },
];
const hsc = eng.audioEventsToScore(hev, { bpm: 120, beatsPerBar: 4 });
const hcells = hsc.bars.map((b) => b.events.map((e) => e.symbol).join("_") || "(empty)");
expect(hcells.join(" | ") === "C | C | C | C | G | (empty) | F",
  `held-chord bars expected "C | C | C | C | G | (empty) | F", got "${hcells.join(" | ")}"`);
expect(hsc.bars[1]?.events[0]?.held === true && !hsc.bars[0]?.events[0]?.held, "sustained bars are flagged held; the onset bar is not");
expect(hsc.bars[5]?.events.length === 0, "a bar no event covers stays empty (honest N.C.)");
const hcs = eng.scoreToCSMPN(hsc, { title: "H", tab: false, hybrid: false });
expect((hcs.match(/%/g) || []).length === 3, `three held bars should export as three % similes, got ${(hcs.match(/%/g) || []).length}`);
expect(/N\.C\./.test(hcs), "the genuinely uncovered bar still exports as N.C.");

/* ---- narrow half-diminished bass rule + beat-sync inversions -----------------
 * m6 and the m7♭5 a minor-3rd below are the same four pitch classes, and m6 (rank 10)
 * out-ranked m7♭5 (rank 12), so the Tristan chord read `Abm6/F` instead of `Fø7`. When
 * the BASS is the m7♭5 root the half-diminished reading is the one every lead sheet
 * uses. Deliberately narrow — only m6-vs-m7♭5, only when the bass is exactly root+9. */
{
  expect(eng.symbolForMidis([53, 59, 63, 68], true) === "Fm7♭5", `Tristan chord F B D# G# should read Fm7♭5, got ${eng.symbolForMidis([53, 59, 63, 68], true)}`);
  expect(eng.symbolForMidis([59, 62, 65, 69], true) === "Bm7♭5", `B D F A should read Bm7♭5, got ${eng.symbolForMidis([59, 62, 65, 69], true)}`);
  // a genuine ROOT-POSITION m6 must not move
  expect(eng.symbolForMidis([57, 60, 64, 66], true) === "Am6", `root-position Am6 must stay Am6, got ${eng.symbolForMidis([57, 60, 64, 66], true)}`);
  expect(eng.symbolForMidis([60, 63, 67, 69], true) === "Cm6", `root-position Cm6 must stay Cm6, got ${eng.symbolForMidis([60, 63, 67, 69], true)}`);
  // nothing else shifts — including the long-standing {C,E,G,A}/C → Am7/C reading
  expect(eng.symbolForMidis([60, 64, 67, 69], true) === "Am7/C", "the C6/Am7 enharmonic reading is unchanged");
  for (const [midis, want] of [[[60, 64, 67], "C"], [[57, 60, 64, 67], "Am7"], [[60, 64, 67, 71], "Cmaj7"], [[60, 64, 67, 70], "C7"], [[60, 63, 66, 69], "Cdim7"]]) {
    expect(eng.symbolForMidis(midis, true) === want, `${want} must be unchanged, got ${eng.symbolForMidis(midis, true)}`);
  }
  // opt-out restores the old reading
  expect(eng.symbolOf(eng.recognise([3, 5, 8, 11], eng.makeMask([3, 5, 8, 11]), 5, { halfDimBass: false }), true) === "Abm6/F",
    "halfDimBass:false restores the previous m6 reading");
}

/* ---- beat tracking: onset envelope → tempo → DP beat path --------------------
 * The decoder had no tempo detection at all, so the bar grid hung off a hand-dialled
 * ♩= — the SAME Peg analysis gave 5 N.C. bars at 120bpm and 17 at 160bpm. Validated
 * here on a synthesized click at a known tempo; the real-file check is Peg, whose .gp4
 * says 117bpm and which the tracker reads as 117.7 (0.6% error). */
{
  const bpmTrue = 120, clickSec = 12, spb = 60 / bpmTrue;
  const click = new Float32Array(SR * clickSec);
  const tick = (at, amp, freq) => { for (let i = 0; i < SR * 0.03 && at + i < click.length; i++) click[at + i] += amp * Math.sin((2 * Math.PI * freq * i) / SR) * Math.exp(-i / (SR * 0.006)); };
  for (let beat = 0; beat * spb < clickSec; beat++) {
    tick(Math.floor(beat * spb * SR), 1.0, 1200);
    // Softer OFF-beat eighths. Without them the signal is too clean to catch the real
    // failure: un-normalised, the DP is tempted onto every sub-beat onset, which is how
    // Peg came out reporting 117bpm while laying beats at 171bpm.
    tick(Math.floor((beat + 0.5) * spb * SR), 0.45, 900);
  }
  const bt = eng.detectBeats(click, SR);
  expect(Math.abs(bt.bpm - bpmTrue) / bpmTrue < 0.05, `beat tracker should find ~${bpmTrue}bpm, got ${bt.bpm}`);
  // the beat COUNT must agree with the reported tempo — they came apart before the
  // onset envelope was normalised (Peg reported 117bpm while laying beats at 171bpm)
  const implied = ((bt.beats.length - 1) / (bt.beats[bt.beats.length - 1] - bt.beats[0])) * 60;
  expect(Math.abs(implied - bt.bpm) / bt.bpm < 0.05, `beat spacing (${implied.toFixed(1)}bpm) must match the reported tempo (${bt.bpm})`);
  expect(bt.beats.every((t, i) => i === 0 || t > bt.beats[i - 1]), "beat times are strictly increasing");
  expect(eng.detectBeats(new Float32Array(256), SR).beats.length === 0, "too-short input yields no beats, not a crash");
}

/* ---- beat-synchronous chroma + Viterbi ---------------------------------------
 * The sliding path labels each window independently, so an ambiguous span flips label
 * every 0.26s. Averaging chroma BETWEEN BEATS and decoding the whole sequence with a
 * change penalty fixes that. Measured on the real Peg stem against a DTW-time-aligned
 * Peg.gp4 (confidence 0.70): root accuracy 25.8% -> 38.7%, coverage 61% -> 100%. */
{
  // C major for 4 beats then G major for 4, at 120bpm (0.5s/beat)
  const bpmT = 120, beat = 60 / bpmT, sig = new Float32Array(SR * 8);
  const add = (t0, t1, freqs) => { for (let i = t0 * SR; i < t1 * SR && i < sig.length; i++) for (const f of freqs) sig[i] += Math.sin((2 * Math.PI * f * i) / SR) / freqs.length; };
  add(0, 4, [261.63, 329.63, 392.0]);
  add(4, 8, [392.0, 493.88, 587.33]);
  const beats = []; for (let t = 0; t < 8; t += beat) beats.push(t);
  const segs = eng.beatSegments(sig, SR, beats, {});
  expect(segs.length === beats.length - 1, `one segment per beat gap, got ${segs.length} for ${beats.length} beats`);
  expect(segs[0].bass && segs[0].bass.length === 12, "segments carry a separate bass-register chroma (root evidence)");
  const ev = Array.from(eng.transcribeChordsBeatSync(sig, SR, { beats }));
  expect(ev.some((e) => e.symbol === "C") && ev.some((e) => e.symbol === "G"), `beat-sync should decode C then G, got [${ev.map((e) => e.symbol)}]`);
  // every boundary lands ON a beat — that's the structural point of beat-sync
  const onBeat = (t) => beats.some((b) => Math.abs(b - t) < 1e-6);
  expect(ev.every((e) => onBeat(e.startSec)), `every chord change starts on a beat, got [${ev.map((e) => e.startSec)}]`);
  // Viterbi continuity: a passing tone on one beat must NOT flip the label. (Level
  // matters — at 0.9 against chord partials of 0.33 the "passing tone" IS the loudest
  // thing on the beat and flipping is correct; 0.25 is a realistic passing note.)
  const noisy = new Float32Array(sig);
  for (let i = Math.floor(2 * SR); i < Math.floor(2.5 * SR); i++) noisy[i] += Math.sin((2 * Math.PI * 466.16 * i) / SR) * 0.25;  // stray Bb
  const nev = Array.from(eng.transcribeChordsBeatSync(noisy, SR, { beats }));
  expect(nev.length <= ev.length + 1, `a passing tone must not shatter the decode (got ${nev.length} events vs ${ev.length})`);
  // the change penalty is real: crank it and the whole clip collapses to one chord
  const glued = Array.from(eng.transcribeChordsBeatSync(sig, SR, { beats, changePenalty: 5 }));
  expect(glued.length === 1, `a huge change penalty should yield a single chord, got ${glued.length}`);

  /* The bass register decides the ROOT. C6 and Am7 are the SAME four pitch classes —
   * the upper chroma cannot tell them apart, only the bass note can. This is the case
   * the separate bass chroma exists for, and it's the same ambiguity that makes the
   * Tristan chord read as Abm6/F instead of Fm7b5. */
  const upper = [261.63, 329.63, 392.0, 440.0];                 // C4 E4 G4 A4
  const withBass = (bassHz) => {
    const s = new Float32Array(SR * 4);
    for (let i = 0; i < s.length; i++) {
      for (const f of upper) s[i] += Math.sin((2 * Math.PI * f * i) / SR) / 6;
      s[i] += Math.sin((2 * Math.PI * bassHz * i) / SR) * 0.5;
    }
    return s;
  };
  const bts = [0, 1, 2, 3, 4];
  const rootOf = (sym) => (sym || "").replace(/^([A-G][#b]?).*$/, "$1");
  // minFreq:100 keeps the bass note OUT of the main chroma, so the bass band is the
  // only root evidence — otherwise the bass leaks into the main chroma and the test
  // passes for the wrong reason (it did, first time round).
  const iso = { beats: bts, maxRank: 14, minFreq: 100 };
  const overC = Array.from(eng.transcribeChordsBeatSync(withBass(65.41), SR, iso));   // C2
  const overA = Array.from(eng.transcribeChordsBeatSync(withBass(55.0), SR, iso));    // A1
  expect(rootOf(overC[0] && overC[0].symbol) !== rootOf(overA[0] && overA[0].symbol),
    `same pitch classes over a different bass must give a different root, got ${overC[0] && overC[0].symbol} vs ${overA[0] && overA[0].symbol}`);
  const flatC = Array.from(eng.transcribeChordsBeatSync(withBass(65.41), SR, { ...iso, bassWeight: 0 }));
  const flatA = Array.from(eng.transcribeChordsBeatSync(withBass(55.0), SR, { ...iso, bassWeight: 0 }));
  expect(rootOf(flatC[0] && flatC[0].symbol) === rootOf(flatA[0] && flatA[0].symbol),
    `with the bass evidence off the two collapse to one reading, got ${flatC[0] && flatC[0].symbol} vs ${flatA[0] && flatA[0].symbol}`);
  /* Inversions. The sliding path emitted slash chords and beat-sync did not — plain
   * root-position symbols only, a real loss for a fake book. A chord-tone bass now
   * names the inversion; a NON-chord-tone (passing) bass must not invent one. */
  /* 16kHz, NOT this file's 44.1k SR — and that is load-bearing, not incidental. The
   * audio panel downsamples to 16k before analysis, and bass resolution depends on it:
   * a 4096-pt FFT gives 3.9Hz bins at 16k but 10.8Hz at 44.1k, where E2 (82.4Hz) and
   * F2 (87.3Hz) land in the SAME bin and the bass band cannot tell them apart. Written
   * at 44.1k this fixture reports the E2 bass as F — a property of the fixture's rate,
   * not of the code under test. */
  const BSR = 16000;
  const triadOver = (bassHz) => {
    const s = new Float32Array(BSR * 4);
    for (let i = 0; i < s.length; i++) {
      for (const f of [261.63, 329.63, 392.0]) s[i] += Math.sin((2 * Math.PI * f * i) / BSR) / 6;   // C E G
      s[i] += Math.sin((2 * Math.PI * bassHz * i) / BSR) * 0.5;
    }
    return s;
  };
  const bBeats = [0, 1, 2, 3, 4];
  const overE = Array.from(eng.transcribeChordsBeatSync(triadOver(82.41), BSR, { beats: bBeats, maxRank: 14 }));  // E2 = chord tone
  expect(overE[0] && /\/E$/.test(overE[0].symbol), `a chord-tone bass should name the inversion, got ${overE[0] && overE[0].symbol}`);
  const overF = Array.from(eng.transcribeChordsBeatSync(triadOver(87.31), BSR, { beats: bBeats, maxRank: 14 }));  // F2 = NOT a chord tone
  expect(overF[0] && !/\/F$/.test(overF[0].symbol), `a passing (non-chord-tone) bass must not invent a slash, got ${overF[0] && overF[0].symbol}`);
  expect(Array.from(eng.transcribeChordsBeatSync(triadOver(82.41), BSR, { beats: bBeats, maxRank: 14, slash: false }))
    .every((e) => !e.symbol.includes("/")), "slash:false suppresses inversions");

  // …and the bass band itself measures what it claims: its chroma peaks on the bass
  // note. (Note the bass pitch also lands in the MAIN chroma — minFreq is 55Hz — so
  // "switch the bass weight off and the two collapse" is NOT a valid test of the
  // mechanism; this is.)
  const peakPc = (v) => { let b = 0; for (let p = 1; p < 12; p++) if (v[p] > v[b]) b = p; return b; };
  expect(peakPc(eng.beatSegments(withBass(65.41), SR, bts, {})[0].bass) === 0, "bass chroma peaks on C for a C2 bass");
  expect(peakPc(eng.beatSegments(withBass(55.0), SR, bts, {})[0].bass) === 9, "bass chroma peaks on A for an A1 bass");
}

/* ---- HPSS: drums out of the chroma before recognition ------------------------
 * Sustained pitched content is HORIZONTAL in a spectrogram, transients are VERTICAL,
 * so a median along time estimates the harmonic part and a median along frequency the
 * percussive one. Standard preprocessing for chord recognition — drums dump broadband
 * energy into every chroma bin, and a kick/snare on the downbeat is exactly where a
 * chord is most likely to be read. Measured on the real Peg stem against time-aligned
 * ground truth: root 40.2% -> 53.0%, majmin 37.4% -> 51.4%. */
{
  const HSR = 16000, dur = 4;
  // C major under repeated broadband transients ("drums"). Bursts must be FREQUENT
  // enough that a typical frame overlaps one — with sparse bursts most frames are clean
  // and the test passes with HPSS disabled, proving nothing (it did).
  const noisy = new Float32Array(HSR * dur);
  for (let i = 0; i < noisy.length; i++) for (const f of [261.63, 329.63, 392.0]) noisy[i] += Math.sin((2 * Math.PI * f * i) / HSR) / 3;
  for (let beat = 0; beat * 0.25 < dur; beat++) {
    const at = Math.floor(beat * 0.25 * HSR);
    for (let i = 0; i < HSR * 0.08 && at + i < noisy.length; i++) noisy[at + i] += (Math.random() * 2 - 1) * 3 * Math.exp(-i / (HSR * 0.02));
  }
  // Mean share of chroma energy sitting on the ACTUAL chord tones, over every frame.
  // Averaging over all frames (not one hand-picked one) is what makes this discriminate.
  const inChordFrac = (frames) => {
    let tot = 0;
    for (const fr of frames) {
      const c = Array.from(fr.chroma);
      const sum = c.reduce((a, b) => a + b, 0) || 1;
      tot += (c[0] + c[4] + c[7]) / sum;
    }
    return tot / (frames.length || 1);
  };
  const withHpss = eng.harmonicChromagram(noisy, HSR, { hopSec: 0.12 });
  const plain = eng.beatSegments(noisy, HSR, Array.from({ length: 17 }, (_, i) => i * 0.25), { hpss: false });
  expect(withHpss.length > 0 && withHpss[0].chroma.length === 12, "harmonicChromagram returns 12-bin chroma frames");
  const fH = inChordFrac(withHpss), fP = inChordFrac(plain);
  expect(fH > fP + 0.1, `HPSS should concentrate chroma on the real chord tones (got ${fH.toFixed(3)} vs unfiltered ${fP.toFixed(3)})`);
  expect(eng.harmonicChromagram(new Float32Array(64), HSR, {}).length === 0, "too-short input yields no frames, not a crash");
}

/* ---- HPSS feeds the Play-Along aligner too -----------------------------------
 * `pcmChromaSequence` takes an opt-in `hpss` so the DTW aligner can use the same
 * drum-suppressed chroma. Engine default stays OFF (the aligner's behaviour is pinned
 * by the tests below); the UI passes hpss:true. Measured on a real stem vs its .gp4:
 * confidence 0.697 -> 0.753, and the margin over a WRONG chart widens 0.103 -> 0.137,
 * so the low-confidence fallback still catches a mismatched stem. */
{
  const ASR = 16000;
  const sig = new Float32Array(ASR * 3);
  for (let i = 0; i < sig.length; i++) for (const f of [261.63, 329.63, 392.0]) sig[i] += Math.sin((2 * Math.PI * f * i) / ASR) / 3;
  const plainSeq = eng.pcmChromaSequence(sig, ASR, { hopSec: 0.25 });
  const hpssSeq = eng.pcmChromaSequence(sig, ASR, { hopSec: 0.25, hpss: true });
  expect(plainSeq.length > 0 && hpssSeq.length > 0, "pcmChromaSequence returns frames either way");
  expect(hpssSeq[0].chroma.length === 12 && typeof hpssSeq[0].energy === "number",
    "the hpss path returns the same frame shape the aligner consumes (chroma + energy)");
  // default must stay OFF so the pinned alignment behaviour is untouched
  const a = eng.pcmChromaSequence(sig, ASR, { hopSec: 0.25 });
  expect(JSON.stringify(Array.from(a[0].chroma)) === JSON.stringify(Array.from(plainSeq[0].chroma)),
    "pcmChromaSequence default is unchanged (hpss is opt-in)");
}

/* ---- analyzeAudioChords: the panel entry point returns chords AND tempo ------ */
{
  const bpmT = 120, sig = new Float32Array(SR * 6);
  for (let i = 0; i < sig.length; i++) for (const f of [261.63, 329.63, 392.0]) sig[i] += Math.sin((2 * Math.PI * f * i) / SR) / 3;
  for (let beat = 0; beat * 0.5 < 6; beat++) {                                  // add a click track so beats exist
    const at = Math.floor(beat * 0.5 * SR);
    for (let i = 0; i < SR * 0.02 && at + i < sig.length; i++) sig[at + i] += Math.sin((2 * Math.PI * 1500 * i) / SR) * Math.exp(-i / (SR * 0.004));
  }
  const r = eng.analyzeAudioChords(sig, SR);
  expect(Array.isArray(r.events) && r.events.length > 0, "analyzeAudioChords returns events");
  expect(r.method === "beat-sync" || r.method === "sliding", `method is reported, got ${r.method}`);
  expect(r.method !== "beat-sync" || Math.abs(r.bpm - bpmT) / bpmT < 0.1, `beat-sync path reports the tempo (~${bpmT}), got ${r.bpm}`);
  // no beat grid (pure silence) must still produce a result via the sliding fallback
  const quiet = eng.analyzeAudioChords(new Float32Array(SR), SR);
  expect(Array.isArray(quiet.events), "falls back rather than throwing when there is no pulse");

  /* Key prior. A chord whose notes all sit in the key is a better bet than one needing
   * an accidental, scored as the fraction of the chord's pcs in the scale — no chord-
   * function table, so it degrades gracefully instead of banning anything. Measured on
   * the real Peg stem: root 38.7% -> 40.2%. Here: in C major, an ambiguous chroma that
   * fits both C (diatonic) and Db (not) must resolve toward the diatonic one. */
  const cMajScale = [true, false, true, false, true, true, false, true, false, true, false, true];
  const segsOf = (chroma) => [0, 1, 2].map((i) => ({ t0: i, t1: i + 1, chroma, bass: new Float64Array(12), energy: 1 }));
  const st = eng.chordStates({ maxRank: 14 });
  // Db major slightly LOUDER than C major, so the non-diatonic reading wins on the
  // audio alone — otherwise C wins regardless and the test proves nothing (it did).
  const amb = new Float64Array(12);
  [1, 5, 8].forEach((p) => { amb[p] = 1.0; });      // Db F Ab — outside C major
  [0, 4, 7].forEach((p) => { amb[p] = 0.9; });      // C  E G  — inside
  const rootOfState = (p) => (p[0] < st.length ? st[p[0]].root : null);
  const noKey = rootOfState(eng.viterbiChords(segsOf(amb), st, { keyWeight: 0 }));
  const inKey = rootOfState(eng.viterbiChords(segsOf(amb), st, { keyScale: cMajScale, keyWeight: 0.3 }));
  expect(cMajScale[noKey] === false, `without a key the louder non-diatonic reading should win, got pc ${noKey}`);
  expect(cMajScale[inKey] === true, `the key prior should tip it to the diatonic reading, got pc ${inKey}`);
}

/* ---- adaptive energy gate: quiet passages are music, not silence -------------
 * A gate fixed at a fraction of the GLOBAL peak assumes one level for the whole
 * recording. On real wide-dynamic material (a Wagner prelude, peak ~28x the opening)
 * it discarded 42% of the piece as "silence" — including 100% of the quiet opening
 * where the harmony is. The reference is now a LOCAL peak, floored at a small
 * fraction of the global peak so true silence still gates out. */
{
  const quietLoud = new Float32Array(SR * 8);
  const put = (t0, t1, amp, freqs) => {
    for (let i = t0 * SR; i < t1 * SR; i++) for (const f of freqs) quietLoud[i] += (amp * Math.sin((2 * Math.PI * f * i) / SR)) / freqs.length;
  };
  put(0, 3, 0.02, [261.63, 329.63, 392.0]);   // quiet C major — ~2% of the loud part
  // 3–4s: silence
  put(4, 8, 1.0, [392.0, 493.88, 587.33]);    // loud G major
  // window must be shorter than the clip, or the local peak IS the global peak
  const base = { hopSec: 0.12, smoothSec: 0.5, energyGateWindowSec: 2 };
  const globalGate = eng.transcribeChords(quietLoud, SR, { ...base, energyGateWindowSec: 0 });
  const adaptive = eng.transcribeChords(quietLoud, SR, base);
  expect(!globalGate.some((e) => e.startSec < 3), "a global gate loses the quiet passage entirely (the bug)");
  expect(adaptive.some((e) => e.symbol === "C" && e.startSec < 3), `adaptive gate recovers the quiet C, got [${adaptive.map((e) => e.symbol + "@" + e.startSec)}]`);
  expect(adaptive.some((e) => e.symbol === "G"), "the loud passage still decodes under the adaptive gate");
  // the floor must still hold: real silence never becomes a chord of its own
  expect(!adaptive.some((e) => e.startSec >= 3.1 && e.startSec <= 3.8), `true silence stays gated, got [${adaptive.map((e) => e.symbol + "@" + e.startSec)}]`);
}

/* ---- recoverChordGaps: guarded second look at unlabelled spans ---------------
 * Opt-in. Must (a) leave every existing caller byte-identical when off, (b) refuse
 * silence, (c) refuse gaps too short to strand a bar, and (d) never emit a run
 * shorter than the main pass's own blip filter. Measured on a real stem (Peg), the
 * whole-gap-average version scored 0.33–0.44 and recovered nothing useful; per-frame
 * labelling inside the gap recovers the stable spans without chord soup. */
const gapSig = new Float32Array(SR * 3);
{ // C major for 0..1s and 2..3s; the middle second is silence
  const put = (t0, t1) => { for (let i = t0 * SR; i < t1 * SR; i++) for (const f of [261.63, 329.63, 392.0]) gapSig[i] += Math.sin((2 * Math.PI * f * i) / SR) / 3; };
  put(0, 1); put(2, 3);
}
const gOff = eng.transcribeChords(gapSig, SR, { hopSec: 0.12, smoothSec: 0.5 });
const gOn = eng.transcribeChords(gapSig, SR, { hopSec: 0.12, smoothSec: 0.5, recoverGaps: true });
expect(JSON.stringify(gOff) === JSON.stringify(gOn), "a silent gap is never 'recovered' — a rest stays a rest");
expect(eng.transcribeChords(gapSig, SR, { hopSec: 0.12, smoothSec: 0.5, recoverGaps: true, recoverMinGapSec: 0.1, recoverMinVoiced: 0.99 }).length === gOff.length,
  "the voiced-fraction guard also refuses the silent span on its own");
// A flickering span (label changes every frame) must recover NOTHING — those 1-frame
// runs are exactly the chord soup that made the first version of this unusable. Driven
// through recoverChordGaps directly with synthetic frames so the flicker is exact.
const chromaOf = (pcs) => { const c = new Array(12).fill(0.02); for (const p of pcs) c[p] = 1; return c; };
const flick = [], steady = [];
for (let i = 0; i < 24; i++) {
  const t = +(i * 0.12).toFixed(3);
  flick.push({ t, energy: 1, chroma: chromaOf(i % 2 ? [0, 4, 7] : [7, 11, 2]) });   // C ↔ G every frame
  steady.push({ t, energy: 1, chroma: chromaOf([0, 4, 7]) });                        // held C
}
const noSmooth = { smoothSec: 0.12, minDurSec: 0.4, recoverMinGapSec: 0.1, recoverMinConfidence: 0 };
expect(eng.recoverChordGaps([], flick, 0.1, 0.256, noSmooth).length === 0,
  "a span whose label flickers every frame recovers nothing (no 1-frame chord soup)");
const rSteady = eng.recoverChordGaps([], steady, 0.1, 0.256, noSmooth);
expect(rSteady.length === 1 && rSteady[0].symbol === "C" && rSteady[0].recovered === true,
  `a steady span recovers one flagged event, got ${JSON.stringify(rSteady)}`);
// The confidence floor is real: a smeared span (all 12 pcs lit — drum/reverb mud) is
// nameable only with low confidence, so the DEFAULT floor refuses it and it stays N.C.
const mud = steady.map((f) => ({ ...f, chroma: new Array(12).fill(1) }));
expect(eng.recoverChordGaps([], mud, 0.1, 0.256, { smoothSec: 0.12, minDurSec: 0.4, recoverMinGapSec: 0.1 }).length === 0,
  "a chromatically smeared span is refused by the default recoverMinConfidence (stays N.C.)");
expect(eng.recoverChordGaps([], mud, 0.1, 0.256, { ...noSmooth, recoverMinConfidence: 0 }).length > 0,
  "…and that refusal is the confidence floor doing it, not the span being unnameable");

/* ---- _hann memo: byte-identical window, cached per length --------------------
 * The DSP core memoises the Hann window (pcmToChroma / extractCenter share it). The
 * memo must return values identical to the formula, and hand back the SAME cached
 * instance for a repeated N (so no per-frame recompute). The audio tests above
 * (C/Am/G7 detection, C-major chroma peaks, clarity) are the real byte-identical guard. */
{
  const w = eng._hann(2048);
  expect(w.length === 2048, "_hann(2048) has length 2048");
  expect(Math.abs(w[0] - 0) < 1e-12 && Math.abs(w[1024] - 1) < 1e-5 && Math.abs(w[2047] - 0) < 1e-12, "_hann matches the Hann formula (ends 0, centre ≈ 1)");
  const ref = 0.5 - 0.5 * Math.cos((2 * Math.PI * 500) / (2048 - 1));
  expect(Math.abs(w[500] - ref) < 1e-15, "_hann value is byte-identical to the inline formula");
  expect(eng._hann(2048) === w, "_hann returns the SAME cached instance for a repeated N (no recompute)");
}

/* ---- describeScore: local analog of the music skill's `describe` -------------
 * A pure, reads-only summary ABOUT a decoded chart — gathers key/meter/tempo/chord
 * vocabulary/tags the engine already computes. Can't touch recognition (metadata only). */
{
  const d = eng.describeScore(mx, { title: "Demo", tempo: 120 });   // fixture: C G | Am | F, C major, bar3 3/4
  expect(d.title === "Demo" && d.key === "C", `describeScore key → C, got ${d.key}`);
  expect(d.bars === 3 && d.events === 4, `describeScore counts 3 bars / 4 events, got ${d.bars}/${d.events}`);
  expect(d.uniqueChords === 4 && d.chords.length === 4, `describeScore vocab = 4 unique chords, got ${d.uniqueChords}`);
  expect(d.chords[0] && typeof d.chords[0].count === "number", "describeScore chords carry counts");
  expect(d.tags.includes("major key"), `describeScore tags a major key, got [${d.tags}]`);
  expect(d.complexity === "simple", `describeScore reads a 4-chord triad chart as simple, got ${d.complexity}`);
  // Blue Sky (mostly block triads + a couple F#m7, E major) reads major, NOT jazz/extended
  const dbs = eng.describeScore(score);
  expect(dbs.key === "E" && dbs.tags.includes("major key") && !dbs.tags.includes("jazz / extended harmony"), `Blue Sky describe → E major, not extended, got ${dbs.key}/[${dbs.tags}]`);
  const jazz = { timeSig: [4, 4], bars: [{ number: 1, events: [{ symbol: "Cmaj9", beat: 0, durBeats: 2, midis: [48] }, { symbol: "Am9", beat: 2, durBeats: 2, midis: [57] }] }, { number: 2, events: [{ symbol: "Dm9", beat: 0, durBeats: 2, midis: [50] }, { symbol: "G7♭9", beat: 2, durBeats: 2, midis: [55] }] }] };
  expect(eng.describeScore(jazz).tags.includes("jazz / extended harmony"), "describeScore flags extended (9th/♭9) harmony as jazz");
  // empty / malformed score is safe (reads-only, no throw)
  expect(eng.describeScore({ bars: [] }).bars === 0, "describeScore handles an empty score");
}

/* ---- scoreToMusicPrompt: recognize→generate bridge to the ListenHub music CLI ----
 * Pure: chart → a ready-to-run `listenhub music generate` command (the CLI is Node-only
 * + auth'd, so it can't run IN the zero-server app — the user pastes this into theirs). */
{
  const m = eng.scoreToMusicPrompt(mx, { title: "Demo Tune" });     // C G | Am | F, C major
  expect(/^listenhub music generate --prompt "/.test(m.command), `command starts with the CLI invocation, got: ${m.command}`);
  expect(m.prompt.includes("in C") && m.prompt.includes("C G Am F"), `prompt carries key + progression, got: ${m.prompt}`);
  expect(m.command.includes('--title "Demo Tune"'), "title flag is included + quoted");
  expect(!m.command.includes("--instrumental"), "instrumental flag omitted by default");
  expect(eng.scoreToMusicPrompt(mx, { instrumental: true }).command.includes("--instrumental"), "instrumental flag added when opted in");
  // honest style: a plain triadic chart asserts no genre; a 9th/♭9 chart → jazz
  expect(m.style === null && !m.command.includes("--style"), "no --style asserted for a plain major/triadic chart");
  const jazzScore = { timeSig: [4, 4], bars: [{ number: 1, events: [{ symbol: "Cmaj9", beat: 0, durBeats: 2, midis: [48] }, { symbol: "Am9", beat: 2, durBeats: 2, midis: [57] }] }, { number: 2, events: [{ symbol: "Dm9", beat: 0, durBeats: 2, midis: [50] }, { symbol: "G7♭9", beat: 2, durBeats: 2, midis: [55] }] }] };
  const jm = eng.scoreToMusicPrompt(jazzScore);
  expect(jm.style === "jazz" && jm.command.includes('--style "jazz"'), `extended harmony → --style jazz, got ${jm.style}`);
  // shell-safety: a symbol with a double-quote can't break out of the quoting
  const evil = { timeSig: [4, 4], title: 'A"B', bars: [{ number: 1, events: [{ symbol: 'C', beat: 0, durBeats: 4, midis: [48] }] }] };
  expect(eng.scoreToMusicPrompt(evil).command.includes('\\"'), "double-quotes in fields are escaped");
  // progression digest caps long charts
  expect(eng.scoreToMusicPrompt(score, { maxChords: 6 }).prompt.includes("…"), "long progression is capped with an ellipsis");
}

/* ---- ML note-transcription decoder (basic-pitch-style, pure half) ----------
 * Pure-JS multi-F0 can't reliably transcribe dense vocal harmony, so the real path is a
 * hosted ML model. The model is a device-only seam, but the decode (activation matrices →
 * note events → score) is pure + tested here so it's drop-in ready. */
{
  const T = 100, P = 88, minMidi = 21, fr = 100;
  const onsets = Array.from({ length: T }, () => new Float32Array(P));
  const frames = Array.from({ length: T }, () => new Float32Array(P));
  for (const midi of [60, 64, 67]) { const p = midi - minMidi; onsets[0][p] = 0.9; for (let t = 0; t < T; t++) frames[t][p] = 0.8; } // C major held 1s
  const notes = eng.notesFromActivations(onsets, frames, { frameRate: fr, minMidi });
  expect(notes.length === 3 && notes.map((n) => n.midi).join(",") === "60,64,67", `decode: held C major → C4/E4/G4, got [${notes.map((n) => n.midi)}]`);
  expect(notes[0].startSec === 0 && Math.abs(notes[0].durSec - 1) < 0.02, `decode: note spans the held second, got ${notes[0].startSec}/${notes[0].durSec}`);
  // a blip shorter than minDur is dropped
  const ob = Array.from({ length: T }, () => new Float32Array(P)), fb = Array.from({ length: T }, () => new Float32Array(P));
  ob[0][39] = 0.9; for (let t = 0; t < 3; t++) fb[t][39] = 0.8;   // 3 frames = 0.03s < 0.12s
  expect(eng.notesFromActivations(ob, fb, { frameRate: fr, minMidi }).length === 0, "decode: sub-minDur blip is dropped");
  // notes → the shared score shape (source ml), one voicing = C
  const score = eng.polyNotesToScore(notes, { bpm: 120, beatsPerBar: 4 });
  expect(score.source === "ml" && score.bars[0].events[0].symbol === "C" && score.bars[0].events[0].midis.join(",") === "60,64,67", "polyNotesToScore → ml score, C voicing carries its notes");
  // orchestrator runs a pluggable (fake) model then decodes
  const fake = async () => ({ onsets, frames, frameRate: fr, minMidi });
  const r = await eng.transcribeWithNoteModel(new Float32Array(1000), 16000, fake, { bpm: 120 });
  expect(r.notes.length === 3 && r.score.source === "ml", "transcribeWithNoteModel: pluggable model → decoded notes + ml score");
  let threw = false; try { await eng.transcribeWithNoteModel(new Float32Array(10), 16000, null); } catch (_) { threw = true; }
  expect(threw, "transcribeWithNoteModel throws a clear error when no model is configured");
}

/* ---- DTW audio↔score auto-sync -------------------------------------------- */
// _dtw finds a monotonic path; identical sequences → diagonal, zero cost
{
  const d = (a, b) => Math.abs(a - b);
  const r = eng._dtw([1, 2, 3], [1, 2, 3], d);
  expect(r.cost === 0 && r.path.length >= 3 && r.path[0][0] === 0 && r.path[r.path.length - 1][1] === 2, "dtw identical → zero-cost diagonal");
  // a stretched copy still aligns start→start, end→end
  const r2 = eng._dtw([1, 2, 3], [1, 1, 2, 3, 3], d);
  expect(r2.path[0][0] === 0 && r2.path[0][1] === 0 && r2.path[r2.path.length - 1][0] === 2 && r2.path[r2.path.length - 1][1] === 4, "dtw aligns a time-stretched copy end-to-end");
}
// scoreChromaSequence reflects each event's pitch classes + carries its key
{
  const sc = { timeSig: [4, 4], bars: [{ number: 1, events: [{ symbol: "C", beat: 0, midis: [48, 52, 55] }, { symbol: "G", beat: 2, midis: [55, 59, 62] }] }] };
  const seq = eng.scoreChromaSequence(sc);
  expect(seq.length === 2 && seq[0].key === "1.0" && seq[1].key === "1.2", "scoreChromaSequence carries event keys");
  expect(seq[0].chroma[0] > 0 && seq[0].chroma[4] > 0 && seq[0].chroma[7] > 0, "C event chroma lights C/E/G");
}
// end-to-end DTW: a score C|G|Am vs synthesized audio played with UNEVEN timing
// (C 1.0s, G 0.4s, Am 1.4s) — the alignment must map each region to the right event key
{
  const score = { timeSig: [4, 4], bars: [
    { number: 1, events: [{ symbol: "C", beat: 0, midis: [48, 52, 55] }, { symbol: "G", beat: 2, midis: [55, 59, 62] }] },
    { number: 2, events: [{ symbol: "Am", beat: 0, midis: [57, 60, 64] }] },
  ] };
  const buf = new Float32Array(Math.floor(2.8 * SR));
  buf.set(chordSig([261.63, 329.63, 392.00], 1.0), 0);                      // C
  buf.set(chordSig([196.00, 246.94, 293.66], 0.4), Math.floor(1.0 * SR));   // G (short)
  buf.set(chordSig([220.00, 261.63, 329.63], 1.4), Math.floor(1.4 * SR));   // Am (long)
  const { segments: segs, confidence } = eng.alignPcmToScore(buf, SR, score, { hopSec: 0.1 });
  const keyAt = (t) => { let k = null; for (const s of segs) { if (s.sec <= t) k = s.key; else break; } return k; };
  expect(keyAt(0.5) === "1.0", `align: 0.5s should map to C (1.0), got ${keyAt(0.5)}`);
  expect(keyAt(1.2) === "1.2", `align: 1.2s should map to G (1.2), got ${keyAt(1.2)}`);
  expect(keyAt(2.3) === "2.0", `align: 2.3s should map to Am (2.0), got ${keyAt(2.3)}`);
  expect(confidence > 0.3, `align: a clean matching take should have decent confidence, got ${confidence}`);
}
// energy gate: a real recording has a SILENT lead-in (count-in / room tone). Without a
// gate, pcmToChroma normalises that silence into a noise chroma and DTW's fixed endpoints
// force the FIRST chord onto it — so the lead-in must resolve to null (no highlight), and
// the chords still map correctly once the music starts (shifted by the lead-in length).
{
  const score = { timeSig: [4, 4], bars: [
    { number: 1, events: [{ symbol: "C", beat: 0, midis: [48, 52, 55] }, { symbol: "G", beat: 2, midis: [55, 59, 62] }] },
    { number: 2, events: [{ symbol: "Am", beat: 0, midis: [57, 60, 64] }] },
  ] };
  const lead = 0.6;                                                          // silent lead-in
  const buf = new Float32Array(Math.floor((lead + 2.8) * SR));
  buf.set(chordSig([261.63, 329.63, 392.00], 1.0), Math.floor(lead * SR));  // C
  buf.set(chordSig([196.00, 246.94, 293.66], 0.4), Math.floor((lead + 1.0) * SR)); // G (short)
  buf.set(chordSig([220.00, 261.63, 329.63], 1.4), Math.floor((lead + 1.4) * SR)); // Am (long)
  const { segments: segs } = eng.alignPcmToScore(buf, SR, score, { hopSec: 0.1 });
  const keyAt = (t) => { let k = null; for (const s of segs) { if (s.sec <= t) k = s.key; else break; } return k; };
  expect(keyAt(0.2) === null, `align: silent lead-in should NOT highlight a chord, got ${keyAt(0.2)}`);
  expect(keyAt(lead + 0.5) === "1.0", `align: C after the lead-in should map to 1.0, got ${keyAt(lead + 0.5)}`);
  expect(keyAt(lead + 2.3) === "2.0", `align: Am after the lead-in should map to 2.0, got ${keyAt(lead + 2.3)}`);
}
// duration-weight: a longer event spans MORE DTW columns (~1/beat of its qdur), and the
// bass pc is emphasised, so the warp knows how long a chord should sound + matches better.
{
  const sc = { timeSig: [4, 4], bars: [{ number: 1, events: [
    { symbol: "C", beat: 0, durBeats: 3, qbeat: 0, qdur: 3, midis: [48, 52, 55] },
    { symbol: "G", beat: 3, durBeats: 1, qbeat: 3, qdur: 1, midis: [55, 59, 62] },
  ] }] };
  const seq = eng.scoreChromaSequence(sc);
  const cCols = seq.filter((s) => s.key === "1.0").length, gCols = seq.filter((s) => s.key === "1.3").length;
  expect(cCols === 3 && gCols === 1, `duration-weight: 3-beat C → 3 cols, 1-beat G → 1 col, got ${cCols}/${gCols}`);
  const cCol = seq.find((s) => s.key === "1.0").chroma;   // C bass (pc 0) emphasised over the 3rd (pc 4)
  expect(cCol[0] > cCol[4], `bass emphasis: C root (pc0) should weigh more than the 3rd (pc4), got ${cCol[0]} vs ${cCol[4]}`);
}
// confidence: the same audio matches its own score better than a pitch-disjoint one, so a
// wrong stem / wrong chart reads as LOW confidence → the UI can fall back to the ♩= map.
{
  const good = { timeSig: [4, 4], bars: [{ number: 1, events: [{ symbol: "C", beat: 0, midis: [48, 52, 55] }] }] };
  const bad = { timeSig: [4, 4], bars: [{ number: 1, events: [{ symbol: "F#", beat: 0, midis: [54, 58, 61] }] }] }; // tritone away, disjoint pcs
  const audio = chordSig([261.63, 329.63, 392.00], 1.0); // C
  const g = eng.alignPcmToScore(audio, SR, good, { hopSec: 0.1 });
  const b = eng.alignPcmToScore(audio, SR, bad, { hopSec: 0.1 });
  expect(g.confidence > b.confidence, `confidence: C-audio matches C-score better than F#-score (${g.confidence} vs ${b.confidence})`);
  expect(b.confidence < 0.3, `confidence: total pitch mismatch → low confidence, got ${b.confidence}`);
}

/* ---- single-note symbols carry NO "(single)" artifact (regression) -------
 * A one-pitch block recognises as the bare note name; the old engine appended
 * " (single)" to the symbol STRING, which leaked into every export + the chart
 * label (e.g. ABC `"E (single)"[E]/2`). The single-note fact now lives only on
 * the `result.single` flag, so every consumer is clean at the single source. */
expect(eng.symbolForMidis([64], true) === "E", `single MIDI should symbolise as bare "E", got "${eng.symbolForMidis([64], true)}"`);
expect(eng.symbolForFrets({ 0: 0 }, true) === "E", `single open low-E should symbolise as bare "E", got "${eng.symbolForFrets({ 0: 0 }, true)}"`);
const oneNote = { timeSig: [4, 4], bars: [{ number: 1, events: [{ symbol: eng.symbolForMidis([64], true), beat: 0, durBeats: 4, qbeat: 0, qdur: 4, midis: [64] }] }] };
expect(!/\(single\)/.test(eng.scoreToABC(oneNote, {})), "ABC export must not contain (single)");
expect(!/\(single\)/.test(eng.scoreToCSMPN(oneNote, {})), "CSMPN export must not contain (single)");
expect(!/\(single\)/.test(eng.scoreToMusicXML(oneNote, {})), "MusicXML export must not contain (single)");
// no regression on real multi-note recognition (Blue Sky chords are unchanged)
expect(!score.bars.some((b) => b.events.some((e) => /\(single\)/.test(e.symbol))), "Blue Sky symbols must not contain (single)");

/* ---- module-split integrity (Roadmap Wave 1 #1) --------------------------
 * The engine is now a standalone module imported by the UI and rewritten into a
 * Blob URL by the in-browser loader. App boot is the one thing that can't be
 * exercised headlessly, so we statically guarantee the contract that boot relies
 * on: every name the UI imports from ./engine.tsx is actually exported by it; the
 * engine stays pure (no React); the UI no longer DEFINES engine internals (so no
 * duplicate-declaration drift); and the loader wires the two files together. */
const uiSrc = fs.readFileSync(UI, "utf8");
const htmlSrc = fs.readFileSync(HTML, "utf8");
const nameList = (block) => (block ? block.split(",").map((s) => s.trim().replace(/\/\/.*$/, "").trim()).filter(Boolean) : []);
const impMatch = uiSrc.match(/import\s*\{([\s\S]*?)\}\s*from\s*["']\.\/engine\.tsx["']/);
const expMatch = engineSrc.match(/export\s*\{([\s\S]*?)\}\s*;?\s*$/m);
const imported = nameList(impMatch && impMatch[1]);
const exported = nameList(expMatch && expMatch[1]);
expect(imported.length > 0, "UI must import the engine from ./engine.tsx");
expect(exported.length > 0, "engine.tsx must export a public surface");
const missing = imported.filter((n) => !exported.includes(n));
expect(missing.length === 0, `UI imports names engine.tsx does not export: ${missing.join(", ")}`);
expect(!/\bfrom\s*["']react["']/.test(engineSrc) && !/\buseState\s*\(/.test(engineSrc), "engine.tsx must stay React-free (pure module)");
expect(!/^const\s+makeMask\b/m.test(uiSrc) && !/^function\s+buildChart\b/m.test(uiSrc), "UI must not re-define engine internals (engine moved to engine.tsx)");
expect(uiSrc.includes('async function extractTokens'), "extractTokens (browser PDF seam) stays in the UI file");
expect(/from\s*\$\{engineUrl\}/.test(htmlSrc) || /engine\.tsx/.test(htmlSrc), "index.html loader must reference/wire engine.tsx");
const pagesYml = fs.readFileSync(path.join(repo, ".github", "workflows", "pages.yml"), "utf8");
expect(/cp\s+engine\.tsx\s+_site/.test(pagesYml) && /cp\s+TabDecoderPro\.tsx\s+_site/.test(pagesYml),
  "Pages deploy must ship BOTH engine.tsx and TabDecoderPro.tsx (the loader fetches both)");

/* The React UI (TabDecoderPro.tsx) is otherwise browser-only; at least prove it
 * (and the engine) TRANSPILE with the exact Babel presets index.html uses, so a
 * syntax/JSX error can't ship green. Catches the class of bug the loader can't. */
const _B = await import("@babel/standalone");
const Babel = _B && _B.transform ? _B : _B.default;
const BPRESETS = [["typescript", { allExtensions: true, isTSX: true, onlyRemoveTypeImports: true }], ["react"]];
let transpileErr = "";
for (const [name, code] of [["engine.tsx", engineSrc], ["TabDecoderPro.tsx", uiSrc]]) {
  try { Babel.transform(code, { filename: name, presets: BPRESETS }); }
  catch (e) { transpileErr = `${name}: ${e.message}`; break; }
}
expect(!transpileErr, `source must transpile with the index.html Babel presets — ${transpileErr}`);

/* Session persistence (Wave 1 #2) contract — browser-only (OPFS + base64), so
 * statically guard the safety rails: OPFS is feature-detected, persistence is
 * wrapped in try/catch, there's a localStorage fallback, restore is one-shot,
 * and the engine stays free of any persistence concern (it's pure). */
expect(/navigator\.storage/.test(uiSrc) && /getDirectory/.test(uiSrc), "UI must feature-detect OPFS (navigator.storage.getDirectory)");
expect(/SESS_BIN_LS|localStorage/.test(uiSrc) && /_bytesToB64|btoa/.test(uiSrc), "UI must have a localStorage base64 fallback when OPFS is unavailable");
expect(/restoreRef/.test(uiSrc) && /catch\s*\(/.test(uiSrc), "session restore must be one-shot (ref-guarded) and wrapped in try/catch");
expect(!/navigator\.storage/.test(engineSrc) && !/localStorage/.test(engineSrc), "engine.tsx must stay free of persistence/browser-storage concerns");

/* Parse Web Worker (Wave 1 #3) contract — browser-only glue, so statically guard
 * the rails: the loader publishes the engine URL; the worker is a module worker
 * importing it; routing is gated to DOMParser-free formats; and there is a
 * guaranteed main-thread fallback so correctness never depends on the worker. */
expect(/window\.__TTP_ENGINE_URL__\s*=/.test(htmlSrc), "index.html must publish window.__TTP_ENGINE_URL__ for the parse worker");
expect(/__TTP_ENGINE_URL__/.test(uiSrc) && /new Worker\(/.test(uiSrc) && /type:\s*["']module["']/.test(uiSrc), "UI must create a module Worker that imports the published engine URL");
expect(/FICHIER GUITAR PRO/.test(uiSrc) && /ptab/.test(uiSrc), "worker routing must be gated to DOMParser-free formats (GP3/4/5 + Power Tab)");
expect(/parseScoreOffThread/.test(uiSrc) && /return parseGuitarProOrXML\(/.test(uiSrc), "off-thread parse must fall back to the same main-thread engine call");

/* ---- estimateSpacing: scale-invariant + noise-robust --------------------
 * Both the Wild Night ("no tab detected") and Confirmation ("wrong key/voicings")
 * bugs were ONE root cause: a 4× Guitar-Pro / alphaTab PDF export where the true
 * string-line spacing is ~37.5pt. The old "median of the smaller half, capped
 * <20pt" returned 7 when no gap fell under 20 (Wild Night → 0 systems) and was
 * dragged down to text-baseline noise (~3.5) when small jitter gaps existed
 * (Confirmation → mis-clustered → wrong key/voicings). The mode-of-gaps estimate
 * recovers the true spacing at any scale, immune to that noise. */
const synthStaff = (top, spacing, sysGap, systems) => {
  const ys = [];
  for (let s = 0; s < systems; s++) {
    const base = top + s * (spacing * 5 + sysGap);
    for (let i = 0; i < 6; i++) ys.push(+(base + i * spacing).toFixed(1));
  }
  return ys;
};
const sp1x = eng.estimateSpacing(synthStaff(50, 7, 200, 3));
expect(Math.abs(sp1x - 7) < 1, `estimateSpacing 1× export: expected ~7pt, got ${sp1x}`);
const sp4x = eng.estimateSpacing(synthStaff(100, 37.5, 296, 3));
expect(Math.abs(sp4x - 37.5) < 2,
  `estimateSpacing 4× export (Wild Night): expected ~37.5pt, got ${sp4x} — the <20pt cap used to force 7 → 0 systems`);
// header/text jitter adds a few tiny gaps (0.6/3.5) that the old smaller-half median chased
const sp4xNoisy = eng.estimateSpacing(synthStaff(100, 37.5, 296, 3).concat([60, 60.6, 64.1, 67.6]));
expect(Math.abs(sp4xNoisy - 37.5) < 3,
  `estimateSpacing 4× + noise (Confirmation): expected ~37.5pt, got ${sp4xNoisy} — noise gaps used to drag it to ~3.5 → wrong key`);

/* ---- real-file regression: the two reported PDFs (2026-07-31) ------------
 * The user's actual Tab Decoder failures, committed as fixtures (the
 * fixture-loop principle). Both are 4× Guitar-Pro / alphaTab exports the old
 * estimateSpacing mis-scaled — Wild Night to 0 systems, Confirmation to a
 * wrong-key mess. These pin the fixed behaviour against the real bytes. */
const fx = (name) => new Uint8Array(fs.readFileSync(path.join(here, "fixtures", name)));
const barsOf = (ch) => ch.measures.map((m) => {
  const s = m.columns.map((c) => eng.symbolForFrets(c.frets, true));
  return s.filter((x, i) => i === 0 || x !== s[i - 1]).join(" ");
});

// Wild Night: read "0 bars · 0 systems · no tab detected" before the fix.
const { tokens: wnTok } = await extractTokens(fx("wild-night.pdf"));
const wnChart = eng.buildChart(wnTok);
expect(wnChart.systemsFound > 0 && wnChart.measures.length > 0,
  `Wild Night: expected the tab to be detected, got ${wnChart.systemsFound} systems / ${wnChart.measures.length} bars (was 0/0)`);

// Confirmation (UG Pro): rendered in Em with bar 1 = "E" before the fix; it is F major.
const { tokens: cfTok } = await extractTokens(fx("confirmation-ugpro.pdf"));
const cfChart = eng.buildChart(cfTok);
const cfBars = barsOf(cfChart);
const cfKey = eng.keyName(eng.analyzeKey(eng.buildScore(cfChart, true)), true);
expect(cfChart.measures.length > 0, `Confirmation: expected bars, got ${cfChart.measures.length}`);
expect(cfBars[0]?.split(" ")[0] === "F", `Confirmation bar 1 should start on F, got "${cfBars[0]}" (was "E")`);
expect(cfKey === "F", `Confirmation key should be F, got ${cfKey} (was Em)`);
const cfAll = cfBars.join(" ");
expect(["Dm7", "G7", "Cm7", "F7", "Bb7"].every((ch) => cfAll.includes(ch)),
  `Confirmation should show the F-major ii-V changes, got: ${cfAll}`);

/* ---- report -------------------------------------------------------------- */
console.log(`module split: UI imports ${imported.length}/${exported.length} engine exports, 0 missing · engine.tsx pure`);
console.log(`PDF.js ${pdfjsLib.version} · ${pages} pages · ${tokens.length} tokens`);
console.log(`systemsFound=${chart.systemsFound} columnsFound=${chart.columnsFound} bars=${bars.length}`);
console.log(`verse 1-8: ${verse}`);
console.log(`progression: ${bars.map((b) => b.bar).join(" | ")}`);
const sampleMulti = (typeof score !== "undefined" && score.bars.find((b) => b.events.length >= 2)) || null;
if (sampleMulti) console.log(`sample multi-chord bar ${sampleMulti.number}: ` +
  sampleMulti.events.map((e) => `${e.symbol}@b${e.beat + 1}(${e.durBeats})`).join(" "));
console.log(`MusicXML: ${mx.bars.length} bars, ${mx.tuning} tuning, bar3 ${mx.bars[2].timeSig.join("/")} · ${mxSyms.join(" | ")}`);
console.log(`Key: fixture ${eng.keyName(mxKey, true)} (${mxRomans}) · Blue Sky ${eng.keyName(bsKey, true)}`);
console.log(`GP (.gp): ${gp.parts.length} tracks, ${gp.bars.length} bars, ${gp.tuning}, tempo ${gp.tempo}, bar1 ${gp.bars[0].timeSig.join("/")} · verse ${gpVerse}`);
console.log(`GP3/4 (.gp3/.gp4): Blue Sky verse ${bs3Verse} · Kid Charlemagne bars 27-28 ${kc27} ${kc28} (PDF mis-read as Fm7) · Peg ${peg4Bars}`);
console.log(`GP5 (.gp5): Anthropology v5.00 "${anth5.parts[1].name}" ${anth5Bars} · Au Privave v5.10 ${auPriv5.bars.length} bars tempo ${auPriv5.tempo}`);
console.log(`GP6 (.gpx): Yardbird "${yard6.parts[1].name}" ${yard6Bars} · The Weight key-of-A chords · My Favorite Things ${mft6NonEmpty} piano bars`);
console.log(`PTB (.ptb): tune open-strings ${tuneSyms} · House of the Rising Sun ${hotrs.bars[0].timeSig.join("/")} Am-arpeggio "${hotrsBar1}" (${hotrs.bars.length} bars)`);
console.log(`ABC: ${abc.trim().split("\n").pop()}`);
console.log(`4× exports (reported bugs): Wild Night ${wnChart.systemsFound} systems / ${wnChart.measures.length} bars (was 0/0) · ` +
  `Confirmation key ${cfKey} (was Em) ${cfBars.slice(0, 7).join(" | ")}`);

if (fails.length) {
  console.error("\nFAIL:\n  " + fails.join("\n  "));
  console.error("\nRe-run with --log-tokens to dump the raw extractTokens() stream and diff against the reference.");
  process.exit(1);
}
console.log("\nPASS — Path A pipeline reconstructs Blue Sky (165 bars, verse + V + bridge).");
