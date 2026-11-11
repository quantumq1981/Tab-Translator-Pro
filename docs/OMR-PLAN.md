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
classes), weight-only int8 = **0.60 MB** (same accuracy as fp32). Trained only on synthetic images
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
