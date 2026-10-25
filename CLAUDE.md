# CLAUDE.md — Tab Decoder · TabTranslator Pro

Handoff notes for Claude Code. Read this before touching the engine. The rules
below are **invariants** — they were each arrived at by catching a real bug or
validating against a real file. Treat them as load-bearing; do not “simplify”
them away without re-running the validation described at the bottom.

---

## 🎸 The Chord Sheet Maker Pro App Family

These three repositories are **one product family** — a music-chart pipeline that
shares a common GitHub Pages origin (`quantumq1981.github.io`), a versioned
same-origin `localStorage` handoff contract, and **CSMPN** as its lingua franca.
The family is **recognize → normalize → finish**:

| Repo | Role in the family | Stage |
|------|--------------------|-------|
| **Tab-Translator-Pro** | Recognition front-end — decodes tab / PDF / Guitar Pro (3–8 / GPX) / Power Tab / MusicXML into chord charts; exports CSMPN, CSML, ChordPro, ABC, MusicXML. | **Recognize** |
| **chord-sheet-maker** | MusicXML normalizer & converter workbench — OSMD/AlphaTab in-browser rendering, MusicXML / MXL / Guitar Pro → ChordPro / CSMPN. The lab where parsing matures. | **Normalize** |
| **chord-sheet-maker-pro** | The finishing app — fake-book layout, Slash-Rhythm View, audio playback, print/PDF, setlists; native CSMPN + ChordSlashML authoring. The stage. | **Finish** |

**Shared rails:**
- **CSMPN** (Chord Sheet Maker Pro Notation) is the canonical interchange text; ChordPro / MusicXML / CSML ride alongside.
- **Same-origin localStorage handoff** — forward `csm:handoff:v1` (→ Pro, `?import=handoff`) and reverse `ttp:decode:v1` (→ Tab Translator, `?import=decode`). Versioned; any same-origin sender interoperable. Canonical spec: `chord-sheet-maker/docs/HANDOFF-CONTRACT.md`.
- All three are **client-side, iOS-Safari-first, zero-server** static web apps on GitHub Pages.

**This repo is the family's recognition front-end (the "recognize" stage).**

---

-----

## What this is

A zero-build React prototype (default export, no repo deps, inline styles) that
turns guitar tablature into chord symbols. Two modes:

- **Manual** — paste an ASCII tab slice → analyse one chord block.
- **PDF Chart (Path A)** — upload a *digital* tab PDF → reconstruct a
  one-chord-per-bar chart.

The recognition engine is shared by both modes. There is exactly one code path
from “frets on strings” → “chord symbol”; keep it that way.

### Source layout (since 2026-06-20 — Roadmap Wave 1 #1)

The app is now **two files**, split along the seam that already existed:

- **`engine.tsx`** — the **pure recognition engine** (everything from `makeMask`
  through `playScore`: chord DB, all parsers Paths A–G, scorers, exporters, key
  analysis, transpose, playback scheduler). **Zero React, zero browser globals.**
  It ends with a single `export { … }` block listing **every** top-level binding,
  so the UI, the headless tests, and the future parse Web Worker all import the
  ONE engine (single source of truth, no copy, no drift).
- **`TabDecoderPro.tsx`** — the **React UI** (`default export`), plus
  `extractTokens` (the only browser-only seam: `window.pdfjsLib`). It does
  `import { … } from "./engine.tsx"` — importing the *full* engine surface, so
  every call site resolves exactly as when this was one file.

**`index.html` (zero-build loader):** fetches both files, Babel-transpiles each
in-browser, publishes the engine at a Blob URL, and rewrites the UI's
`from "./engine.tsx"` to that URL before transpiling the UI. App **boot** is the
one thing not headlessly testable (same category as the PDF.js worker glue) —
smoke-test on hardware after touching the loader. `npm test` statically guards
the contract boot depends on: every imported name is exported, the engine stays
React-free, the UI doesn't re-define engine internals, and the loader wires the
two files. `.txt` mirrors (`engine.txt`, `TabDecoderPro.txt`) track each source.

**Invariant:** keep `engine.tsx` plain ES (no TS syntax, no JSX, no React/DOM) —
that purity is what lets Node import it verbatim and lets it run in a Worker.

### Session persistence (since 2026-06-20 — Roadmap Wave 1 #2)

The app is a **persistent workspace**: close the tab, reopen, your chart + edits
are back. Lives entirely in `TabDecoderPro.tsx` (browser-only; `engine.tsx` stays
pure — guarded by a test).

- **What's cached:** the uploaded file's **raw bytes** (OPFS file `session.bin`
  via `navigator.storage.getDirectory()` — quota-free; falls back to a base64
  `localStorage` blob for files ≤ 3 MB when OPFS/`createWritable` is unavailable,
  e.g. older Safari) + a small **meta JSON** in `localStorage["ttp:session:v1"]`
  (`{ v, kind:"pdf"|"xml", filename, useSharp, overrides, partIndex }`).
- **Restore = re-parse, not re-serialise.** On mount (unless an `?import=`
  handoff/decode is present — those win) we re-run the **same validated parser
  paths** the file inputs use (PDF gated on `pdfReady`), then re-apply the saved
  spelling/part/overrides. Score objects carry non-JSON re-parse state
  (`_gpbuf`/`_gpxbuf`/`_ptbbuf`/id-maps) the ♯♭ + part-switch need, so re-parsing
  from bytes restores **full fidelity** for free. The Wave 1 #3 worker will make
  that re-parse non-blocking. (Future: cache the score JSON too for instant paint.)
- **Safety rails (mirror the decode receiver):** OPFS feature-detected; all I/O in
  `try/catch` so a stale/garbage cache can never wedge boot; restore is one-shot
  (`restoreRef`); a `restoringRef` suppresses transient meta writes mid-restore so
  the cleared-then-restored `overrides` can't briefly overwrite the saved copy.
  A **"↺ Restored… / Start fresh"** banner clears the cache + resets state.
- **Not yet persisted:** the Manual-tab textarea, and transpose (lives as local
  `semis` in `ChartPanel`; lift it in Wave 2 #6 view-decoupling, then persist).

### Headless transpile guard (test infra, 2026-06-20)

`npm test` now also **Babel-transpiles `engine.tsx` and `TabDecoderPro.tsx`** with
the exact presets `index.html` uses (`@babel/standalone`, a TEST-only dep) — so a
syntax/JSX error in the otherwise browser-only UI can't ship green. Plus static
contract guards for the module split (every import is exported, engine stays
React-free / persistence-free) and the persistence rails (feature-detect,
try/catch, localStorage fallback, one-shot restore).

### Parse Web Worker (since 2026-06-20 — Roadmap Wave 1 #2 → #3)

Dense binary parsers (`parseGP345`/`parsePowerTab`) are pure-JS byte loops that
can block the main thread for 100s of ms — noticeable jank on mobile Safari. They
now run **off-thread** in a module Worker that imports the **same** transpiled
engine the UI uses (the loader publishes it at a Blob URL, `window.__TTP_ENGINE_URL__`)
— one engine, no copy, no drift. Lives in `TabDecoderPro.tsx` (browser-only glue;
`engine.tsx` stays pure).

- **RPC:** `_engineRPC(fn, args)` posts `{id, fn, args}` to the worker, which does
  `E[fn](...args)` and posts the result back. `parseScoreOffThread(bytes, …)` is
  the entry the upload/decode/restore sites call. The returned score is
  structured-cloneable (plain fields + `_xml` string / `_gpbuf`/`_gpxbuf`/`_ptbbuf`
  Uint8Array — verified no DOM nodes / functions leak onto it).
- **HONEST LIMIT — only DOMParser-free formats run in the worker.** `DOMParser` is
  **window-only** (absent in Workers), so the XML paths (MusicXML, GP6/7/8 gpif)
  stay main-thread; routing (`_workerableBytes`) sends only **GP3/4/5**
  (`FICHIER GUITAR PRO`) and **Power Tab** (`ptab`) off-thread. The browser's native
  XML parser is fast C++, so the main-thread XML paths aren't the jank source. A
  future option is a tiny worker-side XML shim to cover gpif too.
- **PROGRESSIVE ENHANCEMENT:** every off-thread call **falls back to the identical
  main-thread engine call** if the worker is missing/errors, so correctness NEVER
  depends on the worker — it is pure offloading. This RPC infra is also the home
  for the Wave 3 ONNX classifier. Browser-only — smoke-test on hardware. `npm test`
  statically guards the rails (loader publishes the URL; module worker; routing
  gated to binary formats; main-thread fallback present).
- **Not yet off-thread:** `_reparseScore` (♯♭ / part-switch) stays synchronous on
  the main thread to preserve the functional-`setState` updater pattern; route it
  through the worker in a follow-on once view-decoupling (Wave 2 #6) lifts that state.

-----

## Invariant 1 — Chord masks are DERIVED, never hardcoded

Every chord quality is defined by an **interval array**, and its 12-bit
pitch-class bitmask is computed by `makeMask([0,4,7,10])`. Do **not** write
binary literals for chord masks.

Why this is a rule, not a preference: the original spec hardcoded literals that
disagreed with their own interval comments. It labelled `0b000010010101` as
“0,4,7,10” but that value actually decodes to `{0,2,4,7}`. Dom7, m7, maj7 and
sus4 were all wrong. Deriving from intervals makes the interval array the single
source of truth and makes that class of bug impossible.

`QUALITIES` is the chord DB. Each entry: `{ name, suffix, intervals, rank, mask }`
where `mask` is auto-filled via `.map(q => ({...q, mask: makeMask(q.intervals)}))`.

**Expanding `QUALITIES` is additive but touches recognition OUTPUT — the validated
corpus is the guardrail.** The triads/7ths/sus/6 set was extended (2026-06-20) with
the common jazz qualities **`add9 · m(maj7) · 6/9 · 9 · m9 · maj9 · 7♭9 · 7♯9`**, each
at a **high `rank`** (uncommon → never wins a ranking *tie* over a plainer chord; it
only wins when it fits genuinely MORE of the voicing, since `score = inter − 0.8·extra
− 1.2·missing`). The rule for any future addition: **every existing test progression
must stay byte-identical** (Blue Sky/Peg/Anthropology/Yardbird/… all did) AND add a
positive test for the new quality's canonical voicing + a guard that the plainer chord
isn't over-labelled. Note an enharmonic gotcha the tests encode: a major-6 voicing
`{C,E,G,A}` is the same pitch-set as `Am7` and `m7` (rank 3) out-ranks `6` (rank 9), so
it reads as **`Am7/C`** — long-standing, not a bug.

## Invariant 2 — String mapping is POSITIONAL, never by label

Tab string indices run **0 = lowest-pitched string** (low E) through
**5 = highest** (high e), matching the tuning arrays in `TUNINGS`.

- **Manual parser**: maps the *top text line* to the highest string by row
  position, NOT by the letter at the start of the line. This is deliberate:
  Drop-D tabs label the bottom row “D”, and letter-mapping would collide with
  the high-E “e” row. Position is unambiguous; letters are not.
- **PDF parser**: assigns each fret digit to a string by its y-coordinate
  within the staff: `stringFromTop = round((y - topY) / spacing)`, then
  `engineIndex = 5 - stringFromTop`. Muted strings simply have no digit at that
  x — the positional approach handles that for free (do not infer strings by
  counting digits; chords legitimately have 4, 5, or 6 notes).

## Invariant 3 — Ranking score ≠ displayed confidence

Two different numbers, on purpose:

- **Ranking** (which chord wins): `score = inter − 0.8·extra − 1.2·missing`.
  Asymmetric weights from the spec — a missing chord tone is penalised harder
  than an extra one. Used only to sort candidates. Ties broken by `rank`
  (lower = more common chord; prefer the common interpretation).
- **Confidence** (shown to the user): Jaccard ratio
  `inter / (inter + extra + missing)`, bounded 0–1. This is the interpretable
  number. Example: Cmaj7 voiced with no 5th reads as 75% confidence “missing 1”
  — correct and informative. Do not display the raw ranking score as confidence;
  it isn’t bounded and reads as nonsense to a user.

## Invariant 4 — Slash detection

`isSlash = (winning root pc) !== (bass pc)`, where bass = pitch class of the
lowest-MIDI note in the voicing (before octave-folding). C/E, D/F# etc. depend
on this. Don’t fold the bass into the chroma set before grabbing it.

## Invariant 5 — Single-note blocks: bare name in the symbol, flag for the UI

A one-pitch-class block (a single note, not a chord) recognises as `{ single:true }`
and `symbolOf` returns the **bare note name** (`"E"`), NOT `"E (single)"`. The
single-note fact rides on the `result.single` **flag** only — the readout panel reads
it to suppress chord-quality details (`best = !result.single ? … : null`).

Why this is a rule: the `" (single)"` text was once baked into the symbol *string*, so
it flowed verbatim into **`e.symbol`** and out through **every** exporter
(`scoreToABC`/`scoreToMusicXML`/`scoreToCSMPN`) and the chart label as spurious noise —
e.g. ABC `"E (single)"[E,,]/2`. It is engine-generated, never a PDF token, so a
filter in `extractTokens` (a prior attempt) could never catch it. Fixing it at the
single source (`symbolOf`) cleans every consumer at once; do **not** re-introduce the
suffix into the string. Guarded by a `npm test` regression (single MIDI → `"E"`; no
`(single)` in any export; Blue Sky symbols unchanged).

-----

## Path A — PDF geometry assumptions (READ before editing the parser)

Path A targets **digital, text-layer tab PDFs**, specifically alphaTab output
(what chord-sheet-maker-pro exports). It was designed and validated against the
real coordinate dump of `Blue_Sky_-_The_Allman_Brothers_Band.pdf`.

Layout facts the parser relies on (verified, A3-scale alphaTab render):

- Fret numbers are real text (`ArialMT`), extractable with positions. **Not** a
  raster scan.
- PDF.js may also surface alphaTab text-layer artifacts such as `(single)`;
  `extractTokens` discards exact `(single)` tokens before integer extraction so
  they cannot be clustered into PDF-derived chord labels.
- Within a staff system the 6 string lines are **evenly spaced in y** (~6.9pt
  on the validation file). Top line = high e.
- Chords are **columns at distinct x** (~41pt apart on that file).
- Muted strings leave a gap (no token) — expected.
- Measure numbers sit on their **own row above each staff**, not on a string
  line. They are separated from the string body by a larger y-gap.

**All thresholds are derived RELATIVE to an estimated string spacing**
(`estimateSpacing`), so the parser is scale-invariant across different export
sizes. The relative factors (`lineGap = spacing·0.5`, `sysGap = spacing·2.2`,
`colGap = spacing·1.3`, `pad = spacing·0.7`) were tuned on real data — if you
change them, re-validate.

Pipeline (`buildChart`):

1. Extract integer text tokens with `(x, top-down y)`.
   (PDF.js gives y-up; we convert via `viewport.height − transform[5]`.)
1. Cluster y → string lines; group lines → staff systems (a run of **≥3 lines** —
   sparse melodic systems may only touch 3 strings; header/measure rows are single
   lines in their own group, so they don't slip through).
1. Per system, assign each note to a string (Invariant 2).
1. Cluster x → chord columns; map each column to a measure via the nearest
   measure-number row above. Spike-removal drops stray tokens (e.g. a tempo
   “100”) that aren’t real measure numbers.
1. Recognise each column (standard tuning assumed); collapse **consecutive
   identical symbols** within a bar → one-chord-per-bar where harmony is static.

Assumptions to keep in mind: **standard tuning** is assumed in PDF mode (alphaTab
tab carries no tuning we read yet — adding tuning detection is a clean future
task). One chord per bar unless the harmony changes mid-bar, in which case the
bar shows the sequence (e.g. `E A`).

### estimateSpacing — mode-of-gaps, scale-invariant (2026-07-31 fix)

**Two real-file bugs, one root cause.** A user's **Van Morrison – Wild Night** PDF read
"No tab measures detected · 0 bars · 0 systems" (it clearly has tab), and a **Confirmation
(UG Pro / Parker)** PDF rendered garbage in the wrong key (`E · Bm/D · B · Bm7/A · F# · D`,
"key Em" — should be F major: `F | Dm7 G7 | Cm7 F7 | Bb7 | …`). Both are 4× Guitar-Pro /
alphaTab exports (page 4209×2976pt) where the **true string-line spacing is ~37.5pt**.

The old `estimateSpacing` took the *median of the smaller half of gaps, capped `<20pt`*.
That cap is an absolute assumption that breaks at scale: Wild Night has **no** gap under
20pt → it fell back to `7` → every threshold ~10× too small → 0 systems. Confirmation had
a few sub-pixel/text-baseline noise gaps (0.6, 3.5) → the smaller-half median chased them
down to `~3.5` → mis-clustering → wrong chords/key.

**Fix:** `estimateSpacing` now returns the **modal gap** — cluster near-equal gaps (within
12%) and take the biggest cluster's median. A staff repeats its line spacing 5×(systems)
times, so it *dominates* the histogram; noise gaps and the large system/page gaps are rare.
Verified on the real files: the modal gap is **37.5 in both** (Wild ×12, Confirmation ×20).
After the fix: Wild Night → **78 bars** detected; Confirmation → the correct **F-major
changes** (`F | Dm7 G7 | Cm7 F7 | Bb7 | Am7 D7 | Gm7 C7 | F | Fmaj7 …`). It is **scale-
invariant** — recovers ~7pt on a 1× export (Blue Sky unchanged, 165 bars) and ~37.5pt at
4×. Guarded by three `npm test` assertions (1× / 4× / 4×-with-noise → the right spacing).

**Still partial (documented honest limits, not this bug):** a dense fingerstyle transcription
like Wild Night yields many chords per bar (Path A names what is *written*, per-bar); and
Confirmation captures ~17 of its systems (sparse/`high-e`-silent systems still hit the string-
anchoring limit below). The *recognition scale* — the reported defect — is now correct.

### Known limit — string anchoring fails when a system never plays the high e

`topY` (the high-e line) is anchored to the **highest digit row** in a system.
That is correct *only when the system actually plays the high-e string*. When a
sparse system leaves the top string(s) silent, `topY` latches onto a lower
string and **every note shifts up by one (or more) strings**, so the chords for
that system come out wrong.

This was investigated exhaustively against the **Kid Charlemagne** Rhythm-Guitar
PDF (2026-06-10 session). Ground truth, read off a high-zoom render of the staff:
bars 26–32 (a system that doesn't play the high e) should be **C7** (`{B♭,E,C}`,
the dominant) but the parser emits **Fm7** — off by exactly one string. It is a
real bug, but it is **not reliably auto-fixable from the PDF layers**, and here is
the concrete proof so nobody re-derives it: the first system (bars 1–7, *correctly*
anchored, shift 0) and the bars 26–32 system (shift 1) have **near-identical
geometric signatures** — notation→digit offsets of 52.6pt vs 53.3pt. Any rule that
shifts the second would also shift the first, turning *correct* chords wrong. The
system-pitch grid has ±5pt residuals (enough to spuriously flip a string), the
notation→tab offset is not constant across systems, and the actual TAB staff
lines (filled rects via `getOperatorList`) extract inconsistently (drawn per
measure, top lines often dropped). The only signal that disambiguates sys0 from
sys5 is **visually counting the rendered staff lines = OMR = Path B (out of
scope)**. Do not bolt an anchor-guesser onto this parser — it risks regressing the
validated Blue Sky output for no reliable gain. The honest fixes are **MusicXML
import** (exact `<string>`/`<staff-tuning>`, no geometry) or in-app **Edit**.

**THE FIX IS MANUAL (shipped 2026-08-02, Roadmap Wave 2 #7).** `buildChart(tokens,
{ systemShifts })` takes a per-system correction keyed by GLOBAL system index; the value
is added to the engine string index (0 = low E … 5 = high e), so **−1 moves that system's
notes toward the bass**. Absent/0 is a strict no-op (Blue Sky is byte-identical with no
opts, `{}`, and explicit zeros). `buildChart` also now returns `systems: [{ index, page,
shift, measures, firstMeasure, lastMeasure }]` so the UI can label a control with the bars
the player can actually find on the page (`StringShiftPanel` in TabDecoderPro.tsx —
"⌥ Fix string alignment"; shifts persist in the session meta and re-apply on restore).

**Validated against real ground truth, which is why this is trustworthy:** the Kid
Charlemagne PDF reads bars 27–28 as `Fm7`; the `.gp3` says `C7`; shift −1 on that one
system recovers `C7`/`C7` exactly, and bar 26 recovers its real `Ebdim/A G Fdim/B Bb`.

**Per-system, not global, is load-bearing** — the measurement proves it: system 5
(bars 26–28) is mis-anchored, but system 6 (bars 29–32) is ALREADY CORRECT at shift 0
(`Am/C`, `Em/B`, `D7sus4/A` all match the `.gp3`) and shift −1 breaks it. A global shift
would trade one broken system for another. (Note this also refines the old "bars 26–32"
claim above: only 26–28 are actually mis-anchored.) Guarded by tests that fail if the
shift is ignored OR made global.

Related: the captured chords for a sparse rhythm-guitar part are inherently
*partial* (e.g. a 3-string strum `5,5,5` on e/B/G reads as `Am/C`) — that is
faithful to what's notated, not a bug. And measures where the part rests carry no
fret tokens, so they are correctly omitted from the chart (the chart shows only
bars where this one instrument plays — it is **not** a full-song chord chart).

## Score model — chords placed on beats (`buildScore`)

`buildChart` is geometry (where chords are on the page). `buildScore(chart,
useSharp)` turns that into a **lead-sheet-shaped score**: per bar, a list of
`{ symbol, beat, durBeats, frets }` events. This is what the in-app **Chart**
view (lead sheet) renders, and the foundation for any future export
(MusicXML / ABC / ChordPro).

How beats are derived (the keystone that makes "place chords over a measure"
work): `buildChart` now also records each bar's **horizontal extent**
(`startX` = its measure-number mark x, `endX` = next mark's x, last bar → system
right edge). `buildScore` collapses consecutive identical symbols to onsets,
then quantises each onset: `beat = round((x − startX) / (endX − startX) ·
beatsPerBar)`. **Invariants:** the bar's first chord is the downbeat (beat 0);
beats are forced strictly increasing so two chords never collide; durations fill
to the next onset and **sum to `beatsPerBar`**. `beatsPerBar` is **4 (4/4
assumed)** — time-signature detection from the PDF is the clean next task, same
flavour as tuning detection. The `startX`/`endX` fields are purely additive; the
existing per-bar recognition path is unchanged.

The PDF panel has a **Chart / Grid / Tab** toggle: *Chart* is the lead sheet (chords on
their beat, barlines, tap a chord to inspect its voicing); *Grid* is the original
compact one-symbol-per-bar card grid; *Tab* (2026-10-24) draws and plays the AlphaTex tab
(see "Tab viewer"). All feed the same engine.

## Path C — MusicXML import (`parseMusicXML`)

**Why this exists / the time-signature story.** PDF time-signature auto-detection
is *not possible* from the alphaTab text layer: the meter (and clef) glyphs are
in a music-notation font whose characters have **no Unicode mapping**, so
`getTextContent()` returns them as empty strings — only the fret/measure digits
are real text. (Verified on the Blue Sky PDF: meter font `g_d0_f4`, ~1677 glyphs,
all empty `.str`.) Reading meter would require OMR on glyph shapes = Path B. The
honest fix is to ingest a format that *states* the meter: **MusicXML**.

`parseMusicXML(xml, useSharp)` reads `<time>` (meter), `<staff-tuning>` (tuning)
and every note's `<duration>`/`<pitch>`/`<string>`+`<fret>` — so **meter, tuning
and beat placement are EXACT**; only the chord *symbol* is inferred, by running
each onset's simultaneous MIDI pitches through the same engine
(`symbolForMidis`). Guitar Pro files aren't parsed natively (binary/zip → would
need alphaTab, a dep we don't take); instead users export GP → MusicXML.

Key parser facts (don't regress):
- Uses the browser's built-in **`DOMParser`** → zero new app deps. Iterate
  `measure.childNodes` **in document order** (not `getElementsByTagName` per tag)
  so note/`<backup>`/`<forward>` timing interleaves correctly.
- Onset model: a note advances `cursor` by its `<duration>`; a `<chord/>` note
  shares the previous note's onset and does **not** advance. `divisions` is
  divisions-per-quarter; `beat = round(onset / (divisions·4/beatType))`.
- MIDI from `<pitch>`: `(octave+1)·12 + step + alter` (E2 = 40, matches `TUNINGS`).
  Fret-only fallback: `<string>` numbering is **1 = highest string** (engIdx =
  `6 − string`), whereas `<staff-tuning line>` is **1 = bottom = lowest string**
  (engIdx = `line − 1`). Two different conventions on purpose — both map to the
  engine's 0 = low E.
- Output is the **same score shape** as `buildScore`
  (`{ timeSig, bars:[{ number, timeSig, events:[{symbol,beat,durBeats,midis,frets}] }] }`),
  but with **per-bar `timeSig`** so a mid-tune meter change renders correctly.
- **Multi-part**: `parseMusicXML(xml, useSharp, partIndex)` reads instrument names
  from `<part-list>` and charts the chosen `<part>` (default 0), returning
  `parts:[{index,id,name}]` + `partIndex`. The XML panel shows a **part picker**
  when `parts.length > 1`; tempo is global (whole-doc), so it's part-independent.

## Path D — Guitar Pro 7/8 import (`parseGP` / `parseGPIF` / `gpUnzip`)

**Why native, and only `.gp`.** A `.gp` (Guitar Pro 7/8) file is a plain **ZIP**
whose `Content/score.gpif` is **XML** — so it parses with **zero new deps**: the
ZIP is inflated by the platform-native `DecompressionStream('deflate-raw')`
(present in the browser *and* Node ≥18, so the headless test runs the exact same
`gpUnzip`), and the XML is read with the same `DOMParser` Path C uses. Older
formats are deliberately **not** parsed here — GP3/4/5 are monolithic binary
(`…FICHIER GUITAR PRO v3/4/5`), GPX (GP6) is a `BCFZ` binary filesystem, and
Power Tab `.ptb` is its own binary — all would need a binary reader or a
dependency (alphaTab). The honest route for those stays **open in TuxGuitar /
MuseScore → export MusicXML** (Path C). The MusicXML/GP upload panel accepts
`.gp` alongside `.xml`/`.musicxml`; `onXml` branches on the extension.

**gpif is a flat id-graph, not nested like MusicXML.** The traversal is
`MasterBar.Bars[trackIndex]` → `Bar.Voices` → `Voice.Beats` → `Beat`
(`{ Rhythm ref, Notes ids }`) → `Note`. `parseGPIF` builds id→element maps
(`_gpById`) for Bar/Voice/Beat/Note/Rhythm and resolves the refs. Key facts:
- A `<Note>` carries a **direct `<Property name="Midi"><Number>`** — so MIDI goes
  straight into `symbolForMidis`, no pitch math (a `ConcertPitch` fallback
  exists). `<String>`/`<Fret>` are also read for the readout: **gpif `String` is
  0-indexed from the low E**, so `eng = String` directly and the **tuning
  `<Pitches>` list is low→high** (no reverse) — verified: String 1 + fret 7 =
  A2+7 = MIDI 52, and the test asserts `fret + standardOpen === midi` for every
  fretted note in Blue Sky.
- Duration comes from the referenced `<Rhythm>` (`NoteValue` Whole…128th, ×1.5/
  ×1.75 per `AugmentationDot count`, × `den/num` per `PrimaryTuplet`), accumulated
  per voice from 0; **all voices in a bar are merged** onto shared onsets (like
  the MusicXML backup/forward handling) so chord voicings across voices combine.
- Per-bar `<Time>` gives **exact meter** (Blue Sky opens **2/4**); tempo is the
  first `<Automation><Type>Tempo</Type>` `Value`; tracks → the **part picker**.
- Output is the **same score shape** as `parseMusicXML` (`source:"gp"`), so the
  chart, exporters, transpose, key analysis, playback and the ♯/♭ re-spell /
  part-switch (`_reparseScore` branches on `score.source`) are all shared.

**Validation** (`npm test`, fixture `blue-sky.gp`): `parseGP` reconstructs the
**same Blue Sky ground truth as the PDF path** straight from the `.gp` — 3 tracks,
165 bars, Standard tuning, tempo 100, bar-1 meter 2/4, the rhythm-guitar track
(#1) verse `E A A E E A A E`, the bar-26 bridge turn `B C#m`, and every fret
reconstructing its MIDI through standard tuning. This is the cleanest cross-check
in the repo: two independent importers (geometry vs. exact file) agree.

## Path E — Guitar Pro 3/4/5 legacy BINARY import (`parseGP345`)

Unlike GP7/8 (Path D = ZIP of XML), **GP3/4/5 are monolithic little-endian
binary**. `parseGP345` is a faithful, **zero-dependency** port of the documented
read order (cross-checked against **PyGuitarPro**, a dev-time oracle only — never
shipped). The hard rule: **every block must be fully consumed to stay aligned**,
even effects/chord-diagrams/mix-tables we don't keep — a single wrong skip
cascades. We keep only each beat's duration and its notes (string+fret → MIDI via
the track tuning), then emit the SAME `source:"gp"` score shape, so chart/export/
transpose/playback/part-switch are shared (the `_reparseScore` helper re-runs
`parseGP345` from a stored `_gpbuf` for the ♯/♭ + part re-parse).

Format facts that bite (all verified against the corpus):
- Read primitives mirror PyGuitarPro's `iobase`: `byteSizeString(n)` = 1 size byte
  then **n** bytes (slice to size); `intByteSizeString` = int count then
  `byteSizeString(count-1)`; version = `byteSizeString(30)`. Strings decode as
  latin1 (names don't affect recognition).
- Song header order: 8 info strings + notice lines, triplet-feel bool, **(GP4+
  only) lyrics** (trackChoice + 5×(int + intString)), tempo, key, **(GP4+) octave
  byte**, 64 MIDI channels (`int instrument + 6 bytes + 2 blank` = 12 each),
  measureCount, trackCount.
- Measure header flags: `0x01/0x02` num/den (else inherit previous — this is how
  meter carries), `0x08` repeat-close byte, `0x10` alt-ending byte, `0x20` marker
  (intByteString + 4-byte colour), `0x40` key-sig 2 bytes.
- Track: flags, `byteSizeString(40)` name, stringCount int, **7** tuning ints
  (first stringCount used, stored **high→low** so `tuning[string-1]` is the open
  pitch, `string 1 = high e`), port, 2 channel ints, fretCount, capo, 4-byte colour.
- Measures are **measure-major then track**; GP3/4 have **one voice** per measure
  (GP5 has two). Beat: flags, optional status byte (`0x40`; 0=empty/2=rest),
  duration (`1<<(i8+2)` → value, `0x01` dotted, `0x20` tuplet int), then chord/
  text/beatEffects/mixTable blocks, then a string-mask byte and a note per set bit
  (`1<<(7-stringNumber)`).
- Note: flags, `0x20` type byte **then later** `0x20` fret byte (both under the
  same flag, read in order), `0x01` 2 bytes, `0x10` dynamic, `0x80` 2 fingering
  bytes, `0x08` note-effects. **Tie** (type 2) → reuse that string's previous fret
  (`state.lastFret`); **dead** (type 3) → no pitch (dropped, like a muted strum).
- Version deltas: GP4 uses 2 effect-flag bytes (vs GP3's 1), a different
  new-chord layout (`u8` roots, 7 frets, 5-barre arrays, 7 fingerings + show),
  a mix-table all-tracks flags byte, and slide/harmonic/trill/tremolo-pick
  note-effects. `_gpReadBeatEffects`/`_gpReadNoteEffects`/`_gpReadChord`/
  `_gpReadMixTableChange` branch on `v`.

**GP5** has its own reader (`parseGP5`) because the container differs materially:
an RSE master effect, page-setup block, 19 jump directions, much wider track
records (RSE instrument, EQ, clef transpose) and **two voices per measure** with a
trailing line-break byte. `gt500` (= v5.10) gates the extra RSE/EQ/hide-tempo/
effect-name fields. Gotchas that cost real debugging: a **blank byte after *all*
tracks** (`skip(1)` v5.10 / `skip(2)` v5.00), and the **final measure's line-break
byte is often absent** — PyGuitarPro reads it with `default=0`, so we read it only
when `pos < length`. GP5 beats reuse the GP4 chord/beat-effect helpers but have
their own note reader (a duration-percent `f64` under `0x01`, an always-present
second flags byte) and a trailing `int16` beat-display flags word.

The dispatcher `parseGuitarProOrXML` routes by file head (`PK`→GP7/8,
`BCFZ`/`BCFS`→GP6 `.gpx`, `FICHIER GUITAR PRO`→GP3/4/5, else MusicXML). Power Tab
still routes through MuseScore/TuxGuitar → MusicXML.

**Validation** (`npm test`): `parseGP345` reproduces the **Blue Sky gp3** verse
`E A A E E A A E`, decodes **Kid Charlemagne**'s Rhythm-Guitar bars 27–28 to the
correct **`C7`** (the very bars the PDF path mis-anchored to `Fm7` — three
importers now agree on the geometry-defeating case), reads **Peg.gp4**'s jazz
changes `Gmaj7 | F#7 | Fmaj7 | E7 | Ebmaj7`, and decodes **GP5** both ways:
**Anthropology** (v5.00) `Chords` track → `Gm7/Bb G7 | Cm7 F7 | …` rhythm changes
and **Au Privave** (v5.10). A dev-time PyGuitarPro cross-check matched **2445/2446
measures** across the GP3/4 files and **4806/4806** across six GP5 files (v5.00 and
v5.10, single- and multi-track) — the lone GP3/4 diff is one passing tone in a
bebop bar, not a byte-alignment error (alignment survives past it).

## Path F — Guitar Pro 6 (`.gpx`) import (`parseGPX`)

A `.gpx` is **GP6's container**: a `BCFZ`-compressed (or raw `BCFS`) **sector
filesystem** whose `Content/score.gpif` is the **same GPIF XML GP7/8 use** — so
once unpacked, **`parseGPIF` does the rest** and the whole chart/export/transpose/
playback/part-picker stack is shared. Zero deps: a bit-reader + the documented
BCFZ LZ scheme + the 0x1000-sector filesystem, ported from alphaTab's
`GpxFileSystem` (`_gpxBitReader`/`_gpxDecompress`/`_gpxReadFS`/`parseGPX`, re-parse
from a stored `_gpxbuf`). Decompress facts: a 1-bit flag selects back-reference
(`readBits(4)` word size, then `readBitsReversed` offset+size, copy `min(offset,
size)` from the end) vs raw (`readBitsReversed(2)` count of literal bytes); bits
are **MSB-first per byte**. The inner `BCFS` header is skipped, sector 0 is the
empty pad, file entries (type `2`) carry a 127-byte name, a size at `+0x8c`, and a
zero-terminated list of absolute sector indices at `+0x94`.

**GP6 note encodings differ from GP7/8**, so `parseGPIF` gained two fallbacks
(additive, harmless to GP7/8): GP6 tab notes carry **only `String`+`Fret`** (no
`<Midi>`), resolved via `tuning[String] + Fret` (String 0 = low E, verified by The
Weight reading clean A-major chords); and GP6 **piano/concert parts** encode pitch
as `Tone(<Step> = chromatic 0–11)` + `Octave(<Number>)` → `octave·12 + step`.

**Validation** (`npm test`): PyGuitarPro **cannot read GPX**, so correctness rests
on the decompressor producing a coherent score (a single bit error in the LZ
back-references cascades into garbage). `parseGPX` decodes **Yardbird Suite**'s
`simple chords` track to `Em7 | Am6/F# Ebaug/B | Em7 | C#aug/A | Dm7 | …`, **The
Weight** to its key-of-A guitar chords (`C#m`/`F#m` in bar 1, via String+Fret), and
**My Favorite Things**' McCoy-Tyner piano part to 48 populated bars (via the
Tone+Octave encoding) — across 5 diverse `.gpx` files (32–736 KB gpif).

## Path G — Power Tab (`.ptb`) import (`parsePowerTab`)

Power Tab Editor's `.ptb` is an **MFC-`CArchive`-style binary serialization**
(Brad Larsen's format) — a different lineage from Guitar Pro. `parsePowerTab` is a
faithful, **zero-dependency** port of the documented `Deserialize` order from the
open-source **powertabeditor** repo (`source/formats/powertab_old/powertabdocument`,
fetched at dev time — never shipped). Nothing is length-prefixed, so the MFC object
layer (`_ptbReader.classInfo`: `0xFFFF`=new class → schema+name; `0x8000` bit =
seen class; else object back-ref) must consume **every** object exactly — even
effects/diagrams/dynamics we discard — or the cursor desyncs. **Clean EOF across
the corpus is the validation** (no PyGuitarPro-style oracle exists; reaching the
file end with zero leftover bytes is the alignment proof — verified on 395/400
random files from a 3056-`.ptb` archive; the 5 misses are corrupt all-zero headers
the parser rejects cleanly).

Layout facts (all from the powertabdocument sources):
- All little-endian. **MFC string** = 1 length byte (`0xFF`→`u16`→`u32` escalation)
  then the chars. **ReadCount** = `u16` (`0xFFFF`→`u32`). **ReadVector** = count +
  per-item `classInfo` + `Deserialize`. **ReadSmallVector** = `u8` count + count·
  `sizeof(elem)` raw bytes (note/position complex-symbol arrays are 4-byte elems).
- File = header → **Guitar Score** + **Bass Score** (each: guitars, chord diagrams,
  floating text, guitar-ins, tempo markers, dynamics, alt endings, **systems**) →
  3 document fonts → spacing/fade. We expose both scores' guitars as the **part
  picker**; `_reparseScore` re-runs `parsePowerTab` from a stored `_ptbbuf`.
- **Note** packs string+fret in ONE byte: **top 3 bits = string (0 = high E),
  bottom 5 = fret**; tuning's `noteArray` is high→low, so `midi = tuning[string] +
  fret` and the engine index is `(stringCount-1) - string`. **Position** duration =
  `(m_data >> 24)` (1=whole…64=64th) with dotted/double-dotted in the low bits.
- A **System** is a staff line holding several measures delimited by **barlines**
  (`startBar` at position 0 + a barline vector); we segment positions by barline
  position into measures. **Time signature** lives on each barline's `m_data`:
  common=4/4, cut=2/2, else `beats=((d>>27)&0x1f)+1`, `beatType=1<<((d>>24)&7)`,
  shown when `d&0x100000` (we inherit the last shown meter otherwise). Tempo is the
  low word of the first tempo marker's `SystemSymbol` data.
- Targets the ubiquitous **v1.7 (=4)** files; the modern object path also covers
  **v1.5 (=3)**. v1.0/1.0.2 (pre-release, effectively nonexistent) use older
  system/barline/chord-name layouts and aren't handled. The dispatcher routes a
  `ptab` file head → `parsePowerTab`; the upload panel accepts `.ptb`.

**Validation** (`npm test`, fixtures `tune.ptb` + `house-of-the-rising-sun.ptb`):
the open-string file reconstructs `E B G D A E` (proves string+fret+tuning), and
**House of the Rising Sun** parses to the recognizable **6/8** Am arpeggio
(`A E A C E C G`) with its Am/C/D/F changes across the opening bars (proves the
barline→measure segmentation and meter).

### iOS upload note (don't re-add an `accept` filter)

The MusicXML/GP/Power Tab `<input type=file>` has **no `accept` attribute on
purpose**. iOS maps `accept` extensions to UTIs, and `.gp/.gpx/.gp3/.gp4/.gp5/.ptb`
have no registered UTI, so iOS **greys them out** (unselectable). Format detection
is by magic bytes in `parseGuitarProOrXML` (`PK`→GP7/8, `BCFZ`/`BCFS`→GP6,
`FICHIER GUITAR PRO`→GP3/4/5, `ptab`→Power Tab, else MusicXML), so the extension
filter is unnecessary — and adding one back breaks Guitar Pro upload on iPhone/iPad.

## Shared ChartPanel — editing, transpose, export

Both chart modes feed one `ChartPanel`. Anything that reads/writes a score does so
through the shared shape, so these work identically for Path A and Path C:

**View-layer decoupling (since 2026-06-20 — Roadmap Wave 2 #6).** `ChartPanel` is the
**controller** — it owns all state (`view`/`semis`/`simplify`/`arrange`/`exp`/playback
…), the score-transform memo chain (`simp → base → tscore`), and the export/playback/
handoff handlers. Its *render* is four **pure presentational sub-views** that take props
and return JSX (no engine internals, no own persistent state): **`MelodicNudge`** (the
amber simplify hint), **`LeadSheetView`** (`view==="chart"` — chords on the beat + inline
Edit; takes `musicKey` so the name doesn't clash with React list keys), **`GridView`**
(the compact one-symbol-per-bar cards), and **`ExportPanel`** (the export text / MIDI-byte
summary + copy/download). This is a **pure refactor** (behavior identical; guarded by the
transpile + contract tests) whose point is that the next views (Audio/Practice, Wave 3)
are just **more siblings switched on `view`** — they plug into this seam instead of
bloating the monolith. Lifting `semis`/transpose state out to the parent for persistence
+ off-thread re-parse stays a follow-on (it's the "then persist" half of the roadmap).
- **Simplify** (`simplifyScore(score, useSharp)`): opt-in "1 chord/bar" mode for
  dense transcriptions (melody + harmony), where the per-onset chart is noise. It
  weights each pitch class by the total duration it sounds, keeps the strong ones
  (drops passing tones), takes the bass from the **structural** tones (so a brief
  low melody note can't fake a slash), and runs that chroma through the engine →
  one chord per bar. **AUTO-ENABLED for a melodic chart** (see below), OFF for block
  harmony (Blue Sky / clean charts stay per-onset). Honest
  limits: **rootless** / heavily-altered jazz voicings (e.g. Steely Dan) won't always
  match a lead sheet — Edit + Transpose cover the gaps, and MusicXML import is the
  high-fidelity route. (The common extensions `7♭9`/`7♯9`/`9`/`m9`/`maj9`/`add9`/`6/9`/
  `m(maj7)` ARE now modelled in `QUALITIES` — see Invariant 1.)
  - **Melodic detection + auto-Simplify** (`isMelodicScore`/`melodicFraction` in
    `engine.tsx`, the shared pure test; `melodic` memo in `ChartPanel`): a chart is
    "melodic" when **≥50%** of its events are single-note (`midis.length === 1`, over
    **≥4** events) — an arpeggiated part, a lead line, or a single-note PDF/tab head,
    not block harmony. Such a chart would otherwise export "quartered" (one chord per
    arpeggio note, e.g. `B_Ab_F#_B …`), so **Simplify is turned ON automatically** (the
    `simplify` state lazy-inits from `isMelodicScore(score)` and re-applies on every
    score change — upload / part switch / decode / restore), with the raw per-onset view
    **one toggle away**. Because export / handoff derive from the `simplify` state
    (`simp → base → tscore`), the CSMPN/CSML/handoff a melodic chart sends is the clean
    fakebook. When the user manually toggles Simplify **off** on a melodic chart the
    amber **Turn on Simplify** nudge (gated on `melodic && !simplify`) reappears to offer
    it back. Validated (`npm test`): Blue Sky's block chart reads < 50% single → not
    melodic (Simplify stays off); an all-single-note (arpeggiated) chart reads 100% →
    melodic (auto-on); a 1-event chart is below the `minEvents` gate; a mostly-block
    chart (25% single) is not melodic. No false positives on the validated chord charts.
- **Arrange** (`arrangeScore(score, template)`, Roadmap Wave 2 #8): the inverse of
  Simplify — turns a *harmonic* chart into a rhythmic **arrangement** by stamping a
  comping/strum template across each bar; each hit carries the chord **sounding at
  that position** (so multi-chord bars keep their changes). Pure + deterministic, no
  model — `ARRANGE_TEMPLATES` are fixed per-beat sub-patterns (meter-independent, so
  a 3/4 bar gets 3 hits): **`block`** (keep existing onsets = a clean sustain),
  **`quarters`** (one strum/beat), **`eighths`** (straight eighths),
  **`shuffle`** (swung eighths, long-short, flagged `tuplet:3` so CSMPN/CSML draw the
  triplet bracket), **`sixteenths`** (four/beat) and **`skank`** (reggae/ska off-beat
  — one hit per beat on the "&"). Honest limit: CSMP's `{hybrid}` grid is
  eighth-resolution, so `sixteenths` round-trips *lossily* into the slash-rhythm
  (positions collapse), but the SCORE (qbeat/qdur) is exact so MIDI/ABC/playback render
  all 16ths faithfully. Output is the **same score shape** every parser emits, so it
  flows untouched through the exporters (CSMPN/CSML `{hybrid}` slash-rhythm, MIDI,
  ABC), playback, transpose and key analysis — **zero new plumbing**. Pipeline order
  in `ChartPanel` is **simplify → arrange → transpose** (`simp`/`base`/`tscore`
  memos); the **Arrange…** `<select>` default OFF, unknown template = safe
  passthrough. Validated headlessly (`npm test`): quarters tracks `C C G G` across a
  C·G bar, honours the 3/4 bar (3 hits), eighths = 8 hits, block = the original `C G`,
  shuffle = 8 `tuplet:3` hits emitting `t3` in CSMPN, and the arranged score still
  exports `{hybrid}` + lays 11 timed playback events.
- **Editable chords**: tap-to-relabel in *Edit* mode writes an `overrides` map
  (`"<bar>.<beat>" → symbol`), lifted to the parent so it survives view/transpose
  switches and flows into export. Blank reverts to the detected symbol; edits are
  marked `*`.
- **Transpose** (`transposeScore(score, n, useSharp)`): shifts every event's MIDI
  by `n` and lets the engine **re-name** the chord (spelling follows the ♯/♭
  toggle for free). Frets are dropped (position-specific); readouts fall back to
  the transposed pitches. `n === 0` is a passthrough.
- **Export**: `scoreToChordPro` (grid), `scoreToABC`, and `scoreToMusicXML`. ABC
  emits the actual chord tones as notes **plus** the symbol as a guitar-chord
  annotation, so the output is real, *playable* music (validated by playing it);
  it carries `Q:` tempo, the detected `K:` key, and mid-tune meter via `[M:n/m]`.
  **MusicXML export** writes both a `<harmony>` (chord symbol → MuseScore/Guitar
  Pro show it above the staff) AND the voiced `<note>` pitches, so it re-imports
  as real music *and* **round-trips through `parseMusicXML`** (the notes
  reconstruct the same symbols — that round-trip is a test, incl. the full 165-bar
  Blue Sky score). MusicXML durations and onsets follow `qdur`/`qbeat`, with
  divisions raised for tuplets and `<time-modification>` on tuplet notes; the
  displayed integer `durBeats`/`beat` grid is not accurate enough for this export.
  All exporters honour `overrides` and the current transpose;
  ChordPro/ABC/MusicXML all carry the detected key.
  - **MIDI export** (`scoreToMidi`, Roadmap Wave 2 #9): a 6th exporter — a pure,
    deterministic **Standard MIDI File** (format 0, PPQ 480) returning a
    `Uint8Array`. Same timing model as `scoreEventTimes`/ABC (a "beat" = one
    `1/beatType` note = `4/beatType` quarters; per-bar `timeSig` → time-sig metas;
    tempo from `opts.tempo`). Writes the actual voiced `event.midis` (so the
    caller passes the already-transposed score). Binary, so the export panel
    offers **download only** (no copy) with a byte-count summary. Unit-tested
    headlessly via a minimal SMF walker (note-on count = voiced pitches, C triad
    present, +2 transpose → D triad, deterministic, 480 PPQ, 120 bpm = 500000us).
  - Every export can be **copied** to the clipboard OR **downloaded** as a real
    file from the preview panel (`download()` in `ChartPanel` — per-format
    extension/MIME: `.abc`, `.musicxml` → `application/vnd.recordare.musicxml+xml`,
    `.mid` → `audio/midi`, `.chordpro`, `.csmpn`, `.csml`; filename from the chart
    title via a Blob + anchor).
- **Key + roman numerals** (`analyzeKey`, `analyzeKeyCandidates`, `romanFor`, `keyName`):
  scores all 24 keys by **harmonic FUNCTION** — see "Key detection v2" below for the model
  and the ♭VII defect it fixed — and picks the best; the **key is user-correctable**
  (`KeyPicker` → `parseKeyName`), and the override flows through the same `opts.key`
  every exporter reads. The `I·V·vi` toggle captions each chord with its
  function relative to that key (non-diatonic → absolute symbol); the detected key
  shows in the meta row and flows into export (`K:` line for ABC, `{key:}` for
  ChordPro). Chord class is parsed from the symbol suffix (`_classOf`); minor keys
  accept a major/dominant V (harmonic) and a leading-tone vii°.
- **Playback** (▶ Play, ♩=BPM): in-browser **Web Audio** synth, no deps. Pure
  `scoreEventTimes(score, bpm)` flattens the score into timed chord events in
  **seconds** (a "beat" = one `1/beatType` note → `4/beatType` quarters, same
  conversion as ABC; per-bar timeSig keeps the clock right through meter changes);
  `playScore` schedules triangle-osc voices with a short envelope and lights a
  **playhead** (`onEvent` → highlighted chord). Tempo comes from MusicXML
  (`<sound tempo>` / `<metronome>`), defaulting to **100** (PDF has none). Plays
  the *transposed* score, so what you hear matches what's shown. The scheduler is
  unit-tested; the Web Audio glue itself is browser-only (smoke-test on hardware,
  same category as the PDF.js worker).
- **Reference audio** (🎵 Reference audio / ▶ Play with chart, 2026-06-20): attach a
  real recording (e.g. an isolated-vocal stem) and play it back while the chart's
  **exact** (notated MusicXML/GP or recognised) harmonies **highlight in sync** — the
  "score is ground truth, audio is the reference" idea. Reuses the pure
  `scoreEventTimes(tscore, bpm)` as the beat→seconds map (computed once at play start);
  an rAF loop sets `playKey` to the event active at `ctx.currentTime`, so the existing
  chart highlight follows the recording. Two sync modes: **♩= linear tempo map**, or
  **🎯 Auto-align (DTW)** — see below. Browser-only glue (engine stays pure;
  decode/playback are device-only). Substrate for the personalized vocal-harmony
  training roadmap.
- **DTW auto-sync** (`alignPcmToScore`, 2026-06-20): automatic audio↔score alignment so
  the highlight tracks the recording with **no manual ♩=**, and through tempo drift /
  rubato a linear map can't. Pure + headless-tested: match the audio's chroma sequence
  (`pcmChromaSequence`) against the score's expected chroma (`scoreChromaSequence`, one
  vector per event) via **Dynamic Time Warping** (`_dtw`, cosine distance `_cosDist`) →
  the lowest-cost monotonic path → **sec→event-key segments** the playhead follows. Run
  **off-thread** (`alignPcmToScoreOffThread` via `_engineRPC`, main-thread fallback); the
  UI downsamples the attached audio to 16 kHz for it. Validated (`npm test`): identical
  seqs → zero-cost diagonal, a time-stretched copy aligns end-to-end, and synthesized
  audio played with UNEVEN timing (C 1.0s / G 0.4s / Am 1.4s) maps each region to the
  right chart event. Only the PCM decode is device-only. This is also the labeling step
  for the future on-device personalized-harmony training (aligned audio→notated pairs).
  - **Energy gate (2026-07-05):** a real recording has a silent lead-in / trailing silence
    (count-in, room tone, applause). `pcmToChroma` normalises EVERY frame to unit max, so
    silence becomes a full-magnitude NOISE chroma — and DTW's fixed endpoints (frame 0 →
    event 0, frame N → event M) would force that silence onto the FIRST/LAST chord and
    shift the whole alignment. So `alignPcmToScore` now gates on **RMS energy** (same idea
    the sibling `transcribeChords` already used): `pcmChromaSequence` carries each frame's
    `energy`; the aligner **trims** leading/trailing silence before DTW so the endpoints
    anchor to real music, and nulls any interior silent frame (a mid-song pause → rest →
    no highlight; it also passes a **zero vector** into the DTW so it can't drag the warp
    toward a wrong chord). Silent regions become **null-key segments** (highlight cleared).
    `energyGate` defaults to `0.08·maxEnergy`. Guarded by a `npm test` regression: a synth
    take with a **0.6 s silent lead-in** maps the lead-in to `null` and still resolves C/Am
    to the right events once the music starts.
  - **Accuracy + confidence (2026-07-05):** three additive upgrades so the warp matches real
    recordings better and stays honest. **`alignPcmToScore` now returns `{ segments, confidence }`**
    (was a bare segments array) — callers destructure `.segments`; the UI reverts to the linear
    ♩= map when `confidence` is low.
    - **Duration-weighted score columns** — `scoreChromaSequence` emits **~1 DTW column per beat
      of each event's `qdur`** (was one column per event regardless of length) + **emphasises the
      bass pc (usually the root) and its 5th**, so the warp knows how long a chord should sound
      (the rubato/tempo-drift case) and the chroma looks like a real chord (root loud). This makes
      the returned sequence longer with repeated keys — the segment builder collapses them, so
      downstream is unchanged.
    - **Audio-chroma smoothing** — the aligner averages each frame's chroma over ±`smoothHalf`
      (default 1 = 3-frame window) **non-gated** neighbours before DTW, killing per-frame jitter
      at chord edges (the smoothing `transcribeChords` had, which the raw `pcmChromaSequence`
      lacked). Silence never bleeds in (gated neighbours skipped).
    - **Confidence + auto-fallback** — `confidence` = mean cosine similarity over the matched,
      **non-silent** frames (silence excluded so a lead-out can't tank it). The UI adopts the DTW
      segments only when `confidence ≥ 0.35`, else it keeps the ♩= map and says the match was weak
      — so a wrong stem / wrong chart no longer silently mis-highlights. Measured margins are wide:
      a clean matching take reads **~0.94**, a tritone-disjoint chart **~0.02**.
    - Guarded by `npm test`: a 3-beat event spans 3 columns / 1-beat spans 1, the bass pc outweighs
      the 3rd, the matched take reads high confidence and a pitch-disjoint chart reads `< 0.3`, and
      the existing uneven-timing + silent-lead-in mappings stay byte-identical (smoothing didn't
      shift them).

`midiToAbc`/`abcDur` invariants: middle C (C4 = 60) is ABC `C`, C5 is `c` (the octave
convention `_abcPitch` keeps — but since 2026-10-13 NO exporter writes pitches with the
K:-blind `midiToAbc`; see "ABC notation 2.1 compliance"); ABC
duration is a reduced fraction of `L:1/4` (`durBeats·4/beatType`), so simple
meters stay integers and 6/8-style beats become `/2`.

### Two duration fields: integer `beat/durBeats` (chart) vs true `qbeat/qdur` (ABC/playback)

Every event carries **both** an integer `beat`/`durBeats` AND a fractional
`qbeat`/`qdur` (`_fillTrueDur`, set in all parsers + `buildScore`). This is
load-bearing, from a real bug: the lead-sheet **Chart view places events with CSS
grid** (`gridColumn: ${beat+1} / span ${durBeats}`), which *requires integers* —
so beats are quantised and clamped to `0..beatsPerBar-1`. But a **dense melodic
line** (e.g. Anthropology's straight-eighth head — ~8 onsets per 4/4 bar) has more
onsets than integer beats, so several round to the same beat and
`durBeats = nextBeat − thisBeat` becomes **0**. Feeding that to `abcDur` emitted a
literal `0` length — **invalid ABC** (Tunebook/abcjs drop the note or fail). So
`qbeat = onset / unitsPerBeat` (unclamped) and `qdur` (gap to the next onset,
always > 0) carry the *true* timing. **`scoreToABC` and `scoreEventTimes` use
`e.qdur ?? e.durBeats` / `e.qbeat ?? e.beat`; the Chart grid keeps the integers.**
`abcDur` additionally scales by 12 (eighths/sixteenths/triplets stay integer) and
floors the numerator at 1, so a 0 can never be emitted. Don't "simplify" the two
fields back into one — the chart and the exporters genuinely need different things.

## Integration — CSMPN export + Chord Sheet Maker Pro handoff (2026-06-11)

Tab Translator Pro is the **front of the pipeline**: it turns a tab/PDF/Guitar
Pro/MusicXML/Power Tab file into a recognised chord chart. **Chord Sheet Maker
Pro** (CSMP) is the **finishing app** — fake-book layout, slash-rhythm rendering,
print/PDF, setlists. This integration lets a recognised chart flow straight from
the decoder into CSMP in CSMP's own native language, with one tap.

### `scoreToCSMPN(score, opts)` — a 4th exporter (sits with the others)

Mirrors `scoreToChordPro` exactly but emits **CSMPN**, CSMP's native fake-book
source (not ChordPro). Output shape:

```
Title: …            ← opts.title
Composer: …         ← opts.composer (omitted if absent)
Key: …              ← keyName(opts.key, useSharp) (omitted if no key)
Time: n/m           ← score.timeSig
Tempo: …            ← opts.tempo (omitted if absent)
Tuning: …           ← score.tuning (Drop D / Standard…; omitted for PDF charts)
Capo: n             ← score.capo (GP3/4/5; omitted when 0)

- Chart                   ← one CSMPN section marker
Bb7 | Bb7_A7_D7 | Eb6 | % ← bars delimited by `|`, `||` at section/chart end; 4/row
```

**CSMPN grammar — the native chordsheet.com syntax (updated 2026-07-06):** the export
now emits the finishing app's **native chordsheet.com bar syntax** (CSMP Sprint 18) so a
decoded chart reads identically to a chart authored by hand in chordsheet.com's language —
matching CSMP's own GP-importer house style. Bars are delimited by **explicit barline
tokens**: `|` between bars, `||` a double/section-end bar, `|:`/`:|` a repeat, `|]` a final
bar. CSMP's `parseBarStructures` (chord-sheet-maker-pro/chordProcessing.js) **filters every
barline token** (`isBarlineToken`) and takes each whitespace token between them as a bar, so
a multi-chord bar **must still** join its chords with `_` (`Bb7_A7_D7`) — a space would make
them separate bars (that space-vs-`_` distinction was the original real bug; joining with `_`
is what makes `Bb7_A7_D7` one bar regardless of the surrounding `|`). `%` collapses a bar
that repeats the previous one (simile); an empty bar is `N.C.`; `1.`/`2.` prefix an ending
bar. Verified end-to-end through CSMP's actual `parseCSMPN` + `parseBarStructures` with
**zero warnings** — `|: C | G :|` + `1. Am | 2. F ||` → 4 bars `[C,G,Am,F]`, 2 markers,
repeat + 1./2. endings captured; `C | % | N.C. | G_Am |` → `["C","%","N.C.","G_Am","F"]`.

**Family enharmonic default (2026-06-14):** the engine's DEFAULT spelling
(`useSharp=true`, the "Default ♯♭" toggle) is the family-wide table **`C C# D Eb E F
F# G Ab A Bb B`** — ALWAYS `Bb · C# · Eb · F# · Ab`, never `A#/Db/D#/Gb/G#`. This is
`NOTE_SHARP` (renamed in spirit; the constant still drives `symbolOf`/`fretToMidi`);
the "Flats ♭" toggle (`NOTE_FLAT`) remains the explicit all-flats override. Smoke-test
expectations updated accordingly (`Peg` → `… E7 | Ebmaj7`; Anthropology → `Gm7/Bb …`;
Yardbird → `… Ebaug/B …`) — same pitch classes, family-default spelling.

**Invariants (don't regress):** the engine spells notes ASCII (`C#`/`Bb`, see
`NOTE_SHARP`/`NOTE_FLAT`) so tokens are CSMPN-ready with **no** normalisation; the
unrecognised/rest symbol `"—"` maps to CSMPN's no-chord token `N.C.` via
`_csmpnSym`; overrides/transpose/♯♭/key/tempo flow in through the **same `opts`**
the other exporters use (the caller passes the already-transposed `tscore`). It
deliberately does **not** emit ChordPro `{start_of_grid}` directives — CSMPN uses
bare pipe bars. Wired into `doExport` (new `"csmpn"` branch) and the export-button
row (the **CSMPN** button), with a panel hint.

#### `{tab}` + `{hybrid}` fidelity blocks (the two upgrades, 2026-06-11)

`scoreToCSMPN` also emits the data only the decoder has — the **real fingering** and
the **real onset rhythm** — as the same `{tab}`/`{hybrid}` blocks CSMP's GP importer
produces, so Pro renders a TAB staff + chord diagrams + slash-rhythm instead of
generic shapes and even slashes. Both default ON; `opts.tab:false` / `opts.hybrid:false`
suppress them (plain fakebook).

- **`{tab}`** — unique chord voicings from `Event.frets` (`{engIdx→fret}`, 0 = low E …
  5 = high e). `_csmpnVoicing` orders them **high-e (string 1) → low-E (string 6)** and
  mutes absent strings (`x`) — the exact order CSMP's `parseTabVoicings` expects.
  First-seen voicing per chord wins (matches the GP importer). The frets were **read off
  the page**, so the diagram is the actual fingering. Naturally empty after transpose
  (`transposeScore` drops position-specific frets), so a wrong fingering is never sent.
- **`{hybrid}`** — one `barN:` line per bar; each event is `pos:dur(chord)` (rests
  `pos:r dur`). Beat position uses **cumulative-quarter** units via `_csmpnHybridPos`
  (mirrors importGuitarPro's `_cumQToHybridPos`: frac ≥ 0.4 → the `&` off-beat); duration
  is **floor-mapped** by `_csmpnDurLetter` to the largest `w/h/q/e/s` ≤ the gap, because
  CSMP's `parseHybridBarLine` **drops** any event that overlaps the previous one
  (`beat < prevBeat + prevBeats`). Source of timing is the event's true `qbeat`/`qdur`
  (`?? beat`/`?? durBeats` fallback). `cumQ = qbeat·4/beatType`.

Both blocks are **non-destructive**: CSMP's plain `parseCSMPN` renders the pipe bars and
ignores `{hybrid}`; `{tab}`/`{hybrid}` only light up in Pro's Slash-Rhythm View.

#### Tuplet `tN` flags in `{hybrid}` (Phase 1 fidelity, 2026-06-11)

`{hybrid}` events now carry CSMP's `tN` flag (e.g. `1:e(Dm7)t3`) for triplet/N-tuplet
runs, so jazz/shuffle changes round-trip to Pro's triplet brackets instead of being
mis-spaced on the straight grid.

- **Tuplet is captured, not inferred.** Each rhythm parser already reads the tuplet but
  discarded it; now it's threaded onto the event as `e.tuplet` (group size, 0 = none):
  GP3/4/5 via `_gpReadDuration` (side-channel `r._tuplet`, **same bytes** — zero
  alignment risk) → the beat → `_gpBuildScore`'s onset → event; GP6/7/8 via
  `_gpRhythmTuplet` (`PrimaryTuplet num`); MusicXML via `<time-modification>
  <actual-notes>`. `transposeScore` preserves it (object spread). PDF/PowerTab carry 0.
- **Written note value, not sounding.** A triplet-eighth sounds 1/3 quarter but is
  *written* as an eighth; the export recovers the notated value (`sounding × N/normal`,
  `_csmpnTupNormal`: 3→2, 5/6/7→4, 9→8) so it emits `e`, not `s`. CSMP skips its overlap
  check for same-tuplet events, so the contiguous quarter-grid positions are kept.
- **No spurious brackets.** `tN` is emitted only when the event sits in a run of **≥2**
  same-tuplet events — a lone tagged note would draw a bracket over one notehead.
- **Honest limit (the score model is harmonic):** consecutive *identical* chords collapse
  to one event (clean lead-sheet behaviour), so a same-chord triplet *strum* is one event,
  not three — `tN` mainly benefits **distinct-chord** tuplet runs (common in bebop:
  `Dm7 G7 C` triplet). Verified end-to-end: Anthropology.gp5 → 3 events/3 flags,
  blue-sky.gp (GP7/8) → 8/8, non-tuplet files → 0 (no false flags).

### Reverse handoff RECEIVER — "Decode this tab" (Phase 2, 2026-06-11)

The loop is now **bidirectional**. A finishing app (CSMP / chord-sheet-maker, same
GitHub Pages origin → shared localStorage) can hand a raw **GP / MusicXML / Power Tab /
PDF** file BACK here for recognition with this engine (the strongest fret→chord + key
engine in the trio — CSMP's GP importer guesses chords with a weaker inline table).

- **Contract (mirror of the forward one):** opened at `?import=decode`, the file bytes
  ride in `localStorage["ttp:decode:v1"]` as base64: `{ v:1, source, createdAt,
  filename, b64 }`. No format field — `parseGuitarProOrXML` and the `%PDF` magic-byte
  check detect the format from the bytes.
- **Two mount effects** in `TabDecoderPro()`: the first reads + clears the key
  one-shot, base64-decodes into a `decodeRef` and strips the URL param; the second
  processes it — `%PDF` → the PDF pipeline (`extractTokens` + `buildChart`, **gated on
  `pdfReady`** so it waits for PDF.js), else → `parseGuitarProOrXML` → `setMode("xml")`.
  Both lands set the same state the file inputs do (`xmlScore`/`xmlName` or `chart`), so
  it renders through the normal ChartPanel and the part picker works. Wrapped in
  try/catch — a bad payload can never wedge boot.
- Lands on **part 0** by default (same as a normal upload); the user switches parts.
- **Validated end-to-end** (headless round-trip probe): a real `blue-sky.gp` →
  chunked-base64 envelope (217 KB JSON, well inside quota) → `atob` → `Uint8Array`
  (byte-identical) → `parseGuitarProOrXML` → 165-bar score. The CSMP **sender** is the
  `Decode tab → Tab Translator Pro ↗` import-menu item (`fileInputDecode` →
  base64 → `ttp:decode:v1` → `…/Tab-Translator-Pro/?import=decode`).

### Direct handoff → CSMP (`sendToPro`, the **→ Chord Sheet Maker Pro** button)

Both apps deploy to the **same GitHub Pages origin** (`quantumq1981.github.io`), so
they **share `localStorage`**. The handoff reuses CSMP's existing, already-shipped
receiver (`consumeCsmHandoff` in CSMP `index.html`, contract in
`chord-sheet-maker/docs/HANDOFF-CONTRACT.md`) — Tab Translator is now a **third
sender** alongside `chord-sheet-maker`:

1. Build the **v1 envelope** `{ v:1, source:"tab-translator-pro", createdAt,
   title, transposeSemitones, enharmonic, formats:{ csmpn, chordpro, musicxml? } }`.
   CSMPN is preferred; ChordPro/MusicXML ride along as fallbacks. MusicXML is
   **dropped when > 1.5 MB** to stay inside the localStorage quota.
2. `localStorage.setItem("csm:handoff:v1", JSON.stringify(env))`.
3. `window.location.assign(`${location.origin}/chord-sheet-maker-pro/?import=handoff`)`
   — **same-tab** nav (mobile popup-safe). CSMP reads the key once, clears it,
   loads the chart via its own import pipeline, and strips the query param.

Wrapped in try/catch so a failure never wedges the UI. The envelope `source` lets
CSMP credit the import ("Imported from Tab Translator Pro — …").

**Why localStorage, not a URL payload:** charts (esp. with the MusicXML fallback)
exceed the ~2 KB practical URL limit; localStorage has MBs and is shared at the
origin. The contract is versioned (`:v1` + `v:1`) so an old sender + new receiver
can never silently misread a payload.

### `scoreToCSML(score, opts)` — ChordSlashML (a 5th exporter)

ChordSlashML is CSMP's **other** native format (the `window.csml` live editor) — a
**different grammar** from CSMPN fakebook, so it gets its own exporter:
`[Section]` labels (square brackets) and **pipe-delimited measures** whose **beat
slots are space-separated**. Each measure has `_csmlBeats(timeSig)` slots
(`4/4→4`, `12/8→4`, `6/8→2`, `9/8→3`, `3/4→3` — `den===8 && num%3===0 ? num/3 : num`,
mirroring CSMP's `beatsPerMeasure`). A chord sits on its beat slot; a **space-separated**
`_` holds the previous chord; `.` is a leading rest; **`A_B` joined (no spaces)** is a
compound beat (two chords share one slot). Each event's slot = `round(qbeat·pulses/num)`,
so the **per-bar meter is honoured** (a mid-tune 3/4 bar emits 3 slots). Example:
`| C _ G _ | A7 _ _ _ | F _ _ |`. Wired into `doExport` (`"csml"`) + the **ChordSlashML**
export button. No `{tab}`/`{hybrid}` blocks (those are CSMPN-only).

**Validation** (`npm test` + a cross-app probe): the CSMPN test asserts a multi-chord
bar uses `_` (`C_G A7 F`, **not** the old space-joined form), the `Title`/`Time`/`Tempo`/
`Key` headers and `- Chart` marker, and no ChordPro grid directives. The CSML test asserts
`[Chart]` labels and beat-slotted measures with per-bar meter (`| C _ G _ | A7 _ _ _ | F _ _ |`,
the last bar 3/4), and a 12/8 measure mapping to 4 slots (`| Bb7 _ A7 _ |`). The `{tab}`/
`{hybrid}` test (synthetic 2-event bar with frets) asserts the voicings come out
high-e→low-E with muted strings (`G: 3,0,0,0,2,3`, `C: x,1,x,2,3,x`), the rhythm on beats
1 & 3 (`bar1: 1:h(G) 3:h(C)`), the `tab:false`/`hybrid:false` opt-outs, and no `{tab}` after
transpose. **Both formats were round-trip-verified through CSMP's actual `parseCSMPN` +
`parseBarStructures` and `csml.parse`** — correct bar counts, multi-chord `_`, `%` simile,
and compound-meter slots, with **zero CSML parse warnings**.

#### Sections + repeats + endings (structure round-trips, 2026-06-13)

A decoded chart now carries the **section labels, repeat barlines and 1st/2nd endings**
the source files already encode — captured (not inferred), the same way tuplets were:

- **Score model:** each bar gains optional `section` (label that starts at this bar),
  `repeatStart`/`repeatEnd` (bool), and `ending` (`"1"`/`"2"`/… or null).
- **Capture sites (zero alignment risk — read the bytes/elements already present):**
  - **parseGPIF** (GP6/7/8/GPX) — gpif `<Section><Text>`, `<Repeat start/end>`, `<AlternateEndings>`.
  - **parseGP345** (GP3/4) — measure-header flags `0x04` (`|:`, flag only), `0x08`
    (`:|` + count byte), `0x10` (alt-ending bitmask → `_gpEndingLabel`), `0x20` (marker = section).
    Threaded via a parallel `meta[]` array → `tr.measures[m].meta` → `_gpBuildScore` → bar.
  - **parseGP5** — same flags, different byte order (marker before key-sig before alt-ending).
  - **parseMusicXML** — `<rehearsal>` text, `<barline><repeat direction>` (`forward`/`backward`),
    `<ending number type="start">`.
  - PDF/PowerTab carry none. `transposeScore` (object spread) and `simplifyScore`
    (explicit `mk` carry) preserve all four fields.
- **Emit:** `scoreToCSMPN` groups bars into `- Section` blocks and emits `|:`/`:|` barline
  tokens + `1.`/`2.` ending tokens. `scoreToCSML` emits `[Section]` labels, `|:`/`:|` barlines
  (with a token builder that handles abutting repeats), and endings as `[1st Ending]`/
  `[2nd Ending]` labels (CSML's grammar has no inline ending token — matches the user's
  example). A section-less score still falls back to one `- Chart` / `[Chart]` block.
- **Verified on real GP through CSMP's parsers (0 warnings):** *Steely Dan – Black Cow*
  → 5 sections (`-Intro -Verse -Chorus …` / `[Intro] [Verse] …`); *Robben Ford – Revelation*
  → sections + `|:`/`:|` + `1.`/`2.` tokens (CSMPN) and `[1st Ending]`/`[2nd Ending]` (CSML).
  Deterministic unit test covers all three markers in both formats.

### Future integration ideas (analysis — partly built)

See `docs/INTEGRATION-IDEAS.md` for the full write-up. **Shipped:** the `{tab}`
fingering round-trip, the `{hybrid}` rhythm scaffold (above), the reverse **"Decode
this tab"** link **(4)**, and **(3)** the **`Tuning:`/`Capo:` headers** — CSMPN + CSML
now emit the parser-detected tuning (`score.tuning`) and capo (`score.capo`, captured
free from the GP3/4/5 bytes already read; `opts` can override) via the shared
`_csmPerfHeaders` helper, so Pro renders the right TAB/diagrams instead of assuming
standard + no capo (validated: gp3 → `Tuning: Standard`, synthetic Drop D + capo 2,
capo 0 / PDF charts omit the lines). Remaining: **(5)** share the recognition engine
as a zero-dep module across the trio.

## Wave 3 #10 — chord-quality classifier (Phase 1, 2026-06-20)

The "AI second opinion" — built **iOS-first** and **dependency-free**, so it works in
the exact environment this ships into (mobile/tablet Safari on GitHub Pages).

**The contract (load-bearing — do not invert it):** the rule-based engine
(`recognise`/`QUALITIES`) is the **ORACLE** and the test oracle. The classifier is a
**confidence-gated second opinion** that can NEVER override a confident engine. The
arbiter `arbitrateChord(engineResult, chroma, {gate=0.75, minModel=0.8})`: if the
engine's Jaccard confidence ≥ `gate` → engine, full stop; only when the engine is
*unsure* is the classifier consulted, and it's adopted only if its own confidence >
`minModel` AND it differs. Otherwise the oracle stands. Pure + sync; returns
`{ result, source:"engine"|"classifier", secondOpinion }`.

**Why pure-JS matmul instead of `onnxruntime-web` (the iOS "get ahead" decision):**
GitHub Pages can't set `COOP`/`COEP` headers, so WASM threads (`SharedArrayBuffer`)
are unavailable — ORT would be single-threaded anyway. And the model is a single
linear layer (8×12 + bias), so it needs **no runtime at all**: `classifyChromaQuality`
rotates the chroma root-relative, max-normalises, and computes `softmax(W·x + b)`. This
is **identical in interface to an ONNX tensor pass** (`x[12] → {suffix, confidence}`),
so a real `.onnx` swaps in later by replacing ONLY that function's body — the arbiter,
the tests, and the future worker boundary stay unchanged. Weights are **embedded**
(tiny → offline-robust on iOS; the "fetch the .onnx asset" rule is for the heavy
future model).

**The model brain:** `scripts/train_chord_classifier.py` — a **dependency-free**
(stdlib-only, seeded) trainer. (The container it was written in had no numpy/sklearn and
couldn't pip-install, so it's hand-rolled; re-runnable to reproduce `CHORD_CLASSIFIER`. As of
2026-10-23 PyPI IS reachable from the cloud container — see "Audio → TAB engine".) It
synthesises root-relative weighted chromas with **realistic audio-ish augmentation**
(overtone bleed at the 5th/maj-3rd partials + dropped/spurious tones + per-sample gain)
and trains a model over the quality vocabulary. It grew in three steps: linear softmax
(8 classes, 89.5%) → 2-layer MLP over 14 qualities → **(Phase 3, 2026-06-20) a wider
2-layer MLP (tanh hidden 28 → softmax) over the FULL 22 engine qualities**
(`…add9·m(maj7)·6/9·9·m9·maj9·7♭9·7♯9`) → **~85% held-out, 22-of-22 canonical voicings
correct**. The MLP forward pass (`h = tanh(W1·x+b1); softmax(W2·h+b2)`) lives in
`classifyChromaQuality`; **swapping to ORT later means replacing only that body** — the
const shape (`W1/b1/W2/b2`), arbiter, readout and tests are the swap-stable boundary
(proven: these upgrades changed topology + vocab without touching any of them). On iOS
the pure-JS matmul is the *optimal* end state for a model this size — no WASM download,
no COOP/COEP wall, offline-robust — so ORT only earns its weight for a heavy future
(audio) model.

**Where it stands:** built, exported (`CHORD_CLASSIFIER`, `classifyChromaQuality`,
`arbitrateChord`), unit-tested (all 14 canonical qualities classify correctly), and
**wired DISPLAY-ONLY into the readout** (Phase 2 step 1, 2026-06-20): an `arb` memo in
`TabDecoderPro` runs `arbitrateChord(result, chromaVec)` on the live/selected chord and,
**only when `source==="classifier"`** (engine unsure < gate AND the model confidently
disagrees), renders a dashed "🤖 2nd opinion" line under the CONFIDENCE bar. It **never**
rewrites `symbol`/the chart — the displayed symbol stays `symbolOf(result)` — so the
validated corpus is still untouched (the transpile + contract tests pass unchanged). It's
browser-only render, so it wants a **device check** (does the line show on a genuinely
ambiguous voicing, hide on clean ones). Remaining: swap the pure-JS MLP for a real
`.onnx` (same shape) running via ORT in the Wave-1 worker — needs a non-CDN-blocked env
to fetch/test onnxruntime-web. `npm test` guards the engine pieces: each canonical quality classifies
correctly, root-relative works, and the arbiter contract holds (confident engine never
overridden; unsure engine + confident model adopts; `minModel` gate respected;
single/null bypass).

## Wave 3 #11 — pitch detection → transcription (DSP foundation, 2026-06-20)

The audio front-end's **pure DSP core**, built iOS-first (zero deps, no WASM). Lives in
`engine.tsx` (React/DOM-free → headless-testable with synthesized tones):

- **`detectPitch(samples, sampleRate, opts)`** — monophonic fundamental-frequency
  detection via the **YIN** algorithm (difference fn → cumulative-mean-normalised
  difference → absolute-threshold pick → parabolic interpolation). Returns
  `{ freq, midi, note, clarity }` or `null`. YIN (not naive autocorrelation) ON PURPOSE:
  it locks the **fundamental**, not a harmonic — verified on a low **E2 (82 Hz) with
  strong overtones** decoding to MIDI 40, the classic octave-error trap.
- **`transcribeMonophonic(samples, sampleRate, opts)`** — slides `detectPitch` over a
  buffer and groups stable same-MIDI frames (above `minClarity`) into note events
  `{ midi, note, startSec, durSec }`. The MVP: one line in → notes out.
- **`freqToMidi` / `midiToFreq` / `midiToNoteName`** — equal-temperament helpers
  (A4=69=440 Hz; note names honour the ♯/♭ table).

**The browser-only seam is mic CAPTURE** (`getUserMedia` + `AudioContext` → Float32
frames), exactly analogous to the PDF.js seam feeding the parser. It is now built as a
**`LiveTuner` component + a "Tuner 🎤" mode** (2026-06-20, browser-only glue in
`TabDecoderPro.tsx`; engine stays pure): a mic stream → `AnalyserNode`
(`getFloatTimeDomainData`, fftSize 2048, byte fallback for old Safari) → the pure
`detectPitch` on an rAF loop (throttled ~70 ms), rendering the live note, a ±50¢ tuning
meter, frequency and clarity. Heavily feature-detected + `try/catch` (mic missing /
permission denied → a clear message), `stop()` on unmount frees the stream + closes the
context. **Device-only verification** (can't headless-test mic) — smoke-test on hardware.
The pure DSP under it is validated (`npm test`: A4/E2/A2/C4/E4/B4 detect to the right
MIDI, silence → `null`, an A4→C5 buffer transcribes to two notes 69 & 72). This is the
shared substrate for **#12 Practice mode** (compare `detectPitch` output against the
chart's expected chord tones).

### StaffView — extracted note lines on a real staff (2026-07-15)

The Notes (bass/lead/vocal) results were a flat card list — musically illegible for
"which notes did it hear". Now they render on a **digital staff** first, cards (with
timestamps) second. Split along the usual seam:

- **Engine (pure, headless-tested):** `midiToStaffPos(midi, useSharp)` → `{ letter,
  acc, octave, name, diat }` — the spelling tables already encode the letter each pc
  sits on (C#4 keeps C4's line, Bb3 keeps B3's), so `diat = octave·7 + letter`.
  `staffLayout(midis, useSharp, opts)` → `{ clef, notes:[{midi, step, acc, name}] }`;
  `step` counts from the clef's **bottom line** (treble E4 / bass G2), +1 per
  line-or-space, so staff lines are even steps 0–8 and ledger lines fall out of
  step < 0 / > 8. Clef auto-picks **bass below G3 (median)**, `opts.clef` overrides.
- **UI (`StaffView` in TabDecoderPro.tsx, SVG only, no own math):** even left→right
  spacing (a *reading* view, not a proportional timeline), ♯/♭ accidentals, ledger
  lines, note-name captions, active-playback highlight + auto-scroll-into-view.
  Wired into the Audio panel's Notes view; `noteEvents` now carries `midi`.
- `npm test` covers the layout math (E4=step 0, middle C=−2, F5=8, C#/Db spelling,
  bass-register clef pick, override, empty input). Reuse it for any future melody
  view (ML voices, practice mode).

### Lyrics capture — honest status + mic-level meter (2026-07-15, bug fix)

The reported failure: the panel said "Listening…" while capturing nothing.
`SpeechRecognition` gives **zero feedback about the input signal**, and the old
`onend` auto-restart was `try { rec.start() } catch {}` — Chrome throws
`InvalidStateError` on an immediate re-start, so the session could die silently
behind a live-looking UI. Three rails now (all in `LyricsCapture`, browser-only):

- **Level meter** — a parallel `getUserMedia` + `AnalyserNode` tap (same seam as
  LiveTuner) renders a live RMS bar next to "Listening…". Optional: if it can't
  start, recognition still runs. On an `audio-capture` error the meter stream is
  released so the recognizer can claim the mic.
- **Two distinct diagnostics** — level ≈ 0 for >3 s → "no sound is reaching the
  microphone" (wrong input device / muted); repeated `no-speech` **with** signal →
  "sound arrives but the recognizer can't parse singing" (ASR is built for talking;
  suggest vocal-forward source / isolated stem). This separation is the point of
  the meter — don't collapse the two messages.
- **Restart that can't lie** — `onend` restarts async; on failure it rebuilds a
  fresh recognizer (`makeRec()`); if that fails too it surfaces an error and drops
  the listening state instead of pretending. `onresult` resets the no-speech count.

Device-only (live mic + browser ASR) — smoke-test on hardware; `npm test` covers the
transpile + module-split contracts.

### Lyrics IMPORT — chords-over-lyrics / ChordPro → clean lyrics-only sheet (2026-09-16)

The Lyrics mode is now **two sub-tools** (`LyricsPanel` switches them; default = Import):
the existing **Live capture** (mic ASR), and a new **Import** tool that takes a
**chords-over-lyrics** tab (the ultimate-guitar.com layout) **or** a **ChordPro** file,
**strips every chord**, and re-arranges the WORDS into a printable **lyrics-only** sheet
— centered/underlined section headers, left-aligned stanzas (the hymnal-page look in the
work-order photos). It is the **inverse of an authoring tool**: recognition here is text,
not audio, so it is fully deterministic and on-device.

- **Pure engine core (`parseLyrics` in `engine.tsx`, React/DOM-free, headless-tested).**
  `parseLyrics(text)` → `{ title, subtitle, sections:[{ label, blocks:[[line…]] }], plain }`
  (`blocks` = stanzas split on blank lines; `plain` = the formatted sheet text).
  `lyricsToText(parsed)` renders `plain` (UPPERCASE headers, blank line between stanzas &
  sections). Two dialects auto-detected **line by line** (a file may mix them):
  **ChordPro** — inline `[C]` tags stripped (`stripInlineChords`, closes the gap);
  `{title}`/`{artist}`/`{composer}` → header, `{sov}`/`{soc}`/`{sob}` (+ optional label) →
  sections; `{sot}…{eot}` tab blocks **skipped** (ASCII tab is not lyrics).
  **`{comment}`/`{c:}` is ambiguous and resolved by CONTENT (2026-09-16 fix):** a short
  section keyword (`{c: Chorus}`) is a header, but any other comment is a **lyric line** —
  because a real-world ChordPro export (Billy Joel "…rock 'n' roll to me") stores the whole
  song as chord-only `[bracket]` lines with the **words inside `{comment: …}`**. Treating
  every comment as a header (the original bug) made every lyric an empty section → "0
  sections, 0 lines". A whole-line bracket is dropped when it's chords via **`isChordBracket`**
  (splits on `_`/space, all parts chords) so a compound beat `[G_C]` or a run `[C Em Bb F]`
  is a chord, not a mislabelled section; `[Verse A]` (a real word) is still a label.
  **Chords-over-lyrics** — a monospace chord LINE above each lyric line is **dropped**;
  `[Verse]`-style and bare **Verse/Chorus/Bridge/Intro/Outro…** headers become sections.
- **THE load-bearing decision — chord-vs-word disambiguation.** `_parseSym` is too loose
  (its suffix is `.*`, so it reads the word "Cab" as C+"ab"), so this uses a **strict**
  matcher `_CHORD_RE` (root + a **tight suffix alphabet**: `maj/min/sus/add/aug/dim/m/M/Δ/
  ø/°/+/-/digits/#b/()` + optional `/bass`). That alphabet is what makes lyric words that
  START with a note letter (Add · Cab · Bad · Fed · Gem · Bee · Ace) fail to parse.
  Classification is then done **at LINE level** (`isChordLine`: EVERY token must be a chord
  or a repeat/barline marker `_CHORD_LINE_MARK` — `x2`/`(x2)`/`|`/`N.C.`/…), so **a single
  ordinary word protects the whole lyric line** ("Am I the only one" stays). This two-stage
  design is the invariant — do NOT relax it to a per-token or fractional test.
- **Documented ambiguity:** a lone `[A]`/`[B]` is BOTH a valid chord and a possible
  sub-section marker (photo 2's A/B). It is resolved toward **chord** (dropped); `[Verse A]`
  (inner is not a chord) is kept as a label. Single-letter sub-sections are the honest limit
  — write them as `[Verse A]` or edit after import. (The UI's panel note says so.)
- **UI (`LyricsImport` in `TabDecoderPro.tsx`, browser-only glue; engine stays pure):** a
  paste `<textarea>` + a file `<input>` with **NO `accept` attribute** (the same iOS UTI
  lesson as the GP/audio uploads — `accept` greys out `.cho`/`.crd`/`.pro`/`.chordpro`;
  `readFileText` reads anything as text). Live `useMemo(parseLyrics)` render of the sheet,
  a "Load example" button, and Copy / Download `.txt` (filename from the detected title).
- **`npm test` guards** (all pure, headless): `isChordToken` accepts real chords (slash /
  extensions / alterations) and rejects the note-letter lyric words; `isChordLine` catches
  chord lines (spacing, slash, repeat markers) and spares lyric/blank lines; a full
  chords-over-lyrics parse yields the right sections with chords gone; the ChordPro dialect
  captures `{title}`/`{artist}`, `{c:}`/`{soc}` sections, inline-chord stripping, and skips
  `{sot}…{eot}`; blank-line stanza splitting; the `[A]`-vs-`[Verse A]` ambiguity; and
  empty/null/all-chords input → no sections, no throw. Plus UI contract guards (imports
  `parseLyrics`, ships `LyricsImport`/`LyricsPanel`, the Lyrics mode renders `LyricsPanel`,
  the file input has no `accept`). React render itself is device-only (smoke-test on hardware).

### Lyrics IMPORT → Chord Sheet Maker Pro · Perform Lyrics handoff (2026-09-16)

Once `LyricsImport` has stripped the chords and extracted the words, a **🎤 Perform on
Chord Sheet Maker Pro** button (in the Copy/Download/Clear action row) sends the clean
lyric sheet straight to CSMP's auto-scrolling **Perform Lyrics** stage view — the two
apps used in tandem (recognize/strip here → perform there). Same GitHub Pages origin →
shared `localStorage`, so this is a **new same-origin handoff channel** alongside the
forward `csm:handoff:v1` (chart) and reverse `ttp:decode:v1` (raw file).

- **Contract `csm:lyrics:v1` + `?import=lyrics`** (mirror of the chart handoff):
  envelope `{ v:1, source:"tab-translator-pro", createdAt, title, artist, lyrics }`.
  `lyrics` is the **section headers + stanzas ONLY** (no title line — the title/artist
  ride as their own fields so CSMP seeds its Song title / Artist inputs, instead of a
  stray leading lyric line). Built in `sendToPerform` (`LyricsImport`, browser-only glue)
  by re-flattening `parsed.sections` (UPPERCASE labels, blank line between stanzas/
  sections — the same shape `lyricsToText` emits minus the title). `title` ←
  `parsed.title || fileName`, `artist` ← `parsed.subtitle`.
- `localStorage.setItem("csm:lyrics:v1", …)` then **same-tab** nav to
  `${origin}/chord-sheet-maker-pro/?import=lyrics` (mobile-popup-safe); try/catch so a
  failure can't wedge the UI. CSMP reads the key once, clears it, strips the param, and
  opens its Perform Lyrics modal pre-seeded (`consumeLyricsHandoff` in CSMP index.html →
  `PerformanceLyrics.openPerformanceLyrics(lyrics, title, artist)`). Because the body is
  plain UPPERCASE-header text, CSMP's `parseLyrics` re-detects the sections cleanly.
- Engine stays pure — this is sender glue only (no test change; the transpile guard
  covers the JSX). Device smoke-test: strip a chords-over-lyrics sheet → 🎤 → CSMP opens
  the stage view with the words + title.

## Audio → CHORDS from an isolated stem (2026-06-20)

"Upload an isolated instrument stem → get a chord/note sketch." The owner's pro workflow
already splits songs into stems (isolated guitar/piano/bass, drums ducked) — and isolation
is exactly what makes audio→chords tractable (a full mix's drums/vocals/bass mud wreck the
chroma). Two regimes, both reusing what we already have:

- **Chordal stem** (rhythm guitar, piano comping) → **`transcribeChords`**: PCM → FFT
  (`_fft`, pure radix-2) → fold the spectrum into a 12-bin **chromagram** (`pcmToChroma`,
  with light octave/5th/maj-3rd **harmonic suppression** so overtones don't fake chord
  tones) → peak-pick (`chordFromChroma`) → the SAME `recognise` engine. `detectChord` is
  one frame; `transcribeChords` slides + collapses to timed `{ symbol, startSec, durSec }`.
  **Noise control (a real rhythm+lead stem flips the chord every frame otherwise):**
  an **energy gate** (low-energy frames → rests, not garbage), a **chroma average over a
  ~`smoothSec` window** before recognising (a strum / passing lead note can't flip the
  chord alone), and a `minDurSec` blip drop. The UI uses `hopSec 0.12 / smoothSec 0.5`.
- **Monophonic stem** (bass, lead) → the existing **`transcribeMonophonic`** (YIN) →
  the note line / root movement.

All pure + headless-tested (synthesized chords: C/Am/G7 detect correctly, a C-major
chroma peaks at C/E/G, a C→G buffer transcribes to both; `_fft` peaks at the right bin).
Tuned defaults: `suppress 0.3`, `pickThreshold 0.4` (0.45 suppression over-damped the real
3rd/5th → power chords). **The only browser-only step is the audio→PCM decode** (Web Audio
`decodeAudioData`, which also extracts the audio track from a **video** container), wired in
the **`AudioImport` component + "Audio 🎵" mode** (`TabDecoderPro.tsx`): the file `<input>`
has **NO `accept` filter** (same iOS lesson as the Guitar Pro upload — `accept` maps to UTIs
and GREYS OUT valid MP3/M4A/WAV on iOS; even `audio/*,video/*` left only video selectable,
so it's dropped and `decodeAudioData` validates instead — MP3/M4A/WAV audio + MP4/MOV video,
audio track extracted); upload → decode → mono + downsample to 16 kHz → analysis run
**off-thread** (`analyzeAudioOffThread` via `_engineRPC`, main-thread fallback) → a chord/
note timeline with playback + a live highlight. **Device-only verification** (decode +
playback can't be headless-tested). HONEST LIMIT: clean isolated stems = good editable
sketch; dense voicings / a full mix mislabel.

**Simple (no-extensions) mode — audio over-labelling fix (2026-07-08).** Polyphonic audio
(esp. **3-part vocal harmony**) lights 4+ pitch classes per frame, so `recognise` reaches for
9ths/6-9/maj9/etc. and a plain **G · Em · F · Am** chorus comes back as **Gadd9 · Em9 · Fmaj9
· Am9** mush (validated on a real isolated-vocal stem of "25 or 6 to 4"). Fix: `recognise`
gained an **opt-in `opts.maxRank`** that skips qualities above a `rank` (basic triads/7ths/6/
sus are ranks ≤14; the jazz extensions add9/m(maj7)/6-9/9/m9/maj9/7♭9/7♯9 are ≥15). **DEFAULT
is undefined → zero filtering, so the tab/PDF/GP/XML oracle stays byte-identical** (the whole
validated corpus is untouched — guarded by a test). It threads `recognise` → `chordFromChroma`
→ `transcribeChords`; the Audio panel's **△ Simple** toggle passed `maxRank:14`, collapsing the
over-labelled soup back to the real skeleton. (**Superseded in the UI on 2026-10-25** by the
Chart / Basic / Full chord-vocabulary picker — see "Chord vocabulary" below; `maxRank` still works.) This is the fast, honest half-fix for vocal
harmony; the real answer is polyphonic per-voice note transcription (a chord *label* still
can't name the 3 sung notes — that's the next build).

### Per-voice note transcription — pure-JS ceiling + the ML seam (2026-07-10)

**Pure-JS multi-F0/melody transcription of dense vocal harmony was tried and DOES NOT work —
do not re-derive it.** ~7 approaches (harmonic-salience multi-F0 + iterative subtraction +
temporal tracking + note-grouping; predominant/top-voice melody + octave correction) were
prototyped against a real isolated **3-part** vocal stem. Findings (full write-up in
`docs/ML-NOTES.md`): multi-F0 gives clean triads on *some* sustained frames but often
octave-spread pairs / semitone clusters / fragmentation; melody has no single dominant line
on a **balanced** stack (argmax jumps voices, "highest" catches harmonics an octave up,
octave-snap over-corrects down). **Conclusion:** pure-JS recovers pitch *classes* reliably
(hence chords work) but **not octaves or voice separation** — the pure-JS ceiling is the
chord skeleton (Simple mode). Note-level per-voice transcription needs an ML model.

**The ML path (Spotify `basic-pitch`) — WIRED + SHIPPED 2026-08-22.** `basic-pitch` is a
small note model (not a 166 MB separator), so the iOS/Pages bet was winnable. `engine.tsx`
ships the drop-in decode half (pure, headless-tested): **`notesFromActivations`** (onset/
frame activation matrices → note events, faithful basic-pitch note-creation),
**`polyNotesToScore`** (note stacks → the shared `source:"ml"` score, so chart/exporters/
handoff work for free), and **`transcribeWithNoteModel(pcm, sr, model, opts)`**
(orchestrator over a pluggable model). The UI's **🎼 Voices (ML)** button (Audio mode)
calls it with `window.TTP_NOTE_MODEL` when present, else shows a clear "not configured"
message. The device-only seam is now filled by:
- **Vendored model files** at `models/basic-pitch/` (`model.json` ~175 KB + shard ~740 KB
  = ~915 KB total), redistributed verbatim from `spotify/basic-pitch-ts` under Apache 2.0
  + CC-BY 4.0 (NOTICE alongside). Same-origin → no CORS + Service-Worker-cacheable.
- **`note-model.js`** — browser-only glue (plain ES module, no Babel step). Loads
  `@spotify/basic-pitch` + `@tensorflow/tfjs@3.21.0` from esm.sh **lazily on first Voices
  (ML) tap** (deferred + cached; boot never pays for it), loads the vendored model, and
  publishes `window.TTP_NOTE_MODEL(pcm, sr, opts)` → `{ onsets, frames, frameRate:86.13,
  minMidi:21 }` — the exact contract `notesFromActivations` expects. Init errors clear the
  cache so a retry can actually retry. Linear-resamples the 16 kHz analysis buffer to
  basic-pitch's fixed 22050 (safe: all fundamentals up to C8 = 4186 Hz sit well below the
  16 kHz Nyquist). Wired in `index.html`; shipped by `pages.yml` alongside the app files.
- **Why TF.js, not ONNX**: Spotify already ships the browser-ready wrapper
  (`@spotify/basic-pitch`) with its own TF.js graph model + input harmonic-CQT features —
  so we get the exact blessed preprocessing free, skip re-porting ~200 lines of DSP, and
  hit the same iOS/Pages constraints ONNX would (WASM single-thread, no COOP/COEP). ONNX
  would have been more code we own for no functional win.
- **`npm test` guards** (in addition to the decode tests): the vendored files exist +
  `model.json` is a valid TF.js graph manifest referencing its shard, `note-model.js`
  publishes `window.TTP_NOTE_MODEL` as an async function returning the right shape, load
  is lazy + fail-silent + cleared on rejection, `index.html` wires it, and `pages.yml`
  ships it.
- **Device-only** (as always for this class of seam): first-tap load time on iOS Safari
  (~1.5 MB from esm.sh + ~915 KB same-origin), inference quality on real vocal-harmony
  stems, and iOS memory on very long stems — smoke-test on hardware. If quality
  disappoints, the first thing to try is feeding basic-pitch the ORIGINAL sample rate
  from `onFile()` instead of the pre-16k-downsampled buffer (one-line change in
  `voices()`). See `docs/ML-NOTES.md` for the full write-up.

### Voice separation — SATB heuristic on the ML notes (2026-08-22)

> **Superseded as the DEFAULT on 2026-10-11** by the voice-leading split — see
> "Vocal score v2" below. The register heuristic described here is still available as
> `splitVoices(notes, { method: "register" })`.

Basic-pitch's output is polyphonic but **unlabeled** — every simultaneous note lands in
one bucket, so a 3-part vocal-harmony stem reads as chords rather than three lines. The
zero-dep half-fix is the standard choral-analysis heuristic: at each time slice, sort
active notes by pitch DESCENDING and assign top→bottom to voice slots 0..V-1 (voice 0 =
highest / soprano). `engine.tsx` **`splitVoices(notes, { voices })`** does exactly that,
purely, headless-tested, composing with `polyNotesToScore` — filter the output by `voice`
and each subset builds its own score, so every existing exporter (MIDI/MusicXML/ABC/CSMPN/
ChordSlashML/handoff) works per-voice with no new plumbing.

**Voice CROSSINGS are handled** — a sustained note whose rank changes mid-way (a new
higher note enters, pushing the held note into the lower slot) is EMITTED AS TWO RUNS
(same MIDI, adjacent time spans, different `voice`) so each per-voice line stays
monophonic. Notes below the requested voice count are dropped (documented as likely
below-the-bass spurious detections). The algorithm is O(N·B) with N notes / B slice
boundaries and uses a `Map<note→index>` (not `indexOf`) so a 4-minute vocal doesn't hit
an accidental O(N²).

**UI (`AudioImport` in `TabDecoderPro.tsx`, browser-only glue; engine stays pure)** —
under the ML score, a "Split: 1 (all) / 2 / 3 / 4" chip row picks the SATB target, and a
"Voice: 1 (high) / 2 / 3 / 4" picker chooses which line renders. Split is derived from
the raw ML notes (kept in state) via `useMemo`, so switching the count or the displayed
voice is **instant — no re-inference, no re-download**. Voice 1 (single) falls back to
the original polyphonic score. Downloads apply to exactly the displayed voice's score.

**HONEST LIMITS (deliberate, of the legacy method):** (1) sort-by-pitch is register-based, so a genuine
crossing (a bass singer briefly above a tenor line) will swap slots — sung harmony rarely
crosses, so this is fine most of the time, and Edit fixes the rest. (2) The "one voice per
slot per slice" model drops notes above/below the outermost voices as spurious. (3) This
is the pure-DSP ceiling; **true voice-from-voice separation** (three clean audio streams
from a single mono vocal stem) would need a Wave-4 ML separator, same iOS/Pages wall as
the Demucs discussion above.

**`npm test` guards:** held triad → 3 voice notes correctly ordered (v0=high); voices:2
drops the lowest; sequential melody → all in v0; voice crossing splits a held note into
two runs assigned to the right voice at the right time; per-voice `polyNotesToScore`
round-trip preserves `source:"ml"` and voices the right pitch; empty/null/voices:0 safe.

### SATB → standard-notation multi-part score export (2026-08-23)

> **Upgraded 2026-10-11** ("Vocal score v2" below): range-based names + clefs, bracket,
> key-aware spelling, metric note values, rehearsal marks, learning-track MIDI. The
> `<words>` staff label described here is now opt-in (`labelStaves`), and ABC uses
> `%%score [1 2 3]`.

The SATB split above produced per-voice SCORES you could display/export **one at a time**,
but not a single readable **multi-staff vocal arrangement**. This adds that — a combined
`score-partwise` MusicXML (+ multi-voice ABC) with the **lead vocal on the top staff** and
backing voices below, sharing key/meter/barlines. **Purely additive**: the single-part
`scoreToMusicXML` (whose byte-output the whole validated corpus + the round-trip test
depend on) is **untouched**; these are new functions.

- **Engine (pure, headless-tested in `engine.tsx`):**
  - **`voicePartNames(n)`** — canonical labels, lead first: 1 voice → `["Lead Vocal"]`;
    otherwise `Soprano/Lead · Alto · Tenor · Bass` (>4 → `Voice N`).
  - **`_keyFifths(key)`** — circle-of-fifths accidental count for the `<key><fifths>` element
    (minor keys resolve via their relative major: Am→0, Cm→−3).
  - **`_clefForScore(score)`** — bass clef below median G3 (midi 55), else treble.
  - **`splitVoicesToScores(notes, opts)`** — composes the existing `splitVoices` +
    `polyNotesToScore` into `[{ voice, name, clef, score }]` in soprano→bass order. A voice
    slot with no notes is dropped (the honest "no backing detected → lead only"); `voices<=1`
    returns the single polyphonic lead. opts: `{ voices, bpm, beatsPerBar, beatType, useSharp }`.
  - **`scoreToMultipartMusicXML(parts, opts)`** — one `<part>`/staff per voice (parts[0] =
    top = lead). Emits `<divisions>` (≥480 per the task), `<key>` (fifths+mode), per-bar
    `<time>`, `<clef>`, a tempo `<direction>` + `<sound>`, and a `<words>` voice label above
    each staff's first measure. Each voice is monophonic: a bar is an optional leading rest +
    notes on their beats + a whole-measure rest for bars the voice doesn't sing — so **every
    part spans the same measure count and barlines align**. Enharmonic spelling follows the
    key when `useSharp` isn't forced (sharp keys→sharps, flat keys→flats).
  - **`scoreToMultipartABC(parts, opts)`** — the same voices as a `%%score`-grouped
    multi-voice ABC (`V:` per voice, lead first; empty bars → whole-measure rest `Z`).
- **UI (`AudioImport` in `TabDecoderPro.tsx`, browser-only glue):** under the Voices (ML)
  split/voice pickers, a **⬇ Vocal score (MusicXML)** + **⬇ ABC** row exports **ALL** voices
  at once (not just the displayed one) via `splitVoicesToScores` → `scoreToMultipart*`; key
  is `analyzeKey(lead)`, tempo/meter from the panel controls.
- **Sensitivity control (2026-08-23) — the load-bearing knob for backing harmony.** basic-pitch's
  default onset/frame thresholds (0.5/0.3) are tuned for a prominent LEAD; a quiet backing stack
  falls under them, so a 3-part stem comes back with the lower voices STARVED. Measured on the
  real "25 or 6 to 4" iso-vocal: **44/14/1** notes per voice at 0.5/0.3 vs **82/49/16** at
  0.4/0.25 vs **136/125/83** at 0.3/0.2. So `voices()` now runs the model ONCE, caches the raw
  onset/frame matrices on `ref.current.mlRaw`, and a **Sensitivity** chip row (Lead 0.5/0.3 ·
  **Balanced 0.4/0.25 = default** · Full 0.3/0.2) re-derives notes via `notesFromActivations`
  **without re-inference** (`applySens`) — instant. `notesFromActivations` already exposed
  `onsetThresh`/`frameThresh` opts; this just surfaces them. Too low (≈0.25/0.15 → 284 notes)
  starts inventing, so Balanced is the honest default.
- **Notation quantiser (16th grid)** — the on-screen chart's integer `beat`/`durBeats` grid
  is quarter-resolution and can collapse a dense bar's onsets to **zero-length** events (fine
  for the chart, invalid for notation — it produced `<duration>0`/ABC `/48` garbage). So the
  notation exporters DON'T use that grid: `splitVoicesToScores` also carries each voice's raw
  **`beatNotes`** (onsets/durations in beats), and `_voiceNotationMeasures(beatNotes, opts)`
  quantises them onto a **16th grid** (`_NOTE_GRID=4` ticks/quarter), enforces monophony
  (clips to the next onset, drops sub-tick micro-notes/re-articulations), splits notes+rests
  at barlines, and decomposes each span into standard **tied** note-values
  (`_noteValuesFromTicks`, greedy whole→16th incl. dotted) — so **every measure sums exactly**
  (what keeps the MusicXML valid + MuseScore-clean) and a held note renders as tied values
  (`<tie>`+`<tied>` in XML, `-` in ABC). `_scoreToBeatNotes` lets a caller pass `{ score }`
  instead of `{ beatNotes }` (tests). Works in quarter-based ticks so it generalises across
  meters.
- **Tempo/meter control in the Voices (ML) panel (2026-08-23).** BPM was only settable in the
  CHORDS panel, so the vocal-score export was stuck at the default. The Voices (ML) panel now
  has its own **♩=BPM (±1) + meter** control that feeds both the on-screen `mlDisplayScore` and
  the vocal-score export (both already read `bpm`/`bpb`). BPM is a property of the PERFORMANCE,
  not the clip — trimming a stem to a shorter excerpt keeps the same tempo — so the user sets
  the song's real BPM regardless of clip length and the bars/note-values quantise to it.
  Measured on the "25 or 6 to 4" stem: the same audio spans **15 bars at ♩=80 vs 26 at ♩=140**
  with different note-value spellings, so the right BPM is what makes the notation meaningful.
- **Honest limits (documented, not bugs):** there's **no tempo/downbeat detection on the vocal
  path** (vocal stems have weak transients, so beat-tracking is unreliable on them) — bpm/meter
  come from the Voices-panel control (default 120/4/4 per the work order). Even at the correct
  BPM the notation stays somewhat *busy* because onsets aren't snapped to a beat PHASE (no
  downbeat detection — CLAUDE.md documents that pure-DSP downbeat detection doesn't work) and
  singers phrase with rubato; clip starting on a downbeat + ✎ Edit clean up the rest. The voice split is register-based (rare genuine crossings show as
  swaps — Edit fixes them). Cross-bar held notes re-articulate on the split pieces only where
  the greedy decomposition needs it (ties added). Beat/downbeat detection to snap onsets is a
  clean future refinement (the engine already has `detectBeats`/`analyzeAudioChords`).
- **Validated on REAL audio (2026-08-23):** ran end-to-end in Node against the user's own
  isolated vocal stems — decode (ffmpeg for `.m4a`/AAC, `mpg123-decoder` for `.mp3`) →
  `basic-pitch` (vendored local model, TF.js cpu) → `notesFromActivations` →
  `splitVoicesToScores(voices:3)` → `scoreToMultipartMusicXML`. On **"25 or 6 to 4" (3-part iso
  vocals)** at Balanced sensitivity: 87 notes (MIDI 55–86), 3 aligned staves (82/49/16 across
  Soprano/Lead · Alto · Tenor), detected key **A minor** (conf 0.87 — the song's actual key), 23
  measures/part, **0 XML parse errors**, tied 16th-grid note-values, no degenerate durations
  (~seconds for a 45 s clip). A separate 3-part backing-vocal chorus decoded the same way.
  Sample committed at `docs/samples/25or6to4-vocal.musicxml` (+ `.abc`).
- **Sample deliverable:** `docs/samples/vocal_score.musicxml` (+ `.abc`) — lead + two backing
  harmony voices, generated from the engine.
- **`npm test` guards:** part labels + key-fifths math; a 3-part vocal → 3 aligned parts,
  well-formed XML (via `@xmldom/xmldom`), lead-first ordering, key/time/clef/tempo/label +
  real notated pitches present, `divisions=480`; an uneven-length voice stays aligned via a
  whole-measure rest; F-major spells midi 70 as B♭; ABC declares one `V:` per voice; a
  single-line stem yields one `Lead Vocal`/`Soprano/Lead` part.

### Vocal score v2 — rehearsal-ready choral score from separated vocals (2026-10-11)

**The ask:** once a vocal stem is split, export a vocal MusicXML score that ACCURATELY shows
each separated part on its own staff, easy to decipher at rehearsal, so every musician has
correct materials before the gig. Audit of the v1 path found four accuracy defects and a set
of engraving gaps; all fixed, every claim below measured on the real stems in the repo
(basic-pitch run headlessly via `@spotify/basic-pitch` + TF.js-cpu on the vendored model,
app-faithful 16 kHz → 22050 Hz path) and rendered with Verovio / validated with music21.

**1. Voice separation was the real accuracy bug — now voice-leading (`splitVoices` default).**
The register heuristic assigns rank r → voice r per slice, so whenever fewer parts sing than
the split count, every note slides into the TOP voice. On "25 or 6 to 4" (3-part iso vocals)
voice 1 spanned MIDI 55–84 with a mean step of 7.6 semitones and 37 leaps > a fifth — not one
singer. The new method (contig/voice-leading separation, after Chew & Wu 2004 / Kilian & Hoos
2002), pure + headless-tested:
- `_voiceSlices` (constant-active-set slices, sweep not O(N·B) scan) → `_voiceCenters` learns
  each voice's register from the FULL-texture slices (exactly V notes sounding).
- **Phase A, polyphonic slices:** an order-preserving DP (O(k·V)) — voices never cross inside a
  chord, a HELD note keeps its slot (cost 0), otherwise distance to the slot's reference pitch
  (last note, decaying to the learned register over `memorySec` 2 s); switching a held note
  costs `switchCost` 6; when k > V the DP drops the worst misfit (an octave ghost above the
  soprano), not the real bass.
- **Phase B, monophonic runs, assigned WHOLE** (contig linking): a run (one note at a time,
  broken by a chord, a silence > `runGapSec` 1 s or a leap > `runLeap` 9) goes to the ONE slot
  it links to best at the neighbouring chords + register fit. Without this a verse sung solo
  before a 3-part chorus was shredded 14/15/9 across staves; with it the lead keeps the verse.
- **Measured (3 voices):** 25 or 6 to 4 — mean step 7.6/7.3/4.7 → **3.9/3.4/3.8**, leaps >5th
  37/17/2 → **2/4/2**, emitted fragments 139 → 104 (86 source notes). Heart of Rock & Roll —
  voice-1 leaps 46 → 10. 6000 dense notes split + export in ~0.3 s.
- `suggestVoiceCount(notes)` = the largest k sounding together for ≥ 0.5 s AND ≥ 5 % of sung
  time; the UI pre-selects it (25 or 6 → 3, Heart of Rock & Roll → 2).
- **Do not** auto-remove octave "ghosts": measured on both stems, the upper note of an exact
  octave pair is as often the LOUDER one, so amplitude can't tell a model harmonic from a real
  octave doubling. The k > V drop handles the clear cases only.

**2. Parts named + clefed by RANGE** (`VOICE_TYPES`, `classifyVoiceTypes`, `_lineStats`):
S C4–A5 · A F3–D5 · T C3–A4 · Bar A2–F4 · B E2–E4. An order-preserving DP over the lines
(high→low; type never rises; repeats allowed → "Soprano 1/Soprano 2/Alto"). Clef follows the
type: S/A treble, **T treble-8vb** (`<clef-octave-change>-1`, ABC `clef=treble-8`), Bar/B bass.
`splitVoicesToScores(…, { naming })`: `"range"` (default) · `"harmony"` (Lead Vocal moved to the
TOP staff + Harmony / High/Low Harmony — how bands name parts; `leadVoice` picks the line) ·
`"numbered"` · `"satb"` (legacy positional). A stem with one detected line is "Lead Vocal".
`vocalRangeReport(parts, {key})` → span, tessitura (p10–p90), notes below/above the type's range.

**3. Key + spelling were wrong in real use.** The UI passed `useSharp:true`, forcing sharps,
so an F-major chart printed A♯ for B♭. Now:
- `keyFromNotes` — Krumhansl–Kessler on duration-weighted pitch classes (the right model for
  sung LINES; `analyzeKey` reasons about chord function). Compared KK / Albrecht–Shanahan /
  Temperley on the real stems: all three agree (25 or 6 → C major — same signature as A minor,
  the excerpt's pitch content really is C/E/G; Heart → E♭). The UI key picker overrides.
- `_keySpeller(key)` spells by SCALE DEGREE: major ♯1 ♭3 ♯4 ♭6 ♭7 (♯1 not ♭2 — V/ii is far
  commoner than the Neapolitan, so E♭ major's E is E♮ not F♭), minor ♭2 ♮3 ♯4 ♮6 ♮7. Double
  accidentals fall out (G♯ minor → F𝄪), octave computed from the letter (B♯3, C♭4).
- MusicXML now carries explicit `<accidental>` with per-bar carry (tied-over notes not
  re-inflected). **ABC was emitting WRONG PITCHES**: `midiToAbc` ignores `K:` and bar state, so
  under `K:F` a written `B` (meant B♮) is read as B♭. The multipart ABC now writes accidentals
  relative to the key with per-bar carry. (The single-part `scoreToABC` had the same latent
  bug — **fixed 2026-10-13**, see "ABC notation 2.1 compliance" below.)

**4. Metric note values** (`_meterLevels`, `_metricOK`, `_metricValues`): the greedy largest-
value fill hid beats (a dotted quarter on beat 2 crossing beat 3). Values are now chosen
greedily-longest-LEGAL against the meter's beat hierarchy (4/4 `[16,8,4,2,1]`, 6/8
`[12,6,2,1]` …): a value may cross a boundary only if it starts on one at least as strong,
except one-level syncopation (8-q-8, q-h-q); rests get no syncopation and no dots in simple
time. Plus `grid` (2 = 8ths, the UI default "readable"; 4 = 16ths) and `legatoBeats` (UI 0.5 —
basic-pitch releases sung notes early, so without it every syllable is "note + 16th rest";
measured −10…−25 % rests). A note between ½ and 1 grid step is kept at one step.

**5. Choral engraving + rehearsal materials** (`scoreToMultipartMusicXML`): part-group
**bracket with `<group-barline>no`** (vocal convention — room for lyrics), `<part-abbreviation>`,
per-part `<midi-instrument>` (Choir Aahs = GM 53, own channel, spread pan) so notation-app
playback is a rehearsal track, `<identification>` (composer/arranger/software), metronome in
the meter's beat unit (6/8 → eighth; `<sound tempo>` stays quarters), detected sections →
**boxed `<rehearsal>` marks** (top staff only) + a double barline before each, final
`light-heavy` barline, `barsPerSystem` → `<print new-system>` (UI: 4). ABC mirrors it
(`%%score [1 2 3]`, `snm=`, `"^Chorus"`, `||`, `|]`). **`scoreToVocalMidi`** — format-1 SMF,
conductor track (tempo/meter/key-sig/title) + one named Choir-Aahs track per part, timed from
the SAME quantised cells as the notation (ties re-joined); `emphasize` makes a **learning
track** (that part 112 vel / vol 127 / centred, others 64 / 72).

**UI (`AudioImport`, browser-only glue):** a "📄 Vocal score" panel under Voices (ML): Parts
naming chips (+ lead-line picker), Key (auto = KK, + all 24), Rhythm 1/8 · 1/16, Legato, the
per-part range check, and ⬇ Vocal score (MusicXML) · ABC · Rehearsal MIDI · Learning track
(displayed part). Voice-picker chips show the part names. Exports pass the detected
`sections` and `bpm`/meter (6/8 → `beatType 8`).

**Verified:** `npm test` (new block "Vocal score v2" — separation incl. the solo-verse case,
ghost drop, register learning, voice count, voice types/naming/clefs, KK key, spelling table,
metric values for 4/4 + 6/8, grid/legato, bracket/abbr/MIDI-instrument/treble-8vb/rehearsal/
double-bar/final-bar/system breaks/accidental carry/6-8 metronome, ABC key-relative pitches,
range report, SMF format-1 walk). **Real browser:** the actual app booted in headless Chromium
(CDNs routed to local React 18.3.1/Babel — the sandbox blocks unpkg/esm.sh), the real stem
decoded, real cached basic-pitch activations injected as `TTP_NOTE_MODEL`, panel rendered at
430 px, and the three downloads validated with music21 (0 malformed measures). Regenerated
samples: `docs/samples/25or6to4-vocal.{musicxml,abc}` + **`25or6to4-vocal-rehearsal.mid`**
(real stem, ♩=86 from the beat tracker) and `vocal_score.{musicxml,abc}` (synthetic lead + two
harmonies, verse-solo → chorus, rehearsal marks, G major with a ♯4).

**Honest limits (unchanged by design):** no lyrics (syllable alignment is a separate problem);
no downbeat detection on vocals (set ♩= and run 🔎 Detect sections); voices can't cross inside a
chord; a part singing alone far outside its learned register can still land on a neighbour —
✎ Edit fixes it; output quality is bounded by basic-pitch on the stem.

### ABC notation 2.1 compliance + the Alembic `.abc` collision (2026-10-13)

**The report:** the ABC download "is being read as Alembic 3D" — the open-source 3D-graphics
interchange format that also uses `.abc`. **Root cause: the extension, not the bytes.** iOS /
iPadOS / macOS resolve a file's type from its extension, and Apple's Model I/O framework
system-declares `.abc` as **Alembic** (`kUTTypeAlembic`), so a downloaded `song.abc` lands in
Files/Finder as a 3D object, Quick Look tries to render geometry, and ABC apps aren't offered.
Audited every ABC writer against the abc standard v2.1 (abcnotation.com; abcnotation.com itself
was DNS-blocked from the dev sandbox, so the rules were taken from the standard's text via
search excerpts + mirrors, and the output was then **verified with abcjs — the parser
abcnotation.com's own tools use — and music21**). Findings + fixes, all three ABC exporters
(`scoreToABC`, `scoreToMultipartABC`, and `scoreToBrassABC` through `scoreToABC`):

- **File header** (`_abcFileHeader`, standard §2): line 1 is the **file identification line
  `%abc-2.1`** (the `%abc` magic is what identifies ABC music notation, and the version makes
  readers apply 2.1 strictly), then **`I:abc-charset utf-8`** (utf-8 is the 2.1 default, but
  titles / part names such as "B♭ Trumpet" or "—" can be non-ASCII and pre-2.1 readers assume
  Latin-1), a `%` comment, and the **empty line** that must separate the file header from the
  first tune's `X:`. No BOM (the standard says readers should ignore one; we don't emit it).
- **Media type**: `ABC_MIME = "text/vnd.abc"` (IANA-registered, the type the standard
  prescribes). The ChartPanel download used to send ABC as `text/plain`.
- **The Alembic collision** (`useAbcExt` / `_isApplePlatform` / `abcMimeFor` /
  `AbcExtToggle` in `TabDecoderPro.tsx`, browser-only glue): the standard itself names `.txt` as
  the fallback where a system restricts file types, so on **Apple platforms** downloads save as
  **`song.abc.txt`** (`text/plain;charset=utf-8` — plain text: previews, shares, opens in any ABC
  app; `.abc` stays visible in the name), elsewhere the standard **`song.abc`**
  (`text/vnd.abc;charset=utf-8`). A one-tap "use .abc / use .abc.txt" toggle sits next to both
  ABC downloads (chart export + vocal score) and is remembered per device (localStorage,
  try/catch — a convenience only). The vocal panel also gained **⧉ Copy ABC** (paste straight
  into abcnotation.com / abcjs / any ABC app — no file type involved at all).
- **Wrong pitches in the single-part ABC (the follow-up flagged in Vocal score v2).**
  `scoreToABC` wrote pitches with the K:-blind `midiToAbc`, so in `K:E` a G♮ written `G` sounded
  G♯, and `^C … C` in one bar sounded C♯ twice. It now spells with `_keySpeller(key)` and writes
  every pitch **relative to K:** via `_abcPitch`.
- **`K:` names disagreed with the notes** in two minor keys: the family-default names `Ebm` /
  `Abm` mean 6/7 **flats** in ABC, while the notes were spelled against D♯m/G♯m's sharps.
  `_abcKeyName(key)` now names K: with the same speller (`D#m`, `G#m`, `Db`, `F#`, …).
- **Accidental carry must survive every reader** (`_abcAccidentalTracker`). ABC readers disagree
  on how far an accidental reaches — the 2.1 `%%propagate-accidentals` directive has three
  settings (not / octave / pitch), abcm2ps historically carried per octave, and **music21 does
  not carry at all** (measured: it read `=B,3/2 … B,/2` as B♭). So the ABC writer prints an
  accidental whenever a note differs from the key signature OR from what an earlier accidental
  in the bar would carry under the pitch-class or same-octave rule; a note equal to all of them
  stays bare. Cost: an occasional courtesy accidental on a repeated chromatic note. MusicXML
  keeps standard engraving (`_accidentalTracker`) because its pitches are absolute.
- **No-chord text**: the engine's `—` placeholder is written as `"N.C."` (`_abcChordName`).

**Measured** (round-trip: every exported pitch parsed back by **abcjs**, `setUpAudio({chordsOff})`,
vs the score's MIDI; old exporter → new): Blue Sky (K:E) 2 → **0** wrong pitches, Peg 8 → **0**,
Anthropology (K:B♭) 32 → **0**, Au Privave (K:F) 8 → **0**, Yardbird 9 → **0**, the same tune
forced into D♯m / G♯m 378 / 380 → **0**. **0 abcjs parse warnings** on every file, including the
multi-voice vocal samples and brass ABC. music21 agrees (0 wrong) everywhere except Blue Sky,
where music21 itself duplicates notes after the inline `[M:4/4]` meter change (the file has
exactly 914 pitches; abcjs reads 914) — a music21 parser limit, not ours. Real browser (headless
Chromium, iPhone UA vs desktop UA): the vocal **and** chart ABC downloads save as
`25or6.abc.txt` on iPhone and `25or6.abc` on Linux, the toggle flips and persists, and the bytes
start with `%abc-2.1`, no BOM. **Device-verified 2026-10-13:** the owner confirmed on a real
iPad that the ABC download now saves and opens as ABC text (no longer as an Alembic 3D file).

**`npm test` guards:** line 1 `%abc-2.1`, `I:abc-charset utf-8`, empty line before `X:`, header
order X: → T: → K:, `ABC_MIME`, multi-voice header, `_abcKeyName` (D#m/G#m/Db/F#/Bb/Am),
K:E `=G` / re-sharpened `^G` / bare `G`, reader-robust carry (`^C ^C =C ^c` in one bar; F major
`B`→`=B`→`=B`→`_B`), `"N.C."`, brass header + `K:D` + `%%MIDI program`, and UI guards (Apple
`.abc.txt` default, `abcMimeFor`/`ABC_MIME`, both download sites carry the toggle). One existing
expectation changed on purpose: the multi-voice F-major test now reads `=B =B _B` (the second
B♮ is restated, so no reader can hear it as B♭).

### Center-channel (vocal) isolation — score sung harmony from a full mix (2026-07-07)

For scoring **vocal harmony parts** without an external stem splitter: lead + backing
vocals are almost always mixed to the **center** (equal in L and R) while instruments are
panned to the sides, so isolating the center pulls a usable vocal stem — the classic
karaoke/azimuth trick, done right in the spectral domain, **zero deps / no model**.

- **`extractCenter(left, right, sampleRate, opts)`** (pure engine, reuses `_fft` + a new
  **`_ifft`** = conjugation trick): STFT (Hann, 75% overlap) → per-bin **center weight** →
  overlap-add ISTFT back to time. The weight is `coherence · phase^panExp` where
  `coherence = 2|L||R|/(|L|²+|R|²)` (→1 when the channel magnitudes match, →0 when the bin
  is panned to one side) and `phase = max(0, Re(L·conj R)/(|L||R|))` (→1 in-phase/mono,
  →0 out-of-phase); the kept spectrum is that weight × the mid `(L+R)/2`. `opts.minFreq`
  is a mild high-pass to trim centered kick/bass leak.
- **Feeds the SAME `transcribeChords`/`recognise` path** — an isolated vocal chart is just
  the existing Audio-mode pipeline run on the center-extracted signal, so Edit / all 6
  exporters / the Pro handoff work for free. No new plumbing.
- **UI (`AudioImport`, browser-only glue):** the decode path now keeps **both channels**
  (downsampled to 16 kHz) instead of pre-downmixing; a **🎤 Isolate vocals** toggle runs
  `extractCenterOffThread` (via `_engineRPC`, main-thread fallback — pure DSP, DOMParser-free
  so it's worker-safe) → the analysis buffer becomes the isolated center. Toggling re-runs
  without re-decoding (cached L/R). Playback stays the original mix (we only reconstruct the
  16 kHz analysis signal, not a full-rate stem).
- **Validated (`npm test`):** synthesized stereo with a **centered A4** + a **panned-left
  E4** → `extractCenter` keeps A (chroma pc9 > 0.9) and **drops the panned E** (pc4 < 0.15),
  and a purely centered signal reconstructs ~unchanged (energy ratio ~1.0, proves the ISTFT
  normalisation). Decode/playback stay device-only.
- **Edge-burst bug, fixed 2026-10-24.** Frames started at sample 0, so the first/last samples sat
  under only a window's near-zero tip and the overlap-add divided by ~1e-8. With the app's
  `minFreq: 100` high-pass that amplified the masked spectrum's leakage into a burst at the START of
  every isolated file: a 0.4-amplitude 110 Hz tone peaked at **1429** (44.1 kHz) / **41.7** (16 kHz),
  ~3× a guitar recording's whole energy. Frames now start `N−hop` before 0 and run past the end (same
  grid, interior unchanged; every sample gets the full overlap). The old identity test only looked at
  the middle of the signal; the new one checks the edges at 110/220/440 Hz with the high-pass on.
- **Not for Guitar → Tab (measured 2026-10-24, 30 GuitarSet tracks, the shipped int8 CRNN, fixed
  engine):** note F50 raw **83.27** → isolated **82.72** with the guitar centred, **82.72** with it
  panned (L 1 / R 0.35, where isolation also throws away 62 % of the guitar's energy). Meanwhile
  `harmonicClarity` went UP (0.676 → 0.683), so the **A/B clarity number does not predict tab
  accuracy** — it measures chord-shaped chroma, not whether notes survive. In a real mix it is worse
  than this test: isolation keeps the centred vocal/bass/kick and drops a panned guitar. For tab, use
  the raw recording or a separated guitar ("other") stem, with Isolate OFF.
- **HONEST LIMIT:** center extraction is an approximation — **centered non-vocal content
  (kick/snare/bass) leaks in**, and a mono file is a near-passthrough. True separation from
  any mix is an ML model (Demucs/MDX-class) = a Wave-4 bet against the iOS/Pages no-WASM-
  threads wall. This is the zero-dep 80/20 that works today on centered-vocal mixes.

#### A/B clarity — is isolation (or a heavy separator) worth it on THIS file? (2026-07-07)

Before betting on a 166 MB Demucs/MDX ONNX model, **measure whether even the free
center-extraction helps a given file** — that answer gates whether the ML path is worth
pursuing at all. **`harmonicClarity(samples, sampleRate, opts)`** (pure, reuses `pcmToChroma`)
scores how legible a signal's harmony is, 0..1: per energy-gated frame it takes the chroma's
**inverse participation ratio** `pr = (Σc)²/Σc²` (the effective # of lit pitch classes) →
`(12−pr)/11`, meaned over active frames. A clean chord concentrates energy in a few pcs
(high); drums/bleed/reverb spread it flat across 12 (low). It's a **RELATIVE** gauge — a
clean synth triad reads ~0.44 (spectral leakage sets a floor), noise ~0.19 — so the **delta**
between two versions of the same signal is the read, not the absolute.

- **UI (`AudioImport`):** a **⚖ A/B clarity** button (stereo files only) runs
  `harmonicClarityOffThread` on the raw downmix vs. the center-extracted signal and shows
  both + the % delta with a verdict: isolation helps here (worth 🎤, and if it's still not
  clean enough that's the case where a heavy separator might pay off) / isn't improving
  clarity (vocal not centered or already clean — a separator likely wouldn't help either).
- **Validated (`npm test`):** a clean triad reads higher than the same triad + broadband
  noise, noise reads lower than a chord, silence → 0, and the A/B on a **centered triad +
  left-panned noise** confirms `harmonicClarity(extractCenter(L,R)) > harmonicClarity(downmix)`
  — i.e. the metric detects isolation removing the panned mud.
- **Purpose:** this is the decision instrument for the Demucs question — run it on real
  material first; if center-extraction already clears the harmony, the heavy model isn't
  needed; if isolation helps but isn't enough, that's the evidence to justify the ML bet.

**Audio → editable chart + export (2026-06-20).** A chordal stem no longer dead-ends at a
timeline: **`audioEventsToScore(events, { bpm, beatsPerBar })`** (pure, tested) quantises
the timed chord events onto a beat grid → the SAME score shape every parser emits
(`source:"audio"`, carries voiced `midis` from `detectChord`/`recognise`). So the Audio
mode renders the recognised stem through the **full `ChartPanel`** — Edit, transpose,
**all 6 exporters, and the → Chord Sheet Maker Pro handoff** work for free. A **♩=bpm +
time-sig control** re-quantises live (no re-analysis) so the user lines the bars up; no
tempo *detection* yet (beat-tracking is the next DSP step). Tests: events at 120bpm →
`C G | Am` with correct beats, voiced midis carried, exports to CSMPN/MIDI, and the bpm
changes the bar count. Remaining: tempo/beat detection, and optional **two-stem fusion**
(a bass stem for the root + a chordal stem for the quality).

#### Killing the false N.C. bars (2026-08-01)

An audio-decoded chart came back littered with `N.C.` bars. Diagnosed against the real
Peg stem, they were **two unrelated bugs**, neither of them "the audio had no harmony":

**1. A sustain was exported as "no chord" (`audioEventsToScore`).** Bars were keyed off
chord **onsets** only, so every bar inside a multi-bar hold had no event and exported as
`N.C.` — at 160 bpm that was **9 of 14** N.C. bars. A bar with no onset but *covered* by a
sustaining event now carries that event at beat 0, flagged `held`. `scoreToCSMPN` then
collapses it to `%` (simile) via its existing prev-cell rule, and playback/MIDI/ABC
sustain instead of dropping to silence. A bar **no** event covers is still left empty —
genuinely unlabelled must stay honestly N.C. Unconditional (it's a data-loss bug, not a
feature).

**2. `recoverChordGaps`** (new, **opt-in** via `recoverGaps`; the Audio panel passes it) —
a guarded second look at the spans the main pass left unlabelled. Most are not silence:
the chord's 3rd/5th sat under `pickThreshold` (0.4) after harmonic suppression, or the run
lost the sub-`minDurSec` blip filter.

The **design mistake worth not repeating**: v1 averaged the chroma over the *whole* gap.
A gap is often 2–3 s and spans a chord CHANGE, so the average is a blend of two chords —
Peg's five surviving gaps scored **0.33–0.44** confidence, below any honest floor, and
recovered nothing. It now re-labels the gap **frame by frame** with the same smoothed
sliding window the main pass uses, then collapses runs; the constituent runs read
0.55–0.75. Guardrails (each revert-tested — removing it fails a specific test):
- the span must carry real sound (`recoverMinVoiced` of non-gated frames) → a rest stays a rest;
- the smoothing window is **clamped inside the gap**, so a neighbour's chroma can never
  bleed across the boundary and be re-emitted as "recovered";
- each run must clear `recoverMinConfidence` (mean Jaccard, 0.45) **and** last at least
  `minDurSec` — the *same* blip filter the main pass applies, so recovery can never emit a
  label the primary path would have discarded;
- only gaps ≥ `recoverMinGapSec` (1.5 s) are considered. A short gap just leaves the
  previous chord ringing — it never stranded a bar, so filling it buys nothing and costs a
  spurious change. **Without this guard Peg went 227 → 341 chord slots** (bars like
  `Bb7_Bb7_A7_A_E7sus4_Bb7_C7`) to remove five N.C. bars — unusable.

Measured on the real Peg stem (the user's own isolated-instrument split), both fixes:

| bpm | N.C. bars before → after | chord slots before → after |
|-----|--------------------------|----------------------------|
| 100 | 5 → **1**  | 227 → 233 |
| 110 | 6 → **1**  | 228 → 233 |
| 120 | 5 → **3**  | 227 → 232 |
| 140 | 11 → **3** | 233 → 236 |
| 160 | 17 → **5** | 239 → 243 |

~70–80% fewer N.C. bars for ~2% more chord slots, and **zero** remaining N.C. bars are
held-over — every survivor is a span where the chroma genuinely never settles (the label
flips every 0.26 s). **That is the honest floor: naming those would be inventing.** Do not
chase them by lowering the confidence floor or the min-duration — that is exactly the
chord-soup regression measured above.

### Beat tracking + beat-synchronous Viterbi decoding (2026-08-02)

The two things the audio decoder was missing that every serious chord-recognition
system has. Both pure DSP/DP — no model, no deps, iOS-safe.

**1. Beat tracking (`detectBeats`).** There was NO tempo detection: `audioEventsToScore`
quantised onto a grid the user dialled in by hand, so the whole bar structure hung off a
guess — the SAME Peg analysis gave 5 N.C. bars at 120bpm and 17 at 160bpm, identical
audio and chords. Classic Ellis pipeline: spectral-flux `onsetEnvelope` →
`estimateTempo` (autocorrelation × a log-Gaussian tempo prior, which is what stops it
locking to half/double time) → `trackBeats` (DP over onset strength + a log-ratio
tempo-deviation penalty). Reads **117.7bpm on Peg, whose .gp4 says 117** (0.6% error).

  **The load-bearing detail:** the onset envelope is normalised to **unit std**. That is
  not cosmetic — `tightness` trades onset strength against tempo steadiness, so they must
  share a scale. Un-normalised, a loud mix makes onset strength dwarf the penalty and the
  DP packs beats at half the period: Peg *reported* 117bpm while laying **685 beats in
  240s (=171bpm)**. Guarded by a test that asserts beat spacing matches reported tempo.

**2. Beat-synchronous chroma + Viterbi (`transcribeChordsBeatSync`).** The sliding path
labels each window independently and collapses identical neighbours — nothing in it knows
chords LAST, which is why an ambiguous span flips every 0.26s (`Bb7 · C#7 · Bb7 · E7 ·
Edim · Eb7 …`, no run confident). No confidence floor fixes that; the problem isn't the
threshold, it's that there's no continuity model. So: average chroma **between beats**
(`beatSegments`) and decode the whole sequence with **Viterbi** over (root × quality)
states plus a no-chord state (`viterbiChords`). Transition is uniform-except-self, so the
recursion is O(T·S) not O(T·S²). Every chord boundary lands on a beat by construction.

**3. Bass-register chroma for the ROOT.** `beatSegments` computes a SECOND chroma over
40–250Hz with no harmonic suppression. The summed full-spectrum chroma says which pitch
classes sound but not which is the root; the bass says exactly that. Emission = cosine to
the chord template + `bassWeight` × (bass evidence for that root). **Too much hurts** —
the bass walks and plays passing tones; measured optimum 0.15 (0.4 and 0.6 both regress).

**Measured — the honest way.** Ground truth is the real `Steely Dan - Peg.gp4` rhythm
guitar, **time-aligned to the MP3 with the existing DTW aligner** (confidence 0.70, well
above the 0.35 adoption bar), then sampled every 0.1s MIREX-style:

| method | covered | root % | majmin % | events |
|---|---|---|---|---|
| sliding window | 61% | 25.8 | 24.8 | 231 |
| **beat-sync + Viterbi** | **100%** | **38.7** | **35.8** | 226 |
| **+ key prior** | **100%** | **40.2** | **37.4** | 222 |
| **+ HPSS** | **100%** | **53.0** | **51.4** | 132 |

+50% relative root accuracy, +44% majmin, and full coverage. Tuned defaults
`changePenalty 0.08` / `bassWeight 0.15` come from sweeping both against that metric.

**Do not tune against "% of decoded time that is a chord the tune actually uses"** — that
metric *rewards over-smoothing* (one 62-second `Em7` scores brilliantly on it). It's why
the first sweep looked best at `changePenalty 0.28`, which produced 32 events for a
240-second track. Only the time-aligned frame-level metric distinguishes them.

**`analyzeAudioChords`** is the panel entry point: beat-sync with an automatic
sliding-window fallback when no pulse is found, returning `{ events, bpm, beats, method }`
— so **the ♩= control is filled in from the audio** instead of guessed. Runs off-thread
(`analyzeChordsOffThread`, main-thread fallback). ~2s for a 4-minute stem in Node.

**4. Key prior (second pass).** A tune mostly uses chords built from its scale. Decode
once, read the key off THAT with the existing validated `analyzeKey`, then re-decode with
a diatonic bonus scored as the FRACTION of the chord's pitch classes in the key's scale —
no chord-function table, so it handles 7ths/extensions and *tips* rather than bans (a real
secondary dominant still wins if the audio supports it). Skipped when the key reading is
weak (`keyMinConfidence` 0.5), so a modulating tune isn't forced into one key. Peg reads
**E minor, confidence 0.88**; measured gain root **38.7% → 40.2%**, majmin 35.8% → 37.4%
at the tuned `keyWeight` 0.1. Modest but consistent and free — and `analyzeAudioChords`
returns the detected `key` for the UI.

#### Narrow half-diminished bass rule + inversions in the beat-sync path (2026-08-02)

**`m6` vs `m7♭5`.** A minor-6 and the half-diminished 7th a minor-3rd below are the SAME
four pitch classes (`Am6` = A C E F# = `F#m7♭5`), and `m6` (rank 10) out-ranked `m7♭5`
(rank 12) — so the m6 reading always won. The **Tristan chord** (F B D# G#) read
`Abm6/F` instead of `Fø7`, and B D F A read `Dm6/B` instead of `Bø7`.

`recognise` now takes a **deliberately narrow** bass-priority tie-break: when the chord
reads as `m6` AND the bass is exactly root+9 (i.e. it is in root position as a half-
diminished), it is relabelled `m7♭5` on the bass. Only that one pair, only that one bass
relation, so no other quality's ranking moves — verified: major/m7/maj7/7/dim7 and the
long-standing `{C,E,G,A}`/C → `Am7/C` reading are all unchanged, and root-position `Am6`
/`Cm6` stay put. `opts.halfDimBass:false` restores the old behaviour.

This **deliberately changed two pinned corpus expectations** (Yardbird `Am6/F#` →
`F#m7♭5`, `Gm6/E` → `Em7♭5`). Both are the correct jazz reading — the iiø of a minor
ii–V — and `Am6/F#` is what a naive analyser emits.

**Inversions in beat-sync.** The sliding path produced slash chords (via `recognise`'s
bass rule) but `transcribeChordsBeatSync` emitted plain root-position symbols — a real
loss for a fake book. It now names the inversion from the run's dominant bass pitch
class, **only when that pc is a chord tone**, which is what stops a walking/passing bass
inventing a slash. 58 of Peg's 222 events carry an inversion. `opts.slash:false` disables.

**Bass resolution depends on the sample rate — don't test this at 44.1k.** The panel
downsamples to 16k before analysis; a 4096-pt FFT gives 3.9Hz bins there but 10.8Hz at
44.1k, where E2 (82.4Hz) and F2 (87.3Hz) fall in the SAME bin and the bass band cannot
tell them apart. A fixture written at this test file's 44.1k SR reports an E2 bass as F —
a property of the fixture, not the code. The inversion tests pin 16k for that reason.

#### HPSS — drums out of the chroma before recognition (2026-08-02)

The single biggest remaining pure-DSP win. Sustained pitched content forms HORIZONTAL
ridges in a spectrogram; transients form VERTICAL ones. So a median along **time**
estimates the harmonic part, a median along **frequency** the percussive part, and a
soft Wiener mask splits them (Fitzgerald 2010). Drums otherwise dump broadband energy
into every chroma bin — and a kick/snare on the downbeat is exactly where a chord label
is most likely to be read.

`harmonicChromagram` does this and folds straight to chroma — **no resynthesis**, since
we only ever need the chroma. That also makes it *cheaper* than the per-frame path it
replaces, which recomputed an FFT per frame anyway. Default on for beat-sync
(`hpss:false` opts out).

| | root % | majmin % | events |
|---|---|---|---|
| before HPSS | 40.2 | 37.4 | 222 |
| **with HPSS** | **53.0** | **51.4** | 132 |

Note the event count also settles to 132 over 240s = 0.55 changes/s, right at the
one-chord-per-bar rate for a 117bpm 4/4 tune — cleaner chroma lets Viterbi hold.

**Kernel sizes were SWEPT, not guessed, and that mattered enormously.** The naive
defaults (0.4s time kernel / 17 bins) gave 42%; the plateau is **tk ≈ 21–23 frames
(~2.5s) / kf ≈ 9 bins** → 53%. The time kernel is stored in SECONDS (`hpssTimeSec`) so
it adapts to `hopSec`. Swept on ONE file, so treat the exact numbers as a plateau centre,
not a global optimum.

**Performance:** the median is the hot path (~1M calls for a 4-minute track). Insertion
sort into a preallocated buffer instead of `slice()+sort(comparator)` took it from 11.2s
to **3.2s**, byte-identical output — no per-call allocation, no comparator dispatch.

#### HPSS also feeds the Play-Along aligner (2026-08-02)

`pcmChromaSequence` takes an opt-in `hpss`, so the DTW aligner behind Play-Along can use
the same drum-suppressed chroma. Engine default stays **off** (the aligner's behaviour is
pinned by tests); the UI call site passes `hpss:true`.

Measured on the real Peg stem against its `.gp4`:

| chart | plain | HPSS |
|---|---|---|
| correct (rhythm guitar) | 0.697 | **0.753** |
| Electric Piano | 0.656 | 0.696 |
| Bass guitar | 0.522 | 0.568 |
| transposed +6 (wrong) | 0.504 | 0.483 |
| transposed +1 (wrong) | 0.594 | 0.616 |
| **margin (correct − best wrong)** | 0.103 | **0.137** |

The margin widening is the part that matters — raising the true match alone would be
worthless if it raised false matches equally.

**Known limit, pre-existing and NOT introduced by HPSS:** a *near-miss* chart (the same
tune transposed a semitone) scores **0.616**, well above the 0.35 adoption threshold. So
the confidence gate catches a wholly wrong stem but not a near-miss. Raising the gate to
~0.65 would separate them on this file, but that is tuned on one file and risks rejecting
genuine-but-noisier takes — left alone deliberately; revisit with more real material.

#### Viterbi parameters were re-swept after HPSS and did NOT move

Worth recording so it isn't redone: `changePenalty 0.08`, `bassWeight 0.15`, `keyWeight
0.1` are all still at their optima on the cleaner post-HPSS chroma. One number did change
meaning though — **`bassWeight:0` now costs 9 points** (53.0% → 43.8% root), where before
HPSS the bass term was worth ~3. Drum suppression makes the bass band far more
informative, so the two changes compound.

#### Tuning correction was measured and is NOT worth it

Recordings drift from A=440, which would smear chroma bins. Measured deviation via
parabolic-interpolated spectral peaks: Peg **−4.9 cents**, blues **−7.2**, Wagner
**+3.5**. All far inside a semitone (100 cents), so the nearest-semitone binning is
unaffected. Don't build tuning correction for this material.

#### Downbeat detection was tried and DOES NOT work with pure-DSP cues — don't re-derive it

Beat tracking finds the pulse but not where **bar one** is, so barlines can sit a beat or
two off even when the chords are right. Two principled cues were implemented and measured
against real files; **both are near-chance, and the work was reverted rather than shipped.**

1. **Harmonic cue** ("chords change on downbeats"). Measured phase distribution of chord
   changes across the 4 beat positions on the Peg stem:
   - our decoded chords: **26% / 16% / 31% / 27%** (25% = chance)
   - the **time-aligned ground-truth** `.gp4` chords: **22% / 20% / 29% / 30%**

   The premise is simply false for this music — Peg's harmonic rhythm puts changes on
   beat 3 as often as beat 1. Note the ground truth is barely better than our decode, so
   this is NOT a "our chords are too noisy" problem; the cue itself carries no phase.

2. **Percussive cue** (downbeats are louder). Per-beat band energy by phase, same file:
   - kick 40–120 Hz: 73/99/**100**/74 → peak at phase 2
   - low 120–250 Hz: 87/**100**/97/91 → peak at phase 1
   - snare/hat 2–6 kHz: 98/98/91/**100** → peak at phase 3

   Three bands, three different answers. No coherent downbeat.

Across all three real files the resulting confidence was Peg **0.081**, Wagner **0.027**,
blues **0.286** — and the blues "success" is a false positive: its change distribution
(22/19/30/29) is no better than the others, the score just cleared an arbitrary threshold
on the energy term. A confident-but-wrong barline is **worse than none**, because it
shifts every bar in the chart.

**Conclusion:** modern downbeat trackers are learned models (RNN/CNN over spectral flux +
chroma), not DSP heuristics, and that is why. If downbeats are wanted, that is the route —
along the same seam as the `basic-pitch` note model. Do not bolt a phase-guesser onto the
beat tracker.

**Honest limits.** This does not rescue a dense full mix — the Wagner prelude labels 96%
of its duration but the vocabulary histogram still reads like mush being force-named.
Isolated stems remain the sweet spot. And 38.7% root accuracy is well under the 70–80%
published systems reach on pop: the remaining gap is a key/harmony prior, downbeat
detection, and the fact that the ground truth here is one partial rhythm-guitar part.

### SynHarmonics v2 — isolated-stem chord recognition, now the DEFAULT (2026-10-21)

The *SynHarmonics Engine v2.0* spec (an expert critique of a v1.0 proposal) applied to this
app's constraints. **Full write-up, ablations and the spec-by-spec mapping: `docs/SYNHARMONICS-V2.md`.**
`analyzeAudioChords` now routes to **`analyzeAudioChordsV2`** by default; `engine:"v1"` keeps
the HPSS-chroma + Viterbi path described above **byte-identical** (all its tests still pin it).
The legacy sliding-window knobs (`hopSec/smoothSec/recoverGaps`) are v1-only — the UI no
longer sends them.

- **Benchmark first (v2 §8 "falsifiable").** `tests/bench` renders 28 comp/rhythm tracks from
  the repo's GP files as isolated stems (exact-pitch Karplus–Strong guitar, inharmonic piano,
  organ) × 5 conditions (clean / 20 dB noise / RT60 1.4 s room / +40¢ / drum+bass bleed),
  ground truth = the oracle's name for the NOTATED voicing, MIREX-style metrics. **Even indices
  = dev (all tuning), odd = test (reported only).** `npm run bench`, `npm run bench:calib`.
  Held-out result: **root 54→76, majmin 47→76, sevenths 42→70, exact pcs 38→65, bass 43→75,
  seg 72→81**; under +40¢ detune v1 majmin collapses to 42, v2 holds 80. ~1% real-time.
- **Stage A front-end** (`resampleTo`, `logFreqSpectrogram`, `nnlsChromagram`): Kaiser-sinc
  resampling (the UI's old box-average `dsChan` aliased a 15 kHz tone into the chroma band at
  −3…−10 dB) → 3 bins/semitone log-freq spectrogram (0.25 s window) → HPSS in log-freq (0.6 s ×
  13 bins; the v1 2.5 s kernel smeared fast changes) → **global tuning** from parabolic peak
  interpolation as a circular mean, **shrunk by its reliability R** (in-tune instruments R ≈
  0.6–1; vibrato vocals 0.04–0.3 — don't re-centre the grid on a singer's drift) → **NNLS**
  note transcription (s = 0.8, Lawson–Hanson on the Gram matrix) → **bass** = lowest real
  note, with a **sub-octave guard** (energy required at the candidate's own fundamental — NNLS
  activates phantom notes an octave down) → **treble** = NNLS blended 50/50 with raw harmonic
  salience.
- **Stage C** (`chordStatesV2`, `hmmChordDecode`): HMM over root × quality × **bass** — chord-
  tone inversions AND triads over a foreign bass (`F#m/G`, `Bb/C`) are STATES, not a post-hoc
  relabel; Viterbi for the labels, forward–backward for per-beat posteriors; τ = 0.05 fitted on
  dev → **held-out ECE 5.2%** (p ≥ 0.7 → 93% right, p < 0.3 → 22%). Events gain `confidence`
  (`1−H/logK`), `prob`, `alternatives[]` (with voicings), `ambiguous` (prob < 0.4). Beat grid
  subdivided ×2; a **short silence (< 1 s) gets a flat emission** so the chord carries across a
  staccato chop; a long one is N.C. (dB gate vs the 95th-percentile level, not a linear
  fraction of the peak — a strummed chord is still that chord at −30 dB).
- **UI** (browser glue): decode resamples via `resampleOffThread`; the readout shows a
  compensated tuning offset; **`ChordReview`** (v2 §7 progressive disclosure) lists only the
  uncertain chords with ▶ seek + one-tap alternatives (edits the source event → the chart
  re-quantises and every export carries it); `LeadSheetView` fades uncertain chords with a `?`.
  Smoke-tested in headless Chromium (real app, real WAV, +30¢ file read as +28¢).

**Measured findings — do not re-derive:**
- **NNLS alone is NOT the win.** It kills phantom overtones (Bb's 3rd harmonic ≠ F) but explains
  a triad's REAL 5th as its root's 3rd harmonic → loses 7th/extension detail. The treble blend
  beat NNLS-only on held-out by +3.3 majmin / +4.0 sevenths; bass stays NNLS (+6 bass vs salience).
- Biggest single gains (held-out ablation): inversion states (root +11), sub-octave guard
  (bass +18), lowest-note bass (+6), tuning (sevenths +3.4), subdivision (root +2.5), foreign
  slash states (root +1.9), power-chord prior (majmin +1.4 — a guitar voicing doubles root+5th
  and sounds the 3rd once, so raw cosine says "5").
- **Stage D repetition smoothing (`repetition:true`) stays OPT-IN**: ~+1 sevenths but −1.0…−1.3
  seg on BOTH splits; its first, short-context version cost a 12-bar blues 6 points (bars
  sharing a groove but not a chord borrow each other's evidence).
- Chordino's spectral **whitening** cost 6–8 majmin here (default off, `whitenBins`); its
  **phase tuning estimator** had a −11¢ bias from the linear→log fold (replaced); a
  **frame-grid** (beatless) decoder lost ~1 point to the subdivided beat grid; Ellis **TPS2/
  TPS3** tempo scoring moved tempo Acc2 only 18→19–20/28 (not shipped — sustained comping is
  genuinely tempo-ambiguous: bar-rate and 4/3 locks).
- The engine caught two **benchmark** bugs: a Karplus–Strong delay 2 samples long (every
  rendered guitar note flat, read as −12¢) and backwards piano inharmonicity. Both fixed and
  the corpus re-rendered before any reported number. If you touch the synths, re-render
  (`rm -rf tests/bench/.cache`).

**Honest limits:** the bench stems are synthetic (deltas are the read, absolutes optimistic);
real VOCAL stems are flagged mostly uncertain — correctly — the vocal path is still Voices (ML);
heavy bleed is the hardest condition (majmin 73); no learned TCN/re-ranker (no training audio,
iOS/Pages wall) — a learned front-end only has to emit the same `{chroma, bass}` frames;
Stage E fingering DP: built later as `fingerScore` (see "Audio → TAB engine"); audio CHORD charts
carry no `{tab}` yet (their AlphaTex export fingers them on the way out); the 🎸 Guitar → Tab chart is fingered.

### v2.1 — batch review, ⚡ Auto, stems → per-instrument charts, live capture (2026-10-22)

Full write-up: `docs/SYNHARMONICS-V2.md` §8. All engine pieces pure + headless-tested; the
separator and capture are browser glue (device check remains for the real model).

- **Batch review** (`ChordReview`): per-row checkbox + radio choice among the decoder's own
  candidates; **Select all / Commit selected / Commit all** via the pure `commitChordChoices`
  (only the event's candidates are accepted; the replaced label stays an alternative).
  **⚡ Auto** (`autoResolveChords` / `reopenAutoChords`, `localStorage["ttp:autoPick"]`)
  commits the decoder's MAP choice for every uncertain chord, still listed as "auto".
  Auto is NOT a second model: uncertain chords are ~10–12% of the timeline and a perfect
  re-ranker among the alternatives could add ≤ ~2.5 points (`tests/bench/ambig.mjs`).
- **Noise-floor rests** (`transcribeChordsV2`): a beat is also a rest when ≥ 12 dB under the
  loud passages AND its chroma is flat (normalised entropy ≥ 0.97 — noise 0.99–1.00, real chords
  0.68–0.83). Fixed hiss-in-rests decoding as `Em7` (a 54%-rest pad: 98% clean → 43% noisy).
  Held-out +0.6 majmin / +0.9 sevenths. Now: **root 76.1 · majmin 77.0 · sevenths 70.9**.
- **Measured and NOT shipped — do not re-derive:** a transposition-invariant chord bigram
  LM trained on the repo's GP corpus as the HMM jump weight. Dev "+1.4 majmin" was leakage
  (trained on the dev songs); trained clean it was neutral on dev, **−1.9 root held-out**.
- **`chartsFromStems`** (engine): ONE beat grid tracked on the drum stem (fallback: the harmonic
  stems) shared by every chart + the same ♩= → bars align across instruments. Band chart from
  the harmonic stems; per-stem chord charts; bass + vocal YIN note lines; drums via
  **semi-adaptive NMF** (`transcribeDrums`: kick/snare/hat templates — a per-band detector
  fails physically, every drum reaches every band) → `drumPattern` (16th grid) → `drumHitsToMidi`
  (GM ch.10). `stemRoleFromName` maps Moises/Demucs/LALAL/Spleeter names. `encodeWav16` for stem
  downloads. **Measured** (`bench/stems.mjs`): mix decoded directly 54/58 root/majmin → perfect
  stems 76/76 → −12 dB-leaky stems 65/68: separation is the biggest lever on a full mix.
  **Bass-stem fusion is opt-in** (`bassFusion:true`): ±1 with perfect stems, −2…−3 leaky.
  Drums (rendered kit, full rate): kick F 98 · snare 97 · hat 99 — same synthetic kit for tuning
  and scoring, so optimistic; ghost notes < 0.4 of the local peak are dropped. **Transcribe drums
  from the FULL-rate stem** (`opts.fullRate`) — hats live above the 16 kHz analysis Nyquist.
- **Separator** (`stem-model.js` → `stem-worker.js` → `stem-model-core.js`, `vendor/`):
  `window.TTP_STEM_MODEL(L, R, sr, {onProgress})` → `{ stems:{vocals,drums,bass,other} }` at the
  input rate. SCNet (MIT weights, 13 MB int8, pinned HF revision + **SHA-256 checked** by the
  vendored MIT `@audio/neural-separate@0.7.0` bundle, then Cache-API cached); **every WASM session is
  ours, on ONNX Runtime Web 1.23.2** (pinned on jsDelivr — see "Third on-device failure" below; the
  bundle's own 1.30.0 loader is used only for WebGPU, which is never chosen on Safari/iOS); WebGPU
  else single-thread WASM; module Worker (main-thread fallback);
  60 s blocks with 1.5 s cross-faded context (bounded memory on phones). htdemucs is research-
  only → never shipped. **Only 4 stems** — no openly-licensed model splits guitar from keys;
  Moises stems can be imported for that (`📂 Import stems`, no `accept` filter). "Matches
  Moises" cannot be claimed (proprietary); SCNet is htdemucs-class on MUSDB18.
  The vendor bundle is esbuild output of the npm packages with ORT externalised to jsDelivr —
  rebuild the same way, don't hand-edit it.
  - **First device run failed — fixed 2026-10-22.** iPad Safari: *"undefined is not a function
    (near '...separate...')"*. The core destructured `{ default: separate }`, but the bundle's
    API is the **named** export (`export { REVISIONS, models, separate }`). It shipped because
    the browser e2e stubbed the bundle with a *default* export — the stub agreed with the bug.
    Now `resolveSeparate(mod)` binds the named export (readable error if a rebuild changes
    shape), `ensureCacheUsable()` hides a Cache API whose `open()` rejects (some private modes —
    the library awaits it with no fallback), and the UI only blames memory for memory errors.
    **Guard:** `npm test` drives `separateInBlocks` through the REAL vendored library with only
    the ONNX session faked (the library's `session` hook; a fixed spectral mask, so stems must
    equal mask × input and sum back to the mix — measured ~4e-8, which also proves the 60 s
    block cross-fade). Note the bundle reads `process.release.name` once at load, so the test
    spoofs it before the first import. The fake mirrors the model card's real I/O (`mix_spec`
    [1,4,2049,476] in → `stems_spec` [1,16,2049,476] out, drums/bass/other/vocals × ch × re/im —
    read via the Hugging Face connector, which also confirmed the 12,900,277-byte file and its
    SHA-256 match the pin; the connector can't deliver binaries, so the weights themselves still
    need `huggingface.co` + **`us.aws.cdn.hf.co`** (HF 302-redirects the file to its Xet CDN;
    `cdn-lfs.huggingface.co` is not used) + `cdn.jsdelivr.net` allowed in the environment's
    network). **Lesson: never stub the module whose binding you're testing** — fake below it
    (the session), not at it.
  - **First REAL run — measured 2026-10-22** (`tests/bench/scnet-e2e.mjs`: the actual app in
    headless Chromium, real vendor bundle + worker + pinned weights + ORT 1.30.0, NO stubs; only
    the boot CDNs esm.sh/unpkg served locally). Mix = 3 GP songs × ~33 s (Peg · Black Cow · Kid
    Charlemagne) rendered as comp + bass + drums stems, panned, summed (99.9 s). Single-thread
    WASM (no COOP/COEP on Pages), 4-core Linux container:
    - **Speed: 6.0× real time** — 601 s for 99.9 s of audio, **~6 min per minute of song** (a
      16 s clip: 6.9×, fixed per-chunk overhead). A 4-minute song ≈ 24 min on this CPU; phones
      are likely slower. WebGPU not measured (no GPU in the container).
    - **Memory: peak +1.96 GB** over the page baseline (2.13 GB in one process) for 100 s; a 16 s
      clip already peaks at +1.5 GB. It's the model's working set for its fixed 11 s window
      (`mix_spec` frames = 476), not clip length, and the library already disables ORT's memory
      arena + memory pattern — there is no cheap lever *at this window size*. **The owner's iPhone
      was killed ~5% into the first split** (the page reloads) — fixed by the low-memory model
      below.
    - **SDR** (global / median 1 s frame): drums **16.7 / 20.2 dB**, bass **22.5 / 24.7**, other
      **15.2 / 15.4**; the empty vocals stem holds −51 dB of the mix; stems sum back to the mix
      within −21 dB. Synthetic, clean, unmastered stems — out of MUSDB's distribution in the easy
      direction, so these are NOT comparable to the published 9.4/8.4/6.2 dB; they show the
      pipeline is correct, not how a real record will separate.
    - **Charts from the separated stems** (per song, then averaged — songs differ in tempo):
      all 5 tabs render (band · other · bass · vocals · drums), tempo exact per song (117.7 /
      92.3 / 98.4), bass-line note counts = the perfect-stem ones (15/17, 44/43, 94/94), drums
      F kick 93 · snare 96 · hat 95. Band chart root/majmin/sevenths **56.7 / 58.7 / 45.5**
      vs perfect stems 65.2 / 64.1 / 51.0 vs the mix decoded directly 51.6 / 54.3 / 37.8 —
      separation beats the mix on every metric. The ~5-point gap to perfect is within the
      decoder's sensitivity on 40 s clips: adding ANY −16 dB leak to the perfect comp stem moves a
      song ±10–15 points (bass leak raised Peg 70.8 → 85.5; drums dropped Black Cow 55.6 → 43.2).
      `bassFusion` on separated stems: 58.3 vs 58.7 off — stays off.
    - **Bug found + fixed: the progress/ETA lied.** The library calls `progress({chunk: i+1})`
      BEFORE running chunk i, so the core reported chunks *started* — "4% · ~3 min left" with 10
      min to go — and the ETA only recomputed on a progress event (one chunk ≈ 20–70 s), then
      lingered as "~1 min left" through charting. Now: chunks *completed*, pure `progressEta`
      (rate to the last event minus the time since), a 1 s UI tick, cleared when charting starts.
      Verified in the real run: 20% → "~2 min left" with 100 s to go, 40% → "~1 min" with 77 s.
      `npm test` fails on the old formula (first event "0.25 done after 0 model runs").
    - **Bench bug found (not the app):** the bench's "bass" was the guitar Karplus–Strong pluck an
      octave down — its pick-position comb leaves 2% of the energy below 150 Hz, so SCNet filed it
      under "other" (bass SDR 0.4 dB) and even the perfect stem transcribed badly. `lib.mjs` now
      has a fundamental-dominant `bassNote` voice. A bench bass must have a bass's spectrum.
    - Re-score saved stems without the 10-min browser run: `--reuse <run dir>` (+ `--chart-opts`).
  - **Phones — low-memory SCNet (2026-10-22, #109/#110).** Report: on iPhone the split reaches ~5%
    ("~8 min left") and the page reloads = iOS killing the tab. Native stem apps work because they
    run a phone-sized model on the Neural Engine; a web page can't, so OUR run had to fit.
    - **Root cause, measured:** one run of the shipped graph needs ~1.3 GB of activations (native
      ORT 1.32 GB peak) because its input is a FIXED 11 s window `[1,4,2049,476]`.
    - **The fix is the same network at a 2.8 s window.** The graph's time-axis block is an
      orthonormal rfft/irfft written as MatMuls with FIXED DFT matrices (`_7d/_7e` fwd, `_71/_73`
      inv) plus 22 shape constants baking in 476 frames / 239 bins. `scripts/scnet_reframe.py`
      checks the four matrices reproduce from the formula (< 4e-9), regenerates them for F=120,
      patches the shapes; **every learned weight is untouched**. Deterministic, pinned by SHA-256
      (`3a926ef9…d180`), 11.2 MB, `models/scnet-compact/` + NOTICE (MIT; the weights' author
      allows redistributing converted versions with attribution — starrytong/SCNet#35).
      Don't "just make the time axis dynamic": the Reshape/LSTM-state shapes and the DFT matrices
      all hard-code it — a dim_param edit fails at the first Reshape.
    - **Window sweep** (real library + onnxruntime-web 1.30.0 WASM, 1 thread, first 20 s of the bench
      mix; drums/bass/other SDR, peak RSS): 11 s 13.6/19.4/13.5 dB 1799 MB · 5.5 s 13.0/16.7/12.7
      1244 MB · **2.8 s 11.7/16.6/12.0 922 MB** · 1.4 s 10.6/14.3/11.4 674 MB. step 0.25 recovers ~1 dB
      at 2× compute — not taken. Graph optimisation OFF saves ~200 MB (its weight pre-packing) and is
      not slower here.
    - **Core (`compact: true`):** loads the model same-origin, SHA-256-checked, Cache-API-cached
      (`compactModelBytes` — a corrupt cached copy is evicted); ONE ORT session reused across blocks
      (`compactSession`; the library's per-block `free()` is a no-op, `release()` once at the end);
      no arena / mem-pattern / graph-opt; 30 s blocks; passes `segment = (F−1)·hop` because the
      library's SCNet preset otherwise forces 11 s. On by default on iPhone/iPad (`isAppleMobile`,
      incl. iPadOS's Mac UA + touch); UI **📱 Low-memory** toggle, remembered per device.
    - **The stem worker is ended after each split** — a WASM heap never shrinks, and the page sat
      ~650 MB higher through charting with it alive.
    - **Crash rail:** a split marks itself in flight (`ttp:stems:inflight`); if iOS kills the tab, the
      next load says so and switches Low-memory on (or, if it was already on, suggests a shorter clip /
      Moises stems). A long song still decoding now says "still loading", not "Upload a song first".
    - **Real app, headless Chromium, low-memory** (peak increase over the page; full model in brackets):
      16 s **+652 MB** (+1525) · 100 s **+1107 MB** (+1962) · 220 s **+1002 MB** after the worker fix,
      1392 MB largest process. SDR at 220 s drums 16.0 · bass 19.4 · other 16.2 dB; band chart majmin
      **70.4** vs perfect stems 75.2 vs mix 63.0 — chart quality matches the full model (100 s: 59.4 vs
      58.7). Speed 5.2× real time (full: 6.0×). What's left is mostly full-length arrays (four stereo
      stems ≈ 1.4 MB per second of song) and the page's own copy of the decoded song.
    - **First iPhone run of low-memory mode failed at startup (fixed, #111):** "no available backend
      found. ERR: [wasm] RangeError: Out of memory", ~10 s in, before the model ran. ORT 1.30 ships ONE
      WASM build and it creates `new WebAssembly.Memory({ initial: 256, maximum: 65536, shared: true })`
      — a SHARED memory can't move, so Safari must reserve the whole **4 GiB** maximum of address space
      up front; on an iPhone whose page already holds a decoded song + its analyses (vocal isolation,
      A/B clarity, sections were all run in the report) that reservation fails. The model needs far
      less: measured in onnxruntime-web, the compact graph runs with the maximum capped at 1 GiB, 768,
      512 and **384 MiB** and fails at 256 MiB. `capWasmMemory()` (core, low-memory mode only, installed
      before ORT is imported) caps shared memories that ask for > 1 GiB and steps down 1 GiB → 768 →
      512 MiB if refused; below that the original RangeError surfaces. Everything else passes through.
      Verified: real app + real worker + real ORT under the cap → stems identical to the uncapped run
      (SDR to the hundredth). The OOM hint now says to reload and split straight after loading the song.
      **Don't remove the cap because it "works on desktop"** — desktop never has trouble reserving 4 GiB.
    - **Second on-device failure — ⚠ MIS-ATTRIBUTED, see the third one below.** (#112; reported on an
      iPad. "iPadOS 26" was an assumption, never confirmed.) After the cap, the split died at session
      creation: "Can't create a session … allocation_planner.cc:237 Could not find
      OrtValue with name '_sw'" (`_sw` = a `Pow` output in the graph). iOS/iPadOS 26 Safari has WebGPU, so
      `pickDevice` chose it, and ORT's WebGPU EP cannot build/run the graph with the optimiser OFF
      (which low-memory mode sets to save ~200 MB). Reproduced in headless Chromium on a SwiftShader
      WebGPU adapter: `disabled` fails (there at run time, on an f16 Cast); `basic`/`all` run and
      match WASM to 1e-7. Fix: `deviceFor(compact, picked)` — **low-memory mode always runs on WASM**
      (the measured path); and any WebGPU failure in `separateInBlocks` is retried once on WASM
      (`fellBackFrom: "webgpu"`). The UI no longer blames memory for an `allocation_planner` /
      "Can't create a session" error. WebGPU for the compact model (with the optimiser on) is untested
      on Apple GPUs — measure on a device before enabling it. **What #112 got wrong:** the SwiftShader
      repro failed at *run time* on an f16 Cast; the device failed at *session creation* with a missing
      value name. Those are different failures, and the device report was never reproduced — so the
      WASM-only change could not fix it, and it didn't (the next report, below).
    - **Third on-device failure — the real root cause: JavaScriptCore vs ORT ≥ 1.24 (fixed 2026-10-23).**
      With low-memory mode forced onto WASM (#112), the device still failed at session creation:
      "allocation_planner.cc:237 … Could not find OrtValue with name **'_pc'**" (the report before said
      '_sw'). The name changes on every attempt, and it is the exact signature of
      **microsoft/onnxruntime#33426**: ORT **1.24.1+** ships **Abseil 20250814**, whose `raw_hash_set`
      sign-extends a 16-bit per-table seed; JavaScriptCore's optimising tier on ARM64 drops the mask, so
      once a lookup function tiers up it hashes with a different seed than the inserts used and ORT
      can't find its own values (reporter's standalone repro, no ORT; WebKit bug 271866; reported fixed
      in Safari 17.5 — **so the owner's device is most likely on iOS/iPadOS < 17.5**, which also fits
      `pickDevice` never having had WebGPU there: Safari 17 has no `navigator.gpu`). Evidence gathered,
      not assumed: (1) the path in the device error, `/mnt/azure_nvme_temp/_work/1/s/onnxruntime/…`, is
      byte-for-byte the 1.30.0 WASM build's (1.23.2's says `/mnt/vss/…`); (2) ORT's own
      `cmake/deps.txt`: v1.23.2 → Abseil **20250512**, v1.24.1 and v1.30.0 → **20250814**; (3) both
      failing values feed a `ReduceMean`, but the graph is clean (no duplicate outputs, no subgraphs) and
      creates fine on V8 under every option and under WASM-memory caps down to 64 MiB — memory pressure
      gives a clean `std::bad_alloc` at run time, never this error. **Not reproducible here** (no ARM64
      JavaScriptCore in the container) — the device check remains.
      **Fix:** every WASM session in the app is now OURS, on ONNX Runtime Web **1.23.2's plain build**
      (`ORT_WASM_VERSION`, `wasmSession`, the library's `session` hook): the compact model as before, and
      now the full model too (`fullModelOf` reads the library's own pin — same HF URL, same SHA-256 —
      and `modelBytes` fetches + checks + caches it), so the bundle's 1.30.0 is never loaded for WASM.
      **Measured, `tests/bench/ort-pin.mjs`: 1.23.2 output is bit-identical to 1.30.0** for both models
      (max |Δ| = 0, reproduced twice), peak RSS 644–659 vs 624–651 MB (compact) / 1614–1615 vs 1554–1565 MB
      (full, ~4 % higher), steady-state run time within noise.
      WebGPU is **never chosen on WebKit** (`isWebKit` → `pickDevice` = wasm): ORT's JSEP/asyncify
      builds stall WebKit 26.2's OMG tier (microsoft/onnxruntime#26827; community fix = plain WASM
      build). The plain 1.23.2 build is also the smaller one (11.9 MB vs 14.2 MB; its largest function
      bodies are below the size #26827 found to spiral). `capWasmMemory` stays (1.23.2 also asks for a
      4 GiB shared maximum). If a future ORT release fixes #33426, re-run `ort-pin.mjs` before moving.
    - **Deploy stamp — a fix must actually reach the device (2026-10-23).** `index.html` fetches the UI
      `no-cache`, but the separator (`stem-model.js` → worker → core → vendor) loaded unversioned under
      GitHub Pages' `max-age=600`, so a phone could show the new UI's text while running a cached older
      core — which made it impossible to tell from a screenshot which code failed. `pages.yml` now stamps
      `stem-model.js?v=<commit>` (and fails the deploy if the stamp didn't land); `stem-model.js` passes
      the query to the worker and the core, the worker imports the core with its own query, the core
      stamps the vendor bundle. The model URL is deliberately NOT stamped (its Cache-API key must
      survive deploys). Verified in a real browser: `/stem-model.js?v=… /stem-worker.js?v=…
      /stem-model-core.js?v=… /vendor/neural-separate.mjs?v=…`.
    - **Every separation error now says what ran:** `envLabel` appends
      `[stems <build> · ORT <ver> <device> · Safari <x.y> · iOS <a.b>]` (iOS 26 freezes the UA's OS token
      at 18_6, so the Safari `Version/` — the WebKit release — is the number to read). The UI classifies
      on the message without the label, and gives the engine signature (`Could not find OrtValue` /
      `node_index_info` / `Failed to find args for kernel`) its own hint: a WebKit engine fault, update
      iOS/Safari, or import stems — not memory. `std::bad_alloc` (ORT's real OOM) now counts as memory.
    - **Real app, headless Chromium, iPad user agent, low-memory, 17.9 s Peg mix (2026-10-23):** device
      wasm, ORT fetched = `onnxruntime-web@1.23.2/dist/{ort.wasm.min.mjs, ort-wasm-simd-threaded.mjs,
      ort-wasm-simd-threaded.wasm}` and **zero** 1.30.0 requests; 3.9× real time; peak **+554 MB**;
      SDR drums 11.1 · bass 16.2 · other 11.8 dB; all 5 tabs; band majmin 71.1 (perfect stems 70.8).
      Same mix, desktop UA, Low-memory OFF (the full model, now also on our session): weights from the
      library's pinned HF revision (→ `us.aws.cdn.hf.co` Xet CDN), SHA check passed, ORT 1.23.2 only;
      5.9× real time; peak +1450 MB; SDR drums 13.9 · bass 19.2 · other 13.7 dB.
      (`tests/bench/scnet-e2e.mjs` gained `--ua` and `--stamp`; V8 still runs the WASM, so this checks
      the app's routing and the pinned runtime, not JavaScriptCore.)
    - **Device check that remains:** a real iPhone and iPad (iPadOS reports a Mac UA; `isAppleMobile` catches it via touch points, so low-memory mode is on by default there too). Any failure screenshot now carries
      the `[stems … · Safari … · iOS …]` label — read it before theorising. If "Could not find OrtValue" ever
      appears with `ORT 1.23.2` in the label, the #33426 diagnosis is wrong for that device (update iOS, and
      compare the Safari version against 17.5). If a long song still dies there, the next levers are Int16
      stem storage (halves the stems); WebGPU on WebKit stays off until measured on a device (#26827).
    - **Device report after #113 (2026-10-25): iPhone ✅ (slow but works); first-generation iPad Pro ❌ "freezes,
      then times out".** That iPad (A9X, 2015/16) is stuck on **iPadOS 16.7 = Safari 16.6**. Checked, not assumed:
      ORT 1.23.2 is built with **Emscripten 4.0.8** (`build_args.py`), whose `MIN_SAFARI_VERSION` is **15.0**, with no
      tail-call / relaxed-SIMD flags; WebAssembly SIMD is Safari **16.4+**; our JS/the bundle/ORT use nothing newer
      than Safari 15.4 (`Float16Array` is feature-detected). So it CAN run there — the problem is time and the page's
      lifecycle: an A9X core is ~3× slower than a current iPhone's, a song takes tens of minutes, iPadOS suspends a
      Safari tab when the screen auto-locks or Safari is backgrounded, and the loader then **retried a failed worker
      run on the MAIN thread** (any error mentioning "import/module/worker") — minutes of WASM on the page's thread
      freeze it until iOS kills it. Fixes (all also help the iPhone):
      - **No main-thread retry** once a worker exists (only a browser that can't construct a module worker falls back).
      - **Screen Wake Lock** for the split (Safari 16.4+; re-requested on `visibilitychange`, released after); if the
        page was hidden during a failed split the error says the split pauses in the background.
      - **Stages** (`opts.onStage`: library → model → runtime → separating, core → worker → page) shown before the
        first progress tick, a **stall warning** (quiet > max(3 min, 4× the device's own gap between progress
        events), naming the stage) and **✕ Cancel** (`cancelStems` / `TTP_STEM_CANCEL`: ends the worker; the promise
        rejects with `err.cancelled`, shown as "Split cancelled.", not an error).
      - **⚡ Faster** = `FAST_STEP` 0.75 (25 % window overlap), default ON when `isLegacyIOS` (Safari `Version/` < 17,
        or the OS token for other iOS browsers), remembered per device. Measured on the compact model (real library,
        ORT 1.23.2, 17 s mix with known stems): **5.5× → 3.7× real time (−34 %), same peak (922 MB max RSS), SDR
        −0.7 drums / −0.9 bass / −0.5 other dB.** A **1.4 s window (F=60)** was measured and REJECTED: −180 MB (742 MB)
        but −1.4 / −4.6 / −2.3 dB and barely faster — don't ship it unless a 2 GB device proves it necessary.
      - **Split a section** (Whole song / 30 / 60 / 90 s, from m:ss): the charts cover that part; the tracks carry
        `offsetSec`. On an A9X a 60 s section is the practical unit.
      - `opts.segment` overrides the compact segment (needed by any other window size; used by the sweep).
      Verified: `npm test` (stage order before the first progress, injected-session stages, a throwing stage callback
      can't break a split, FAST_STEP needs < 75 % of the runs, `isLegacyIOS` on iPadOS 16.7 mobile + desktop-class UAs /
      iOS 15 Chrome vs iOS 17 / 26 / Mac, cancel no-op, no main-thread retry, stage plumbing, wake-lock + section +
      cancel + stall + Faster UI guards; mutation-tested) and the real app in headless Chromium as an iPadOS 16.6
      Safari (UA + `platform` MacIntel + touch): Low-memory and Faster default on, stage text, Cancel → "Split
      cancelled." with the wake lock released, then a 30 s section split → all charts, wake lock 2 requested / 2
      released. **Device check that remains:** the iPad itself (V8, not JavaScriptCore, ran these). If it still
      stalls, the stall line names the stage — "starting the AI runtime" means JSC is compiling the 11.9 MB WASM.
- **Live capture** (`LiveCapture`): `🖥 Capture a tab` (getDisplayMedia, desktop Chrome/Edge,
  "Share tab audio") + `🎙 Record` (mic), raw PCM (ScriptProcessor — the one raw tap iOS
  still has), 15 min cap, silent-take = DRM message, → the SAME `loadBuffer` path as an upload.
  **Deliberately no YouTube/Spotify link downloader**: Spotify is DRM, YouTube's terms bar
  stream downloading, and a zero-server page can't fetch either. Don't add one.
- **Verified:** `npm test` (engine + contract guards) and a headless-Chromium end-to-end run of
  the real app with a stub separator (worker, progress, tabs, groove grid, MIDI, WAV, mixer,
  stem import roles, batch commit, Auto persistence, fake-mic capture) — 17/17. The real SCNet
  run is the device check that remains (HF is unreachable from the dev sandbox).

### Chord vocabulary — Chart / Basic / Full for audio decodes (2026-10-25)

**The report:** "every stem or audio file comes back 6/9, sus2 and slash chords with unfamiliar bass
notes — I want maj7, maj9, m7♭5, 7♭9, dim7, what a professional chart uses." An outside diagnosis
blamed NNLS overtone attribution (the 9th harmonic read as an extension) and proposed raising
thresholds, filtering the voicing modal, and mapping muddy chords to 7♭9/dim7. **Measured before
changing anything, and the diagnosis was wrong:** on the repo's real stems 6/9 was 0–1.3 % of decoded
time; the noise was **slash chords at 21–43 %** (`Em7/B`, `Dmaj7/C#`, `Cmaj7/B`, `Asus4/E` — v2's
inversion STATES let the lowest note, often the 3rd of three singers, name every chord) plus sus2 at
6–7 %. The voicing modal only draws diagrams for a symbol already chosen; it decides nothing.
Posterior normalisation can't change a MAP label. Mapping muddy chords to 7♭9 would invent a dominant.

**What shipped — a vocabulary, defined as data** (`CHORD_VOCABULARIES` + `resolveChordVocabulary` in
`engine.tsx`; opt `vocabulary`, read by `chordStatesV2`, `recognise`, `chordStates`, so v2, v1,
sliding-window and `chartsFromStems` all honour it):
- `qualities` — the names the decoder may choose. A left-out quality is NOT mapped to anything: the
  decoder picks the best-fitting chord that IS allowed (C6/9 over C → `C`; A7♭9 needs its A in the bass,
  otherwise it's the dim7 — the bass decides, no rule needed).
- `inversions` — slashes that are WRITTEN (chart: `C/E`, `C/G`, `Cm/Eb`, `Cm/G`, `C7/E`, `C7/Bb`).
- `hidden` — inversions DECODED but written in root position (`Cmaj7` over B reads `Cmaj7`). **Load-
  bearing:** with inversions simply removed from the state space, a 5th in the bass picked the wrong
  ROOT (`Dsus4/A` → `A7sus4`, −4.9 root on dev). Hidden states let the bass evidence point at the root
  without writing the slash. **Deliberately NOT hidden:** the 3rd of m7/m7♭5 and the 4th of sus4 —
  there the bass is itself the natural root (Am7 over C = **C6**, Bm7♭5 over D = Dm6, Gsus4 over C =
  Csus2), so the chord is read FROM the bass. Verified in the corpus: every such "Am7/C" is a tonic
  I6 (*Cheryl*: `Dm7 G7 "Am7/C" C7`; *Anthropology*: `"Gm7/Bb" G7 Cm7` = B♭6 VI7 ii) — the oracle
  only prefers the m7 name because `m7` out-ranks `6`.
- `foreign` — non-chord-tone basses charts actually write: major over the 2nd (`F/G`, `Bb/C`) and ♭7
  (`D/C`), minor over the ♭7 (`Am/G`).

`chart` = `"" m 7 maj7 m7 m7♭5 dim dim7 sus4 7sus4 9 m9 maj9 7♭9` (no 6/9, sus2, add9, 6, m6, 5, aug,
m(maj7), 7♯9). `dim` stays: removing it cost −0.8 root (a real C° became Ab7/F#); `6`/`m6` measured +0.0
and the owner didn't want them. `basic` = `"" m 7 maj7 m7 m7♭5 dim7 sus4`, never a slash. `full` = all
qualities + every chord-tone inversion = **the engine default, byte-identical to before** (every pinned
test unchanged). **The UI defaults to `chart`**: `ChordVocabPicker` ("Chord names: Chart · Basic ·
Full", `useChordVocab`, `localStorage["ttp:chordVocab"]`, try/catch) replaces △ Simple in the Audio
panel and also sits above the stem-chart tabs; a change re-analyses (stems: re-charts the split stems,
never re-runs the separator). A hidden inversion's event voicing carries no bass note, so transpose
(which re-names from `midis`) can't revive the slash.

**Measured** (`tests/bench`, 28 tracks × 5 conditions; root / majmin / sevenths / pcs / written bass):

| truth named by | split | full | chart |
|---|---|---|---|
| full oracle | dev | 77.8 / 79.8 / 74.2 / 66.9 / 81.8 | 76.6 / 79.3 / 71.1 / 63.8 / 79.2 |
| full oracle | test | 75.6 / 76.5 / 70.6 / 65.8 / 74.5 | 73.6 / 75.0 / 70.2 / 64.8 / 66.1 |
| chart vocabulary | dev | 73.7 / 73.7 / 67.9 / 63.1 / 72.3 | **75.3 / 75.9 / 70.0 / 65.4 / 76.4** |
| chart vocabulary | test | 74.9 / 75.2 / 68.4 / 65.4 / 60.6 | 73.7 / 74.5 / 68.4 / 65.4 / **69.3** |

Against the full oracle chart "loses" 1–3 points, almost all renames to the same notes (`Bsus2` →
`F#sus4`, `Cm6` → `Am7♭5`, `A6/9` → `F#m7`, `Am7/C` → `C`). Scored at the vocabulary level
(`--gtvocab chart`, MIREX practice) it is a wash: dev +1.6…+2.3, held-out −1.2…0, written bass +4 / +9.
The one real held-out loss is a Steely Dan `F#m/G` (a notated foreign slash chart doesn't write; it
reads `Gmaj9`). **Real stems, share of decoded time that is a slash (full → chart → basic):** 25 or 6
to 4 42.6 → 23.8 → 0 %, backing vocals 41.6 → 22.8 → 0, Peg vocals 39.5 → 21.2 → 0, Heart of Rock & Roll
21.1 → 9.9 → 0; sus2 / 6/9 / add9 (up to 8.5 % in full) → 0 in chart and basic. Real app (headless
Chromium, 390 px, `bench/vocab-e2e.mjs`): backing-vocal stem 24 → 13 → 0 slashed chords of 51, choice
survives a reload.

**Rejected from the outside proposal, with reasons:** (1) an NNLS 9th-overtone penalty — 6/9/add9 were
not the noise, and NNLS already attributes overtones; (2) filtering the voicing-modal alias map — it
renders diagrams for a decided symbol; (3) a ">85 % confidence escape hatch" for extensions — Full is
one tap; (4) "if no 7th, write maj7" (the 6/9 ban) — writes a B that isn't sounding and can clash with
the melody's tonic; the chart writes the triad, the player colours it; (5) "group muddy slash chords as
7♭9 / dim7" — invents a dominant function the audio doesn't support. Do not re-derive these.

**Honest limits:** chart still writes triad/7th inversions when the bass is sustained, which on a
vocal stem can be the lowest singer — Basic is the no-slash choice for vocal harmony. Synthetic
bench stems (deltas are the read). A pure C–D–G with zero 3rd reads `Gsus4` in chart (same notes).

### Key detection v2 — harmonic FUNCTION weights, not scale membership (2026-09-10)

**The reported defect.** An audio-decoded chart of Marshall Tucker's *Can't You See*
(the chord changes came out right — `D · C · G`) was labelled **E minor**. It is D major.
Same class of bug: a `G · F · C` mixolydian vamp read **C**.

**Root cause, and it was structural, not a threshold.** v1 `analyzeKey` scored each of the
24 keys as *"how much duration is diatonic to it"* (full weight if the chord's root AND
quality fit the scale, `×0.3` otherwise), plus a small cadence bonus. That model is
**degenerate for relative keys** — they share a scale, so only the 0.08/0.04 bonus ever
separated them — and it is **blind to which chord is home**. For `D · C · G`: all three are
diatonic to **E minor** (VII · VI · III), whereas in **D major** the C is a *borrowed* ♭VII
and got the 0.3 haircut. E minor therefore won **a key whose tonic chord never sounds**.

**The fix — three musically-motivated terms** (`_keyChordWeight` + `analyzeKeyCandidates`):

1. **Degree weights by function** — `I 1.00 · V 0.86 · IV 0.80 · ii/vi 0.62 · iii 0.48 ·
   vii° 0.36` (minor: `i 1.00 · V(maj/dom) 0.78 · iv 0.80 · III/VI/VII 0.62 · v 0.72 ·
   ii° 0.36`), so a key wins on the STRENGTH of the functions its chords fill rather than
   on set membership. A dominant on the 5th degree gets +0.06 — it is the clearest key
   signature there is.
2. **A borrowed table** — `♭VII 0.52 · ♭III 0.34 · ♭VI 0.34` in major (mixolydian/aeolian
   mixture is *ubiquitous* in rock; the ♭VII is the whole reason this bug existed), dorian
   ♮6 `0.22` in minor, everything else chromatic `0.06`. A **diatonic root with the wrong
   quality** keeps a fraction of its degree weight — `×0.50` for a dominant (a secondary
   dominant still points at a diatonic target) and `×0.38` otherwise — instead of a flat 0.3.
3. **Tonic presence** — a key whose tonic triad is never stated takes a **×0.80 haircut**,
   and a tonic at a phrase boundary scores `+0.10·total` (last chord) / `+0.06·total`
   (first). That is the "where does it come home" cue, and it is what separates D major
   from **G major** on the very same three chords (D opens and closes every phrase).

**Slash bass as a minority vote** (`_K_BASS = 0.20`). `_parseSym` now also resolves the
inversion's bass pitch class, blended `0.8·w(root) + 0.2·w(bass)` (quality-agnostic — a bass
note has no third), so normalisation is unchanged. The sounding bass is real functional
evidence: `Eb6/9/F` in a B♭ tune is an F13sus by another name, i.e. the dominant. Gotcha the
test pins: **`6/9` is a suffix, not an inversion** — only a trailing *note name* counts
(`Eb6/9/F` → bass F; `C6/9` → none; `Csus4` → none).

**Measured.** Every existing corpus expectation is byte-identical (`npm test` green: Blue Sky
E, the fixture's `I V vi IV` in C, Confirmation F). Newly correct: **`D C G` → D** (E minor
now loses by >20%, and its `tonicShare` is 0), **`G F C` → G**, Peg's chord track `Bm → Em`,
Interstate Love Song's bass line `C#m → E`, Anthropology's *Chords* track `Gm → Bb` (the
bass vote does that one — margin is thin, 0.642 vs 0.638, so it is NOT pinned as a test;
the bass-vote unit tests are). Guards against over-correcting the other way are pinned too:
a real E-minor tune and a minor blues both stay minor.

**Confidence is now clamped to 0..1** and reads `score/totalDuration`. The audio decoder's
key-prior gate (`keyMinConfidence 0.5`) still engages on real material — measured 0.669 on
the Peg stem. An A/B of that prior (none / v2 / true key / the old v1 key) on the real Peg
vocal stem against its time-aligned `.gp4` moved root accuracy by <1.5 points in every
direction, i.e. **the key-model change is neutral for the chord decode** and its effect is
on the *reported key*, which is what was broken. (Note: CLAUDE.md's 53%-root figure was
measured on an isolated *instrument* stem that is not in the repo; the **vocals-only** Peg
mp3 that IS in the repo scores ~10% against the rhythm-guitar chart, so don't use it as the
accuracy benchmark — its DTW alignment confidence does reproduce exactly, 0.697.)

**`analyzeKeyCandidates(score, {limit})`** is the new primitive — all 24 keys ranked with
`{tonic, mode, confidence, score, tonicShare}`; `analyzeKey` is literally its head, so the
two can never drift. The UI's picker lists the runners-up so a user correcting a call can
see what the analysis weighed.

### Manual key override — the key is now editable (2026-09-10)

The analysis is good and still not infallible (modal vamps, a noisy audio decode), and the
key drives the roman numerals AND every exporter's key field — so it needs the same escape
hatch `✎ Edit` gives chords.

- **Engine:** `parseKeyName(name)` (accepts `D` · `Dm` · `F#m` · `Bb minor` · `eb Major`,
  case-insensitively; **rejects chords** — `Dsus4` is not a key) and `KEY_CHOICES` (the 24
  keys, family-default spelling).
- **UI (`KeyPicker` in `TabDecoderPro.tsx`)** — a `<select>` in `ChartPanel`'s toolbar:
  *"Key: auto (D)"*, then an **Analysis ranked** optgroup (the runners-up with their
  scores — the relative-major/minor mix-up is right there, one tap away), then all 24 keys.
  `ChartPanel` takes it **controlled or uncontrolled**: the main app passes
  `keyOverride`/`setKeyOverride` (persisted in the session meta, so a corrected chart
  restores corrected); the Audio/ML panels use the internal state.
- **The override names the key of the UNTRANSPOSED music**, so transposing moves it with the
  chart (`key.tonic + semis`), and the picker un-shifts the ranked list to match.
- It flows through the SAME `opts.key` every exporter already reads — ABC `K:`, ChordPro
  `{key:}`, CSMPN/CSML `Key:`, and the Pro handoff — plus `describeScore` (which now takes
  `opts.key`) so the summary pills can't contradict the header. The meta row shows
  `key D (87%)` when detected and `key D (set)` in green when corrected.

### Song STRUCTURE from audio — sections + an editor (2026-09-10)

"Assign intro / verse / chorus / bridge automatically." Built from **the audio itself**
(`detectSections` in `engine.tsx` — pure, zero-dep, worker-safe), with the standard MIR
pipeline and an editor over the top, because structure is subjective and naming is a
heuristic:

```
beats → beat-synchronous features → time-lag embedding → SSM → Foote novelty →
boundaries → repetition clustering → pop-template naming
```

- **Beat-synchronous**, reusing `detectBeats`/`beatSegments` (HPSS chroma, drums suppressed)
  — and the panel passes the beat grid the chord decode already found, so the beat is never
  tracked twice.
- **Chroma AND timbre.** A verse and its chorus very often share the chord loop (all of
  *Can't You See* is D · C · G), so chroma alone cannot separate them; what changes is the
  ARRANGEMENT. `_bandFeatures` adds 8 log-spaced spectral bands, **L2-normalised per beat**
  so it describes brightness/density and not loudness (loudness rides separately as the beat
  energy, and is what the naming step uses to find the hook). Blend `timbreWeight 0.35`.
- **Time-lag embedding** (`embed` = 8 beats, **centred**): a section is a repeated
  *progression*, not a repeated instant. A forward-only stack — the first thing tried —
  shifts every boundary half a phrase early; centring fixed it.
- **Foote checkerboard novelty** with a Gaussian taper. Two details that were each a bug:
  (1) the kernel must be **no wider than the shortest section** accepted, or it straddles
  two boundaries and smears both away; (2) at the edges the kernel is truncated, producing a
  huge artificial spike — left in the mean/σ it **crushed every real boundary below the
  threshold** (measured: real boundaries at z≈0.5 against an edge spike of z≈6.7). The
  statistics are now computed over the interior only and the edges are zeroed.
- **Peak-picking is two-stage**: a local-max test over a *short* window (a boundary is a
  narrow spike), then **greedy strongest-first** selection enforcing the minimum section
  length. Testing "is it the max over ±minSection" instead makes two real boundaries one
  section apart annihilate each other — which is the entire grid of an 8-bars-per-part song.
- **Repetition clustering** on the unembedded segment means, with an **adaptive** cosine cut
  (`median + 0.5·(p95 − median)` of all pairwise similarities) rather than a magic constant:
  how much more alike two instances of the same part are than a typical pair is
  material-dependent.
- **`nameSections`** (pure, separately tested) applies the pop template: a short
  non-recurring opener → **Intro**; the most-repeated recurring part, tie-broken by
  normalised energy → **Chorus**; the next → **Verse**; a one-off in the late half →
  **Bridge**; a short closer → **Outro**; any other one-off → **Instrumental**. Repeats are
  numbered (`Verse 1`, `Verse 2`).
- **`SECTION_SENSITIVITY`** (`coarse`/`balanced`/`fine` → minSectionSec 20/14/8, novelty z
  0.8/0.5/0.3) is shared by engine and UI so the chips and the defaults cannot disagree.
  Measured on the real 4-minute Peg stem: fine → **18 parts** (unusable), balanced → **7**,
  coarse → **5**. `balanced` is the default, and this is a **user** control on purpose.
- **`applySectionsToScore(score, sections, {bpm, beatsPerBar})`** stamps the labels onto
  `bar.section` — the SAME field the Guitar Pro / MusicXML importers fill — so CSMPN
  (`- Chorus`), ChordSlashML (`[Chorus]`) and the Pro handoff carry the structure with
  **zero new plumbing**. Time→bar uses the score's own grid (`b · beatsPerBar · 60/bpm`),
  the grid `audioEventsToScore` already quantised onto, so it is exact, never mutates the
  input, and never puts two labels on one bar (a collision is pushed to the next bar).
- **`scoreToMusicXML` now WRITES `<rehearsal>`** for `bar.section` — `parseMusicXML` already
  read it, so the structure now round-trips (import ↔ export), and MuseScore/Guitar Pro draw
  the boxed "Chorus" above the staff.

**UI — `SectionEditor` (in `TabDecoderPro.tsx`, pure presentational; the controller lives in
`AudioImport`).** `🔎 Detect sections` + the Fewer/Balanced/More chips; one row per section
with **▶ seek** (tapping a row starts the stem AT that second — verifying a boundary is one
tap, not a scrub; `play(offset)` re-starts the BufferSource at the offset and rebases the
clock), an editable name + a preset `▾` (Intro/Verse/Pre-Chorus/Chorus/Bridge/Instrumental/
Solo/Breakdown/Outro), the **bar range** on the chart's own grid, `◀`/`▶|` to nudge the
boundary a bar, `⤒` to merge into the section above, and the repetition letter. `＋ Add at
m:ss` inserts a section at the playhead — which is also **how you enter a structure you
looked up elsewhere**. Every edit runs through one normaliser that re-sorts, makes
boundaries contiguous and clamps to the clip, so no edit can leave a gap or an overlap. The
row containing the playhead highlights, so the list doubles as a map during playback. Runs
**off-thread** (`detectSectionsOffThread`, main-thread fallback — correctness never depends
on the worker).

**HONEST LIMITS (documented, not bugs):**
- Boundaries land on **beats, not downbeats** — pure-DSP downbeat detection does not work
  (measured and written up above), so a boundary can sit a beat or two off. Nudge it.
- The **names are a template**, not song knowledge. A tune that breaks the pop form gets
  labelled oddly. That is what the editor is for.
- On an **isolated stem you get the STEM's structure** — where that instrument plays. The
  Peg vocals-only stem is silent through the sax solo, so its "sections" are the vocal's
  sections, not the song's. Full mixes give song structure.
- **Validated on:** synthesized audio with a known A-B-A-B-C-B form (every detected boundary
  within 1.5 s of a real one — no invented sections — the once-only bridge in its own
  repetition group, repeats clustered together) and the two real stems in the repo (Peg
  4:00 → 7 parts in 3.6 s; a 45 s backing-vocal clip → 4). Section detection on a full
  commercial mix with published structure is the device-side check that remains.

**Why NOT an online structure database** (the alternative the request raised). It was
considered and rejected on evidence, not taste: the app is **zero-server, client-side, on
GitHub Pages**, so any lookup must be CORS-open and unauthenticated from the browser.
MusicBrainz carries no section timings; AcousticBrainz is retired; SALAMI/Isophonics are
research *datasets*, not lookup APIs; and the one commercial API that does return section
boundaries (Spotify's `audio-analysis`) needs an OAuth client **secret** — which cannot be
shipped in a client-side app without leaking it — and was restricted for new applications in
late 2024. It would also add a network dependency and a song-identification step (the input
here is often an untitled stem) to a feature that must work offline on an iPhone. The honest
bridge is the editor: look the structure up wherever you like, then `＋ Add at m:ss` and
type the names — under a minute for a whole song, and it round-trips into every export.

### `describeScore` — local chart summary (music-skill `describe` analog, 2026-07-24)

The ListenHub **music** skill (Music/skill.md — the Mureka toolkit: generate / remix /
stem / recognize / **describe**) has one analysis capability the app had no local analog
of: **`describe`** (a description + tags/genres for a file). `describeScore(score, opts)`
is the zero-dep, pure, reads-only local version — it gathers the ingredients the engine
already computes (key via `analyzeKey`/`keyName`, meter, tempo, tuning, capo, the chord
vocabulary with per-symbol counts, section list, melodic flag) into one at-a-glance
summary + human `tags` (`major/minor key`, `waltz (3/4)`, `jazz / extended harmony`,
`triadic`, `slash / inversions`, …) and a `complexity` verdict. **It's metadata ABOUT a
score, never recognition — it cannot touch the validated corpus.** Exported + headless-
tested (fixture → C major / 4 chords / simple; a 9th/♭9 chart → "jazz / extended";
empty score safe). Drop-in ready for a chart "info" readout and a richer CSMP/handoff
header — UI wiring is the device-verify follow-on.

### `scoreToMusicPrompt` — recognize→generate bridge to the ListenHub music CLI (2026-07-24)

The **music** skill runs on `@marswave/listenhub-cli` — a **Node ≥20 shell CLI** (OAuth /
API-key auth, `--json` output, no browser or JS API). It therefore **cannot run inside**
this zero-server / client-side app. The honest bridge is an **export**, not an embed:
`scoreToMusicPrompt(score, opts)` turns a decoded chart into a **ready-to-run
`listenhub music generate` command** the user pastes into THEIR ListenHub environment.
Pure — builds a natural-language `--prompt` from `describeScore` (key / tempo / meter /
harmony tags) + a collapsed chord-progression digest, an **honest `--style`** (only when
the harmony actually signals it, e.g. extended → `jazz`), a `--title`, an opt-in
`--instrumental`, with **shell-safe quoting** (double-quotes in fields are escaped so a
chord/title can't break out). Returns `{ prompt, style, title, instrumental, command,
describe }`. Example: `C G | Am | F` → `listenhub music generate --prompt "A simple chord
progression in C (120 BPM, 4/4 time) — major key, triadic. Follow these chord changes:
C G Am F." --title "Demo Tune"`. Exported + headless-tested (prompt carries key +
progression, flags quoted, jazz style only on extended harmony, quote-escaping, long
progression capped). UI wiring (a "Generate audio ↗" copy button) is the follow-on.

### UI wiring of the three music-skill ideas (2026-07-24, browser-only)

The three ideas from the skill review are now wired into `TabDecoderPro.tsx` (browser-only
glue; the engine cores above stay pure). Guarded by the transpile + import-contract tests;
device smoke-test is the remaining step (React render can't be headless-tested).

1. **Describe readout** — a `describe` memo (`describeScore(tscore, …)`) renders a subtle
   pill row under `ChartPanel`'s meta line: `COMPLEXITY · N chords` + the human tags
   (`major key`, `jazz / extended harmony`, `waltz (3/4)`, …). Recomputes through the
   simplify→arrange→transpose chain, so it always describes what's on screen.
2. **Generate audio ↗** — a new `"music"` branch in `doExport` runs `scoreToMusicPrompt`
   and shows the `listenhub music generate …` command in the existing `ExportPanel` (reuses
   its copy/download plumbing; downloads as `.sh`). A button sits with the "send elsewhere"
   actions next to **→ Chord Sheet Maker Pro**, with a panel hint explaining the CLI runs
   in the user's own terminal (Node + login).
3. **Stem round-trip hint** — the Audio panel intro now points users at a
   `listenhub music stem` split as the ideal isolated-stem input, and frames the existing
   **⚖ A/B clarity** button as the "did the separation actually help?" gate. No new code
   path — the stem drops into the same `transcribeChords`/`extractCenter` pipeline.

### DSP Hann-window memo (bottleneck cleanup, 2026-07-24)

`pcmToChroma` (called once per hop by `transcribeChords` / `harmonicClarity` /
`pcmChromaSequence` — thousands of frames per song, the substrate under every audio
feature: chroma recognition, center-channel isolation, A/B clarity, DTW auto-sync) used
to recompute an N-point Hann window (N cosines) on **every** call. The window depends
only on N, so it's now memoised (`_hann(N)`, cached per length); `extractCenter` shares
the same helper (was an inline duplicate). **Byte-identical output** (same expression,
same order) — guarded by the existing audio regression tests (C/Am/G7 detection, C-major
chroma peaks, clarity ordering) plus a direct `_hann` formula/cache-identity test. Pure
efficiency win on the mobile-Safari path these features target.

## Audio → TAB engine (2026-10-23)

The "High-Fidelity Audio-to-TAB Engine" proposal (TART / Noise2Fret / Fretting-Transformer
lineage) was reviewed against this repo and its first four phases were BUILT in the same
session. **Decision record, tool choices, measurements and the remaining plan:
`docs/AUDIO-TO-TAB-PLAN.md`.** Summary of the decisions that still bind:

- Cited papers are real (TART arXiv 2609.11904, **no released weights**; Noise2Fret 2608.30854;
  Fretting-Transformer 2506.14223). **GuitarSet is CC-BY 4.0 on HF** (`jhartquist/guitarset`).
- Rejected for the shipped path: a **mandatory cloud** stage (breaks zero-server), **MERT**
  (CC-BY-NC-4.0, and the owner will monetise → no non-commercial licence anywhere, not even as a
  teacher), a MusicXML→AlphaTab normaliser (we emit AlphaTex directly, which carries the string),
  Demucs (research-only; SCNet ships).
- **Owner decisions:** no cloud lane for now (iPad-only dev; a Linux laptop later). `hf` CLI:
  `pip install --user huggingface_hub` → `~/.local/bin/hf`; anonymous downloads of public repos work,
  a token is only for uploads. AudioPod = dev-time oracle only (server, credits, key would leak).

### P0b — `fingerScore`: string/fret assignment (Stage 3, pure engine)

`fingerCandidates` → `fingerShapes` → `fingerSequence(events, tuning, opts)` → `fingerScore(score, opts)`.
A **Viterbi** over per-event fretboard shapes (each pitch on a distinct string). **Hand span is a
HARD constraint** (`maxSpan` 4 frets, open strings excluded — a wider shape is never a state), so
every emitted chord is playable and pitch-valid by construction. Noise2Fret's playability terms are
**costs, not losses**: span, fret height, open-string preference, a hand-window movement model
(cheaper across a rest), string crossing. Plus a learned `FINGER_PRIOR` (−log p of each
string×fret cell and of hand moves of d frets) mined from the DEV halves only. `fingerScore` fills
`frets` on events that lack them (audio / ML charts), sets `fingered:true`, **never mutates its
input**, and keeps written frets unless `overwrite`. It is what gives audio charts a `{tab}` block.

**Measured** (`node tests/bench/fingering.mjs --gs …`; % of notes on the annotated string):

| | GP dev | **GP test** | GS dev | **GS test** |
|---|---|---|---|---|
| lowest fret | 52.5 | 46.9 | — | — |
| cost model only (`--no-prior`) | 56.7 | 51.4 | 71.5 | 65.4 |
| + prior from GP dev only (`--prior-from gp --prior-parts cell,move`) | 64.6 | 57.0 | 72.2 | **67.7** (zero-shot) |
| **shipped** (prior from GP dev + GS dev) | 64.8 | **57.5** | 75.8 | **72.5** |

GP = 569 standard-tuned tracks / 94,890 fretted notes (even file = dev). GS = GuitarSet's 360
annotated tracks (players 0–2 dev, 3–5 test). **Read the GS test number honestly:** test players
perform the SAME pieces as dev players, so a GS-trained prior is flattered; the 67.7 zero-shot row
is the claim to quote for unseen material. GP test is low because the corpus mixes jazz heads,
comping and rock — three fingering cultures — not because the DP is broken.

**⚠ Correction to the earlier baseline (PR #114):** that run called
`parseGuitarProOrXML(bytes, true, index)` but the signature is `(bytes, fileName, useSharp,
partIndex)`, so EVERY track was track 0 — its "281 tracks / 151,248 notes / 58.1 % test" are
wrong. The corrected corpus is above.

### P0c — techniques captured from the GP bytes (zero alignment risk)

The GP3/4/5 + GPIF parsers already consumed the effect bytes to stay aligned; they now KEEP them,
tuplet-style. `TECHNIQUES = bend · slide · hammer · harmonic · palmMute · vibrato · letRing ·
staccato · trill · tremolo · grace · ghost · accent · dead · tap`. Events gain **`tech
{engIdx:[tags]}`** and **`bends {engIdx: quarter-tones}`** (GP bend units / 25) **only when
present**, so technique-free events — and every pinned corpus output — stay byte-identical.
`transposeScore` drops `frets`/`tech`/`bends` (position-specific). Gotchas: **structured clone
drops non-index array properties**, so bend size can't ride on the tag array → separate `bends`
map; `_gpBuildScore` keeps the first of consecutive identical chords, so a technique that sits
only on a repeated chord is lost with it (that's the harmonic score model, not a misread).
**Validated** (`tests/bench/techniques.mjs` vs PyGuitarPro, 54 files): 2955 track×technique
presence agreements, **0 false positives**, 21 misses (all repeated-chord merges).

`score.tuningMidi` (new, all parsers): the open-string MIDI keyed like `frets` (0 = low E … 5 =
high e, `null` for an absent string) — a 4-string bass reads `[null,null,28,33,38,43]`, Eb tuning
is exact. `isPercussionTuning` flags a drum track (all-zero tuning).

### P0d — `scoreToAlphaTex`: tab export with string + technique

alphaTab 1.8 syntax (metadata arguments in parentheses; `fret.string{note props}.dur{beat props}`),
one staff per score, tuning from `tuningMidi`, per-bar meter, `_voiceNotationMeasures` for the
rhythm (16th grid, ties, metric note values). Events landing on the **same 16th slot are merged**
into one beat (ML onsets of one strum arrive tens of ms apart; two beats can't share a slot). When written frets don't fit (or none exist) it falls back to `fingerScore(…, {overwrite:true})`.
A drum track THROWS ("This is a drum/percussion track — it has no strings to write as tab.") and the
UI shows the message. **Unplayable pitches are left out and counted (2026-10-24).** A pitch
no string can play (below the lowest open string or above fret 22 — a bass note when Guitar → Tab
hears a full mix, a model's octave-up ghost) is resolved out BEFORE the rhythm is spelled, and the
file opens with `// N notes outside this instrument's range … left out`. Before, it was dropped only
when the cell was written, so its cell became a rest of the NOTE's value — syncopated, dotted rests
mid-bar (a user's tab read `r.2 r.8 r.4 r.8` where the audio had a note) — and `fingerShapes` gave
the WHOLE chord no shape when one of its pitches was unplayable. Now only that pitch goes (corpus
coverage 99.07 → 99.16 %, GP fingering test 57.5 → 57.6 %; on GuitarSet 215 of 60,500 model notes
are out of range). Wired as **AlphaTex (tab)** in `ChartPanel` (`.alphatex`; paste into any
alphaTab viewer, e.g. the alphatab.net playground). **Validated** by parsing every corpus part
with `@coderline/alphatab@1.8.4` (test-only dev dep): **299 parts, 0 parse failures, 0 warnings,
bar counts exact, 99.07 % of notes present**; the 191 pitch differences are all harmonics
(alphaTab sounds a natural harmonic at its harmonic pitch, by design).

### P1/P2 — Guitar → TAB: the 🎸 Guitar → Tab (ML) note model, on device

**Model:** Riley et al.'s guitar retraining (GAPS, ISMIR 2024 — **MIT**) of Kong et al.'s
high-resolution onset/offset-regression CRNN (MIT), HF `xavriley/midi-transcription-models`
`guitar-gaps.pth` @ `b7bec65a…`. Converted by **`scripts/guitar_crnn_export.py`** (pinned
revision + pth SHA-256 + pti commit `7568dc7f…`): fp32 ONNX opset 17 (**matches PyTorch to
1.8e-6**) → **weight-only int8** (per-output-channel scale + `DequantizeLinear`; activations stay
fp32) = **25.0 MB**, `models/guitar-crnn/guitar-gaps.w8.onnx` + NOTICE, SHA-256 `84db798e…f5`.
Input 10 s of 16 kHz mono (log-mel front end is IN the graph); output four `[1001 × 88]` heads.

**Do not re-derive — measured:**
- **ORT's `quantize_dynamic` destroys it** (int8 activations): GuitarSet note F1 **0.55 %**. Weight-
  only int8: **83.3 % vs 83.1 % fp32** (30 tracks).
- **Export the wrapper in eval mode** (`Wrap(m).eval()`): `torch.onnx.export` restores the
  exported module's ORIGINAL mode afterwards, and a fresh `Module` is in training mode → the inner
  CRNN came back with dropout on, and every PyTorch comparison after the export "disagreed" (0.977).
  The ONNX was fine; the reference was not. The script now computes the reference first and asserts.
- Memory in onnxruntime-web (Node): **105 MB RSS int8 vs 269 MB fp32**.
- `HF_HUB_DISABLE_XET=1` is required here: `cas-server.xethub.hf.co` is not on the allowlist.
- pip/PyPI **works** in this container (torch 2.14.1, onnx, onnxruntime, mir_eval, pyguitarpro were
  installed into a scratch venv) — the conversion needed no cloud.

**Engine (pure, headless-tested):** `CRNN` constants, `crnnSegments` (50 %-overlap windows, as the
reference), `crnnDeframe`, `crnnBinarize` (onset/offset peak + regression shift, clamped to ±0.5;
0 when the parabola's denominator is 0), `crnnNotesFromOutputs` (a port of the reference
`RegressionPostProcessor`) and `async transcribeGuitar(pcm, model, opts)` → `{ notes, score }`
(`score = fingerScore(polyNotesToScore(notes))`). The JS port reproduces the Python reference
**414/414 notes** on real GuitarSet audio.

**Glue (browser-only), same rails as the stem separator:** `guitar-model.js` publishes
`window.TTP_GUITAR_MODEL(pcm16k, {onProgress})` → module Worker `guitar-worker.js` (imports the
page's own engine via `__TTP_ENGINE_URL__`; main-thread fallback; terminated after each job) →
`guitar-model-core.js`: Cache-API + SHA-256-checked weights (a bad cached copy is evicted), ONE
session on the **pinned ONNX Runtime Web 1.23.2 plain build** (imported from stem-model-core.js —
#33426), `capWasmMemory()`, single thread, no arena / mem-pattern. Lazy: nothing downloads until
the button is pressed. `pages.yml` ships the glue + model + NOTICE and stamps `guitar-model.js?v=`.
**UI:** Audio mode → **🎸 Guitar → Tab (ML)** → progress per 10 s window → a `ChartPanel` tab
chart (notes re-scored on ♩=/meter changes without re-inference; strings are labelled
"inferred").

**Measured on GuitarSet** (all 360 mic recordings, fp32 ONNX through `scripts/guitarset_infer.py`;
Tab = onset ±50 ms + pitch + STRING, strings from the shipped `fingerScore`):

| | clean | + white noise at 20 dB SNR |
|---|---|---|
| note F50 (mir_eval, per-track mean, offsets ignored) | **86.3 %** (P 87.8 · R 85.3) | **85.8 %** |
| note F1, pooled (bench matcher) — dev / test | 81.5 / 86.0 | 80.7 / 85.7 |
| **Tab F1, shipped fingering** — dev / test | 58.5 / **61.6** | 57.6 / 60.2 |
| Tab F1, GP-only prior (zero-shot strings) — test | **57.8** | 56.8 |
| Tab F1, cost model only — test | 54.9 | — |

For orientation only (metric definitions not verified to match, so not a like-for-like comparison): TART reports 81.35 F50
and 54.08 end-to-end Tab F1 zero-shot. Noise robustness is the model's — −0.5 F50 at 20 dB. The
gap between note F1 (~86) and Tab F1 (~58–62) is all Stage 3: **string choice is now the
bottleneck**, and solos are worst (oracle-MIDI string accuracy comp 81.0 % vs solo 56.1 %).

**Real app end to end** (`tests/bench/guitar-e2e.mjs`, headless Chromium, real worker + model +
ORT 1.23.2 from jsDelivr, no stubs; `00_BN1-129-Eb_comp`, 22.3 s): **117 notes, note F1 87.2 %, Tab F1 86.4 %**, the AlphaTex export
parses in alphaTab with **all 117 notes** in 12 bars (tempo read as 130; GuitarSet says 129); only
the three ORT 1.23.2 files + the four same-origin guitar files load; peak **+595 MB** over the page;
**3.2× real time** (single-thread WASM on this 4-core container — ~70 s per 22 s of audio; a phone
is likely slower). With an iPad Safari UA on a test-player solo (`05_SS3-98-C_solo`, 39.2 s): same
files, +629 MB, 2.5× real time, note F1 96.8 % but **Tab F1 25.8 %** — a solo line fingered in the
wrong position is the typical failure. **Bugs this run caught:** (1) `ChartPanel` auto-Simplified the
tab (a guitar line is "melodic") and exported one chord per bar → `autoSimplify={false}` on the tab
chart (+ its own overrides, it was sharing the chord chart's); (2) the bench itself clicked the
LAST "AlphaTex (tab)" button — the audio chord chart's, which renders after the tab — and read 87
"missing" notes; it now scopes to the tab panel.

**Honest limits:** zero-shot strings are the DP's guess — playable, not necessarily the player's
(no audio string evidence yet = P3). No technique classifier yet (P4): audio tabs carry no `tech`.
GuitarSet is unaccompanied acoustic guitar; a full mix must be separated first (SCNet's "other" stem holds
guitar AND keys — no open model splits them). Device check remaining: first-tap load + memory on a
real iPhone/iPad.

### Tab viewer — the AlphaTex tab drawn and played in the app (2026-10-24)

**The ask:** "I saved it as an .alphatex but I don't have anything to read it or render it." The app
wrote a tab it could not show. Now it shows it: **notation + tablature, with playback**, on iPad/iPhone.

- **Renderer: alphaTab 1.8.4 (MPL-2.0), vendored same-origin** in `vendor/alphatab-1.8.4/` (entry +
  core + render worker + audio worklet, the Bravura woff2/woff font, the 977 KB SONiVOX sf3 sound font;
  NOTICE + licences alongside). Same-origin is load-bearing: alphaTab spawns its render **worker** and
  audio **worklet** from its own URL, which a CDN copy can't do cross-origin. Files are the npm
  release's `.min.*` builds **unmodified, renamed** to the names the entry imports (`alphaTab.core.mjs`,
  `alphaTab.worker.mjs`, `alphaTab.worklet.mjs`) — `npm test` checks them byte-for-byte against the
  test dep `@coderline/alphatab@1.8.4`. The **version is in the folder name**, so those files are never
  stamped and a cached copy is always the right one; upgrading = a new folder.
- **Glue: `tab-view.js`** publishes `window.TTP_TAB_VIEW.mount(el, tex, {profile, scale, scrollElement,
  onState, onPlayer})` → `{ setTex, setProfile, playPause, stop, setSpeed, destroy }`. Lazy (nothing at
  boot; the first tab view fetches ~2.4 MB, then HTTP-cached), a failed load resets so a retry retries,
  errors come back through `onState`. `pages.yml` ships it + the folder and stamps `tab-view.js?v=`.
- **UI:** `ChartPanel` gains a **Tab** view next to Chart / Grid (`TabView` component: ▶ Play / ⏸, ■,
  speed 50–125 %, clock, "Notation + tab" / "Tab only", white paper, scrolls itself into view on a
  phone). The Tab view and the **AlphaTex (tab)** export are the SAME memo (`tabTex`), so they can't
  disagree. The 🎸 Guitar → Tab chart opens **on** the Tab view (`defaultView="tab"`). **MusicXML / GP**
  mode also opens a saved `.alphatex` (`alphaTexFromBytes` → `isAlphaTexText`: binary magics rejected
  first, then the first token must be an AlphaTex metadata tag), and the session restores it
  (`kind:"alphatex"`).
- **The tab skips Simplify** (`tabScore`): Simplify replaces a melodic line with one inferred chord per
  bar — right for a chord chart, wrong for a tab (it drew Blue Sky's lead as block chords with empty
  bars). Arrange and transpose still apply; a note under the toolbar says so when Simplify is on.
- **Key signature:** `scoreToAlphaTex(…, { key })` writes `\ks` (`_atexKey`, spelled like ABC's K:).
  **Use the compact form** (`E`, `Db`, `c#minor`): alphaTab 1.8 reads the spaced `(C# minor)` as C#
  MAJOR. All 24 keys read back as `_keyFifths` (tested). No key → no `\ks` (old output unchanged).
- **Measured** (`tests/bench/tab-view-e2e.mjs`, the real app in headless Chromium, iPad and iPhone UAs):
  Blue Sky `.gp` → 165 bars drawn in ~1 s, playback clock advances (0:03 after 4 s); the saved `.alphatex`
  from the guitar run opens (12 bars); only the vendored files load, 0 failed requests, 0 console errors;
  at 390 px the viewer scrolls into view and draws. `guitar-e2e.mjs` now also checks the 🎸 chart's Tab
  view draws (12 bars, E♭ major signature on the E♭ track).
- **Device check remaining:** first view + playback on a real iPad/iPhone (Safari audio unlock, memory on a
  long score). Not built: print/PDF of the tab (alphaTab's `print()` opens a popup — iOS-hostile).

## Chord-voicing modal — guitar diagrams for lead-sheet chords (2026-10-24)

**The ask:** the traditional chord-fingering diagram players expect when reviewing voicings,
as a modal on the lead sheet (reference: the sibling **Parker-songbook-tool**, MIT, same owner),
backed by a chord library big enough for "pretty much every voicing".

- **Trigger:** tap a chord on the lead sheet (non-Edit mode) or a bar in the Grid → `ChordVoicingModal`
  (`ChartPanel` state `voicingChoices`; a grid bar with several chords shows chips to switch).
  The old readout still updates underneath. Escape / backdrop / × closes.
- **Engine (pure, `engine.tsx`, headless-tested):** `parseChordSymbolForVoicings` (aliases
  `CHORD_SUFFIX_ALIASES` — `min7/m7/-7→m7`, `maj7/Δ7/Δ/^7/^→maj7`, `m/min/-→m`, `dim/°`, `dim7/°7`,
  `aug/+`, `m7b5/ø/ø7`, plus the engine's own `m7♭5`/`m(maj7)`/`6/9`/`7♭9`; the **slash bass is kept for
  display** (`C7/E`) and the lookup runs on the main chord (`C7`); `6/9` is a suffix, not a slash) →
  `voicingFormula` (an **interval grammar**: any suffix it can read gets a tone list, `required` tones
  and a drop core, so a chord the dictionary lacks still gets voicings) → `chordVoicings(dict, symbol,
  {played})` → groups **In this chart** (the file's own frets, as written) · **Slash bass** · **Library**
  (chords.json) · **Drop 2** · **Drop 3** · **Triads** · **Shells** · **More shapes**, every voicing
  pitch-validated, finger-assigned (`assignChordFingers`: index barre, ≤ 4 fingers or rejected),
  labelled with intervals, deduped across groups. `voicingToSVGuitar` maps a voicing to svguitar's
  payload (string 1 = high e, frets relative to the window). `chordSubstitutions` (ported from
  Parker-songbook-tool) is classified from the TONE SET, so every alias works; tap one → its voicings.
- **Dictionary lookup is by root PITCH CLASS** (`VOICING_DICT_KEYS`), so `Db7`/`C#7`, `Gb`/`F#` reach the
  same entry — the enharmonic-spelling limitation of a name lookup does not apply here. Suffix: exact
  name → rename table → the dictionary suffix with the SAME tone set. chords.json's `alt` is a ♭5 triad,
  NOT a 7alt, so a lead-sheet `alt` never routes there (`_VC_DICT_NAME.alt = null`).
- **`data/chords.json`** (1.2 MB, ~120 KB gzipped) = tombatossals/chords-db (MIT) via
  Parker-songbook-tool, **validated + extended** by `scripts/build_chords_json.mjs` (deterministic,
  imports the engine): every base shape is checked against its chord's formula — **162 of 3,283 were
  dropped** (wrong key, add9 filed as 9, 7♯11 filed as 9♯11, the ♭5 "alt"…); 20 qualities added (7♯11,
  13♭9, maj7♯11, m13, 9sus4, 7♭9♭13 …); every key × quality topped up to **12** shapes from
  `enumerateChordGrips` (`"generated": true`) → **10,447 shapes, 106 suffixes × 12 keys**. Slash entries
  are kept validated but not topped up (the modal generates slash grips live). Regenerate after changing
  the grammar/generator: `node scripts/build_chords_json.mjs`. `npm test` asserts every key × every
  `QUALITIES` suffix has ≥ 12 valid library shapes.
- **Glue (browser-only, `TabDecoderPro.tsx`):** `loadChordDictionary` fetches `data/chords.json` once and
  caches the promise in memory (a failed fetch clears it so the next open retries; the generated groups
  still render with a notice). `loadSVGuitar` injects the **bundled local `./js/svguitar.umd.js`**
  (svguitar 2.5.1, MIT, unmodified, SHA-256 pinned in `js/NOTICE-svguitar.txt` — no CDN at runtime) on
  first open. Fingers / Intervals is remembered per device (`ttp:voicingMode`). Tap a diagram to hear it
  (`playScore`). `pages.yml` ships `js/` and `data/chords.json` + `data/NOTICE`.
- **Gotcha fixed on the way:** `.panel-rise` used `animation-fill-mode: both`, which leaves a
  `transform` on every panel — and a transformed ancestor re-roots `position: fixed`, so the modal drew
  inline inside the panel. It is now `backwards` (same look; no kept transform). Don't put it back.
- **Measured** (`tests/bench/voicings-e2e.mjs`, the real app in headless Chromium at 390×844): Peg →
  `Em7/D` opens with **58 diagrams in ~0.9 s**, Intervals relabel, a substitution opens its own voicings,
  a second chord re-uses the cached dictionary (`/data/chords.json` and `/js/svguitar.umd.js` each fetched
  **once**, no other origin); Blue Sky rhythm part shows the file's `0 2 2 1 0 0` first. Engine: ~20 ms per
  chord. **Device check remaining:** a real iPhone/iPad (tap targets, scroll inside the modal, audio).
- **Honest limits:** standard tuning only; generated grips are playable by a 4-finger/4-fret model, not
  ranked by a guitarist's taste (the dictionary shapes come first for that reason); fingers on generated
  shapes are a heuristic; interval labels on open strings aren't drawn (svguitar has no text for them).

## Path B (scans / photos) — OUT OF SCOPE

Raster tab (a photo or scanned page) has no text layer and needs an OMR/Vision
pipeline (the hybrid Python + Vision approach explored earlier). It is **not**
implemented here and should not be bolted onto the Path A parser. Keep them
separate if Path B is ever built.

-----

## The one untested link

The recognition engine and the Path A algorithm are both **validated** (see
below). The single piece that could not be unit-tested headlessly was the
**in-browser PDF.js extraction** in `extractTokens` — loading PDF.js from the
CDN and reading the uploaded file in a real browser. The algorithm it feeds is
proven against the real file via the Python reference; the browser glue is the
part to smoke-test first on real hardware. If a real PDF yields odd bars, log
the raw token stream out of `extractTokens` and compare against the reference.

**Update (2026-06-08 session):** the extraction *algorithm and coordinate math*
are now covered headlessly — see `tests/` (`npm test`). The harness reproduces
`extractTokens` with `pdfjs-dist@3.11.174` (the exact version the app loads from
the CDN; `getTextContent` item `.str` + `.transform` is identical across the CDN
and npm builds) and loads the real engine/parser out of `TabDecoderPro.tsx`
(no copy → no drift). Against the committed `Blue Sky` PDF it reconstructs all
**165 bars** with the correct progression (verse `E A A E E A A E`, the `B` at
section turns, `C#m`/`F#m7` bridge), and the tempo-`100` spike token is correctly
dropped. `npm run tokens` dumps the raw stream for the diff above.

What that harness still does **not** reach (genuinely browser-only, smoke-test on
real hardware): loading `pdf.min.js` from cdnjs + setting `workerSrc`; the
`<input type=file>` → `File.arrayBuffer()` read; and the PDF.js **web-worker**
path (the harness runs on the main thread).

Note: the source is now **two files** — `engine.tsx` (pure engine) and
`TabDecoderPro.tsx` (React UI, default export). See "Source layout" near the top.
`.txt` mirrors of each sit in the repo root. (This doc historically said `.jsx`
and "single file"; both are superseded.)

PDF.js is loaded from cdnjs (`pdf.min.js` 3.11.174 + matching worker). If you
move to a bundler, switch to the npm `pdfjs-dist` package and set `workerSrc`
accordingly.

-----

## Validation (re-run if you touch the engine or parser)

- **Engine**: 12 preset voicings pass (C, G, Am, Em, F-barre, C/E, D/F#, Asus4,
  Dm7, G7, Cmaj7-no5 → 75% “missing 1”, D5 in Drop D). The Drop-D case
  specifically guards Invariant 2.
- **Extended qualities** (`npm test`): the additive `add9/m(maj7)/6/9/9/m9/maj9/7♭9/7♯9`
  set recognises each canonical C-rooted voicing (e.g. `{C,E,G,Bb,D}` → `C9`,
  `{C,Eb,G,B}` → `Cm(maj7)`, `{C,E,G,Bb,Db}` → `C7♭9`) AND does **not** over-label the
  plainer chords (triad stays `C`, `maj7` stays `Cmaj7`, `7` stays `C7`, `m7` stays
  `Cm7`; `{C,E,G,A}` stays `Am7/C`). The whole validated corpus above is the regression
  guard that nothing existing shifted.
- **Path A**: the Python reference parser reconstructs **all 165 measures** of
  Blue Sky with the correct progression — verse I–IV (`E | A | A | E …`), the V
  chord (`B`) at section turns, and a bridge with `C#m` / `F#m7`. If a parser
  change drops the bar count or mangles the progression, it regressed. This same
  check now runs headlessly in JS over the real PDF: `cd tests && npm test`
  (asserts the bar count, verse, V chord, and bridge; exits non-zero on
  regression).
- **Score model**: the same `npm test` also asserts `buildScore` over Blue Sky —
  165 scored bars, every bar's first chord on the downbeat, strictly-increasing
  beats, per-bar durations summing to 4, and the bridge turn (bar 126 =
  `B C#m A`) landing as three chords on rising beats. Bar 26 (`B C#m`) places
  `B` on beats 1–2 and `C#m` on beats 3–4.
- **Path C (MusicXML)**: `npm test` parses `tests/fixtures/sample.musicxml` and
  asserts Standard tuning (from `<staff-tuning>`), 3 bars `C G | Am | F`, beats
  (C beat 1 / G beat 3 in 4/4), the **mid-tune 3/4 change** in bar 3, real MIDI
  carried through (`[48,52,55]`), and the pitch-less fret-only note resolving via
  the tuning. The headless harness installs `@xmldom/xmldom` as a **test-only**
  `DOMParser` (the app uses the browser's) so the exact source runs — the app
  stays zero-dependency.
- **Export / transpose**: `npm test` asserts `scoreToChordPro` / `scoreToABC`
  reflect an edit override (`{"2.0":"A7"}`), the ABC header + `[M:3/4]` change +
  `[C,E,G,]` voicing, and `transposeScore(+2)` re-recognising `C G | Am | F` →
  `D A | Bm | G` (and `n=0` passthrough). The ABC was additionally confirmed
  *playable* via the play-sheet-music tool.
- **Playback scheduling**: `npm test` reads the fixture's `<sound tempo="120">`
  and asserts `scoreEventTimes` lays the 4 events at 0/1/2/4 s with durations
  1/1/2/1.5 s (the 3/4 bar 3 starting at 4.0 s), total 5.5 s, MIDI carried
  through. The Web Audio synth (`playScore`) is the browser-only glue on top.
- **Key / roman numerals**: `npm test` asserts `analyzeKey` → **C major** for the
  fixture (`I V vi IV`) and **E major** for Blue Sky (E/A/B = I/IV/V, C#m = vi,
  F#m7 = ii7), and that the key reaches the exporters (`K:C`, `{key: C}`).
- **MusicXML export round-trip**: `npm test` exports the fixture (with `<harmony>`
  + `<sound tempo>`), re-parses it, and asserts identical chords, the 3/4 change
  and tempo survive; an `A7` override surfaces as a `<kind>dominant</kind>`
  harmony; and the **full Blue Sky score** round-trips to 165 bars with the verse
  intact.
- **SynHarmonics v2 (audio chords)**: `npm test` pins the anti-aliased resampler (15 kHz tone
  −40 dB+ vs box decimation), tuning (+35¢ read within 10¢; compensation concentrates chroma on
  the chord tones at +45¢), NNLS overtone attribution (Bb's 3rd harmonic not an F) without
  starving a real 5th, the sub-octave bass guard (B3-E4-G4 → bass B), C G Am F with bounded
  confidence/prob + alternatives, inversion STATES (C/E vs Em), foreign-bass slash (`F#m/G`,
  `Bb/C`, and `D7/C` = the oracle's name), short-gap carry vs long rest, posterior
  normalisation, the v2 default + `engine:"v1"` routing, and the UI glue (resampler, review
  strip, uncertain rendering). Accuracy itself is measured by `tests/bench` (dev/test split).
- **Chord vocabulary** (`npm test`): no vocabulary = `full` = an unknown name (engine default unchanged);
  chart reads C6/9-over-C as `C`, Cmaj7-over-B as `Cmaj7`, Dsus4-over-A as `Dsus4` (hidden inversion),
  never names A-C-E-G-over-C from an A root, still writes `C/E`, `Bb/C`, `C7/Bb`, has no `F#m/G`; basic
  never writes a slash; vocabulary contents are real chord tones and exclude the bass-is-root inversions;
  hidden inversions carry no bass note; alternatives obey the vocabulary; `recognise` + `chartsFromStems`
  honour it; UI guards (picker, Chart default, both call sites, Simple gone, per-device storage).
  Mutation-tested (re-allowing 6/9 + the m7/♭3 hidden state → 5 failures; dropping hidden → 4).
- **v2.1 batch / stems / capture**: `npm test` pins the noise-floor rest gate (hiss in a rest
  is not a chord; `flatEntropy:1` lets it through), `commitChordChoices` / `autoResolveChords` /
  `reopenAutoChords` semantics (no mutation, candidates only, user commits survive Auto off),
  `stemRoleFromName`, NMF drum F > 0.85 per drum on a rendered kit + the groove grid + GM MIDI,
  `chartsFromStems` end-to-end (one chart per instrument, drum-tracked shared grid, band C → G,
  bass roots, vocal melody), `encodeWav16`, and the separator/capture contracts (pins, SHA-256,
  SCNet-not-htdemucs, worker + fallback, blocks, deploy list, no `accept`, raw capture, no
  stream-ripping code). Plus the separator core run end-to-end through the REAL vendored
  library with a fake session (named-export binding, private-mode cache guard, 3 blocks,
  stems = mask × input, stems sum to the mix), progress that reports work COMPLETED (first event
  0 done after 0 runs, monotone) and `progressEta`. Low-memory mode: the 120-frame contract through
  the real library, the pinned SHA-256 of the committed model, cache/eviction/refusal, lean session
  options, device detection, worker teardown, the WASM-reservation cap (ladder + pass-through +
  genuine Memory objects), the crash rail and the deploy list. Pinned runtime (2026-10-23): full
  AND compact WASM separation through the real library with only ORT faked at the import seam —
  ORT 1.23.2's plain build is the one imported (never 1.30.0), the library's pinned weights are
  loaded once, one session reused and released once, the model's own frame count; WebKit never gets
  WebGPU; errors carry the `[stems …]` label exactly once; the deploy stamp rides worker → core →
  vendor (not the model URL); the UI's engine-bug hint. Real-model numbers:
  `tests/bench/scnet-e2e.mjs` (`--compact 1` for the phone path, `--ua`/`--stamp` to emulate a device
  and a deploy) and `tests/bench/ort-pin.mjs` (1.23.2 vs 1.30.0, bit-for-bit).
- **Key model v2 + manual override**: `npm test` asserts the reported defect is fixed
  (`D · C · G` reads **D major**, and E minor — whose tonic never sounds — loses by >20%),
  the same shape a step round the circle (`G · F · C` → G), that a genuine minor tune and a
  minor blues **stay minor** (the over-correction guard), that Confirmation-shaped changes
  survive their secondary dominants, the slash-bass vote (`Eb6/9/F` bass F, but `C6/9`/
  `Csus4` have none), `parseKeyName`'s accept/reject set, and that a manually set key reaches
  the ABC `K:` and CSMPN `Key:` headers.
- **Song structure**: `npm test` renders a synthetic A-B-A-B-C-B song and asserts
  `detectSections` finds most of the form with **no invented boundaries** (every detected
  one within 1.5 s of a real one), clusters the repeats together, gives the once-only bridge
  its own letter, and returns contiguous sections; `nameSections` is tested on its own
  (short opener → Intro, loudest recurring → Chorus, quieter recurring → Verse, late one-off
  → Bridge); and `applySectionsToScore` maps times to the right bars, never mutates its
  input, pushes a colliding label to the next bar, and reaches CSMPN `- Chorus`, CSML
  `[Chorus]` and a MusicXML `<rehearsal>` that `parseMusicXML` reads back.
- **Multi-part picker**: `npm test` parses `tests/fixtures/sample-multipart.musicxml`
  and asserts two parts (`Guitar`, `Rhythm`), `partIndex 0 → C` and `1 → G`, and
  that the single-part fixture reports exactly one part.
- **Vocal score v2**: `npm test` asserts the voice-leading split keeps a lone low line in the
  bass slot and a solo verse whole on the lead staff (the register method fails both), drops an
  octave ghost not the bass, learns registers from full chords, suggests the right voice count;
  range naming/clefs (S/A/T-8vb/B, SSA repeats, harmony + numbered modes); KK key; scale-degree
  spelling (C♯ in Dm, B♭ in F, E♮ in E♭, F𝄪 in G♯m, B♯3); metric values (4/4, 6/8, no dotted
  rests); choral MusicXML structure; ABC key-relative pitches; range report; format-1 MIDI.
- **ABC 2.1 compliance**: `npm test` asserts the `%abc-2.1` + `I:abc-charset utf-8` file header and
  blank line before `X:`, `text/vnd.abc`, K: names spelled like the notes (D#m/G#m/Db), pitches
  relative to K: with reader-robust accidentals, `"N.C."`, the brass header, and the UI's Apple
  `.abc.txt` fallback (Apple maps `.abc` → Alembic 3D). Externally verified with abcjs (0 wrong
  pitches, 0 warnings across Blue Sky/Peg/Anthropology/Au Privave/Yardbird + vocal/brass ABC).
- **Audio → TAB** (`npm test`): `fingerSequence` keeps every shape inside the hand span and
  beats lowest-fret on corpus excerpts; `fingerScore` fills frets without mutating its input and
  keeps written ones; technique capture (exact tag counts and bend sizes on fixtures, `tuningMidi`
  for bass / Eb / drums); `scoreToAlphaTex` output parsed by alphaTab 1.8.4 (strings, techniques,
  same-slot merge, the drum-track refusal); the CRNN post-processor on synthetic heads (window
  count, regression shift, an E4 note) and `transcribeGuitar` with a fake model; the glue
  contracts (SHA-256 pin = the committed file, ORT 1.23.2 pin, worker + fallback, `pages.yml`
  stamp, UI wiring) and `guitarSession` against a fake ORT. Accuracy is measured by the benches
  (`fingering.mjs`, `guitarset.mjs`, `techniques.mjs`, `guitar-e2e.mjs`), not asserted.
- **Tab viewer** (`npm test`): all 24 `\ks` keys read back as the right signature in alphaTab;
  Blue Sky with a key → 4 sharps, 165 bars, and without one → no `\ks`; `isAlphaTexText` /
  `alphaTexFromBytes` accept AlphaTex (title, comments + BOM, bare metadata) and reject ChordPro, LaTeX,
  MusicXML, GP and empty input; the vendored alphaTab is byte-identical to the 1.8.4 release and imports
  the names it ships under; tab-view.js contracts (same-origin path, lazy import, retry, synth player,
  destroy); index.html + pages.yml wiring; the Tab view and the export share one AlphaTex; the tab skips
  Simplify; the guitar chart opens on it; `.alphatex` upload + restore. Rendering itself: `tab-view-e2e.mjs`.
- **Chord-voicing modal**: `npm test` pins the parser aliases (the specified list + engine spellings),
  slash handling (`C7/E` display vs `C7` lookup; `6/9` not a slash), interval sets + required tones, lookup
  by pitch class (Db = C#), relative→absolute frets, that EVERY voicing in every group of 26 qualities
  sounds only chord tones, has its root (or is flagged rootless), is fingered, labelled, unique and within
  5 frets; drop-2/drop-3 string geometry (Cmaj7: 12 drop-2 shapes incl. x-x-10-12-12-12), the slash-bass,
  triad, shell and as-written groups, finger assignment (F barre, open C, 5-finger rejection), the svguitar
  payload, substitutions (incl. the 6-chord case), the ≥ 12-shapes coverage of chords.json, the pinned
  svguitar file + licences, and the UI/pages wiring. Rendering: `tests/bench/voicings-e2e.mjs`.
- **Lyrics import (`parseLyrics`)**: `npm test` asserts the strict chord matcher accepts
  real chords and rejects note-letter lyric words (Add/Cab/Bad/Fed/Gem/Bee/Ace), the
  line-level `isChordLine` catches chord lines but spares lyric/blank lines, a full
  chords-over-lyrics parse strips chords and keeps the `[Verse 1]`/bare-`Chorus` sections,
  the ChordPro dialect captures `{title}`/`{artist}`/`{c:}`/`{soc}` + inline-chord stripping
  and skips `{sot}…{eot}`, blank lines split stanzas, `[A]` reads as a chord while `[Verse A]`
  is a label, and empty/null/all-chords input yields no sections without throwing. Plus UI
  contract guards (imports `parseLyrics`, ships `LyricsImport`/`LyricsPanel`, Lyrics mode
  renders `LyricsPanel`, file input has no `accept`).

## Session conventions

- Surgical edits over rewrites. Preserve working code; don’t restructure the
  shared engine path to “clean it up” unless a test forces it.
- One engine path (`engine.tsx`), no new app dependencies without a reason.
- Update this CLAUDE.md at the start and end of each working session.

-----

## Roadmap (agreed 2026-06-20) — recognition-engine evolution

The owner approved a sequenced plan to grow this from a "smart tab decoder" into
a persistent, worker-driven, AI-assisted music-cognition tool — **without ever
regressing the validated engine** (every step is additive; `npm test` stays the
contract). Build strictly in this order; each wave depends on the prior.

**Wave 1 — Foundation (no engine *logic* change):**
1. ✅ **Engine module extraction** (`engine.tsx`) — DONE 2026-06-20. The keystone:
   unblocks the Worker, ONNX, audio, and cross-trio engine sharing.
2. ✅ **OPFS persistence** — DONE 2026-06-20. See "Session persistence" below.
   Substrate for step 4.
3. ✅ **Web Worker offloading** — DONE 2026-06-20. See "Parse Web Worker" below.
4. **Memory eviction + OPFS handoff** — `_reparseScore` reads buffers from OPFS
   instead of holding `_gpbuf`/`_gpxbuf` in state; move the CSMP handoff payload to
   `opfs:handoff:v1` to kill the 1.5 MB MusicXML drop.
5. **Service Worker offline** — ⚠️ NOT trivial here: "offline" must cache the
   in-browser transpile *toolchain* (Babel-standalone ~3 MB + esm.sh React + cdnjs
   PDF.js) cross-origin, plus a **versioned cache** so a stale source can't pin
   users to old code. Consider a tiny precompile-at-deploy step only if true
   offline becomes a priority (the one place to relax zero-build).

**Wave 2 — View decoupling + deterministic wins:**
6. ✅ **ChartPanel / view-layer decoupling** — DONE 2026-06-20. ChartPanel is now
   the CONTROLLER; the render is four pure sub-views (`MelodicNudge`,
   `LeadSheetView`, `GridView`, `ExportPanel`). See "Shared ChartPanel" note.
7. **PDF *Edit-tuning* UI** — the **manual** per-system string-shift override only.
   Do **NOT** build the auto-anchor heuristic: CLAUDE.md (Kid Charlemagne, 52.6 vs
   53.3 pt) proves any auto-shift that fixes a sparse system regresses the
   correctly-anchored Blue Sky output. Manual override is the honest escape hatch.
8. ✅ **Procedural arrangement generator** — DONE 2026-06-20. `arrangeScore` +
   `ARRANGE_TEMPLATES` (block/quarters/eighths/shuffle/sixteenths/skank) → same score shape, reuses
   every exporter (CSMPN/CSML `{hybrid}`, MIDI, ABC). See the **Arrange** bullet
   under "Shared ChartPanel".
9. ✅ **MIDI export** — DONE 2026-06-20 (built ahead of order while #4 was blocked).
   `scoreToMidi` → `.mid`; see the MIDI export bullet under "Shared ChartPanel".

**Wave 3 — AI/Audio moat (additive; engine stays oracle + fallback):**
10. **ONNX chord classifier** — a **confidence-gated second opinion**, NEVER a
    replacement for `QUALITIES` (which is also the test oracle). **Phase 1 DONE
    2026-06-20** (see "Wave 3 #10" section): the pure-JS classifier brain +
    `arbitrateChord` contract ship now (no ONNX runtime needed — sidesteps the
    iOS/Pages COOP/COEP thread wall). **Pending:** swap the matmul body for a real
    `.onnx` (runtime-fetched asset, in the Wave-1 worker) + the display-only UI
    wiring.
11. **Shared pitch-detection pipeline → monophonic transcription (MVP)** — **DSP
    foundation DONE 2026-06-20** (see "Wave 3 #11" section): pure-JS YIN
    `detectPitch` + `transcribeMonophonic`, headless-tested with synthesized tones.
    **Pending:** the browser-only mic-capture seam (getUserMedia + AudioContext) +
    a live tuner/listen UI (device-only).
12. **Practice mode** — match mic input against known expected chords (reuses #11).
13. **AI arrangement** — optional upgrade over #8.

**Wave 4 — Visionary:** system-audio/polyphonic capture → Path B OMR (keep
SEPARATE from Path A) → WebRTC collab → live Web MIDI / DAW I/O.
