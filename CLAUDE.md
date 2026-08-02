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

The PDF panel has a **Chart / Grid** toggle: *Chart* is the lead sheet (chords on
their beat, barlines, tap a chord to inspect its voicing); *Grid* is the original
compact one-symbol-per-bar card grid. Both feed the same engine.

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
  Blue Sky score). All exporters honour `overrides` and the current transpose;
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
- **Key + roman numerals** (`analyzeKey`, `romanFor`, `keyName`): scores all 24
  keys — each chord adds its duration when diatonic (×0.3 if only its root fits =
  a borrowed quality), plus a small cadential bonus for the last/first chord being
  the tonic — and picks the best. The `I·V·vi` toggle captions each chord with its
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

`midiToAbc`/`abcDur` invariants: middle C (C4 = 60) is ABC `C`, C5 is `c`; ABC
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
(stdlib-only, seeded) trainer. (This container has no numpy/sklearn and can't
pip-install, so it's hand-rolled; re-runnable to reproduce `CHORD_CLASSIFIER`.) It
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
→ `transcribeChords`; the Audio panel's **△ Simple** toggle passes `maxRank:14`, collapsing the
over-labelled soup back to the real skeleton. This is the fast, honest half-fix for vocal
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

**The ML path (Spotify `basic-pitch`) — the PURE half is built + tested, the model is a
hosted/device-only seam.** `basic-pitch` is a ~few-MB note model (not a 166 MB separator), so
the ONNX/iOS bet is winnable. `engine.tsx` ships the drop-in decode half (pure, headless-
tested): **`notesFromActivations`** (onset/frame activation matrices → note events, faithful
basic-pitch note-creation), **`polyNotesToScore`** (note stacks → the shared `source:"ml"`
score, so chart/exporters/handoff work for free), and **`transcribeWithNoteModel(pcm, sr,
model, opts)`** (orchestrator over a pluggable model). The UI's **🎼 Voices (ML)** button
(Audio mode) calls it with `window.TTP_NOTE_MODEL` when present, else shows a clear "not
configured" message. **Remaining (can't be done from this sandbox — HF is proxy-blocked, no
device):** host the model, write the browser-only `window.TTP_NOTE_MODEL` inference glue
(onnxruntime-web + the harmonic-CQT input features → matrices), smoke-test on device. `npm
test` guards the decode: held C major → C4/E4/G4 notes, sub-minDur blips dropped, notes →
`ml` score with the C voicing, orchestrator runs a fake model + throws with no model.

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
- **Multi-part picker**: `npm test` parses `tests/fixtures/sample-multipart.musicxml`
  and asserts two parts (`Guitar`, `Rhythm`), `partIndex 0 → C` and `1 → G`, and
  that the single-part fixture reports exactly one part.

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