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
