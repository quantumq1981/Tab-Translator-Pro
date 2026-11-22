/* ==========================================================================
 * chord-ocr-model.js — publishes window.TTP_CHORD_OCR(pages, { onProgress, style })
 * → Promise<{ pages: [{ layout, reads }] }> for the "Scan 📷" mode (chord symbols
 * from a picture or a scanned PDF of a lead sheet).
 *
 * Loaded at boot but does nothing until called: the small recogniser, ONNX Runtime
 * and the worker are fetched on first use only. Runs in a module Worker
 * (chord-ocr-worker.js) that imports the app's own transpiled engine
 * (window.__TTP_ENGINE_URL__), so layout, decoding and the chord grammar are the
 * SAME pure code the headless tests pin. Only a browser that cannot construct a
 * module Worker runs it on the main thread — a failed worker run is NOT retried
 * there (same rule as the stem separator and the drum model). The worker is ended
 * after each job. Never throws at boot. See chord-ocr-core.js.
 * pages: [{ data: Uint8Array (grey 0..255), width, height }] — transferred.
 * style: "printed" (default) | "hand" — which reader (chord-ocr-core.js CHORD_OCR_MODELS).
 * ========================================================================== */
const BUILD_QS = (() => { try { return new URL(import.meta.url).search; } catch (_) { return ""; } })();
const WORKER_URL = new URL("./chord-ocr-worker.js" + BUILD_QS, import.meta.url);
const CORE_URL = new URL("./chord-ocr-core.js" + BUILD_QS, import.meta.url).href;
const JOB_URL = new URL("./model-job.js" + BUILD_QS, import.meta.url).href;
// one job at a time, with Cancel + a stall watch (audit 2026-11-18 m6; see model-job.js)
let _jobs = null;
const jobs = async () => _jobs || (_jobs = (await import(/* @vite-ignore */ JOB_URL)).createJobRunner("chord reading"));
export function cancelChordOcr() { return _jobs ? _jobs.cancel() : false; }

async function onMainThread(pages, engineUrl, opts) {
  const [core, engine] = await Promise.all([import(/* @vite-ignore */ CORE_URL), import(/* @vite-ignore */ engineUrl)]);
  return core.readChordPages(pages, engine, opts);
}

async function readChordSheets(pages, opts = {}) {
  if (!pages || !pages.length) throw new Error("no page to read");
  const engineUrl = typeof window !== "undefined" && window.__TTP_ENGINE_URL__;
  if (!engineUrl) throw new Error("the engine isn't loaded yet — try again in a moment");
  const { onProgress, style } = opts;
  let w = null;
  try { w = new Worker(WORKER_URL, { type: "module" }); } catch (_) { w = null; }
  if (!w) return onMainThread(pages, engineUrl, { onProgress, style });
  try {
    return await (await jobs()).run(w, { id: 1, pages, engineUrl, style }, pages.map((p) => p.data.buffer), {
      onStall: opts.onStall,
      onMessage: (m) => {
        if (m.type === "progress") { if (onProgress) { try { onProgress(m.done, m.total, m.page); } catch (_) {} } return null; }
        if (m.type === "result") return { result: m.result };
        return { error: new Error(m.message || "chord reading failed") };
      },
    });
  } finally {
    try { w.terminate(); } catch (_) { /* gone */ }
  }
}

try {
  if (typeof window !== "undefined") window.TTP_CHORD_OCR = readChordSheets; readChordSheets.cancel = cancelChordOcr;
} catch (_) { /* never wedge boot */ }
