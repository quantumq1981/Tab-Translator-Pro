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
| **SMT — Sheet Music Transformer** (`antoniorv6/smt-camera-grandstaff`, `smt-grandstaff`, rev `9c13556…`) | MIT / MIT (model card) | 21.4 M params (≈ 86 MB fp32, ≈ 22 MB int8 weights) | Humdrum `**kern` tokens, one grand-staff **system** per image | **Candidate.** ConvNeXt encoder (64/128/256, depths 3/3/9) + transformer decoder (d_model 256), no KV cache. Full-page variants exist (`smtpp_*`). |
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

**Status:** the SMT source and weights are reachable from the cloud container
(`huggingface.co`, `github.com`), and PyTorch installs from PyPI. Running the SMT repository's
own Python code to export it was **blocked by the session's safety classifier** (third-party
code). Next step: the owner approves running it (or it runs on the owner's Linux laptop), then
`smt_export.py` (encoder → `raw/pos` features, decoder → last-token logits, dynamic H/W and
length, opset 17) + a parity check vs PyTorch + int8 + an onnxruntime-web timing and memory run.

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
