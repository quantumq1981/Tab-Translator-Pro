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
1. Cluster y → string lines; group lines → staff systems (a run of ≥4 lines).
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

## Session conventions

- Surgical edits over rewrites. Preserve working code; don’t restructure the
  shared engine path to “clean it up” unless a test forces it.
- Single file, single engine path, no new dependencies without a reason.
- Update this CLAUDE.md at the start and end of each working session.