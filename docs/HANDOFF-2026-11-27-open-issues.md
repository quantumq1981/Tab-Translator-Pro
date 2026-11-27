# Handoff — open issues after the redesign (steps 1–5), 2026-11-27

Purpose: everything still failing or deliberately left open after the five redesign PRs (#162–#167), checked on
2026-11-27 so a separate session can pick each one up on its own. Each item has the evidence, how to reproduce it,
and where to start looking. Nothing here blocks merging step 5 (#167): none of these is caused by step 5.

## Status at a glance

| # | Item | Kind | Introduced by | Priority |
|---|------|------|---------------|----------|
| R1 | Printed chart header: `♩` prints as a wrong glyph; the PDF's text is split into letters | **Regression** | Step 3 (#165): the system-font switch | **Fixed 2026-11-27** (see R1) |
| P1 | `instruments-e2e`: the Beginner "capo 1 to play along" hint | Test failure | Before the redesign | **Fixed 2026-11-27** (bench) |
| P2 | `note-editor-e2e`: dragging a fret number up a string doesn't re-string the note | Test failure | Before the redesign | **Fixed 2026-11-27** (bench) |
| P3 | `tuning-e2e`: the "Use Drop D" button never appears | Test failure | Before the redesign | **Fixed 2026-11-27** (app: accessible names) |
| U1 | Deleting the open song from the Library: it comes back on the next launch | Behaviour | Before the redesign | **Fixed 2026-11-27** |
| U2 | Text sizes (UX review #11) | Open UX item | — | Low |
| U3 | `window.prompt` for rename / tags / new setlist (UX review #13) | Open UX item | — | Low |
| U4 | Emoji in the way-in names (UX review #16) | Open UX item | — | Low |
| U5 | Scan and Audio panels still open with long prose (UX review #8) | Open UX item | — | Low |

"Before the redesign" was verified by re-running the bench on commit `d64aac4` (main just before step 3; it already
had steps 1–2 — and the step-4 benches showed the same three failing on main before that). Same failure, same message.

**Correction.** The step-4 PR (#166) and the UX review's step-4 status said the `library-e2e` print failure "fails on
main too". That compared against main *after* step 3 had merged. On `d64aac4` (before step 3) the check passes. It is
a step-3 regression: R1 below.

## Things that are fine (checked this session)

- `npm test`: every suite passes (incl. the five new suites: ui-polish 45, nav-shell 27, open-router 39, plus updated
  ux-safety 45, chord-ocr 106).
- Browser benches that pass: sheet 42/42, nav 67/67, open 30/30, polish 44/44, safety 30/30, toolbar 36/36, voicings,
  quickwins, persistence (ALL OK), tab-view, lyrics, practice, cancel; library 10/11 (only R1).
- Every Codex review finding on #162–#167 was fixed and its thread resolved.

---

## R1 — Printed chart header: wrong `♩` glyph; PDF text split into letters  (REGRESSION, step 3)

**Status: FIXED (2026-11-27).** `library-e2e` 11/11. The real cause was narrower than the guess below: the
system-ui font here (Inter, an OpenType-CFF `.otf`) is embedded by Chromium as a **Type 3** font, which writes each glyph
on its own — pdf.js then reads letters with gaps. That hit every system-ui text on the page (chord names and diagram
finger numbers too, not only the header). Fix in `TabDecoderPro.tsx`: `PRINT_FONT` (`Helvetica, Arial, 'Liberation
Sans', 'DejaVu Sans', sans-serif` — TrueType faces; `'Helvetica Neue'` / `Roboto` were tried first and fontconfig aliased
them to Inter, so they are not listed) on the `PrintSheet` root, a print-only rule giving every inline system-ui text
(`style` and SVG `font-family` attributes) `PRINT_FONT`, and the `♩` in its own span with `PRINT_NOTE_FONT` (fonts that
have U+2669). The PDF now holds only CID TrueType fonts; pdf.js reads `blue-sky  key E · ♩ =100 · 2/4  Emaj9 …`
(the space after `♩` is pdf.js marking the font change; `pdftotext` reads `♩=100`). Screen typography is unchanged
(the rules are inside `@media print`). Guards: 4 static checks in `tests/ui-polish.mjs` (mutation-tested). Still to do:
print to PDF on an iPhone / iPad and check search + copy of the title.

**What happens.** Share → 🖨 Print / PDF. The page looks right except the header line: `key E · ♩=100 · 2/4` prints the
`♩` as an arrow-like fallback glyph. The PDF's text layer is split into letters, so searching or copying the title
from a saved PDF fails: pdf.js reads the title as `bl u e - s k y` and the header as `ke y E · ♩ 100 · 2/4`.

**Cause (high confidence).** Step 3 replaced the print sheet's font (`'IBM Plex Mono', monospace`) with the system UI
font (`PrintSheet` root `fontFamily: UI_FONT`, `TabDecoderPro.tsx`). The system sans has no `♩`, and Chromium writes
that font's text into the PDF glyph by glyph. With the old monospace stack, both were fine (verified: the same bench
passes on `d64aac4`).

**Reproduce.**
```sh
cd tests && node bench/library-e2e.mjs --deps <deps>/out --out /tmp/out
# FAIL print: the chart prints with its header and chords (no app chrome) {"pages":4,"head":"1 / 4  bl u e - s k y  ke y ..."}
pdftoppm -r 70 -f 1 -l 1 -png /tmp/out/print-chart.pdf /tmp/out/p   # look at the header line
```
(`<deps>` is built as in `tests/bench/README.md`: React + Babel served locally.)

**Where to start.** `function PrintSheet(` in `TabDecoderPro.tsx` (its root `style={{ … fontFamily: UI_FONT }}` and the
`mono` constant). Likely fix: give the print sheet `MONO_FONT` (system monospace, as on screen for aligned text), or at
least set the header line and the `♩` in `CHORD_FONT`. Then re-run `library-e2e` (expect 11/11). Check the PDF
visually on an iPhone / iPad too (Safari's print uses SF, which may have `♩`; the text layer is the real test).

---

## P1 — `instruments-e2e`: the Beginner "capo 1 to play along" hint  (before the redesign)

**Status: FIXED (2026-11-27) — the bench, not the app.** The first suspect was right: since UX review #4 a multi-part
file opens on **Harmony**. Anthropology's Harmony (and its Chords part) read **G minor** → Em shapes, **capo 3**; only the
melody part (Track 1, which the bench used to land on) reads **B♭** → A shapes, capo 1. G minor and B♭ share their notes,
so capo 3 plays along too. The bench now checks Harmony gives a capo hint, then picks Track 1 for the exact B♭ case (11/11).
**Found, not fixed (a key-model question, for the owner):** the key the chart SHOWS (`analyzeKeyCandidates` on the
Pro-named, simplified score) and the key the Beginner level uses (`analyzeKey` on the raw score, on purpose — see WO-4)
differ on 14 corpus files (Anthropology Harmony: shown F, level Gm; Cheryl: C vs Am; Take Five: Em vs E …), so the capo
hint can disagree with the key on screen. Options: make the level use the shown key (or the user's key, which it already
does), or show the level's key. Not changed here.

**What happens.** Peg.gp4 → ⚙ Settings → Level: **Beginner**. The chords become plain triads (that check passes),
but the text `capo 1 to play along` is not found. The test expects the chart to move to an open-chord key with
a capo hint (B♭ shapes → A shapes, capo 1).

**Evidence.** `FAIL …moved to an open-chord key with a capo hint to play along (B♭ → A shapes, capo 1)`, both on the
current branch and on `d64aac4`. The other 9 checks pass.

**Where to start.** The hint renders at `{lvl && lvl.capo > 0 && <div …>Capo {lvl.…` (search `to play along` near the
Settings panel in `ChartPanel`). Either `arrangementLevels(…, "beginner")` (engine) no longer returns `capo: 1` for
Peg, or the hint text changed and no longer says "capo 1 to play along". Check which one: run
`arrangementLevels(score, "beginner")` on Peg headlessly. Its key is read from the ORIGINAL score (see CLAUDE.md WO-4),
and Peg's key reading changed when the Harmony part became the default (UX review #4). That is the first suspect.
Decide whether the test or the app is wrong.

**Reproduce.** `cd tests && node bench/instruments-e2e.mjs --deps <deps>/out --out /tmp/out`

---

## P2 — `note-editor-e2e`: dragging a fret number up a string doesn't re-string the note  (before the redesign)

**Status: FIXED (2026-11-27) — the bench, not the app.** The bench took "string lines" from every `svg line[x1='0']`,
which now includes two lines above the tab grid, so its "G or D string" index landed on the B string; the fret it grabbed
was an open B (`0`), which no fret on the high E can play — the app correctly refused the move (the "2 notes moved" was
the previous step's summary). The bench now uses the tab grid's last six string lines and picks a fret ≥ 5 on G/D, so the
same pitch exists one string up. Every step passes (incl. undo/redo, the AlphaTex export, reload).

**What happens.** Notes view → tab grid → drag a fret number upward by one string. Expected status: "string changed".
Actual: `✓ 2 notes moved`, i.e. the drag was read as a time / pitch MOVE, not a string change.

**Evidence.** `FAIL: dragging a fret number up a string re-strings the note { s3: '✓ 2 notes moved', before: '0' }`
on both builds. The bench picks a fret label (`svg text[font-size='11']`) near string line 2–3 and drags it 17 px up.
Two notes moved, not one, so the selection probably held two notes, or the drag hit the roll instead of the tab grid.

**Where to start.** `NoteEditorView` in `TabDecoderPro.tsx` (WO-1): the tab-grid pointer handlers and how a vertical
drag is classified (string vs pitch vs time). Check whether the bench's fret pick still lands on the tab grid at the
current layout (the 44 px touch rules from step 1 may have shifted rows). Use `--out` screenshots; then fix the
classifier or the bench.

**Reproduce.** `cd tests && node bench/note-editor-e2e.mjs --deps <deps>/out --out /tmp/out`

---

## P3 — `tuning-e2e`: the "Use Drop D" button never appears  (before the redesign)

**Status: FIXED (2026-11-27) — in the app.** WO-7 relabelled the button "Apply", and the capo suggestion beside it is also
"Apply" — two identical names for a screen reader. Both keep "Apply" on screen and gain accessible names: `Use Drop D`
(`Use ${gtrSuggest.label}`) and `Use capo N`. The bench now runs to the end, every check passing (Drop D export, capo 2,
back to 0). Guarded in `tests/ui-polish.mjs`.

**What happens.** A Drop-D take through 🎸 Guitar → Tab (stubbed model). The suggestion line appears and names Drop D,
the tab stays standard, and the export says the low Ds are unplayable (all ✓). Then the test waits for a **button named
"Use Drop D"**, which never appears (timeout).

**Evidence.** `waiting for getByRole('button', { name: 'Use Drop D' })` → `TimeoutError` on both builds.

**Where to start.** The suggestion line in `AudioImport` (search `sit below standard tuning's low E`). Its action button
is probably labelled differently now ("Use it", "Apply", or the tuning name in a select), or it was moved. Align the
label with the bench, or the bench with the label, then run the rest of the bench, which never got past this point.

**Reproduce.** `cd tests && node bench/tuning-e2e.mjs --deps <deps>/out --out /tmp/out`

---

## U1 — Deleting the open song from the Library brings it back on the next launch

**Status: FIXED (2026-11-27).** Two ways back, not one: (1) any edit to the still-open chart ran its debounced project
save, which `projectPut` the deleted record again within a second; (2) on the next launch the session restore re-added
the file (`rememberProject`). Now the delete's commit calls `onProjectDeleted` (`LibraryPanel` → `onDeleted`): if it is
the open song (or its session file), the pending save is dropped, `projRef` is cleared and the file's hash is kept in
`ttp:lib:detached`; restore skips `rememberProject` for that hash. The chart stays open and keeps restoring as a session;
opening the file again on purpose (`rememberProject` from an upload) clears the mark and it rejoins the library.
`bench/library-delete-e2e.mjs` (new): on main it fails 3 of 8 (after an edit, after a reload, after a second launch);
with the fix 8/8. `library-e2e` 11/11, `persistence-e2e` ALL OK. Guarded in `tests/ui-polish.mjs`.

Found while testing step 1. Delete the song that is currently open → it leaves the library (verified in IndexedDB),
but the open chart's saved session re-adds it on the next launch. Fix: deleting the open project should also clear
(or detach) the session, or restore should not re-add a project the user deleted. `LibraryPanel` delete → `onCommit`,
and the session restore path that calls `rememberProject`.

## U2–U5 — UX review items left open by design

From `docs/UX-REVIEW-2026-11-26.md`:
- **#11 text sizes:** controls meet 44 px but text sizes are unchanged (many 10–12 px labels). The review proposes a
  6-step type scale (`--t-xs` 12 px minimum).
- **#13 `window.prompt`:** rename, tags and new setlist still use native prompts (alert / confirm are gone). Replace with
  an inline field or a small sheet.
- **#16 emoji in names:** the way-in cards still say "Audio 🎵", "Scan 📷", "Lyrics 🎙️" (kept so links / tests find them).
  Renaming means updating the benches that click them by name (`getByRole("tab", { name: "Audio 🎵" })`, ~20 files).
- **#8 instructions before action:** the score and tab-PDF panels fold their prose into "How it works"; Scan and Audio
  still open with a paragraph above the upload.

## Device checks still to do (real iPhone + iPad)

- Step 3: drag-to-close and the spring of the chord sheet; the system font in Safari; the sheet in phone landscape.
- Step 4: the bottom bar above the home indicator (safe area, blur); the left rail + chord inspector on iPad landscape;
  rotating the iPad with a chord open.
- Step 5: the iOS Files picker with each kind of file; drag-and-drop from Files on iPad; a real Ultimate Guitar PDF
  (notation + tab + chord symbols) should ask "read the tab or the chord symbols?".

## Benches not run in this session

They need ML models, network hosts this container blocks, or input files that aren't in the repo, and the redesign
didn't touch their code paths. They do go through the new Open / bar, though, so run them once after merging:
`guitar-e2e`, `scnet-e2e`, `split-mem-e2e`, `tempo-e2e`, `parts-e2e`, `drum-model-e2e`, `drums-e2e`,
`drum-audio-e2e` (needs `--wav`), `reading-e2e`, `techniques-e2e`, `vocab-e2e`, `link-e2e`, `scoretab-e2e`,
`scorelyrics-e2e`, `scan-e2e`, `scan-pdf-e2e`, `deployed-e2e`, `load-e2e`, `muscriptor-e2e` (ran, no failure printed).
Note for any of them: since step 4 a bench that switches mode mid-test must go through the bar first
(`.tdp-nav button[data-dest="open"|"listen"|"library"]`). The first click after load needs no change: the app opens on
Open, where the way-in cards are.
