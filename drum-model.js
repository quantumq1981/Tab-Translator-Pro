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
const JOB_URL = new URL("./model-job.js" + BUILD_QS, import.meta.url).href;
// one job at a time, with Cancel + a stall watch (audit 2026-11-18 m6; see model-job.js)
let _jobs = null;
const jobs = async () => _jobs || (_jobs = (await import(/* @vite-ignore */ JOB_URL)).createJobRunner("drum transcription"));
export function cancelDrums() { return _jobs ? _jobs.cancel() : false; }

async function onMainThread(pcm, sampleRate, engineUrl, opts) {
  const [core, engine] = await Promise.all([import(/* @vite-ignore */ CORE_URL), import(/* @vite-ignore */ engineUrl)]);
  return core.transcribeDrumPcm(pcm, sampleRate, engine, opts);
}

async function transcribeDrumAudio(pcm, sampleRate, opts = {}) {
  if (!pcm || !pcm.length) throw new Error("no audio to transcribe");
  const engineUrl = typeof window !== "undefined" && window.__TTP_ENGINE_URL__;
  if (!engineUrl) throw new Error("the engine isn't loaded yet — try again in a moment");
  const { onProgress, onStall, ...rest } = opts;
  const copy = opts.transfer ? pcm : Float32Array.from(pcm);     // transferred to the worker
  let w = null;
  try { w = new Worker(WORKER_URL, { type: "module" }); } catch (_) { w = null; }
  if (!w) return onMainThread(copy, sampleRate, engineUrl, { ...rest, onProgress });
  delete rest.transfer;
  try {
    return await (await jobs()).run(w, { id: 1, pcm: copy, sampleRate, engineUrl, opts: rest }, [copy.buffer], {
      onStall,
      onMessage: (m) => {
        if (m.type === "progress") { if (onProgress) { try { onProgress(m.done, m.total); } catch (_) {} } return null; }
        if (m.type === "result") return { result: m.result };
        return { error: new Error(m.message || "drum transcription failed") };
      },
    });
  } finally {
    try { w.terminate(); } catch (_) { /* gone */ }
  }
}

try {
  if (typeof window !== "undefined") window.TTP_DRUM_MODEL = transcribeDrumAudio; transcribeDrumAudio.cancel = cancelDrums;
} catch (_) { /* never wedge boot */ }
