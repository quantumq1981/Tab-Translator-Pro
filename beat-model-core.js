/* ==========================================================================
 * beat-model-core.js — runs beat_this (Foscarin et al., ISMIR 2024; CPJKU, MIT), the
 * learned beat + DOWNBEAT tracker Muscriptor v0.4 builds its bar lines on. Browser-only
 * glue; the spectrogram, windowing, aggregation and peak picking are the pure engine's
 * (`trackBeatsWithModel` + `beatThisLogMel` …), held headlessly to beat_this's own.
 *
 * Model: the official final0 checkpoint (SHA-256 8c328b45…8331, two independent HF
 * re-uploads byte-identical), converted with scripts/beatthis_export.py: fp32 ONNX with a
 * dynamic time axis (matches PyTorch to 2e-6 at 1500, 1129 and 64 frames) → weight-only
 * int8 (per-channel, DequantizeLinear; activations fp32) = 22.5 MB, same-origin,
 * SHA-256 pinned, Cache-API cached. Input: log-mel [1, frames ≤ 1500, 128];
 * output: beat and downbeat logits [1, frames].
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
  sha256: "3db6008b626c18ecbbb452e413bcda8b833645fcddcf6f3f0f8a0e882dba2981",
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
export async function beatSession(bytes, ortImport = (u) => import(/* @vite-ignore */ u)) {
  const { ORT_WASM_PATHS, capWasmMemory } = await stemCore();
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

/* The whole job: resample to 22.05 kHz (the engine's anti-aliased resampleTo) → weights →
 * session → engine.trackBeatsWithModel → { beats, downbeats }. */
export async function trackBeatsPcm(pcm, sampleRate, engine, opts = {}) {
  if (!pcm || !pcm.length) throw new Error("no audio to track");
  const x = sampleRate === BEAT_MODEL.sampleRate ? pcm : engine.resampleTo(pcm, sampleRate, BEAT_MODEL.sampleRate);
  const bytes = await beatModelBytes();
  const sess = await beatSession(bytes);
  try {
    return await engine.trackBeatsWithModel(x, (w) => sess.run(w), { onProgress: opts.onProgress });
  } finally { sess.release(); }
}
