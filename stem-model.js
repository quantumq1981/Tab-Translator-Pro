/* ==========================================================================
 * stem-model.js — browser-only glue that publishes window.TTP_STEM_MODEL, the
 * full-mix → stems separator behind the Audio panel's "✂ Split into stems".
 * Same pattern as note-model.js: nothing is downloaded at boot; the first split
 * loads the vendored library, ONNX Runtime Web (jsDelivr, pinned) and the SCNet
 * weights (13 MB, Hugging Face, pinned + SHA-256-checked, then cached).
 *
 * Contract:
 *   window.TTP_STEM_MODEL(left, right, sampleRate, { onProgress(done,total), device, blockSec, step })
 *     → Promise<{ sampleRate, device, stems: { vocals:[L,R], drums:[L,R], bass:[L,R], other:[L,R] } }>
 *   (stems at the INPUT rate, sample-aligned with the input — the per-instrument charts
 *    rely on that alignment for their shared beat grid)
 *
 * Runs in a module Worker (stem-worker.js) so the page stays responsive; if a
 * Worker can't be made, the same code runs on the main thread. Any failure rejects
 * the promise with a readable message — the UI shows it; nothing pretends.
 *
 * DEVICE-ONLY seam (same category as note-model.js, PDF.js, Web Audio): npm test
 * asserts its contracts (pins, lazy load, fallback, deploy list); the separation
 * itself must be smoke-tested on real hardware.
 * ========================================================================== */
const WORKER_URL = new URL("./stem-worker.js", import.meta.url);
const CORE_URL = new URL("./stem-model-core.js", import.meta.url).href;

let _worker = null, _seq = 0;
const _pending = new Map();

function getWorker() {
  if (_worker) return _worker;
  try {
    const w = new Worker(WORKER_URL, { type: "module" });
    w.onmessage = (ev) => {
      const m = ev.data || {}, p = _pending.get(m.id);
      if (!p) return;
      if (m.type === "progress") { if (p.onProgress) p.onProgress(m.done, m.total); return; }
      _pending.delete(m.id);
      if (m.type === "result") p.resolve({ sampleRate: m.sampleRate, stems: m.stems, device: m.device });
      else p.reject(new Error(m.message || "stem separation failed"));
    };
    w.onerror = (e) => {
      const err = new Error((e && e.message) || "stem worker crashed");
      _pending.forEach((p) => p.reject(err)); _pending.clear();
      try { w.terminate(); } catch (_) {}
      _worker = null;
    };
    _worker = w;
    return w;
  } catch (_) { return null; }
}

async function onMainThread(left, right, sampleRate, opts) {
  const core = await import(/* @vite-ignore */ CORE_URL);
  return core.separateInBlocks(left, right, sampleRate, opts);
}

async function separateStems(left, right, sampleRate, opts = {}) {
  if (!left || !left.length) throw new Error("no audio to separate");
  const L = Float32Array.from(left), R = Float32Array.from(right || left);   // copies: we transfer them
  const w = getWorker();
  if (!w) return onMainThread(L, R, sampleRate, opts);
  try {
    return await new Promise((resolve, reject) => {
      const id = ++_seq;
      _pending.set(id, { resolve, reject, onProgress: opts.onProgress });
      w.postMessage({ id, left: L, right: R, sampleRate, opts: { device: opts.device, blockSec: opts.blockSec, step: opts.step } }, [L.buffer, R.buffer]);
    });
  } catch (err) {
    // a Worker that cannot load modules / WebGPU in workers missing: one main-thread retry
    if (/worker|module|import/i.test(String(err && err.message))) return onMainThread(Float32Array.from(left), Float32Array.from(right || left), sampleRate, opts);
    throw err;
  }
}

try {
  if (typeof window !== "undefined") window.TTP_STEM_MODEL = separateStems;
} catch (_) { /* never wedge boot */ }
