# Ultimate Guitar Pro PDFs — OCR/OMR calibration (corrected, measured)

This revises the owner's *UG Pro PDF OCR/OMR Calibration Specification (Final)* against nine real UG "Pro" PDFs:
six in the first batch (Revelation, Pretzel Logic, Sultans of Swing, Room 335, I Ain't Got Nothin' But the Blues,
Listen to the Music — 37 pages, 591 bars, 820 printed chords) and three iOS 27 "print from the site" copies in a second
(This Masquerade, Sleepwalk, Affirmation — 8 pages, 205 bars, 186 chords; §9). Every claim below was measured on those files; where the original spec was wrong or
silent, the correction says so and gives the evidence. The PDFs are copyrighted and are **not** in the repo.

**What was built (2026-11-17):**

| | where | what it does |
|---|---|---|
| Vector-first reader | `engine.tsx` block "PDF TEXT LAYER": `pdfPageVectors`, `pdfScoreLayout`, `pdfChordPages` | Reads a digital PDF's text layer + stroked paths: staves, systems, bar lines, printed bar numbers, chords, time signatures, sections, rehearsal marks, tempo, title / artist / tuning. No model. |
| Scan panel | `TabDecoderPro.tsx` `ScanPanel` | A PDF with a usable text layer is read exactly; a scan or photo goes to OCR; one tap each way. |
| Grammar | `chordFromWritten` | UG / Guitar Pro spellings: `7M 9M 13M`, `m7M`, `/5+ /5- /9-`, `7-9 7+5`, `9- 9+`, `7dim`, `sus2/4`, `E7/9`, `(Gm7)`. |
| Raster reader | `chordOcrSplitRead` in `readChordPage` | Two chords read as one run-together string (`Bb13Bb9`) are split at the CTC frame between them. |
| Kept as written | `chordPageScore` → `e.written` | A chord read off a page is never re-named from its notes by the Pro vocabulary; transpose moves its text. |
| Bench | `scripts/chord-ocr/bench_pdf_text.mjs` | Text layer and raster OCR vs the Guitar Pro source (independent truth). |
| Tests | `tests/pdf-text.mjs` (92 checks, in `npm test`) | Synthetic PDF.js pages carrying every trap below; mutation-tested. |
| Browser check | `tests/bench/scan-pdf-e2e.mjs` | The real app reading a PDF in headless Chromium (PDF.js 3.11.174 served locally). |

---

## 1. Measured results

### Text layer vs the independent truth (the `.gp` files UG engraved from)

| file | pages | bars | chords | right, in the right bar | extra | bar numbers agree | time |
|---|---|---|---|---|---|---|---|
| Revelation (iOS reprint) | 3 | 37 | 56 | **56 (100 %)** | 0 | 36/36 | 41 ms |
| Pretzel Logic (native) | 4 | 93 | 79 | **79 (100 %)** | 0 | 93/93 | 44 ms |
| Ain't Got Nothin' (iOS reprint) | 3 | 68 | 167 | **165 (98.8 %)** | 0 | 68/68 | 53 ms |

The two Ain't Got Nothin' "misses" (bar 5 `Gm9`, bar 9 `Bb/F`) are chords the Guitar Pro file carries that the PDF
does not print (checked on the render) — every *printed* chord is read. Precision 100 % on all three.

The other three have no source file in the repo; their text-layer reading was checked by eye against renders (Sultans
p1, Room 335 p1–p2 and p6, Listen to the Music p4–p5) and its bar count against the printed bar numbers: Sultans 213/213,
Room 335 129/129, Listen to the Music 46/46 numbers agree. **Correction (second batch):** the first version of the
reader missed one Listen to the Music chord (bar 31's `E`, printed against the 1st-ending bracket's "1" and glued to
it); a spot check that uses the reader's own output as truth can't see that. It reads 60 chords now (was 59). In the real app (headless Chromium): Room 335 read in 3.1 s
(131 bars, 278 chords, ♩=120, the 3/4 bars in the MusicXML export), Sultans 213 bars / 182 chords / 8 sections,
Revelation 1.5 s; no model download, no console errors.

### Raster OCR on the same pages (the app's Scan path: 1500 px wide, grey, the shipped "printed" reader)

Right chord in the right bar (truth: the `.gp` file, or the verified text layer):

| file | before this change | after | text layer |
|---|---|---|---|
| Room 335 | 30.6 % | **58.6 %** | 100 % |
| Ain't Got Nothin' | 65.9 % | **76.0 %** | 98.8 % (all printed) |
| Pretzel Logic | 82.3 % | 82.3 % | 100 % |
| Sultans of Swing | 72.5 % | 72.5 % | 100 % |
| Revelation | 39.3 % | 39.3 % | 100 % |
| Listen to the Music | 15.3 % | 15.3 % | 100 % |

Room 335's gain is the grammar (`7M`, `/5+` were rejected outright); Ain't Got Nothin' is grammar + the run-together
split. **The conclusion: never OCR a digital UG PDF.** The raster reader's remaining failures on these pages are layout
(bar lines missed under dense tied chords, a start-repeat after the clef counted as a bar) and recognition (`F7M`
misread) — see §8.

---

## 2. Page geometry and furniture — corrections

| spec said | measured | consequence |
|---|---|---|
| US Letter, 8.5 × 11 in | Native UG exports are **2976 × 4209 pt = A4 × 5**; Letter (612 × 792) only when the owner re-printed them from iOS ("Quartz PDFContext", "pdftopdf"). | Never use absolute sizes. Everything is relative to the staff space (`sp`), measured from the staff lines (25 pt native, 4.70 pt reprint). |
| (silent) | UG engraves with **MuseScore 4**: Edwin (text), Leland (SMuFL notation), LelandText, BravuraText (chord accidentals), Roboto (TAB digits). | Notation glyphs arrive as SMuFL code points: noteheads U+E0A0–E0FF, rests E4E0–E4FF, clefs E050/E052, TAB clef E06D, time-signature digits **E080–E089**, common/cut time E08A/E08B, metronome note ECA5. |
| (silent) | An **iOS reprint splits every glyph into its own text item** ("G","7","s","u","s","4"); native exports give whole words. | Words are rebuilt from glyphs on one baseline that touch (gap ≤ 0.18 × font size); a space-sized gap ends a word. |
| (silent) | Chord accidentals are separate items in BravuraText: **U+ED60 ♭, U+ED62 ♯** (small accidentals), U+E870 ° in one file. | Mapped to text (`b`, `#`, `°`) before the grammar. |
| Title / artist / tuning on page 1 | Correct. Plus: in an iOS reprint the tuning line's letters are separate items and **each is a valid chord** (`E` `A` `D` `G` `B` `E`). | The tuning line is dropped as a line (every word on its baseline right of "Tuning"), not by pattern on one item. |
| Page numbers top outer corner | Correct (Edwin-Bold, ~2 sp). | Digit-only → never a chord. |
| (silent) | The chord font is not fixed: Room 335 prints chords in **Edwin-Roman**, the same font and size as "Tuning :". | Font names are not used to classify anything; size (in sp) + position + grammar are. |

## 3. Systems and staves — corrections

| spec said | measured | consequence |
|---|---|---|
| Rows exceeding ~50 % of page width are staff lines (raster projection) | In the vector layer staff lines are **stroked paths drawn bar by bar**; TAB string lines are often **broken around fret numbers**; one path can be **split across two PDF.js `constructPath` ops** (`moveTo` in one, `lineTo … stroke` in the next). | Strokes on one y are joined across gaps ≤ 3 % of the page; the pen persists until the path is painted. |
| Exactly 5 / 6 equidistant lines | Three things fake extra lines: a **row of ledger lines** over high/low notes (joined along x it spans the staff), a **volta bracket** (Pretzel p2), and dense 16ths whose ledger row is drawn end to end. | A staff = 5–6 lines with the **same x-extent** and **≥ 60 % ink**; a 6-line run is trimmed to the sub-run its **bar lines start and end on**. |
| No connecting bracket between Standard and TAB | In native exports the **system-start line runs through both staves**; the reprints keep them separate. | Both handled: a TAB staff under a notation staff within 14 sp joins its system either way. |
| Barlines: vertical projection within the staff | **Full-height chord stems** span the staff too (19 "bars" found in a 4-bar system before the fix). | A bar line **ends on the outer staff lines** (a stem overshoots) and is **drawn on every staff of the system** (TAB has no stems in these exports). An empty first measure (clef / key / time before a start-repeat) is not a bar. |
| 4 systems on page 1, 4–5 later | Measured 2–5. Used only as a sanity check. | — |

## 4. Above-staff tiers — corrections

| spec said | measured | consequence |
|---|---|---|
| Chord symbols are **left-aligned** over the onset | **5 of the 6 files centre them**; only Room 335 left-aligns. A centred `Bm7♯5` on a bar's first note starts left of the bar line (Revelation bars 22, 26, 30 landed a bar early until this was fixed). | The document's alignment is learned (left edge vs centre — whichever sits closer to note / TAB onsets across all chords); each chord belongs to the bar of the onset under its anchor. |
| Tier order: chords closest, then tempo, then sections | Not strict. Chords also sit **level with the bar numbers** (Room 335 "Bm7") and **level with tuplet "3"s** (Sultans "Dm"); MuseScore's autoplace lifts whatever collides. | No fixed band. Search 16 sp above the system's top staff, never inside the previous system; classify by content. |
| Measure numbers on every measure | **585 of 591 bars** carry one the reader takes (the other 6 were not inspected). | Bars are counted from bar lines; a printed number that rises and lands within 3 of the count re-anchors it. The reader reports the agreement (`numbering`) as a self-check: **585/585** here. |
| Measure numbers: small type above-left of the barline | Correct (italic, ~1.2 sp). Tuplet numbers are the same italic font at ~1.6 sp. | A number at a bar start must have the page's bar-number size. |
| Rehearsal marks: boxed capital letters | Correct, and they are **one size above the chords** (1.8 vs 1.6 sp) and sit **next to the section name** ("Chorus:" + [D]). A plain blue `A` in the next bar is a chord. | A single capital that is boxed (four strokes around it) or bigger than the chords is a rehearsal mark; with a section name at the same bar the name wins. |
| Section names: Verse 1, Pre-Chorus, [Intro] | Also "1st & 3rd Verse:", "Solo Continued As Chorus", "Pre-Verse", "Solo chorus 2", "Outro-Chorus", "Fade". In reprints each word is a separate item. | Non-chord words a space apart on one baseline are joined into a phrase first (chords never are); a phrase is a section when bracketed, ending in ":", or starting with a section word (incl. any pre-/post- word). |
| Tempo: ♩ = 120 | In reprints "=" and "120" are separate items; one file follows it with a swing equivalence ("♩ = 60 ♫ = ♩♪"). | Read from the phrase: the first `= N`. |
| (silent) | **Time signatures are readable**: SMuFL digits on the staff (Room 335 changes 4/4 → 3/4 → 4/4 → 2/4). | The chart carries the printed meter per bar instead of assuming 4/4. |
| (silent) | Above-staff directions in capitals ("DOUBLE-TIME", "END DOUBLE TIME") start with chord letters. | Not offered as unread chords. |
| (silent) | Two chords can be **set touching** (Room 335 "G♯m7/5-C♯9-"). | A word that fails the grammar is split at a root letter where both halves parse. |

## 5. The grammar — corrections to §6 of the spec

The spec's reference regex was right about `/5[+-]` before slash-bass. Measured gaps, all now in `chordFromWritten`:

| written | means | read as |
|---|---|---|
| `D7M`, `F7M`, `G7M/B` | major 7th | `Dmaj7`, `Fmaj7`, `Gmaj7/B` |
| `Dm7M` | minor-major 7th | `Dm(maj7)` |
| `C#m7/5+`, `C#m7/5-`, `G7/5-` | altered 5th after a slash | `C#m7#5`, `C#m7b5`, `G7b5` |
| `F#9-/5+`, `C#9-`, `B9+` | UG: a ninth **with its sign after it**, 7th implied | `F#7b9#5`, `C#7b9`, `B7#9` |
| `C7-9`, `C7+5` | signed alteration after a degree | `C7b9`, `C7#5` |
| `E7/9`, `Am7/11` | added degree after a slash | `E9`, `Am11` |
| `E7dim` | UG's spelling of the diminished 7th (printed so) | `Edim7` |
| `Fsus2/4` | both suspensions | `Fsus4add9` |
| `(Gm7)` | optional chord | `Gm7` |

A minus right after the root is still minor (`C-7` = Cm7); `C/E` stays a slash chord; directions and repeat counts
(`DOUBLE-TIME`, `x3`, `= 120`) are not chords.

## 6. Vector-first extraction (§7 of the spec) — how it is done in a browser

The spec named pdfminer / PyMuPDF; this app is client-side and already loads **PDF.js 3.11.174**:

* text: `page.getTextContent()` → items with `transform` (font size = |(c, d)|, baseline = viewport × (e, f)) and `width`;
* paths: `page.getOperatorList()` → `constructPath` / `stroke` / `fill` with `save` / `restore` / `transform` /
  form XObjects tracked for the current matrix;
* both in the **same viewport the page is rendered in**, so every token box lands on the rendered page's pixels (the
  review list shows a crop of the page beside each reading).

`pdfPageVectors` is the only PDF.js-shaped function and is pure, so Node runs the same code. A page with no text layer
(a scan), text without staves, or a text layer that fails to parse gives `ok:false` and the page goes to OCR — the
"corrupt / empty stream" rule of the spec. (The Listen to the Music PDF the spec says "failed to extract cleanly" reads
fully: 6 pages, 49 bars, 60 chords, 46/46 bar numbers.)

## 7. A defect this exposed (fixed): written chords were re-named

The chart's default **Pro** vocabulary re-names every chord from its notes. For a chord read off a page that is wrong —
it is the arranger's spelling: Room 335's `C#m7/5+` came out as `A/C#`, `F#9-/5+` as `F#7♭9`, `D9#11` as `D9`. Chords
from Scan (OCR or text layer) are now marked `written`: `respellScore` keeps them, `transposeScore` moves their text.

## 8. Not built — the measured next steps for the raster path (photos / scans of UG pages)

* **Bar numbers as bar anchors.** UG prints one on almost every bar; the raster reader reads most of them (partial at
  1500 px: one system of Revelation read 1 of 4) but uses only the one at a system's start. Re-anchoring bars on the
  chain of printed numbers would fix the missed-bar-line drift (Revelation 39 %, Listen to the Music 15 %). It needs
  a guard against tuplet "3"s and a real-page re-check of the hand-copied books, whose pages are not in the repo — so
  it was not shipped blind.
* **Centred chords in the raster path.** A "box straddling a bar line with its centre past it belongs to the next
  bar" rule changed nothing on these six files and was removed (no measured benefit, unmeasurable risk on the other
  books).
* **`F7M` and other UG-only strings in the recogniser.** The grammar accepts them now; the reader still misreads the
  raised `7M` (Pretzel Logic 11 misses). A synthetic UG / MuseScore-Edwin fine-tune set is the route
  (`scripts/chord-ocr/synth_extra.py`, spec §9).
* **Beats inside a bar** come from the chord's position (chordPageScore's convention). The vector layer has every
  notehead and rest; a rhythm reading from SMuFL note values would place chords exactly.

## 9. Second batch: iOS 27 prints (This Masquerade, Sleepwalk, Affirmation)

All 8 pages checked chord by chord against renders: **This Masquerade 37/37, Sleepwalk 97/97, Affirmation 52/52**,
every section label in its bar, every printed bar number agreeing with the count (36/36, 75/75, 84/84). Real app:
all three read from the text layer with their titles and tempos. What these copies changed:

| finding | evidence | what the reader does |
|---|---|---|
| **The music fonts lost their Unicode map.** iOS 27 "Quartz" prints write Leland / LelandText glyphs as plain ASCII (`$`, `,`, `!`) instead of SMuFL code points; BravuraText chord accidentals keep theirs. | A 10-bar rest's "10" read as `+,` and became the "title" (biggest text); the metronome `!` glued onto "= 75" and was dropped; time signatures unreadable. | A font is musical when most of its items are SMuFL, or notation-sized punctuation (a title is letters), or its name is a SMuFL font (the app passes PDF.js font names); its non-SMuFL glyphs are never text. |
| **Time signatures cannot be read** from these prints (the digits are garbled). | Sleepwalk is in 12/8. | 4/4 assumed — the honest limit; fix in the chart's meter. |
| **Multi-measure rests**: one measure stands for many; the printed numbers jump (1, 2, 12, 13). | Affirmation drifted 9 bars from bar 12. | A printed number far from the count is accepted when the next bar's number confirms it (n, n+1) — a tuplet "3" never does. A rest at the very end has no following number: it counts as one bar. |
| **An empty real first bar** (a whole-bar rest whose glyph is unreadable) looked like the clef area before a start-repeat. | Affirmation started at bar 2. | That empty first interval is dropped only when narrow (≤ 8 spaces) or closed by a double / repeat bar line. |
| **A bar number set against the chord before it** (`G7b9` + bar 7 → `G7b97`), and a **volta's "1" against a chord** (`1E`). | Sleepwalk bar 6; also Listen to the Music bar 31 and This Masquerade bars 20 / 24 (`20Ab7`), which the first reader lost silently. | A smaller glyph that is not raised does not join a word (a superscript extension is smaller AND raised). |
| **A chord against bigger text** ("Da Coda" + `C7(♯5)`, chord slightly raised). | This Masquerade bar 16. | A smaller glyph starting with A–G never joins (an extension never starts with a root). |
| **Drawn parentheses**: `G7(♯5)` has no "(" ")" in the text; the gap they leave split `G7` from `♯5`. | This Masquerade bars 10, 16, 28, 34, 35 (`G7` lost its ♯5). | An alteration alone (`#5`, `b9#11`) right after a chord on its baseline is that chord's. |
| **Labels centred on the bar line** ("THEME" starts inside the bar before). | Affirmation bar 12. | A label straddling a bar line with its centre on it (within a space) belongs to that bar; otherwise its left edge decides (a long label is not moved). |
| Lower-case labels ("intro", "verse 1"), timestamps ("01:41"), "SOLO / A", dash-minor chords (`E-7`), `GMaj7`, `Fm7M`. | — | Already handled; "SOLO /" is trimmed to "SOLO". |

The six first-batch files read exactly as before (the bench numbers in §1 are unchanged), except the Listen to the
Music correction above.

## 10. Reproduce

```sh
cd tests && npm install && npm test                                  # includes pdf-text.mjs
cd ../scripts/chord-ocr
node bench_pdf_text.mjs <Revelation.pdf> "../../Robben Ford - Revelation.gp"
node bench_pdf_text.mjs <Room_335.pdf> -                             # no source file: the verified text layer is the truth
PNGJS_FROM=<dir>/package.json ORT_WEB=<dir>/node_modules/onnxruntime-web/dist/ort.wasm.min.mjs \
  node bench_pdf_text.mjs <pdf> <gp|-> --ocr ../../models/chord-ocr/chord-ocr.onnx     # + the raster reader (poppler renders)
cd ../../tests && node bench/scan-pdf-e2e.mjs --deps <react+babel bundle> --pdf <pdf> --expect "Dm,C" [--meter 3/4] [--section "Verse 1"] [--ocr]
```
