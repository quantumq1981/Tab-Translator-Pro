/* Guards for chord-symbol OCR, the pure half (engine block "CHORD OCR"): page layout (staves, a
 * beam that looks like a staff line, staff lines that fall between pixel rows, bar lines vs stems,
 * the chord row, words by x gaps, bar + position of each box), the recogniser input, CTC beam
 * search, the written-spelling normaliser, the grammar-checked read, and page → chord score.
 * Accuracy on rendered lead sheets is measured by the bench (docs/OMR-PLAN.md), not here. */
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { fileURLToPath } from "node:url";
import { loadEngine } from "./bench/lib.mjs";
const E = await loadEngine();
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."), read = (f) => fs.readFileSync(path.join(repo, f), "utf8");
let pass = 0, fail = 0;
const expect = (ok, msg) => { if (ok) pass++; else { fail++; console.log("  ✗ " + msg); } };

// ---- a page painter -----------------------------------------------------------------------------
function page(w, h) { return { data: new Uint8Array(w * h).fill(255), width: w, height: h }; }
function rect(p, x0, y0, x1, y1, v = 0) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) p.data[y * p.width + x] = v; }
function staff(p, top, x0, x1, gap = 10, grey = false) {
  for (let k = 0; k < 5; k++) {
    const y = top + Math.round(k * gap);
    if (grey) { rect(p, x0, y, x1, y, 150); rect(p, x0, y + 1, x1, y + 1, 150); }   // a line between two pixel rows
    else rect(p, x0, y, x1, y);
  }
}
const word = (p, x, y, letters) => { let cx = x; for (const wd of letters) { rect(p, cx, y, cx + wd - 1, y + 13); cx += wd + 2; } return cx; };

// two systems, four bars each; a beam inside staff 1, a stem crossing staff 1, grey lines on staff 2
const P = page(1000, 520);
staff(P, 150, 40, 960);
staff(P, 360, 40, 960, 10.5, true);
for (const top of [150, 360]) for (const x of [40, 270, 500, 730, 960]) rect(P, x, top, x + 1, top + (top === 150 ? 40 : 43));
rect(P, 290, 154, 480, 156);                       // a long beam inside staff 1 (within one bar, as engraved)
rect(P, 600, 105, 601, 175);                       // a stem: ink above the staff, not a bar line
word(P, 60, 120, [9, 8, 6]);                       // bar 1: one chord "Cm7"
word(P, 290, 120, [9, 6]);                         // bar 2: two chords
word(P, 420, 120, [9, 6, 6]);
word(P, 50, 330, [9]);                             // bar 5 (system 2, bar 1)
word(P, 520, 330, [9, 7, 7, 7]);                   // bar 7

const L = E.chordPageLayout(P);
expect(L.staves.length === 2, `two staves found despite a beam inside staff 1 and grey between-row lines in staff 2 (${L.staves.length})`);
expect(L.staves[0] && Math.abs(L.staves[0].s - 10) < 0.6 && L.staves[1] && Math.abs(L.staves[1].s - 10.5) < 0.6, "staff spacing measured (10, 10.5 px)");
expect(L.bars === 8, `four bars per system → 8 bars (${L.bars})`);
expect(L.staves[0] && !L.staves[0].barlines.some((x) => Math.abs(x - 600) < 3), "a stem that leaves the staff is not a bar line");
const tk = L.tokens.map((t) => `${t.bar}:${t.x0}`).join(" ");
expect(L.tokens.length === 5, `one box per chord, letters of a chord grouped into one box: ${tk}`);
expect(tk === "0:60 1:290 1:420 4:50 6:520", `each box in its bar: ${tk}`);
const b2 = L.tokens.filter((t) => t.bar === 1);
expect(b2.length === 2 && b2[0].frac < 0.15 && b2[1].frac > 0.5, "frac: the second chord of bar 2 sits in its second half");
expect(E.chordPageLayout(page(300, 200)).tokens.length === 0, "a blank page gives no boxes, no throw");

// a phone-like page: the same layout tilted 1.7° with a shadow across it
{
  const T = page(1000, 560), b = 0.03, shade = (x, y) => Math.round(255 - 70 * (x / 1000));
  for (let y = 0; y < 560; y++) for (let x = 0; x < 1000; x++) T.data[y * 1000 + x] = shade(x, y);
  const ink = (x, y) => { y = Math.round(y); if (y >= 0 && y < 560 && x >= 0 && x < 1000) T.data[y * 1000 + x] = 30; };
  for (const top of [170, 380]) {
    for (let k = 0; k < 5; k++) for (let x = 40; x <= 960; x++) ink(x, top + k * 10 + b * x);
    for (const bx of [40, 270, 500, 730, 960]) for (let y = 0; y <= 40; y++) { ink(bx, top + y + b * bx); ink(bx + 1, top + y + b * bx); }
  }
  const tword = (x, y, letters) => { let cx = x; for (const wd of letters) { for (let yy = 0; yy < 14; yy++) for (let xx = 0; xx < wd; xx++) ink(cx + xx, y + yy + b * (cx + xx)); cx += wd + 2; } };
  tword(60, 140, [9, 8, 6]); tword(290, 140, [9, 6]); tword(560, 140, [9]); tword(50, 350, [9]);
  const L2 = E.chordPageLayout(T);
  expect(L2.staves.length === 2 && Math.abs(L2.staves[0].b[0] - b) < 0.004, `tilted + shaded page: 2 staves, slope found (${L2.staves.length}, ${L2.staves[0] && L2.staves[0].b[0].toFixed(4)})`);
  const tk2 = L2.tokens.map((t) => t.bar).join(" ");
  expect(L2.bars === 8 && tk2 === "0 1 2 4", `tilted page: 8 bars, every chord in its bar (${L2.bars}: ${tk2})`);
  expect(typeof L2.staves[0].line === "undefined" && JSON.stringify(L2).length > 0, "the layout is plain data (it crosses a worker boundary)");
}

// ---- recogniser input --------------------------------------------------------------------------
{
  const img = page(200, 100); rect(img, 50, 40, 89, 59);
  const inp = E.chordOcrInput(img, { x0: 50, y0: 40, x1: 89, y1: 59 });
  expect(inp.height === 32 && inp.data.length === 32 * inp.width, "input is 32 px tall, one float per pixel");
  const mid = inp.data[16 * inp.width + (inp.width >> 1)], corner = inp.data[0];
  expect(mid > 0.95 && corner < 0.05, `ink = 1, paper = 0 (${mid.toFixed(2)}, ${corner.toFixed(2)})`);
  const wide = E.chordOcrInput(img, { x0: 0, y0: 48, x1: 199, y1: 50 });
  expect(wide.width === 256, "very wide boxes are capped at 256 columns");
}

// ---- CTC beam search -----------------------------------------------------------------------------
const CS = E.CHORD_OCR.charset, K = CS.length + 1, cls = (c) => CS.indexOf(c) + 1;
function logits(seq) {        // seq: one class per frame ("_" = blank), confident
  const T = seq.length, a = new Float32Array(T * K).fill(-8);
  seq.forEach((c, t) => { a[t * K + (c === "_" ? 0 : cls(c))] = 4; });
  return { a, T };
}
{
  const { a, T } = logits(["C", "C", "_", "m", "7", "7", "_"]);
  expect(E.ctcBeam(a, T, K)[0].text === "Cm7", "repeats collapse, blanks drop: Cm7");
  const { a: a2, T: T2 } = logits(["B", "b", "_", "b", "7"]);
  expect(E.ctcBeam(a2, T2, K)[0].text === "Bbb7", "a blank between two equal letters keeps both");
  // two readings nearly tied: the reader keeps the one the grammar accepts
  const T3 = 4, a3 = new Float32Array(T3 * K).fill(-8);
  a3[0 * K + cls("C")] = 4; a3[1 * K + cls("m")] = 4; a3[2 * K + cls("7")] = 2; a3[2 * K + cls("j")] = 2.3; a3[3 * K] = 4;
  const r = E.chordOcrRead(a3, T3, K);
  expect(E.ctcBeam(a3, T3, K)[0].text === "Cmj" && r && r.name === "Cm7", `the most probable string "Cmj" is not a chord → Cm7 is read (${r && r.name})`);
  const { a: a4, T: T4 } = logits(["1", "5", "_"]);
  expect(E.chordOcrRead(a4, T4, K) === null, "a bar number is not a chord → null");
  const { a: a5, T: T5 } = logits(["7", "_"]);
  expect(E.chordOcrRead(a5, T5, K) === null && E.chordOcrNumber(a5, T5, K) === 7, "a confident \"7\" is bar number 7, never the unlikely chord \"D7\" further down the beam");
}

// ---- written spellings → the family's names ------------------------------------------------------
const W = [["CΔ7", "Cmaj7"], ["CMA7", "Cmaj7"], ["CM7", "Cmaj7"], ["CMaj7", "Cmaj7"], ["CΔ", "Cmaj7"], ["Dmi7", "Dm7"], ["D-7", "Dm7"], ["Dmin", "Dm"],
  ["D-", "Dm"], ["Bø7", "Bm7b5"], ["Bø", "Bm7b5"], ["Bmi7(b5)", "Bm7b5"], ["C°7", "Cdim7"], ["Co7", "Cdim7"], ["C°", "Cdim"], ["C+", "Caug"],
  ["C+7", "C7#5"], ["C7(b9)", "C7b9"], ["C7(b9,b13)", "C7b9b13"], ["Gsus", "Gsus4"], ["G7sus", "G7sus4"], ["G7sus4(b7)", "G7sus4"], ["C69", "C6/9"],
  ["C6(9)", "C6/9"], ["Cadd2", "Cadd9"], ["C(add9)", "Cadd9"], ["Calt", "C7alt"], ["C-Δ7", "Cm(maj7)"], ["C♯m7", "C#m7"], ["B♭7/A♭", "Bb7/Ab"],
  ["F/F", "F"], ["Ebmaj7(#11)", "Ebmaj7#11"], ["A13b9", "A13b9"]];
const wrong = W.filter(([w, want]) => { const r = E.chordFromWritten(w); return !r || r.name !== want; });
expect(!wrong.length, "written spellings normalise: " + wrong.map(([w, x]) => `${w}→${(E.chordFromWritten(w) || {}).name}≠${x}`).join(" "));
const notChords = ["", "7", "15", "=165", "Melody", "Verse", "Hm7", "Cx", "C/"];
expect(notChords.every((t) => E.chordFromWritten(t) === null), "bar numbers, tempo marks and words are not chords: " + notChords.filter((t) => E.chordFromWritten(t)).join(" "));
{
  const sig = (p) => p.rootPc + "|" + p.bassPc + "|" + p.formula.tones.map((t) => t.semi).sort((a, b) => a - b).join(",");
  const a = E.chordFromWritten("Dmi7(b5)/C"), b = E.chordFromWritten("Dø/C");
  expect(a && b && sig(a.parsed) === sig(b.parsed), "two spellings of one chord parse to the same root, bass and tones");
}

// ---- page → chord score --------------------------------------------------------------------------
{
  const rd = (name) => ({ name, prob: 0.9 });
  const pages = [{ layout: L, reads: [rd("Cm7"), rd("F7"), rd("Bbmaj7"), rd("Eb"), null] }];
  const sc = E.chordPageScore(pages);
  const bars = sc.bars.map((b) => b.events.map((e) => e.symbol + "@" + e.beat + (e.held ? "h" : "")).join(" ")).join(" | ");
  expect(sc.bars.length === 8 && sc.source === "ocr", `8 bars, source "ocr" (${sc.bars.length})`);
  expect(bars === "Cm7@0 | F7@0 Bbmaj7@2 | Bbmaj7@0h | Bbmaj7@0h | Eb@0 | Eb@0h | Eb@0h | Eb@0h", "chords on their beats; empty bars hold the last chord; a box read as nothing is dropped: " + bars);
  const ev = sc.bars[1].events[1];
  expect(ev.midis.includes(58) && ev.midis.includes(62) && ev.midis.includes(65) && ev.midis.includes(69), "the chord carries its voicing (Bb D F A)");
  const cs = E.scoreToCSMPN(sc, { title: "Scan" });
  expect(/Cm7 \| F7_Bbmaj7 \| Bbmaj7 \| %/.test(cs), "exports to CSMPN, a held bar repeating a whole bar as %: " + cs.split("\n").filter((l) => l.includes("|"))[0]);
}

// ---- the orchestrator with a fake recogniser ------------------------------------------------------
{
  const seen = [];
  const run = async (data, width) => { seen.push(width); const { a, T } = logits(seen.length === 3 ? ["1", "5"] : ["F", "_", "7"]); return { logits: a, frames: T, classes: K }; };
  let prog = 0;
  const r = await E.readChordPage(P, run, { onProgress: (d, t) => { prog = d / t; throw new Error("ui bug"); } });
  expect(r.reads.length === r.layout.tokens.length && seen.every((w) => w >= 8 && w <= 256), "readChordPage runs the recogniser once per box with a 32-px-tall input");
  expect(r.reads.filter(Boolean).length === 4 && r.reads[2] === null && r.reads[0].name === "F7", "each box read; a non-chord box reads null");
  expect(prog === 1, "progress reaches 1 and a throwing callback does not break the read");
}

// ---- a hand-copied page (Real Book style): thick bar lines, raised suffixes, a triplet row, 8va dashes,
//      a tuplet bracket, ruled lines under a title, a page number --------------------------------------
const RB = page(1000, 640);
staff(RB, 40, 40, 960);                                          // ruled title lines: 5 lines, no bar line
for (const top of [250, 470]) {
  staff(RB, top, 40, 960);
  for (const x of [40, 270, 500, 730, 954]) rect(RB, x, top, x + 5, top + 40);     // bar lines 6 px = 0.6 space, solid
}
for (let y = 0; y <= 40; y++) { const x = 600 + Math.floor(y / 6); rect(RB, x, 250 + y, x + 1, 250 + y); }   // a slanted 2-px stroke across staff 1, 8 px wide overall
word(RB, 60, 196, [9, 8, 8]); rect(RB, 93, 190, 98, 200);       // bar 1: a chord with its suffix raised (top above the letters, touching nothing)
for (const x of [300, 540, 770]) rect(RB, x, 228, x + 5, 236);  // a triplet "3" over every beam group, bars 2–4
word(RB, 520, 196, [9, 8, 8, 8]);                                // bar 3: a chord (the triplet "3" at 540 sits right under it)
rect(RB, 860, 200, 866, 232);                                    // bar 4: one tall mark overlapping both the chord row and the triplet row
for (let x = 600; x < 720; x += 14) rect(RB, x, 214, x + 7, 215);  // 8vb dashes, flat
rect(RB, 300, 242, 340, 242); rect(RB, 300, 238, 300, 242); rect(RB, 340, 238, 340, 242);   // a tuplet bracket over bar 2
word(RB, 290, 416, [9, 8, 8, 8]); word(RB, 333, 416, [9, 8, 8, 8]);   // bar 6: two chords written touching
rect(RB, 50, 10, 56, 22); rect(RB, 60, 10, 66, 22);              // a page number at the top left
const LR = E.chordPageLayout(RB);
// (layout alone keeps the ruled title lines as staff 0, one bar; readChordPage drops them below)
expect(LR.staves.length === 3 && LR.bars === 9 && LR.staves[0].barlines.length === 0, `hand-drawn bar lines 0.6 space thick are found: 2 × 4 bars + the ruled title lines (${LR.staves.length} staves, ${LR.bars} bars)`);
expect(LR.staves[1] && !LR.staves[1].barlines.some((x) => Math.abs(x - 603) < 5), "a slanted stroke across the staff, as wide as a hand bar line, is not a bar line (bar lines are solid)");
LR.tokens = LR.tokens.filter((t) => t.staff > 0).map((t) => ({ ...t, staff: t.staff - 1, bar: t.bar - 1 }));
const rb1 = LR.tokens.find((t) => t.staff === 0 && t.bar === 0 && t.y0 > 150 && t.x0 <= 62);
expect(rb1 && rb1.x1 >= 97 && rb1.y0 <= 191, `a raised suffix stays in its chord's box (${rb1 && [rb1.x0, rb1.y0, rb1.x1, rb1.y1]})`);
const rows0 = new Set(LR.tokens.filter((t) => t.staff === 0 && t.y0 > 150).map((t) => t.row));
const trip = LR.tokens.filter((t) => t.staff === 0 && t.y0 >= 226);
expect(trip.length === 3 && trip.every((t) => t.row !== rb1.row && t.y1 - t.y0 < 12), `the triplet numbers are their own row (not glued to the chord above them, not fused into the chord row by a tall mark), kept beside it (${trip.length} boxes, ${rows0.size} rows)`);
const c3 = LR.tokens.find((t) => t.staff === 0 && t.x0 === 520);
expect(c3 && c3.y1 < 215 && c3.row === rb1.row, `a chord with a triplet number under it is boxed alone, in the chord row (${c3 && [c3.x0, c3.y0, c3.x1, c3.y1]})`);
expect(!LR.tokens.some((t) => t.y0 >= 205 && t.y1 <= 220), "8va dashes are not text");
expect(!LR.tokens.some((t) => t.y1 >= 238 && t.y0 <= 242 && t.x1 - t.x0 > 30), "a tuplet bracket is not text");
expect(LR.tokens.filter((t) => t.staff === 1).length === 1 && LR.tokens.find((t) => t.staff === 1).cuts.length >= 1, "two chords written touching are one box with a cut between them");
{
  // fake recogniser: by the box's shape — a digit is narrow, a chord wide, two chords touching wider still
  const widths = [];
  const run = async (data, width) => { widths.push(width); const { a, T } = logits(width < 45 ? ["3", "_"] : width > 110 ? ["C", "m", "j"] : ["C", "_", "7"]); return { logits: a, frames: T, classes: K }; };
  const r = await E.readChordPage(RB, run);
  const toks = r.layout.tokens.map((t, i) => `${t.staff}:${t.bar}:${r.reads[i] ? r.reads[i].name : "-"}${t.split ? "s" : ""}`).join(" ");
  expect(!r.layout.tokens.some((t) => t.staff === 0 && t.y0 >= 226), `a row that reads as no chords (the triplet numbers) is dropped: ${toks}`);
  expect(r.reads.filter((x) => x && x.name === "C7").length === 4 && r.layout.tokens.filter((t) => t.split).length === 2, `the touching pair is split in two chords, the row of chords kept: ${toks} (widths ${widths.join(",")})`);
  expect(r.layout.staves.length === 2 && r.layout.bars === 8 && r.layout.tokens.every((t) => t.staff <= 1 && t.bar < 8), `ruled lines under a title (no bar line, no chord) are dropped, not bar 1 (${r.layout.staves.length} staves, ${r.layout.bars} bars)`);
  expect(r.layout.firstNumber == null, "a page number high above the first staff is not its bar number");
  expect(r.reads.length === r.layout.tokens.length, "one read per kept box");
}

// ---- a piano/vocal/guitar page: voice + piano grand staff joined at the left, grand-staff bar lines, lyrics
//      between the voice and the piano, a chord name over a fret grid with open-string circles ------------
{
  const PV = page(1000, 820);
  const sys = (top) => {
    staff(PV, top, 60, 960); staff(PV, top + 150, 60, 960); staff(PV, top + 230, 60, 960);
    if (top < 300) rect(PV, 60, top, 61, top + 270);                            // the system's opening line joins all three
    else { rect(PV, 60, top, 60, top + 135); rect(PV, 61, top + 136, 61, top + 270); }   // (system 2: 1 px, stepping a pixel sideways — a slightly tilted scan)
    for (let y = top + 150; y <= top + 270; y++) { const x = 44 + Math.round(3 * Math.sin((y - top) / 9)); rect(PV, x, y, x + 2, y); }   // a curvy piano brace left of it…
    rect(PV, 46, top + 170, 59, top + 170);                                     // …touching the treble's middle line (the staff's start is then found on the brace)
    for (const x of [300, 540, 780, 959]) { rect(PV, x, top, x + 1, top + 40); rect(PV, x, top + 150, x + 1, top + 270); }   // voice bars; piano bars cross both staves
    for (const x of [120, 330, 560, 800]) word(PV, x, top + 75, [7, 6, 7]);    // a lyric line under the voice staff
  };
  sys(110); sys(500);
  word(PV, 320, 30, [9]);                                                       // chord name "E" over a grid, bar 2 of system 1
  for (let k = 0; k < 6; k++) rect(PV, 318 + 5 * k, 62, 318 + 5 * k, 90); for (let k = 0; k < 5; k++) rect(PV, 318, 62 + 7 * k, 343, 62 + 7 * k);   // the fret grid
  for (const x of [318, 338, 343]) { rect(PV, x - 2, 54, x + 2, 54); rect(PV, x - 2, 58, x + 2, 58); rect(PV, x - 2, 54, x - 2, 58); rect(PV, x + 2, 54, x + 2, 58); }   // open-string circles
  word(PV, 580, 440, [9, 8, 8]);                                                // a chord over system 2, bar 3
  word(PV, 400, 4, [9, 9, 9, 9]);                                                // a title far above (more than 8 spaces over the staff)
  const LP = E.chordPageLayout(PV);
  expect(LP.staves.length === 2 && LP.staves.every((st) => st.staves === 3), `voice + piano joined at the left = one system each (${LP.staves.length} systems: ${LP.staves.map((st) => st.staves).join(",")})`);
  expect(LP.bars === 8, `bars counted once per system, not per staff (${LP.bars})`);
  {
    const all = E._ocrStaves(E._ocrAdaptiveInk(PV.data, PV.width, PV.height, Math.max(8, Math.round(PV.width / 40)), 0.08), PV.width, PV.height);
    const [inkS] = E._ocrAdaptiveInk(PV.data, PV.width, PV.height, Math.max(8, Math.round(PV.width / 40)), [0.18]);
    const treble = all.find((st) => Math.abs(st.top(500) - 260) < 4);
    expect(treble && E._ocrBarlines(inkS, PV.width, PV.height, treble).length >= 3, "a grand-staff bar line running on into the next staff is a bar line");
  }
  expect(!LP.tokens.some((t) => t.y0 > 170 && t.y1 < 260) && !LP.tokens.some((t) => t.y0 > 560 && t.y1 < 650), "the lyric line between the voice and the piano is never searched for chords");
  const pv = LP.tokens.map((t) => `${t.bar}:${t.x0}`).join(" ");
  expect(!LP.tokens.some((t) => t.y1 < 20), "text more than 8 spaces above the first staff (a title, a page header) is not searched");
  expect(pv === "1:320 6:580", `the chord name over the grid is kept, the grid and its open-string circles are not boxes; chords land in their bars (${pv})`);
}

{
  // two single-staff systems and a wide dark mark bridging the gap at their left edge (a stain, a thick printed
  // rule): a system's joining line is thin, so these stay two systems
  const DE = page(1000, 420);
  staff(DE, 100, 60, 960); staff(DE, 300, 60, 960);
  for (const top of [100, 300]) for (const x of [60, 360, 660, 959]) rect(DE, x, top, x + 1, top + 40);
  rect(DE, 58, 141, 72, 299, 40);
  word(DE, 380, 60, [9, 8]); word(DE, 380, 260, [9, 8]);
  const LD = E.chordPageLayout(DE);
  expect(LD.staves.length === 2 && LD.bars === 6 && LD.tokens.length === 2, `a wide dark mark bridging the gap does not join two lead-sheet systems (${LD.staves.length} systems, ${LD.bars} bars, ${LD.tokens.length} chords)`);
}

{
  // chords whose descender ("j" of maj) reaches down beside the triplet numerals: the numerals stay their own
  // row, so the chord row is not voted out by them
  const TD = page(1000, 360);
  staff(TD, 250, 60, 960);
  for (const x of [60, 290, 520, 750, 959]) rect(TD, x, 250, x + 1, 290);
  for (const x0 of [80, 310]) { word(TD, x0, 190, [9, 8, 8, 8]); rect(TD, x0 + 30, 190, x0 + 32, 228); }   // a chord with a long descender
  for (const x of [145, 175, 375, 405, 560, 600, 790, 830]) rect(TD, x, 222, x + 5, 230);                  // triplet numerals, tops beside the descenders
  const run = async (data, width) => { const { a, T } = logits(width < 28 ? ["3", "_"] : ["C", "_", "7"]); return { logits: a, frames: T, classes: K }; };   // a numeral's box is narrow, a chord's (with its descender) square
  const r = await E.readChordPage(TD, run);
  const kept = r.layout.tokens.map((t, i) => `${t.bar}:${r.reads[i] ? r.reads[i].name : "-"}`).join(" ");
  expect(kept === "0:C7 1:C7", `a triplet row tucked under the chords' descenders is dropped, the chord row kept (${kept})`);
}

// ---- the review list ---------------------------------------------------------------------------------
{
  const mkL = (bars, toks, firstNumber = null) => ({ bars, firstNumber, tokens: toks.map(([staff, bar, x]) => ({ staff, bar, x0: x })) });
  const pages = [
    { layout: mkL(4, [[0, 0, 10], [0, 1, 50], [0, 1, 80], [1, 2, 10]]), reads: [{ name: "C", prob: 0.95, alternatives: [] }, { name: "Am7", prob: 0.4, alternatives: ["Am9"] }, null, { name: "F", prob: 0.85, alternatives: [] }] },
    { layout: mkL(4, [[0, 0, 10]], 9), reads: [{ name: "G7", prob: 0.6, alternatives: [] }] },
  ];
  const it = E.ocrReviewItems(pages, { "0.3": "Fmaj7", "0.2": "" });
  const show = it.map((x) => `${x.bar}${x.name}:${x.status}`).join(" ");
  expect(show === "1C:sure 2Am7:check 3Fmaj7:approved 9G7:check", "every chord listed in reading order with its bar over the piece (a printed number on page 2 wins): " + show);
  const it2 = E.ocrReviewItems(pages, { "0.0": "", "0.2": "" }, { removed: true });
  expect(it2.find((x) => x.key === "0.0").status === "removed" && !it2.some((x) => x.key === "0.2"), "a box marked not-a-chord is left out (or listed as removed); an empty box marked so stays out");
  expect(E.ocrReviewItems(pages, { "0.1": "Hm7" }).find((x) => x.key === "0.1") === undefined && E.ocrReviewItems(null).length === 0, "a fix the chord grammar can't read is not listed; no pages → empty");
  expect(E.ocrReviewItems(pages, {}, { sure: 0.5 }).find((x) => x.key === "1.0").status === "sure", "the sure threshold is an option");
}

// ---- bar numbers re-anchor the systems ----------------------------------------------------------------
{
  // three systems of 4 bars, but system 1 found an extra bar line (5 bars): printed numbers 5 and 9
  const mk = () => ({ staves: [{ edges: [0, 1, 2, 3, 4], barFrom: 0 }, { edges: [0, 1, 2, 3, 4, 5], barFrom: 4 }, { edges: [0, 1, 2, 3, 4], barFrom: 9 }],
    tokens: [{ staff: 1, bar: 4 }, { staff: 2, bar: 9 }, { staff: 2, bar: 12 }], bars: 13 });
  const L1 = E._ocrAnchorBars(mk(), [null, 5, 9]);
  expect(L1.tokens.map((t) => t.bar).join(" ") === "4 8 11" && L1.bars === 12 && L1.firstNumber === 1, "a printed bar number re-anchors its system: an extra bar line in system 2 no longer shifts system 3 (" + L1.tokens.map((t) => t.bar).join(" ") + ")");
  const L2 = E._ocrAnchorBars(mk(), [null, 5, 40]);
  expect(L2.tokens.map((t) => t.bar).join(" ") === "4 9 12", "a misread number far from the count is ignored");
  const L3 = E._ocrAnchorBars(mk(), [17, null, null]);
  expect(L3.firstNumber === 17 && L3.tokens[0].bar === 4, "a number on the first system gives the page's first bar");
  const L4 = E._ocrAnchorBars(mk(), [null, null, null]);
  expect(L4.firstNumber === null && L4.tokens.map((t) => t.bar).join(" ") === "4 9 12", "no numbers: counting stands");
}

// ---- guitar books (2026-11-15): a 6-line TAB staff under the notation = one system (the gap's P.M. / full /
//      1/2 text is never searched), hairline bar lines only the lenient mask keeps, a TAB staff's tall
//      parentheses are not bar lines, rhythm slashes push the chords up, a bar number over the opening line,
//      a final double bar ---------------------------------------------------------------------------------
{
  const G = page(1000, 660), faint = 222;
  const lines = (top, n, gap, x0 = 40, x1 = 960) => { for (let k = 0; k < n; k++) rect(G, x0, top + k * gap, x1, top + k * gap, faint); };
  const sysA = 120, sysB = 400;
  for (const top of [sysA, sysB]) { lines(top, 5, 10); lines(top + 100, 6, 16); }
  // system A: hairline bar lines running from the notation top through the gap to the TAB bottom (one stroke)
  for (const x of [40, 360, 680, 960]) rect(G, x, sysA, x, sysA + 180, faint);
  // system B: bar lines per staff, nothing joining the two staves at the left
  for (const x of [40, 360, 680, 960]) { rect(G, x, sysB, x, sysB + 40, faint); rect(G, x, sysB + 100, x, sysB + 180, faint); }
  for (const top of [sysA, sysB]) rect(G, 500, top + 104, 501, top + 176);       // a tall "(" around a held TAB chord
  for (const top of [sysA, sysB]) { word(G, 80, top - 32, [9]); word(G, 400, top - 32, [9, 6]); word(G, 720, top - 32, [9]); }   // chords: bars 1, 2, 3
  for (const top of [sysA, sysB]) word(G, 420, top + 72, [7, 5, 5, 5]);           // "full" in the gap, just above the TAB
  const [, soft] = E._ocrAdaptiveInk(G.data, G.width, G.height, Math.max(8, Math.round(G.width / 40)), [0.18, 0.08]);
  const tabs = E._ocrStaves(soft, G.width, G.height).filter((st) => st.n === 6);
  expect(tabs.length === 2 && tabs.every((st) => Math.abs(st.s - 16) < 0.8), `a TAB staff is found with its six lines (${tabs.map((st) => st.n + "@" + st.s.toFixed(1)).join(" ")})`);
  const LG = E.chordPageLayout(G);
  expect(LG.staves.length === 2 && LG.staves.every((st) => st.staves === 2), `notation + TAB = one system, with or without a joining line (${LG.staves.map((st) => st.staves).join(",")})`);
  expect(LG.bars === 6, `hairline bar lines found, a TAB parenthesis is not a bar line: 3 + 3 bars (${LG.bars})`);
  const gb = LG.tokens.map((t) => `${t.bar}`).join(" ");
  expect(gb === "0 1 2 3 4 5", `the chords above each system in their bars, nothing from the TAB gap (${gb})`);
}
{
  const mk = (band) => {
    const R = page(1000, 420);
    staff(R, 250, 40, 960); for (const x of [40, 500, 960]) rect(R, x, 250, x + 1, 290);
    if (band) for (let gx = 60; gx < 900; gx += 100) {                           // beamed rhythm slashes, 3–8 spaces over the staff
      rect(R, gx, 170, gx + 60, 173);
      for (const sx of [gx, gx + 30, gx + 60]) { rect(R, sx, 170, sx + 1, 215); rect(R, sx - 6, 214, sx + 1, 218); }
    }
    word(R, 80, 140, [9]); word(R, 560, 140, [9, 6]);                             // chord names ~10 spaces up, above the slashes
    return E.chordPageLayout(R);
  };
  const withBand = mk(true), without = mk(false);
  expect(withBand.tokens.map((t) => t.bar).join(" ") === "0 1" && withBand.staves[0].lead > 0, `rhythm slashes over the staff: the chord names above them are read (${withBand.tokens.map((t) => t.bar).join(" ")})`);
  expect(without.tokens.length === 0, "without the slashes, text 10 spaces above a staff stays out of the search (a title, a header)");
}
{
  // a bar number over the opening bar line is read as a number only — never as a chord, however the reader reads it
  const N = page(1000, 300); staff(N, 150, 40, 960); for (const x of [40, 270, 500, 730, 960]) rect(N, x, 150, x + 1, 190);
  word(N, 36, 126, [9]); word(N, 90, 120, [9, 8, 6]);
  const run = async (data, width) => { const { a, T } = logits(width < 30 ? ["1", "2"] : ["G", "_"]); return { logits: a, frames: T, classes: K }; };
  const r = await E.readChordPage(N, run);
  const nb = r.layout.tokens.findIndex((t) => t.number);
  expect(nb >= 0 && r.reads[nb] === null && r.layout.firstNumber === 12, `the number over the opening line anchors the system (bar ${r.layout.firstNumber}) and is not a chord`);
  const runG = async (data, width) => { const { a, T } = logits(["G", "_"]); return { logits: a, frames: T, classes: K }; };
  const rg = await E.readChordPage(N, runG);
  expect(rg.reads.filter(Boolean).length === 1, `a reader that takes the number for "G" adds no chord there (${rg.reads.filter(Boolean).length} chords)`);
  // a final double bar line found as two lines is one bar line
  const D = page(1000, 300); staff(D, 150, 40, 960); for (const x of [40, 500, 935, 958]) rect(D, x, 150, x + (x === 958 ? 3 : 1), 190);
  expect(E.chordPageLayout(D).bars === 2, `a final thin + thick double bar does not add a sliver of a bar (${E.chordPageLayout(D).bars})`);
}

// ---- Easy Piano / Big-Note: pitch letters printed INSIDE enlarged noteheads on the staff are never chord boxes
{
  const BN = page(1000, 300); staff(BN, 150, 40, 960); for (const x of [40, 500, 960]) rect(BN, x, 150, x + 1, 190);
  for (const [x, y] of [[120, 160], [300, 170], [620, 150], [800, 175]]) {                // big white noteheads with a letter inside
    for (let a = 0; a < 360; a += 2) { const r = a * Math.PI / 180; rect(BN, Math.round(x + 16 * Math.cos(r)), Math.round(y + 11 * Math.sin(r)), Math.round(x + 16 * Math.cos(r)) + 1, Math.round(y + 11 * Math.sin(r)) + 1); }
    rect(BN, x - 4, y - 5, x + 4, y + 5);                                               // the letter
  }
  rect(BN, 600, 128, 602, 160);                                                          // a note's stem reaching above the staff
  word(BN, 100, 112, [9]); word(BN, 560, 112, [9, 6]);                                    // the chord names above
  const LB = E.chordPageLayout(BN);
  expect(LB.tokens.map((t) => t.bar).join(" ") === "0 1", `Big-Note letters in the noteheads are not chord boxes, the names above are (${LB.tokens.map((t) => t.bar + "@" + t.x0).join(" ")})`);
}

// ---- N.C., the no-chord mark (2026-11-15): two classes appended to the charset ------------------------------
{
  expect(E.CHORD_OCR.charset.endsWith("N.") && E.CHORD_OCR.charset.indexOf("N") === 42, "N and . are appended at the end of the charset (older 43-class readers keep their classes)");
  for (const w of ["N.C.", "NC", "N.C", "N.C.(A7)", "N. C."]) { const r = E.chordFromWritten(w); expect(r && r.noChord && r.name === "N.C.", `"${w}" is N.C.`); }
  const { a, T } = logits(["N", ".", "C", ".", "_"]);
  const r = E.chordOcrRead(a, T, K);
  expect(r && r.name === "N.C." && r.noChord, `a read of "N.C." is the no-chord mark (${r && r.name})`);
  // a 43-class reader (before N.C.) still decodes
  const K43 = 43, T2 = 3, a2 = new Float32Array(T2 * K43).fill(-8); a2[cls("C")] = 4; a2[K43 + cls("7")] = 4; a2[2 * K43] = 4;
  expect((E.chordOcrRead(a2, T2, K43) || {}).name === "C7", "a reader with the original 43 classes reads as before");
  // in the chart: N.C. sounds nothing until the next chord, and every exporter writes N.C.
  const lay = { bars: 4, tokens: [{ bar: 0, frac: 0.1 }, { bar: 1, frac: 0.1 }, { bar: 3, frac: 0.1 }], staves: [] };
  const sc = E.chordPageScore([{ layout: lay, reads: [{ name: "G7", prob: 0.9 }, r, { name: "C", prob: 0.9 }] }]);
  const ev = sc.bars.map((b) => b.events.map((e) => e.symbol + (e.held ? "h" : "")).join(" ")).join(" | ");
  expect(ev === "G7 | — | —h | C" && sc.bars[1].events[0].midis.length === 0, `N.C. holds silence, not the previous chord: ${ev}`);
  expect(/G7 \| N\.C\. \| (N\.C\.|%) \| C/.test(E.scoreToCSMPN(sc, { title: "x" })), "CSMPN writes it as N.C.");
}

// ---- the chord grammar rejects suffixes no chord name is built like (spec 5.3) ------------------------------
{
  const junk = ["G#969", "C77", "C99", "C79", "Cm711", "CMaj", "C7b"];
  expect(junk.every((t) => E.chordFromWritten(t) === null), "two chords run together or misreads are not chords: " + junk.filter((t) => E.chordFromWritten(t)).join(" "));
  const ok = [["C13#11", "C13#11"], ["C7#9b13", "C7#9b13"], ["Cm69", "Cm6/9"], ["D7sus47)", "D7sus4"], ["Cmadd9", "Cmadd9"], ["C7#9#5", "C7#9#5"]];
  const bad = ok.filter(([w, n]) => (E.chordFromWritten(w) || {}).name !== n);
  expect(!bad.length, "real chords still read: " + bad.map(([w]) => w + "→" + (E.chordFromWritten(w) || {}).name).join(" "));
}

// ---- the crop is cleaned before it is scaled: a fret grid's nut bar under the chord name ---------------------
{
  const img = page(200, 100); rect(img, 50, 40, 89, 59); rect(img, 30, 64, 120, 66);      // the name, then the nut bar 4 px under it
  const box = { x0: 50, y0: 40, x1: 89, y1: 59 };
  const cl = E.chordOcrInput(img, box), raw = E.chordOcrInput(img, box, { clean: false });
  const lastInk = (inp) => { let y = 31; for (; y >= 0; y--) { let n = 0; for (let x = 0; x < inp.width; x++) n += inp.data[y * inp.width + x] > 0.5; if (n > 0.3 * inp.width) break; } return y; };
  expect(lastInk(raw) > lastInk(cl) + 2, `the nut bar is whitened (last ink row ${lastInk(raw)} → ${lastInk(cl)})`);
  const mid = cl.data[16 * cl.width + (cl.width >> 1)];
  expect(mid > 0.95, "the chord itself is untouched");
  const pd = E.chordOcrInput(img, box, { clean: "pad" });
  expect(lastInk(pd) <= lastInk(cl), "\"pad\" whitens every padding pixel");
}

// ---- the shipped model + glue + UI contracts --------------------------------------------------------
{
  const model = fs.readFileSync(path.join(repo, "models/chord-ocr/chord-ocr.onnx")), hand = fs.readFileSync(path.join(repo, "models/chord-ocr/chord-ocr-hand.onnx"));
  const sha = crypto.createHash("sha256").update(model).digest("hex"), shaH = crypto.createHash("sha256").update(hand).digest("hex");
  const core = read("chord-ocr-core.js"), glue = read("chord-ocr-model.js"), worker = read("chord-ocr-worker.js");
  expect(core.includes(`sha256: "${sha}"`) && core.includes(`sha256: "${shaH}"`) && sha !== shaH, `chord-ocr-core.js pins both committed readers (${sha.slice(0, 12)}…, ${shaH.slice(0, 12)}…)`);
  expect(/const style = CHORD_OCR_MODELS\[opts\.style\] \? opts\.style : "printed"/.test(core) && /chordOcrModelBytes\(CHORD_OCR_MODELS\[style\]\)/.test(core) && /return \{ pages: out, style \}/.test(core), "core: the reader is chosen by opts.style (unknown → printed), only that one is downloaded, the result says which");
  expect(/postMessage\(\{ id: 1, pages, engineUrl, style \}/.test(glue) && /onMainThread\(pages, engineUrl, \{ onProgress, style \}\)/.test(glue) && /readChordPages\(pages, engine, \{ style,/.test(worker), "the style reaches the core from the page, through the worker or the main-thread path");
  expect(model.length > 2e5 && model.length < 4e6, `the model is small (${(model.length / 1e6).toFixed(2)} MB)`);
  const notice = read("models/chord-ocr/NOTICE");
  expect(notice.includes(sha) && notice.includes(shaH) && /MIT/.test(notice) && /synthetic/.test(notice) && /scripts\/chord-ocr/.test(notice) && /MuseJazz Text/.test(notice), "NOTICE: both files' SHA-256, the licence, synthetic training data (and the OFL font), how they were made");
  expect(/stem-model-core\.js/.test(core) && /capWasmMemory\(\)/.test(core) && /ORT_WASM_PATHS/.test(core) && /numThreads = 1/.test(core), "core: the pinned ORT 1.23.2 plain WASM rails from stem-model-core.js, one thread, the memory cap");
  expect(/sha256Hex\(b\) === model\.sha256/.test(core) && /cache\.delete\(key\)/.test(core) && /integrity check/.test(core), "core: SHA-256 checked, a bad cached copy evicted");
  expect(/engine\.readChordPage/.test(core) && /sess\.release\(\)/.test(core) && /firstBar/.test(core), "core: the engine's pipeline per page, bar numbering carried page to page, the session released");
  expect(/window\.TTP_CHORD_OCR = readChordSheets/.test(glue) && /type: "module"/.test(glue) && /w\.terminate\(\)/.test(glue), "chord-ocr-model.js publishes TTP_CHORD_OCR, runs a module worker, ends it after the job");
  expect(!/catch \(err\)[\s\S]{0,200}onMainThread/.test(glue) && /if \(!w\) return onMainThread/.test(glue), "the main thread is used only when no Worker can be made");
  expect(/readChordPages/.test(worker) && /type: "progress"/.test(worker), "the worker runs the core and reports progress");
  const html = read("index.html"), pages = read(".github/workflows/pages.yml");
  expect(/<script type="module" src="\.\/chord-ocr-model\.js"><\/script>/.test(html), "index.html loads chord-ocr-model.js");
  expect(/cp chord-ocr-model\.js chord-ocr-core\.js chord-ocr-worker\.js _site\//.test(pages) && /models\/chord-ocr\/chord-ocr\.onnx models\/chord-ocr\/chord-ocr-hand\.onnx models\/chord-ocr\/NOTICE/.test(pages) && /chord-ocr-model\.js\?v=\$\{BUILD\}/.test(pages), "pages.yml ships the glue, both readers + NOTICE, and stamps chord-ocr-model.js");
  const ui = read("TabDecoderPro.tsx"), scan = ui.slice(ui.indexOf("const SCAN_MAX_PAGES"), ui.indexOf("function LyricsPanel("));
  expect(/\["scan", "Scan 📷"\]/.test(ui) && /mode === "scan" \? <ScanPanel/.test(ui), "the Scan 📷 mode is listed and routed");
  expect(/window\.TTP_CHORD_OCR\(/.test(scan) && /chordPageScore\(/.test(scan) && /chordFromWritten\(/.test(scan) && /<ChartPanel/.test(scan), "ScanPanel reads pages in the worker, builds the chart with the engine, corrections go through the chord grammar, the chart is a ChartPanel");
  expect(/<input ref=\{fileRef\} type="file" onChange=\{onFile\}/.test(scan) && !/accept=/.test(scan), "the file input has no accept (iOS)");
  expect(/window\.pdfjsLib\.getDocument/.test(scan) && /createImageBitmap/.test(scan), "PDF pages via pdf.js, images via createImageBitmap");
  expect(/ocrReviewItems\(pages, fix\)/.test(scan) && /function ScanReviewRow/.test(scan) && /onPointerMove=\{move\}/.test(scan) && /touchAction: "pan-y"/.test(scan), "every chord is listed for review with swipe rows (pointer events, vertical scroll kept)");
  expect(/d\.dx > 70\) onApprove\(\)/.test(scan) && /d\.dx < -70\) onReject\(\)/.test(scan), "swipe right approves, swipe left marks not-a-chord");
  expect(/Approve all sure/.test(scan) && /Approve selected/.test(scan) && /type="checkbox"/.test(scan) && /To check \(/.test(scan) && /↶ Undo/.test(scan), "bulk approve (all sure / ticked), the To-check filter and Undo");
  expect(/const applyFix = /.test(scan) && (scan.match(/setFix\((?!\{\}\))/g) || []).length <= 3, "every change to the readings goes through applyFix (undoable); only a new read resets them");
  expect(/_usePref\("ttp:scanStyle", "printed"/.test(scan) && /Hand-copied \(Real Book\)/.test(scan) && /style: which/.test(scan) && /↻ Read again as/.test(scan) && /imgsRef\.current = imgs/.test(scan), "Book style picker (printed default, remembered), the style is sent to the reader, one-tap re-read with the other reader on the same images");
  expect(/it\.status === "check" && onPick && it\.alternatives\.slice\(0, 2\)/.test(scan) && /onPick=\{\(a\) => applyFix\(\{ \[it\.key\]: a \}\)\}/.test(scan), "a row still to check offers the runner-up readings as one-tap chips (undoable)");
}

console.log(`chord-ocr: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
