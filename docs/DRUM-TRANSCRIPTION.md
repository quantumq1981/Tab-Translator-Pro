# Drum transcription — WPO-ADT-001 response (Phase 0)

Work order **WPO-ADT-001** ("Drum Transcription Integration — Tab Translator Pro") asks for a
drum subsystem that outputs drum notation as a first-class part of the score, measured against
explicit targets (§5). Its own gate (§8.1) is: **no model development until the interface
schema (§4) and the evaluation harness are signed off.** This document is the Phase 0
deliverable: the gap analysis, the frozen interface, the harness, the baseline numbers on
**real recorded drums**, and the decisions the owner has to make before Phase 1.

---

## 1. Where the app already stood

The work order was written as if the app had no drum path. It has one:

| Piece | Where | What it does |
|---|---|---|
| `transcribeDrums` | `engine.tsx` | semi-adaptive **NMF** (kick / snare / hat templates, KL updates), onset = peaks of each activation's rise |
| `_classifyFullKit` (WO-5) | `engine.tsx` | names each onset from features around it → kick, snare, closed/open hat, crash, ride, 3 toms |
| `drumPattern`, `drumHitsToMidi`, `drumKitToMidi`, `drumHitsToMusicXML`, `drumHitsToAsciiTab` | `engine.tsx` | groove grid, GM ch. 10 MIDI, percussion-clef MusicXML, ASCII tab |
| `chartsFromStems` | `engine.tsx` | drum stem → drums chart on the song's shared beat grid |
| SCNet separator | `stem-model*.js` | full mix → drums stem on device |
| Tempo & bars, beat_this | `engine.tsx` + `beat-model*.js` | beat grid, tempo map, downbeats |

Until now it was validated only on a **synthetic, rendered kit** (WO-5: every class F1 ≥ 0.88,
tuned and scored on the same kit). The first thing Phase 0 found is that **those numbers do not
transfer to real drums** (§4 below).

---

## 2. Datasets — licensing decides what can be used

The owner monetises the app, and an earlier decision (MERT, Muscriptor) rules out
non-commercial licences anywhere in the pipeline.

| Dataset (work order §5) | Licence | Usable here? |
|---|---|---|
| **E-GMD** (Expanded Groove MIDI, Magenta) | **CC BY 4.0** | **Yes**: evaluation **and** training |
| MDB Drums | CC BY-NC-SA 4.0 | No (non-commercial) |
| ENST-Drums | research-only licence | No |
| IDMT-SMT-Drums | CC BY-NC-ND 4.0 | No |
| ADTOF (dataset + model) | CC BY-NC-SA 4.0 (checked in the repo's `LICENSE`) | No (see §5) |

So **E-GMD is the primary development and validation set**, not MDB/ENST. It is 444 h of human
drummers on a Roland TD-17, rendered through 43 sampled kits, with audio sample-aligned to MIDI
that carries **velocities**, so it covers onset, class, velocity, ghost notes and the beat grid in one set.
The 96 GB archive is never downloaded: `scripts/egmd_subset.py` reads only the chosen files out
of it with HTTP range requests. The in-house drummer-annotated set (§5, 10 tracks) still needs
the owner's resource allocation (§8.2).

**The subset:** dev = E-GMD's *validation* split (12 performances, 309 s; that split only holds 12
distinct performances at 6–40 s); test = E-GMD's *test* split (30 performances, 803 s). One kit per
performance, so the same take is never scored twice through two kits. 33 different kits.
Tambourine and cowbell are out of scope (§2) and excluded. `--seed 7` rebuilds the identical set
(verified byte-for-byte on notes and beats).

---

## 3. The evaluation harness (§5)

`tests/bench/adt-metrics.mjs` (pure) + `tests/bench/adt.mjs` (runner):

- **Matching:** mir_eval's rule (one-to-one, ±50 ms, maximum cardinality). The greedy sweep is
  proven maximal against brute force (unit test, 150 random cases), and
  **`scripts/adt_mireval_check.py` recomputes every track × class score with
  `mir_eval.onset.f_measure`: max difference 0.0** (51 scores).
- Classes: 5-class `kick · snare · hihat · tom · cymbal` (the literature / ADTOF set) and
  7-class (`crash`, `ride` split out). GM notes are mapped like Magenta's 8-hit map; same-class
  events < 30 ms apart are merged on both sides, because a closed hat + pedal hat at one instant
  is one hit to any transcriber.
- Metrics: onset-only F, class-aware F, per-class F, **simultaneous-onset recall** (a reference
  hit with a different class within 30 ms), **velocity MAE in MIDI units after a per-track linear
  rescale** + the mir_eval-style "within 0.1" share, **ghost-note recall** (snares under 0.5× the
  track's median snare velocity) + flag recall/precision, beat F (±70 ms, first 5 s skipped, as
  `mir_eval.beat`), tempo within 4 %, and **grid alignment** (± one sixteenth vs the MIDI's own grid).
- `--variant file --est <json>` scores any external system's output, so a baseline doesn't need
  to be ported to JS to be measured.

```sh
python3 -I scripts/egmd_subset.py /data/egmd          # once: ~100 MB of WAV + MIDI + truth.json
cd tests && node bench/adt.mjs --data /data/egmd --split test --variant adt
node bench/adt.mjs --data /data/egmd --split dev --variant adt --dump est.json
python3 scripts/adt_mireval_check.py est.json         # harness == mir_eval
```

---

## 4. Baseline numbers — E-GMD **test** split (30 tracks, held out)

5-class, ±50 ms, micro-averaged over the split. Targets from §5 in the last row.

| System | onset F | class F | kick | snare | hihat | tom | cymbal | simult. R | vel MAE | ghost R |
|---|---|---|---|---|---|---|---|---|---|---|
| NMF 3-class (`transcribeDrums`, current default) | 74.5 | 66.2 | 82.1 | 66.7 | 68.6 | 0 | 0 | 65.2 | — | 0.0 |
| WO-5 full kit (`kit:"full"`) | 76.9 | **56.2** | 82.3 | **35.7** | 67.6 | 9.7 | 9.4 | 51.9 | — | 0.5 |
| **`transcribeDrumEvents` (this PR)** | **78.0** | **68.3** | 82.0 | **74.9** | 68.6 | 0 | 0 | 65.3 | 19.1 | 15.3 |
| Magenta Onsets & Frames *drums* (E-GMD checkpoint) | 81.3 | 76.3 | 78.2 | 78.4 | 77.6 | **94.3** | 54.3 | 61.1 | **8.3** | 26.3 |
| **§5 target** | ≥ 75 | — | ≥ 85 | ≥ 85 | — | ≥ 60 | ≥ 60 | ≥ 70 | ≤ 12 | ≥ 65 |

Beat grid of `transcribeDrumEvents` (test): beat F **79.4** (target ≥ 80), tempo within 4 % on
23/30 tracks, onsets within ± one sixteenth of the reference grid **80.8 %** (target ≥ 95 %; every
miss is a track whose tempo was read wrong). Speed: 0.023× real time in Node (4-core container).

Dev split (12 tracks), for reference: current default class F 58.7 / snare 73.5 →
`transcribeDrumEvents` 61.8 / 81.3; Magenta O&F 82.8 / 91.1.

**What the table says:**

1. **The WO-5 full-kit classifier does not work on real drums**: it halves snare F (66.7 → 35.7)
   and finds ~10 % of toms and cymbals. Its ≥ 0.88 numbers came from the synthetic kit it was
   tuned on. Keep it off by default (it already is); don't build on it.
2. **Pure DSP is at its ceiling.** NMF has no tom or cymbal component and no usable velocity:
   the velocity estimate (from the activation rise) misses the target by 7 MIDI units, and the
   ghost flag is right 13 % of the time. No threshold sweep fixes that (sweeps in §6).
3. **A learned model clears most targets.** Magenta's E-GMD model meets velocity (8.3 ≤ 12) and
   toms (94 ≥ 60), and beats DSP on every class except kick. Even it misses **kick/snare ≥ 85,
   cymbals ≥ 60, simultaneous ≥ 70 and ghost ≥ 65.** Those targets are ambitious for the current
   state of the art, not just for this app.

**Baseline caveats.** Magenta O&F was run here through its own graph code (`model_tpu.build_model`)
on TF 2.21 with the tf-keras shim, using its default thresholds (onset 0.5) and our preprocessing of
its hparams (mel, 250 bins, hop 512, 44.1 kHz). Its numbers are a lower bound on what it can
do. E-GMD's test split is O&F's own test split; its validation split (our dev) may have been used
for its model selection. It is a TF1 checkpoint with bidirectional LSTMs: a **baseline, not yet a
shippable model** until it is converted and measured on WASM (§7). Reproduce with
`scripts/oaf_drums_baseline.py` (instructions in its header).

---

## 5. ADTOF baseline — owner decision needed

§5 makes an ADTOF comparison mandatory. ADTOF's code, weights and data are **CC BY-NC-SA 4.0**
(read from `MZehren/ADTOF/LICENSE`). Under the owner's existing rule ("no non-commercial licence
anywhere, not even as a teacher"), it was **not run**. Two options:

- **(a) Allow ADTOF as a dev-time measurement only**: run once, never shipped, never trained
  against, never distilled. This is a narrower use than the rule covers; it's the owner's call.
- **(b) Replace the ADTOF requirement with Magenta O&F drums** (Apache-2.0 repository, E-GMD-trained,
  SOTA-class, with velocity), already measured above. **Recommended**: it is the stronger
  comparison for this app anyway, because it is also a candidate to ship.

Before anything ships, confirm the O&F *checkpoint's* own terms (the repository is Apache-2.0;
the checkpoint is distributed from Magenta's bucket alongside it).

---

## 6. The frozen interface (§4) — `transcribeDrumEvents`

```js
transcribeDrumEvents(samples, sampleRate, opts) → {
  events: [{ t_raw, t_quantized, bar, beat, slot, drum_class, velocity, confidence,
             is_ghost, grid_confidence, piece }],
  flags:  [{ start, end, flag: "low_onset_confidence", suppressed }],
  beats, bpm, beatsPerBar, subdivisions, slotsPerBar, gridFit, timeline, method }
```

- `drum_class` ∈ `DRUM_CLASSES` = `kick | snare | hihat | tom | cymbal | crash | ride`; `piece`
  keeps the finer name (`openHat`, `tomLow`, …) for GM MIDI and noteheads.
- **Renderable without inference:** `DRUM_NOTATION[drum_class]` gives the staff line, notehead
  (`normal` / `x`), stem direction and GM note for every class (unit-tested for all 7).
- `bar` (1-based), `slot` (sixteenth in the bar), `beat` = 1 + slot / 4 (2.5 = the "&" of 2),
  `t_quantized` = the slot's time on the grid. That is Tier 2 "Lead Sheet Standard"; `t_raw` is
  Tier 1 "Acoustic Literal", mirroring the harmonic pipeline.
- **Grid:** the caller's (`opts.beats` / `opts.timeline`: another stem of the same song, so all
  charts share one grid) or tracked on this audio with `detectBeats` → `audioBeatTimeline` (the
  Muscriptor-ported grid: regularised beats, tempo map, bar 1 at the first hit). `opts.timing`
  takes the user's Tempo & bars corrections (×2/÷2, bar 1 here).
- `grid_confidence` = closeness to the slot (1 on it, 0 half a slot off) × the grid's fit (share of
  onsets within a quarter slot). A swung or drifting take scores low.
- **§3.1 failure mode:** a stretch of ≥ 2 s where every onset's confidence is < 0.25 is reported as
  `low_onset_confidence` and its events are dropped (`suppressLow:false` keeps them). A silence
  is not low confidence: the stretch is measured over the weak onsets themselves.
- **Ghost notes (§3.4):** snare-only "soft" candidates between 0.15 and 0.4 of the local loudest
  rise are kept (`softFloor`, `softTypes`), except where they coincide with a full-strength hit of
  another piece (that is its leakage: a hat lends the snare a faint rise on every off-beat).
  `is_ghost` = snare velocity ≤ 0.6 × the median of the non-soft snares within ±2 s.
- **The model seam:** `opts.hits` (`[{ t, type, strength, local? }]`) replaces the NMF, so a
  Phase 1 model only has to emit hits; quantisation, velocity fallback, ghost flag, flags and
  notation don't change. `method` says which ran.
- `transcribeDrums` without `softFloor` is **byte-identical** to before (tested), so the stems
  charts, MIDI/MusicXML/tab exporters and the workbench suite are untouched.
- `optional_symbolic_sidecar` (§4 input) is **not built**: the score↔recording link
  (`linkScoreToAudio`) is the place for it. It already aligns a GP/MusicXML file to the
  recording, and GP drum tracks are now flagged. That is Phase 4.

Sweeps behind the defaults (dev split only): `softFloor` 0.39 / 0.25 / 0.15 / 0.10 → snare F 73.1 /
77.5 / 77.0 / 75.5 and ghost recall 4 / 10 / 25 / 43, but applied to every piece it costs the kick
10 points (78 → 67), hence snare-only. The leakage rule then took snare 77.8 → 81.3.
`ghostRatio` 0.6 / 0.75 / 0.85 → flag precision 6 / 4 / 4 %: the NMF rise doesn't carry ghost
information. Test-split numbers were run once, after the defaults were fixed.

---

## 7. §8 answers and the Phase 1 recommendation

**§8.1 Phase 0 sign-off.** Delivered here: the interface (§6), the harness (§3, equal to
mir_eval), baselines on held-out real drums (§4). The 10-track in-house set is still missing (§8.2).

**§8.2 Annotation resources.** Still needed. Two refinements: record the 10 tracks **as stems**
(drums isolated *and* in the mix), since the app's real input is a SCNet drums stem; and annotate
in a DAW on a MIDI lane with velocities, so `adt.mjs --variant file` can score them unchanged.

**§8.3 Deployment target.** There is no plugin path. The app is a zero-server, client-side page
on GitHub Pages, iOS Safari first. So it is effectively the **"CPU-only, on-device"** target, but
offline (a file, not a live stream): WASM single-threaded (no COOP/COEP on Pages), memory-bounded
on phones (the separator already taught that lesson). **Separate-and-detect is not a contingency
to add, it is already the pipeline**: SCNet runs on device and hands the drums stem to the
transcriber. The §3.3 go/no-go is therefore "transcriber on the SCNet drums stem" vs "transcriber
on the mix", and that comparison needs the in-house stems.

**§8.4 Phase 1 recommendation.** Two learned candidates, both measurable with this harness the day they exist:

1. **Port Magenta O&F drums to ONNX** (TF graph → tf2onnx → weight-only int8, ORT 1.23.2 plain
   WASM, the same rails as the guitar CRNN). Its BiLSTMs are the risk on WASM speed. Measured
   accuracy is above. Cheapest path to toms, cymbals and velocity.
2. **Train our own small CRNN on E-GMD** (CC BY 4.0, 444 h; ADTOF-style multi-hot onset heads +
   a velocity head, as §3.2–3.4 describe). More work, but the result is ours, sized for a phone,
   and can be trained with SCNet-separated mixes as augmentation (§3.3's real input).

Either one plugs into `opts.hits` + a velocity field; the interface does not change.

**Targets to revisit (§5):** kick/snare ≥ 85, cymbals ≥ 60, simultaneous ≥ 70 and ghost-note recall
≥ 65 are all missed by the SOTA-class baseline on E-GMD. Recommend keeping them as stretch goals
and setting the release gate at "at least the O&F baseline on E-GMD test" plus the professional
drummer review.

**Risks the work order didn't list:** (1) synthetic-only validation misled WO-5; every future
drum claim needs the E-GMD numbers next to it. (2) E-GMD is one e-kit's sensor data rendered
through samples: no room, no bleed, no mic cross-talk. A real acoustic recording through SCNet
will score lower; only the in-house set can measure that.

---

## 8. Phase 1, option 1 — Magenta O&F drums in the app (2026-11-09, built)

The owner chose option 1 ("convert the Magenta model for the time being"). It ships as the drum
reader of the stems panel.

**Licence.** The E-GMD checkpoint is published in the README of `magenta/magenta`, which is
Apache-2.0, and carries no separate terms. Its training data, E-GMD, is CC BY 4.0. Attribution and
the Apache text: `models/oaf-drums/NOTICE`.

**Conversion** (`scripts/oaf_drums_export.py`):
1. Build the inference graph from Magenta's own code (`model_tpu.build_model`).
2. Freeze it with only the **onset and velocity heads**. The frame and offset networks, and the unused
   `length` input, fall away.
3. Convert with tf2onnx (opset 17). This needed TF1 control flow (`disable_control_flow_v2`): TF 2.21's
   TensorList while-loops don't load in ONNX Runtime, while the TF1 loops become ONNX `Scan` ops.
4. **fp32 ONNX matches TensorFlow to 5e-6** (onset probability) and 2e-6 (velocity). The file is 4.9 MB.

A weight-only int8 copy (1.8 MB) was measured and **not shipped**: test class F 75.9 vs 76.2, and
cymbals 51.8 vs 53.8. Saving 3 MB is not worth that.

**Engine (pure, `engine.tsx`):**
- `oafDrumLogMel` / `oafDrumInput`: the model's input, **equal to librosa to 5e-4 dB** (fixture
  `tests/fixtures/oaf-drums-logmel.json`).
- `oafDrumWindows`: 14 s cores with 2 s of context per side.
- `oafDrumHits`: rising edges of the onset probability > 0.5, the run's peak as confidence, the
  model's velocity × 127.
- `transcribeDrumsWithModel(samples, sr, run, opts)`: the whole path, ending in the Phase 0
  interface (`opts.hits`). `method: "oaf-drums"`.
- The model's 8-hit map has **one tom class and one hi-hat class**. They are written as the mid tom
  and the closed hat, rows every drum exporter already draws.
- The drum MIDI writers now carry a hit's measured `velocity` (absent → the old fixed velocity,
  so existing exports are unchanged).

**Glue** (`drum-model.js` → `drum-worker.js` → `drum-model-core.js`): the guitar CRNN's rails.
- Pinned ONNX Runtime Web 1.23.2 plain WASM, one thread, `capWasmMemory`.
- Cache API + SHA-256 check, a bad cached copy evicted.
- A module worker, ended after each job. The main thread is used only when no Worker can be built;
  a failed worker run is not retried there.
- Lazy: nothing downloads until a drums stem is charted. `pages.yml` ships the files and stamps
  `drum-model.js?v=`.

**UI.** The stems panel charts the stems as before, then re-reads the drums stem with the model
(**🥁 drum model**, on by default, remembered per device as `ttp:drumModel`). If the model can't
run, the built-in reading stays and a note says why. With the model on, the full-kit toggle is
hidden (it measured worse on real drums). The legend states the measured accuracy.

### Measured

E-GMD **test** split, 30 held-out tracks, 5 classes, ±50 ms. Same harness as §4.

| | class F | kick | snare | hihat | tom | cymbal | simult. R | vel MAE | ghost R |
|---|---|---|---|---|---|---|---|---|---|
| built-in (`transcribeDrumEvents`, NMF) | 68.3 | 82.0 | 74.9 | 68.6 | 0 | 0 | 65.3 | 19.1 | 15.3 |
| **drum model in the app (fp32 ONNX, JS features, 14 s windows)** | **76.2** | 78.3 | 78.3 | 77.7 | **94.3** | **53.8** | 61.0 | **8.2** | 26.3 |
| TensorFlow original (§4) | 76.3 | 78.2 | 78.4 | 77.6 | 94.3 | 54.3 | 61.1 | 8.3 | 26.3 |

- **Same model, same numbers.** The app's path reproduces the TensorFlow model on the dev split
  exactly (class F 82.8 vs 82.8).
- **Windowing is free.** Dev class F: whole file 82.8 · 2400 frames 82.8 · 1200 82.8 · 600 82.6.
- **Ghost flag.** Its accent reference is the median of nearby snares; the upper quartile flagged 3×
  more accents on dev. Flag recall / precision on test: 19 / 31 %.
- **Kick is the one class the model reads worse than the built-in detector** (78.3 vs 82.0).
  Both trail the §5 kick target.

**Speed and memory (Node, onnxruntime-web 1.23.2 WASM, one thread, 4-core container).**
- 0.052× real time end to end: about 12 s for a 4-minute song.
- One 18 s window takes 0.64 s. The process grows by ~330 MB, and the window length barely
  changes that (9 s window: 307 MB). It is mostly the WASM runtime.
- Real app (headless Chromium, `tests/bench/drum-model-e2e.mjs`): a 40 s held-out take was charted
  and read in ~5 s.
  - Only the three ORT 1.23.2 files and the same-origin glue + model load.
  - The grid shows K · S · H · T2 · C, and the MIDI download carries 63 distinct velocities.
  - Toggling the model off brings back the built-in reading.
  - No console errors, also with an iPad Safari 16 user agent.

**Device check remaining:** a real iPhone / iPad (JavaScriptCore runs the WASM, the bench ran V8).

**Still open from the work order:** kick/snare ≥ 85, cymbals ≥ 60, simultaneous ≥ 70 and ghost ≥ 65
are missed by this model too (§7). Closing them is option 2: a model of our own, trained on E-GMD
with SCNet-separated mixes as augmentation. The in-house stems set (§8.2) is still what will tell
how all of this does on a real acoustic recording through SCNet.
