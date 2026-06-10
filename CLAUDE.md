# CLAUDE.md — Tab Decoder · TabTranslator Pro

Handoff notes for Claude Code. Read this before touching the engine. The rules
below are **invariants** — they were each arrived at by catching a real bug or
validating against a real file. Treat them as load-bearing; do not “simplify”
them away without re-running the validation described at the bottom.

-----

## What this is

A single-file React prototype (`TabDecoderPro.jsx`, default export, zero build
deps, inline styles) that turns guitar tablature into chord symbols. Two modes:

- **Manual** — paste an ASCII tab slice → analyse one chord block.
- **PDF Chart (Path A)** — upload a *digital* tab PDF → reconstruct a
  one-chord-per-bar chart.

The recognition engine is shared by both modes. There is exactly one code path
from “frets on strings” → “chord symbol”; keep it that way.

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

-----

## Path A — PDF geometry assumptions (READ before editing the parser)

Path A targets **digital, text-layer tab PDFs**, specifically alphaTab output
(what chord-sheet-maker-pro exports). It was designed and validated against the
real coordinate dump of `Blue_Sky_-_The_Allman_Brothers_Band.pdf`.

Layout facts the parser relies on (verified, A3-scale alphaTab render):

- Fret numbers are real text (`ArialMT`), extractable with positions. **Not** a
  raster scan.
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

## Shared ChartPanel — editing, transpose, export

Both chart modes feed one `ChartPanel`. Anything that reads/writes a score does so
through the shared shape, so these work identically for Path A and Path C:
- **Simplify** (`simplifyScore(score, useSharp)`): opt-in "1 chord/bar" mode for
  dense transcriptions (melody + harmony), where the per-onset chart is noise. It
  weights each pitch class by the total duration it sounds, keeps the strong ones
  (drops passing tones), takes the bass from the **structural** tones (so a brief
  low melody note can't fake a slash), and runs that chroma through the engine →
  one chord per bar. Default OFF (Blue Sky / clean charts stay per-onset). Honest
  limits: rootless/altered jazz voicings (e.g. Steely Dan) and `7♭9`/`7♯9` chords
  the `QUALITIES` table doesn't model won't always match a lead sheet — Edit +
  Transpose cover the gaps, and MusicXML import is the high-fidelity route.
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

`midiToAbc`/`abcDur` invariants: middle C (C4 = 60) is ABC `C`, C5 is `c`; ABC
duration is a reduced fraction of `L:1/4` (`durBeats·4/beatType`), so simple
meters stay integers and 6/8-style beats become `/2`.

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

Note: the source file is `TabDecoderPro.tsx` (this doc historically said `.jsx`);
a `.txt` mirror of the same source also sits in the repo root.

PDF.js is loaded from cdnjs (`pdf.min.js` 3.11.174 + matching worker). If you
move to a bundler, switch to the npm `pdfjs-dist` package and set `workerSrc`
accordingly.

-----

## Validation (re-run if you touch the engine or parser)

- **Engine**: 12 preset voicings pass (C, G, Am, Em, F-barre, C/E, D/F#, Asus4,
  Dm7, G7, Cmaj7-no5 → 75% “missing 1”, D5 in Drop D). The Drop-D case
  specifically guards Invariant 2.
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
- Single file, single engine path, no new dependencies without a reason.
- Update this CLAUDE.md at the start and end of each working session.