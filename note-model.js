/* ==========================================================================
 * note-model.js — browser-only glue that publishes window.TTP_NOTE_MODEL.
 *
 * Wraps Spotify's basic-pitch (a small ~1 MB note-transcription model) so
 * engine.tsx's transcribeWithNoteModel(pcm, sr, window.TTP_NOTE_MODEL, …)
 * has an inference function to call — the last piece of Wave-3 #10/11
 * per-voice note transcription.
 *
 *   • basic-pitch-ts + @tensorflow/tfjs load from esm.sh on first Voices (ML)
 *     tap (same CDN pattern as React on esm.sh, PDF.js on cdnjs). Deferred +
 *     cached: boot never pays for it; second click is instant.
 *   • model weights are vendored SAME-ORIGIN at ./models/basic-pitch/ so no
 *     CORS, no third-party CDN cache misses, and a Service Worker can cache
 *     them for offline (Wave-1 #5). Total ~900 KB, well within iOS budgets.
 *
 * Contract expected by engine.tsx notesFromActivations:
 *   window.TTP_NOTE_MODEL(pcm, sampleRate, opts) →
 *     { onsets: T×88, frames: T×88, frameRate: 86.13, minMidi: 21 }
 *
 * FAIL-SILENT: any error (offline, esm.sh down, model 404, tfjs runtime) is
 * caught and re-thrown from window.TTP_NOTE_MODEL so the UI's existing
 * "not configured / failed" error message stays honest instead of pretending.
 * The hook itself is only INSTALLED when it can reasonably work (this module
 * loaded at all) — its call may still throw, and the UI already handles that.
 *
 * DEVICE-ONLY seam (same category as PDF.js, Web Audio, mic capture): the
 * engine + decode path are pure and headless-tested; this file cannot be
 * exercised by Node tests (browser AudioContext / tf.signal.frame). npm test
 * only asserts its contracts (URL, feature-detect, try/catch, deploy list).
 * Smoke-test on real hardware after any change here.
 * ========================================================================== */

/* Version pins — basic-pitch declares @tensorflow/tfjs ^3.2.0 so the tfjs 3.x
 * line is the compatible one; explicit pins keep the CDN response reproducible
 * across deploys (unpinned esm.sh URLs float). */
const TFJS_URL = "https://esm.sh/@tensorflow/tfjs@3.21.0";
const BASIC_PITCH_URL = "https://esm.sh/@spotify/basic-pitch@1.0.1?deps=@tensorflow/tfjs@3.21.0";

/* Vendored graph model. Resolved relative to THIS file's URL so it works
 * identically from the repo root, from a subpath, or from a preview deploy. */
const MODEL_URL = new URL("./models/basic-pitch/model.json", import.meta.url).href;

/* Basic-pitch's fixed audio contract (not knobs — see model.json signature).
 * 22050 mono PCM → outputs 172 frames per 2 s window = 22050/256 ≈ 86.13 fps
 * over 88 pitches from A0 (MIDI 21) to C8 (MIDI 108). */
const BP_SAMPLE_RATE = 22050;
const BP_FRAME_RATE = 22050 / 256;                                // 86.1328125
const BP_MIN_MIDI = 21;

let _ready = null;                                                // lazy-init promise (cached)

async function _initModel() {
  /* Load basic-pitch (which internally uses tfjs). esm.sh dedupes the shared
   * dep, so listing tfjs explicitly is belt-and-braces — it forces the same
   * version resolution basic-pitch was pinned against. */
  const [, bp] = await Promise.all([
    import(/* @vite-ignore */ TFJS_URL),
    import(/* @vite-ignore */ BASIC_PITCH_URL),
  ]);
  if (!bp || typeof bp.BasicPitch !== "function") {
    throw new Error("basic-pitch module did not expose BasicPitch");
  }
  /* Construct with a URL — the tf.io loader fetches model.json and follows
   * its weightsManifest to group1-shard1of1.bin in the SAME directory.
   * Warm-up (a zero-buffer inference) is deliberately skipped: the first
   * real click pays for it, which keeps boot free even on slow mobile. */
  return new bp.BasicPitch(MODEL_URL);
}

/* Linear resample to 22050. The app decode path downsamples to ~16 kHz
 * (`TARGET` in TabDecoderPro.tsx AudioImport) for chroma; basic-pitch needs
 * exactly 22050. Linear is the honest first pass — everything basic-pitch
 * looks at (fundamentals up to C8 = 4186 Hz) is well below 16 kHz Nyquist so
 * an upsample can't lose spectral content, and it avoids pulling a sinc
 * kernel dep. If quality is poor on real recordings, feed it the original
 * SR from onFile() instead of the pre-downsampled buffer. */
function _resample(pcm, srIn, srOut) {
  if (srIn === srOut) return pcm;
  const N = Math.max(1, Math.round((pcm.length * srOut) / srIn));
  const out = new Float32Array(N);
  const ratio = srIn / srOut;
  for (let i = 0; i < N; i++) {
    const src = i * ratio;
    const j = Math.floor(src);
    const frac = src - j;
    out[i] = j + 1 < pcm.length ? pcm[j] * (1 - frac) + pcm[j + 1] * frac : (pcm[j] || 0);
  }
  return out;
}

/* Basic-pitch's evaluateModel processes the audio in ~2 s WINDOWS and fires
 * onComplete ONCE PER WINDOW (not once at the end). Each call hands us that
 * window's frames/onsets — so a naive "framesOut = frames" only keeps the
 * LAST ~2 s of the whole song. Accumulate instead: concat every batch in
 * order so notesFromActivations sees the full timeline. Contours are for
 * pitch-bend / MIDI export and aren't needed for note events, so ignore. */
async function _evaluate(basicPitch, pcm22k) {
  const framesAll = [], onsetsAll = [];
  await basicPitch.evaluateModel(
    pcm22k,
    (frames, onsets /* , contours */) => {
      if (frames && frames.length) for (const row of frames) framesAll.push(row);
      if (onsets && onsets.length) for (const row of onsets) onsetsAll.push(row);
    },
    () => {},                                                     // progress: ignore for now
  );
  if (!framesAll.length || !onsetsAll.length) throw new Error("basic-pitch produced no output");
  return { frames: framesAll, onsets: onsetsAll };
}

/* The exported hook. Async by construction (loading + inference); it awaits
 * the cached initialization promise, so parallel calls share one download. */
async function TTP_NOTE_MODEL(pcm, sampleRate /* , opts */) {
  if (!pcm || !pcm.length) throw new Error("no audio");
  /* Cache init on SUCCESS only — if the first attempt fails (offline, esm.sh
   * hiccup, model 404) we clear the promise so a retry can actually try again
   * instead of latching a rejected cache. */
  if (!_ready) {
    _ready = _initModel().catch((e) => { _ready = null; throw e; });
  }
  const basicPitch = await _ready;
  const at22k = _resample(pcm, sampleRate, BP_SAMPLE_RATE);
  const { frames, onsets } = await _evaluate(basicPitch, at22k);
  return { onsets, frames, frameRate: BP_FRAME_RATE, minMidi: BP_MIN_MIDI };
}

/* Install the hook. Guarded so this file is a no-op in a non-window context
 * (import from Node harnesses etc.). */
try {
  if (typeof window !== "undefined") window.TTP_NOTE_MODEL = TTP_NOTE_MODEL;
} catch (_) { /* ignore — window inaccessible */ }
