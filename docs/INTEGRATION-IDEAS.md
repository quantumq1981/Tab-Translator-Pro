# Tab Translator Pro — Integration Ideas & Ecosystem Analysis

**Date:** 2026-06-11
**Status:** Item 1 (CSMPN export) and item 2 (one-tap handoff to CSMP) are **shipped**
(see `CLAUDE.md` → "Integration"). Everything below item 2 is **analysis / roadmap** —
ranked by value-to-effort, with the concrete hook points already identified.

---

## The three apps, and where each one wins

| App | Role | Superpower |
|---|---|---|
| **Tab Translator Pro** (this repo) | **Recognition front-end** | Turns *fingerings* (ASCII tab, digital PDF, Guitar Pro GP3–GP8/GPX, Power Tab, MusicXML) into **chord symbols** with confidence scoring, key analysis, transpose, and playback. The only app in the trio that *reads frets and infers harmony*. |
| **Chord Sheet Maker Pro** (CSMP) | **Finishing app** | Native **CSMPN** fake-book authoring: slash-rhythm engine, `{tab}`/`{hybrid}` blocks, chord diagrams, print/PDF, setlists, backup, audio. iOS-first. The place a chart becomes a *gig-ready page*. |
| **Chord Sheet Maker** (workbench) | **Converter / normalizer** | OSMD + AlphaTab in-browser rendering, MusicXML↔ChordPro engine, OMR backend hook, transpose/enharmonic lab. The place parsing logic is *matured* before it feeds Pro. |

**Key enabling fact:** all three deploy to the **same GitHub Pages origin**
(`quantumq1981.github.io/<repo>`), so they **share `localStorage`**. That is what
makes a zero-backend, one-tap, lossless handoff possible. The handoff contract is
versioned and documented in `chord-sheet-maker/docs/HANDOFF-CONTRACT.md`.

---

## Shipped

### 1. CSMPN export (`scoreToCSMPN`)
Tab Translator now speaks CSMP's native language. A decoded score → a CSMPN
fake-book source (header + `- Chart` + pipe bars). Honours overrides, transpose,
♯/♭, key, tempo. (Details + invariants in `CLAUDE.md`.)

### 2. One-tap handoff → Chord Sheet Maker Pro (`sendToPro`)
The **→ Chord Sheet Maker Pro** button writes the v1 handoff envelope to
`localStorage["csm:handoff:v1"]` (CSMPN preferred; ChordPro + MusicXML fallbacks)
and navigates to `…/chord-sheet-maker-pro/?import=handoff`. CSMP's existing
receiver loads it. No file download, no copy/paste, no backend.

### 3. Round-trip the `{tab}` voicing block ✅ (2026-06-11)
`scoreToCSMPN` now emits a `{tab}` block: one `Chord: f,f,f,f,f,f` line per unique
chord that has a voicing, ordered **high-e→low-E**, `x` for muted strings
(`_csmpnVoicing` over `Event.frets`, first-seen wins). CSMP renders the **real
fingering read off the page** as a TAB staff + chord-diagram grid — not a generic
shape. Naturally suppressed after transpose (frets are dropped, so a wrong fingering
is never sent). Opt-out via `opts.tab:false`.

### 4. Scaffold a `{hybrid}` rhythm block from real onsets ✅ (2026-06-11)
`scoreToCSMPN` now emits a `{hybrid}` block: one `barN:` line per bar, each event
`pos:dur(chord)` (rests `pos:r dur`) from the decoder's true `qbeat`/`qdur`. Beat
position is in cumulative-quarter units (mirrors importGuitarPro's `_cumQToHybridPos`);
duration is floor-mapped to the gap (`_csmpnDurLetter`) so CSMP never drops an
overlapping event. CSMP's Slash-Rhythm View renders the **actual strum/comp rhythm**
instead of even slashes. Pairs with item 3 for a full hybrid guitar chart. Opt-out via
`opts.hybrid:false`. (Tuplet `tN` flags + dotted durations are the obvious next refinement —
the current floor-map approximates a dotted-half as a half.)

---

## Roadmap — ranked

### ★★ 5. Carry `Capo:` + tuning into the CSMPN header (low effort, blocked on a TODO)
CSMP parses `Capo:` (int or Roman) and renders a capo marker. Tab Translator's
MusicXML/GP/PTB paths read exact tuning and (for some) capo. Once the decoder
surfaces capo/tuning on the score object (a clean, already-noted future task —
"tuning detection"), `scoreToCSMPN` should emit `Capo: N`. Non-standard tunings
could go in a `; tuning: DADGAD` annotation line (CSMP treats `;`-lines as
comments, so it's lossless and non-breaking).

### ★★ 6. Reverse link — "Decode this tab" from CSMP / the workbench (med effort)
Right now the flow is one-way (decode → finish). A reverse button in CSMP or the
workbench that hands a `.gp`/`.gpx`/`.ptb`/PDF **back** to Tab Translator for
recognition closes the loop: a user importing a Guitar Pro file into CSMP could
tap "Re-recognise chords" to get Tab Translator's confidence-scored, key-aware
reading (often better than CSMP's inline fret-to-chord guess for dense/altered
voicings). Mechanism: same shared-origin pattern, a `ttp:handoff:v1` key Tab
Translator reads on load + `?decode=handoff`. (New contract, mirror of v1.)

### ★ 7. Multi-part → setlist (low value, med effort)
A multi-part GP/MusicXML file (Tab Translator already has a part picker) could
hand **each part** to CSMP as a separate setlist entry — e.g. "Rhythm Gtr",
"Lead", "Bass" charts of the same tune, batched into one CSMP setlist via the
existing setlist storage (`csmp_setlist_v1`). Niche but unique to the trio.

### ★ 8. Share the recognition engine as a module (refactor, strategic)
Tab Translator's `QUALITIES` + `symbolForMidis` + `analyzeKey` are the best
fret→chord + key engine in the ecosystem. CSMP's GP importer and the workbench
both have *weaker* inline fret-to-chord tables. Long-term, extracting the engine
to a tiny shared ES module (zero-dep, both apps already load plain JS modules)
would end the drift and give CSMP/workbench the same confidence-scored
recognition. This is the "do it once" play — but it's a refactor across three
repos, so it ranks last despite the architectural appeal.

---

## Guardrails (carried from all three CLAUDE.md files)

- **Zero new dependencies** in Tab Translator (single-file, CDN-transpiled).
- **Additive only** to CSMP's receiver — it already ships; never break PowerTab,
  slash notation, hybrid, fake-book, or the existing `chord-sheet-maker` sender.
- **Same-origin localStorage** is load-bearing: end-to-end testing must be on the
  deployed Pages sites (two local dev servers are different origins).
- **Versioned contract** (`:v1` / `v:1`): any schema break bumps both.
