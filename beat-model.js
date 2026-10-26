/* ==========================================================================
 * beat-model.js — publishes window.TTP_BEAT_MODEL(pcm, sampleRate, { onProgress })
 * → Promise<{ beats, downbeats }> (seconds) for the Audio panel's "Tempo & bars".
 *
 * The learned beat + downbeat tracker beat_this (CPJKU, MIT; final0, converted with
 * scripts/beatthis_export.py). Loaded at boot but does nothing until called: the 24.1 MB
 * model and ONNX Runtime are fetched on first use only. Runs in a module Worker
 * (beat-worker.js) that imports the app's own transpiled engine
 * (window.__TTP_ENGINE_URL__), so the spectrogram, windows and peak picking are the SAME
 * code the headless tests hold to beat_this's own. Falls back to the main thread only
 * when a module Worker can't be built. The worker is ended after each job (a WASM heap
 * never shrinks). Never throws at boot. See beat-model-core.js for the model + runtime.
 * ========================================================================== */
const BUILD_QS = (() => { try { return new URL(import.meta.url).search; } catch (_) { return ""; } })();
const WORKER_URL = new URL("./beat-worker.js" + BUILD_QS, import.meta.url);
const CORE_URL = new URL("./beat-model-core.js" + BUILD_QS, import.meta.url).href;

async function onMainThread(pcm, sampleRate, engineUrl, opts) {
  const [core, engine] = await Promise.all([import(/* @vite-ignore */ CORE_URL), import(/* @vite-ignore */ engineUrl)]);
  return core.trackBeatsPcm(pcm, sampleRate, engine, opts);
}

async function trackBeatsAudio(pcm, sampleRate, opts = {}) {
  if (!pcm || !pcm.length) throw new Error("no audio to track");
  const engineUrl = typeof window !== "undefined" && window.__TTP_ENGINE_URL__;
  if (!engineUrl) throw new Error("the engine isn't loaded yet — try again in a moment");
  const copy = Float32Array.from(pcm);                         // a copy: it is transferred
  let w = null;
  try { w = new Worker(WORKER_URL, { type: "module" }); } catch (_) { w = null; }
  if (!w) return onMainThread(copy, sampleRate, engineUrl, opts);
  try {
    return await new Promise((resolve, reject) => {
      w.onmessage = (ev) => {
        const m = ev.data || {};
        if (m.type === "progress") { if (opts.onProgress) opts.onProgress(m.done, m.total); return; }
        if (m.type === "result") resolve({ beats: m.beats, downbeats: m.downbeats });
        else reject(new Error(m.message || "beat tracking failed"));
      };
      w.onerror = (e) => reject(new Error((e && e.message) || "beat worker crashed"));
      w.postMessage({ id: 1, pcm: copy, sampleRate, engineUrl }, [copy.buffer]);
    });
  } finally {
    try { w.terminate(); } catch (_) { /* gone */ }
  }
}

try {
  if (typeof window !== "undefined") window.TTP_BEAT_MODEL = trackBeatsAudio;
} catch (_) { /* never wedge boot */ }
