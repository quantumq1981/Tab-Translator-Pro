/* ==========================================================================
 * stem-model.js — browser-only glue that publishes window.TTP_STEM_MODEL, the
 * full-mix → stems separator behind the Audio panel's "✂ Split into stems".
 * Same pattern as note-model.js: nothing is downloaded at boot; the first split
 * loads the vendored library, ONNX Runtime Web (jsDelivr, pinned — 1.23.2 for every
 * WASM session, see RUNTIME in stem-model-core.js) and the SCNet weights (Hugging Face
 * or same-origin for the low-memory model, pinned + SHA-256-checked, then cached).
 *
 * Contract:
 *   window.TTP_STEM_MODEL(left, right, sampleRate, { onProgress(done,total), device, blockSec, step, compact })
 *   window.TTP_STEM_CANCEL() — stop a split in progress (the promise rejects with err.cancelled = true)
 *   window.TTP_STEM_FAST_DEFAULT — true on iOS/iPadOS ≤ 16 (slow devices default to ⚡ Faster, step 0.75)
 *   opts.onStage(stage) — "library" | "model" | "runtime" | "separating", before the first progress tick
 *   window.TTP_STEM_COMPACT_DEFAULT — true on iPhone/iPad: one full-size SCNet run needs ~1.3 GB, more
 *     than iOS gives a Safari tab, so phones use the compact (2.8 s-window) model unless told otherwise
 *     → Promise<{ sampleRate, device, stems: { vocals:[L,R], drums:[L,R], bass:[L,R], other:[L,R] } }>
 *   (stems at the INPUT rate, sample-aligned with the input — the per-instrument charts
 *    rely on that alignment for their shared beat grid)
 *
 * Runs in a module Worker (stem-worker.js) so the page stays responsive; only if a
 * module Worker can't be constructed at all does the same code run on the main thread. Any failure rejects
 * the promise with a readable message — the UI shows it; nothing pretends.
 *
 * DEVICE-ONLY seam (same category as note-model.js, PDF.js, Web Audio): npm test
 * asserts its contracts (pins, lazy load, fallback, deploy list); the separation
 * itself must be smoke-tested on real hardware.
 * ========================================================================== */
// The deploy loads this file as stem-model.js?v=<commit> (pages.yml); the worker and the core inherit the
// stamp, so a phone can't run a fresh page against a separator its HTTP cache kept from the last deploy.
const BUILD_QS = (() => { try { return new URL(import.meta.url).search; } catch (_) { return ""; } })();
const WORKER_URL = new URL("./stem-worker.js" + BUILD_QS, import.meta.url);
const CORE_URL = new URL("./stem-model-core.js" + BUILD_QS, import.meta.url).href;

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
      if (m.type === "stage") { if (p.onStage) p.onStage(m.stage); return; }
      _pending.delete(m.id);
      // A WASM heap never shrinks: the worker would keep the model's ~0.65–1.8 GB peak for the rest
      // of the visit, right while the page charts the stems (measured: the page sat ~650 MB higher
      // through charting). End it once nothing is pending; the next split starts a fresh one and
      // reads the weights from the Cache API.
      if (!_pending.size) { try { w.terminate(); } catch (_) {} if (_worker === w) _worker = null; }
      if (m.type === "result") p.resolve({ sampleRate: m.sampleRate, stems: m.stems, device: m.device, compact: m.compact });
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

/* Stop a split in progress: the worker is ended (its WASM heap goes with it) and the pending promise rejects
 * with an error whose `cancelled` is true. A main-thread fallback run can't be interrupted — returns false. */
export function cancelStems() {
  const w = _worker;
  if (!w || !_pending.size) return false;
  try { w.terminate(); } catch (_) { /* already gone */ }
  _worker = null;
  const err = new Error("stem separation cancelled"); err.cancelled = true;
  _pending.forEach((p) => p.reject(err)); _pending.clear();
  return true;
}

/* Safari 16 and older (iOS/iPadOS 16 — e.g. a first-generation iPad Pro, which can't update past 16.7): these
 * devices run the separator, but several times slower than a current iPhone, so the page defaults them to
 * ⚡ Faster. Read from Safari's "Version/" (the WebKit release) — or, for other iOS browsers, the OS token, which
 * iOS only froze (at 18_6) from iOS 26 on. */
export function isLegacyIOS(nav = typeof navigator !== "undefined" ? navigator : null) {
  if (!isAppleMobile(nav)) return false;
  const ua = String(nav.userAgent || "");
  const v = ua.match(/Version\/(\d+)/) || ua.match(/OS (\d+)_\d+(?:_\d+)? like Mac OS X/);
  return !!v && +v[1] < 17;
}

/* iPhone / iPod / iPad — including iPadOS, which reports a Mac user agent but has touch. */
export function isAppleMobile(nav = typeof navigator !== "undefined" ? navigator : null) {
  if (!nav) return false;
  const ua = String(nav.userAgent || ""), plat = String(nav.platform || "");
  return /iPhone|iPad|iPod/.test(ua) || (/Mac/.test(plat || ua) && (nav.maxTouchPoints || 0) > 1);
}

/* float → 16-bit, the same rounding as encodeWav16 / the core's toI16 */
export function toInt16(x) {
  const o = new Int16Array(x.length);
  for (let i = 0; i < x.length; i++) { const v = x[i] > 1 ? 1 : x[i] < -1 ? -1 : x[i] || 0; o[i] = v < 0 ? Math.round(v * 32768) : Math.round(v * 32767); }
  return o;
}

async function separateStems(left, right, sampleRate, opts = {}) {
  if (!left || !left.length) throw new Error("no audio to separate");
  opts = { ...opts, compact: opts.compact != null ? !!opts.compact : isAppleMobile() };
  // 16-bit copies of the song (half the memory of float) are what the worker holds; it returns 16-bit stems
  // too (opts.output "int16"). A phone's tab is killed for its total footprint, worker included, and the end
  // of a split — the model's heap + the stems + the page's own audio — is where it peaked.
  const L = toInt16(left), R = right && right !== left ? toInt16(right) : L;
  opts = { ...opts, output: opts.output || "int16" };
  const w = getWorker();
  if (!w) return onMainThread(L, R, sampleRate, opts);
  // No main-thread retry once the worker exists: a split is minutes of WebAssembly, and running it on the page's
  // thread freezes the page until iOS kills it — worse than an honest error. (Only a browser that can't even
  // construct a module worker, above, runs it here.)
  return new Promise((resolve, reject) => {
    const id = ++_seq;
    _pending.set(id, { resolve, reject, onProgress: opts.onProgress, onStage: opts.onStage });
    w.postMessage({ id, left: L, right: R, sampleRate, opts: { device: opts.device, blockSec: opts.blockSec, step: opts.step, compact: opts.compact, output: opts.output } }, R === L ? [L.buffer] : [L.buffer, R.buffer]);
  });
}

try {
  if (typeof window !== "undefined") {
    window.TTP_STEM_MODEL = separateStems; window.TTP_STEM_COMPACT_DEFAULT = isAppleMobile();
    window.TTP_STEM_CANCEL = cancelStems; window.TTP_STEM_FAST_DEFAULT = isLegacyIOS();
  }
} catch (_) { /* never wedge boot */ }
