# beat_this feasibility bench (2026-10-25)

Checks whether the learned beat + downbeat tracker that Muscriptor v0.4.0 uses
(`beat_this`, CPJKU, MIT code and weights) would beat our DSP `detectBeats`.
This is evidence for `docs/MUSCRIPTOR-REVIEW.md`. Nothing here ships.

```bash
# 1. render 9 GP songs (comp + bass, with and without a synthetic kit) and the true beats/bar lines
cd tests && node bench/beatthis/render.mjs <outDir>
# 2. score a beat_this ONNX export against that truth (python: onnxruntime numpy soundfile)
python -I bench/beatthis/eval.py <outDir> <model.onnx> <mel-filterbank.bin>
```

Models used (MIT, from Hugging Face; the official host `cloud.cp.jku.at` is not
on this environment's allowlist, so these are third-party conversions, and their
match to the official checkpoints was **not** verified here):

- `musetric/beat-this-onnx` → `beat_this.onnx` (final0, static 1500-frame graph, 190.6 MB) + `mel-filterbank.bin`
- `jenila-ai/beat-this-small0-onnx` → `beat_this_small0.onnx` (10.4 MB, SHA-256 `1dbbac9e…7517`)

`eval.py` follows the musetric `config.json` feature contract (22.05 kHz mono, STFT 1024 / hop 441,
periodic Hann, |X|/√1024 → mel → `log1p(1000·x)`), beat_this's `split_piece` /
`aggregate_prediction` (1500-frame windows, border 6, keep_first) and its minimal
peak picker. Metrics: beat and downbeat F-measure at ±70 ms; "meter right" = Muscriptor's
`infer_beats_per_bar` (90 % agreement) returns the true beats per bar.

## Real-audio gate (2026-10-25) — GuitarSet

```bash
# GuitarSet (CC-BY 4.0) from HF jhartquist/guitarset → <track>.wav (22.05 kHz mic) + .json (beats_s …)
# (dev-only; see CLAUDE.md for the download recipe; any 22.05 kHz wav + beats_s json works)
node bench/beatgrid.mjs <gs dir>                                      # our tracker: fixed ♩= vs timeline vs ×2/÷2
python -I bench/beatthis/eval.py --dump <gs dir> <out> <model.onnx> <mel-filterbank.bin>   # a reference ONNX
node bench/beatthis/js-eval.mjs <gs dir> <out> --ort <dir with onnxruntime-web@1.23.2> [--match solo --every 2]  # THE APP's path
node bench/beatgrid.mjs <gs dir> --learned <out> --only-learned       # like-for-like, per comp / solo
```

beat_this was trained on GuitarSet's **comping** takes only, so the **solo** takes are the held-out set.
On 44 solos the app's path (our JS front end + the committed int8 model on ORT 1.23.2 WASM): beat F
46.9 (built-in) → 75.6, tempo Acc1 75 → 80 %, downbeat F 54.1. Padding a piece shorter than 30 s to a full
window (as beat_this was trained) is worth +6.3 beat F over its own unpadded inference.
