/* Redesign step 5 (2026-11-27): one Open, routed by content. sniffFile over every score / PDF / fixture in the repo and
 * synthetic headers for each audio / image container; classifyPdfText over the repo's real PDFs (read with pdfjs-dist,
 * as path-a-smoke does); source guards on the UI router. The real-app behaviour is bench/open-e2e.mjs. */
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url"; import { createRequire } from "node:module";
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, "..");
const require = createRequire(import.meta.url);
globalThis.DOMParser = (await import("@xmldom/xmldom")).DOMParser;
const enginePath = path.join(here, ".engine.openrouter.mjs");
fs.writeFileSync(enginePath, fs.readFileSync(path.join(repo, "engine.tsx"), "utf8"));
const E = await import(enginePath + "?t=" + Date.now());
const ui = fs.readFileSync(path.join(repo, "TabDecoderPro.tsx"), "utf8");
let passes = 0, failures = 0;
const expect = (c, m) => { if (c) passes++; else { failures++; console.log("FAIL:", m); } };
const between = (a, b) => { const i = ui.indexOf(a); return i < 0 ? "" : ui.slice(i, ui.indexOf(b, i + a.length)); };
const bytes = (p) => new Uint8Array(fs.readFileSync(p));
const sniff = (b, n) => E.sniffFile(b, n);

// ---- every score file in the repo → score, whatever its name; every PDF → pdf
const scoreExt = /\.(gp|gpx|gp3|gp4|gp5|ptb|musicxml|xml|mxl|mid|midi|zip|alphatex)$/i;
const files = [...fs.readdirSync(repo).map((f) => path.join(repo, f)), ...fs.readdirSync(path.join(here, "fixtures")).map((f) => path.join(here, "fixtures", f))].filter((p) => fs.statSync(p).isFile());
const scores = files.filter((p) => scoreExt.test(p) && !/package|\.json$/.test(p));
const wrong = scores.filter((p) => sniff(bytes(p), path.basename(p)).kind !== "score").map((p) => `${path.basename(p)}=${sniff(bytes(p), path.basename(p)).kind}`);
expect(scores.length >= 60 && !wrong.length, `every score file in the repo reads as a score (${scores.length}): ${wrong.slice(0, 5).join(", ")}`);
const renamed = scores.filter((p) => sniff(bytes(p), "download").kind !== "score");
expect(!renamed.length, "…and still does with its name stripped (routing is by content)");
const pdfs = files.filter((p) => /\.pdf$/i.test(p));
expect(pdfs.length >= 5 && pdfs.every((p) => sniff(bytes(p), "x").kind === "pdf"), `every PDF reads as a PDF (${pdfs.length})`);
const formats = new Set(scores.map((p) => sniff(bytes(p), "").format));
expect(["gp", "zip", "gpx", "ptb", "musicxml"].every((f) => formats.has(f)), `formats seen: ${[...formats].join(" ")}`);

// ---- synthetic containers
const hdr = (...parts) => { const out = []; for (const p of parts) for (const c of (typeof p === "string" ? [...p].map((x) => x.charCodeAt(0)) : p)) out.push(c); while (out.length < 64) out.push(0); return new Uint8Array(out); };
const cases = [
  [hdr("RIFF", [0, 0, 0, 0], "WAVEfmt "), "audio", "wav"], [hdr("ID3", [3, 0]), "audio", "mp3"], [hdr([0xff, 0xfb, 0x90, 0x64]), "audio", "mpeg"],
  [hdr("OggS"), "audio", "ogg"], [hdr("fLaC"), "audio", "flac"], [hdr("FORM", [0, 0, 0, 0], "AIFF"), "audio", "aiff"], [hdr("caff"), "audio", "caf"],
  [hdr([0, 0, 0, 0x20], "ftypM4A "), "audio", "mp4"], [hdr([0, 0, 0, 0x18], "ftypqt  "), "audio", "mp4"], [hdr([0x1a, 0x45, 0xdf, 0xa3]), "audio", "webm"],
  [hdr([0xff, 0xd8, 0xff, 0xe0]), "image", "jpeg"], [hdr([0x89], "PNG"), "image", "png"], [hdr("GIF89a"), "image", "gif"], [hdr("RIFF", [0, 0, 0, 0], "WEBP"), "image", "webp"],
  [hdr([0, 0, 0, 0x18], "ftypheic"), "image", "heic"], [hdr([0, 0, 0, 0x18], "ftypmif1"), "image", "heic"],
  [hdr("MThd", [0, 0, 0, 6]), "score", "midi"], [hdr("ptab"), "score", "ptb"], [hdr("BCFZ"), "score", "gpx"], [hdr([0x18], "FICHIER GUITAR PRO v5.00"), "score", "gp"], [hdr("PK", [3, 4]), "score", "zip"], [hdr("%PDF-1.7"), "pdf", "pdf"],
];
const bad = cases.filter(([b, k, f]) => { const r = sniff(b, "x"); return r.kind !== k || r.format !== f; }).map(([b, k, f]) => `${k}/${f}→${JSON.stringify(sniff(b, "x"))}`);
expect(!bad.length, `container magics: ${bad.join(" ; ")}`);
const unk = new Uint8Array(200); for (let i = 0; i < 200; i += 3) unk[i] = (i * 37) & 255;
expect(sniff(unk, "thing.bin").kind === "unknown" && sniff(unk, "take.m4a").kind === "audio" && sniff(unk, "IMG_1.HEIC").kind === "image", "an unmatched binary: unknown, unless its name says audio / image (a tie-break only)");
expect(sniff(hdr("ID3"), "chart.pdf").kind === "audio" && sniff(hdr("%PDF"), "song.mp3").kind === "pdf", "a magic match beats a misleading name");
expect(sniff(new Uint8Array(0), "x").format === "empty" && sniff(null, "x").kind === "unknown", "empty / null input → unknown, no throw");

// ---- text
const T = (s, n = "x") => sniff(new TextEncoder().encode(s), n);
expect(T("e|---0---3---|\nB|---1---0---|\nG|---0---0---|\nD|---2---0---|\nA|---3---2---|\nE|-------3---|").kind === "tab", "ASCII tab → tab");
expect(T("﻿ D|--0--2--|\n A|--2--0--|\n D|--2--2--|\n G|--0--2--|\n B|--3--3--|\n e|--2--3--|").kind === "tab", "Drop-D labelled tab with a BOM → tab");
expect(T("{title: X}\n[C]la [G]la").kind === "lyrics" && T("{title: X}\n[C]la [G]la").label === "a ChordPro file", "ChordPro → lyrics");
expect(T("     C        G\nThere is a house\n   Am   F\nIn New Orleans").label === "chords over lyrics", "chords over lyrics → lyrics");
expect(T("Amazing grace how sweet the sound\nThat saved a wretch like me").kind === "lyrics", "plain lyrics → lyrics");
expect(T('<?xml version="1.0"?>\n<!DOCTYPE score-partwise>\n<score-partwise version="4.0"></score-partwise>').kind === "score" && T("<?xml version=\"1.0\"?><svg></svg>").format === "xml", "MusicXML → score; other XML → unknown");
expect(T('\\title "Song"\n.\n0.6.4 2.5.4').format === "alphatex", "AlphaTex → score (alphatex)");
expect(T("12 34\n56").kind === "unknown", "a few numbers → unknown");

// ---- PDFs by their text
const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
const read = async (p) => { const doc = await pdfjs.getDocument({ data: bytes(p), isEvalSupported: false, verbosity: 0 }).promise; const s = []; for (let i = 1; i <= Math.min(2, doc.numPages); i++) for (const it of (await (await doc.getPage(i)).getTextContent()).items) s.push(it.str); return s; };
for (const f of ["Blue Sky - The Allman Brothers Band.pdf", "Kid Charlemagne - Steeley Dan.pdf", "Confirmation GP - Charlie Parker.pdf"]) {
  const c = E.classifyPdfText(await read(path.join(repo, f)));
  expect(c.route === "tab", `${f}: an alphaTab tab export → tab (${JSON.stringify(c)})`);
}
const readme = E.classifyPdfText(await read(path.join(repo, "FiguredBassMHGPLReadMe.pdf")));
expect(readme.route === "ask", `a document that is neither → ask (${JSON.stringify(readme)})`);
expect(E.classifyPdfText([]).route === "scan" && E.classifyPdfText(["", " "]).route === "scan", "no text layer → scan (OCR)");
expect(E.classifyPdfText("Cmaj7 Dm7 G7 Cmaj7 Am7 D7 Gm7 C7 Fmaj7 Bb7 Verse Chorus 1 2 3".split(" ")).route === "chords", "chord symbols, few numbers → chords (Scan reads the text layer)");
expect(E.classifyPdfText([...Array(60).fill("5"), ..."Cmaj7 Dm7 G7 Em7 A7 Bbmaj7 F#m7b5".split(" ")]).route === "ask", "tab AND chord symbols (an Ultimate Guitar notation + tab page) → ask");
expect(E.classifyPdfText(["A", "lyric", "line", "with", "words"]).route === "ask", "too little to tell → ask");

// ---- UI
const route = between("const routeFile = async (f) => {", "\n  };");
expect(/sniffFile\(bytes, f\.name\)/.test(route) && /classifyPdfText\(strs\)/.test(route) && /openPdfDocument\(bytes\.slice\(\)\)/.test(route), "routeFile sniffs the bytes and, for a PDF, its text (through the one PDF.js wrapper)");
expect(/kind\.kind === "score"\) \{ goTo\("xml"\); onXml\(\{ target: \{ files: \[f\]/.test(route) && /goTo\("audio"\); setAudioIncoming\(\{ bytes, name: f\.name, n: Date\.now\(\), fresh: true \}\)/.test(route), "scores go through the score loader, recordings to Audio (fresh = joins the library)");
expect(/kind\.kind === "image"\) \{ openAsScan\(f\)/.test(route) && /goTo\("manual"\); setTab\(textOf\(\)\)/.test(route) && /goTo\("lyrics"\); setLyricsIncoming/.test(route), "photos → Scan, tab text → Manual, lyrics → Lyrics");
expect(/c\.route === "tab"\) openAsTab\(f\)/.test(route) && /c\.route === "chords" \|\| c\.route === "scan"\) openAsScan\(f\)/.test(route) && /setPdfAsk\(\{ file: f, c \}\)/.test(route), "a PDF: tab → PDF Chart, chords / picture → Scan, otherwise ask");
expect(/const openAsTab = \(f\) => \{ goTo\("pdf"\); onFile\(\{ target: \{ files: \[f\], value: "" \} \}\); \};/.test(ui), "PDF Chart opens it through its own loader");
const open = between("function OpenView(", "\nfunction SubTabs(");
expect(/<input ref=\{pick\} type="file" data-open-input onChange=/.test(open) && !/data-open-input[^>]*accept=/.test(open), "one picker, NO accept filter (iOS greys out Guitar Pro files under one)");
expect(/onDrop=\{\(e\) => \{ e\.preventDefault\(\); setOver\(false\); take\(e\.dataTransfer && e\.dataTransfer\.files\); \}\}/.test(open) && /data-drop-zone/.test(open), "drag-and-drop routes like the picker");
expect(/role="status" aria-live="polite" data-open-msg/.test(open) && /data-pdf-ask/.test(open) && /Read the tab \(fret numbers\)/.test(open) && /Read the chord symbols/.test(open), "a live status line; the PDF question with both answers");
expect(/Or choose what it is/.test(open) && /role="tablist" aria-label="Ways in"/.test(open), "the cards stay as the override (paste tab, live lyrics)");
expect(/function ScanPanel\(\{ C, useSharp, pdfReady, incoming \}\)/.test(ui) && /onFileRef\.current\(\{ target: \{ files: \[incoming\.file\]/.test(ui), "Scan takes a dropped file through its own loader");
expect(/function LyricsImport\(\{ C, incoming \}\)/.test(ui) && /setRaw\(incoming\.text\)/.test(ui), "Lyrics takes a dropped sheet");
expect(/audioIncoming\.fresh \|\| audioIncoming\.name !== f\.name\) rememberProject/.test(ui), "a dropped recording joins the library (a library re-open doesn't add it twice)");

fs.rmSync(enginePath, { force: true });
console.log(`open-router: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
