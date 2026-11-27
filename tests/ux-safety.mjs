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
expect(/const pickWayIn = \(m\) => \{ setWorkChosen\(true\); setOpenView\(false\); if \(m !== mode\) \{ setMode\(m\); clearPick\(\); \} \};/.test(ui) && /if \(to\) \{ navSwitch\.current = true; setMode\(to\); clearPick\(\); \}/.test(ui) && !/setMode\([a-z]+\); clearSel\(/.test(ui), "#1 picking a way in / switching destination clears the selection only, never the edits (step 4)");
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
expect(/\{mode === "manual" && \(\s*<section[^>]*>\s*<SectionLabel C=\{C\}>LIVE READOUT<\/SectionLabel>/.test(ui) && !/CHORD READOUT/.test(ui), "#3 the readout column is Manual's only — a chart never shows the Manual chord (step 3: a tapped chord opens the chord sheet)");

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

// Redesign step 1 (2026-11-27): #10 #11 #12 #13 — the behaviour is checked in a real browser by bench/polish-e2e.mjs
expect(!/window\.(alert|confirm)\(/.test(ui.replace(/\/\*[\s\S]*?\*\//g, "")), "#13 no window.alert / window.confirm left in the UI");
expect(/function showToast\(t\)/.test(ui) && /function ToastHost\(\{ C \}\)/.test(ui) && /<ToastHost C=\{C\} \/>/.test(ui), "#13 toasts exist and the host is mounted once");
const host = between("function ToastHost", "\nfunction SectionLabel");
expect(/setList\(\(l\) => l\.filter/.test(host) && !/setList\(\(l\) => \{[^}]*onCommit/.test(host), "#13 a toast's side effects run outside the state updater");
expect(/onCommit: \(\) => _libSerial\(async \(\) => \{\s*await projectDel\(r\.id\)/.test(ui) && /action: \{ label: "Undo", fn: \(\) => hide\(r\.id, false\) \}/.test(ui), "#13 a library delete hides now and deletes only when the Undo toast ends");
expect(/onCommit: \(\) => _libSerial\(async \(\) => \{/.test(ui) && /const alive = \(await projectsAll\(\)\)/.test(ui) && /for \(const s of await setlistsAll\(\)\)/.test(ui) && !/sets0/.test(ui), "#13 a delete commit reads the current stores and runs serialized (no snapshot written back)");
expect(/if \(opts && opts\.ifEmpty && prev\) return prev;/.test(ui) && /setEdit\(\(cur\) => cur \|\| prev, \{ ifEmpty: true \}\)/.test(ui), "#13 Clear-edits Undo never overwrites edits made since (any chart)");
expect(/role="tablist" aria-label="Ways in"/.test(ui) && /role="tab" aria-selected=\{on\} aria-label=\{label\}/.test(ui) && /role="tablist" aria-label=\{label\}/.test(ui) && /aria-current=\{dest === d \? "page" : undefined\}/.test(ui), "#12 ways in + Listen tools are tablists; the bar marks the current destination (aria-current)");
expect(/role="tablist" aria-label="View"/.test(ui) && /role="tab" aria-selected=\{view === v\}/.test(ui), "#12 the chart view switch is a tablist");
expect(/button\[aria-pressed="true"\],\.tdp-app \[role="tab"\]\[aria-selected="true"\]\{text-decoration:underline/.test(ui), "#12 selected toggles and tabs are underlined, not marked by colour alone");
expect(/const inactiveToggle = \(C\) => \(\{ borderColor: C\.border/.test(ui) && !/\? activeToggle\(C\) : \{\}\)/.test(ui), "#16 a deselected toggle keeps its borderColor key (no white 'visited' border)");
expect(/\.tdp-app :focus-visible\{outline:2px solid/.test(ui), "#12 visible keyboard focus");
expect(/@media \(pointer:coarse\)\{\s*\.tdp-app button,\.tdp-app select[^{]*\{min-height:44px;\}/.test(ui), "#11 44 px touch targets on touch screens");
expect(/NOTES IN THIS CHORD/.test(ui) && /<details data-readout-details/.test(ui) && !/>CHROMA BITMASK/.test(ui), "#10 bit masks and scores sit behind Details");
expect(!/PATH [A-G](\/| ·)/.test(ui.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")), "#10 no developer path names in section labels");
expect(/<details><summary[^>]*>About the engine<\/summary>/.test(ui), "#10 the engine footer is folded");

// Redesign step 2 (2026-11-27): #5 #8 #9 #15 — checked in a real browser by bench/toolbar-e2e.mjs
const cp = between("function ChartPanel(", "\n/* ---- view layer");
const tbar = between('role="toolbar" aria-label="Chart"', '{panel === "settings" && (');
expect(/<div className="no-print tdp-chart-toolbar" style=\{\{ position: "sticky", top: 0/.test(cp) && /maxHeight: "min\(60vh, 560px\)", overflowY: "auto"/.test(cp) && /@media \(max-width:599px\)\{\.tdp-app \.tdp-chart-toolbar\{position:static!important;\}\}/.test(ui), "#5 the chart toolbar + its open panel are pinned from 600 px (scrolls with the page on a phone)");
expect(/⇪ Share/.test(tbar) && /⚙ Settings/.test(tbar) && !/doExport\(|setSimplify|setLevel|setArrange|ChordVocabPicker|KeyPicker|copyImage|doPrint|attachRef/.test(tbar), "#5 the toolbar holds only view / edit / transpose / play / Settings / Share");
expect(/aria-label="Chart settings"/.test(cp) && /CHORD NAMES/.test(cp) && /ARRANGEMENT/.test(cp) && /PRACTICE/.test(cp), "#5 the Settings panel groups chord names / arrangement / practice");
expect(/const settingsChanged = \[/.test(cp) && /⚙ Settings\{settingsChanged \?/.test(cp), "#5 the ⚙ button counts settings that differ from their defaults");
expect(/if \(e\.key === "Escape"\) setPanel\(null\)/.test(cp), "#5 Escape closes the open panel");
expect(/const SHARE_GROUPS = \[/.test(ui) && /"FOR NOTATION APPS"/.test(ui) && /"AS TEXT"/.test(ui) && /advanced: true/.test(ui), "#9 Share groups exports by use, Advanced collapsed");
expect(/doExport\(f\); setPanel\(null\)/.test(cp) && /data-export-anchor/.test(cp), "#9 choosing an export closes the menu and scrolls to it");
expect(/function HowItWorks\(\{ C, folded, children \}\)/.test(ui) && /<HowItWorks C=\{C\} folded=\{!!\(xmlScore \|\| texDoc\)\}>/.test(ui) && /<HowItWorks C=\{C\} folded=\{!!scoreView\}>/.test(ui), "#8 the panel prose folds once a chart is open");
const lead = between("function LeadSheetView", "\nfunction "), grid = between("function GridView", "\nfunction ");
expect(lead && grid && !/maxHeight: 420, overflow: "auto"/.test(lead + grid), "#15 the lead sheet and grid flow in the page (no inner scroll box)");

console.log(`ux-safety: ${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
