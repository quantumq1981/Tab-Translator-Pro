/* Guards for reading a DIGITAL score PDF from its text layer (engine block "PDF TEXT LAYER": pdfPageVectors,
 * pdfScoreLayout, pdfChordPages), the Ultimate Guitar chord spellings in chordFromWritten, the run-together split of
 * the raster reader (chordOcrSplitRead), and the Scan panel wiring. The pages here are SYNTHETIC — a fake PDF.js page
 * (text items + an operator list) built to carry every trap measured on the real UG "Pro" exports (copyrighted, not in
 * the repo): stems that span the staff, a row of ledger lines, a volta bracket, TAB string lines broken around fret
 * numbers, one path split over two constructPath ops, an iOS reprint that splits every glyph, centred chords, a boxed
 * rehearsal letter, a tuning line, tuplet numbers, chords set touching. Accuracy on the real files is measured by
 * scripts/chord-ocr/bench_pdf_text.mjs (docs/UG-PRO-PDF-CALIBRATION.md). */
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { loadEngine } from "./bench/lib.mjs";
const E = await loadEngine();
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const expect = (ok, msg) => { if (ok) pass++; else { fail++; console.log("  ✗ " + msg); } };

// ---- the grammar: Ultimate Guitar / Guitar Pro spellings --------------------------------------------------------------
const G = (x) => { const r = E.chordFromWritten(x); return r ? r.name : null; };
const want = { D7M: "Dmaj7", F7M: "Fmaj7", "G7M/B": "Gmaj7/B", Bb7M: "Bbmaj7", Dm7M: "Dm(maj7)", D9M: "Dmaj9", D13M: "Dmaj13",
  "C#m7/5+": "C#m7#5", "C#m7/5-": "C#m7b5", "G7/5-": "G7b5", "G7/5+": "G7#5", "B7/5+/D#": "B7#5/D#", "E7/9": "E9", "Am7/11": "Am11",
  "C7-9": "C7b9", "C7+9": "C7#9", "C7+5": "C7#5", "C#9-": "C#7b9", "B9+": "B7#9", "F#9-/5+": "F#7b9#5", "E7dim": "Edim7",
  "Fsus2/4": "Fsus4add9", "(Gm7)": "Gm7", "(C7(b9))": "C7b9" };
for (const [k, v] of Object.entries(want)) expect(G(k) === v, `grammar: ${k} → ${v} (got ${G(k)})`);
// what must stay as it was
for (const [k, v] of Object.entries({ "C-7": "Cm7", "C/E": "C/E", "C6/9": "C6/9", Bm9: "Bm9", C9: "C9", "D9#11": "D9#11", "Eb9b5": "Eb9b5", "Cmaj7": "Cmaj7", "F#m7b5": "F#m7b5" }))
  expect(G(k) === v, `grammar unchanged: ${k} → ${v} (got ${G(k)})`);
for (const k of ["DOUBLE-TIME", "C77", "Dm7M9", "7M", "(", "Verse", "x3", "= 120"]) expect(G(k) === null, `grammar: "${k}" is not a chord`);

// ---- a fake PDF.js page ----------------------------------------------------------------------------------------------
const OPS = { save: 10, restore: 11, transform: 12, moveTo: 13, lineTo: 14, curveTo: 15, curveTo2: 16, curveTo3: 17, closePath: 18, rectangle: 19,
  setLineWidth: 2, constructPath: 91, stroke: 20, closeStroke: 21, fill: 22, eoFill: 23, fillStroke: 24, eoFillStroke: 25, closeFillStroke: 26, closeEOFillStroke: 27,
  endPath: 28, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75 };
function page(H = 1000, W = 700) {
  const items = [], fn = [], args = [];
  // y is TOP-DOWN here; the PDF (and so the fake) is y-up: flip on the way in, as a real export is
  const Y = (y) => H - y;
  return {
    H, W,
    text(str, x, y, size, w, font = "fText") { items.push({ str, transform: [size, 0, 0, size, x, Y(y)], width: w ?? size * 0.6 * [...str].length, fontName: font }); },
    glyphs(str, x, y, size, adv = size * 0.6, font = "fText") { let cx = x; for (const ch of [...str]) { this.text(ch, cx, y, size, adv, font); cx += adv; } return cx; },
    line(x0, y0, x1, y1, lw = 1) { fn.push(OPS.setLineWidth, OPS.constructPath, OPS.stroke); args.push([lw], [[OPS.moveTo, OPS.lineTo], [x0, Y(y0), x1, Y(y1)], null], null); },
    splitLine(x0, y0, x1, y1) { fn.push(OPS.constructPath, OPS.constructPath, OPS.stroke); args.push([[OPS.moveTo], [x0, Y(y0)], null], [[OPS.lineTo], [x1, Y(y1)], null], null); },
    get vp() { return { width: W, height: H, transform: [1, 0, 0, -1, 0, H] }; },
    vec() { return E.pdfPageVectors({ items }, this.vp, { fnArray: fn, argsArray: args }, OPS); },
  };
}
const sp = 8;                                         // staff space
// one system: notation staff at `top`, TAB 6 lines (1.5 sp) below; 4 bars between `edges`; noteheads + TAB digits per bar
function system(P, top, edges, o = {}) {
  const tabTop = top + 4 * sp + 6 * sp, tabD = 1.5 * sp;
  for (let m = 0; m + 1 < edges.length; m++) for (let k = 0; k < 5; k++) P.line(edges[m], top + k * sp, edges[m + 1], top + k * sp);   // staff lines bar by bar
  for (let k = 0; k < 6; k++) {
    const y = tabTop + k * tabD;
    if (o.brokenTab && k === 4) { for (let x = edges[0]; x < edges[edges.length - 1]; x += 30) P.line(x, y, Math.min(x + 22, edges[edges.length - 1]), y); }   // broken around digits
    else if (o.splitPath && k === 2) P.splitLine(edges[0], y, edges[edges.length - 1], y);
    else P.line(edges[0], y, edges[edges.length - 1], y);
  }
  for (const x of edges) { P.line(x, top, x, top + 4 * sp); P.line(x, tabTop, x, tabTop + 5 * tabD); }        // bar lines on BOTH staves
  P.text("\ue06d", edges[0] + 2, tabTop + 5 * tabD, 4 * sp, 10, "fLeland");                                      // TAB clef
  const notes = [];
  for (let m = 0; m + 1 < edges.length; m++) for (const f of [0.15, 0.55]) {
    if (o.empty && o.empty.includes(m)) continue;                                                                // a whole-bar rest
    const x = edges[m] + f * (edges[m + 1] - edges[m]); notes.push(x);
    if (o.garbled) P.text("$", x - 4, top + 2 * sp, 4 * sp, 8, "fLelandX");                                       // a notehead, its glyph unmapped (iOS 27)
    else P.text("\ue0a4", x - 4, top + 2 * sp, 4 * sp, 8, "fLeland");                                           // a notehead
    P.text("5", x - 3, tabTop + 2 * tabD + 3, 1.8 * sp, 6);                                                      // its TAB digit
    // a stem spanning the whole staff (it overshoots the outer lines, and the TAB has none) — not a bar line
    P.line(x + 3, top - 1.3 * sp, x + 3, top + 4 * sp + 1.1 * sp, 0.4);
  }
  return { tabTop, notes, bottom: tabTop + 5 * tabD };
}
const centred = (P, name, x, y, size = 1.6 * sp) => { const w = size * 0.6 * [...name].length; P.text(name, x - w / 2, y, size, w); };

// ---- page 1: native export (whole words), title block, tuning, tempo, 4/4, a rehearsal box, sections, ledgers, volta
const P1 = page();
P1.text("Revelation Test", 250, 40, 4.5 * sp); P1.text("Some Artist", 290, 70, 2.7 * sp);
// the tuning line as an iOS reprint gives it: one item per glyph, so "E" "A" "D" "G" "B" "E" are each a valid chord
{ let x = 30; for (const tok of ["Tuning", ":", "E", "A", "D", "G", "B", "E"]) { x = P1.glyphs(tok, x, 105, 1.6 * sp, 7) + 5; } }
const E1 = [50, 200, 350, 500, 650], S1 = system(P1, 170, E1, { brokenTab: true, splitPath: true });
P1.text("\ue084", 62, 170 + 2 * sp, 4 * sp, 10); P1.text("\ue084", 62, 170 + 4 * sp, 4 * sp, 10);   // 4/4: numerator on the middle line, denominator on the bottom
P1.text("\ueca5", 60, 128, 4 * sp, 8); P1.text("= 96", 70, 128, 1.8 * sp);                          // ♩ = 96
E1.slice(0, 4).forEach((x, i) => P1.text(String(i + 1), x + 1, 166, 1.2 * sp));                     // a bar number at every bar
const cy = 170 - 1.8 * sp;
centred(P1, "Dm", S1.notes[0], cy); centred(P1, "C#m7/5+", S1.notes[2], cy); centred(P1, "D7M", S1.notes[3], cy);
centred(P1, "Bb", S1.notes[4], cy); centred(P1, "A", S1.notes[6], cy);
// a CENTRED chord over bar 4's first note, wide enough that it starts LEFT of the bar line
centred(P1, "Ebmaj7#11", S1.notes[6] + 0, cy - 2 * sp);
P1.text("3", S1.notes[1], 170 - 1.5 * sp, 1.6 * sp);                                                // a tuplet number in the chord tier
P1.text("[Intro]", 55, 170 - 3.6 * sp, 1.8 * sp);                                                   // a section label
// a boxed rehearsal letter over bar 3 (a single capital: as a chord it would read "B")
const rx = E1[2] + 2, ry = 170 - 4 * sp; P1.text("B", rx, ry, 1.8 * sp, 9);
P1.line(rx - 3, ry - 1.8 * sp * 0.75 - 3, rx + 12, ry - 1.8 * sp * 0.75 - 3); P1.line(rx - 3, ry + 5, rx + 12, ry + 5);
P1.line(rx - 3, ry - 1.8 * sp * 0.75 - 3, rx - 3, ry + 5); P1.line(rx + 12, ry - 1.8 * sp * 0.75 - 3, rx + 12, ry + 5);
P1.text("Pre-Verse", rx + 16, ry, 1.8 * sp);
for (let x = 220; x < 480; x += 22) P1.line(x, 170 - sp, x + 15, 170 - sp);                         // a row of ledger lines one space above
// a row of ledger lines one space BELOW, end to end across the whole system (same x-extent as the staff lines):
// only its ink coverage tells it from a sixth staff line
for (let x = 50; x < 650; x += 24) P1.line(x, 170 + 5 * sp, Math.min(x + 15, 650), 170 + 5 * sp);
P1.line(260, 170, 260, 170 + 4 * sp, 0.4);                                                            // a stem ending exactly on the outer lines (no TAB stroke under it)
P1.line(300, 170 - 1.5 * sp, 300, S1.bottom + 1.5 * sp, 0.6);                                         // a strum line through both staves, overshooting them
P1.line(500, 170 - 2.5 * sp, 650, 170 - 2.5 * sp); P1.line(500, 170 - 2.5 * sp, 500, 170 - 1.5 * sp); // a volta bracket
P1.text("let ring", 60, S1.bottom + 2 * sp, 1.5 * sp);
P1.text("X", 120, S1.bottom + 0.4 * sp, 1.8 * sp);                                                  // a dead note on the bottom string
// system 2: an iOS-style reprint of its chords (one item per glyph), a split "= 1 2 0" tempo is NOT here; 3/4 change
const E2 = [50, 210, 370, 530, 650], S2 = system(P1, 420, E2);
E2.slice(0, 4).forEach((x, i) => P1.text(String(i + 5), x + 1, 416, 1.2 * sp));
P1.text("\ue083", E2[1] + 8, 420 + 2 * sp, 4 * sp, 10); P1.text("\ue084", E2[1] + 8, 420 + 4 * sp, 4 * sp, 10);   // 3/4 from bar 6
const cy2 = 420 - 1.8 * sp, g = 1.6 * sp;
P1.glyphs("Cm7", S2.notes[0] - 10, cy2, g); P1.glyphs("B", S2.notes[2] - 6, cy2, g, 8); P1.text("\ued60", S2.notes[2] + 2, cy2, g, 4); P1.glyphs("7", S2.notes[2] + 6, cy2, g);
P1.glyphs("G#m7/5-C#9-", S2.notes[4] - 30, cy2, g, 6.4);                                            // two chords set touching
P1.glyphs("Verse", 60, 420 - 3.6 * sp, 1.8 * sp, 9); P1.glyphs("1", 60 + 5 * 9 + 6, 420 - 3.6 * sp, 1.8 * sp, 9);   // "Verse 1" split at the space
P1.glyphs("DOUBLE-TIME", E2[3] + 5, 420 - 3.6 * sp, 1.6 * sp, 8);                                   // a direction in capitals

const V1 = P1.vec(), L1 = E.pdfScoreLayout(V1);
expect(L1.systems.length === 2, `two systems (${L1.systems.length})`);
expect(L1.systems.every((s) => s.staves.length === 2 && !s.staves[0].tab && s.staves[1].tab), "each system = a notation staff + a TAB staff (ledger row, volta, broken / split TAB lines not taken as staff lines)");
expect(L1.systems[0].staves[0].n === 5 && L1.systems[0].staves[1].n === 6, `5 + 6 lines (${L1.systems[0].staves.map((s) => s.n)})`);
expect(Math.abs(L1.sp - sp) < 0.01, `staff space read from the lines (${L1.sp})`);
expect(L1.systems[0].edges.length === 5 && L1.systems[1].edges.length === 5, `four bars per system — stems spanning the staff are not bar lines (${L1.systems.map((s) => s.edges.length - 1)})`);
expect(JSON.stringify(L1.systems[0].timeSigs) === JSON.stringify([{ x: 62, num: 4, den: 4 }]), `4/4 read from the SMuFL glyphs (${JSON.stringify(L1.systems[0].timeSigs)})`);
expect(L1.systems[1].timeSigs.length === 1 && L1.systems[1].timeSigs[0].num === 3, "3/4 change read");
const w = L1.words.map((x) => x.s);
expect(w.includes("Bb7") && w.includes("Cm7"), `per-glyph items joined into words, the small flat glyph read as "b" (${w.filter((x) => /^[BC]/.test(x))})`);

const R = E.pdfChordPages([V1]);
const chords = (pg) => { const out = {}; pg.layout.tokens.forEach((t, i) => { const r = pg.reads[i]; (out[pg.layout.firstNumber + t.bar] ||= []).push(r ? r.name : "?" + t.text); }); return out; };
const C1 = chords(R.pages[0]);
expect(R.ok && R.title === "Revelation Test" && R.artist === "Some Artist", `title / artist (${R.title} / ${R.artist})`);
expect(R.tuning === "E A D G B E", `tuning (${R.tuning})`);
expect(R.tempo === 96, `tempo (${R.tempo})`);
expect(R.align === "centre", `centred chords detected (${R.align})`);
expect(R.numbering.printed === 8 && R.numbering.agree === 8, `every printed bar number agrees with the bar lines (${JSON.stringify(R.numbering)})`);
expect(JSON.stringify(C1[1]) === JSON.stringify(["Dm"]) && JSON.stringify(C1[2]) === JSON.stringify(["C#m7#5", "Dmaj7"]), `bars 1–2: UG spellings read (${JSON.stringify([C1[1], C1[2]])})`);
expect(JSON.stringify(C1[3]) === JSON.stringify(["Bb"]), `bar 3: the boxed rehearsal "B" is not a chord (${JSON.stringify(C1[3])})`);
expect(C1[4] && C1[4].includes("A") && C1[4].includes("Ebmaj7#11"), `bar 4: a centred chord that starts left of the bar line is in bar 4 (${JSON.stringify(C1)})`);
expect(!C1[0] && JSON.stringify(C1[1]) === JSON.stringify(["Dm"]), `the tuning line's letters are not chords (${JSON.stringify(C1[1])})`);
expect(C1[5] && C1[5].join() === "Cm7" && C1[6] && C1[6].join() === "Bb7", `bars 5–6: iOS per-glyph chords (${C1[5]} | ${C1[6]})`);
expect(C1[7] && C1[7].join() === "G#m7b5,C#7b9", `bar 7: two chords set touching are split (${C1[7]})`);
expect(!Object.values(C1).flat().some((c) => /DOUBLE|let|^\?X$|^3$/.test(c)), `no directions, TAB digits, tuplet numbers (${JSON.stringify(C1)})`);
const secs = R.pages[0].layout.sections;
expect(secs.some((s) => s.bar === 0 && s.name === "Intro") && secs.some((s) => s.bar === 2 && s.name === "Pre-Verse") && secs.some((s) => s.bar === 4 && s.name === "Verse 1"),
  `sections: [Intro] bar 1, Pre-Verse over the box (not "B") bar 3, "Verse 1" joined bar 5 (${JSON.stringify(secs)})`);
const sc = E.chordPageScore(R.pages, { title: R.title, tempo: R.tempo });
expect(sc.bars.length === 8 && sc.tempo === 96, `chart: 8 bars, ♩=96 (${sc.bars.length}, ${sc.tempo})`);
expect(sc.bars[0].timeSig.join("/") === "4/4" && sc.bars[5].timeSig.join("/") === "3/4" && sc.bars[7].timeSig.join("/") === "3/4", `chart meter: 4/4 then 3/4 from bar 6 (${sc.bars.map((b) => b.timeSig.join("/"))})`);
expect(sc.bars[0].section === "Intro" && sc.bars[2].section === "Pre-Verse" && sc.bars[4].section === "Verse 1", "chart sections");
expect(sc.bars[1].events.map((e) => e.symbol).join() === "C#m7#5,Dmaj7", `chart bar 2 (${sc.bars[1].events.map((e) => e.symbol)})`);
// a chord read off a page is kept as WRITTEN: the Pro vocabulary must not re-derive it from its notes (C#m7#5 would
// read "A/C#", F#7b9#5 would lose its #5), and a transpose moves the text
const names = (x) => x.bars.flatMap((b) => b.events.map((e) => e.symbol));
const pro = E.respellScore(sc, "chart");
expect(names(pro).join() === names(sc).join() && names(sc).includes("C#m7#5"), `Pro keeps written chords (${names(pro).slice(0, 6)})`);
expect(sc.bars.every((b) => b.events.every((e) => e.written || e.symbol === "—")), "every chord of a page chart is marked written");
const up = E.transposeScore(sc, 2, true);
expect(names(up).includes("Ebm7#5") && names(up).includes("Emaj7"), `transpose +2 moves the written text (${names(up).slice(0, 6)})`);
const csmpn = E.scoreToCSMPN(sc, { title: R.title, tempo: R.tempo });
expect(/- Intro/.test(csmpn) && /- Verse 1/.test(csmpn) && /Time: 4\/4/.test(csmpn), "CSMPN carries the sections and the meter");
// OCR pages (no timeSigs / sections) keep the old 4/4 behaviour
const ocrLike = { layout: { ...R.pages[0].layout, timeSigs: undefined, sections: undefined }, reads: R.pages[0].reads };
expect(E.chordPageScore([ocrLike]).bars.every((b) => b.timeSig.join("/") === "4/4" && !b.section), "pages without a meter / sections: 4/4, no sections (the OCR path)");
// review list: every text chord is "sure"
const items = E.ocrReviewItems(R.pages, {});
expect(items.length >= 9 && items.every((it) => it.status === "sure" && it.prob === 1), `review list: text reads are certain (${items.length})`);
// token boxes scale to the rendered page
const R2 = E.pdfChordPages([V1], { scale: 2 }), t1 = R.pages[0].layout.tokens[0], t2 = R2.pages[0].layout.tokens[0];
expect(Math.abs(t2.x0 - 2 * t1.x0) < 1e-6 && Math.abs(t2.y1 - 2 * t1.y1) < 1e-6, "token boxes in the rendered page's pixels (opts.scale)");

// ---- page 2 of the same document: bar numbering continues; an iOS split tempo "=" "1 2 0" on page 2 is not used
const P2 = page(); const E3 = [50, 350, 650]; const S3 = system(P2, 150, E3);
E3.slice(0, 2).forEach((x, i) => P2.text(String(i + 9), x + 1, 146, 1.2 * sp));
centred(P2, "F#9-/5+", S3.notes[0], 150 - 1.8 * sp); centred(P2, "E7dim", S3.notes[2], 150 - 1.8 * sp);
P2.text("2", 640, 40, 2.5 * sp);                                                                      // a page number
const RR = E.pdfChordPages([V1, P2.vec()]), C2 = chords(RR.pages[1]);
expect(RR.pages[1].layout.firstNumber === 9 && RR.pages[1].layout.bars === 2, `page 2 starts at bar 9 (${RR.pages[1].layout.firstNumber}, ${RR.pages[1].layout.bars})`);
expect(C2[9] && C2[9][0] === "F#7b9#5" && C2[10] && C2[10][0] === "Edim7", `page 2 chords (${JSON.stringify(C2)})`);
expect(E.chordPageScore(RR.pages).bars.length === 10, "two pages → 10 bars");

// ---- an iOS reprint's tempo: "=" and "120" are separate words
const P3 = page(); const S4 = system(P3, 200, [50, 650]);
P3.text("\ueca5", 60, 150, 4 * sp, 8); P3.glyphs("=", 72, 150, 1.8 * sp, 8); P3.glyphs("120", 86, 150, 1.8 * sp, 8);
P3.text("1", 51, 196, 1.2 * sp); centred(P3, "G", S4.notes[0], 200 - 1.8 * sp); centred(P3, "C", S4.notes[1], 200 - 1.8 * sp); centred(P3, "D", S4.notes[1] + 1, 200 - 3.8 * sp);
const R3 = E.pdfChordPages([P3.vec()]);
expect(R3.tempo === 120, `split tempo "=" "120" read (${R3.tempo})`);

// ---- no text layer (a scan): not ok, nothing invented
const empty = E.pdfChordPages([E.pdfPageVectors({ items: [] }, P1.vp, { fnArray: [], argsArray: [] }, OPS)]);
expect(!empty.ok && empty.chords === 0, "an image-only PDF → ok:false (OCR reads it)");
const textOnly = E.pdfChordPages([E.pdfPageVectors({ items: [{ str: "C", transform: [12, 0, 0, 12, 100, 900], width: 7 }] }, P1.vp)]);
expect(!textOnly.ok, "text with no staves → ok:false");
// a rotated label is not read
const rot = E.pdfPageVectors({ items: [{ str: "G7", transform: [0, 12, -12, 0, 100, 500], width: 14 }] }, P1.vp);
expect(rot.items.length === 0, "rotated text is skipped");

// ---- the raster reader: two chords read as one run-together string
{
  const cs = E.CHORD_OCR.charset, K = cs.length + 1, text = "Bb13Bb9", T = text.length * 3, lg = new Float32Array(T * K).fill(-5);
  [...text].forEach((c, i) => { lg[(3 * i) * K + cs.indexOf(c) + 1] = 5; lg[(3 * i + 1) * K + cs.indexOf(c) + 1] = 5; lg[(3 * i + 2) * K] = 5; });
  const box = { x0: 100, x1: 184, y0: 10, y1: 24 };
  const sp2 = E.chordOcrSplitRead(lg, T, K, box, { width: 1000 });
  expect(sp2 && sp2.left.name === "Bb13" && sp2.right.name === "Bb9", `"Bb13Bb9" → Bb13 + Bb9 (${sp2 && sp2.left.name}, ${sp2 && sp2.right.name})`);
  expect(sp2 && sp2.x > box.x0 + 0.45 * (box.x1 - box.x0) && sp2.x < box.x0 + 0.65 * (box.x1 - box.x0), `cut where the second chord starts (${sp2 && sp2.x})`);
  const one = (t) => { const T2 = t.length * 3, l2 = new Float32Array(T2 * K).fill(-5); [...t].forEach((c, i) => { l2[(3 * i) * K + cs.indexOf(c) + 1] = 5; l2[(3 * i + 2) * K] = 5; }); return E.chordOcrSplitRead(l2, T2, K, box, { width: 1000 }); };
  expect(one("C/E") === null && one("Dm7") === null, "a reading that is one chord is never split (C/E stays C/E)");
  const sl = one("Cm7/Bb/D");
  expect(sl && sl.left.name === "Cm7" && sl.right.name === "Bb/D", `a slash the reader put in the gap is dropped ("Cm7/Bb/D" → Cm7 + Bb/D: ${sl && sl.left.name} ${sl && sl.right.name})`);
}

// ---- an iOS 27 print: the music font has lost its Unicode map (glyphs arrive as ASCII), a 10-bar rest, a bar number
// set against a chord, a chord against "Da Coda", "G7(#5)" whose parentheses are drawn, labels centred on a bar line
{
  const P = page(); const E5 = [50, 190, 330, 480, 650];
  P.glyphs("Affirmation", 260, 40, 4.5 * sp, 2.7 * sp, "fTitle"); P.glyphs("George", 290, 70, 2.7 * sp, 13, "fTitle");
  const S5 = system(P, 200, E5, { empty: [0, 1], garbled: true });
  P.text("+", 250, 200 - 1.5 * sp, 4.7 * sp, 10, "fLelandX"); P.text(",", 260, 200 - 1.5 * sp, 4.7 * sp, 10, "fLelandX");   // the rest's "10", unmapped
  P.text("!", 60, 150, 3 * sp, 4, "fLelandText"); P.glyphs("=", 66, 150, 1.8 * sp, 6, "fBold"); P.glyphs("75", 76, 150, 1.8 * sp, 7, "fBold");   // ♩ = 75
  const cy5 = 200 - 1.8 * sp;
  // bar 13's number sits as in Sleepwalk: right against the chord before it, its baseline 0.28 × the chord's size lower
  [1, 2, 12, 13].forEach((n, i) => P.text(String(n), E5[i] + 1, n === 13 ? cy5 + 0.28 * 1.6 * sp : 196, 1.2 * sp, String(n).length * 5, "fItalic"));
  // bar 12: "G7" … (drawn parenthesis gap) … "#5", then "Bb7" whose last glyph touches bar 13's number "13" (smaller, lower)
  let x = P.glyphs("G7", S5.notes[0] - 3, cy5, 1.6 * sp, 7.7, "fChord"); P.text("\ued62", x + 6, cy5, 1.6 * sp, 4, "fChordAcc"); P.glyphs("5", x + 10, cy5, 1.6 * sp, 7.7, "fChord");
  P.glyphs("Bb7", E5[3] - 23.1, cy5, 1.6 * sp, 7.7, "fChord");
  // bar 13: "Da Coda" (bigger text) touching a chord that is smaller and slightly raised
  x = P.glyphs("Da", E5[3] + 20, cy5 + 2, 2.0 * sp, 9.6, "fRoman"); x = P.glyphs("Coda", x + 4, cy5 + 2, 2.0 * sp, 9.6, "fRoman");
  P.glyphs("C7", x, cy5, 1.6 * sp, 7.7, "fChord");
  // labels: "THEME" centred ON bar 12's bar line; a long label starting in bar 1 that runs over bar 2's line
  P.glyphs("THEME", E5[2] - 22, 200 - 4 * sp, 1.8 * sp, 9, "fBold");
  P.glyphs("INTRO", E5[0] + 70, 200 - 4 * sp, 1.8 * sp, 9, "fBold"); P.glyphs("ALONG", E5[0] + 70 + 50, 200 - 4 * sp, 1.8 * sp, 9, "fBold");
  const R5 = E.pdfChordPages([P.vec()]), L5 = R5.pages[0].layout, C5 = chords(R5.pages[0]);
  expect(R5.title === "Affirmation" && R5.tempo === 75, `an unmapped music font is not text: title "${R5.title}" (not the rest's "+,"), tempo ${R5.tempo} (the metronome "!" is not glued to "= 75")`);
  expect(L5.firstNumber === 1 && L5.bars === 13 && R5.numbering.printed === 4 && R5.numbering.agree === 4, `a 10-bar rest: printed 1, 2, 12, 13 confirmed by the next number (first ${L5.firstNumber}, ${L5.bars} bars, ${JSON.stringify(R5.numbering)})`);
  expect(C5[12] && C5[12].join() === "G7#5,Bb7", `bar 12: "G7" + "#5" across the parenthesis gap; "Bb7" not glued to bar number 13 (${JSON.stringify(C5)})`);
  expect(C5[13] && C5[13].join() === "C7", `bar 13: a chord touching "Da Coda" (${JSON.stringify(C5[13])})`);
  expect(!C5[1] && !C5[2], "the empty real first bar is kept (bar 1 stays bar 1) and holds no chord");
  const sec5 = L5.sections;
  expect(sec5.some((q) => q.name === "THEME" && q.bar === 11) && sec5.some((q) => /^INTRO/.test(q.name) && q.bar === 0), `labels: THEME centred on bar 12's line → bar 12; a long label from bar 1 stays in bar 1 (${JSON.stringify(sec5)})`);
  expect(E.chordPageScore(R5.pages).bars.length === 13, "the chart has all 13 bars (the rest's 10 included)");
  // a music font is recognised by its NAME too (when the app passes PDF.js font names)
  const V5n = E.pdfPageVectors({ items: [{ str: "q", transform: [12, 0, 0, 12, 100, 900], width: 7, fontName: "g1" }] }, P.vp, null, null, { fontNames: { g1: "ABCDEF+Leland" } });
  expect(V5n.items[0].fn === "ABCDEF+Leland", "font names ride on the items");
  expect(E.PDF_TEXT.smuflFont.test("Leland") && E.PDF_TEXT.smuflFont.test("BravuraText") && !E.PDF_TEXT.smuflFont.test("Edwin-Roman") && !E.PDF_TEXT.smuflFont.test("MuseJazzText"), "SMuFL font names (MuseJazz Text is a text font)");
}

// ---- the Scan panel wiring (browser glue)
const ui = fs.readFileSync(path.join(repo, "TabDecoderPro.tsx"), "utf8");
const scan = ui.slice(ui.indexOf("async function _scanPdfPages"), ui.indexOf("function LyricsPanel"));
expect(/pdfPageVectors,/.test(ui) && /pdfChordPages,/.test(ui), "the UI imports the text-layer reader");
expect(/getOperatorList\(\)/.test(scan) && /window\.pdfjsLib\.OPS/.test(scan) && /pdfPageVectors\(tc, vp, ol,/.test(scan), "a PDF page's text + paths are taken in the SAME viewport it is rendered in");
expect(/commonObjs\.get\(it\.fontName\)/.test(scan) && /\{ fontNames \}/.test(scan), "the real font names are passed along (music fonts by name)");
expect(/catch \(_\) \{ vecs\.push\(null\); \}/.test(scan) && /catch \(_\) \{ fontNames\[it\.fontName\] = ""; \}/.test(scan), "a text-layer or font-name failure falls back (never throws)");
expect(/if \(tr\.ok\) textRef\.current = tr/.test(scan) && /else await readImages\(imgs, style\)/.test(scan), "a usable text layer is read; anything else goes to OCR");
expect(/Read with OCR instead/.test(scan) && /Read the PDF's text/.test(scan), "one tap between the text reading and OCR");
expect(/tempo: doc && doc\.tempo/.test(scan), "the chart takes the PDF's tempo");
expect(!/<input[^>]*accept=/.test(scan), "the Scan file input has no accept filter (iOS)");
const pages = fs.readFileSync(path.join(repo, ".github/workflows/pages.yml"), "utf8");
expect(/engine\.tsx/.test(pages), "the engine ships");

console.log(`pdf-text: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
