# Audio-chord benchmark (SynHarmonics v2 §8 — "accuracy claims must be falsifiable")

Dev-only, Node. Nothing here ships. It scores the Audio panel's chord decoder on
**isolated-stem renders of the repo's own Guitar Pro files**, where every note — and so the
ground-truth harmony — is known exactly.

```sh
cd tests && npm install
npm run bench                 # all songs × 5 conditions, v1 vs v2 (first run renders + caches audio)
node bench/run.mjs --split test --variants v1,v2 --resample sinc   # the held-out half only
npm run bench:calib           # Stage C calibration (ECE) on the held-out half
node bench/sweep.mjs decoder --conds clean,bleed,room,noise        # ablations on the DEV half
node bench/confusion.mjs clean,bleed                               # what the errors are
node bench/inspect.mjs 11 clean                                    # GT vs decode timeline, one stem
```

## What is measured

- **Corpus** (`lib.mjs` `CORPUS`): 28 comp/rhythm tracks from 25 songs (jazz heads, Steely
  Dan, soul, rock), first 60 s from the first chordal event.
- **Rendering**: Karplus–Strong plucked strings (exact-pitch fractional delay, pick-position
  comb, register-dependent T60, strummed with 6–18 ms spread) for guitar parts; inharmonic
  additive piano (Fletcher-like B, 1e-4 bass → 1e-3 treble) for piano/e-piano; drawbar organ.
- **Conditions** (v2 §4.2 augmentations): `clean`; `noise` (pink-ish, 20 dB SNR); `room`
  (RT60 1.4 s, 35 % wet); `detune` (+40 ¢); `bleed` (drum kit + the song's own bass part at
  0.6× the stem's RMS — an imperfect separator's leakage).
- **Ground truth**: the engine's `recognise` of the NOTATED voicing (the importer's event
  symbol), held until the next chordal event; a silence ≥ 1.5 s is N.C. — i.e. "what the stem
  actually plays", which is what an audio decoder can recover.
- **Metrics** (mir_eval conventions, 10 ms frames): `root`; `majmin` and `sevenths`
  (reference chords outside the vocabulary excluded); `pcs` (exact pitch-class set);
  `bass` (sounding bass incl. inversions); `seg` = 1 − max(over, under) directional Hamming.
- **Splits**: even corpus indices = DEV (all tuning/ablation), odd = TEST (reported only).
  The app's analysis rate is reproduced (44.1 kHz → 22.05 kHz): `--resample sinc` uses the
  shipped `resampleTo`, default is the old box decimator.

## Honest limits

Synthetic timbres are cleaner than real recordings (no amp distortion, no fret noise, no real
room), so absolute numbers are optimistic; the **deltas** between pipelines are the read. The
repo's real stems are vocal (no harmonic ground truth) — they are used for sanity/run-time only.
