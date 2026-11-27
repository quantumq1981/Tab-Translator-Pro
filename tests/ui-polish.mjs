/* Redesign step 3 (2026-11-27): the chord sheet + the polish kit. Pure helpers (readChord, sectionKind, waveformPeaks)
 * are checked headlessly; the UI contract by source guards. The behaviour in a real browser (sheet opens from a tap,
 * drag / Escape close, focus trap, rename + Undo, playhead class, waveform seek, reduced motion, fonts) is
 * bench/sheet-e2e.mjs. */
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, "..");
globalThis.DOMParser = (await import("@xmldom/xmldom")).DOMParser;
const enginePath = path.join(here, ".engine.uipolish.mjs");
fs.writeFileSync(enginePath, fs.readFileSync(path.join(repo, "engine.tsx"), "utf8"));
const E = await import(enginePath + "?t=" + Date.now());
const ui = fs.readFileSync(path.join(repo, "TabDecoderPro.tsx"), "utf8");
const html = fs.readFileSync(path.join(repo, "index.html"), "utf8");
let passes = 0, failures = 0;
const expect = (c, m) => { if (c) passes++; else { failures++; console.log("FAIL:", m); } };
const between = (a, b) => { const i = ui.indexOf(a); return i < 0 ? "" : ui.slice(i, ui.indexOf(b, i + a.length)); };

// ---- readChord: the sheet's reading = the engine's recognise path
{
  const r = E.readChord([52, 60, 64, 67]);                          // E3 C4 E4 G4 → C/E
  expect(r && r.symbol === "C/E" && r.isSlash && r.bassName === "E" && r.rootName === "C", "C/E: symbol, slash, bass, root");
  expect(r.notes.map((n) => n.name + n.interval).join(" ") === "CR E3 G5" && r.notes.find((n) => n.bass).name === "E", "notes root first with intervals; the bass marked");
  expect(r.confidence === 1 && r.missing === 0 && r.extra === 0, "a complete triad is a 100 % match (Jaccard, not the ranking score)");
  expect(r.alternatives.length >= 1 && r.alternatives.every((a) => a.confidence > 0 && a.confidence < 1 && a.symbol !== r.symbol), "other readings listed, each below the winner");
  expect(r.scores[0].symbol === "C" && typeof r.scores[0].score === "number" && r.masks.chord === 145, "details: ranking scores + the pitch-class mask");
  const unsorted = E.readChord([67, 52, 64, 60]);
  expect(unsorted.symbol === "C/E" && unsorted.bassName === "E", "input order doesn't matter: the lowest note is the bass");
  const flat = E.readChord([58, 62, 65], { useSharp: false });
  expect(flat.symbol === "Bb" && flat.notes.map((n) => n.name).join(" ") === "Bb D F", "flat spelling honoured");
  const one = E.readChord([40]);
  expect(one.single && one.symbol === "E" && one.confidence == null && one.alternatives.length === 0 && one.notes[0].interval == null, "a single note: bare name, no quality, no match %");
  expect(E.readChord([]) === null && E.readChord(null) === null && E.readChord([NaN]) === null, "empty / bad input → null, no throw");
  const sev = E.readChord([48, 52, 55, 58]);
  expect(sev.symbol === "C7" && sev.notes.map((n) => n.interval).join(" ") === "R 3 5 ♭7", "C7: ♭7 named");
  // the Manual readout and the sheet read the same voicing the same way
  const norm = E.normalise([48, 52, 55, 59].map((m) => ({ midi: m, name: E.NOTE_SHARP[m % 12] })));
  expect(E.symbolOf(E.recognise(norm.chroma, norm.chordMask, norm.bassPc), true) === E.readChord([48, 52, 55, 59]).symbol, "same reading as the Manual readout's recognise call");
}

// ---- sectionKind: colour bands
{
  const k = (s) => E.sectionKind(s);
  expect(k("Verse 1") === "verse" && k("Verse 2") === "verse" && k("CHORUS") === "chorus" && k("Pre-Chorus") === "pre" && k("Bridge") === "bridge", "named sections; numbered repeats share a kind");
  expect(k("Intro") === "intro" && k("Outro") === "outro" && k("Coda") === "outro" && k("Guitar Solo") === "other" && k("Solo") === "solo" && k("Instrumental") === "solo", "intro / outro / solo");
  expect(k("A") === "verse" && k("B") === "chorus" && k("C") === "bridge" && k("[A]") === "verse" && k("A2") === "verse", "rehearsal letters A–C map to verse / chorus / bridge");
  expect(k("") === null && k(null) === null && k("Whatever") === "other", "empty → none, unknown → other");
  expect(E.SECTION_KINDS.length === 8 && ["intro", "verse", "pre", "chorus", "bridge", "solo", "outro", "other"].every((x) => E.SECTION_KINDS.includes(x)), "eight kinds");
}

// ---- waveformPeaks
{
  const p = E.waveformPeaks(new Float32Array([0, 0.5, -1, 0.25]), 2);
  expect(p.length === 2 && Math.abs(p[0] - 0.5) < 1e-6 && p[1] === 1, "peak |sample| per bucket, normalised to the loudest");
  expect(E.waveformPeaks(new Float32Array(10), 4).every((v) => v === 0), "silence → zeros, no NaN");
  expect(E.waveformPeaks([1], 3).length === 3 && E.waveformPeaks(null, 5).length === 5, "n > length and empty input are safe");
  const big = new Float32Array(16000 * 240); big[123456] = 0.8;
  const t0 = Date.now(); const q = E.waveformPeaks(big, 200);
  expect(q.length === 200 && Math.max(...q) === 1 && Date.now() - t0 < 500, "4 min at 16 kHz in < 0.5 s");
}

// ---- UI: the chord sheet
{
  const sheet = between("function ChordSheet(", "\n/* ---- ABC file naming");
  expect(sheet.length > 2000 && /<ChordSheet /.test(ui) && !/<ChordVoicingModal /.test(ui), "ChartPanel opens the ChordSheet (the modal it replaces is gone)");
  expect(/role="dialog" aria-modal="true"/.test(sheet) && /alignItems: "flex-end"/.test(sheet) && /borderRadius: "18px 18px 0 0"/.test(sheet), "a bottom sheet: modal dialog docked to the bottom edge");
  expect(/data-sheet-handle/.test(sheet) && /onPointerDown=\{onHandleDown\}/.test(sheet) && /touchAction: "none"/.test(sheet) && /d\.dy > 110 \|\| \(d\.dy > 30 && v > 0\.6\)/.test(sheet), "drag handle: a long drag or a flick closes, otherwise it springs back");
  expect(/e\.key === "Escape"/.test(sheet) && /e\.key !== "Tab"/.test(sheet) && /_focusables\(sheet\.current\)/.test(sheet) && /returnTo\.focus/.test(sheet) && /closeBtn\.current\.focus/.test(sheet), "Escape closes; Tab is trapped; focus goes in, then back to the chord");
  expect(/readChord\(_choiceMidis\(tapped\), \{ useSharp \}\)/.test(sheet) && /data-chord-reading/.test(sheet) && /Notes in this chord/.test(sheet) && /% match/.test(sheet), "the sheet shows the tapped chord's own notes and match");
  expect(/const tapped = !stack\.length && !walked \?/.test(sheet), "no 'notes in the chart' for a substitution or a walked-to chord");
  expect(/▶ Hear it/.test(sheet) && /✎ Change chord/.test(sheet) && /Could also be/.test(sheet) && /<details data-readout-details/.test(sheet), "Hear it, Change chord, other readings, Details");
  expect(/if \(e\.key === "Enter"\) \{ e\.preventDefault\(\); rename\(draftName\); \}/.test(sheet), "Enter in the name box is consumed (else its keypress clicks the chord the focus returns to and reopens the sheet)");
  expect(/showToast\(\{ text: `\$\{before\} → \$\{v\}`, action: \{ label: "Undo", fn: \(\) => onRename\(k, before, detected\) \}/.test(sheet), "a rename shows an Undo toast");
  expect(/onRename=\{\(k, sym, detected\) => setOverridesT\(/.test(ui) && /if \(!v \|\| v === detected\) delete n\[k\]/.test(ui), "renames go through the transposed overrides (an edit in the untransposed key, reverting to detected deletes it)");
  expect(/midis: e\.midis, key: k, detected: e\.symbol/.test(ui) && /midis: e\.midis, key: `\$\{bar\.number\}\.\$\{e\.beat\}`, detected: e\.symbol/.test(ui), "lead sheet + grid hand the sheet the notes and the override key");
  expect(/className="tdp-sheet"/.test(sheet) && /\.tdp-sheet\{animation:tdpSheetUp [^}]*backwards;\}/.test(ui), "sheet spring: entry animation, fill 'backwards' (no kept transform)");
  expect(/className=\{"tdp-cols" \+ \(mode === "manual" \? " manual" : " solo"\)\}/.test(ui) && /\.tdp-cols\.solo\{grid-template-columns:minmax\(0,1fr\);\}/.test(ui), "chart modes are one column (no side readout)");
}

// ---- UI: polish kit
{
  expect(/\.tdp-app\{-webkit-tap-highlight-color:transparent;\}/.test(ui) && /\.tdp-app button:not\(:disabled\):active\{transform:scale\(\.96\);\}/.test(ui), "tactile press: scale .96, no grey tap flash");
  expect(/className=\{isPlaying \? "tdp-now" : undefined\}/.test(ui) && /\.tdp-now::after\{[^}]*box-shadow/.test(ui) && /\.tdp-now > span:first-child\{animation:tdpBeat/.test(ui), "playhead glow + chord-change pulse on the sounding chord");
  expect(/const SECTION_COLORS = \{ intro:/.test(ui) && /if \(bar\.section\) secCol = sectionColor\(bar\.section\)/.test(ui) && /if \(bar\.section\) gridCol = sectionColor\(bar\.section\)/.test(ui), "section colour bands on the lead sheet and the grid");
  const wave = between("function WaveformScrubber(", "\nfunction SectionLabel");
  expect(/role="slider"/.test(wave) && /ArrowLeft/.test(wave) && /clipPath=\{`url\(#\$\{cid\}\)`\}/.test(wave) && /translateX/.test(wave), "waveform scrubber: slider role, keyboard seek, clipped played part, transform playhead");
  expect(/setPeaks\(waveformPeaks\(mono, 200\)\)/.test(ui) && (ui.match(/<WaveformScrubber /g) || []).length >= 2, "200 peaks computed once on load; the scrubber sits on the chords and notes players");
  const rm = /@media \(prefers-reduced-motion:reduce\)\{([\s\S]*?)\n        \}/.exec(ui);
  expect(rm && /animation-duration:\.001ms!important/.test(rm[1]) && /transition-duration:\.001ms!important/.test(rm[1]) && /:active\{transform:none;\}/.test(rm[1]), "everything moving switches off under prefers-reduced-motion");
  // compositor-only: the kit's keyframes animate transform / opacity, nothing that lays out
  const kf = [...ui.matchAll(/@keyframes (tdp\w+)\{([^@]*?)\}\}/g)].map((m) => m[2]);
  expect(kf.length >= 4 && kf.every((b) => !/(width|height|top|left|margin|padding)\s*:/.test(b)), "polish keyframes animate transform / opacity only");
}

// ---- UI: type
{
  expect(/const UI_FONT = "system-ui, -apple-system/.test(ui) && /const CHORD_FONT = "'Space Mono'/.test(ui) && /const MONO_FONT = "ui-monospace/.test(ui), "font tokens: system UI body, Space Mono chords, system monospace for aligned text");
  expect(!/IBM Plex/.test(ui.replace(/\/\*[\s\S]*?\*\//g, "")) && !/IBM\+Plex/.test(html) && /family=Space\+Mono:wght@400;700/.test(html), "IBM Plex Mono is gone from the app and from the font request; Space Mono stays");
  expect(/<div className="tdp-app" style=\{\{[^}]*fontFamily: UI_FONT/.test(ui), "the app root is the system UI font");
  expect(/height: 150, resize: "vertical"[^\n]*fontFamily: MONO_FONT/.test(ui), "the pasted-tab box keeps a monospace (columns line up)");
}

fs.rmSync(enginePath, { force: true });
console.log(`ui-polish: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
