/* ==========================================================================
 * stem-model-core.js — the separation itself (shared by stem-worker.js and the
 * main-thread fallback in stem-model.js). Browser-only; plain ES module.
 *
 * Model: SCNet (starrytong/SCNet, MIT weights), 4 stems — vocals · drums · bass ·
 * other — via the vendored @audio/neural-separate (MIT) on ONNX Runtime Web.
 * MUSDB18 SDR as published by audiojs: vocals 9.88 · drums 9.43 · bass 8.35 ·
 * other 6.15 — the same tier as Hybrid Transformer Demucs (8.86 · 9.55 · 9.30 ·
 * 5.69), whose weights are research-only and therefore not used here.
 * Guitar and keys are NOT separate stems: there is no openly-licensed model that
 * splits them; they arrive together as "other".
 *
 * The 13 MB int8 weights are fetched once from the pinned Hugging Face revision
 * and SHA-256-checked by the library (a partial or altered download is refused),
 * then served from the Cache API — later runs work offline.
 *
 * MEMORY: the library holds full-length arrays, so a whole song at once can exceed
 * an iPhone's budget. The song is processed in `blockSec` blocks (default 60 s)
 * with `padSec` (1.5 s) of context either side, cross-faded at the seams.
 * ========================================================================== */
const SEPARATE_URL = new URL("./vendor/neural-separate.mjs", import.meta.url).href;
export const ORT_WASM_PATHS = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
export const STEM_MODEL = "scnet";
export const STEM_NAMES = ["vocals", "drums", "bass", "other"];

let _lib = null;
function lib() {
  if (!_lib) _lib = import(/* @vite-ignore */ SEPARATE_URL).catch((e) => { _lib = null; throw e; });
  return _lib;
}

export async function pickDevice(pref) {
  if (pref === "wasm" || pref === "webgpu") return pref;
  try {
    if (typeof navigator !== "undefined" && navigator.gpu) {
      const a = await navigator.gpu.requestAdapter();
      if (a) return "webgpu";
    }
  } catch (_) { /* no WebGPU here */ }
  return "wasm";
}

export async function separateInBlocks(left, right, sampleRate, opts = {}) {
  const { default: separate } = await lib();
  const device = await pickDevice(opts.device);
  const n = Math.min(left.length, right.length);
  const block = Math.max(10, opts.blockSec || 60) * sampleRate | 0;
  const pad = Math.round((opts.padSec != null ? opts.padSec : 1.5) * sampleRate);
  const starts = [];
  for (let s = 0; s < n; s += block) starts.push(s);
  const out = Object.fromEntries(STEM_NAMES.map((k) => [k, [new Float32Array(n), new Float32Array(n)]]));
  const weight = new Float32Array(n);
  for (let bi = 0; bi < starts.length; bi++) {
    const a = Math.max(0, starts[bi] - pad), b = Math.min(n, starts[bi] + block + pad);
    const res = await separate([left.subarray(a, b), right.subarray(a, b)], {
      sampleRate, model: STEM_MODEL, device, wasmPaths: ORT_WASM_PATHS,   // single-threaded WASM without COOP/COEP (ORT falls back itself)
      step: opts.step != null ? opts.step : 0.5,                 // 0.5: half the compute of 0.25 for ~0.1 dB
      progress: opts.onProgress ? (p) => opts.onProgress(bi + p.chunk / p.totalChunks, starts.length) : undefined,
    });
    // linear cross-fade over the padded overlap so block seams are inaudible
    for (let i = a; i < b; i++) {
      const fadeIn = starts[bi] > 0 ? Math.min(1, (i - a) / Math.max(1, 2 * pad)) : 1;
      const fadeOut = b < n ? Math.min(1, (b - i) / Math.max(1, 2 * pad)) : 1;
      const w = Math.min(fadeIn, fadeOut);
      weight[i] += w;
      for (const k of STEM_NAMES) {
        const st = res.stems[k];
        if (!st) continue;
        out[k][0][i] += w * (st[0][i - a] || 0);
        out[k][1][i] += w * ((st[1] || st[0])[i - a] || 0);
      }
    }
    if (opts.onProgress) opts.onProgress(bi + 1, starts.length);
  }
  for (let i = 0; i < n; i++) if (weight[i] > 0 && weight[i] !== 1) for (const k of STEM_NAMES) { out[k][0][i] /= weight[i]; out[k][1][i] /= weight[i]; }
  return { sampleRate, stems: out, device };
}
