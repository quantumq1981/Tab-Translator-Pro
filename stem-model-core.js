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
 *
 * PHONES (`compact: true`): the upstream graph takes a FIXED 11 s window and one run
 * needs ~1.3 GB of activations (measured: native ORT 1.32 GB, WASM page +1.8–2.0 GB),
 * so iOS kills the tab a few % into the first split. COMPACT_MODEL is the same network
 * re-instantiated for a 2.8 s window (scripts/scnet_reframe.py: only the fixed time-axis
 * DFT matrices + shape constants change, every learned weight is untouched), served
 * same-origin and SHA-256-pinned here. One ORT session is reused across blocks, graph
 * optimisation is off (its weight pre-packing alone costs ~200 MB), blocks are 30 s.
 * Measured on the 100 s bench mix (CLAUDE.md v2.1 → "Phones"): ~2 dB less SDR per
 * stem for well under half the memory.
 * ========================================================================== */
const SEPARATE_URL = new URL("./vendor/neural-separate.mjs", import.meta.url).href;
export const ORT_WASM_PATHS = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
export const STEM_MODEL = "scnet";
export const STEM_NAMES = ["vocals", "drums", "bass", "other"];
export const COMPACT_MODEL = {
  url: new URL("./models/scnet-compact/scnet-f120.int8.onnx", import.meta.url).href,
  sha256: "3a926ef9710754f8bc04b3ded790ac6a0ac10465ca06a50e367382deed53d180",
  frames: 120,
};
const HOP = 1024;                                              // SCNet's STFT hop (n 4096)
export const COMPACT_SEGMENT = (COMPACT_MODEL.frames - 1) * HOP; // samples per model run (≈ 2.76 s at 44.1 kHz)
const ORT_MODULE = { wasm: "ort.wasm.min.mjs", webgpu: "ort.webgpu.min.mjs" };

let _lib = null;
function lib() {
  if (!_lib) _lib = import(/* @vite-ignore */ SEPARATE_URL).catch((e) => { _lib = null; throw e; });
  return _lib;
}

/* The bundle's API is the NAMED export `separate` (`export { REVISIONS, models, separate }`
 * — there is no default export). Reading `default` gave `undefined`, which Safari reported as
 * "undefined is not a function (near '...separate...')" on the first real split. Resolve it
 * here, in one place, and fail with a readable message if a rebuilt bundle ever changes shape. */
export function resolveSeparate(mod) {
  const fn = mod && (typeof mod.separate === "function" ? mod.separate : mod.default);
  if (typeof fn !== "function") throw new Error("the stem separator library loaded but has no separate() function (vendor bundle out of date?)");
  return fn;
}

/* The library caches the weights with `await caches.open(...)` and has no fallback when that
 * rejects — which some private-browsing modes do. Probe it once; if it is unusable, hide the
 * Cache API from the library so it simply downloads (no cache) instead of failing outright. */
let _cacheChecked = false;
export async function ensureCacheUsable(scope = globalThis) {
  if (_cacheChecked) return;
  _cacheChecked = true;
  try {
    if (typeof scope.caches === "undefined") return;
    await scope.caches.open("audio-neural");
  } catch (_) {
    try { Object.defineProperty(scope, "caches", { value: undefined, configurable: true, writable: true }); } catch (_) { /* nothing else to do */ }
  }
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

/* iOS: ORT 1.30's only WASM build creates `new WebAssembly.Memory({ initial: 256, maximum: 65536,
 * shared: true })` — a SHARED memory can't move, so Safari must reserve its whole 4 GiB maximum of
 * address space up front. On an iPhone whose page already holds a decoded song and its analyses,
 * that reservation fails before the model has done anything: "no available backend found. ERR:
 * [wasm] RangeError: Out of memory" (reported on-device, ~10 s into a low-memory split).
 * The compact model's heap needs < 384 MiB (measured: runs at 384 MiB, fails at 256 MiB), so cap
 * such requests at 1 GiB and step down to 768 / 512 MiB if even that is refused. Only shared
 * memories asking for more than the first rung are touched; everything else passes through. */
export const WASM_MAX_LADDER_PAGES = [16384, 12288, 8192];   // 1 GiB · 768 MiB · 512 MiB (64 KiB pages)
export function capWasmMemory(scope = globalThis, ladder = WASM_MAX_LADDER_PAGES) {
  const WA = scope && scope.WebAssembly;
  if (!WA || typeof WA.Memory !== "function" || WA.Memory.__ttpCapped) return false;
  const Orig = WA.Memory;
  function Memory(desc) {
    if (!desc || !desc.shared || !(desc.maximum > ladder[0])) return new Orig(desc);
    let last = null;
    for (const max of ladder) {
      if (max < (desc.initial || 0)) continue;
      try { return new Orig({ ...desc, maximum: max }); } catch (e) { last = e; }
    }
    throw last || new RangeError("Out of memory");
  }
  Memory.prototype = Orig.prototype;          // instanceof WebAssembly.Memory still holds
  Memory.__ttpCapped = true; Memory.__orig = Orig;
  try { WA.Memory = Memory; } catch (_) { return false; }
  return true;
}

export async function sha256Hex(bytes) {
  const d = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

/* The compact weights: Cache API first (offline after the first split), else a same-origin
 * fetch. Either way the bytes must match the pinned SHA-256 — a partial download or a stale
 * file is refused (and evicted) instead of silently separating with the wrong network. */
export async function compactModelBytes(model = COMPACT_MODEL, scope = globalThis) {
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
  if (!res.ok) throw new Error(`could not download the low-memory stem model (HTTP ${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const got = await sha256Hex(bytes);
  if (got !== model.sha256) throw new Error(`the low-memory stem model failed its integrity check (SHA-256 ${got.slice(0, 12)}…, expected ${model.sha256.slice(0, 12)}…) — reload and try again`);
  if (cache) { try { await cache.put(key, new Response(bytes)); } catch (_) { /* quota: fine, just not cached */ } }
  return bytes;
}

/* One ONNX Runtime session for the whole song, in the shape the library's `session` hook
 * expects ({ inputs, outputs, run(feeds), free() }). `free()` is a no-op so the library's
 * per-block release doesn't rebuild it 8 times; `release()` is ours, called once at the end. */
export async function compactSession(device, bytes, ortImport = (u) => import(/* @vite-ignore */ u)) {
  const mod = await ortImport(ORT_WASM_PATHS + (ORT_MODULE[device] || ORT_MODULE.wasm));
  const ort = mod.default || mod;
  if (ort.env && ort.env.wasm) { ort.env.wasm.wasmPaths = ORT_WASM_PATHS; ort.env.wasm.numThreads = 1; }
  const s = await ort.InferenceSession.create(bytes, {
    executionProviders: [device === "webgpu" ? "webgpu" : "wasm"],
    enableCpuMemArena: false, enableMemPattern: false,
    graphOptimizationLevel: "disabled",    // the optimiser's weight pre-packing costs ~200 MB and buys no speed here
  });
  const inName = s.inputNames[0], outName = s.outputNames[0];
  return {
    inputs: [{ name: inName, dims: [1, 4, 2049, COMPACT_MODEL.frames] }],
    outputs: [{ name: outName }],
    async run(feeds) {
      const ortFeeds = {};
      for (const k in feeds) { const t = feeds[k]; ortFeeds[k] = new ort.Tensor(t.type || "float32", t.data, t.dims); }
      const r = await s.run(ortFeeds), o = r[outName];
      return { [outName]: { data: o.data, dims: Array.from(o.dims), type: o.type } };
    },
    free() { /* reused across blocks; see release() */ },
    release() { try { const p = s.release && s.release(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* already gone */ } },
  };
}

/* Low-memory mode always runs on WASM. Its session turns ORT's graph optimiser off (the optimiser's
 * weight pre-packing costs ~200 MB), and ORT's WebGPU EP cannot run an unoptimised graph: on an
 * iPad (iOS/iPadOS 26 Safari has WebGPU) session creation failed with "allocation_planner.cc:237 Could
 * not find OrtValue with name '_sw'" (reported on-device), and on a software WebGPU adapter the
 * same session fails at run time on an f16 Cast. WASM with the same options is the measured path. */
export function deviceFor(compact, picked) { return compact ? "wasm" : picked; }

export async function separateInBlocks(left, right, sampleRate, opts = {}) {
  const compact = !!opts.compact;
  const device = deviceFor(compact, await pickDevice(opts.device));
  try {
    return await separateOn(device, left, right, sampleRate, opts);
  } catch (e) {
    // A GPU that can't build or run the graph shouldn't end the split: redo it on WASM (same
    // stems, slower). Anything that already failed on WASM is a real error and surfaces as is.
    if (device !== "webgpu") throw e;
    if (opts.onProgress) opts.onProgress(0, 1);
    const r = await separateOn("wasm", left, right, sampleRate, opts);
    return { ...r, fellBackFrom: "webgpu", fallbackReason: String(e && e.message || e).slice(0, 200) };
  }
}

async function separateOn(device, left, right, sampleRate, opts) {
  const separate = resolveSeparate(await lib());
  await ensureCacheUsable();
  const n = Math.min(left.length, right.length);
  const compact = !!opts.compact;
  if (compact) capWasmMemory();                // before ORT is imported (see capWasmMemory)
  // compact: our own pinned model + one reused session (opts.session stays the test seam)
  let own = null;
  const session = opts.session || (compact ? async () => own || (own = await compactSession(device, await compactModelBytes())) : undefined);
  const block = Math.max(10, opts.blockSec || (compact ? 30 : 60)) * sampleRate | 0;
  const pad = Math.round((opts.padSec != null ? opts.padSec : 1.5) * sampleRate);
  const starts = [];
  for (let s = 0; s < n; s += block) starts.push(s);
  const out = Object.fromEntries(STEM_NAMES.map((k) => [k, [new Float32Array(n), new Float32Array(n)]]));
  const weight = new Float32Array(n);
  try {
    for (let bi = 0; bi < starts.length; bi++) {
      const a = Math.max(0, starts[bi] - pad), b = Math.min(n, starts[bi] + block + pad);
      const res = await separate([left.subarray(a, b), right.subarray(a, b)], {
        sampleRate, model: STEM_MODEL, device, wasmPaths: ORT_WASM_PATHS,   // single-threaded WASM without COOP/COEP (ORT falls back itself)
        step: opts.step != null ? opts.step : 0.5,                 // 0.5: half the compute of 0.25 for ~0.1 dB
        session,                                                   // compact model, or the test seam (the library's own session hook)
        ...(compact ? { segment: COMPACT_SEGMENT } : {}),          // the library's SCNet preset says 11 s; the compact graph takes 2.76 s
        // The library calls progress({ chunk: i + 1 }) BEFORE running chunk i, so `chunk` counts
        // chunks STARTED. Report chunks COMPLETED, or every estimate runs one chunk (over a minute
        // on single-thread WASM) ahead of the work actually done.
        progress: opts.onProgress ? (p) => opts.onProgress(bi + (p.chunk - 1) / p.totalChunks, starts.length) : undefined,
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
  } finally {
    if (own) own.release();
  }
  for (let i = 0; i < n; i++) if (weight[i] > 0 && weight[i] !== 1) for (const k of STEM_NAMES) { out[k][0][i] /= weight[i]; out[k][1][i] /= weight[i]; }
  return { sampleRate, stems: out, device, compact };
}
