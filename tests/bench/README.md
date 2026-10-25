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
node bench/stems.mjs        # mix vs separated stems (+ leakage, bass fusion) and drum F-measure
node bench/ambig.mjs test   # where the right answer sits for uncertain chords (Auto's ceiling)
node bench/vocab.mjs clean --opts '{"vocabulary":"chart"}' --real   # what names a vocabulary writes (corpus + the repo's real audio)
node bench/vocabdiff.mjs '{"vocabulary":"chart"}' clean dev        # where a vocabulary gains/loses root vs full
node bench/run.mjs --split test --variants v2,v2chart --gtvocab chart --resample sinc   # score at the vocabulary level
node bench/vocab-e2e.mjs --deps <dir> --audio <wav>                 # the Pro/Basic/Full picker in the real app (audio)
node bench/vocab-e2e.mjs --deps <dir> --gp "Steely Dan - Peg.gp4"   # …and the ChartPanel picker re-naming a file import
node bench/fingering.mjs    # Stage 3: re-finger the GP corpus, % of notes on the written string
```

The audio → TAB benches (fingering, GuitarSet, techniques, guitar end-to-end) are described at
the end of this file.

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

## `scnet-e2e.mjs` — the real separator in the real app

Runs the actual app in headless Chromium with the real vendor bundle, stem worker and SCNet
weights (no stubs), on a mix summed from known rendered stems. It reports separator wall time,
peak memory (summed PSS of all Chromium processes), SDR for each stem, and chart accuracy from the
separated stems vs perfect stems vs the mix decoded directly.

Needs network access to `huggingface.co` **and `us.aws.cdn.hf.co`** (the weights redirect to
HF's Xet CDN) plus `cdn.jsdelivr.net` (ONNX Runtime Web). The boot CDNs (esm.sh React, unpkg
Babel) are served locally from `--deps`:

```sh
D=$(mktemp -d) && cd $D && npm init -y >/dev/null && npm i react@18.3.1 react-dom@18.3.1 @babel/standalone@7.25.6 esbuild
cat > all-entry.js <<'JS'
import * as R0 from "react"; import * as C0 from "react-dom/client";
const R = R0.default || R0, C = C0.default || C0;
export const React = R; export const createRoot = C.createRoot, hydrateRoot = C.hydrateRoot;
export const { Children, Component, Fragment, Profiler, PureComponent, StrictMode, Suspense, cloneElement, createContext, createElement, createRef, forwardRef, isValidElement, lazy, memo, startTransition, useCallback, useContext, useDebugValue, useDeferredValue, useEffect, useId, useImperativeHandle, useInsertionEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, useTransition, version } = R;
JS
npx esbuild all-entry.js --bundle --format=esm --minify --define:process.env.NODE_ENV='"production"' --outfile=out/all.mjs
cp node_modules/@babel/standalone/babel.min.js out/
cd -  # back to tests/
node bench/scnet-e2e.mjs --deps $D/out --tracks 3 --sec 40 --playwright /opt/node-tools/node_modules/playwright
```

React and react-dom are bundled into one module so the page gets a single React instance.

Device emulation: `--compact 1` starts with Low-memory mode on; `--ua "<user agent>"` makes the page
(and its workers) report a device's user agent, e.g. an iPad's desktop-class Safari UA, so the WebKit
routing runs as it does there (V8 still executes the WASM — this checks the app's choices and the
pinned runtime, not JavaScriptCore); `--stamp <v>` serves `index.html` the way `pages.yml` deploys it
(`stem-model.js?v=<v>`). The run logs which separator files were served (with their stamp) and which
ONNX Runtime files were fetched.

## `ort-pin.mjs` — the pinned ONNX Runtime separates exactly like the bundle's

Every WASM session runs ONNX Runtime Web 1.23.2 (ORT ≥ 1.24's Abseil is miscompiled by Safari's
JavaScriptCore — `stem-model-core.js`, RUNTIME). This checks the pin costs nothing: the same SCNet
session on 1.30.0 and 1.23.2, bit for bit, plus create/run time and peak RSS.

```sh
A=$(mktemp -d) && (cd $A && npm init -y >/dev/null && npm i onnxruntime-web@1.30.0)
B=$(mktemp -d) && (cd $B && npm init -y >/dev/null && npm i onnxruntime-web@1.23.2)
curl -L -o /tmp/scnet.int8.onnx https://huggingface.co/audiojs/scnet/resolve/e71bcdb42bce1d62b7fae25ba90fcbcf90f73f46/scnet.int8.onnx
node bench/ort-pin.mjs --a $A --b $B --full /tmp/scnet.int8.onnx     # exits non-zero unless bit-identical
```

Charts are scored per song (the songs have different tempi). The run directory keeps the separated
and reference stems as WAVs plus `run.json`, so `--reuse <run dir>` re-scores them in seconds without
the ~10-minute browser run; `--chart-opts '{"bassFusion":true}'` passes options to `chartsFromStems`.
The bass stem uses `lib.mjs`'s `bassNote` voice — a guitar pluck an octave down has almost no
fundamental, and a separator correctly calls it "other". Measured results are in CLAUDE.md (v2.1 →
"First REAL run").

## Audio → TAB benches (`docs/AUDIO-TO-TAB-PLAN.md`)

**Splits are the same rule everywhere:** Guitar Pro files by index (even = dev, odd = test) and
GuitarSet by player (0–2 = dev, 3–5 = test). Tune only on dev.

### `fingering.mjs` — Stage 3 against written fingerings

Strips the string/fret from every standard-tuned 6-string GP track (569 tracks, 94,890
fretted notes), re-fingers the pitches with `fingerSequence`, and counts the notes that land on
the written string.

```sh
node bench/fingering.mjs                              # shipped defaults, both splits
node bench/fingering.mjs --gs /tmp/gs_ex              # + GuitarSet (scripts/guitarset_extract.py output)
node bench/fingering.mjs --gs /tmp/gs_ex --no-prior   # cost model only
node bench/fingering.mjs --gs /tmp/gs_ex --with-prior --prior-from gp --prior-parts cell,move   # zero-shot on GuitarSet
node bench/fingering.mjs --gs /tmp/gs_ex --sweep      # coordinate search on the DEV halves
node bench/fingering.mjs --gs /tmp/gs_ex --learn-prior --prior-parts cell,move   # regenerate FINGER_PRIOR
```

### `guitarset.mjs` — real recorded guitar, with the string annotated

GuitarSet (CC-BY 4.0, hexaphonic pickup → every note's string). Get it with
`HF_HUB_DISABLE_XET=1 hf download jhartquist/guitarset --repo-type dataset --local-dir /tmp/gs`
(the Xet CAS host is not on this environment's allowlist; the flag falls back to plain HTTP),
then `python scripts/guitarset_extract.py /tmp/gs /tmp/gs_ex`.

```sh
node bench/guitarset.mjs /tmp/gs_ex                       # oracle MIDI → fingering → string accuracy
python scripts/guitarset_infer.py <pti> <model.onnx> /tmp/gs_ex /tmp/pred [--noise-db 20]
node bench/guitarset.mjs /tmp/gs_ex /tmp/pred             # end to end: note F1 + Tab F1 (onset ±50 ms, pitch, string)
```

`guitarset_infer.py` runs the CRNN in onnxruntime with the reference Python post-processor
(`<pti>` = a checkout of xavriley/piano_transcription_inference) and scores note F1 with
mir_eval. Some GuitarSet annotations start a few ms before 0 s; the script clamps them, because
mir_eval rejects negative interval times.

### `techniques.mjs` — technique capture vs PyGuitarPro

```sh
python scripts/pgp_techniques.py .. /tmp/pgp_tech.json    # from tests/, needs pyguitarpro
node bench/techniques.mjs /tmp/pgp_tech.json
```

### `guitar-e2e.mjs` — 🎸 Guitar → Tab in the real app

The actual app in headless Chromium, with the real guitar worker, the 25 MB model and ONNX
Runtime Web 1.23.2 from jsDelivr (no stubs). It uploads a GuitarSet recording, presses the
button, samples peak memory, records which ORT files were fetched, opens the AlphaTex export,
parses it with alphaTab, and scores the notes against the annotation. `--deps` is the same React
and Babel bundle as in `scnet-e2e.mjs`.

```sh
node bench/guitar-e2e.mjs --deps $D/out --gs /tmp/gs_ex --track 00_BN1-129-Eb_comp [--ua "<iPad UA>"]
```

### `tab-view-e2e.mjs` — the Tab view in the real app

The real app, the real vendored alphaTab (worker, worklet, font, sound font), no stubs. It opens a
Guitar Pro file in MusicXML / GP mode, switches to the Tab view, waits for the bar count, presses ▶ Play
and checks the clock moves, then uploads a saved `.alphatex` and switches to "Tab only". It saves
screenshots and lists which alphaTab files loaded and any failed requests.

```sh
node bench/tab-view-e2e.mjs --deps $D/out [--gp blue-sky.gp] [--tex saved.alphatex] [--ua "<UA>"] [--width 390 --height 844] [--out <dir>]
```
