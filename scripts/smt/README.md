# SMT (Sheet Music Transformer) — Phase 0 measurement scripts

Dev-time only: nothing here ships in the app. Results and the decision are in `docs/OMR-PLAN.md`.

Pins (download with curl into `smt-w/`, check before use):
- `https://huggingface.co/antoniorv6/smt-camera-grandstaff/resolve/9c1355631fbddc297d3d10fe4e6e5d3b5d3126b7/config.json`
  SHA-256 `de430bd1c38063fd002b93eab623fc467527d5f1167bb4ded067637dbe32d961`
- `…/model.safetensors` (85.5 MB, MIT) SHA-256 `93be49ca62c1d270579648e0c6d596cd239a7f0461c796f647ec0597ac085448`
- Test data (measurement only, never stored in the repo): `PRAIG/grandstaff` test parquet (MIT),
  `PRAIG/camera-grandstaff` test parquet (no licence stated on the Hub).

Steps (Python venv with torch, transformers, safetensors, onnx, onnxruntime, pyarrow, pillow):
1. `smt_model.py` — our implementation; `load()` is strict.
2. `python smt_export.py` → `smt-onnx/smt-enc.onnx` (image → cross-attention K/V of all 8 layers) and
   `smt-onnx/smt-dec.onnx` (one token + self-attention cache → logits + grown cache).
3. `python smt_int8.py` → `smt-onnx-w8/` (weight-only int8, the guitar CRNN's scheme).
4. `python smt_eval.py <model dir> <N> <parquet> <threads> [--ratio=0.85] [-v]` → symbol error rate,
   runaways (decodes that hit the 1,280-token cap), timing.
5. `node smt_web_bench.mjs <scratch dir> <model dir> <N>` → the same in onnxruntime-web 1.23.2 single-thread
   WASM (needs `<scratch>/ortweb/node_modules/onnxruntime-web@1.23.2`, `<scratch>/webimgs/` from a dump of N
   prepped images).
