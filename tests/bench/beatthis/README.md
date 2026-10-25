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
