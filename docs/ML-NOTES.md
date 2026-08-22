# Per-voice note transcription — the ML path (basic-pitch)

## Why this exists

For **scoring vocal harmony parts** we want the *actual sung notes* (three voice lines),
not a chord label. `transcribeChords` gives a chord symbol; that's the wrong shape and it
over-labels dense harmony (fixed separately by **Simple mode** / `maxRank`).

## Pure-JS was tried and does NOT work on dense vocal harmony

Multi-F0 (polyphonic pitch) and predominant-melody extraction were both prototyped
extensively against a real isolated **3-part** backing-vocal stem ("25 or 6 to 4"):

- **Multi-F0** (harmonic-salience + iterative subtraction + temporal tracking + note
  grouping): recovers a clean triad on *some* sustained frames but just as often returns
  octave-spread pairs or semitone clusters, and fragments (98 columns for a 45 s chorus).
- **Melody** (predominant / top-voice tracking): on a **balanced** 3-voice stack there is
  no single dominant line — argmax jumps between voices, "highest" locks onto harmonics an
  octave high, octave-snap over-corrects an octave low.

**Conclusion (load-bearing — don't re-derive):** pure-JS DSP recovers pitch **classes**
reliably (which is exactly why chord recognition works), but **not octaves or voice
separation** on dense vocal harmony. The pure-JS ceiling for "identify the backing vocals"
is the **chord skeleton** (Simple mode). Note-level, per-voice transcription needs an ML
model. Do not spend more effort on a pure-JS multi-F0 transcriber.

## The model: Spotify `basic-pitch`

`basic-pitch` is a small (~a few MB) note-transcription model (audio → note events with
onsets), **not** a source separator — so the iOS/GitHub-Pages ONNX story is far more
winnable than a Demucs-class separator (166 MB). It's the right tool for this task.

## What's built here (the pure, tested half — drop-in ready)

`engine.tsx` (pure, headless-tested):

- **`notesFromActivations(onsets, frames, opts)`** — faithful basic-pitch note decode:
  each onset peak above `onsetThresh` starts a note, extended forward while the frame
  activation stays above `frameThresh`; sub-`minDurSec` blips dropped. → `[{ midi, startSec,
  durSec, amp }]`.
- **`polyNotesToScore(notes, opts)`** — note stacks → the shared score shape
  (`source:"ml"`), so the ML transcription flows through the chart, all 6 exporters,
  transpose, playback and the Pro handoff for free.
- **`transcribeWithNoteModel(pcm, sr, model, opts)`** — orchestrator: runs a pluggable
  `model` then decodes → `{ notes, score }`.

## What's wired (2026-08-22)

The model + browser glue are now shipped. The route is **TensorFlow.js**, not ONNX —
because Spotify already publishes a browser-ready wrapper (`@spotify/basic-pitch`) and its
own TF.js graph model, so we get the exact Spotify-blessed input preprocessing +
harmonic-CQT feature extraction for free, and skip re-porting ~200 lines of DSP. ONNX
would have meant writing that ourselves against `onnxruntime-web` — the same runtime, more
code we own, no functional win. Both paths hit the same iOS/Pages constraints (WASM
single-thread, no COOP/COEP), so this is the pragmatic call.

1. **Model files vendored SAME-ORIGIN** at `models/basic-pitch/` — `model.json` (~175 KB
   graph manifest) + `group1-shard1of1.bin` (~740 KB weights) = ~915 KB total, well under
   any iOS budget. Redistributed verbatim from `spotify/basic-pitch-ts` under Apache 2.0
   (code) + CC-BY 4.0 (weights); NOTICE file sits next to the weights. Same-origin means:
   no CORS, no third-party CDN cache misses, and a Service Worker can cache it for offline
   (Wave-1 #5).
2. **Inference glue** — `note-model.js` (browser-only, plain ES module — no Babel
   transpile step). Loads `@spotify/basic-pitch` + `@tensorflow/tfjs@3.21.0` from esm.sh
   **lazily** on the FIRST `🎼 Voices (ML)` tap (deferred + cached; boot never pays for
   it), then loads the vendored model and publishes `window.TTP_NOTE_MODEL(pcm, sr, opts)`
   → `{ onsets, frames, frameRate: 86.13, minMidi: 21 }` — exactly the contract
   `notesFromActivations` expects. Init errors clear the cache so a retry can actually
   retry. Resamples the app's 16 kHz analysis buffer to basic-pitch's fixed 22050 with
   linear interpolation (safe here: all fundamentals up to C8 = 4186 Hz sit well below
   the 16 kHz Nyquist).
3. **Deploy** — `pages.yml` copies `note-model.js` + `models/basic-pitch/` alongside the
   existing three files. `npm test` guards the whole thing statically: model files exist,
   `model.json` is a valid TF.js graph manifest referencing its weights shard,
   `note-model.js` publishes `window.TTP_NOTE_MODEL` as a function that returns the right
   shape, the shim is lazy + try/catch-wrapped + fail-silent, and the loader wires it in.

## What still needs a real device

Everything above passes `npm test`, but three things only real hardware can prove:

- **First-tap load time on iOS Safari.** ~1.5 MB from esm.sh + ~915 KB same-origin — on
  4G that's a few seconds; on WiFi ~1 s. Second tap should be instant (esm.sh + tf.io
  cached, model in memory).
- **Inference quality on real vocal harmony.** The decode + note-grouping is faithful to
  basic-pitch's paper, but real 3-part backing vocals are what this was built for — score
  a known song and eyeball the result. If the notes look right in pitch but sit at wrong
  octaves, or lots of ghost onsets, the `notesFromActivations` thresholds
  (`onsetThresh` 0.5, `frameThresh` 0.3, `minDurSec` 0.12) are the tuning knobs and are
  already `opts`-overridable.
- **iOS memory.** tfjs's WASM backend allocates a big arena; on iPhone SE-class devices
  this can OOM on very long stems. The first fallback is to resample to a shorter chunk;
  a real fix is chunked inference (basic-pitch's own loop, which we already benefit from
  since we're using the library, not raw ORT).

If quality is disappointing, the first thing to try is running the note model at the
ORIGINAL sample rate from `onFile` (currently we take the 16 kHz analysis buffer). That's
a one-line change in `TabDecoderPro.tsx voices()` — pass `s.audioBuf.getChannelData(0)` +
`s.audioBuf.sampleRate` instead of `s.cur` + `s.sr`.
