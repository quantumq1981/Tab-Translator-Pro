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
// CSMPN fakebook grammar: ONE bar = ONE whitespace token; a multi-chord bar joins
// chords with `_` (Bb7_A7), NOT spaces (which CSMP's parseBarStructures would read as
// separate bars). mx bar1 = {C,G} → "C_G"; bar2 override A7; bar3 F.
expect(/^C_G A7 F$/m.test(csmpn), `CSMPN bars: multi-chord bar must use _ (got:\n${csmpn})`);
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
expect(yard6Bars === "Em7 | Am6/F# Ebaug/B | Em7 | C#aug/A | Dm7 | Gm6/E C#aug/A", `GP6 Yardbird "simple chords" (String+Fret) unexpected: "${yard6Bars}"`);
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

if (fails.length) {
  console.error("\nFAIL:\n  " + fails.join("\n  "));
  console.error("\nRe-run with --log-tokens to dump the raw extractTokens() stream and diff against the reference.");
  process.exit(1);
}
console.log("\nPASS — Path A pipeline reconstructs Blue Sky (165 bars, verse + V + bridge).");
