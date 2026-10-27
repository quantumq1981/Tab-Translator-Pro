/* ==========================================================================
 * beat-model-core.js — runs beat_this (Foscarin et al., ISMIR 2024; CPJKU, MIT), the
 * learned beat + DOWNBEAT tracker Muscriptor v0.4 builds its bar lines on. Browser-only
 * glue; the spectrogram, windowing, aggregation and peak picking are the pure engine's
 * (`trackBeatsWithModel` + `beatThisLogMel` …), held headlessly to beat_this's own.
 *
 * Model: the official final0 checkpoint (SHA-256 8c328b45…8331, two independent HF
 * re-uploads byte-identical), converted with scripts/beatthis_export.py: fp32 ONNX with a
 * dynamic time axis (matches PyTorch to 2e-6 at 1500, 1129 and 64 frames) → weight-only
 * int8 (per-channel, DequantizeLinear; activations fp32) = 24.1 MB, same-origin,
 * SHA-256 pinned, Cache-API cached. Input: log-mel [1, frames ≤ 1500, 128];
 * output: beat and downbeat logits [1, frames]. Its time attention is computed one (batch ×
 * head) slice at a time (beatthis_export.py step 0): one 30 s window needs ~500 MB of WASM memory
 * instead of ~1 GB, with the same logits — the full window keeps the accuracy (shorter windows cost
 * 6–8 beat-F points on GuitarSet solos).
 *
 * Runtime: the SAME pinned ONNX Runtime Web build and iOS rails as the stem separator and
 * the guitar CRNN (imported from stem-model-core.js): plain WASM 1.23.2 (ORT ≥ 1.24 breaks
 * on JavaScriptCore, microsoft/onnxruntime#33426), single thread, the WASM-reservation cap.
 * ========================================================================== */
const BUILD_QS = (() => { try { return new URL(import.meta.url).search; } catch (_) { return ""; } })();
const STEM_CORE_URL = new URL("./stem-model-core.js" + BUILD_QS, import.meta.url).href;
let _stemCore = null;
const stemCore = () => _stemCore || (_stemCore = import(/* @vite-ignore */ STEM_CORE_URL).catch((e) => { _stemCore = null; throw e; }));

export const BEAT_MODEL = {
  url: new URL("./models/beat-this/beat_this_final0.w8.onnx", import.meta.url).href,
  sha256: "b3288b0eaac973763ee3fe06e7907630b5c00fee2276e299b991f55e90271892",
  sampleRate: 22050,
  mels: 128,
};

/* Weights: Cache API first, else a fetch; the bytes must match the pinned SHA-256 either way
 * (a partial download or a stale file is refused, and a bad cached copy is evicted). */
export async function beatModelBytes(model = BEAT_MODEL, scope = globalThis) {
  const { sha256Hex } = await stemCore();
  let cache = null;
  try { cache = scope.caches ? await scope.caches.open("ttp-models") : null; } catch (_) { cache = null; }
  const key = `${model.url}#${model.sha256}`;
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) {
        const b = new Uint8Array(await hit.arrayBuffer());
        if (await sha256Hex(b) === model.sha256) return b;
        await cache.delete(key);
      }
    } catch (_) { /* fall through to the network */ }
  }
  const res = await scope.fetch(model.url);
  if (!res.ok) throw new Error(`could not download the beat model (HTTP ${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const got = await sha256Hex(bytes);
  if (got !== model.sha256) throw new Error(`the beat model failed its integrity check (SHA-256 ${got.slice(0, 12)}…, expected ${model.sha256.slice(0, 12)}…) — reload and try again`);
  if (cache) { try { await cache.put(key, new Response(bytes)); } catch (_) { /* quota: fine, just not cached */ } }
  return bytes;
}

/* One session for the whole recording. Returns `run(window) → { beat, downbeat }` — exactly
 * the per-window model contract the engine's `trackBeatsWithModel` takes. */
export async function beatSession(bytes, ortImport = (u) => import(/* @vite-ignore */ u), onRuntime) {
  const { ORT_WASM_PATHS, capWasmMemory } = await stemCore();
  if (onRuntime) onRuntime();
  capWasmMemory();
  const mod = await ortImport(ORT_WASM_PATHS + "ort.wasm.min.mjs");
  const ort = mod.default || mod;
  if (ort.env && ort.env.wasm) { ort.env.wasm.wasmPaths = ORT_WASM_PATHS; ort.env.wasm.numThreads = 1; }
  const s = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], enableCpuMemArena: false, enableMemPattern: false });
  const inName = s.inputNames[0];
  return {
    async run(win) {
      const r = await s.run({ [inName]: new ort.Tensor("float32", win.data, [1, win.frames, BEAT_MODEL.mels]) });
      return { beat: Float32Array.from(r.beat.data), downbeat: Float32Array.from(r.downbeat.data) };
    },
    release() { try { const p = s.release && s.release(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* already gone */ } },
  };
}

/* The spectrogram, built in its own call so nothing in the long-running job below keeps the audio:
 * `job.pcm` is taken and cleared, and the original-rate and 22.05 kHz copies are garbage once this
 * returns — before the model is downloaded and ONNX Runtime starts (the phone's peak). */
export function beatSpecOf(job, engine) {
  let x = job.pcm;
  job.pcm = null;
  if (!x || !x.length) throw new Error("no audio to track");
  if (job.sampleRate !== BEAT_MODEL.sampleRate) x = engine.resampleTo(x, job.sampleRate, BEAT_MODEL.sampleRate);
  return engine.beatThisLogMel(x);
}

/* The whole job: { pcm, sampleRate } → resample to 22.05 kHz (the engine's anti-aliased resampleTo) →
 * log-mel → (audio released) → weights → session → engine.trackBeatsFromSpec → { beats, downbeats }.
 * `opts.onStage(stage)`: "spectrogram" → "model" → "runtime" → "tracking". */
export async function trackBeatsJob(job, engine, opts = {}) {
  const stage = (s) => { try { if (opts.onStage) opts.onStage(s); } catch (_) { /* never break the job */ } };
  stage("spectrogram");
  const spec = beatSpecOf(job, engine);
  stage("model");
  // the weights go straight into ONNX Runtime (which keeps its own copy): no variable here holds them
  const sess = await beatSession(await beatModelBytes(), undefined, () => stage("runtime"));
  stage("tracking");
  try {
    return await engine.trackBeatsFromSpec(spec, (w) => sess.run(w), { onProgress: opts.onProgress });
  } finally { sess.release(); }
}

/* Kept for callers that hold their own copy of the audio (benches): same job, same result. */
export async function trackBeatsPcm(pcm, sampleRate, engine, opts = {}) {
  if (!pcm || !pcm.length) throw new Error("no audio to track");
  return trackBeatsJob({ pcm, sampleRate }, engine, opts);
}
