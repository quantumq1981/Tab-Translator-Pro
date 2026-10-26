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
 * The 13 MB int8 weights are fetched once from the revision the library pins on
 * Hugging Face and SHA-256-checked against the library's pin (a partial or altered
 * download is refused), then served from the Cache API — later runs work offline.
 * (WebGPU runs go through the library's own loader, which does the same check.)
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
 *
 * RUNTIME (2026-10-23): every WASM session is OURS, on ONE pinned ONNX Runtime — 1.23.2's plain
 * build (ORT_WASM_VERSION below). ORT 1.24.1+ (incl. the 1.30.0 the bundle imports) ships Abseil
 * 20250814, whose hash tables hit a JavaScriptCore WASM miscompile: once a lookup tiers up it hashes
 * with a different seed than the inserts used, so ORT can't find its own values and session creation
 * fails with "Could not find OrtValue with name '…'" — a DIFFERENT name each attempt (microsoft/
 * onnxruntime#33426; WebKit bug 271866). That is exactly what two device reports showed ('_sw', then
 * '_pc' after low-memory mode had been moved onto WASM; the path in both errors is the 1.30.0 build's).
 * 1.23.2 (Abseil 20250512) gives bit-identical stems, same memory, same
 * speed (tests/bench/ort-pin.mjs). WebGPU is never chosen on WebKit: ORT's JSEP/asyncify builds stall
 * WebKit 26.2's optimising WASM tier (microsoft/onnxruntime#26827).
 * ========================================================================== */
// The deploy stamps stem-model.js?v=<commit>; stem-model.js → stem-worker.js → this module pass it on,
// so a device runs the separator that was deployed, not a cached older copy (the UI is always fetched
// no-cache — without this the two could disagree, which is what made the last fix look like it failed).
const BUILD_QS = (() => { try { return new URL(import.meta.url).search; } catch (_) { return ""; } })();
export const BUILD = (() => { try { return new URLSearchParams(BUILD_QS).get("v") || "dev"; } catch (_) { return "dev"; } })();
const SEPARATE_URL = new URL("./vendor/neural-separate.mjs" + BUILD_QS, import.meta.url).href;
export const ORT_WASM_VERSION = "1.23.2";
export const ORT_WASM_PATHS = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_WASM_VERSION}/dist/`;
const ORT_WASM_MODULE = "ort.wasm.min.mjs";    // the plain build: no JSEP / asyncify / JSPI
// The vendored library's own loader (WebGPU on non-WebKit browsers only) imports 1.30.0 — its wasm
// files must come from the same release as its JS.
export const ORT_LIB_VERSION = "1.30.0";
const ORT_LIB_PATHS = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_LIB_VERSION}/dist/`;
export const STEM_MODEL = "scnet";
export const STEM_NAMES = ["vocals", "drums", "bass", "other"];
export const COMPACT_MODEL = {
  url: new URL("./models/scnet-compact/scnet-f120.int8.onnx", import.meta.url).href,
  sha256: "3a926ef9710754f8bc04b3ded790ac6a0ac10465ca06a50e367382deed53d180",
  frames: 120,
};
/* "⚡ Faster" (default on iOS/iPadOS ≤ 16 — an A9X core is ~3× slower than a current iPhone's): windows overlap
 * by 25 % instead of 50 %. Measured on the compact model (real library, ORT 1.23.2, 17 s mix with known stems):
 * 34 % less time (5.5× → 3.7× real time), same peak memory, SDR −0.7 drums / −0.9 bass / −0.5 other dB.
 * (A 1.4 s window was measured too and rejected: −180 MB but −1.4 / −4.6 / −2.3 dB, and barely faster.) */
export const FAST_STEP = 0.75;
const HOP = 1024;                                              // SCNet's STFT hop (n 4096)
export const COMPACT_SEGMENT = (COMPACT_MODEL.frames - 1) * HOP; // samples per model run (≈ 2.76 s at 44.1 kHz)

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

/* Safari and every iOS / iPadOS browser (all WebKit). A worker's navigator has no maxTouchPoints, but
 * iPadOS's desktop-class UA ("Macintosh … Version/x Safari/…", no Chrome token) is caught by the second test. */
export function isWebKit(nav = typeof navigator !== "undefined" ? navigator : null) {
  const ua = String((nav && nav.userAgent) || "");
  return /iPhone|iPad|iPod/.test(ua) || (/AppleWebKit\//.test(ua) && /Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|OPR\/|Firefox\//.test(ua));
}

export async function pickDevice(pref, nav = typeof navigator !== "undefined" ? navigator : null) {
  if (pref === "wasm" || pref === "webgpu") return pref;
  if (isWebKit(nav)) return "wasm";            // see RUNTIME in the header: WebKit runs our pinned WASM build
  try {
    if (nav && nav.gpu) {
      const a = await nav.gpu.requestAdapter();
      if (a) return "webgpu";
    }
  } catch (_) { /* no WebGPU here */ }
  return "wasm";
}

/* "[stems 3f2a1bc · ORT 1.23.2 wasm · Safari 17.4 · iOS 17.4]" — appended to every separation error so a
 * device screenshot says which build ran, on which runtime and engine. (iOS 26 freezes the OS token in the
 * user agent at 18_6, so the Safari "Version/" — the WebKit release — is the number that matters.) */
export function envLabel(device, nav = typeof navigator !== "undefined" ? navigator : null) {
  const ua = String((nav && nav.userAgent) || "");
  const parts = [`stems ${BUILD}`, `ORT ${device === "webgpu" ? ORT_LIB_VERSION : ORT_WASM_VERSION} ${device || "?"}`];
  const ver = ua.match(/Version\/(\d+(?:\.\d+)*)/), ios = ua.match(/OS (\d+)_(\d+)(?:_(\d+))? like Mac OS X/);
  const other = ua.match(/(CriOS|FxiOS|EdgiOS|Chrome|Firefox|Edg)\/(\d+)/);
  if (ver && isWebKit(nav)) parts.push(`Safari ${ver[1]}`);
  else if (other) parts.push(`${other[1]} ${other[2]}`);
  if (ios) parts.push(`iOS ${ios[1]}.${ios[2]}${ios[3] ? "." + ios[3] : ""}`);
  else if (/Macintosh/.test(ua) && isWebKit(nav)) parts.push("macOS/iPadOS");
  return `[${parts.join(" · ")}]`;
}
function withEnv(e, device) {
  const err = e instanceof Error ? e : new Error(String(e));
  try { if (!/\[stems /.test(err.message)) err.message = `${err.message} ${envLabel(device)}`; } catch (_) { /* frozen message: leave it */ }
  return err;
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

/* Model weights: Cache API first (offline after the first split), else a fetch. Either way the bytes
 * must match the pinned SHA-256 — a partial download or a stale file is refused (and evicted) instead
 * of silently separating with the wrong network. Used for both the compact model (same-origin) and the
 * full one (the library's pinned Hugging Face revision). */
export async function modelBytes(model = COMPACT_MODEL, scope = globalThis) {
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
  if (!res.ok) throw new Error(`could not download the stem model (HTTP ${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const got = await sha256Hex(bytes);
  if (got !== model.sha256) throw new Error(`the stem model failed its integrity check (SHA-256 ${got.slice(0, 12)}…, expected ${model.sha256.slice(0, 12)}…) — reload and try again`);
  if (cache) { try { await cache.put(key, new Response(bytes)); } catch (_) { /* quota: fine, just not cached */ } }
  return bytes;
}

/* The full-size model, exactly as the vendored library pins it (revision + SHA-256 + 476-frame window).
 * The URL is the one the library itself builds (`hosted()`), so a cached copy and a fresh one agree. */
export function fullModelOf(mod, name = STEM_MODEL) {
  const p = mod && mod.models && mod.models[name], rev = mod && mod.REVISIONS && mod.REVISIONS[name];
  if (!p || !rev || !p.sha256 || !p.repo || !p.file) throw new Error("the stem separator library has no pinned SCNet weights (vendor bundle out of date?)");
  return { url: `https://huggingface.co/${p.repo}/resolve/${rev}/${p.file}`, sha256: p.sha256, frames: p.frames || 476 };
}

/* One ONNX Runtime session for the whole song, on the pinned WASM build, in the shape the library's
 * `session` hook expects ({ inputs, outputs, run(feeds), free() }). The library reads the frame count
 * from inputs[0].dims[3], so `frames` must be the model's. `free()` is a no-op so the library's
 * per-block release doesn't rebuild it every block; `release()` is ours, called once at the end.
 * `graphOptimizationLevel` undefined = ORT's default (what the library used for the full model). */
export async function wasmSession(bytes, { frames = COMPACT_MODEL.frames, graphOptimizationLevel } = {}, ortImport = (u) => import(/* @vite-ignore */ u)) {
  const mod = await ortImport(ORT_WASM_PATHS + ORT_WASM_MODULE);
  const ort = mod.default || mod;
  if (ort.env && ort.env.wasm) { ort.env.wasm.wasmPaths = ORT_WASM_PATHS; ort.env.wasm.numThreads = 1; }
  const s = await ort.InferenceSession.create(bytes, {
    executionProviders: ["wasm"],
    enableCpuMemArena: false, enableMemPattern: false,
    ...(graphOptimizationLevel ? { graphOptimizationLevel } : {}),
  });
  const inName = s.inputNames[0], outName = s.outputNames[0];
  return {
    inputs: [{ name: inName, dims: [1, 4, 2049, frames] }],
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
 * weight pre-packing costs ~200 MB), and ORT's WebGPU EP cannot run an unoptimised graph (measured on a
 * software WebGPU adapter: the session fails at run time on an f16 Cast). WASM is the measured path. */
export function deviceFor(compact, picked) { return compact ? "wasm" : picked; }

/* Input may be Float32 or 16-bit (stem-model.js sends 16-bit to halve the copy the worker holds): the library
 * gets a float view/copy of one block at a time. */
function blockF32(x, a, b) {
  if (!(x instanceof Int16Array)) return x.subarray(a, b);
  const o = new Float32Array(b - a);
  for (let i = a; i < b; i++) o[i - a] = x[i] / 32768;
  return o;
}
/* float → 16-bit, the same rounding as encodeWav16 (so a stem saved as WAV is unchanged) */
export function toI16(v) {
  const x = v > 1 ? 1 : v < -1 ? -1 : v || 0;
  return x < 0 ? Math.round(x * 32768) : Math.round(x * 32767);
}

export async function separateInBlocks(left, right, sampleRate, opts = {}) {
  const compact = !!opts.compact;
  const device = deviceFor(compact, await pickDevice(opts.device));
  try {
    return await separateOn(device, left, right, sampleRate, opts);
  } catch (e) {
    // A GPU that can't build or run the graph shouldn't end the split: redo it on WASM (same
    // stems, slower). Anything that already failed on WASM is a real error and surfaces as is.
    if (device !== "webgpu") throw withEnv(e, device);
    if (opts.onProgress) opts.onProgress(0, 1);
    let r;
    try { r = await separateOn("wasm", left, right, sampleRate, opts); } catch (e2) { throw withEnv(e2, "wasm"); }
    return { ...r, fellBackFrom: "webgpu", fallbackReason: String(e && e.message || e).slice(0, 200) };
  }
}

async function separateOn(device, left, right, sampleRate, opts) {
  // Stages let the page say what a slow device is doing before the first progress tick (on an A9X iPad the
  // runtime compile + first 2.8 s window can take minutes) — and name where it stalled if it never moves.
  const stage = (s) => { try { if (opts.onStage) opts.onStage(s); } catch (_) { /* UI callback only */ } };
  stage("library");
  const mod = await lib();
  const separate = resolveSeparate(mod);
  await ensureCacheUsable();
  const n = Math.min(left.length, right.length);
  const compact = !!opts.compact;
  if (compact) capWasmMemory();                // before ORT is imported (see capWasmMemory)
  // Every WASM session is ours (pinned runtime, see RUNTIME in the header): the model's SHA-checked bytes
  // and ONE session reused across blocks. WebGPU keeps the library's own loader. opts.session /
  // opts.loadModel / opts.ortImport are test seams.
  let own = null;
  const model = device === "wasm" ? (compact ? COMPACT_MODEL : fullModelOf(mod)) : null;
  const session = opts.session || (model ? () => own || (own = (async () => {
    stage("model");
    const bytes = await (opts.loadModel || modelBytes)(model);
    stage("runtime");
    const s = await wasmSession(bytes, { frames: model.frames, graphOptimizationLevel: compact ? "disabled" : undefined }, opts.ortImport);
    stage("separating");
    return s;
  })()) : undefined);
  if (!model || opts.session) stage("separating");
  const block = Math.max(10, opts.blockSec || (compact ? 30 : 60)) * sampleRate | 0;
  const pad = Math.round((opts.padSec != null ? opts.padSec : 1.5) * sampleRate);
  const starts = [];
  for (let s = 0; s < n; s += block) starts.push(s);
  // The stems are written as each block finishes: the blocks overlap by 2·pad, and everything before the NEXT
  // block's start can't change any more, so it is normalised and stored right away; only the overlap tail is
  // carried, as float, into the next block. Same arithmetic in the same order as accumulating whole-song float
  // arrays (bit-identical float output), without a second song-length buffer per stem. opts.output "int16"
  // stores 16-bit stems (half the memory of float — what a phone's page keeps for playback and charting).
  const int16 = opts.output === "int16";
  const Arr = int16 ? Int16Array : Float32Array;
  const out = Object.fromEntries(STEM_NAMES.map((k) => [k, [new Arr(n), new Arr(n)]]));
  const sameLR = right === left;
  let carry = null;                                // { len, w, acc:{ k: [L, R] } } for [a of this block, a + len)
  try {
    for (let bi = 0; bi < starts.length; bi++) {
      const a = Math.max(0, starts[bi] - pad), b = Math.min(n, starts[bi] + block + pad), len = b - a;
      const inL = blockF32(left, a, b), inR = sameLR ? inL : blockF32(right, a, b);
      const res = await separate([inL, inR], {
        sampleRate, model: STEM_MODEL, device, wasmPaths: ORT_LIB_PATHS,    // only used when the library loads ORT itself (WebGPU)
        step: opts.step != null ? opts.step : 0.5,                 // 0.5: half the compute of 0.25 for ~0.1 dB; FAST_STEP for slow devices
        session,                                                   // our pinned WASM session, or the test seam (the library's own session hook)
        ...(compact ? { segment: opts.segment || COMPACT_SEGMENT } : {}),   // the library's SCNet preset says 11 s; the compact graph takes 2.76 s
        // The library calls progress({ chunk: i + 1 }) BEFORE running chunk i, so `chunk` counts
        // chunks STARTED. Report chunks COMPLETED, or every estimate runs one chunk (over a minute
        // on single-thread WASM) ahead of the work actually done.
        progress: opts.onProgress ? (p) => opts.onProgress(bi + (p.chunk - 1) / p.totalChunks, starts.length) : undefined,
      });
      const w = new Float32Array(len), acc = {};
      for (const k of STEM_NAMES) acc[k] = [new Float32Array(len), new Float32Array(len)];
      if (carry) {                                 // the previous block's overlap tail starts exactly at this a
        w.set(carry.w);
        for (const k of STEM_NAMES) { acc[k][0].set(carry.acc[k][0]); acc[k][1].set(carry.acc[k][1]); }
      }
      // linear cross-fade over the padded overlap so block seams are inaudible
      for (let i = a; i < b; i++) {
        const fadeIn = starts[bi] > 0 ? Math.min(1, (i - a) / Math.max(1, 2 * pad)) : 1;
        const fadeOut = b < n ? Math.min(1, (b - i) / Math.max(1, 2 * pad)) : 1;
        const wt = Math.min(fadeIn, fadeOut);
        w[i - a] += wt;
        for (const k of STEM_NAMES) {
          const st = res.stems[k];
          if (!st) continue;
          acc[k][0][i - a] += wt * (st[0][i - a] || 0);
          acc[k][1][i - a] += wt * ((st[1] || st[0])[i - a] || 0);
        }
      }
      // everything before the next block's start is final
      const fe = bi + 1 < starts.length ? Math.max(a, starts[bi + 1] - pad) : n;
      for (const k of STEM_NAMES) for (let c = 0; c < 2; c++) {
        const src = acc[k][c], dst = out[k][c];
        for (let i = a; i < fe; i++) {
          let v = src[i - a];
          const wi = w[i - a];
          if (wi > 0 && wi !== 1) v /= wi;
          dst[i] = int16 ? toI16(v) : v;
        }
      }
      carry = fe < b ? { w: w.slice(fe - a), acc: Object.fromEntries(STEM_NAMES.map((k) => [k, [acc[k][0].slice(fe - a), acc[k][1].slice(fe - a)]])) } : null;
      if (opts.onProgress) opts.onProgress(bi + 1, starts.length);
    }
  } finally {
    if (own) { try { (await own).release(); } catch (_) { /* creation failed: nothing to release */ } }
  }
  return { sampleRate, stems: out, device, compact };
}
