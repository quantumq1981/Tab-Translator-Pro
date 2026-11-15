# OMR (Path B) — plan, model survey and the Phase 0 gate

Owner's proposal (2026-11-09): a client-side OMR pipeline — OpenCV.js preprocessing in a
worker, then MusicXML → "lite stage sheet" (one melody + chords). This file is the review of that
proposal against the three repos, and the order the work runs in.

## Verdict on the proposal

- **It leaves out the recognition step.** Preprocessing cleans an image; Part 2 starts from
  MusicXML. The model that turns pixels into notes is the whole problem, and today it exists in
  the family only on a server (chord-sheet-maker `backend/` = Audiveris + oemer; Pro
  `scripts/oemer_helper.py` = oemer). Path B stays out of TTP's Path A parser either way.
- **OpenCV.js is not adopted.** A fourth ~9 MB WASM runtime on a phone that already dies under
  memory pressure (see "Phone memory" in CLAUDE.md), for operations (downscale, grayscale,
  adaptive threshold, deskew) that are a few hundred lines of plain JS — and learned OMR models
  normalise their own input, so binarising first throws away grey detail they use. The
  proposal's worker code also relies on reassigning `cv` and faking `self.document`, both
  fragile across OpenCV.js builds.
- **Part 2 mostly existed already** (Harmony mode, `<harmony>` reading, the oracle). The one new
  idea — reduce a score to a melody line + chords — is built as **`leadSheetFromMusicXML`**
  (below), correctly: real `<backup>`/`<forward>` timing, ties, one melody across bar lines,
  chords from written symbols or from the notes, key spelling, a MusicXML lead-sheet export.

## Order of work

1. **Phase 0 — measure before building (this gate).** Pick an on-device OMR model by license,
   size, ONNX export, accuracy and phone memory. If none passes, Path B stays a server feature
   and we stop.
2. **Lead-sheet reduction — DONE (2026-11-09).** Useful today for MusicXML / Muscriptor
   imports, and it is what OMR output will feed.
3. **Only after the gate:** a preprocessing step in plain JS + the model in a worker on the
   existing rails, landing in the WO-1 note editor and the chord review list.

## Model survey (2026-11-09)

| Model | License (code / weights) | Size | Output | On-device? |
|---|---|---|---|---|
| **SMT — Sheet Music Transformer** (`antoniorv6/smt-camera-grandstaff`, `smt-grandstaff`, rev `9c13556…`) | MIT / MIT (model card) | 21.4 M params (86 MB fp32 checkpoint; exported 29.8 MB int8 — measured below) | Humdrum `**kern` tokens, one grand-staff **system** per image | **Candidate.** ConvNeXt encoder (64/128/256, depths 3/3/9) + transformer decoder (d_model 256), no KV cache. Full-page variants exist (`smtpp_*`). |
| LEGATO / legato-small (`guangyangmusic/…`) | MIT (code + weights) — **gated** | small = 10.9 M *trainable* params on top of the **frozen Llama 3.2 11B Vision encoder** | ABC | **No.** The encoder alone is far beyond a phone, and it sits under the Llama 3.2 licence. The model card itself says research use. |
| oemer (`BreezeWhite/oemer`) | MIT code; checkpoint licence not stated | 2 UNets + 3 SVMs + heavy Python post-processing | MusicXML | Possible but costly: the UNets run in ONNX Runtime, the symbol assembly is ~thousands of lines of numpy/OpenCV to port. Already used server-side in Pro. |
| homr (`liebharc/homr`) | **AGPL-3.0** | SegNet + TrOMR ONNX | MusicXML | **Rejected** (AGPL; the owner will monetise). |
| Audiveris | **AGPL-3.0**, Java | — | MusicXML | **Rejected** for the client; stays the optional server path in chord-sheet-maker. |

What none of them reads: **chord symbols** (SMT/GrandStaff and oemer are notes-only). For the
family's main use — fake books and lead sheets — the chord symbols are TEXT above the staff, so
the cheapest real win may not be notation OMR at all (see "Two cheaper routes" below).

## Phase 0 measurement protocol

Ground truth is free: render files we already own and know exactly.

- **Corpus:** the repo's Guitar Pro / MusicXML files and the 338 Bach chorales
  (`tests/fixtures/bach-chorales`), rendered to PNG per system with alphaTab 1.8.4 (vendored)
  and to a phone-photo condition (perspective + blur + JPEG + uneven light). Split dev/test by
  file, as every bench in `tests/bench`.
- **Metrics:** note F1 (pitch + onset in beats), bar-line recall, and — for the family's use —
  the lead sheet that comes out: `leadSheetFromMusicXML(omrOutput)` vs the same reduction of the
  source file (melody note F1, chord root / majmin per bar). OMR that gets inner voices wrong but
  the melody and harmony right is a pass for a fake book.
- **Device gates (same rails as SCNet / guitar CRNN / beat_this):** ORT 1.23.2 plain WASM, one
  thread, `capWasmMemory`, one worker ended after each job, weights SHA-256-pinned and cached,
  weight-only int8 checked against fp32. Pass = peak memory well under the ~650 MB the stem split
  already needs, and < ~10 s per system on the container (phones slower).
- **SMT-specific risks to measure:** the decoder has no KV cache (each token re-runs the whole
  prefix: O(n²) — a 400-token system may be the speed killer; export with a KV cache if needed);
  `**kern` → MusicXML needs a JS kern reader (grand-staff kern is a manageable subset);
  single-system input needs a system splitter (staff-line projection in JS).

## Phase 0 results — SMT measured (2026-11-09)

Scripts: `scripts/smt/` (README has the pins). Running the SMT repository's own Python was blocked
by the session's safety classifier, so **we wrote the model ourselves** (`smt_model.py`, from
the MIT source) and load only the published weights (a safetensors file — data, no code).

**Findings that change the picture — do not re-derive:**
- The published weights (`smt-camera-grandstaff` @ `9c13556`, SHA-256 `93be49ca…5448`, 21.4 M
  params, vocabulary **20,578** combined kern tokens) were trained with the **September 2024**
  decoder (SMT `fdeb7c3`/`d25acd4`), not the current repo code: `lq/lk/lv` attention **with no
  1/√d scaling**, ReLU + a 1×1 `Conv1d` output layer. A strict state-dict load caught it.
- Its 2D position table was built at full PIXEL size (256 × 3056 × 256 floats); exporting it
  as-is baked **800 MB** into the ONNX. Only the 16×-downsampled slice is ever read and the values
  don't depend on the table size, so we build 32 × 192 (images up to 512 px tall; the camera set's
  tallest is 312 px). The table stays fp32 in the int8 export (6.3 MB).
- Without a KV cache each token re-runs the whole prefix (8 s per system in PyTorch). Exported as
  **encoder** (image → the 8 layers' cross-attention K/V, once per system) + **one-step decoder**
  (token + cache → logits + cache). Our PyTorch model and the cached ONNX produce **identical
  tokens** on 5/5 test systems.
- **Input scale matters.** The camera config resizes by `reduce_ratio` 0.85; camera photos at 1.0×
  read 52 % median SER, at 0.7× 7.5 %. The preprocessing a phone needs is SCALE normalisation
  (staff-line spacing), not binarisation — another reason OpenCV.js is the wrong tool.

**Accuracy** (symbol error rate on the official test splits, 100 systems each, int8 weights;
"runaway" = a decode stuck in a loop until the 1,280-token cap):

| | clean GrandStaff (×1.0) | clean (×0.85) | camera (×0.85) | camera (×0.7) |
|---|---|---|---|---|
| pooled SER | **5.41 %** | 6.01 % | 25.2 % | 26.5 % |
| SER without runaways | 5.41 % | 6.01 % | 20.2 % | 17.4 % |
| median per system | 4.19 % | 4.44 % | 14.8 % | **7.5 %** |
| runaways | 0/100 | 0/100 | 1/100 | 2/100 |

fp32 vs int8: 5.59 % vs 5.41 % on 20 clean systems — weight-only int8 costs nothing.

**On the phone's runtime** (onnxruntime-web **1.23.2** plain WASM, one thread, Node on the 4-core
container, 8 clean systems, ~240 tokens each):

| weights | download | per system | ms / token | encoder | peak RSS |
|---|---|---|---|---|---|
| fp32 | 93.3 MB | **3.4 s** | 10.4 | 0.86 s | 463 MB |
| int8 (weight-only) | 29.8 MB | 5.1 s | 17.0 | 1.0 s | **320 MB** |

(The int8 decoder is slower because the 5.3 M-entry embedding and output layer are dequantised on
every step; a Gather-on-int8 embedding + int8 output projection is the obvious next fix.) A page of
~6 systems ≈ 20–30 s here; a phone is slower.

**Verdict.** SMT passes the technical gate (licence, size, phone memory, speed, accuracy on clean
engraving) — **for piano grand-staff systems only.** It does NOT cover what the family mostly
needs: it emits no chord symbols, reads no single-staff lead sheet, no guitar tab and no
4-staff choir layout (all out of its training domain, untested), and a phone photo of a page
still needs a JS system splitter + scale normaliser + a kern → MusicXML reader before
`leadSheetFromMusicXML` can turn its notes into chords. Camera photos have a long tail of bad
systems (pooled ~17–25 %). Recommended order from here:
1. **Chord-symbol OCR for lead sheets — BUILT (2026-11-10), see the next section** — and **tab
   photos** (below) — they answer the fake-book use directly and are cheaper.
2. SMT as an on-demand "photo of piano music → notes → chords" tool, only if the owner wants
   it: system splitter + scale normaliser (plain JS), `**kern` reader, a runaway guard (stop on a
   repeated n-gram or > 3× the expected tokens for the width), the int8 embedding fix, the usual
   worker rails, and a device check.

## Chord-symbol OCR for lead sheets — built (2026-11-10)

The "Scan 📷" mode: a photo, screenshot or scanned PDF of a lead sheet → the chord chart, on the device.
No notation model: staves, bar lines and the chord row are found geometrically, and only the text
boxes go through a small learned recogniser.

**Pipeline** (engine block "CHORD OCR", pure, `tests/chord-ocr.mjs`; glue `chord-ocr-model.js` →
`chord-ocr-worker.js` → `chord-ocr-core.js`, the usual rails):
1. `chordPageLayout`: two adaptive-threshold masks from one integral image (a shadow moves the local mean
   with it) → staves found as pieces in narrow vertical strips, linked across the page, each line fitted
   as y = a + b·x and refitted on the image (tilt and perspective) → bar lines = components, after the staff
   lines are erased, that run the full four spaces and stay thin (a stem is 3.5 spaces and joined to its
   head) → the chord row = the text row above each staff spread over the most BARS (a tempo mark or a bar
   number sits in one) → boxes, each with its bar and x position.
2. `chordOcrInput` → the recogniser (`models/chord-ocr/chord-ocr.onnx`) → `ctcBeam` → `chordOcrRead`: the
   most probable reading the chord grammar accepts (`chordFromWritten` → `parseChordSymbolForVoicings`), and
   only if the model gives it ≥ 10 % (otherwise a bar number "7" becomes "D7").
3. A box at a system's start that reads as digits is that system's bar number; `_ocrAnchorBars` re-anchors
   every numbered system, so one missed bar line no longer shifts the rest of the page.
4. `chordPageScore` → the shared chord score (4/4 assumed; two chords in a bar → beats 1 and 3; an empty bar
   holds the last chord) → ChartPanel, every export, the Pro handoff.

**The recogniser is ours.** CNN + bidirectional GRU, 588 k parameters, CTC over the chord as drawn (43
classes; 45 since 2026-11-15, with N.C.), weight-only int8 = **0.60 MB** (same accuracy as fp32). Trained only on synthetic images
(`scripts/chord-ocr/`): fake-book spellings (maj7/MA7/Δ7/M7, mi7/-7, ø, °, +, sus, 69, parentheses,
slash basses), ♯/♭ as music glyphs or typed, raised suffixes, italics, 24 open-licensed fonts (15
handwritten, incl. Steinberg's Petaluma Script), heavy degradation; plus bar numbers labelled with their
digits and words / tempo marks / directions labelled EMPTY — without those negatives every bar number was
read as a chord (precision 78 %). Licence: MIT (our model, NOTICE alongside).

**Measured** (78 lead sheets rendered by verovio from the repo's GP files, 1,722 known chords; even file =
dev, odd = test; text in Liberation Serif, a font never trained on; photo conditions = homography with
±1° / ±3° rotation + perspective, shadow ramp, paper tone, noise, blur, rescale, JPEG):

| | chord right in its bar — P / R | chord name right | when ≥ 80 % sure: right |
|---|---|---|---|
| clean, dev | 99.0 / 98.7 | 99.7 % | 100 % |
| clean, test | 98.1 / 98.4 | 100 % | 100 % |
| photo ±1°, test | 99.4 / 98.1 | 98.1 % | 99.6 % |
| photo ±3°, test | 95.0 / 93.3 | 98.1 % | 100 % |

Recognition alone in the two HELD-OUT handwriting fonts (Kalam, Schoolbell): 97.2–97.5 % right, 99.6–99.9 %
when sure. Baseline, tesseract.js 5.1.1 (eng, single line, chord whitelist) on the same clean crops: 66–70 %,
and 26–30 % of chords with a ♯/♭. Speed on the phone's runtime (ORT 1.23.2 WASM, one thread, Node, 4-core
container): ~250 ms per page (~27 boxes); the real app read a page in 1.4 s including the model download
(`tests/bench/scan-e2e.mjs`).

**Do not re-derive:**
- Whole-row projections assume level staves: a ±1° photo dropped layout recall to 5 %. Strips + line fits fixed it.
- Global Otsu fails under a shadow; one adaptive mask is not enough either — the strict one breaks thin grey
  stems where they cross the staff (stem tips became "chords"), the lenient one is needed for staves and the
  chord row. Bar lines stay on the strict mask: on blurred photos the lenient one can't erase the staff lines.
- Searching for chord-row components only ABOVE the staff cuts every stem off its notehead; search into the
  staff and drop components whose bottom is inside it.
- A note-head-beside-the-stem test and a constant-width test both broke bar lines (notes sit right next to
  bar lines; blur widens line ends). The full-span test (4 spaces vs a stem's 3.5) is what works.
- `train.py`'s batched "dev exact" reads low (a narrow crop behind long padding loses its last character in
  the bidirectional GRU); the app reads one box at a time — quote the benches.

**Honest limits:** the corpus is engraved (verovio), not real fake books — real handwritten Real Book pages
and phone photos are the device check that remains; a curled page (curved staff lines) is not modelled; no
time-signature reading (4/4 assumed); rehearsal letters A/B can read as chords (they are valid chords — the
review list and tap-to-fix are the answer); chords without a staff (chord-only charts) are not found;
verovio ignores `print-object="no"` on `<degree>`, so the corpus prints "7sus4(b7)" (the lead-sheet export
now sets it, per the MusicXML spec).

## Real pages: a Real Book and a piano/vocal book — layout fixes, a fine-tune, the review list (2026-11-15)

**The report:** the owner scanned *If I Ain't Got You* from **The Berklee Real Book** (an iPhone PDF of the
printed book) on a phone. The suggestions it made were mostly right, but whole sections were skipped. The first
real-book page measured here — the engraved corpus above is not hand-copied — and every claim below is measured on
it, with the rendered corpus as the regression guard.

**Real pages with hand-read truth** (`scripts/chord-ocr/bench_page.mjs`, `truth/*.json`: chord names per system
only; the pages are the owner's copies of published books and stay out of the repo):
- *The Berklee Real Book*, pp. 234–235: 62 chords, 18 systems, hand-copied (Inkpen-style) chords.
- A Hal Leonard piano/vocal/guitar book (*Gone Till November*), pp. 112–115: 16 chords over fret grids, voice
  staff + piano grand staff, lyrics between.

**What was wrong (old reader on the Real Book pages: 7 of 62 right, 11 %):**
1. **Hand-drawn bar lines were never found.** They are ~0.65 space thick; the test allowed 0.5. Every system was one
   "bar" (the phone showed "19 systems · 20 bars").
2. **One text row per staff, chosen as "spread over the most bars".** In the intro the triplet "3"s cover more bars
   than the chords, so the chord row was thrown away — the skipped sections.
3. **A fixed band per row** cut the raised suffix off ("Cmaj7" → "Cmaj", "B-7" → "Dm").
4. Ruled lines under the title were taken for a staff (bar 1), and the page number "234" for its bar number.
5. **The recogniser had never seen this hand.** Its 7 is a small raised hook; read as "9" or "1" ("A-1" 67 %).
   No training font draws it that way (MuseJazz Text and Petaluma Script draw a full-size 7).

**Layout fixes (engine, pure, `tests/chord-ocr.mjs`; each rule fails a test when removed):**
- Bar lines up to 0.8 space wide when SOLID (ink ≥ 75 % of the box). Without the solidity test the rendered corpus
  lost 10 points: slanted hairlines (fill 0.2–0.3) became bar lines.
- Words grouped in 2-D (close in x AND overlapping in y), so a raised suffix stays with its root — but a mark whose
  bottom hangs below the root's ("1st X, 8vb") does not join; then words on one line merge by the old letter gap
  (an engraved "Emaj9" whose j-descender reaches the staff margin was otherwise cut in two).
- **Every text row is read; `readChordPage` keeps a row when ≥ 40 % of its boxes read as chords.** Rows join by
  the core band (median top/bottom) and similar letter height — not transitively, so a tall mark or a chord's
  descender cannot fuse the chord row with the triplet row (measured: that fusion alone dropped intro system 2).
- Flat marks (8va/8vb dashes) and thin long strokes (tuplet brackets) are not text; a word that doesn't read is
  tried split at its widest gaps ("B-7A-7" written touching), halves chord-sized and ≥ 40 % each.
- The search stops 8 spaces above a staff (title, composer, page header); a bar number must sit within 4 spaces of
  its staff; a leading "staff" with no bar line and no chord is the title's ruling and is dropped after reading.
- **Systems:** staves joined by a thin straight line at their left edge are one system (voice + piano grand staff,
  notation + TAB). Bars are counted once per system, on its staff with the most bar lines; a bar line may run on
  into the next staff (grand staff); chords are read above the system's top staff only — never in the lyrics
  between voice and piano, or between notation and TAB. Fret grids (≥ 4 string and ≥ 3 fret lines) and their
  open-string circles are dropped; the chord name above stays. Before: the piano staves added their own "bars"
  (three per system) and lyric lines read as chords.

**The outside spec's fixed zones were checked, not adopted:** it puts Real Book chord baselines 1.0–2.0 spaces above
the top line. On this page the chord boxes sit 0.8–4.0 spaces up and 22 of 58 fall outside that band (the intro's
are pushed up by the triplet numbers) — a fixed band is the old one-row behaviour. Its metrical rule (two chords →
beats 1 and 3) was already `chordPageScore`'s.

**The fine-tunes** (`from_onnx.py`, `finetune.py`, `synth_rb.py`): the PyTorch weights were never committed, so
the start point is recovered exactly from the shipped int8 ONNX (BatchNorm folded → identity, frozen; max |Δ logits|
3.8e-6). 30 % of the images are drawn in the hand-copied style — a small suffix raised to the root's top, dash
minors, the 7 as a hand-drawn hook (and hand-drawn 9 and 1 beside it); 70 % are the original mix. 3,000 steps,
~25 min on 4 CPU cores. Checkpoints were chosen on Real Book **page 2 only**; page 1 is the held-out read.

**Do not re-derive — the Real Book reading is brittle across runs.** MuseJazz Text alone made it worse (the hook-7
read "9" at 90 %). Run 2 (pen 0.06–0.1 of the letter): page 2 reads 2–18/30 depending on the step. Run 3 (finer pen
0.045–0.085): 12–26/30. Run 4 (run 3 + bar-number negatives in the hand branch): 2–20/30 — while passing every
engraved check. Weight averaging with the first model traded the two off linearly (no free lunch). The synthetic
hand is close to the real one but does not capture it; **real hand-copied pages are what would make it stable.**

**Two readers ship** (`chord-ocr-core.js` `CHORD_OCR_MODELS`, the page's "Book style"; only the chosen one is
downloaded, 0.6 MB each). The gate fixed before choosing — rendered dev P/R ≥ 98.5, held-out-hands dev ≥ 96.5 %,
then best Real Book page-2 F1 — picked **run 2, step 3000** as the default ("printed"). Run 3 step 1000 (best page-2
F1 of all, 0.85) fails that gate — on engraved pages it reads a bar number at a system's start as "G"/"B"
(precision −1.6) and it is 2.4 points lower on held-out handwriting fonts — so it ships as the opt-in **"Hand-copied
(Real Book)"** reader, with a one-tap "↻ Read again as …" after any scan.

**Measured** (final engine; chord right = same root, bass and tone set; real pages matched per system in reading
order; rendered = chord right in its bar, P / R):

| | Real Book p. 1 (held out) | Real Book p. 2 | Hal Leonard PVG (16) | rendered clean dev · test | photo ±3° dev · test | held-out hands dev · test |
|---|---|---|---|---|---|---|
| old reader (layout + model) | 6/32 | 1/30 | 1/16, 64 extra | 99.0/98.7 · 98.1/98.4 | 96.5/95.2 · 95.0/93.3 | 97.1 · 97.1 % |
| new layout, old model | 6/32 | 1/30 | 16/16, 1 extra | 99.1/98.7 · 98.4/98.4 | 97.0/95.4 · 94.9/93.4 | 97.1 · 97.1 % |
| **"printed" (default)** | **22/32**, 6 extra | 18/30, 12 extra | **16/16**, 1 extra | 99.1/98.7 · 98.4/98.4 | 96.6/95.7 · 94.9/94.4 | 97.2 · 96.9 % |
| **"hand-copied"** | **28/32**, 1 extra | 25/30, 4 extra | **16/16**, 0 extra | 97.5/98.6 · 97.5/98.1 | 95.0/96.2 · 92.2/92.8 | 94.8 · 94.6 % |

Real Book, hand-copied reader: 53 of 62 right, 50 in the right bar, 44 of its 46 reads ≥ 80 % sure are right. Every
reader, every page: ≥ 80 % sure is ≥ 99.6 % right on rendered text, so "Approve all sure" is safe there. **Honest
limits:** one real Real Book song (two pages, same hand) and one PVG song — a weak held-out; the hand-copied reader
is a better guess for this hand, not a solved problem; the phone itself (pdf.js render, iOS) is the device check.

**The review list (UI, `ScanReviewRow` in `ScanPanel`):** every chord read is listed (not only the uncertain ones),
each row with a crop of what is written beside what was read, its bar and confidence. Swipe right = approve, swipe
left = not a chord, tap = edit (alternatives, type a chord); tick rows and "Approve selected", or "Approve all sure";
filters To check / All / Approved; Undo for every change. Pure helper `ocrReviewItems` (statuses, bar numbering as
`chordPageScore` numbers them). Browser check: `tests/bench/scan-e2e.mjs` (swipe both ways, tick-and-approve, undo,
filter; real model, 430 px).

## Guitar books, N.C. and the chord-lane traps (2026-11-15)

**The ask:** the owner's add-ons/fixes spec (model vocabulary, system geometry, cropper traps, synthetic data, grammar,
false-positive filters, 10 regression fixtures) for Hal Leonard Artist Songbooks (notation + TAB), P/V/G, Easy Piano /
Big-Note and choral layouts, with two reference PDFs: an iPhone scan of a **Hal Leonard guitar recorded-versions book**
(The Allman Brothers Band, 41 pages) and of **The Berklee Real Book** (pp. 120–141, 22 pages). Five of those pages got
hand-read truth (`truth/hal-leonard-guitar-allman-brothers.json`: pp. 3, 5, 20 — 57 chords; `truth/berklee-real-book-
everyday-fallin.json`: pp. 14–15 — 42 chords incl. 3 N.C.); the pages stay out of the repo.

**What was wrong on the guitar book (shipped engine + printed reader: 44 of 57 right, 33 extra):** its staff and bar
lines are 1-px hairlines lost to the strict mask, so bar lines and the line joining notation to TAB were not found; the
TAB staff was found as five of its six lines (its bar lines "stuck out" by a space and were rejected); notation and TAB
were therefore separate "systems" and the gap between them was searched; chords over a rhythm-slash band sit ~10 spaces
up, past the 8-space search; the bend / marcato hats over the notes ("Λ") read "A" at 97–100 %.

**Engine (pure, `tests/chord-ocr.mjs`, each rule mutation-tested):**
- **Six-line staves:** after a five-line fit, a sixth line one space above or below running ≥ 60 % of the staff joins
  it (`st.n` = 6); bar lines and the bottom use all six.
- **System grouping:** a six-line staff within 8 spaces (2 × H5) under a five-line staff is its TAB — one system even
  with no joining line found (the spec's 1.5 × H_staff is too tight: the measured gaps are 1.45–1.6 × H5). The joining
  line is looked for on both masks.
- **Bar lines:** the union of the strict and lenient masks (on the lenient mask a blurred staff line can't be erased and
  everything joins into one wide blob the thinness test rejects, so the union adds faint bar lines and nothing else);
  in a multi-staff system a bar line must be found on two staves or on a five-line staff (a TAB staff's tall
  parentheses stand alone); a final thin + thick double bar found as two lines is one.
- **Rhythm slashes** (`_ocrLeadBand`): tall beamed groups clear of the staff spanning ≥ half its width extend the chord
  search above them.
- **Bar numbers** (spec 2.7): a box centred within a space of the opening bar line, close above the staff, is read only
  as a number — never a chord, whatever the reader makes of it.
- **Crop cleaning** (spec 2.6 / 3.1): rows of the crop's padding that are ≥ 50 % ink (a fret grid's nut bar, a staff line,
  a beam) are whitened before the crop is scaled to 32 px (`chordOcrInput` `clean`: "lines" default, "pad", false).
  Neutral on every page we have (none has a nut bar touching a chord box); guarded by a test.
- **Grammar** (spec 5.3): `chordFromWritten` matches N.C. first ("N.C.", "NC", "N.C.(A7)" → the no-chord mark) and
  rejects a suffix not built like a chord name — "G#969" (two chords read as one box, accepted before), "C77", "Cm711".
  A "7sus4(b7)" missing its "(" or flat still reads 7sus4.
- **N.C. in the chart:** `chordPageScore` makes it the engine's "—" (every exporter writes N.C.), and the bars after it
  hold silence, not the previous chord.

**The readers** (spec 1.2–1.3, 4.x): two classes appended ("N", "." — a 43-class reader still decodes), both readers
trained 1,500 more steps from their shipped weights (`finetune_nc.py`, `synth_extra.py`: N.C.; guitar-book text and the
hats as negatives; crops with stems, beams or a nut bar; stacked alterations; diagonal slash chords), with a distillation
term (KL to the shipped reader on the original-mix images, weight 1.0). First try labelled digit-only marks ("1/2",
"(3)", "8va") EMPTY: held-out handwriting −1.0 / −1.4 (the reader started dropping the "11" of "Gm11"); without them
and with distillation 1.0 the drift is ≤ 0.3. "e f r c" (Ped., tacet, Fine) were NOT added: those are negatives.

**Measured** (same engine for the old/new reader rows; guitar book / Real Book = chord right per system, extras; rendered
= chord right in its bar, P / R; hands = held-out handwriting fonts, recognition):

| | guitar book (57) | Real Book (42) | rendered clean dev · test | photo ±3° dev · test | hands dev · test |
|---|---|---|---|---|---|
| old engine, old printed | 44, 33 extra | 32, 12 extra | 99.1/98.7 · 98.4/98.4 | 96.6/95.7 · 94.9/94.4 | 97.2 · 96.9 |
| new engine, old printed | 56, 30 extra | 32, 12 extra | 99.1/98.7 · 98.4/98.4 | 97.3/95.7 · 95.0/94.4 | 97.2 · 96.9 |
| **new engine, new printed (default)** | **56, 2 extra** | **33, 8 extra** | 99.1/98.7 · 98.4/98.4 | 97.0/95.7 · 95.1/94.1 | 96.9 · 96.6 |
| new engine, old hand | 56, 23 extra | 34, 7 extra | 98.8/98.6 · 98.4/98.1 | 97.2/96.1 · 93.5/92.8 | 94.8 · 94.7 |
| **new engine, new hand** | **55, 4 extra** | **38, 4 extra** | 99.1/98.7 · 98.4/98.4 | 97.2/96.2 · 95.0/93.8 | 96.6 · 95.8 |

N.C.: 0 of 3 before (no class for it); both new readers read 2 of 3 on the Real Book pages (the miss is "B-7 N.C."
written almost touching, one box). The new hand reader now passes the gate the default was chosen by (rendered dev ≥
98.5, hands dev ≥ 96.5); the default stays "printed" (better on engraved and held-out hands) until real hand-copied pages
are measured — the original Real Book truth pages (*If I Ain't Got You*) are not here to re-check.

**Checked, not adopted — the spec's fixed chord band** (`chord_roi_y = [y_top − 2.5s, y_top − 1.5s]`): on the guitar
book the read chords' baselines sit 1.2–9.3 spaces above the top line (median 5.4; only 11 of 102 inside 1.5–2.5); on the
Real Book 1.0–4.1 (16 of 39 inside). The band would drop most of them; the system grouping + row vote + 8-space search
(+ the rhythm-slash extension) does the job the band was meant to.

**Covered by what was already there:** P/V/G and choral (chords only above a system's top staff — lyrics and the piano
never searched), Big-Note letters inside noteheads (a box must end ≥ 0.6 space above the top line; new test), page
headers (8-space cap, title-ruling drop), boxed section labels (border strokes), fret grids (grid detector).
**Not built:** syllable-level checks of "Words and Music by" placement (the reader's negatives + the 8-space cap cover
it), a downbeat-aware placement of N.C. inside a bar (it takes the beat its x gives, as chords do), `*`-footnote stars
glued to a chord ("*Cm/Eb" is still missed).

## Two cheaper routes worth measuring alongside

1. **Tab photos.** Guitar tab is digits on six lines — far easier than notation. Text recognition
   of the fret digits (a small digit classifier, or Tesseract.js, Apache-2.0) + the existing Path A
   geometry and the manual string-shift fix gives Path A for photos. Keep it separate from the
   Path A parser.
2. **Chord-symbol OCR for lead sheets.** A fake book's harmony is text. OCR of the chord row,
   validated by the strict chord matcher (`isChordToken`, the one Lyrics Import uses) and bar
   lines from a vertical-line projection, would give the chord chart with no notation model.

## Lead-sheet reduction (built)

`leadSheetFromMusicXML(xml, opts)` → `{ melody per bar, chords per bar, key, … }`,
`leadSheetToMusicXML(lead)`, `leadSheetToChordScore(lead)` (→ CSMPN / CSML / handoff). Rules and
honest limits are in the engine block "LEAD SHEET" and CLAUDE.md. Guards: `tests/lead-sheet.mjs`
(31 checks, incl. all 338 Bach chorales: soprano picked every time, melody + chords identical
after export → re-read on the 336 chorales on a 16th grid, ~26 ms per chorale). The export was
also checked with music21 (every bar the right length, every chord symbol read back).
