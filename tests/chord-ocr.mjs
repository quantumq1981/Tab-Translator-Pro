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

// ---- the shipped model + glue + UI contracts --------------------------------------------------------
{
  const model = fs.readFileSync(path.join(repo, "models/chord-ocr/chord-ocr.onnx"));
  const sha = crypto.createHash("sha256").update(model).digest("hex");
  const core = read("chord-ocr-core.js"), glue = read("chord-ocr-model.js"), worker = read("chord-ocr-worker.js");
  expect(core.includes(`sha256: "${sha}"`), `chord-ocr-core.js pins the committed model (${sha.slice(0, 12)}…)`);
  expect(model.length > 2e5 && model.length < 4e6, `the model is small (${(model.length / 1e6).toFixed(2)} MB)`);
  const notice = read("models/chord-ocr/NOTICE");
  expect(notice.includes(sha) && /MIT/.test(notice) && /synthetic/.test(notice) && /scripts\/chord-ocr/.test(notice), "NOTICE: the file's SHA-256, the licence, synthetic training data, how it was made");
  expect(/stem-model-core\.js/.test(core) && /capWasmMemory\(\)/.test(core) && /ORT_WASM_PATHS/.test(core) && /numThreads = 1/.test(core), "core: the pinned ORT 1.23.2 plain WASM rails from stem-model-core.js, one thread, the memory cap");
  expect(/sha256Hex\(b\) === model\.sha256/.test(core) && /cache\.delete\(key\)/.test(core) && /integrity check/.test(core), "core: SHA-256 checked, a bad cached copy evicted");
  expect(/engine\.readChordPage/.test(core) && /sess\.release\(\)/.test(core) && /firstBar/.test(core), "core: the engine's pipeline per page, bar numbering carried page to page, the session released");
  expect(/window\.TTP_CHORD_OCR = readChordSheets/.test(glue) && /type: "module"/.test(glue) && /w\.terminate\(\)/.test(glue), "chord-ocr-model.js publishes TTP_CHORD_OCR, runs a module worker, ends it after the job");
  expect(!/catch \(err\)[\s\S]{0,200}onMainThread/.test(glue) && /if \(!w\) return onMainThread/.test(glue), "the main thread is used only when no Worker can be made");
  expect(/readChordPages/.test(worker) && /type: "progress"/.test(worker), "the worker runs the core and reports progress");
  const html = read("index.html"), pages = read(".github/workflows/pages.yml");
  expect(/<script type="module" src="\.\/chord-ocr-model\.js"><\/script>/.test(html), "index.html loads chord-ocr-model.js");
  expect(/cp chord-ocr-model\.js chord-ocr-core\.js chord-ocr-worker\.js _site\//.test(pages) && /models\/chord-ocr\/chord-ocr\.onnx models\/chord-ocr\/NOTICE/.test(pages) && /chord-ocr-model\.js\?v=\$\{BUILD\}/.test(pages), "pages.yml ships the glue, model + NOTICE, and stamps chord-ocr-model.js");
  const ui = read("TabDecoderPro.tsx"), scan = ui.slice(ui.indexOf("function ScanPanel("), ui.indexOf("function LyricsPanel("));
  expect(/\["scan", "Scan 📷"\]/.test(ui) && /mode === "scan" \? <ScanPanel/.test(ui), "the Scan 📷 mode is listed and routed");
  expect(/window\.TTP_CHORD_OCR\(/.test(scan) && /chordPageScore\(/.test(scan) && /chordFromWritten\(/.test(scan) && /<ChartPanel/.test(scan), "ScanPanel reads pages in the worker, builds the chart with the engine, corrections go through the chord grammar, the chart is a ChartPanel");
  expect(/<input ref=\{fileRef\} type="file" onChange=\{onFile\}/.test(scan) && !/accept=/.test(scan), "the file input has no accept (iOS)");
  expect(/window\.pdfjsLib\.getDocument/.test(scan) && /createImageBitmap/.test(scan), "PDF pages via pdf.js, images via createImageBitmap");
}

console.log(`chord-ocr: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
