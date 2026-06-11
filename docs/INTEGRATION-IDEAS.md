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

---

## Roadmap — ranked

### ★★★ 3. Round-trip the `{tab}` voicing block (high value, low effort)
Tab Translator **already has exact `frets` per event** (`Event.frets` — a
`{ engineStringIndex: fret }` map, kept for every non-transposed score). CSMP's
slash-rhythm engine renders `{tab}` fingering blocks → 6-line TAB staff **and**
chord-diagram grids (CSMP Sprint 8). So:

- Add a `{tab}` block to `scoreToCSMPN` output: one `Chord: f,f,f,f,f,f` line per
  *unique* chord that has a full voicing, high-e→low-E, `x` for muted strings.
- CSMP renders the actual fingering the tab used — not a generic shape. This is
  the single biggest fidelity win, because the decoder uniquely knows the real
  voicing (CSMP's GP importer guesses; Tab Translator *read it off the page*).
- **Hook points:** `scoreToCSMPN` (emit the block); `Event.frets` → CSMP voicing
  string `(5 - engIdx)`-ordered. Frets are dropped on transpose, so emit `{tab}`
  only when `semis === 0` (or re-derive from transposed MIDI on a fixed tuning).

### ★★★ 4. Scaffold a `{hybrid}` rhythm block from real onsets (high value, med effort)
The decoder knows **true rhythm** — every event carries `qbeat`/`qdur` (fractional,
unclamped). CSMP's Slash-Rhythm View renders `{hybrid}` blocks as *notated* rhythm
(beamed eighths, accents, rests) instead of even slashes. Today the handoff sends
even-slash bars; with this it would send the **actual strum/comp rhythm**.

- Map each event to a `beat:dur(chord)` token (`q/e/h/w` from `qdur`, beat from
  `qbeat`), exactly the CSMP `{hybrid}` grammar (`importPipeline.js`
  `parseHybridChartFromCSMPN`).
- Tuplets: the decoder already preserves triplet timing in `qdur`; CSMP supports a
  `tN` flag. Round 3-based groups cleanly.
- **Win:** a Guitar Pro rhythm-guitar part lands in CSMP as a *playable, notated
  rhythm chart*, not a chord grid. Pairs perfectly with item 3 (`{tab}` + rhythm =
  a full hybrid guitar chart).

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
