/* ==========================================================================
 * drum-model-core.js — runs the drum transcription model (WPO-ADT-001 Phase 1).
 * Browser-only glue; the features, windowing, decoding and quantisation are the
 * pure engine's (`transcribeDrumsWithModel` → `oafDrumInput` / `oafDrumHits` /
 * `transcribeDrumEvents`), validated headlessly (tests/drum-model.mjs) and measured
 * on real drums (tests/bench/adt.mjs --variant onnx, E-GMD).
 *
 * Model: Magenta Onsets & Frames DRUMS, the E-GMD checkpoint (magenta/magenta,
 * Apache-2.0; trained on E-GMD, CC BY 4.0). Converted with scripts/oaf_drums_export.py:
 * fp32 ONNX matching TensorFlow to 5e-6, onset + velocity heads only, 4.9 MB, same-origin,
 * SHA-256 pinned, Cache-API cached. Input: [1, T, 250, 1] log-mel; output: two [1, T, 88].
 *
 * Runtime: the SAME pinned ONNX Runtime Web build and iOS rails as the stem separator
 * (imported from stem-model-core.js): plain WASM 1.23.2 (ORT ≥ 1.24 breaks on
 * JavaScriptCore, microsoft/onnxruntime#33426), single thread, the WASM-reservation cap.
 * ========================================================================== */
const BUILD_QS = (() => { try { return new URL(import.meta.url).search; } catch (_) { return ""; } })();
const STEM_CORE_URL = new URL("./stem-model-core.js" + BUILD_QS, import.meta.url).href;
let _stemCore = null;
const stemCore = () => _stemCore || (_stemCore = import(/* @vite-ignore */ STEM_CORE_URL).catch((e) => { _stemCore = null; throw e; }));

export const DRUM_MODEL = {
  url: new URL("./models/oaf-drums/oaf-drums.onnx", import.meta.url).href,
  sha256: "fe61d7a9480657aee2129db2e725ae220661bc9ce6a4cf4837830caa828a3b6c",
  bands: 250,
  pitches: 88,
};

/* Weights: Cache API first, else a fetch; the bytes must match the pinned SHA-256 either way
 * (a partial download or a stale file is refused, and a bad cached copy is evicted). */
export async function drumModelBytes(model = DRUM_MODEL, scope = globalThis) {
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
  if (!res.ok) throw new Error(`could not download the drum model (HTTP ${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const got = await sha256Hex(bytes);
  if (got !== model.sha256) throw new Error(`the drum model failed its integrity check (SHA-256 ${got.slice(0, 12)}…, expected ${model.sha256.slice(0, 12)}…) — reload and try again`);
  if (cache) { try { await cache.put(key, new Response(bytes)); } catch (_) { /* quota: fine, just not cached */ } }
  return bytes;
}

/* One session for the whole recording. Returns `run(spec, frames) → { onset, velocity }` —
 * exactly the per-window contract the engine's `transcribeDrumsWithModel` takes. */
export async function drumSession(bytes, ortImport = (u) => import(/* @vite-ignore */ u)) {
  const { ORT_WASM_PATHS, capWasmMemory } = await stemCore();
  capWasmMemory();
  const mod = await ortImport(ORT_WASM_PATHS + "ort.wasm.min.mjs");
  const ort = mod.default || mod;
  if (ort.env && ort.env.wasm) { ort.env.wasm.wasmPaths = ORT_WASM_PATHS; ort.env.wasm.numThreads = 1; }
  const s = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], enableCpuMemArena: false, enableMemPattern: false });
  const inName = s.inputNames[0], [onName, velName] = s.outputNames;
  return {
    async run(spec, frames) {
      const r = await s.run({ [inName]: new ort.Tensor("float32", Float32Array.from(spec), [1, frames, DRUM_MODEL.bands, 1]) });
      return { onset: Float32Array.from(r[onName].data), velocity: Float32Array.from(r[velName].data) };
    },
    release() { try { const p = s.release && s.release(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* already gone */ } },
  };
}

/* The whole job: weights → session → engine.transcribeDrumsWithModel → the §4 drum events.
 * `pcm` is mono at `sampleRate` (the drums stem at its own rate; the engine resamples to
 * 44.1 kHz). opts: { beats, bpm, timeline, timing, beatsPerBar, onProgress }. */
export async function transcribeDrumPcm(pcm, sampleRate, engine, opts = {}) {
  if (!pcm || !pcm.length) throw new Error("no audio to transcribe");
  const bytes = await drumModelBytes();
  const sess = await drumSession(bytes);
  try {
    const { onProgress, ...rest } = opts;
    return await engine.transcribeDrumsWithModel(pcm, sampleRate, (spec, frames) => sess.run(spec, frames), { ...rest, onProgress });
  } finally { sess.release(); }
}
