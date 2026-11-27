/* UX-safety fixes (docs/UX-REVIEW-2026-11-26.md #1 #2 #3 #4 #14) — fast guards on the UI source. The behaviour itself is
 * checked in a real browser by bench/safety-e2e.mjs (28 checks); these keep the rails from being undone by an edit
 * that never runs that bench. */
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, "..");
const ui = fs.readFileSync(path.join(repo, "TabDecoderPro.tsx"), "utf8");
let passes = 0, failures = 0;
const expect = (c, m) => { if (c) passes++; else { failures++; console.log("FAIL:", m); } };
const between = (a, b) => { const i = ui.indexOf(a); return i < 0 ? "" : ui.slice(i, ui.indexOf(b, i + a.length)); };

// #1 chord edits are per chart; a tab tap clears only the selection
expect(/const \[ovStore, setOvStore\] = useState\(\{ pdf: \{\}, xml: \{\} \}\)/.test(ui) && /const overrides = ovStore\[ovKindOf\(mode\)\]/.test(ui), "#1 edits are kept per chart (pdf / xml)");
expect(/onClick=\{\(\) => \{ setMode\(m\); clearPick\(\); \}\}/.test(ui) && !/setMode\(m\); clearSel\(/.test(ui), "#1 a mode-tab tap clears the selection only, never the edits");
expect(/const clearPick = \(\) => \{ setSelFrets\(null\); setSelMidis\(null\); setSelKey\(""\); \};/.test(ui), "#1 clearPick touches no edits");
expect(!/\bclearSel\(\)/.test(ui), "#1 every clearSel names the chart it clears");
expect(/setOverridesFor\(ovKindOf\(meta\.kind\)/.test(ui), "#1 a restore puts the saved edits on the chart they belong to");

// #2 audio re-reads ask / wait when there are edits
const audio = ui.slice(ui.indexOf("function AudioImport"));
expect(/const guardRead = \(label, go\) => \{ if \(!chordEdits\) \{ go\(\); return; \} setPendingRead/.test(audio) && /const holdRead = /.test(audio), "#2 guardRead / holdRead exist");
expect(audio.indexOf("const [overrides, setOverrides] = useState({});") < audio.indexOf("const chordEdits = "), "#2 chordEdits is declared after overrides (a TDZ crash otherwise)");
expect(/const switchKind = \(k\) => guardRead\(/.test(audio) && /const toggleIsolate = \(\) => guardRead\(/.test(audio) && /const unlinkScore = \(\) => guardRead\(/.test(audio) && /guardRead\("Linking this score"/.test(audio), "#2 actions that re-read ask first");
expect(/holdRead\("Chord names changed"/.test(audio) && /holdRead\("Reading settings changed"/.test(audio) && /holdRead\("The score weight changed"/.test(audio), "#2 setting changes that re-read wait");
expect(!/onChange=\{\(v\) => \{ setVocab\(v\); setOverrides\(\{\}\)/.test(audio), "#2 the chord-names picker no longer wipes edits by itself");
expect(/data-pending-read/.test(audio) && /Keep my edits/.test(audio) && /previous reading/.test(audio), "#2 the bar says what is lost and offers Keep my edits");
expect(/setCuts\(\(n\) => n \+/.test(audio), "#2 deleted / merged chords count as edits");

// #3 readout empty outside Manual until a chord is tapped
expect(/mode !== "manual" && !\(selFrets \|\| selMidis\) \? \(\s*<div data-readout-empty/.test(ui), "#3 the readout is empty outside Manual until a chord is tapped");

// #4 a multi-part file opens on Harmony
const opened = between("async function parseOpenedScore", "\n}\n");
expect(/parseScoreOffThread\(bytes, filename, sharp, HARMONY_PART\)/.test(opened) && /mergedParts \|\| \[\]\)\.length >= 2/.test(opened), "#4 parseOpenedScore lands on Harmony only when it merges ≥ 2 parts");
expect((ui.match(/await parseOpenedScore\(/g) || []).length === 2, "#4 upload and decode handoff both use it (restore keeps the saved part)");
expect(/async function parseScoreOffThread\(bytes, filename, sharp, partIndex\)/.test(ui), "#4 the off-thread parse passes a part");

// #14 Start fresh with Undo
const fresh = between("const startFresh = () => {", "  const undoFresh");
expect(fresh && !/await clearSession\(\)/.test(fresh) && /setTimeout\(commitFresh, FRESH_UNDO_MS\)/.test(fresh), "#14 Start fresh clears the stored session only when the Undo window ends");
expect(/_lsSet\(FRESH_PENDING_KEY, "1"\)/.test(fresh) && /if \(_lsGet\(FRESH_PENDING_KEY\)\)/.test(ui), "#14 a reload inside the window finishes the clear (sync flag)");
expect(/if \(f\.gen === sessGen\.current\) clearSession\(\)/.test(ui), "#14 the delayed clear never deletes a session opened meanwhile");
const persist = between("const persistSession = async (bytes, filename) => {", "const gen = ++sessGen.current");
expect(/if \(freshRef\.current\) \{ clearTimeout\(freshRef\.current\.timer\); freshRef\.current = null; setFreshUndo\(false\); _lsSet\(FRESH_PENDING_KEY, null\); \}/.test(persist), "#14 saving a new file cancels a pending Start fresh and its launch flag (else a reload deletes the new file)");
expect(/const undoFresh = \(\) =>/.test(ui) && /onClick=\{undoFresh\}/.test(ui), "#14 Undo is offered");

console.log(`ux-safety: ${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
