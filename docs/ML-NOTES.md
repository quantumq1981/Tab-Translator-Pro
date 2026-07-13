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

## What remains (the device-only / hosted seam)

1. **Host the model.** Put the `basic-pitch` ONNX somewhere the app can fetch — the same
   GitHub Pages origin is simplest (same-origin, no CORS), or allow the host in the
   environment's network policy. (This sandbox's proxy blocks Hugging Face, so the model
   could not be fetched/validated here.)
2. **Wire the inference glue** — a browser-only function published as
   **`window.TTP_NOTE_MODEL(pcm, sampleRate, opts)`** that returns
   `{ onsets, frames, frameRate, minMidi }`:
   - load `onnxruntime-web` (WASM single-thread on Pages — no COOP/COEP; or WebGPU where
     available on iOS 18+),
   - compute basic-pitch's **harmonic-CQT input features** from the PCM,
   - run the ORT session → the onset/frame matrices.
   The **UI already calls it**: the Audio panel's **🎼 Voices (ML)** button runs
   `transcribeWithNoteModel(pcm, sr, window.TTP_NOTE_MODEL, …)` when the hook exists, else
   shows a "not configured" message.
3. **Device-test** — browser ONNX + iOS Safari is the seam only hardware can confirm (same
   category as the PDF.js / Web Audio seams).

Everything downstream of the model (decode → notes → score → chart/export) is done and
guarded by `npm test`, so finishing is: host the model + write the `window.TTP_NOTE_MODEL`
inference function + smoke-test on device.
