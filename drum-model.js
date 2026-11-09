/* ==========================================================================
 * drum-model.js — publishes window.TTP_DRUM_MODEL(pcm, sampleRate, opts)
 * → Promise<transcribeDrumEvents result> for the stems panel's drum chart.
 *
 * Loaded at boot but does nothing until called: the 4.9 MB model, ONNX Runtime and
 * the worker are fetched on first use only. Runs in a module Worker (drum-worker.js)
 * that imports the app's own transpiled engine (window.__TTP_ENGINE_URL__). Only a
 * browser that cannot construct a module Worker runs it on the main thread — a failed
 * worker run is NOT retried there (minutes of WASM on the page's thread froze an old
 * iPad; same rule as the stem separator). The worker is ended after each job (a WASM
 * heap never shrinks). Never throws at boot. See drum-model-core.js.
 * ========================================================================== */
const BUILD_QS = (() => { try { return new URL(import.meta.url).search; } catch (_) { return ""; } })();
const WORKER_URL = new URL("./drum-worker.js" + BUILD_QS, import.meta.url);
const CORE_URL = new URL("./drum-model-core.js" + BUILD_QS, import.meta.url).href;

async function onMainThread(pcm, sampleRate, engineUrl, opts) {
  const [core, engine] = await Promise.all([import(/* @vite-ignore */ CORE_URL), import(/* @vite-ignore */ engineUrl)]);
  return core.transcribeDrumPcm(pcm, sampleRate, engine, opts);
}

async function transcribeDrumAudio(pcm, sampleRate, opts = {}) {
  if (!pcm || !pcm.length) throw new Error("no audio to transcribe");
  const engineUrl = typeof window !== "undefined" && window.__TTP_ENGINE_URL__;
  if (!engineUrl) throw new Error("the engine isn't loaded yet — try again in a moment");
  const { onProgress, ...rest } = opts;
  const copy = opts.transfer ? pcm : Float32Array.from(pcm);     // transferred to the worker
  let w = null;
  try { w = new Worker(WORKER_URL, { type: "module" }); } catch (_) { w = null; }
  if (!w) return onMainThread(copy, sampleRate, engineUrl, { ...rest, onProgress });
  delete rest.transfer;
  try {
    return await new Promise((resolve, reject) => {
      w.onmessage = (ev) => {
        const m = ev.data || {};
        if (m.type === "progress") { if (onProgress) { try { onProgress(m.done, m.total); } catch (_) {} } return; }
        if (m.type === "result") resolve(m.result);
        else reject(new Error(m.message || "drum transcription failed"));
      };
      w.onerror = (e) => reject(new Error((e && e.message) || "drum worker crashed"));
      w.postMessage({ id: 1, pcm: copy, sampleRate, engineUrl, opts: rest }, [copy.buffer]);
    });
  } finally {
    try { w.terminate(); } catch (_) { /* gone */ }
  }
}

try {
  if (typeof window !== "undefined") window.TTP_DRUM_MODEL = transcribeDrumAudio;
} catch (_) { /* never wedge boot */ }
