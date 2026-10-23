/* ==========================================================================
 * guitar-model-core.js — runs the guitar note-transcription CRNN (Stage 1–2 of
 * docs/AUDIO-TO-TAB-PLAN.md). Browser-only glue; the post-processing and the
 * fingering are the pure engine's (`transcribeGuitar`, `crnnNotesFromOutputs`,
 * `fingerScore`), validated headlessly against the Python reference.
 *
 * Model: Riley et al.'s guitar retraining (GAPS, MIT, xavriley/midi-transcription-
 * models `guitar-gaps.pth`) of Kong et al.'s high-resolution onset/offset-regression
 * CRNN (piano_transcription_inference, MIT). Converted with scripts/guitar_crnn_export.py:
 * fp32 ONNX (matches PyTorch to 3e-6) → weight-only int8 (per-channel, DequantizeLinear;
 * activations stay fp32 — ORT's dynamic int8 quantiser destroyed it: note F1 0.55 %).
 * 25 MB same-origin, SHA-256 pinned, Cache-API cached. Input: 10 s of 16 kHz mono;
 * output: four [1001 × 88] matrices.
 *
 * Runtime: the SAME pinned ONNX Runtime Web build and the same iOS rails as the stem
 * separator (imported from stem-model-core.js): plain WASM 1.23.2 (ORT ≥ 1.24 breaks on
 * JavaScriptCore, microsoft/onnxruntime#33426), single thread, the WASM-reservation cap.
 * ========================================================================== */
const BUILD_QS = (() => { try { return new URL(import.meta.url).search; } catch (_) { return ""; } })();
const STEM_CORE_URL = new URL("./stem-model-core.js" + BUILD_QS, import.meta.url).href;
let _stemCore = null;
const stemCore = () => _stemCore || (_stemCore = import(/* @vite-ignore */ STEM_CORE_URL).catch((e) => { _stemCore = null; throw e; }));

export const GUITAR_MODEL = {
  url: new URL("./models/guitar-crnn/guitar-gaps.w8.onnx", import.meta.url).href,
  sha256: "84db798e6545734ebd8fae9fbf2ee8af4e6294b5294a9aaa3ad6552af38cadf5",
  segment: 160000,         // 10 s at 16 kHz
  frames: 1001,
  classes: 88,
};
const HEADS = { onset: "reg_onset_output", offset: "reg_offset_output", frame: "frame_output", velocity: "velocity_output" };

/* Weights: Cache API first, else a fetch; the bytes must match the pinned SHA-256 either way
 * (a partial download or a stale file is refused, and a bad cached copy is evicted). */
export async function guitarModelBytes(model = GUITAR_MODEL, scope = globalThis) {
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
  if (!res.ok) throw new Error(`could not download the guitar model (HTTP ${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const got = await sha256Hex(bytes);
  if (got !== model.sha256) throw new Error(`the guitar model failed its integrity check (SHA-256 ${got.slice(0, 12)}…, expected ${model.sha256.slice(0, 12)}…) — reload and try again`);
  if (cache) { try { await cache.put(key, new Response(bytes)); } catch (_) { /* quota: fine, just not cached */ } }
  return bytes;
}

/* One session for the whole recording. Returns `run(segment) → { onset, offset, frame, velocity }`
 * — exactly the per-window model contract the engine's `transcribeGuitar` takes. */
export async function guitarSession(bytes, ortImport = (u) => import(/* @vite-ignore */ u)) {
  const { ORT_WASM_PATHS, capWasmMemory } = await stemCore();
  capWasmMemory();
  const mod = await ortImport(ORT_WASM_PATHS + "ort.wasm.min.mjs");
  const ort = mod.default || mod;
  if (ort.env && ort.env.wasm) { ort.env.wasm.wasmPaths = ORT_WASM_PATHS; ort.env.wasm.numThreads = 1; }
  const s = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], enableCpuMemArena: false, enableMemPattern: false });
  const inName = s.inputNames[0];
  return {
    async run(segment) {
      const r = await s.run({ [inName]: new ort.Tensor("float32", segment, [1, segment.length]) });
      const out = {};
      for (const [k, n] of Object.entries(HEADS)) out[k] = Float32Array.from(r[n].data);
      return out;
    },
    release() { try { const p = s.release && s.release(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* already gone */ } },
  };
}

/* The whole job: weights → session → engine.transcribeGuitar → notes. `engine` is the app's
 * transpiled engine module (the worker imports it from the page's Blob URL). */
export async function transcribeGuitarPcm(pcm16k, engine, opts = {}) {
  if (!pcm16k || !pcm16k.length) throw new Error("no audio to transcribe");
  const bytes = await guitarModelBytes();
  const sess = await guitarSession(bytes);
  try {
    const { notes } = await engine.transcribeGuitar(pcm16k, (seg) => sess.run(seg), { onProgress: opts.onProgress });
    return { notes };
  } finally { sess.release(); }
}
