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

/* ---- Path C: slash-notation chart — chords come from <harmony>, not the
 *      placeholder slash noteheads. Regression for the "MusicXML → nonsense"
 *      report (Larry Carlton "Room 335" fake-book export): every <note> is a
 *      slash placeholder at pitch B4, so pitch-recognition alone yielded a single
 *      "B" per bar. The chords live in <harmony> and must be read from there. --- */
const rm = eng.parseMusicXML(
  fs.readFileSync(path.join(here, "fixtures", "room-335-slash.musicxml"), "utf8"), true);
const rmSyms = rm.bars.map((b) => (b.events[0] || {}).symbol || "—");
expect(rm.bars.length === 339, `Room 335: expected 339 bars, got ${rm.bars.length}`);
expect(rmSyms.slice(0, 3).join(" | ") === "Dmaj7 | C#m7 | Bm7",
  `Room 335 first 3 bars expected "Dmaj7 | C#m7 | Bm7", got "${rmSyms.slice(0, 3).join(" | ")}"`);
// NOT the placeholder-slash reading (would be a single "B" every bar)
expect(new Set(rmSyms).size > 10, `Room 335 should recover many distinct chords, got ${new Set(rmSyms).size}`);
expect(!rmSyms.every((s) => s === "B"), "Room 335 must not read the B4 slash placeholders as chords");
// <bass> slash chords: a non-chord-tone bass stays a clean slash (D/E, not Dadd9/E)
expect(rmSyms.includes("D/E"), `Room 335 should carry the D/E slash chord faithfully, got distinct: ${[...new Set(rmSyms)].join(", ")}`);
// half-diminished from <kind>half-diminished</kind>
expect(rmSyms.some((s) => /m7♭5$/.test(s)), "Room 335 should carry half-diminished (m7♭5) chords");
// the source's <alter>1</alter> (this exporter's variant of <root-alter>) is read → C#, not C
expect(rmSyms.includes("C#m7") && !rmSyms.includes("Cm7"), "Room 335: <alter> accidental must be read (C#m7, not Cm7)");

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

// The displayed beat grid rounds multiple changes to the same beat. MusicXML
// must use qbeat/qdur so triplets and sixteenths keep their true onsets.
const tripXml = eng.scoreToMusicXML(tupScore);
const tripDoc = new DOMParser().parseFromString(tripXml, "text/xml");
const tripDiv = Number(tripDoc.getElementsByTagName("divisions")[0].textContent);
const tripNotes = Array.from(tripDoc.getElementsByTagName("note")).filter((n) => !n.getElementsByTagName("chord").length);
const tripDurs = tripNotes.map((n) => Number(n.getElementsByTagName("duration")[0].textContent));
expect(tripDurs.reduce((sum, n) => sum + n, 0) === 4 * tripDiv,
  `4/4 triplet measure must total four beats, got ${tripDurs.join("+")}/${tripDiv}`);
expect(tripDurs.slice(0, 3).every((n) => n === tripDiv / 3),
  `triplet events must last a third of a quarter, got ${tripDurs.join(",")}`);
expect(tripNotes.slice(0, 3).every((n) => n.getElementsByTagName("time-modification")[0]?.getElementsByTagName("actual-notes")[0]?.textContent === "3"),
  "triplet notes need MusicXML time-modification for notation apps");
const tripBack = eng.parseMusicXML(tripXml, true);
expect(tripBack.bars[0].events.length === 4 && Math.abs(tripBack.bars[0].events[1].qbeat - 1 / 3) < 1e-6,
  "MusicXML triplets should retain their distinct onsets when re-imported");
const sixteenthXml = eng.scoreToMusicXML(arr16);
const sixteenthDoc = new DOMParser().parseFromString(sixteenthXml, "text/xml");
const sixteenthNotes = Array.from(sixteenthDoc.getElementsByTagName("measure")[0].getElementsByTagName("note"))
  .filter((n) => !n.getElementsByTagName("chord").length);
expect(sixteenthNotes.length === 16 && sixteenthNotes.every((n) =>
  Number(n.getElementsByTagName("duration")[0].textContent) === 1),
  "sixteenth-note arrangement should export sixteen distinct, quarter-beat notes");

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
  expect(["beat-sync", "sliding", "synharmonics-v2", "synharmonics-v2-grid"].includes(r.method), `method is reported, got ${r.method}`);
  expect(!/beat-sync|synharmonics-v2$/.test(r.method) || Math.abs(r.bpm - bpmT) / bpmT < 0.1, `beat-synchronous path reports the tempo (~${bpmT}), got ${r.bpm}`);
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

/* ---- SynHarmonics v2 — isolated-stem chord recognition (Stages A · C · D) -----
 * Every claim the v2 front-end/decoder makes, pinned headlessly with synthesized
 * HARMONIC tones (partials 1..8 at 1/h — real instruments have overtones, which is
 * exactly what pure-sine fixtures hide). Benchmark numbers live in tests/bench. */
let synhSummary = "";
{
  const VSR = 16000;
  const tone = (out, f, t0, t1, amp = 0.2, H = 8) => {
    for (let i = Math.floor(t0 * VSR); i < Math.min(out.length, Math.floor(t1 * VSR)); i++) {
      const t = i / VSR; let v = 0;
      for (let h = 1; h <= H; h++) if (h * f < VSR / 2) v += Math.sin(2 * Math.PI * h * f * t) / h;
      out[i] += amp * v;
    }
  };
  const hz = (m, cents = 0) => 440 * Math.pow(2, (m - 69 + cents / 100) / 12);
  const chordSig = (dur, plan, cents = 0) => {            // plan: [[t0,t1,[midis]],...]
    const s = new Float32Array(Math.ceil(dur * VSR));
    for (const [a, b, ms] of plan) for (const m of ms) tone(s, hz(m, cents), a, b, 0.25 / Math.sqrt(ms.length));
    return s;
  };
  const beatsOf = (dur, step = 0.5) => { const b = []; for (let t = 0; t <= dur + 1e-9; t += step) b.push(+t.toFixed(3)); return b; };
  const syms = (r) => (r.events || r).map((e) => e.symbol);
  const majority = (ev, t0, t1) => { let best = null, bd = 0; for (const e of ev) { const o = Math.min(t1, e.startSec + e.durSec) - Math.max(t0, e.startSec); if (o > bd) { bd = o; best = e.symbol; } } return best; };

  // Stage A · anti-aliased resampling: a tone ABOVE the new Nyquist must not fold back
  {
    const R = 44100, n = R; const hi = new Float32Array(n), lo = new Float32Array(n);
    for (let i = 0; i < n; i++) { hi[i] = Math.sin(2 * Math.PI * 15000 * i / R); lo[i] = Math.sin(2 * Math.PI * 1000 * i / R); }
    const rms = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    const outHi = eng.resampleTo(hi, R, 16000), outLo = eng.resampleTo(lo, R, 16000);
    expect(Math.abs(outLo.length - 16000) <= 1, `resampleTo length follows the ratio (got ${outLo.length})`);
    expect(Math.abs(rms(outLo.subarray(400, -400)) - Math.SQRT1_2) < 0.02, `an in-band 1 kHz tone passes at unity (rms ${rms(outLo.subarray(400, -400)).toFixed(3)})`);
    // box-average decimation (the old dsChan, factor 2 → 22.05k) lets a 15 kHz tone alias to 7.05 kHz at −3..−10 dB
    const box = new Float32Array(n >> 1); for (let i = 0; i < box.length; i++) box[i] = (hi[2 * i] + hi[2 * i + 1]) / 2;
    const out22 = eng.resampleTo(hi, R, R / 2);
    expect(20 * Math.log10(rms(out22.subarray(400, -400)) / Math.SQRT1_2) < -40 && 20 * Math.log10(rms(box) / Math.SQRT1_2) > -12,
      `a 15 kHz tone is suppressed >40 dB by resampleTo but not by box decimation (sinc ${(20 * Math.log10(rms(out22.subarray(400, -400)) / Math.SQRT1_2)).toFixed(1)} dB vs box ${(20 * Math.log10(rms(box) / Math.SQRT1_2)).toFixed(1)} dB)`);
    expect(eng.resampleTo(new Float32Array(0), R, 16000).length === 0, "resampleTo: empty in → empty out");
  }

  // Stage A · global tuning: a +35-cent recording is measured and re-centred
  let tuneSharp = 0;
  {
    const sharp = chordSig(4, [[0, 4, [48, 52, 55, 60]]], 35), flat = chordSig(4, [[0, 4, [48, 52, 55, 60]]], 0);
    tuneSharp = eng.nnlsChromagram(sharp, VSR, {}).tuning;
    const t0 = eng.nnlsChromagram(flat, VSR, {}).tuning;
    expect(Math.abs(tuneSharp - 35) < 10, `tuning estimate reads a +35¢ recording within 10¢ (got ${tuneSharp.toFixed(1)}¢)`);
    expect(Math.abs(t0) < 6, `an in-tune recording reads ~0¢ (got ${t0.toFixed(1)}¢)`);
    // and the decode is tuning-proof: a +40¢ C major still reads C
    const det = chordSig(6, [[0, 6, [48, 52, 55, 60, 64]]], 45);
    const ev = eng.transcribeChordsV2(det, VSR, { beats: beatsOf(6) }).events;
    expect(majority(ev, 0.5, 5.5) === "C", `a +45¢ detuned C major still decodes as C (got ${syms(ev)})`);
    // …and the compensation is what keeps the evidence ON the chord tones (half of it
    // leaks to the neighbouring semitones without it)
    const share = (o) => { let on = 0, all = 0; for (const f of eng.nnlsChromagram(det, VSR, o).frames.slice(5, -5)) for (let p = 0; p < 12; p++) { all += f.chroma[p]; if (p === 0 || p === 4 || p === 7) on += f.chroma[p]; } return on / all; };
    const withT = share({}), without = share({ estimateTuning: false });
    expect(withT > 0.75 && withT > without + 0.15, `tuning compensation concentrates chroma on C-E-G at +45¢ (${withT.toFixed(2)} vs ${without.toFixed(2)} uncompensated)`);
  }

  // Stage A · NNLS attributes overtones to their note: Bb2's 3rd harmonic is NOT an F.
  // (The legacy fold "solved" this by damping every 5th — which also damps a REAL 5th;
  // the default treble blends NNLS with raw salience so real chord tones stay strong.)
  {
    const avg = (fr, pc) => { const m = fr.slice(5, -5); return m.reduce((s, f) => s + f.chroma[pc], 0) / m.length; };
    const nn = eng.nnlsChromagram(chordSig(3, [[0, 3, [46]]]), VSR, { treble: "nnls" }).frames;
    expect(avg(nn, 5) / avg(nn, 10) < 0.05, `NNLS activations keep Bb's 3rd harmonic out of F (F/Bb = ${(avg(nn, 5) / avg(nn, 10)).toFixed(3)})`);
    const tri = chordSig(3, [[0, 3, [48, 52, 55]]]);
    const legacy = eng.pcmToChroma(tri.subarray(VSR, VSR + 4096), VSR);
    const bl = eng.nnlsChromagram(tri, VSR, {}).frames;
    expect(avg(bl, 7) / avg(bl, 0) > 1.0 && legacy[7] / legacy[0] < 0.8,
      `a REAL 5th survives (C-E-G: default G/C ${(avg(bl, 7) / avg(bl, 0)).toFixed(2)}; the legacy harmonic damping cuts it to ${(legacy[7] / legacy[0]).toFixed(2)})`);
  }

  // Stage A · sub-octave guard: the bass of B3–E4–G4 is B, not a phantom E an octave down
  {
    const fr = eng.nnlsChromagram(chordSig(3, [[0, 3, [59, 64, 67]]]), VSR, {}).frames.slice(5, -5);
    const b = new Float64Array(12); for (const f of fr) for (let p = 0; p < 12; p++) b[p] += f.bass[p];
    let top = 0; for (let p = 1; p < 12; p++) if (b[p] > b[top]) top = p;
    expect(top === 11, `bass chroma of B3-E4-G4 peaks on B (got pc ${top})`);
  }

  // Stage C · progression, event shape, posteriors
  const prog = chordSig(8, [[0, 2, [48, 55, 64, 67]], [2, 4, [43, 50, 59, 67]], [4, 6, [45, 52, 60, 64]], [6, 8, [41, 48, 57, 65]]]);
  const pr = eng.transcribeChordsV2(prog, VSR, { beats: beatsOf(8) });
  {
    const seq = [[0.3, 1.7], [2.3, 3.7], [4.3, 5.7], [6.3, 7.7]].map(([a, b]) => majority(pr.events, a, b));
    expect(seq.join(" ") === "C G Am F", `v2 decodes C G Am F (got ${seq.join(" ")}; events ${syms(pr)})`);
    const e0 = pr.events[0];
    expect(e0 && typeof e0.confidence === "number" && typeof e0.prob === "number" && Array.isArray(e0.alternatives) && typeof e0.ambiguous === "boolean",
      "v2 events carry confidence, prob, alternatives[] and an ambiguous flag (v2 §4.3)");
    expect(pr.events.every((e) => e.confidence >= 0 && e.confidence <= 1 && e.prob >= 0 && e.prob <= 1), "confidence/prob are bounded 0..1");
    expect(pr.events.filter((e) => e.durSec > 1).every((e) => e.prob > 0.5 && !e.ambiguous), `clean, sustained chords are confident (probs ${pr.events.map((e) => e.prob)})`);
    expect(e0.alternatives.every((a) => a.symbol !== e0.symbol && Array.isArray(a.midis) && a.midis.length >= 2), "alternatives are distinct labels with playable voicings");
    const onGrid = (t) => beatsOf(8, 0.25).some((g) => Math.abs(g - t) < 1e-3);
    expect(pr.events.every((e) => onGrid(e.startSec)), "every v2 chord change lands on the (subdivided) beat grid");
  }
  // HMM: posteriors are distributions; a gated beat is no-chord; an ambiguous beat is unconfident
  {
    const E = [new Float64Array([1, 0.2, 0.1]), new Float64Array([0.5, 0.5, 0.1]), new Float64Array([0.1, 1, 0.1])];
    const h = eng.hmmChordDecode(E, [false, false, true], { temperature: 0.05, changePenalty: 0.1 });
    expect(h.post.every((g) => Math.abs(g.reduce((a, b) => a + b, 0) - 1) < 1e-9), "forward-backward posteriors sum to 1 per beat");
    expect(h.path[2] === 2, "a gated (silent) beat decodes to the no-chord state");
    expect(h.path[0] === 0, "a clear beat decodes to its best state");
  }

  // Stage C · inversions are STATES: C/E ≠ Em (same bass, different treble)
  {
    const ce = eng.transcribeChordsV2(chordSig(4, [[0, 4, [40, 60, 64, 67]]]), VSR, { beats: beatsOf(4) }).events;
    const em = eng.transcribeChordsV2(chordSig(4, [[0, 4, [40, 52, 55, 59]]]), VSR, { beats: beatsOf(4) }).events;
    expect(majority(ce, 0.5, 3.5) === "C/E", `E bass under C-E-G is C/E (got ${syms(ce)})`);
    expect(majority(em, 0.5, 3.5) === "Em", `E bass under E-G-B is Em, not an inversion (got ${syms(em)})`);
    // a triad over a FOREIGN (non-chord-tone) bass — the Lowdown voicing G | F#-A-C#
    const fg = [43, 66, 69, 73];
    const dc = eng.transcribeChordsV2(chordSig(4, [[0, 4, fg]]), VSR, { beats: beatsOf(4) }).events;
    expect(majority(dc, 0.5, 3.5) === "F#m/G" && eng.symbolForMidis(fg, true) === "F#m/G", `F#m over a G bass reads F#m/G, as the notation oracle does (got ${syms(dc)})`);
    const noSlash = eng.transcribeChordsV2(chordSig(4, [[0, 4, fg]]), VSR, { beats: beatsOf(4), slashChords: false }).events;
    expect(majority(noSlash, 0.5, 3.5) !== "F#m/G", "slashChords:false removes the foreign-bass states");
    const sus = eng.transcribeChordsV2(chordSig(4, [[0, 4, [36, 58, 62, 65]]]), VSR, { beats: beatsOf(4) }).events;
    expect(majority(sus, 0.5, 3.5) === "Bb/C", `the sus-dominant voicing C | Bb-D-F reads Bb/C (got ${syms(sus)})`);
    const d7 = eng.transcribeChordsV2(chordSig(4, [[0, 4, [36, 62, 66, 69]]]), VSR, { beats: beatsOf(4) }).events;
    expect(majority(d7, 0.5, 3.5) === eng.symbolForMidis([36, 62, 66, 69], true), `C under D-F#-A is the oracle's ${eng.symbolForMidis([36, 62, 66, 69], true)} (got ${syms(d7)})`);
    const inv = majority(ce, 0.5, 3.5);
    const ceEv = ce.find((e) => e.symbol === inv);
    expect(ceEv && ceEv.midis[0] % 12 === 4 && ceEv.midis[0] < Math.min(...ceEv.midis.slice(1)), "an inverted event's voicing puts its bass note at the bottom");
  }

  // gaps: a short staccato gap carries the chord; a long silence is a rest
  {
    const shortGap = chordSig(6, [[0, 2.5, [48, 52, 55, 60]], [3.3, 6, [48, 52, 55, 60]]]);
    const sg = eng.transcribeChordsV2(shortGap, VSR, { beats: beatsOf(6) }).events;
    expect(sg.length === 1 && sg[0].symbol === "C", `a 0.8 s gap does not break the chord into C · N.C. · C (got ${sg.map((e) => `${e.symbol}@${e.startSec}`)})`);
    expect(eng.transcribeChordsV2(shortGap, VSR, { beats: beatsOf(6), minRestSec: 0 }).events.length === 2, "…because of the short-gap carry (minRestSec:0 splits it)");
    const longGap = chordSig(8, [[0, 2.5, [48, 52, 55, 60]], [5.5, 8, [48, 52, 55, 60]]]);
    const lg = eng.transcribeChordsV2(longGap, VSR, { beats: beatsOf(8) }).events;
    expect(lg.length === 2 && lg.every((e) => e.startSec + e.durSec <= 3.1 || e.startSec >= 5.0), `a 3 s silence is a rest (got ${lg.map((e) => `${e.symbol}@${e.startSec}+${e.durSec}`)})`);
    expect(eng.transcribeChordsV2(new Float32Array(VSR), VSR, {}).events.length === 0, "pure silence yields no chords, not a crash");
  }

  // Stage D · repetition smoothing is opt-in and shape-preserving
  {
    const segs = Array.from({ length: 40 }, (_, i) => ({ t0: i, t1: i + 1, chroma: Float64Array.from({ length: 12 }, (_, p) => ((p + i) % 4 === 0 ? 1 : 0.1)), bass: new Float64Array(12).fill(0.1), level: -20 }));
    const sm = eng.repetitionSmooth(segs, { embed: 4, threshold: 0.8 });
    expect(sm.length === segs.length && sm.every((s) => s.chroma.length === 12 && s.bass.length === 12), "repetitionSmooth keeps one 12+12-d segment per beat");
    expect(sm.some((s) => s.repeats > 0), "a periodic sequence finds its repeats");
    const plain = eng.transcribeChordsV2(prog, VSR, { beats: beatsOf(8) }), rep = eng.transcribeChordsV2(prog, VSR, { beats: beatsOf(8), repetition: true });
    expect(Array.isArray(rep.events) && plain.events.length > 0, "repetition:true runs end-to-end (it is opt-in: it did not generalise on the held-out benchmark)");
  }

  // routing: analyzeAudioChords → v2 by default; engine:"v1" keeps the legacy path
  {
    const click = new Float32Array(prog);
    for (let b = 0; b * 0.5 < 8; b++) { const at = Math.floor(b * 0.5 * VSR); for (let i = 0; i < VSR * 0.02 && at + i < click.length; i++) click[at + i] += Math.sin(2 * Math.PI * 1500 * i / VSR) * Math.exp(-i / (VSR * 0.004)); }
    const r2 = eng.analyzeAudioChords(click, VSR);
    expect(r2.method === "synharmonics-v2" && typeof r2.tuning === "number", `analyzeAudioChords defaults to SynHarmonics v2 (got ${r2.method})`);
    const r1 = eng.analyzeAudioChords(click, VSR, { engine: "v1" });
    expect(r1.method === "beat-sync" || r1.method === "sliding", `engine:"v1" keeps the legacy decoder (got ${r1.method})`);
    // uncertainty reaches the chart
    const sc = eng.audioEventsToScore([{ symbol: "C", midis: [48, 52, 55], startSec: 0, durSec: 2, ambiguous: true }, { symbol: "G", midis: [43, 47, 50], startSec: 2, durSec: 2 }], { bpm: 120 });
    expect(sc.bars[0].events[0].uncertain === true && !sc.bars[1].events[0].uncertain, "audioEventsToScore carries the uncertain flag onto chart events");
  }
  // noise-floor rests: a pad that rests between chords, under steady hiss, must not
  // turn the hiss into a chord (measured: a 54%-rest organ part read 98% clean, 43% noisy)
  {
    const sig = chordSig(12, [[0, 3, [48, 52, 55, 60]], [8, 11, [41, 45, 48, 53]]]);
    let st = 7; const rnd = () => ((st = (st * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1;
    let lp = 0; for (let i = 0; i < sig.length; i++) { lp += 0.05 * (rnd() - lp); sig[i] += 0.02 * rnd() + 0.06 * lp; }
    const ev = eng.transcribeChordsV2(sig, VSR, { beats: beatsOf(12) }).events;
    const inRest = ev.filter((e) => e.startSec < 7.0 && e.startSec + e.durSec > 4.0);
    expect(majority(ev, 0.5, 2.5) === "C" && majority(ev, 8.5, 10.5) === "F", `the chords either side of the rest still decode (got ${syms(ev)})`);
    expect(inRest.length === 0, `hiss in a rest is not a chord (got ${inRest.map((e) => `${e.symbol}@${e.startSec}`)})`);
    const off = eng.transcribeChordsV2(sig, VSR, { beats: beatsOf(12), flatEntropy: 1 }).events.filter((e) => e.startSec < 7.0 && e.startSec + e.durSec > 4.0);
    expect(off.length > 0, "…because of the flat-chroma rest test (flatEntropy:1 lets the hiss through as a chord)");
  }

  // batch review: commit choices, auto-resolve, reopen (pure; the UI's ChordReview drives these)
  {
    const evs = [
      { symbol: "C", midis: [48, 52, 55], prob: 0.3, ambiguous: true, alternatives: [{ symbol: "Am7/C", prob: 0.25, midis: [36, 57, 60, 64, 67] }, { symbol: "C6", prob: 0.1, midis: [48, 52, 55, 57] }] },
      { symbol: "G", midis: [43, 47, 50], prob: 0.9, ambiguous: false, alternatives: [] },
      { symbol: "F", midis: [41, 45, 48], prob: 0.35, ambiguous: true, alternatives: [{ symbol: "Dm7/F", prob: 0.3, midis: [29, 50, 53, 57, 60] }] },
    ];
    const c = eng.commitChordChoices(evs, [{ index: 0, symbol: "Am7/C" }, { index: 2, symbol: "F" }]);
    expect(c[0].symbol === "Am7/C" && c[0].midis[0] === 36 && !c[0].ambiguous && c[0].reviewed, "commit swaps in the chosen alternative WITH its voicing and clears the flag");
    expect(c[0].alternatives[0].symbol === "C", "the replaced label stays one tap away as an alternative");
    expect(c[2].symbol === "F" && !c[2].ambiguous && c[2].reviewed, "committing the detected label confirms it");
    expect(evs[0].symbol === "C" && evs[0].ambiguous, "commitChordChoices never mutates its input");
    expect(eng.commitChordChoices(evs, [{ index: 0, symbol: "Ebmaj7" }])[0].symbol === "C", "a symbol that is not one of the event's candidates is ignored");
    const a = eng.autoResolveChords(evs);
    expect(a.filter((e) => e.ambiguous).length === 0 && a[0].autoResolved && a[0].symbol === "C" && !a[1].autoResolved, "Auto takes the decoder's best match for every uncertain chord, leaving confident ones alone");
    const r = eng.reopenAutoChords(eng.commitChordChoices(a, [{ index: 2, symbol: "Dm7/F" }]));
    expect(r[0].ambiguous && !r[0].autoResolved && !r[2].ambiguous && r[2].symbol === "Dm7/F", "switching Auto off re-queues auto-picks but keeps what the user committed");
    const sc = eng.audioEventsToScore(a.map((e, i) => ({ ...e, startSec: 2 * i, durSec: 2 })), { bpm: 120 });
    expect(sc.bars.every((b) => b.events.every((e) => !e.uncertain)), "auto-resolved chords are not drawn as uncertain");
  }

  // ---- per-instrument charts from STEMS ----
  {
    const R = (() => { let st = 11; return () => ((st = (st * 1103515245 + 12345) >>> 0) / 4294967296) * 2 - 1; })();
    const roles = { "Song - Vocals.wav": "vocals", "drums.wav": "drums", "bass.mp3": "bass", "Song - Guitar.wav": "guitar", "piano.wav": "piano",
      "other.wav": "other", "song_instrumental.mp3": "other", "accompaniment.wav": "other", "Backing Vocals.wav": "vocals", "bass drum.wav": "drums", "bassoon.wav": null };
    for (const [n, r] of Object.entries(roles)) expect(eng.stemRoleFromName(n) === r, `stemRoleFromName(${n}) → ${r} (got ${eng.stemRoleFromName(n)})`);
    // a rendered kit at full rate, known hits: kick on 1&3, snare on 2&4, hats on 8ths
    const DSR = 44100, bpm = 100, spb = 60 / bpm, len = DSR * 8, kit = new Float32Array(len), truth = [];
    for (let b = 0; b * spb * DSR < len; b++) {
      const at = Math.floor(b * spb * DSR);
      if (b % 2 === 0) { truth.push({ t: b * spb, type: "kick" }); for (let i = 0; i < 0.3 * DSR && at + i < len; i++) { const t = i / DSR; kit[at + i] += 0.9 * Math.sin(2 * Math.PI * (50 + 70 * Math.exp(-t * 30)) * t) * Math.exp(-t * 9); } }
      else { truth.push({ t: b * spb, type: "snare" }); for (let i = 0; i < 0.18 * DSR && at + i < len; i++) { const t = i / DSR; kit[at + i] += (0.5 * R() + 0.3 * Math.sin(2 * Math.PI * 185 * t)) * Math.exp(-t * 22); } }
      for (const off of [0, 0.5]) { const tt = (b + off) * spb, h = Math.floor(tt * DSR); if (h >= len) continue; truth.push({ t: tt, type: "hat" }); let hp = 0, pv = 0; for (let i = 0; i < 0.05 * DSR && h + i < len; i++) { const w = R(); hp = 0.85 * (hp + w - pv); pv = w; kit[h + i] += 0.25 * hp * Math.exp(-i / (DSR * 0.012)); } }
    }
    const hits = eng.transcribeDrums(kit, DSR);
    for (const type of ["kick", "snare", "hat"]) {
      const g = truth.filter((h) => h.type === type && h.t < 7.8), e = hits.filter((h) => h.type === type);
      const used = new Set(); let tp = 0;
      for (const h of g) { const j = e.findIndex((x, k) => !used.has(k) && Math.abs(x.t - h.t) < 0.05); if (j >= 0) { used.add(j); tp++; } }
      const P = e.length ? tp / e.length : 0, Rc = g.length ? tp / g.length : 0, F = (2 * P * Rc) / (P + Rc || 1);
      expect(F > 0.85, `drum transcription finds the ${type} (F ${F.toFixed(2)}, P ${P.toFixed(2)} R ${Rc.toFixed(2)})`);
    }
    const pat = eng.drumPattern(hits, { bpm, beatsPerBar: 4 });
    // bar 2 (a hit at sample 0 has no "rise" before it to detect — a fixture edge, not a song's)
    const b2 = pat.bars[1];
    expect(pat.bars.length >= 3 && b2.kick === "x.......x......." && b2.snare === "....x.......x..." && b2.hat === "x.x.x.x.x.x.x.x.",
      `the groove grid reads kick 1&3, snare 2&4, eighth hats (bar 2: K ${b2.kick} S ${b2.snare} H ${b2.hat})`);
    const mid = eng.drumHitsToMidi(hits, { bpm });
    let ons = 0; for (let i = 0; i + 2 < mid.length; i++) if (mid[i] === 0x99 && [36, 38, 42].includes(mid[i + 1]) && mid[i + 2] > 0) ons++;
    expect(String.fromCharCode(...mid.slice(0, 4)) === "MThd" && ons === hits.length, `drum MIDI: one GM note-on per hit on channel 10 (${ons}/${hits.length})`);

    // chartsFromStems: other = C→G block chords, bass = C2/G2, drums, vocal line — one shared grid
    const n = VSR * 8, other = chordSig(8, [[0, 4, [48, 55, 60, 64, 67]], [4, 8, [43, 50, 55, 59, 62]]]);
    const bass = new Float32Array(n); tone(bass, hz(36), 0, 4, 0.3); tone(bass, hz(43), 4, 8, 0.3);
    const vocals = new Float32Array(n); [[0, 1, 64], [1, 2, 67], [2, 4, 72], [4, 6, 71], [6, 8, 67]].forEach(([a, b, m]) => tone(vocals, hz(m), a, b, 0.2, 4));
    const drums16 = eng.resampleTo(kit, DSR, VSR);
    const res = eng.chartsFromStems({ other, bass, drums: drums16, vocals }, VSR, { fullRate: { drums: kit, sampleRate: DSR } });
    const byRole = Object.fromEntries(res.charts.map((c) => [c.role, c]));
    expect(["band", "bass", "vocals", "drums"].every((r) => byRole[r]), `one chart per instrument (got ${res.charts.map((c) => c.role)})`);
    expect(Math.abs(res.bpm - 100) < 5, `the shared grid is tracked on the drum stem (~100 bpm, got ${res.bpm})`);
    const band = byRole.band.events;
    expect(majority(band, 0.5, 3.5) === "C" && majority(band, 4.5, 7.5) === "G", `band chart C → G (got ${syms(band)})`);
    const onShared = (t) => t < 0.05 || res.beats.some((b, i) => i + 1 < res.beats.length && [0, 0.5].some((f) => Math.abs(b + f * (res.beats[i + 1] - b) - t) < 1e-3));
    expect(band.every((e) => onShared(e.startSec)), "every band-chart change sits on the SHARED (drum-tracked) grid");
    const bl = byRole.bass.notes.map((x) => x.midi % 12);
    expect(bl.includes(0) && bl.includes(7) && byRole.bass.notes.every((x) => x.midi < 60), `bass chart reads the C and G roots in the bass register (got ${byRole.bass.notes.map((x) => x.midi)})`);
    const vm = byRole.vocals.notes.map((x) => x.midi);
    expect([64, 67, 72, 71].every((m) => vm.includes(m)), `vocal chart reads the melody E G C B G (got ${vm})`);
    expect(byRole.drums.hits.length >= 20, "drum chart carries the hits");
    const noDrum = eng.chartsFromStems({ other }, VSR);
    expect(noDrum.charts.length === 1 && noDrum.charts[0].role === "band", "a single harmonic stem yields just the band chart (no duplicate)");
    expect(eng.chartsFromStems({}, VSR).charts.length === 0, "no stems → no charts, no crash");
  }

  // WAV encoder for stem downloads
  {
    const w = eng.encodeWav16([Float32Array.from([0, 0.5, -1, 1]), Float32Array.from([0, -0.5, 1, 2])], 44100);
    const v = new DataView(w.buffer);
    expect(String.fromCharCode(...w.slice(0, 4)) === "RIFF" && String.fromCharCode(...w.slice(8, 12)) === "WAVE" && v.getUint16(22, true) === 2 && v.getUint32(24, true) === 44100 && v.getUint16(34, true) === 16,
      "encodeWav16 writes a 16-bit stereo RIFF/WAVE header");
    expect(v.getUint32(40, true) === 16 && w.length === 60 && v.getInt16(44 + 2 * 2, true) === 16384 && v.getInt16(44 + 4 * 2, true) === -32768 && v.getInt16(44 + 7 * 2, true) === 32767,
      "samples are interleaved, scaled to 16 bits and clipped at ±1");
  }

  synhSummary = `SynHarmonics v2: C G Am F ✓ · C/E vs Em ✓ · F#m/G + Bb/C ✓ · +35¢ read as ${tuneSharp.toFixed(0)}¢ · Bb 3rd-harmonic F suppressed · 15 kHz alias −40 dB+`;
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

/* ---- parseLyrics: chords-over-lyrics / ChordPro → clean lyrics-only sheet ---
 * A pure text transform (the inverse of an authoring tool): strip the chords, keep
 * the words + the song structure. Two dialects, auto-detected line by line. The
 * load-bearing part is chord-vs-word disambiguation — a strict chord matcher plus
 * line-level classification (ALL tokens must be chords/markers) so an ordinary word
 * saves the whole lyric line. */
{
  // token-level: real chords match, and ordinary words that START with a note letter DON'T
  expect(["C", "G", "Am", "F#m7", "D/F#", "Bb", "Cmaj7", "C7(b9)", "G7sus4"].every(eng.isChordToken),
    "isChordToken accepts real chord symbols (incl. slash, extensions, alterations)");
  expect(!["Add", "Cab", "Bad", "Fed", "Gem", "Bee", "Ace", "the", "you", "I", "Stop"].some(eng.isChordToken),
    "isChordToken rejects lyric words that begin with a note letter (Add/Cab/Bad/Fed/Gem/Bee/Ace/…)");

  // line-level: a pure chord line (incl. repeat markers) is a chord line; a lyric line isn't
  expect(eng.isChordLine("   C        G") && eng.isChordLine("C  G  Am  F") && eng.isChordLine("D/F#  G/B  C")
    && eng.isChordLine("C G (x2) |"), "isChordLine detects chord lines (spacing, slash chords, repeat/barline markers)");
  expect(!eng.isChordLine("Am I the only one") && !eng.isChordLine("A little brown mav'rick") && !eng.isChordLine("Stop, You gotta stop") && !eng.isChordLine(""),
    "isChordLine leaves lyric lines (one real word disqualifies the line) and blank lines alone");

  // inline chordpro tags are stripped and the gap closed
  expect(eng.stripInlineChords("There's a [C]bright golden [G]haze").replace(/ +/g, " ") === "There's a bright golden haze",
    `stripInlineChords removes [chord] tags, got: "${eng.stripInlineChords("There's a [C]bright golden [G]haze")}"`);

  // full chords-over-lyrics parse (the ultimate-guitar layout in the photos)
  const cov = "[Verse 1]\n       C            G\nThere's a bright golden haze on the meadow\n        F         C\nThe corn is as high as an elephant's eye\n\nChorus\n   C            G\nOh, what a beautiful mornin'";
  const pc = eng.parseLyrics(cov);
  expect(pc.sections.length === 2 && pc.sections[0].label === "Verse 1" && pc.sections[1].label === "Chorus",
    `parseLyrics finds the [Verse 1] + bare Chorus sections, got ${JSON.stringify(pc.sections.map((s) => s.label))}`);
  expect(pc.sections[0].blocks[0].length === 2 && pc.sections[0].blocks[0][0] === "There's a bright golden haze on the meadow",
    "parseLyrics drops the chord lines and keeps the lyric lines under Verse 1");
  expect(!/[ ]{2,}|\bC\b\s+\bG\b/.test(pc.plain) && !pc.plain.includes("F         C"),
    "parseLyrics plain output carries no chord lines");
  expect(pc.plain.includes("VERSE 1") && pc.plain.includes("CHORUS"), "plain sheet uppercases the section headers (photo style)");

  // ChordPro dialect: {title}/{artist}, inline [chords], {soc}, and a {sot}..{eot} tab block skipped
  const cp = "{title: Beautiful Mornin'}\n{artist: R&H}\n{c: Verse 1}\nThere's a [C]bright golden [G]haze\n{soc}\n[C]Oh what a [G]beautiful mornin'\n{sot}\ne|--0--2--|\nB|--1--3--|\n{eot}";
  const pp = eng.parseLyrics(cp);
  expect(pp.title === "Beautiful Mornin'" && pp.subtitle === "R&H", `ChordPro {title}/{artist} captured, got ${pp.title} / ${pp.subtitle}`);
  expect(pp.sections.length === 2 && pp.sections[0].label === "Verse 1" && pp.sections[1].label === "Chorus",
    `ChordPro sections from {c:}/{soc}, got ${JSON.stringify(pp.sections.map((s) => s.label))}`);
  expect(pp.sections[0].blocks[0][0] === "There's a bright golden haze", "ChordPro inline chords stripped from the lyric");
  expect(!pp.plain.includes("--0--") && !pp.plain.includes("|--"), "ChordPro {sot}..{eot} tab block is not treated as lyrics");

  // stanzas: a blank line splits a section into blocks; the leading no-label block is kept
  const st = eng.parseLyrics("line one\nline two\n\nline three");
  expect(st.sections.length === 1 && st.sections[0].label === null && st.sections[0].blocks.length === 2,
    "a blank line splits stanzas within an unlabelled block");

  // ambiguity: a lone [A] reads as a chord (dropped); [Verse A] is a section label kept
  expect(eng.parseLyrics("[A]\nlyric").sections[0].label === null, "a lone [A] is a chord, not a section (dropped)");
  expect(eng.parseLyrics("[Verse A]\nlyric").sections[0].label === "Verse A", "[Verse A] is kept as a section label");

  // regression: a ChordPro file that stores LYRICS INSIDE {comment} (chords on their
  // own [bracket] lines) must read the comments as words, not as empty section headers.
  // A short keyword comment ({c: Chorus}) is still a header; a prose comment is a lyric.
  const inComments = "{title: RnR}\n{composer: Billy Joel}\n{start_of_verse: Verse 1}\n[C] [Em] [Bb] [F]\n{comment: What's the matter with the clothes I'm wearing?}\n{comment: Can't you tell that your tie's too wide?}\n{start_of_chorus: Chorus}\n[C] [Em] [Bb] [F_Am]\n[G_C]\n{comment: Everybody's talkin' 'bout the new sound}";
  const ic = eng.parseLyrics(inComments);
  expect(ic.title === "RnR" && ic.subtitle === "Billy Joel", `title + {composer}→subtitle captured, got ${ic.title} / ${ic.subtitle}`);
  expect(ic.sections.length === 2 && ic.sections.map((s) => s.label).join("|") === "Verse 1|Chorus",
    `lyrics-in-{comment} → 2 named sections (no G_C/empty-header noise), got ${JSON.stringify(ic.sections.map((s) => s.label))}`);
  expect(ic.sections[0].blocks[0].length === 2 && ic.sections[0].blocks[0][0] === "What's the matter with the clothes I'm wearing?",
    "{comment} prose lines are kept as the section's lyric lines");

  // compound/sequence chord brackets are chords, not labels
  expect(eng.isChordBracket("G_C") && eng.isChordBracket("C Em Bb F") && eng.isChordBracket("A") && !eng.isChordBracket("Verse A"),
    "isChordBracket: [G_C]/[C Em Bb F]/[A] are chords; [Verse A] is a label");
  expect(eng.parseLyrics("[G_C]\nsing").sections[0].label === null, "a lone compound [G_C] beat is a chord, not a section");

  // robustness: empty / null / all-chords input never throws and yields no sections
  expect(eng.parseLyrics("").sections.length === 0 && eng.parseLyrics(null).sections.length === 0, "empty/null input → no sections, no throw");
  expect(eng.parseLyrics("C G Am F\nEm  D  C").sections.length === 0, "an all-chords paste yields no lyric sections");
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

/* ---- splitVoices — SATB-style voice separation from ML notes --------------
 * The ML transcription is polyphonic but unlabeled; splitVoices assigns each note
 * to a voice slot (0 = highest, N-1 = lowest) so a vocal-harmony stem can be
 * displayed / exported as separate lines. */
{
  // Held C-major triad: 3 simultaneous notes → each takes its own slot, ordered high→low
  const triad = [
    { midi: 60, startSec: 0, durSec: 1 },
    { midi: 64, startSec: 0, durSec: 1 },
    { midi: 67, startSec: 0, durSec: 1 },
  ];
  const s3 = eng.splitVoices(triad, { voices: 3 });
  expect(s3.length === 3, `held triad → 3 voice notes, got ${s3.length}`);
  const byV = new Map(); for (const n of s3) byV.set(n.voice, n);
  expect(byV.get(0).midi === 67 && byV.get(1).midi === 64 && byV.get(2).midi === 60,
    `triad voice assignment (v0=high): got v0=${byV.get(0).midi} v1=${byV.get(1).midi} v2=${byV.get(2).midi}`);
  expect(byV.get(0).startSec === 0 && Math.abs(byV.get(0).durSec - 1) < 1e-3,
    "held triad preserves the full duration on each voice");

  // voices:2 on the same triad → the LOWEST is dropped (below the bottom voice)
  const s2 = eng.splitVoices(triad, { voices: 2 });
  expect(s2.length === 2 && s2.every((n) => n.midi >= 64) && s2.some((n) => n.midi === 67) && s2.some((n) => n.midi === 64),
    `voices:2 keeps top two (67, 64), got ${JSON.stringify(s2.map((n) => n.midi))}`);

  // Sequential melody (only one note at a time) → all in voice 0
  const seq = [
    { midi: 60, startSec: 0, durSec: 0.5 },
    { midi: 62, startSec: 0.5, durSec: 0.5 },
    { midi: 64, startSec: 1.0, durSec: 0.5 },
  ];
  const ss = eng.splitVoices(seq, { voices: 3 });
  expect(ss.length === 3 && ss.every((n) => n.voice === 0),
    "sequential melody → all voice 0 (only one note active at a time)");

  // Voice CROSSING (legacy "register" method) — held bass note joined then overtaken
  // by a new higher note.
  //   held: MIDI 60 from t=0 to t=2 (initially voice 0 since alone)
  //   new:  MIDI 72 from t=1 to t=2 (top rank in [1,2), so voice 0 in that slice)
  // The held 60 becomes voice 1 in [1,2) → emitted as two runs.
  const cross = [
    { midi: 60, startSec: 0, durSec: 2 },
    { midi: 72, startSec: 1, durSec: 1 },
  ];
  const sc = eng.splitVoices(cross, { voices: 2, method: "register" });
  const held0 = sc.filter((n) => n.midi === 60);
  expect(held0.length === 2, `crossing splits held note into two runs, got ${held0.length}`);
  expect(held0.some((n) => n.voice === 0 && Math.abs(n.startSec) < 1e-3 && Math.abs(n.durSec - 1) < 1e-3)
      && held0.some((n) => n.voice === 1 && Math.abs(n.startSec - 1) < 1e-3 && Math.abs(n.durSec - 1) < 1e-3),
    "crossing: 60 is v0 in [0,1) then v1 in [1,2) after the higher 72 joins");
  const top = sc.find((n) => n.midi === 72);
  expect(top && top.voice === 0, "crossing: 72 is v0 while it sounds");
  // Same input, DEFAULT voice-leading method: the held 60 is ONE singer — it stays in
  // the lower slot for its whole length (one run) and the entering 72 takes the top.
  const vl = eng.splitVoices(cross, { voices: 2 });
  const vl60 = vl.filter((n) => n.midi === 60);
  expect(vl60.length === 1 && vl60[0].voice === 1 && Math.abs(vl60[0].durSec - 2) < 1e-3,
    `voice-leading: held 60 stays one run in v1, got ${JSON.stringify(vl60)}`);
  expect(vl.find((n) => n.midi === 72).voice === 0, "voice-leading: entering 72 takes the top slot");

  // splitVoices → polyNotesToScore, one score per voice (composability)
  const perVoice = [0, 1, 2].map((v) => eng.polyNotesToScore(s3.filter((n) => n.voice === v), { bpm: 120, beatsPerBar: 4 }));
  expect(perVoice.every((sc) => sc.source === "ml"), "per-voice scores tag source=ml (round-trip through polyNotesToScore)");
  expect(perVoice[0].bars[0].events[0].midis[0] === 67, "voice-0 score plays the soprano pitch (67)");

  // Edge cases
  expect(eng.splitVoices([]).length === 0, "empty notes → empty split");
  expect(eng.splitVoices(null).length === 0, "null notes → empty split");
  expect(eng.splitVoices(triad, { voices: 0 }).length > 0, "voices:0 defaults to a sensible split (not crash)");
}

/* ---- SATB → standard-notation multi-part score export --------------------
 * splitVoicesToScores + scoreToMultipart{MusicXML,ABC}: one labelled staff per
 * voice, lead on top, shared key/meter, aligned barlines. The MusicXML must be
 * well-formed and open in notation software. */
{
  // canonical part labels: lead on top, SATB below
  expect(eng.voicePartNames(1).join("|") === "Lead Vocal", `1-voice label should be Lead Vocal, got ${eng.voicePartNames(1)}`);
  expect(eng.voicePartNames(3).join("|") === "Soprano/Lead|Alto|Tenor", `3-voice labels drifted: ${eng.voicePartNames(3)}`);
  expect(eng.voicePartNames(4).join("|") === "Soprano/Lead|Alto|Tenor|Bass", `4-voice labels drifted: ${eng.voicePartNames(4)}`);
  // circle-of-fifths key signature: C major=0, E major=+4, F major=−1, A minor=0, C minor=−3
  expect(eng._keyFifths({ tonic: 0, mode: "major" }) === 0, "C major → 0 fifths");
  expect(eng._keyFifths({ tonic: 4, mode: "major" }) === 4, "E major → +4 fifths");
  expect(eng._keyFifths({ tonic: 5, mode: "major" }) === -1, "F major → −1 fifths");
  expect(eng._keyFifths({ tonic: 9, mode: "minor" }) === 0, "A minor → 0 fifths (relative C)");
  expect(eng._keyFifths({ tonic: 0, mode: "minor" }) === -3, "C minor → −3 fifths (relative Eb)");

  // A 3-part vocal: C-major triad held bar 1, F-major triad held bar 2 (@120bpm, 2s/bar)
  const vox = [
    { midi: 67, startSec: 0, durSec: 1 }, { midi: 64, startSec: 0, durSec: 1 }, { midi: 60, startSec: 0, durSec: 1 },
    { midi: 72, startSec: 2, durSec: 1 }, { midi: 69, startSec: 2, durSec: 1 }, { midi: 65, startSec: 2, durSec: 1 },
  ];
  const parts = eng.splitVoicesToScores(vox, { voices: 3, bpm: 120, beatsPerBar: 4, useSharp: true, naming: "satb" });
  expect(parts.length === 3, `3 voices → 3 parts, got ${parts.length}`);
  expect(parts.map((p) => p.name).join("|") === "Soprano/Lead|Alto|Tenor", `part names: ${parts.map((p) => p.name)}`);
  // voice 0 = highest line (soprano) → G4/C5 ; voice 2 = lowest → C4/F4
  expect(parts[0].score.bars[0].events[0].midis[0] === 67, `soprano bar1 should be 67 (G4), got ${parts[0].score.bars[0].events[0].midis[0]}`);
  expect(parts[2].score.bars[0].events[0].midis[0] === 60, `tenor(low) bar1 should be 60 (C4), got ${parts[2].score.bars[0].events[0].midis[0]}`);

  const xml = eng.scoreToMultipartMusicXML(parts, { key: { tonic: 0, mode: "major" }, tempo: 120, title: "Vocal Test", useSharp: true });
  // well-formed + correct structure
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  expect(doc.getElementsByTagName("parsererror").length === 0, "multipart MusicXML must be well-formed XML");
  expect(/<score-partwise/.test(xml), "multipart output is score-partwise");
  expect((xml.match(/<score-part /g) || []).length === 3, `part-list should hold 3 score-parts, got ${(xml.match(/<score-part /g) || []).length}`);
  expect((xml.match(/<part id=/g) || []).length === 3, `should emit 3 <part> elements, got ${(xml.match(/<part id=/g) || []).length}`);
  // lead part is first, labelled
  expect(/<part-name>Soprano\/Lead<\/part-name>[\s\S]*<part-name>Alto/.test(xml), "Soprano/Lead part-name comes before Alto (lead on top)");
  // key + time + clef present
  expect(/<key><fifths>0<\/fifths><mode>major<\/mode><\/key>/.test(xml), "C-major key signature emitted");
  expect(/<time><beats>4<\/beats><beat-type>4<\/beat-type><\/time>/.test(xml), "4/4 time signature emitted");
  expect(/<clef><sign>G<\/sign><line>2<\/line><\/clef>/.test(xml), "treble clef emitted for the vocal lines");
  expect(/<sound tempo="120"\/>/.test(xml), "tempo carried into the score");
  // real notes (not just names), voice labels visible as text
  expect(/<pitch><step>G<\/step><octave>4<\/octave><\/pitch>/.test(xml), "soprano G4 emitted as a real notated pitch");
  expect(!/<words>/.test(xml), "no duplicate staff-label text by default (the part name sits left of the staff)");
  expect(/<words>Soprano\/Lead<\/words>/.test(eng.scoreToMultipartMusicXML(parts, { labelStaves: true })), "labelStaves:true prints the name above bar 1");
  // divisions ≥ 480 (task requirement)
  expect(/<divisions>480<\/divisions>/.test(xml), "divisions ≥ 480 (per requirement)");
  // barlines align: every part spans the same measure count
  const measCounts = Array.from(doc.getElementsByTagName("part")).map((pt) => pt.getElementsByTagName("measure").length);
  expect(measCounts.every((c) => c === measCounts[0] && c === 2), `all staves span the same 2 bars, got ${JSON.stringify(measCounts)}`);

  // ALIGNMENT with a short voice: a voice that stops early is padded with a
  // whole-measure rest so barlines still line up.
  const uneven = [
    { midi: 72, startSec: 0, durSec: 1 }, { midi: 60, startSec: 0, durSec: 1 },   // bar1: two voices
    { midi: 74, startSec: 2, durSec: 1 },                                          // bar2: only the top voice
  ];
  const up = eng.splitVoicesToScores(uneven, { voices: 2, bpm: 120, beatsPerBar: 4, useSharp: true });
  const uxml = eng.scoreToMultipartMusicXML(up, { key: { tonic: 0, mode: "major" }, tempo: 120 });
  const udoc = new DOMParser().parseFromString(uxml, "text/xml");
  const uCounts = Array.from(udoc.getElementsByTagName("part")).map((pt) => pt.getElementsByTagName("measure").length);
  expect(uCounts.length === 2 && uCounts.every((c) => c === uCounts[0]), `uneven voices still align (${JSON.stringify(uCounts)})`);
  expect(/rest measure="yes"/.test(uxml), "a silent bar in a shorter voice is a whole-measure rest (keeps barlines aligned)");

  // enharmonic spelling follows the key when useSharp is not forced: F major → flats
  const fParts = eng.splitVoicesToScores([{ midi: 70, startSec: 0, durSec: 1 }], { voices: 1, bpm: 120, beatsPerBar: 4 });
  const fxml = eng.scoreToMultipartMusicXML(fParts, { key: { tonic: 5, mode: "major" } }); // Bb4 = midi 70
  expect(/<step>B<\/step><alter>-1<\/alter>/.test(fxml), "F-major key spells midi 70 as Bb (flat), not A#");

  // ABC multi-voice
  const abc = eng.scoreToMultipartABC(parts, { key: { tonic: 0, mode: "major" }, tempo: 120, title: "Vocal Test" });
  expect(/V:1 name="Soprano\/Lead"/.test(abc) && /V:2 name="Alto"/.test(abc) && /V:3 name="Tenor"/.test(abc), "ABC declares one V: per voice, lead first");
  expect(/%%score \[1 2 3\]/.test(abc), "ABC brackets all three voices on one system (barlines unjoined)");

  // "no backing detected" → lead-only score
  const solo = eng.splitVoicesToScores([{ midi: 67, startSec: 0, durSec: 1 }], { voices: 3, bpm: 120, beatsPerBar: 4 });
  expect(solo.length === 1 && solo[0].name === "Lead Vocal", `single-line stem → one lead part, got ${solo.length} ${solo[0] && solo[0].name}`);

  // --- 16th-grid notation quantiser: valid durations, ties, measures sum exact ---
  // A note of 3.5 quarters (14 ticks) → dotted-half TIED to an eighth, then rests
  // fill the bar. No zero/degenerate durations; measure divisions sum to 1920.
  const nm = eng._voiceNotationMeasures([{ midi: 72, onsetBeat: 0, durBeat: 3.5 }], { beatsPerBar: 4, beatType: 4, div: 480 });
  expect(nm.measures.length === 1, `one bar expected, got ${nm.measures.length}`);
  const cells = nm.measures[0];
  expect(cells.every((c) => c.divs > 0), "no zero-length cells in quantised notation");
  expect(cells.reduce((s, c) => s + c.divs, 0) === 1920, `measure must sum to 1920 divisions, got ${cells.reduce((s, c) => s + c.divs, 0)}`);
  const pitched = cells.filter((c) => !c.rest);
  expect(pitched.length >= 2 && pitched[0].tieStart && pitched[pitched.length - 1].tieStop, "a >1-value note is emitted as tied chunks");
  const shape = cells.map((c) => (c.rest ? "r:" : "n:") + c.type + (c.dot ? "." : "")).join(" ");
  expect(shape === "n:half. n:eighth r:eighth", `expected dotted-half~eighth + eighth rest, got: ${shape}`);

  // A DENSE bar (5 onsets in one 4/4 bar) — the case the coarse beat grid collapsed
  // to zero-length events. Quantised: every duration positive, measure sums exact,
  // and the emitted MusicXML has no <duration>0.
  const dense = [0, 0.75, 1.5, 2.25, 3].map((b, i) => ({ midi: [60, 62, 64, 65, 67][i], onsetBeat: b, durBeat: 0.75 }));
  const dnm = eng._voiceNotationMeasures(dense, { beatsPerBar: 4, beatType: 4, div: 480 });
  expect(dnm.measures[0].reduce((s, c) => s + c.divs, 0) === 1920, "dense bar still sums to a full 4/4 measure");
  const dxml = eng.scoreToMultipartMusicXML([{ name: "Lead Vocal", beatNotes: dense, clef: "treble" }], { key: { tonic: 0, mode: "major" } });
  expect(!/<duration>0<\/duration>/.test(dxml), "quantiser never emits a zero-duration note (dense bar)");
  expect(new DOMParser().parseFromString(dxml, "text/xml").getElementsByTagName("parsererror").length === 0, "dense-bar MusicXML is well-formed");

  // greedy value decomposition
  expect(eng._noteValuesFromTicks(5).map((v) => v.type + (v.dot ? "." : "")).join(" ") === "quarter 16th", "5 ticks → quarter + 16th");
  expect(eng._noteValuesFromTicks(7).map((v) => v.type + (v.dot ? "." : "")).join(" ") === "quarter. 16th", "7 ticks → dotted-quarter + 16th");
}

/* ---- Vocal score v2 (2026-10-11): voice-leading split, choral engraving, key-aware
 * spelling, metric notation, rehearsal marks, learning-track MIDI. ------------- */
{
  // -- voice-leading separation -------------------------------------------------
  // A 3-part texture (full chords at t=0 and t=4) with a stretch in between where
  // ONLY the low voice sings a stepwise line. The legacy split dumps that line into
  // the TOP voice (rank 0); voice-leading keeps it with the singer it belongs to.
  const tex = [
    { midi: 72, startSec: 0, durSec: 1 }, { midi: 67, startSec: 0, durSec: 1 }, { midi: 60, startSec: 0, durSec: 1 },
    { midi: 59, startSec: 1, durSec: 1 }, { midi: 57, startSec: 2, durSec: 1 }, { midi: 59, startSec: 3, durSec: 1 },
    { midi: 72, startSec: 4, durSec: 1 }, { midi: 67, startSec: 4, durSec: 1 }, { midi: 60, startSec: 4, durSec: 1 },
  ];
  const vRef = eng.splitVoices(tex, { voices: 3, method: "register" });
  const vVL = eng.splitVoices(tex, { voices: 3 });
  const lowLine = (sp) => sp.filter((n) => n.startSec >= 1 - 1e-6 && n.startSec < 4 - 1e-6).map((n) => n.voice);
  expect(lowLine(vRef).every((v) => v === 0), "legacy register split puts a lone low line in the top voice (the defect)");
  expect(lowLine(vVL).every((v) => v === 2), `voice-leading keeps the lone low line in the bass slot, got ${lowLine(vVL)}`);
  // A melody sung ALONE (verse) before the harmonies join (chorus) stays on ONE staff —
  // the lead's — even though it sits in Harmony 1's chorus register (run linking).
  {
    const N = [];
    [[0, 1, 67], [1, 1, 69], [2, 2, 71], [4, 1.5, 72], [5.5, 0.5, 71], [6, 2, 69], [8, 1, 67], [9, 1, 66], [10, 2, 67], [12, 3, 74], [15, 1, 72]]
      .forEach(([b, d, m]) => N.push({ midi: m, startSec: b * 0.5, durSec: d * 0.5 }));
    [[16, 2, [71, 67, 62]], [18, 2, [72, 69, 64]], [20, 2, [74, 71, 67]], [22, 2, [74, 66, 62]]]
      .forEach(([b, d, ms]) => ms.forEach((m) => N.push({ midi: m, startSec: b * 0.5, durSec: d * 0.5 })));
    const sv = eng.splitVoices(N, { voices: 3 });
    const verse = sv.filter((n) => n.startSec < 8 - 1e-6);
    expect(verse.length === 11 && verse.every((n) => n.voice === 0), `solo verse stays whole on the lead (v0): ${verse.map((n) => n.voice).join("")}`);
    expect(sv.filter((n) => n.startSec >= 8 - 1e-6 && n.voice === 0).map((n) => n.midi).join(",") === "71,72,74,74", "chorus top line = lead");
  }
  // learned registers come from the full-texture slices
  const cen = eng._voiceCenters(eng._voiceSlices(tex), 3);
  expect(cen[0] === 72 && cen[1] === 67 && cen[2] === 60, `register centres from full chords, got ${cen}`);
  // more notes than voices: the misfit (an octave ghost above the soprano) is dropped, NOT the real bass
  const ghost = [
    { midi: 72, startSec: 0, durSec: 1 }, { midi: 67, startSec: 0, durSec: 1 }, { midi: 60, startSec: 0, durSec: 1 },
    { midi: 84, startSec: 1, durSec: 1, amp: 0.3 }, { midi: 72, startSec: 1, durSec: 1 }, { midi: 67, startSec: 1, durSec: 1 }, { midi: 60, startSec: 1, durSec: 1 },
  ];
  const gs = eng.splitVoices(ghost, { voices: 3 });
  expect(!gs.some((n) => n.midi === 84) && gs.filter((n) => n.midi === 60).every((n) => n.voice === 2),
    `k>V drops the ghost above, keeps the bass: ${JSON.stringify(gs.map((n) => n.midi + "v" + n.voice))}`);
  // every voice line stays monophonic
  for (let v = 0; v < 3; v++) {
    const line = vVL.filter((n) => n.voice === v).sort((a, b) => a.startSec - b.startSec);
    expect(line.every((n, i) => !i || n.startSec >= line[i - 1].startSec + line[i - 1].durSec - 1e-6), `voice ${v} line is monophonic`);
  }
  // suggested voice count: up to 3 parts for meaningful time, a 50ms 4-note blip doesn't count
  const sug = eng.suggestVoiceCount([...tex, { midi: 76, startSec: 0, durSec: 0.05 }]);
  expect(sug.count === 3, `suggestVoiceCount → 3, got ${JSON.stringify(sug)}`);
  expect(eng.suggestVoiceCount([]).count === 1, "suggestVoiceCount on nothing → 1");

  // -- voice types / naming / clefs ---------------------------------------------
  const st = (m) => ({ median: m, p10: m - 3, p90: m + 3, low: m - 5, high: m + 5 });
  expect(eng.classifyVoiceTypes([st(72), st(64), st(57), st(50)]).join(",") === "soprano,alto,tenor,bass", "SATB medians classify S,A,T,B");
  expect(eng.classifyVoiceTypes([st(74), st(70), st(63)]).join(",") === "soprano,soprano,alto", "SSA trio classifies soprano,soprano,alto (repeats allowed)");
  expect(eng.classifyVoiceTypes([st(50), st(70)]).join(",") !== "bass,soprano", "type order never rises as the lines descend");
  const satb = [
    { midi: 72, startSec: 0, durSec: 2 }, { midi: 64, startSec: 0, durSec: 2 }, { midi: 57, startSec: 0, durSec: 2 }, { midi: 48, startSec: 0, durSec: 2 },
    { midi: 74, startSec: 2, durSec: 2 }, { midi: 65, startSec: 2, durSec: 2 }, { midi: 59, startSec: 2, durSec: 2 }, { midi: 43, startSec: 2, durSec: 2 },
  ];
  const sp = eng.splitVoicesToScores(satb, { voices: 4, bpm: 120, beatsPerBar: 4 });
  expect(sp.map((p) => p.name).join("|") === "Soprano|Alto|Tenor|Bass", `range naming: ${sp.map((p) => p.name)}`);
  expect(sp.map((p) => p.clef).join("|") === "treble|treble|treble8vb|bass", `clefs by voice type: ${sp.map((p) => p.clef)}`);
  expect(sp.map((p) => p.abbr).join("|") === "S.|A.|T.|B.", "standard part abbreviations");
  const hp = eng.splitVoicesToScores(satb, { voices: 4, bpm: 120, naming: "harmony", leadVoice: 1 });
  expect(hp[0].name === "Lead Vocal" && hp[0].voice === 1, "harmony naming: lead part (voice 2) moves to the TOP staff");
  expect(hp.slice(1).map((p) => p.name).join("|") === "High Harmony|Low Harmony 1|Low Harmony 2", `harmony labels: ${hp.map((p) => p.name)}`);
  expect(eng.splitVoicesToScores(satb, { voices: 4, naming: "numbered" }).map((p) => p.name).join("|") === "Voice 1|Voice 2|Voice 3|Voice 4", "numbered naming");

  // -- key from notes (Krumhansl–Kessler) ---------------------------------------
  const scaleNotes = (pcs, base) => pcs.map((pc, i) => ({ midi: base + pc, durSec: i === 0 ? 3 : 1 }));
  const kG = eng.keyFromNotes(scaleNotes([7, 9, 11, 0, 2, 4, 6, 7, 2, 11], 48));
  expect(kG && kG.tonic === 7 && kG.mode === "major", `G-major line → G major, got ${JSON.stringify(kG)}`);
  const kAm = eng.keyFromNotes(scaleNotes([9, 0, 4, 9, 11, 0, 2, 4, 8, 9, 4, 9], 48));
  expect(kAm && kAm.tonic === 9 && kAm.mode === "minor", `A-minor line (with G#) → A minor, got ${JSON.stringify(kAm)}`);
  expect(eng.keyFromNotes([]) === null, "keyFromNotes on nothing → null");

  // -- key-aware spelling ---------------------------------------------------------
  const nm = (key, m) => { const p = eng._keySpeller(key)(m); return p.step + ({ "-2": "bb", "-1": "b", 0: "", 1: "#", 2: "x" })[p.alter] + p.oct; };
  expect(nm({ tonic: 2, mode: "minor" }, 61) === "C#4", "D minor leading tone is C#, not Db");
  expect(nm({ tonic: 5, mode: "major" }, 70) === "Bb4", "F major 4th is Bb");
  expect(nm({ tonic: 3, mode: "major" }, 64) === "E4", "Eb major chromatic E is E-natural (#1), not Fb");
  expect(nm({ tonic: 8, mode: "minor" }, 67) === "Fx4", "G# minor leading tone is F double-sharp");
  expect(nm({ tonic: 1, mode: "minor" }, 60) === "B#3", "C# minor leading tone is B#3 (octave from the letter)");
  expect(nm({ tonic: 6, mode: "major" }, 65) === "E#4", "F# major 7th is E#");
  expect(nm({ tonic: 0, mode: "major" }, 70) === "Bb4" && nm({ tonic: 0, mode: "major" }, 66) === "F#4", "C major: b7 flat, #4 sharp");

  // -- metric note values --------------------------------------------------------
  const meter44 = eng._meterLevels(4, 4), meter68 = eng._meterLevels(6, 8);
  expect(meter44.levels.join(",") === "16,8,4,2,1" && meter68.levels.join(",") === "12,6,2,1" && eng._meterLevels(3, 4).levels.join(",") === "12,4,2,1",
    `meter hierarchies 4/4 ${meter44.levels} 6/8 ${meter68.levels}`);
  const vals = (a, b, m, rest) => eng._metricValues(a, b, m, rest).map((v) => v.type + (v.dot ? "." : "")).join(" ");
  expect(vals(4, 10, meter44, false) === "quarter eighth", `dotted-qtr on beat 2 shows beat 3 (q~e), got ${vals(4, 10, meter44, false)}`);
  expect(vals(2, 6, meter44, false) === "quarter", "8th-QTR-8th syncopation kept as one quarter");
  expect(vals(4, 12, meter44, false) === "half", "qtr-HALF-qtr syncopation kept as one half");
  expect(vals(0, 12, meter44, true) === "half quarter", `rests never dotted in simple time, got ${vals(0, 12, meter44, true)}`);
  expect(vals(2, 8, meter68, false) === "quarter eighth", `6/8: note across the dotted-qtr beat splits there, got ${vals(2, 8, meter68, false)}`);
  expect(vals(0, 6, meter68, true) === "quarter.", "6/8: a dotted-quarter rest on the beat is fine");

  // -- notation options: grid + legato -----------------------------------------
  const ragged = [{ midi: 67, onsetBeat: 0, durBeat: 0.3 }, { midi: 69, onsetBeat: 0.5, durBeat: 0.3 }, { midi: 71, onsetBeat: 1, durBeat: 0.9 }];
  const cellsOf = (o) => eng._voiceNotationMeasures(ragged, { beatsPerBar: 4, beatType: 4, div: 480, ...o }).measures[0];
  const shape = (cs) => cs.map((c) => (c.rest ? "r" : "n") + ":" + c.type + (c.dot ? "." : "")).join(" ");
  expect(cellsOf({}).filter((c) => c.rest).length > cellsOf({ legatoBeats: 0.5 }).filter((c) => c.rest).length, "legato closes the tiny gaps between sung syllables");
  expect(cellsOf({ grid: 2 }).every((c) => c.type !== "16th"), `8th grid emits no 16ths, got ${shape(cellsOf({ grid: 2 }))}`);
  expect(cellsOf({ grid: 2, legatoBeats: 0.5 }).reduce((s, c) => s + c.divs, 0) === 1920, "grid/legato measures still sum to a full bar");

  // -- the choral MusicXML -----------------------------------------------------
  const kC = { tonic: 0, mode: "major" };
  const cx = eng.scoreToMultipartMusicXML(sp, { key: kC, tempo: 96, title: "Rehearsal", composer: "Test", barsPerSystem: 1,
    sections: [{ label: "Chorus", startSec: 2.5 }] });
  const cdoc = new DOMParser().parseFromString(cx, "text/xml");
  expect(cdoc.getElementsByTagName("parsererror").length === 0, "choral MusicXML is well-formed");
  expect(/<part-group type="start" number="1"><group-symbol>bracket<\/group-symbol><group-barline>no<\/group-barline><\/part-group>/.test(cx)
    && /<part-group type="stop" number="1"\/>/.test(cx), "vocal staves bracketed with barlines broken between staves");
  expect((cx.match(/<part-abbreviation>/g) || []).length === 4, "every part carries an abbreviation for later systems");
  expect((cx.match(/<midi-program>53<\/midi-program>/g) || []).length === 4 && /<midi-channel>4<\/midi-channel>/.test(cx), "each part = Choir Aahs on its own MIDI channel");
  expect(/<clef><sign>G<\/sign><line>2<\/line><clef-octave-change>-1<\/clef-octave-change><\/clef>/.test(cx), "tenor part uses treble-8vb");
  expect(/<clef><sign>F<\/sign><line>4<\/line><\/clef>/.test(cx), "bass part uses bass clef");
  expect(/<creator type="composer">Test<\/creator>/.test(cx) && /<software>Tab Translator Pro<\/software>/.test(cx), "identification block");
  expect(/<rehearsal enclosure="rectangle">Chorus<\/rehearsal>/.test(cx), "section → boxed rehearsal mark");
  expect((cx.match(/<rehearsal /g) || []).length === 1, "rehearsal mark printed once (top staff), not on every part");
  expect((cx.match(/light-light/g) || []).length === 4 && (cx.match(/light-heavy/g) || []).length === 4, "double bar before the section + final barline on every part");
  expect((cx.match(/<print new-system="yes"\/>/g) || []).length === 4, "barsPerSystem:1 → a system break at bar 2 in each part");
  expect(/<metronome><beat-unit>quarter<\/beat-unit><per-minute>96<\/per-minute><\/metronome>/.test(cx), "metronome mark");
  // accidentals: printed when needed, carried through the bar, cancelled by a natural
  const accLine = [{ midi: 66, onsetBeat: 0, durBeat: 1 }, { midi: 66, onsetBeat: 1, durBeat: 1 }, { midi: 65, onsetBeat: 2, durBeat: 1 }, { midi: 66, onsetBeat: 4, durBeat: 1 }];
  const ax = eng.scoreToMultipartMusicXML([{ name: "Alto", beatNotes: accLine, clef: "treble" }], { key: kC });
  const accs = (ax.match(/<accidental>[a-z-]+<\/accidental>/g) || []).map((x) => x.replace(/<\/?accidental>/g, ""));
  expect(accs.join(",") === "sharp,natural,sharp", `accidental carry: F# F# F♮ | F# → sharp,natural,sharp, got ${accs}`);
  // 6/8 metronome on the eighth, sound tempo in quarters
  const x68 = eng.scoreToMultipartMusicXML([{ name: "S", beatNotes: [{ midi: 72, onsetBeat: 0, durBeat: 3 }] }], { key: kC, tempo: 180, beatsPerBar: 6, beatType: 8 });
  expect(/<beat-unit>eighth<\/beat-unit><per-minute>180/.test(x68) && /<sound tempo="90"\/>/.test(x68), "6/8: metronome in eighths, <sound tempo> in quarters");

  // -- ABC: pitches relative to K:, per-bar accidentals --------------------------
  const fLine = [{ midi: 71, onsetBeat: 0, durBeat: 1 }, { midi: 71, onsetBeat: 1, durBeat: 1 }, { midi: 70, onsetBeat: 2, durBeat: 1 }, { midi: 71, onsetBeat: 4, durBeat: 1 }];
  const fabc = eng.scoreToMultipartABC([{ name: "Lead", beatNotes: fLine }], { key: { tonic: 5, mode: "major" } });
  const body = fabc.split("\n").slice(fabc.split("\n").indexOf("V:1", fabc.indexOf("K:")) + 1).join(" ");
  expect(/K:F/.test(fabc) && /=B =B _B/.test(body) && /\| =B/.test(body), `ABC under K:F writes every B-natural as =B (reader-robust) and Bb as _B after it: ${body}`);
  const sabc = eng.scoreToMultipartABC(sp, { key: kC, sections: [{ label: "Chorus", startSec: 2.5 }] });
  expect(/clef=treble-8/.test(sabc) && /snm="T\."/.test(sabc), "ABC tenor uses treble-8 + short name");
  expect(/"\^Chorus"/.test(sabc) && /\|\|/.test(sabc) && /\|\]/.test(sabc), "ABC rehearsal annotation, section double bar, final bar");

  // -- range report -------------------------------------------------------------
  const hi = eng.splitVoicesToScores([{ midi: 84, startSec: 0, durSec: 1 }, { midi: 72, startSec: 1, durSec: 1 }], { voices: 1 });
  hi[0].voiceType = "soprano";
  const rr = eng.vocalRangeReport(hi, { key: kC });
  expect(rr[0].above === 1 && rr[0].below === 0 && !rr[0].ok && rr[0].highName === "C6" && rr[0].rangeName === "C4–A5", `range report flags the C6: ${JSON.stringify(rr[0])}`);
  expect(eng.vocalRangeReport(sp, { key: kC }).every((r) => r.ok), "a clean SATB stays inside every range");

  // -- learning-track MIDI (format 1, one track per part) ------------------------
  const mid = eng.scoreToVocalMidi(sp, { key: kC, tempo: 120, title: "Rehearsal", emphasize: 1 });
  const dv = new DataView(mid.buffer);
  expect(String.fromCharCode(...mid.slice(0, 4)) === "MThd" && dv.getUint16(8) === 1 && dv.getUint16(10) === 5 && dv.getUint16(12) === 480,
    "SMF format 1, conductor + 4 part tracks, PPQ 480");
  // walk tracks: count note-ons + velocities per track
  let off = 14; const tracks = [];
  while (off < mid.length) {
    const len = dv.getUint32(off + 4); const data = mid.slice(off + 8, off + 8 + len); off += 8 + len;
    const t = { ons: [], name: "", program: null }; let i = 0, run = 0;
    const vlq = () => { let v = 0, b; do { b = data[i++]; v = (v << 7) | (b & 0x7f); } while (b & 0x80); return v; };
    while (i < data.length) {
      vlq(); let st = data[i];
      if (st === 0xFF) { const ty = data[i + 1]; i += 2; const l = vlq(); if (ty === 0x03) t.name = String.fromCharCode(...data.slice(i, i + l)); i += l; continue; }
      if (st & 0x80) { run = st; i++; } else st = run;
      const hi4 = st & 0xf0;
      if (hi4 === 0xC0) { t.program = data[i]; i += 1; }
      else { const a = data[i], b = data[i + 1]; i += 2; if (hi4 === 0x90 && b > 0) t.ons.push([a, b]); }
    }
    tracks.push(t);
  }
  expect(tracks.slice(1).map((t) => t.name).join("|") === "Soprano|Alto|Tenor|Bass" && tracks.slice(1).every((t) => t.program === 52), "named part tracks on Choir Aahs");
  expect(tracks[2].ons.length === 2 && tracks[2].ons.every(([, v]) => v === 112) && tracks[1].ons.every(([, v]) => v === 64), "emphasized part louder, others ducked");
  expect(tracks[4].ons.map(([m]) => m).join(",") === "48,43", `bass track plays its own line, got ${tracks[4].ons.map(([m]) => m)}`);
  console.log(`Vocal score v2: voice-leading split · ${sp.map((p) => p.name + "(" + p.clef + ")").join(" ")} · key-aware spelling · metric values · rehearsal MIDI ${mid.length} B`);
}

/* ---- ABC notation 2.1 compliance (abcnotation.com standard) ------------------
 * Every ABC export is a standard 2.1 file: `%abc-2.1` identification line first,
 * explicit utf-8 charset, an empty line before X:, K: spelled consistently with the
 * notes, and pitches that read the same under every reader's accidental-carry rule. */
{
  const C3 = (ms, sym, beat = 0, dur = 1) => ({ symbol: sym, beat, durBeats: dur, qbeat: beat, qdur: dur, midis: ms });
  const sc = (events, sig = [4, 4]) => ({ timeSig: sig, bars: [{ number: 1, timeSig: sig, events }] });
  const one = eng.scoreToABC(sc([C3([60, 64, 67], "C", 0, 4)]), { title: "Hdr" });
  const lines = one.split("\n");
  expect(lines[0] === "%abc-2.1", `ABC line 1 must be the file identification line %abc-2.1, got ${JSON.stringify(lines[0])}`);
  expect(lines.includes("I:abc-charset utf-8"), "ABC declares its charset (utf-8) in the file header");
  expect(lines[lines.indexOf("X:1") - 1] === "", "an empty line separates the file header from the first tune (X:)");
  expect(lines.indexOf("X:1") < lines.findIndex((l) => l.startsWith("T:")) && lines.findIndex((l) => l.startsWith("T:")) < lines.findIndex((l) => l.startsWith("K:")), "tune header order X: → T: → … → K:");
  expect(eng.ABC_MIME === "text/vnd.abc", "ABC media type is the IANA-registered text/vnd.abc");
  const mp = eng.scoreToMultipartABC([{ name: "Lead", beatNotes: [{ midi: 67, onsetBeat: 0, durBeat: 2 }] }], { key: { tonic: 7, mode: "major" } });
  expect(mp.startsWith("%abc-2.1\nI:abc-charset utf-8\n"), "multi-voice ABC carries the same 2.1 file header");
  // K: spelled by the note speller (the family names Ebm/Abm would mean 6/7 FLATS in ABC)
  const kn = (t, m) => eng._abcKeyName({ tonic: t, mode: m });
  expect(kn(3, "minor") === "D#m" && kn(8, "minor") === "G#m" && kn(1, "major") === "Db" && kn(6, "major") === "F#" && kn(10, "major") === "Bb" && kn(9, "minor") === "Am",
    `K: names consistent with the key signature: ${[kn(3, "minor"), kn(8, "minor"), kn(1, "major"), kn(6, "major")]}`);
  // pitches relative to K: — in E major a G-natural must be written =G (bare G sounds G#)
  const eAbc = eng.scoreToABC(sc([C3([55], "G", 0, 1), C3([56], "G#", 1, 1)]), { key: { tonic: 4, mode: "major" } });
  expect(/K:E\n/.test(eAbc) && /"G"\[=G,\] "G#"\[\^G,\]/.test(eAbc), `K:E: G-natural is =G, and the G# after it in the same bar is re-sharpened: ${eAbc}`);
  const eBare = eng.scoreToABC(sc([C3([56], "G#", 0, 4)]), { key: { tonic: 4, mode: "major" } });
  expect(/"G#"\[G,\]/.test(eBare), `K:E: a G# with nothing before it is a bare G (the key signature sharpens it): ${eBare}`);
  // reader-robust carry: a chromatic note repeated in a bar is re-inflected; the return to the
  // key-signature pitch in the same bar is cancelled explicitly
  const cAbc = eng.scoreToABC(sc([C3([61], "C#", 0, 1), C3([61], "C#", 1, 1), C3([60], "C", 2, 1), C3([73], "C#", 3, 1)]), { key: { tonic: 0, mode: "major" } });
  const cBody = cAbc.slice(cAbc.indexOf("K:C\n") + 4);
  expect(/\[\^C\][^|]*\[\^C\][^|]*\[=C\][^|]*\[\^c\]/.test(cBody), `^C ^C =C ^c within one bar, got: ${cBody}`);
  // a bare note never relies on an earlier accidental, and a new bar resets nothing it needs
  const acc = eng._abcAccidentalTracker({ tonic: 5, mode: "major" });   // F major: Bb
  const sp = eng._keySpeller({ tonic: 5, mode: "major" });
  acc.newBar();
  expect(acc.need(sp(70)) === null && acc.need(sp(71)) === 0 && acc.need(sp(71)) === 0 && acc.need(sp(70)) === -1, "F major: Bb bare, B-natural =B (twice), back to Bb explicit _B");
  // no-chord placeholder → N.C.
  expect(/"N\.C\."z/.test(eng.scoreToABC(sc([{ symbol: "—", beat: 0, durBeats: 4, qbeat: 0, qdur: 4, midis: [] }]), {})), "the engine's — no-chord symbol is written as \"N.C.\"");
  // brass ABC keeps the header + its T:/K: insertions
  const brass = eng.scoreToBrassABC(sc([C3([60, 64, 67], "C", 0, 4)]), "trumpet-bb", { key: { tonic: 0, mode: "major" } });
  expect(brass.startsWith("%abc-2.1\n") && /K:D\n%%MIDI program 56/.test(brass), "brass ABC: 2.1 header, transposed K:D, MIDI program after K:");
  // UI: ABC downloads use the ABC media type, and the Alembic-safe .abc.txt on Apple platforms
  const ui = fs.readFileSync(UI, "utf8");
  expect(/function _isApplePlatform/.test(ui) && /"abc\.txt"/.test(ui) && /function useAbcExt/.test(ui), "UI: Apple platforms default to .abc.txt (Apple maps .abc → Alembic 3D)");
  expect(/abcMimeFor/.test(ui) && /ABC_MIME/.test(ui) && !/text\/vnd\.abc;charset/.test(ui), "UI: ABC blobs are typed via abcMimeFor/ABC_MIME, not a hard-coded string");
  expect((ui.match(/<AbcExtToggle /g) || []).length === 2, "UI: both ABC download sites offer the .abc / .abc.txt toggle");
  console.log("ABC 2.1: %abc-2.1 header · utf-8 · K: D#m/G#m/Db consistent · key-relative + reader-robust accidentals · text/vnd.abc · Apple .abc.txt");
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

/* ML note model (Wave 3 #10/11) wiring contract — browser-only glue (loads
 * tfjs + basic-pitch from esm.sh at first use, runs inference), so statically
 * guard the rails: the vendored model files exist and model.json is a valid
 * TF.js graph manifest, note-model.js publishes window.TTP_NOTE_MODEL as an
 * async function, load is lazy + failure is silent + init errors clear the
 * cache so retries can actually retry, index.html wires the module, and the
 * Pages deploy ships all three pieces alongside the rest of the app. */
const modelJsonPath = path.join(repo, "models", "basic-pitch", "model.json");
const modelBinPath = path.join(repo, "models", "basic-pitch", "group1-shard1of1.bin");
expect(fs.existsSync(modelJsonPath), "vendored basic-pitch model.json must exist at models/basic-pitch/");
expect(fs.existsSync(modelBinPath), "vendored basic-pitch weights shard must exist at models/basic-pitch/");
{
  const m = JSON.parse(fs.readFileSync(modelJsonPath, "utf8"));
  expect(m.format === "graph-model", `model.json format must be 'graph-model', got ${m.format}`);
  const manifest = (m.weightsManifest || [])[0] || {};
  expect(Array.isArray(manifest.paths) && manifest.paths.includes("group1-shard1of1.bin"),
    "model.json weightsManifest must reference group1-shard1of1.bin");
  const sig = m.signature || {};
  expect(sig.inputs && sig.outputs && Object.keys(sig.outputs).length >= 2,
    "model.json signature must expose inputs and (at least) frames+onsets outputs");
}
const noteModelSrc = fs.readFileSync(path.join(repo, "note-model.js"), "utf8");
expect(/window\.TTP_NOTE_MODEL\s*=/.test(noteModelSrc),
  "note-model.js must publish window.TTP_NOTE_MODEL");
expect(/async function TTP_NOTE_MODEL\s*\(/.test(noteModelSrc),
  "TTP_NOTE_MODEL must be async (loading + inference)");
expect(/models\/basic-pitch\/model\.json/.test(noteModelSrc),
  "note-model.js must load the vendored SAME-ORIGIN model (no third-party CDN for weights)");
expect(/@spotify\/basic-pitch/.test(noteModelSrc) && /@tensorflow\/tfjs/.test(noteModelSrc),
  "note-model.js must wrap Spotify's basic-pitch (which uses tfjs) — not a hand-rolled ONNX path");
expect(/_ready\s*=\s*null/.test(noteModelSrc) && /_ready\s*=\s*_initModel\(\)/.test(noteModelSrc) && /catch\s*\(/.test(noteModelSrc),
  "note-model.js init must be lazy, cached on success, and cleared on rejection so retries can actually retry");
expect(/typeof window !==\s*["']undefined["']/.test(noteModelSrc),
  "note-model.js must feature-detect window so a non-browser context (tests) is a no-op");
expect(/frameRate:\s*BP_FRAME_RATE|frameRate:\s*22050\s*\/\s*256/.test(noteModelSrc)
  && /minMidi:\s*BP_MIN_MIDI|minMidi:\s*21/.test(noteModelSrc),
  "TTP_NOTE_MODEL must return the basic-pitch contract (86.13 fps, minMidi 21) engine.tsx notesFromActivations expects");
expect(/<script type="module" src="\.\/note-model\.js"/.test(htmlSrc),
  "index.html must load note-model.js as a module so window.TTP_NOTE_MODEL is installed at boot");
expect(/cp\s+note-model\.js\s+_site/.test(pagesYml),
  "Pages deploy must ship note-model.js");
expect(/models\/basic-pitch\/model\.json\s+_site\/models\/basic-pitch\//.test(pagesYml)
  && /models\/basic-pitch\/group1-shard1of1\.bin\s+_site\/models\/basic-pitch\//.test(pagesYml),
  "Pages deploy must ship the vendored basic-pitch model + weights");
/* The UI's entry point (voices()) invokes the model via window.TTP_NOTE_MODEL and
 * decodes with notesFromActivations — it caches the raw onset/frame matrices so a
 * sensitivity change re-thresholds WITHOUT re-inference. Regression-guard that seam. */
expect(/window\.TTP_NOTE_MODEL/.test(uiSrc) && /notesFromActivations\s*\(/.test(uiSrc),
  "UI Audio panel must invoke the note model via window.TTP_NOTE_MODEL + notesFromActivations (wiring seam)");

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

/* ---- Brass / Horn / Sax section transposition (engine surface) -----------
 * `mx` is the concert-pitch MusicXML fixture parsed above (`C G | Am | F` in C major).
 * Every transposing instrument reads written pitches SEMITONES ABOVE concert. */
expect(Array.isArray(eng.BRASS_INSTRUMENTS) && eng.BRASS_INSTRUMENTS.length >= 10, "BRASS_INSTRUMENTS catalog present");
const trumpetBb = eng.getBrassInstrument("trumpet-bb");
const altoSax = eng.getBrassInstrument("alto-sax-eb");
const tenorSax = eng.getBrassInstrument("tenor-sax-bb");
const trombone = eng.getBrassInstrument("trombone");
const horn = eng.getBrassInstrument("horn-f");
expect(trumpetBb && trumpetBb.transposeSemitones === 2, "Bb trumpet reads M2 above concert");
expect(altoSax && altoSax.transposeSemitones === 9, "Eb alto sax reads M6 above concert");
expect(tenorSax && tenorSax.transposeSemitones === 14, "Bb tenor sax reads M9 above concert");
expect(trombone && trombone.transposeSemitones === 0 && trombone.clef === "bass", "trombone: concert pitch, bass clef");
expect(horn && horn.transposeSemitones === 7, "F horn reads P5 above concert");

// Concert C major → Bb trumpet reads it in D major (chord symbols shift up a M2).
const tptXml = eng.scoreToBrassMusicXML(mx, "trumpet-bb", { useSharp: true });
expect(/<part-name>[^<]*Trumpet[^<]*<\/part-name>/.test(tptXml), "trumpet part-name is set");
expect(/<root-step>D<\/root-step>/.test(tptXml) && !/<root-step>C<\/root-step>/.test(tptXml),
  "Bb trumpet: concert C → written D in the harmony");
expect(/<root-step>A<\/root-step>/.test(tptXml), "Bb trumpet: concert G → written A");

// Eb alto sax: concert C → written A (up a M6).
const altoXml = eng.scoreToBrassMusicXML(mx, "alto-sax-eb", { useSharp: true });
expect(/<part-name>[^<]*Alto Sax[^<]*<\/part-name>/.test(altoXml), "alto sax part-name is set");
expect(/<root-step>A<\/root-step>/.test(altoXml) && /<root-step>E<\/root-step>/.test(altoXml),
  "Eb alto sax: concert C → A, concert G → E");

// Trombone: concert pitch preserved, but rendered in bass clef.
const trbXml = eng.scoreToBrassMusicXML(mx, "trombone", { useSharp: true });
expect(/<sign>F<\/sign>[\s\S]*?<line>4<\/line>/.test(trbXml), "trombone: F clef line 4 injected");
expect(/<root-step>C<\/root-step>/.test(trbXml) && /<root-step>G<\/root-step>/.test(trbXml),
  "trombone: concert-pitch chord symbols preserved");
expect(/<part-name>Trombone<\/part-name>/.test(trbXml), "trombone part-name is set");

// F horn: concert C → written G (up a P5).
const hornXml = eng.scoreToBrassMusicXML(mx, "horn-f", { useSharp: true });
expect(/<root-step>G<\/root-step>/.test(hornXml), "F horn: concert C → written G");

// ABC brass export: %%MIDI program + T: header + transposed key.
const tptAbc = eng.scoreToBrassABC(mx, "trumpet-bb", { useSharp: true });
expect(/%%MIDI program 56/.test(tptAbc), "Bb trumpet ABC injects a trumpet MIDI program");
expect(/T:[^\n]*Trumpet/.test(tptAbc), "ABC carries the instrument name in a T: header");
expect(/K:D/.test(tptAbc), "Bb trumpet ABC key K:C → K:D");
const trbAbc = eng.scoreToBrassABC(mx, "trombone", { useSharp: true });
expect(/V:1 clef=bass/.test(trbAbc), "trombone ABC carries a V:1 clef=bass line");
expect(/K:C/.test(trbAbc), "trombone ABC key stays K:C (concert pitch)");

// Full section builder: one part per requested instrument, correct filenames.
const section = eng.buildBrassSection(mx, ["trumpet-bb", "alto-sax-eb", "tenor-sax-bb", "trombone"], {
  format: "musicxml", title: "Demo", useSharp: true,
});
expect(section.length === 4, "buildBrassSection returns one entry per requested instrument");
expect(section.every((p) => p.filename.endsWith(".xml")), "brass MusicXML parts have .xml filenames");
expect(section.some((p) => /Trombone/.test(p.filename)), "trombone part filename includes 'Trombone'");
// Unknown instrument ids are silently skipped (matches the CSMP UI's tolerance).
const skipped = eng.buildBrassSection(mx, ["not-a-real-id", "trumpet-bb"], { format: "musicxml" });
expect(skipped.length === 1 && skipped[0].id === "trumpet-bb", "unknown instrument ids are skipped");

console.log(`Brass: ${section.length} parts (trumpet C→D, alto C→A, tenor C→A, trombone concert bass-clef).`);

/* ============================================================================
 *  KEY MODEL v2 — harmonic-function weights (the "Can't You See" defect)
 *  ---------------------------------------------------------------------------
 *  The reported bug: an audio-decoded chart of Marshall Tucker's "Can't You See"
 *  (D · C · G, a ♭VII rock loop) was labelled E MINOR — a key whose tonic chord
 *  never sounds — because the old model scored a key purely by how much duration
 *  was diatonic to it, and C IS diatonic to E minor while it is only borrowed in
 *  D major. These pin the three terms that fix it (function weights, the borrowed
 *  table, tonic presence) and, just as importantly, that a genuinely minor tune
 *  does NOT now get swung to its relative major.
 * ==========================================================================*/
const mkScore = (bars) => ({
  timeSig: [4, 4],
  bars: bars.map((b, i) => ({
    number: i + 1, timeSig: [4, 4],
    events: b.map((s, j) => ({ symbol: s, beat: j * (4 / b.length), durBeats: 4 / b.length, qbeat: j * (4 / b.length), qdur: 4 / b.length })),
  })),
});
const keyOf = (bars) => eng.keyName(eng.analyzeKey(mkScore(bars)), true);

// THE reported defect. D is the tonic (it opens and closes every phrase); C is ♭VII.
const cysKey = keyOf([["D"], ["C"], ["G"], ["D"], ["D"], ["C"], ["G"], ["D"]]);
expect(cysKey === "D", `"Can't You See" (D C G D) should read D major, got ${cysKey} (was Em)`);
// …and E minor must not merely tie: it never states its tonic, so it should lose clearly.
const cysCands = eng.analyzeKeyCandidates(mkScore([["D"], ["C"], ["G"], ["D"]]));
const cysD = cysCands.find((c) => c.tonic === 2 && c.mode === "major");
const cysEm = cysCands.find((c) => c.tonic === 4 && c.mode === "minor");
expect(cysD.score > cysEm.score * 1.2, `D major should beat E minor comfortably (${cysD.score.toFixed(2)} vs ${cysEm.score.toFixed(2)})`);
expect(cysEm.tonicShare === 0, "E minor's tonic chord never sounds in D C G — tonicShare must be 0");
// the same shape one step round the circle: a G-mixolydian vamp is G, not C.
expect(keyOf([["G"], ["F"], ["C"], ["G"], ["G"], ["F"], ["C"], ["G"]]) === "G", "G F C vamp reads G major (♭VII), not C");
// GUARD (the failure mode of over-correcting): a real minor tune stays minor.
expect(keyOf([["Em"], ["D"], ["C"], ["Em"], ["Em"], ["D"], ["C"], ["B7"]]) === "Em", "a genuine E-minor tune stays E minor");
expect(keyOf([["Am"], ["Am"], ["Dm"], ["Am"], ["E7"], ["Dm"], ["Am"], ["E7"]]) === "Am", "a minor blues stays A minor");
// jazz: secondary dominants must not drag the key off its tonic
expect(keyOf([["Fmaj7"], ["Em7♭5", "Am7"], ["Dm7", "G7"], ["Cm7", "F7"], ["Bb7"], ["Am7", "D7"], ["Gm7", "C7"], ["Fmaj7"]]) === "F",
  "Confirmation-shaped changes read F major through their secondary dominants");

// candidate list: ranked, capped, and its head IS analyzeKey's answer
const cands = eng.analyzeKeyCandidates(mx, { limit: 3 });
expect(cands.length === 3 && cands[0].confidence >= cands[1].confidence && cands[1].confidence >= cands[2].confidence,
  "analyzeKeyCandidates returns a ranked, limited list");
expect(cands[0].tonic === mxKey.tonic && cands[0].mode === mxKey.mode, "analyzeKey is the head of analyzeKeyCandidates");
expect(eng.analyzeKeyCandidates({ bars: [] }).length === 0, "an empty score yields no key candidates");

// the SLASH BASS is a functional cue — but "6/9" is a suffix, not an inversion
expect(eng._parseSym("Eb6/9/F").bassPc === 5, "Eb6/9/F: bass F is read as the inversion");
expect(eng._parseSym("C6/9").bassPc == null, "C6/9: the 6/9 slash is a suffix, not a bass note");
expect(eng._parseSym("Am7/C").bassPc === 0 && eng._parseSym("Am7").bassPc == null, "Am7/C bass C; root-position Am7 has no bass");
expect(eng._parseSym("Csus4").bassPc == null, "sus4 is a suffix, not a slash bass");

// manual key override parsing (what the UI's key picker stores)
expect(eng.parseKeyName("D").tonic === 2 && eng.parseKeyName("D").mode === "major", "parseKeyName('D') → D major");
expect(eng.parseKeyName("F#m").tonic === 6 && eng.parseKeyName("F#m").mode === "minor", "parseKeyName('F#m') → F# minor");
expect(eng.parseKeyName("Bb minor").tonic === 10 && eng.parseKeyName("Bb minor").mode === "minor", "parseKeyName('Bb minor')");
expect(eng.parseKeyName("eb Major").tonic === 3 && eng.parseKeyName("eb Major").mode === "major", "parseKeyName is case-insensitive");
expect(eng.parseKeyName("Dsus4") === null && eng.parseKeyName("H") === null && eng.parseKeyName("") === null,
  "parseKeyName rejects chords and nonsense");
expect(eng.KEY_CHOICES.length === 24 && eng.KEY_CHOICES.filter((k) => k.mode === "minor").length === 12,
  "KEY_CHOICES lists all 24 keys");
// a picked key round-trips through the exporters exactly like a detected one
const forcedD = eng.parseKeyName("D");
expect(/^K:D$/m.test(eng.scoreToABC(mx, { key: forcedD, useSharp: true })), "a manually set key reaches the ABC K: header");
expect(/Key: D\b/.test(eng.scoreToCSMPN(mx, { key: forcedD, useSharp: true })), "a manually set key reaches the CSMPN header");
console.log(`Key v2: Can't You See D C G → ${cysKey} (was Em) · G F C → G · Em tune stays Em · overrides parse`);

/* ============================================================================
 *  SONG STRUCTURE — sections from audio (detectSections) + the editable list
 * ==========================================================================*/
/* nameSections is the pure naming half: repetition letters + energies in, the pop
 * template out. Tested on its own so a naming tweak can't hide behind the DSP. */
const namedAB = eng.nameSections([
  { letter: "A", startSec: 0,  endSec: 8,  energy: 0.3 },   // short opener, never returns → Intro
  { letter: "B", startSec: 8,  endSec: 40, energy: 0.5 },   // returns, quieter        → Verse
  { letter: "C", startSec: 40, endSec: 64, energy: 0.9 },   // returns, loudest        → Chorus
  { letter: "B", startSec: 64, endSec: 96, energy: 0.5 },
  { letter: "C", startSec: 96, endSec: 120, energy: 0.9 },
  { letter: "D", startSec: 120, endSec: 140, energy: 0.6 }, // one-off, late           → Bridge
  { letter: "C", startSec: 140, endSec: 164, energy: 0.9 },
]).map((s) => s.label);
expect(namedAB[0] === "Intro", `first short non-repeating part is the Intro, got ${namedAB[0]}`);
expect(namedAB[1] === "Verse 1" && namedAB[3] === "Verse 2", `the quieter recurring part is the Verse, got ${namedAB[1]}/${namedAB[3]}`);
expect(namedAB[2] === "Chorus 1" && namedAB[6] === "Chorus 3", `the loudest recurring part is the Chorus, got ${namedAB[2]}/${namedAB[6]}`);
expect(namedAB[5] === "Bridge", `a late one-off part is the Bridge, got ${namedAB[5]}`);
expect(eng.nameSections([]).length === 0 && eng.nameSections(null).length === 0, "nameSections is safe on empty input");
expect(eng.SECTION_SENSITIVITY.coarse.minSectionSec > eng.SECTION_SENSITIVITY.fine.minSectionSec,
  "SECTION_SENSITIVITY: coarse cuts the song into fewer, longer parts than fine");

/* End-to-end on SYNTHESIZED audio with a known form. Sections differ in harmony AND
 * arrangement (the chorus adds an octave doubling), because a real verse/chorus pair
 * very often shares its chords — which is exactly why the feature is chroma + timbre. */
const SSR = 16000;
function renderSong(plan, bpm) {
  const spb = 60 / bpm;
  const total = plan.reduce((a, s) => a + s.bars, 0) * 4 * spb;
  const buf = new Float32Array(Math.ceil(total * SSR));
  let seed = 7, rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  let t = 0;
  for (const sec of plan) for (let bar = 0; bar < sec.bars; bar++) for (let beat = 0; beat < 4; beat++) {
    const chord = sec.chords[(bar * 4 + beat) % sec.chords.length];
    const start = Math.floor(t * SSR), len = Math.floor(spb * SSR);
    for (let i = 0; i < len; i++) {
      const tt = i / SSR, env = Math.exp(-tt * 6);
      let v = 0;
      for (const m of chord) v += Math.sin(2 * Math.PI * 440 * Math.pow(2, (m - 69) / 12) * tt) / chord.length;
      if (sec.bright) for (const m of chord) v += 0.5 * Math.sin(2 * Math.PI * 440 * Math.pow(2, (m + 12 - 69) / 12) * tt) / chord.length;
      const click = i < 200 ? rnd() * 0.5 * Math.exp(-i / 60) : 0;   // a transient so the beat tracker locks
      if (start + i < buf.length) buf[start + i] += (v * env * sec.gain + click) * 0.6;
    }
    t += spb;
  }
  return buf;
}
const _C = [48, 52, 55], _G = [43, 47, 50], _Am = [45, 48, 52], _F = [41, 45, 48], _Em = [40, 43, 47], _Bb = [46, 50, 53];
const songPlan = [
  { bars: 2, chords: [_C, _C, _C, _C], gain: 0.5, bright: false },                    // 0–4s   intro
  { bars: 4, chords: [_C, _C, _G, _G, _Am, _Am, _F, _F], gain: 0.7, bright: false },  // 4–12s  verse
  { bars: 4, chords: [_F, _F, _C, _C, _G, _G, _C, _C], gain: 1.0, bright: true },     // 12–20s chorus
  { bars: 4, chords: [_C, _C, _G, _G, _Am, _Am, _F, _F], gain: 0.7, bright: false },  // 20–28s verse
  { bars: 4, chords: [_F, _F, _C, _C, _G, _G, _C, _C], gain: 1.0, bright: true },     // 28–36s chorus
  { bars: 4, chords: [_Em, _Em, _Bb, _Bb, _Em, _Em, _Bb, _Bb], gain: 0.8, bright: false }, // 36–44s bridge
  { bars: 4, chords: [_F, _F, _C, _C, _G, _G, _C, _C], gain: 1.0, bright: true },     // 44–52s chorus
];
const songPcm = renderSong(songPlan, 120);
const struct = eng.detectSections(songPcm, SSR, { minSectionSec: 6, noveltyThreshold: 0.35 });
expect(Math.abs(struct.bpm - 120) < 3, `structure pass reads the synthetic tempo (got ${struct.bpm && struct.bpm.toFixed(1)})`);
expect(struct.sections.length >= 4 && struct.sections.length <= 8,
  `A-B-A-B-C-B form should cut into a handful of parts, got ${struct.sections.length}`);
// every detected boundary must land on a REAL one (±1.5 s) — no invented sections
const truthBounds = [4, 12, 20, 28, 36, 44];
const nearTruth = struct.boundaries.every((b) => truthBounds.some((t) => Math.abs(b - t) <= 1.5));
expect(nearTruth, `detected boundaries ${struct.boundaries.map((b) => b.toFixed(1))} should all sit on a real one (${truthBounds})`);
expect(struct.boundaries.length >= 3, `should find most of the form's boundaries, got ${struct.boundaries.length}`);
// the bridge (36–44 s) is harmonically unlike everything else → its own repetition group
const bridgeSeg = struct.sections.find((s) => s.startSec > 33 && s.startSec < 38);
expect(bridgeSeg && struct.sections.filter((s) => s.letter === bridgeSeg.letter).length === 1,
  "the once-only bridge gets a repetition letter of its own");
// the two choruses that follow it are the SAME part
const lastTwo = struct.sections.slice(-1)[0];
expect(struct.sections.some((s) => s.letter === lastTwo.letter && s !== lastTwo),
  "a repeated part is clustered with its earlier occurrence");
expect(struct.sections.every((s) => s.endSec > s.startSec) &&
  struct.sections.every((s, i) => i === 0 || s.startSec === struct.sections[i - 1].endSec),
  "sections are contiguous and non-empty");
expect(eng.detectSections(new Float32Array(1000), SSR).sections.length === 0, "too-short audio yields no sections, not a crash");

/* applySectionsToScore — time → bar on the SAME grid audioEventsToScore quantised
 * onto, and the labels then ride out through every exporter for free. */
const audEvents = [
  { symbol: "C", midis: [48, 52, 55], startSec: 0, durSec: 4 },
  { symbol: "G", midis: [43, 47, 50], startSec: 4, durSec: 4 },
  { symbol: "Am", midis: [45, 48, 52], startSec: 8, durSec: 4 },
  { symbol: "F", midis: [41, 45, 48], startSec: 12, durSec: 4 },
];
const audScore = eng.audioEventsToScore(audEvents, { bpm: 120, beatsPerBar: 4 });   // 2 s per bar
const audSecs = [{ label: "Intro", startSec: 0 }, { label: "Verse 1", startSec: 4 }, { label: "Chorus", startSec: 12 }];
const audWith = eng.applySectionsToScore(audScore, audSecs, { bpm: 120, beatsPerBar: 4 });
expect(audWith.bars[0].section === "Intro" && audWith.bars[2].section === "Verse 1" && audWith.bars[6].section === "Chorus",
  `sections map onto bars 1/3/7 at 120bpm 4/4, got ${audWith.bars.map((b, i) => (b.section ? i + ":" + b.section : "")).filter(Boolean).join(" ")}`);
expect(!audScore.bars.some((b) => b.section), "applySectionsToScore never mutates the score it was given");
expect(audWith.bars.filter((b) => b.section).length === 3, "one label per bar — two sections can't land on the same bar");
const twoAtOnce = eng.applySectionsToScore(audScore, [{ label: "A", startSec: 0 }, { label: "B", startSec: 0.2 }], { bpm: 120, beatsPerBar: 4 });
expect(twoAtOnce.bars[0].section === "A" && twoAtOnce.bars[1].section === "B", "a colliding label is pushed to the next bar, never dropped");
const secCsmpn = eng.scoreToCSMPN(audWith, { title: "Demo", tempo: 120 });
expect(/^- Intro$/m.test(secCsmpn) && /^- Verse 1$/m.test(secCsmpn) && /^- Chorus$/m.test(secCsmpn),
  "detected sections become CSMPN section markers");
const secCsml = eng.scoreToCSML(audWith, { title: "Demo" });
expect(/^\[Intro\]$/m.test(secCsml) && /^\[Chorus\]$/m.test(secCsml), "detected sections become ChordSlashML [labels]");
const secXml = eng.scoreToMusicXML(audWith, { title: "Demo", tempo: 120 });
expect(/<rehearsal>Chorus<\/rehearsal>/.test(secXml), "MusicXML export writes a rehearsal mark for each section");
const secBack = eng.parseMusicXML(secXml, true);
expect(secBack.bars[0].section === "Intro" && secBack.bars[6].section === "Chorus",
  "…and parseMusicXML reads them back — the structure round-trips");
console.log(`Structure: synthetic A-B-A-B-C-B → ${struct.sections.length} parts, boundaries ${struct.boundaries.map((b) => b.toFixed(1)).join("/")}s (truth 4/12/20/28/36/44) · labels round-trip CSMPN/CSML/MusicXML`);
console.log(synhSummary);

/* ---- UI contract guards for the two features (static, like the module split) -- */
expect(/function KeyPicker\(/.test(uiSrc) && /<KeyPicker\b/.test(uiSrc), "the UI ships a key picker");
expect(/keyOverride/.test(uiSrc) && /saveSessionMeta\(\{[^}]*keyOverride/.test(uiSrc),
  "a manual key correction is persisted in the session meta (a corrected chart must restore corrected)");
expect(/function SectionEditor\(/.test(uiSrc) && /<SectionEditor\b/.test(uiSrc), "the UI ships an editable section list");
expect(/detectSectionsOffThread/.test(uiSrc) && /catch \(_\) \{ return detectSections\(samples, sr, opts\); \}/.test(uiSrc),
  "section detection runs off-thread with a main-thread fallback (correctness never depends on the worker)");
expect(/applySectionsToScore\(sc, sections/.test(uiSrc), "the edited section list is stamped onto the chart, so exports carry it");
expect(/src\.start\(0, at\)/.test(uiSrc), "the stem player can seek, so a section row can jump to its start");

/* Lyrics IMPORT (chords-over-lyrics / ChordPro → clean lyrics-only sheet) — the
 * transform is the pure engine parseLyrics (tested above); the UI is glue only.
 * Statically guard: it imports the pure function, ships the two components, the
 * Lyrics mode renders the panel, and the file input keeps NO `accept` filter
 * (the iOS UTI lesson — .cho/.crd/.pro would be greyed out otherwise). */
expect(/\bparseLyrics\b/.test(uiSrc), "UI must import + use the pure parseLyrics (no lyric-stripping logic duplicated in the UI)");
expect(/function LyricsImport\(/.test(uiSrc) && /function LyricsPanel\(/.test(uiSrc), "the UI ships LyricsImport + LyricsPanel");
expect(/mode === "lyrics" \? <LyricsPanel\b/.test(uiSrc), "the Lyrics mode renders LyricsPanel (live capture + import sub-tools)");
{
  const liBody = uiSrc.slice(uiSrc.indexOf("function LyricsImport("));
  const fileInput = liBody.slice(0, liBody.indexOf("</section>"));
  expect(/<input type="file"[^>]*onChange=\{onFile\}/.test(fileInput) && !/<input type="file"[^>]*accept=/.test(fileInput),
    "the lyrics-import file input has NO accept attribute (iOS greys out .cho/.crd/.pro UTIs otherwise)");
}

/* SynHarmonics v2 UI glue — the decoder is the pure engine (tested above); the UI only
 * resamples properly, routes to the default (v2) entry point, and surfaces uncertainty. */
expect(/resampleOffThread/.test(uiSrc) && /catch \(_\) \{ return resampleTo\(samples, srIn, srOut\); \}/.test(uiSrc),
  "the decode resamples with the anti-aliased resampleTo (off-thread, main-thread fallback)");
expect(!/const dsChan = \(d\) =>/.test(uiSrc), "the box-average decimator (aliasing) is gone from the decode path");
expect(/function ChordReview\(/.test(uiSrc) && /<ChordReview\b/.test(uiSrc), "the Audio panel ships the uncertain-chord review strip (v2 §7 overlay)");
expect(/Select all/.test(uiSrc) && /Commit selected/.test(uiSrc) && /Commit all/.test(uiSrc), "the review strip has batch controls: Select all, Commit selected, Commit all");
expect(/commitChordChoices\(evs, picks\)/.test(uiSrc) && /autoResolveChords/.test(uiSrc) && /reopenAutoChords/.test(uiSrc), "batch commit + Auto go through the pure engine helpers (no review logic duplicated in the UI)");
expect(/localStorage\.getItem\("ttp:autoPick"\)/.test(uiSrc) && /try \{ localStorage\.setItem\("ttp:autoPick"/.test(uiSrc), "the Auto preference is remembered per device, inside try/catch");
expect(/e\.uncertain && !edited/.test(uiSrc), "the lead sheet de-emphasises uncertain chords (confidence-graded rendering)");
expect(!/hopSec: 0\.12, smoothSec: 0\.5, recoverGaps: true/.test(uiSrc), "the chord run no longer sends v1-only sliding-window knobs to the v2 decoder");

/* Stems + live capture (browser glue). The separator itself is device-only (it downloads
 * ONNX Runtime + 13 MB of weights); guard the contracts that boot and correctness rest on. */
{
  const rd = (f) => fs.readFileSync(path.join(repo, f), "utf8");
  const sm = rd("stem-model.js"), core = rd("stem-model-core.js"), wk = rd("stem-worker.js"), vend = rd("vendor/neural-separate.mjs");
  const notice = rd("vendor/NOTICE-neural-separate.txt"), html = rd("index.html"), pages = rd(".github/workflows/pages.yml");
  expect(/window\.TTP_STEM_MODEL = separateStems/.test(sm) && /try \{/.test(sm), "stem-model.js publishes window.TTP_STEM_MODEL inside try/catch (never wedges boot)");
  expect(!/^import /m.test(sm) && /await import\(/.test(sm) && /await import\(|import\(\/\*/.test(core), "nothing is imported at boot — the library loads on the first split");
  expect(/new Worker\(WORKER_URL, \{ type: "module" \}\)/.test(sm) && /onMainThread/.test(sm), "separation runs in a module Worker with a main-thread fallback");
  expect(/from "\.\/stem-model-core\.js"/.test(wk) && /separateInBlocks/.test(wk), "the worker runs the shared core");
  expect(/onnxruntime-web@1\.30\.0\/dist\//.test(core) && /onnxruntime-web@1\.30\.0\/dist\/ort\.webgpu\.min\.mjs/.test(vend), "ONNX Runtime Web is pinned (1.30.0) in both the core and the bundle");
  expect(/scnet: \{ file: "scnet\.int8\.onnx", repo: "audiojs\/scnet", sha256: "98228931494151762a1c4ab1ec7899a894b1f81fd4a509921a9d2f9bacc50845"/.test(vend) && /scnet: "e71bcdb42bce1d62b7fae25ba90fcbcf90f73f46"/.test(vend),
    "the SCNet weights are pinned to a revision AND a SHA-256 the library checks before use");
  expect(/STEM_MODEL = "scnet"/.test(core) && !/htdemucs/.test(core), "the shipped preset is SCNet (MIT weights) — never the research-only htdemucs");
  expect(/blockSec/.test(core) && /padSec/.test(core), "songs are separated in padded, cross-faded blocks (bounded memory on phones)");
  expect(/MIT/.test(notice) && /SCNet/.test(notice) && /onnxruntime-web/.test(notice), "vendor NOTICE carries the MIT licences of the bundle, the weights and ORT");
  expect(/<script type="module" src="\.\/stem-model\.js"><\/script>/.test(html), "index.html loads stem-model.js");
  expect(/cp stem-model\.js stem-model-core\.js stem-worker\.js _site\//.test(pages) && /cp vendor\/neural-separate\.mjs vendor\/NOTICE-neural-separate\.txt _site\/vendor\//.test(pages), "Pages ships the separator files");
  const sp = uiSrc.slice(uiSrc.indexOf("function StemsPanel("), uiSrc.indexOf("function ChordReview("));
  expect(/<StemsPanel\b/.test(uiSrc) && /chartsFromStemsOffThread/.test(sp) && /catch \(_\) \{ return chartsFromStems\(stems, sr, opts\); \}/.test(uiSrc), "the Stems panel charts off-thread with a main-thread fallback");
  expect(/<input type="file" multiple onChange=\{importStems\}/.test(sp) && !/<input type="file" multiple[^>]*accept=/.test(sp), "stem import takes several files and has NO accept filter (iOS UTI lesson)");
  expect(/stemRoleFromName\(f\.name\)/.test(sp) && /encodeWav16\(/.test(sp) && /drumHitsToMidi\(/.test(sp), "roles come from file names; every stem downloads as WAV; drums as MIDI");
  expect(/fullRate: full\.drums/.test(sp), "drums are transcribed from the FULL-rate stem (hats live above the analysis Nyquist)");
  const lc = uiSrc.slice(uiSrc.indexOf("function LiveCapture("), uiSrc.indexOf("function StemsPanel("));
  expect(/<LiveCapture\b/.test(uiSrc) && /md\.getDisplayMedia/.test(lc) && /md\.getUserMedia/.test(lc), "live capture offers tab audio (getDisplayMedia) and the microphone");
  expect(/const canTab = !!\(md && md\.getDisplayMedia\)/.test(lc) && /if \(!canTab && !canMic\) return null;/.test(lc), "capture is feature-detected (hidden where the browser can't do it)");
  expect(/echoCancellation: false, noiseSuppression: false, autoGainControl: false/.test(lc), "capture asks for RAW audio (no voice-call processing on music)");
  expect(/onCaptured\(buf,/.test(lc) && /const onCaptured = async \(audioBuf, label\)/.test(uiSrc) && /await loadBuffer\(audioBuf\)/.test(uiSrc), "a capture enters the same pipeline as an uploaded file");
  expect(/DRM-protected/.test(lc) && /MAX_SEC/.test(lc), "a silent (DRM) take is explained, and capture stops itself at a limit");
  expect(!/youtube\.com\/watch|ytdl|yt-dlp|googlevideo/i.test(uiSrc + sm + core), "no stream-ripping code: links are not downloaded, playback is captured");
}

/* The separator core run against the REAL vendored library (2026-10-22 regression).
 * The first device run failed with "undefined is not a function (near '...separate...')":
 * the core destructured a `default` export the bundle doesn't have. The browser e2e had
 * stubbed TTP_STEM_MODEL, so the core↔library seam had never executed. This drives
 * separateInBlocks → the real neural-separate pipeline (option names, input normalisation,
 * SCNet's complex-STFT segmenting, ISTFT, our 60 s block cross-fade) with ONLY the ONNX
 * session faked — through the library's own `session` hook — and the network never touched.
 * The fake model is a fixed spectral mask (drums .1 · bass .2 · other .3 · vocals .4), so the
 * exact answer is known: each stem = its weight × the input, and the stems sum to the input. */
{
  // The bundle reads `process.release.name` ONCE, when first loaded, to pick its Node or browser
  // path — so the spoof must be in place before anything imports it (and is restored below).
  const relDesc = Object.getOwnPropertyDescriptor(process, "release");
  Object.defineProperty(process, "release", { value: { name: "browser-test" }, configurable: true });   // browser path (hosted weights) — the session hook means nothing is fetched
  const core = await import(path.join(repo, "stem-model-core.js") + "?t=" + Date.now());
  expect(core.resolveSeparate({ separate: () => 1 })() === 1 && core.resolveSeparate({ default: () => 2 })() === 2, "resolveSeparate takes the named export (and a default one if a rebuild switches)");
  let threw = ""; try { core.resolveSeparate({ REVISIONS: {} }); } catch (e) { threw = e.message; }
  expect(/no separate\(\) function/.test(threw), "a bundle without separate() fails with a readable message, not 'undefined is not a function'");
  const vend = await import(path.join(repo, "vendor/neural-separate.mjs"));
  expect(typeof vend.separate === "function" && core.resolveSeparate(vend) === vend.separate, "the vendored bundle's separate() is what the core resolves");

  const scope = { caches: { open: () => Promise.reject(new Error("SecurityError: private mode")) } };
  await core.ensureCacheUsable(scope);
  expect(scope.caches === undefined, "an unusable Cache API (private browsing) is hidden so the library downloads instead of failing");

  const W = { drums: 0.1, bass: 0.2, other: 0.3, vocals: 0.4 }, SRC = ["drums", "bass", "other", "vocals"];
  // I/O contract from the model card (hf://models/audiojs/scnet README, "Graph"): input `mix_spec`
  // [1, 4, 2049, 476] = L re, L im, R re, R im; output `stems_spec` [1, 16, 2049, 476] = each source
  // (drums, bass, other, vocals) × channel × re/im. The fake honours exactly that layout.
  let runs = 0, specs = [], badFeed = "";
  const session = async (spec) => (specs.push(spec), {
    inputs: [{ name: "mix_spec", dims: [1, 4, 2049, 476] }], outputs: [{ name: "stems_spec", dims: [1, 16, 2049, 476] }],
    async run(feeds) {
      runs++;
      const f = feeds.mix_spec;
      if (!f || f.type !== "float32" || JSON.stringify(f.dims) !== "[1,4,2049,476]" || f.data.length !== 4 * 2049 * 476) badFeed = JSON.stringify(f && { type: f.type, dims: f.dims, len: f.data && f.data.length });
      const x = f.data, len = x.length, out = new Float32Array(SRC.length * len);
      for (let s = 0; s < SRC.length; s++) for (let i = 0; i < len; i++) out[s * len + i] = x[i] * W[SRC[s]];
      return { stems_spec: { data: out, dims: [1, 16, 2049, 476], type: "float32" } };
    },
    free() {},
  });
  const sr = 44100, n = Math.round(sr * 21);
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / sr; L[i] = 0.3 * Math.sin(2 * Math.PI * 220 * t) + 0.1 * Math.sin(2 * Math.PI * 1234 * t); R[i] = 0.25 * Math.sin(2 * Math.PI * 330 * t + 1); }
  const prog = [];
  let res = null, err = "";
  try { res = await core.separateInBlocks(L, R, sr, { session, blockSec: 10, onProgress: (d, t) => prog.push([d, t, runs]) }); }
  catch (e) { err = String(e && e.stack || e); }
  finally { if (relDesc) Object.defineProperty(process, "release", relDesc); }
  expect(res && !err, "separateInBlocks runs the real vendored library end to end" + (err ? " — " + err.split("\n")[0] : ""));
  if (res) {
    expect(SRC.every((k) => res.stems[k] && res.stems[k].length === 2 && res.stems[k][0].length === n && res.stems[k][1].length === n), "4 stereo stems, sample-aligned with the input (the shared beat grid depends on it)");
    expect(specs.length >= 3 && specs.every((s) => /huggingface\.co\/audiojs\/scnet\/resolve\/e71bcdb42bce1d62b7fae25ba90fcbcf90f73f46\/scnet\.int8\.onnx$/.test(s)), "the library asks for the pinned SCNet weights, once per 60 s block (3 blocks here)");
    expect(!badFeed, "the library feeds SCNet's real input contract: float32 mix_spec [1,4,2049,476]" + (badFeed ? " — got " + badFeed : ""));
    expect(runs >= 3 && prog.length && prog[prog.length - 1][0] === prog[prog.length - 1][1], "progress reports per model run and ends at done === total");
    // The library fires progress BEFORE each chunk runs; the core must report chunks COMPLETED.
    // The first real run reported 8% before any audio was processed, and the ETA extrapolated from it.
    expect(prog[0][0] === 0 && prog[0][2] === 0, `the first progress event says nothing is done yet (got ${prog[0][0]} after ${prog[0][2]} model runs)`);
    expect(prog.every((e, i) => i === 0 || e[0] >= prog[i - 1][0]), "progress never goes backwards");
    expect(prog.every((e) => e[0] <= (e[2] / runs) * e[1] + 0.5), "progress never runs ahead of the model runs actually finished");
    let worst = 0, worstSum = 0;
    for (const k of SRC) for (let c = 0; c < 2; c++) {
      const inp = c ? R : L, st = res.stems[k][c]; let e = 0, p = 0;
      for (let i = sr; i < n - sr; i++) { const d = st[i] - W[k] * inp[i]; e += d * d; p += (W[k] * inp[i]) ** 2; }
      worst = Math.max(worst, Math.sqrt(e / p));
    }
    for (let c = 0; c < 2; c++) { const inp = c ? R : L; let e = 0, p = 0; for (let i = 0; i < n; i++) { let s = 0; for (const k of SRC) s += res.stems[k][c][i]; e += (s - inp[i]) ** 2; p += inp[i] ** 2; } worstSum = Math.max(worstSum, Math.sqrt(e / p)); }
    expect(worst < 1e-4, `each stem = mask × input through STFT/ISTFT and our block seams (worst rel. error ${worst.toExponential(1)})`);
    expect(worstSum < 1e-4, `the stems sum back to the mix — the 1.5 s cross-fades are seamless (rel. error ${worstSum.toExponential(1)})`);
  }

  // ── Phones: the compact model (2.8 s window). The full graph's single run needs ~1.3 GB, so iOS
  // killed the tab ~5% into the first split. Same library, same mask fake, 120-frame contract.
  const FR = core.COMPACT_MODEL.frames;
  expect(FR === 120 && core.COMPACT_SEGMENT === 119 * 1024, `compact model: 120 frames, segment (F-1)·hop = 121856 samples (got ${FR}, ${core.COMPACT_SEGMENT})`);
  const compactFile = path.join(repo, "models", "scnet-compact", "scnet-f120.int8.onnx");
  const compactBytes = fs.existsSync(compactFile) ? new Uint8Array(fs.readFileSync(compactFile)) : null;
  expect(!!compactBytes && await core.sha256Hex(compactBytes) === core.COMPACT_MODEL.sha256, "the committed compact model matches the SHA-256 the core pins");
  expect(fs.existsSync(path.join(repo, "models", "scnet-compact", "NOTICE")) && /MIT/.test(fs.readFileSync(path.join(repo, "models", "scnet-compact", "NOTICE"), "utf8")) && /starrytong/.test(fs.readFileSync(path.join(repo, "models", "scnet-compact", "NOTICE"), "utf8")), "the compact model ships with its MIT notice + attribution");
  let cRuns = 0, cBad = "";
  const cSession = async () => ({
    inputs: [{ name: "mix_spec", dims: [1, 4, 2049, FR] }], outputs: [{ name: "stems_spec" }],
    async run(feeds) {
      cRuns++;
      const f = feeds.mix_spec;
      if (!f || JSON.stringify(f.dims) !== `[1,4,2049,${FR}]` || f.data.length !== 4 * 2049 * FR) cBad = JSON.stringify(f && f.dims);
      const x = f.data, len = x.length, o = new Float32Array(SRC.length * len);
      for (let s = 0; s < SRC.length; s++) for (let i = 0; i < len; i++) o[s * len + i] = x[i] * W[SRC[s]];
      return { stems_spec: { data: o, dims: [1, 16, 2049, FR], type: "float32" } };
    },
    free() {},
  });
  let cres = null, cerr = "", cProg = [];
  try { cres = await core.separateInBlocks(L, R, sr, { session: cSession, compact: true, onProgress: (d, t) => cProg.push([d, t]) }); }
  catch (e) { cerr = String(e && e.stack || e); }
  expect(cres && !cerr && cres.compact === true, "compact separation runs through the real library" + (cerr ? " — " + cerr.split("\n")[0] : ""));
  if (cres) {
    expect(!cBad, "compact: the library feeds the 120-frame contract mix_spec [1,4,2049,120] (the SCNet preset's 11 s segment is overridden)" + (cBad ? " — got " + cBad : ""));
    expect(cRuns >= 8, `compact: many short model runs instead of a few long ones (${cRuns})`);
    expect(cProg.length && cProg[cProg.length - 1][1] === 1, `compact: 30 s blocks by default (21 s → 1 block, got ${cProg.length && cProg[cProg.length - 1][1]})`);
    let worstC = 0;
    for (const k of SRC) for (let c = 0; c < 2; c++) { const inp = c ? R : L, st = cres.stems[k][c]; let e = 0, p = 0; for (let i = sr; i < n - sr; i++) { const d = st[i] - W[k] * inp[i]; e += d * d; p += (W[k] * inp[i]) ** 2; } worstC = Math.max(worstC, Math.sqrt(e / p)); }
    expect(worstC < 1e-4, `compact: stems still = mask × input through the shorter STFT windows (worst rel. error ${worstC.toExponential(1)})`);
  }
  // integrity + cache: the bytes must match the pin, from the network or the Cache API
  if (compactBytes) {
    const store = new Map(); let fetches = 0;
    const scope = {
      caches: { open: async () => ({ match: async (k) => store.has(k) ? new Response(store.get(k)) : undefined, put: async (k, r) => { store.set(k, new Uint8Array(await r.arrayBuffer())); }, delete: async (k) => store.delete(k) }) },
      fetch: async () => (fetches++, new Response(compactBytes)),
    };
    const b1 = await core.compactModelBytes(core.COMPACT_MODEL, scope), b2 = await core.compactModelBytes(core.COMPACT_MODEL, scope);
    expect(b1.length === compactBytes.length && b2.length === compactBytes.length && fetches === 1, `compact weights: downloaded once, then served from the cache (${fetches} fetches)`);
    const key = [...store.keys()][0]; store.set(key, compactBytes.slice(0, 1000));
    await core.compactModelBytes(core.COMPACT_MODEL, scope);
    expect(fetches === 2 && store.get(key).length === compactBytes.length, "a corrupt cached copy is evicted and re-downloaded");
    let bad = ""; try { await core.compactModelBytes(core.COMPACT_MODEL, { fetch: async () => new Response(compactBytes.slice(0, 5000)) }); } catch (e) { bad = e.message; }
    expect(/integrity check/.test(bad), "a partial / altered download is refused with a readable message");
  }
  // one ORT session for the whole song, created lean
  {
    let created = null, released = 0;
    const fakeOrt = { env: { wasm: {} }, Tensor: function (type, data, dims) { this.type = type; this.data = data; this.dims = dims; },
      InferenceSession: { create: async (bytes, so) => (created = so, { inputNames: ["mix_spec"], outputNames: ["stems_spec"], run: async (f) => ({ stems_spec: { data: f.mix_spec.data, dims: f.mix_spec.dims, type: "float32" } }), release: async () => { released++; } }) } };
    let imported = "";
    const sess = await core.compactSession("wasm", new Uint8Array(4), async (u) => (imported = u, fakeOrt));
    expect(/onnxruntime-web@1\.30\.0\/dist\/ort\.wasm\.min\.mjs$/.test(imported) && fakeOrt.env.wasm.numThreads === 1 && /onnxruntime-web@1\.30\.0/.test(fakeOrt.env.wasm.wasmPaths), "compact session: pinned ORT 1.30.0 WASM build, single thread");
    expect(created && created.graphOptimizationLevel === "disabled" && created.enableCpuMemArena === false && created.enableMemPattern === false && JSON.stringify(created.executionProviders) === '["wasm"]', "compact session: graph optimisation off (its weight pre-packing alone costs ~200 MB), no arena, no memory pattern");
    sess.free(); sess.free();
    expect(released === 0, "the library's per-block free() does not tear the reused session down");
    sess.release();
    await new Promise((r) => setTimeout(r, 0));
    expect(released === 1, "release() frees it once, at the end");
    const r = await sess.run({ mix_spec: { data: new Float32Array(6), dims: [1, 4, 2049, FR], type: "float32" } });
    expect(r.stems_spec && r.stems_spec.data.length === 6 && Array.isArray(r.stems_spec.dims), "the session speaks the library's { name: { data, dims } } shape");
  }
  // phones get it by default: iPhone / iPad (incl. iPadOS's Mac user agent with touch)
  {
    const sm = await import(path.join(repo, "stem-model.js") + "?t=" + Date.now());
    const A = sm.isAppleMobile;
    expect(A({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", platform: "iPhone", maxTouchPoints: 5 }), "iPhone → low-memory by default");
    expect(A({ userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", platform: "iPad", maxTouchPoints: 5 }), "iPad → low-memory by default");
    expect(A({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 5 }), "iPadOS desktop-class UA (Mac + touch) → low-memory by default");
    expect(!A({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", platform: "MacIntel", maxTouchPoints: 0 }) && !A({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)", platform: "Linux x86_64", maxTouchPoints: 0 }) && !A(null), "a Mac / Linux desktop keeps the full model");
    const smSrc = fs.readFileSync(path.join(repo, "stem-model.js"), "utf8");
    expect(/compact: opts\.compact != null \? !!opts\.compact : isAppleMobile\(\)/.test(smSrc) && /compact: opts\.compact \}/.test(smSrc), "stem-model.js defaults compact from the device and forwards it to the worker");
    expect(/TTP_STEM_COMPACT_DEFAULT = isAppleMobile\(\)/.test(smSrc), "the page learns the device default (for the UI toggle)");
  }
  const ui = fs.readFileSync(path.join(repo, "TabDecoderPro.tsx"), "utf8");
  expect(/TTP_STEM_MODEL\(L, R, src\.sampleRate, \{ compact,/.test(ui), "the UI passes Low-memory mode to the separator");
  expect(/localStorage\.setItem\("ttp:stems:inflight"/.test(ui) && (ui.match(/localStorage\.removeItem\("ttp:stems:inflight"\)/g) || []).length >= 3, "a split marks itself in flight and clears the mark on success and failure");
  expect(/ran out of memory and reloaded the page\. Low-memory mode is now on/.test(ui) && /if \(!last\.compact\) \{\s*setCompact\(true\)/.test(ui), "after iOS kills the tab mid-split, the next load says so and turns Low-memory mode on");
  expect(/📱 Low-memory \{compact \? "on" : "off"\}/.test(ui) && /"ttp:stems:compact"/.test(ui), "the Low-memory toggle is visible and remembered per device");
  const pagesSrc = fs.readFileSync(path.join(repo, ".github", "workflows", "pages.yml"), "utf8");
  expect(/cp models\/scnet-compact\/scnet-f120\.int8\.onnx models\/scnet-compact\/NOTICE _site\/models\/scnet-compact\//.test(pagesSrc), "Pages ships the compact model + its notice");
  expect(/const hint = \/memory\|allocat\|RangeError/.test(ui), "the separation error only blames memory when the error is about memory");
  expect(/progressEta\(prog, Date\.now\(\)\)/.test(ui) && /tAt: Date\.now\(\)/.test(ui), "the stems countdown uses progressEta with each event's timestamp");
  expect(/setInterval\(\(\) => setTick/.test(ui), "the countdown re-renders between progress events");
  expect(/Charting every instrument…"\); setErr\(""\); setRes\(null\); setProg\(null\)/.test(ui), "the separator's countdown is cleared when charting starts");
}
{
  // progressEta: rate measured up to the last event, then counted down by the clock
  const E = eng.progressEta;
  expect(E(null, 0) === null && E({ done: 0, total: 4, t0: 0, tAt: 5000 }, 5000) === null, "no estimate until a unit has finished");
  expect(E({ done: 1, total: 4, t0: 0, tAt: 10000 }, 10000) === 30, "1 of 4 done in 10 s → 30 s left");
  expect(E({ done: 1, total: 4, t0: 0, tAt: 10000 }, 15000) === 25, "and it counts down between events (25 s left 5 s later)");
  expect(E({ done: 1, total: 4, t0: 0, tAt: 10000 }, 99000) === 0, "never negative when a chunk runs long");
  expect(E({ done: 5, total: 4, t0: 0, tAt: 10000 }, 10000) === 0 && E({ done: 4, total: 4, t0: 0, tAt: 1000 }, 1000) === 0, "done ≥ total → 0");
  expect(E({ done: 1, total: 2, t0: 1000, tAt: 1000 }, 1000) === null, "no elapsed time → no rate → null");
}

if (fails.length) {
  console.error("\nFAIL:\n  " + fails.join("\n  "));
  console.error("\nRe-run with --log-tokens to dump the raw extractTokens() stream and diff against the reference.");
  process.exit(1);
}
console.log("\nPASS — Path A pipeline reconstructs Blue Sky (165 bars, verse + V + bridge).");
