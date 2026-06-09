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
const SRC = path.join(repo, "TabDecoderPro.tsx");
const PDF = path.join(repo, "Blue Sky - The Allman Brothers Band.pdf");

const LOG_TOKENS = process.argv.includes("--log-tokens");

/* ---- load the real pure functions from source (no copy = no drift) ------- */
const src = fs.readFileSync(SRC, "utf8");
const start = src.indexOf("/* ---- bit helpers");
const end = src.indexOf("async function extractTokens"); // browser-only; reproduced below
if (start < 0 || end < 0) throw new Error("source markers not found in TabDecoderPro.tsx");
const engineSrc =
  src.slice(start, end) +
  "\nexport { buildChart, buildScore, symbolForFrets, parseMusicXML, scoreToABC, scoreToChordPro, transposeScore };\n";

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

/* ---- transpose: re-recognise from shifted MIDI --------------------------- */
const up2 = eng.transposeScore(mx, 2, true); // C G | Am | F  ->  D A | Bm | G
expect(up2.bars[0].events.map((e) => e.symbol).join(" ") === "D A", `+2 st bar1 expected "D A", got "${up2.bars[0].events.map((e) => e.symbol).join(" ")}"`);
expect(up2.bars[1].events[0].symbol === "Bm", `+2 st bar2 expected "Bm", got "${up2.bars[1].events[0].symbol}"`);
expect(up2.bars[2].events[0].symbol === "G", `+2 st bar3 expected "G", got "${up2.bars[2].events[0].symbol}"`);
expect(eng.transposeScore(mx, 0, true) === mx, "transpose by 0 should be a passthrough");

/* ---- report -------------------------------------------------------------- */
console.log(`PDF.js ${pdfjsLib.version} · ${pages} pages · ${tokens.length} tokens`);
console.log(`systemsFound=${chart.systemsFound} columnsFound=${chart.columnsFound} bars=${bars.length}`);
console.log(`verse 1-8: ${verse}`);
console.log(`progression: ${bars.map((b) => b.bar).join(" | ")}`);
const sampleMulti = (typeof score !== "undefined" && score.bars.find((b) => b.events.length >= 2)) || null;
if (sampleMulti) console.log(`sample multi-chord bar ${sampleMulti.number}: ` +
  sampleMulti.events.map((e) => `${e.symbol}@b${e.beat + 1}(${e.durBeats})`).join(" "));
console.log(`MusicXML: ${mx.bars.length} bars, ${mx.tuning} tuning, bar3 ${mx.bars[2].timeSig.join("/")} · ${mxSyms.join(" | ")}`);
console.log(`ABC: ${abc.trim().split("\n").pop()}`);

if (fails.length) {
  console.error("\nFAIL:\n  " + fails.join("\n  "));
  console.error("\nRe-run with --log-tokens to dump the raw extractTokens() stream and diff against the reference.");
  process.exit(1);
}
console.log("\nPASS — Path A pipeline reconstructs Blue Sky (165 bars, verse + V + bridge).");
