# Chord-symbol OCR — training kit and benches

The "Scan 📷" mode reads the chord symbols off a picture of a lead sheet (docs/OMR-PLAN.md). The page
layout, the model input, CTC decoding, the chord grammar and page → chart are pure engine code
(`engine.tsx`, block "CHORD OCR"; guarded by `tests/chord-ocr.mjs`). This folder makes the one learned
piece, the recogniser (`models/chord-ocr/chord-ocr.onnx`), and measures the whole thing.

Nothing here ships. Python 3.12 + torch 2.x, onnx, onnxruntime, numpy, pillow, fonttools; verovio + cairosvg
for the rendered corpus; Node 22 with `onnxruntime-web@1.23.2` (the app's pinned runtime) for the benches.

## Make the model

```sh
./fetch_fonts.sh fonts                                   # 24 open-licensed fonts (training images only)
CHORD_OCR_FONTS=fonts python train.py 12000 ckpt1.pt     # synthetic chords only (stopped at 5000 here)
# then fine-tune with the negatives (bar numbers → digits, words / tempo marks → empty):
CHORD_OCR_FONTS=fonts LR=1e-3 python train.py 6000 ckpt2.pt ckpt1.pt
python export.py ckpt2.pt chord-ocr.onnx --int8          # prints max |Δ| vs PyTorch and the SHA-256 to pin
```

`train.py` selects its checkpoint on the dev half of the rendered corpus below (`crops/index.json`), so build
that first. Its printed "dev exact" pads a batch to its widest crop and reads lower than the app does (a
narrow crop behind a long blank pad loses its last character through the bidirectional GRU); quote the
benches, which read one box at a time as the app does.

## Fine-tune for hand-copied (Real Book) pages

Both shipped readers are fine-tunes of the first model (2026-11-15): `chord-ocr.onnx` ("printed", the default) and
`chord-ocr-hand.onnx` ("hand-copied (Real Book)"), see docs/OMR-PLAN.md "Real pages" for which run/step each is and
why. The PyTorch weights were never committed, so the start point is recovered from the first model's ONNX, exactly
(BatchNorm is folded into the convolutions there, so it is set to identity and kept frozen):

```sh
python from_onnx.py ../../models/chord-ocr/chord-ocr.onnx base.pt     # prints max |Δ logits| vs the ONNX (3.8e-6)
CHORD_OCR_FONTS=fonts RB_SHARE=0.3 LR=5e-4 python finetune.py 3000 ft.pt base.pt   # ~25 min on 4 CPU cores
python export.py ft.pt chord-ocr.onnx --int8
```

`synth_rb.py` draws the hand-copied Real Book look the original fonts never had: a small suffix raised to the
root's top, the dash minor, and the 7 as a short hook (also hand-drawn 9 and 1, so the three are told apart by
shape) — 30 % of the fine-tune's images; the other 70 % are the original `synth.py` mix, so engraved and photo
accuracy is kept (checked below). A fine-tune on MuseJazz Text alone made it worse (it read the hook-7 as 9 at 90 %).
`RB_NEG` (0.2) adds bar numbers and words, in the hand fonts, to that branch. The real-page result swings a lot between
runs and steps — evaluate every checkpoint (`finetune.py` saves one each 250 steps) and choose on page 2 only.

## N.C. and the guitar-book negatives (2026-11-15)

Both readers gained two output classes, "N" and "." (appended to the charset, so a 43-class reader still decodes),
and were trained further FROM the shipped weights — `from_onnx.py` recovers each int8 ONNX exactly and starts the new
classes silent — on the original mix plus `synth_extra.py`: N.C. (and "N.C.(A7)"), guitar-book text and articulation
marks as negatives (P.M., H, P, sl., 1/2, full, let ring, Gtr. 1, Rhy. Fig. 1, 8va, Ped., tacet, sim., the bend / marcato
hat), crops with rhythm-slash stems, beams or a nut bar under the name, stacked alterations and diagonal slash chords.
A distillation term holds each reader to its shipped self on the original-mix images (the hand reader's Real Book
pages are not in the repo, so its drift there can't be re-measured):

```sh
python from_onnx.py ../../models/chord-ocr/chord-ocr.onnx base-printed.pt            # 43 shipped classes, 45 now
CHORD_OCR_FONTS=fonts python finetune_nc.py 1500 nc-printed.pt base-printed.pt         # run from the corpus folder
python export.py nc-printed_1500.pt chord-ocr.onnx --int8
python synth_extra.py                                                                  # 48 samples → extra_samples/
```

## Real pages with hand-read truth

```sh
node bench_page.mjs truth/berklee-if-i-aint-got-you.json chord-ocr.onnx <dir with p-1.png p-2.png>
node bench_page.mjs truth/hal-leonard-pvg-gone-till-november.json chord-ocr.onnx <dir with h-01.png … h-04.png>
node bench_page.mjs truth/hal-leonard-guitar-allman-brothers.json chord-ocr.onnx <dir with p-03.png p-05.png p-20.png>
node bench_page.mjs truth/berklee-real-book-everyday-fallin.json chord-ocr.onnx <dir with p-14.png p-15.png>
```

(`ENGINE=<another engine.tsx>` runs any bench on another engine for an A/B; `OCR_OPTS='{"clean":false}'` passes
options to `readChordPage`. A truth chord "N.C." matches a read of N.C.)

The truth files hold only the chord symbols per system (the pages are the owner's copies of published books and
are not in the repo); each file's `source` says how to render the PDF so the staff positions match. Checkpoints were
chosen on the Real Book page 2 only; page 1 is the held-out read.

## Digital score PDFs (Ultimate Guitar "Pro", MuseScore exports)

`bench_pdf_text.mjs` reads a PDF from its text layer (engine `pdfChordPages`) and scores it against the Guitar Pro file
it was engraved from — the chord names on the GP beats, matched by root / bass / tone set — or, with `-`, against the
text layer itself (verify that by eye first). `--ocr <model>` also renders the pages with poppler at the app's Scan
width and runs the raster reader on them. Numbers and the corrected calibration spec: `docs/UG-PRO-PDF-CALIBRATION.md`.

```sh
node bench_pdf_text.mjs <Revelation.pdf> "../../Robben Ford - Revelation.gp"
PNGJS_FROM=<dir>/package.json ORT_WEB=<dir>/node_modules/onnxruntime-web/dist/ort.wasm.min.mjs \
  node bench_pdf_text.mjs <pdf> <gp|-> --ocr ../../models/chord-ocr/chord-ocr.onnx   # OCR_ENGINE=<older engine.tsx> for an A/B
```

## The rendered corpus (ground truth for free)

```sh
node gen_leads.mjs lead 24          # the repo's 78 Guitar Pro files → lead-sheet MusicXML (first 24 bars),
                                    # chords in the Pro vocabulary; even file index = dev, odd = test
python render.py lead pages 1.5     # verovio → page PNG (+ raw grey) + every chord's box (unique colour per
                                    # chord in a second render) + its bar; ♯/♭ drawn from DejaVu Sans
python crops.py pages crops         # chord crops for recognition-only scoring
python photo.py pages photo1 1 1.0  # phone-photo conditions: homography (rotation ±1° / ±3°, perspective),
python photo.py pages photo3 3 3.0  # shadow ramp, paper tone, noise, blur, rescale, JPEG; boxes mapped through
python holdout.py hold              # every truth chord drawn in the HELD-OUT handwriting fonts
```

## Measure

```sh
node bench_e2e.mjs pages chord-ocr.onnx     # the whole engine path (readChordPage) per page vs truth
node bench_e2e.mjs photo3 chord-ocr.onnx
node eval_crops.mjs hold chord-ocr.onnx     # recognition only (python packcrops.py hold first)
node bench_tesseract.mjs crops 7            # the baseline: tesseract.js 5.1.1, eng, single line, whitelist
```

Results and the decisions they drove are in docs/OMR-PLAN.md ("Chord-symbol OCR").
