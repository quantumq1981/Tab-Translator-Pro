# SynHarmonics Engine v2.0 → Tab Translator Pro: isolated-stem chord recognition

**Status:** shipped 2026-10-21 as the default Audio-panel chord decoder (`analyzeAudioChords`,
`engine.tsx`). The legacy decoder is one option away (`engine: "v1"`).

This document maps the *SynHarmonics Engine v2.0* specification (the critical review of the
v1.0 proposal) onto this app's hard constraints and records what was measured. The rule taken
from v2.0 §0.3 / §8 is that **accuracy claims must be falsifiable**. Every stage below was kept
only if it measurably improved a held-out benchmark, and one stage that didn't is shipped
opt-in rather than default.

---

## 1. Constraints that shape the mapping

| v2.0 assumption | This app | Consequence |
|---|---|---|
| VST/standalone, ONNX Runtime CPU, TCN ≤ 5 M params trained on Billboard/RWC | zero-dep, zero-server static site; iOS Safari first; no WASM threads (no COOP/COEP on GitHub Pages); no annotated audio to train on | Stage C uses the **deterministic, published baselines** v2.0 names as its reference (NNLS chroma + HMM), not a learned TCN |
| Streaming, causal + display modes, latency budget | Decodes **files** (stems), off-thread in a Worker | Display mode only. Non-causal (bidirectional) inference is free. |
| Elastic PLL beat grid + downbeats | Ellis DP beat tracker exists; pure-DSP downbeat cues measured near-chance (CLAUDE.md) | Beat grid reused, **subdivided ×2**; no downbeats |
| Guitar/piano fingering DP (Stage E) | The Audio panel recognises chords; fingering is not part of recognition accuracy | Out of scope for this change (see §6) |

## 2. The system contract (v2.0 §0)

`analyzeAudioChords(pcm, sampleRate, opts)` → `{ events, bpm, beats, key, tuning, method }`.

Each event is `{ symbol, midis, startSec, durSec, confidence, prob, alternatives[], ambiguous }`:

- `prob` is the calibrated posterior mass of the label, averaged over the event's beats.
- `confidence` is `1 − H(p)/log K`, the v2.0 §4.3 normalised entropy.
- `alternatives` are the next three labels by posterior, each with a playable voicing.
- `ambiguous` is `prob < 0.4`.

The event shape is a superset of the v1 event shape, so the chart, all six exporters and the
Chord Sheet Maker Pro handoff consume it unchanged.

## 3. What was built, stage by stage

### Stage A: front-end (`resampleTo`, `logFreqSpectrogram`, `nnlsChromagram`)

1. **Anti-aliased resampling.** A Kaiser-windowed sinc (β 8.6, cutoff 0.85 × the lower Nyquist)
   replaces the box-average decimator. That decimator let a 15 kHz tone alias into the chroma
   band at −3 to −10 dB; the sinc suppresses it by more than 40 dB.
2. **Log-frequency spectrogram** at 3 bins per semitone, D1–B7, using a 0.25 s window (nearest
   power of two) and 0.1 s hop. Two real STFT frames are packed into one complex FFT.
3. **HPSS in log-frequency.** Median filters run over 0.6 s in time and 13 bins in frequency.
   This is about 10× cheaper than the linear-frequency version. The legacy 2.5 s time kernel
   smeared fast changes; 0.6 s was swept on the dev split.
4. **Global tuning.**
   - **Estimate:** parabolic-interpolated spectral peaks, combined as a circular mean (±1.5¢
     accuracy across ±48¢).
   - **Reliability:** the circular resultant R. In-tune instruments read 0.6–1.0; vibrato
     vocals read 0.04–0.3.
   - **Shrinking:** the compensation is scaled by that reliability, so a singer's drift doesn't
     move the grid.
   - **Why not the spectral-phase method:** Chordino's phase-of-period-3 estimator was
     implemented first. It had a **−11¢ bias** caused by the linear-to-log fold, so it was
     replaced.
5. **NNLS approximate transcription** (Mauch & Dixon 2010):
   - **Dictionary:** a harmonic-series note dictionary (s = 0.8, 16 partials), solved per frame
     by Lawson–Hanson active-set NNLS on the Gram matrix.
   - **Bass:** the lowest note at ≥ 40 % of the frame's strongest, blended with a register
     profile. A **sub-octave guard** requires spectral energy at the candidate's own
     fundamental, because NNLS can activate a phantom note an octave below.
   - **Treble:** an even blend of NNLS activations and raw harmonic salience (see §4 for why).

### Stage C: harmonic posterior (`chordStatesV2`, `hmmChordDecode`)

- **State space:** root × quality (the 22 engine qualities, or 15 with Simple mode). Two kinds
  of slash chord are states in their own right, not post-hoc relabels:
  - **inversions:** every chord tone in the bass, for triads, 7ths and sus chords;
  - **foreign-bass slash chords:** major or minor triads over any non-chord-tone bass (`D/C`,
    `Bb/C`, `F#m/G`).
- **No-chord state:** reached through a dB gate relative to the 95th-percentile level. A short
  silence (< 1 s, such as a staccato chop) gets a *flat* emission, so the HMM carries the
  surrounding chord across it.
- **Emission:** treble cosine to the template, plus a bass vote, minus three priors (rarity
  `rank`, inversion, foreign slash), minus a power-chord prior, plus an optional diatonic key
  bonus.
- **Decoding:** Viterbi gives the label sequence; forward–backward gives per-beat posteriors.
  The "stay or jump anywhere" transition makes both O(T·S).
- **Calibration:** the temperature τ = 0.05 was fitted on the dev split. Held-out ECE is
  **5.2 %**.

### Stage D: symbolic context (`repetitionSmooth`, opt-in)

Repetition-aware chroma smoothing (Mauch, Noland & Dixon 2009) is v2.0 §5.3's "structural block
conditioning" without a model. Bidirectional context, the other half of §5, comes from
forward–backward. **It is shipped opt-in** because it did not clear the bar on held-out data
(§5).

### Stage B: structural clock

The existing Ellis beat tracker is kept. Ellis's TPS2/TPS3 metrical-level scoring was tried for
tempo-octave errors. Acc2 moved only from 18/28 to 19–20/28, so it was not shipped. Sections
remain in `detectSections` (unchanged).

## 4. Benchmark (`tests/bench`, see its README)

- **Stems:** 28 comp/rhythm tracks from 25 Guitar Pro songs, rendered as isolated stems.
  Guitar parts use exact-pitch Karplus–Strong strings, piano parts an inharmonic additive model,
  organ parts drawbars.
- **Conditions:** five per stem: clean, 20 dB noise, room (RT60 1.4 s), +40¢ detune, and drum +
  bass bleed.
- **Ground truth:** the notated voicing as named by the engine's oracle.
- **Splits:** **even indices = dev** (all tuning), **odd = test** (reported).
- **Metrics:** MIREX-style, at 10 ms frames.

**Held-out test split, all five conditions (70 stem-renders), app resampling chain:**

| decoder | root | majmin | sevenths | exact pcs | bass | seg |
|---|---|---|---|---|---|---|
| v1 (HPSS chroma + Viterbi, shipped before) | 54.3 | 47.0 | 42.0 | 38.3 | 42.5 | 72.0 |
| **v2 (shipped)** | **75.6** | **76.3** | **69.9** | **65.0** | **74.8** | **80.7** |

Dev split: v1 58.2 / 47.7 / 42.9 / 39.4 / 44.3 / 73.6 → v2 76.4 / 77.6 / 72.5 / 65.4 / 81.5 / 82.2.
Under +40¢ detune, v1 majmin falls to 42.1 while v2 holds 79.8.

**Ablation on the held-out split** (each row removes one component from the full default):

| configuration | root | majmin | sevenths | pcs | bass | seg |
|---|---|---|---|---|---|---|
| full v2 | 76.0 | 76.8 | 70.0 | 65.1 | 74.8 | 80.7 |
| treble = NNLS only | 74.0 | 73.5 | 66.0 | 62.5 | 74.9 | 80.2 |
| − NNLS (salience only) | 74.6 | 74.9 | 68.8 | 64.1 | 68.9 | 80.9 |
| − HPSS | 74.6 | 75.5 | 69.4 | 63.9 | 72.8 | 80.3 |
| − tuning compensation | 74.4 | 74.3 | 66.6 | 61.9 | 74.8 | 80.5 |
| − lowest-note bass | 74.7 | 76.7 | 70.0 | 65.1 | 69.0 | 80.9 |
| − sub-octave guard | 75.8 | 76.6 | 69.8 | 64.6 | 57.0 | 81.2 |
| − inversion states | 64.9 | 69.0 | 63.0 | 57.1 | 65.8 | 81.0 |
| − foreign-bass slash states | 74.1 | 74.9 | 68.0 | 63.2 | 74.6 | 80.9 |
| − power-chord prior | 75.9 | 75.4 | 68.5 | 63.8 | 74.8 | 80.5 |
| − beat subdivision | 73.5 | 74.6 | 67.7 | 62.5 | 72.8 | 78.4 |
| − short-gap carry | 75.5 | 76.3 | 69.5 | 64.6 | 74.2 | 79.3 |
| + Stage D repetition | 76.2 | 78.0 | 70.8 | 65.8 | 74.5 | 79.4 |

(This table uses the box decimator; the 75.6 row above uses the shipped sinc resampler.)

## 5. Findings worth not re-deriving

- **NNLS alone is not the win.** NNLS removes phantom overtones: a Bb's 3rd harmonic stops
  reading as F. But it also explains a triad's *real* 5th as its root's 3rd harmonic, which
  costs the 7th/extension detail. Blending the treble with raw salience beat NNLS-only on held
  out by **+3.3 majmin and +4.0 sevenths**. The bass stays pure NNLS, which is worth +6 bass
  accuracy over salience.
- **The largest single gain is modelling inversions as HMM states**: root +11, majmin +8 on held
  out. Next come the sub-octave guard (+18 bass), the lowest-note bass (+6 bass), tuning
  compensation (+3.4 sevenths), beat subdivision (+2.5 root, +2.3 seg), foreign-bass slash
  states (+1.9 root) and the power-chord prior (+1.4 majmin).
- **Stage D is a trade, not a gain.** On both splits it adds about +1 sevenths and costs
  −1.0 to −1.3 segmentation. On the original, shorter-context version, a 12-bar blues lost
  6 points because bars sharing a groove but not a chord borrowed each other's evidence. It
  stays opt-in (`repetition: true`).
- **Frame-grid decoding** (Chordino-style, no beats) was tried to decouple chords from tempo
  errors. The subdivided beat grid still won by about 1 point, even with imperfect beats.
- **Whitening hurt.** Chordino-style spectral whitening cost 6–8 majmin points here, so it is
  off by default (`whitenBins`).
- **Two benchmark bugs were caught by the engine itself.** The tuning estimator read clean
  synthetic guitars at −12¢, which exposed a Karplus–Strong delay-length error in the renderer.
  A separate check found the piano inharmonicity was set backwards (high B in the bass). Both
  were fixed and the whole corpus re-rendered before any number above was taken.

## 6. Not done, and why

- **A learned acoustic model (TCN) and re-ranker (Transformer).** There is no annotated audio to
  train on from this environment, and the iOS/Pages wall applies. The drop-in point exists: a
  learned front-end only has to emit the same `{chroma, bass}` frames, and `hmmChordDecode` is
  model-agnostic.
- **Causal / streaming mode.** The app decodes files.
- **Stage E fingering DP.** This doesn't change recognition accuracy. It is the natural next
  step for giving audio-derived charts a `{tab}` block, since audio events carry no frets today.
- **Downbeats and tempo octave.** Measured limits; see CLAUDE.md.

## 7. Honest limits

- The benchmark stems are synthetic. Absolute numbers are optimistic; the deltas are the read.
- On real **vocal** stems the decoder correctly reports low confidence (half to two thirds of
  events flagged on the repo's three vocal stems). It is not a vocal-harmony transcriber; that remains the basic-pitch "Voices
  (ML)" path.
- Heavy bleed is the hardest condition (majmin 73.0 on held-out). Cleaner stems help most.

---

## 8. v2.1: batch review, Auto, stems, live capture (2026-10-22)

### Batch review + ⚡ Auto
- **`ChordReview`** now gives each uncertain chord a checkbox and a radio-style choice among
  its candidates (the detected label plus up to three ranked alternatives). The toolbar has
  **☑ Select all / ☐ Clear**, **✓ Commit selected (n)** and **✓✓ Commit all (n)**. A commit
  goes through the pure engine helper `commitChordChoices`. It can only choose among the
  decoder's own candidates, swaps in the chosen voicing, and keeps the replaced label one tap
  away.
- **⚡ Auto** (`autoResolveChords`, remembered per device) commits the decoder's own best
  choice for every uncertain chord, so nothing is left pending. Those rows stay listed as
  "auto" and can still be changed. Switching Auto off (`reopenAutoChords`) re-queues them but
  keeps anything the user committed.
- **What Auto can and cannot do, measured:**
  - Uncertain chords are about 10–12 % of the timeline.
  - Their top choice is right 34–40 % of the time; the right answer is among the alternatives
    another ~20 %.
  - So a perfect re-ranker could add at most about +2.5 points overall.
  - "Best match" therefore is the decoder's posterior MAP. Accuracy comes from the front-end,
    not from a second guesser.

### Measured and NOT shipped: a corpus chord language model
- **The model:** a transposition-invariant bigram, P(Δroot, q₂ | q₁), trained on the repo's
  Guitar Pro corpus and used as the HMM's jump weight.
- **Why the dev split looked good:** +1.4 majmin and +2.1 sevenths, but that was leakage. The
  model had been trained on the dev songs' own progressions.
- **Clean test:** retrained on non-benchmark songs only, it was neutral on dev and **−1.9 root
  on held-out**. The corpus (25 songs, jazz-heavy) is too small to generalise across styles,
  so it was reverted.

### Shipped: noise-floor rests
A rest under hiss or bleed is not silent, and its noise chroma was being named. In one
measured case an organ pad resting 54 % of the time scored 98 % clean but 43 % with 20 dB
noise, with every rest read as `Em7`. A beat-segment is now also a rest when it is ≥ 12 dB
under the loud passages **and** its chroma is flat (normalised entropy ≥ 0.97; noise reads
0.99–1.00, real chords 0.68–0.83). Results: dev +1.5 root / +1.7 majmin; held-out +0.3 root /
+0.6 majmin / +0.9 sevenths. Current held-out totals: **root 76.1 · majmin 77.0 · sevenths
70.9 · exact pcs 65.9 · bass 74.7 · seg 80.7**, calibration ECE 5.6 %.

### Stems → per-instrument charts (`chartsFromStems`, engine, pure)
- **One shared beat grid** is tracked on the drum stem (the clearest pulse), with a fallback
  to the harmonic stems. Every chart decodes on it and quantises with the same ♩=, so bar *n*
  is the same moment in every chart.
- **Charts:** Full band (harmonic stems), one chord chart per harmonic stem, the bass line and
  vocal melody (YIN notes), and drums (`transcribeDrums`, then `drumPattern`, giving a 16th
  grid and GM-drum MIDI).
- **Measured** (`tests/bench/stems.mjs`, 9 songs: comp + bass + drums):

  | input | root | majmin | sevenths |
  |---|---|---|---|
  | the mix decoded directly | 54.4 | 58.0 | 48.7 |
  | perfect stems | 76.3 | 76.4 | 69.5 |
  | stems with −12 dB cross-leakage | 65.1 | 67.5 | 60.2 |

  **Separation is the single largest accuracy lever on a full mix.**
- **Bass-stem fusion** (`bassFusion: true`) is opt-in. It was within ±1 point with perfect
  stems and cost 2–3 points with leaky ones, because a walking bass's passing notes pull roots
  off.
- **Drums use semi-adaptive NMF** (kick, snare and hat templates). A band-energy detector was
  tried first and failed for a physical reason: every drum reaches every band (snare precision
  27 %). On the rendered kit, at full rate: **kick F 98.4 · snare 96.9 · hat 98.7**. The same
  synthetic kit was used to tune and to score, so real kits will score lower. Soft ghost notes
  are not drawn. Run it on the full-rate stem; hats live above the 16 kHz analysis Nyquist.

### Separator (`stem-model.js` → `stem-worker.js` → `stem-model-core.js`)
- **Model:** SCNet via the vendored, MIT-licensed `@audio/neural-separate` bundle. Weights are
  13 MB int8 (MIT), from a pinned Hugging Face revision, **SHA-256-checked**, then cached.
  Every WASM session runs ONNX Runtime Web **1.23.2** (plain build, pinned jsDelivr URL); only the
  library's WebGPU path uses its bundled 1.30.0. ORT ≥ 1.24 ships Abseil 20250814, which Safari's
  JavaScriptCore miscompiles ("Could not find OrtValue with name '…'" at session creation,
  microsoft/onnxruntime#33426); 1.23.2 separates bit-identically (`tests/bench/ort-pin.mjs`).
- **Published MUSDB18 SDR:** vocals 9.9 · drums 9.4 · bass 8.4 · other 6.2. That is the
  htdemucs class; htdemucs's own weights are research-only, so they are not used. Moises' models
  are proprietary, so "matches Moises" cannot be claimed or measured here. This is the best
  openly-licensed model of its size.
- **Execution:** WebGPU when available (never on Safari / iOS — ORT's WebGPU builds stall WebKit's
  optimising WASM tier, microsoft/onnxruntime#26827), else single-thread WASM (no COOP/COEP on
  Pages). It runs in a module Worker, in 60 s blocks with 1.5 s cross-faded context to bound memory
  (30 s blocks and a 2.8 s-window model in low-memory mode, the default on iPhone/iPad).
- **4 stems only:** guitar and keys are not split (no openly-licensed model does that). Import
  Moises stems for those.
- **Verification:**
  - Done here: the full browser flow was exercised end-to-end with a stub model (worker,
    progress, tabs, mixer, WAV download, stem import, mic capture).
  - **Not** done here: the model itself, because Hugging Face is unreachable from the dev
    sandbox. It is the device check that remains.

### Live capture instead of link downloading
`🖥 Capture a tab` (getDisplayMedia, desktop Chrome/Edge) and `🎙 Record` (microphone) record
raw PCM of what the device is playing and feed the same pipeline as a file.

A "paste a YouTube/Spotify link" downloader was deliberately **not** built:
- Spotify streams are DRM-encrypted.
- YouTube's terms bar downloading its streams.
- A zero-server page cannot fetch either without a server running stream-extraction tooling.

A DRM-protected tab may capture as silence; the panel says so rather than failing quietly.
