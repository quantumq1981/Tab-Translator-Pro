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
changes `Gmaj7 | F#7 | Fmaj7 | E7 | D#maj7`, and decodes **GP5** both ways:
**Anthropology** (v5.00) `Chords` track → `Gm7/A# G7 | Cm7 F7 | …` rhythm changes
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
`simple chords` track to `Em7 | Am6/F# D#aug/B | Em7 | C#aug/A | Dm7 | …`, **The
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

- Chart             ← one CSMPN section marker
| C | Am F | G | … | ← pipe bars, 4/row; multi-chord bars space-separated
```

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

**Validation** (`npm test`): a CSMPN export test asserts the `Title`/`Time`/
`Tempo`/`Key` headers, the `- Chart` marker, that an edit override surfaces in the
bars (`| C G | A7 | F |`), and that it does **not** emit ChordPro grid directives.
A second deterministic test (synthetic 2-event bar with frets) asserts the `{tab}`
voicings come out high-e→low-E with muted strings (`G: 3,0,0,0,2,3`, `C: x,1,x,2,3,x`),
the `{hybrid}` rhythm places the two half-note chords on beats 1 & 3
(`bar1: 1:h(G) 3:h(C)`), that `tab:false`/`hybrid:false` suppress both blocks, and
that a **transposed** score emits no `{tab}` (frets dropped).

### Future integration ideas (analysis — partly built)

See `docs/INTEGRATION-IDEAS.md` for the full write-up. **Shipped:** the `{tab}`
fingering round-trip and the `{hybrid}` rhythm scaffold (above). Remaining high-value
steps: **(3)** carry `Capo:` and detected tuning into the CSMPN header once tuning
detection lands; **(4)** a reverse link — a "Decode this tab" button in
CSMP/Chord Sheet Maker that hands a GP/PDF back to Tab Translator for recognition;
**(5)** share the recognition engine as a zero-dep module across the trio.

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