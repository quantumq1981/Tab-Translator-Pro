/* ==========================================================================
 * guitar-model.js — publishes window.TTP_GUITAR_MODEL(pcm16k, { onProgress })
 * → Promise<{ notes }> for the Audio panel's "🎸 Guitar → Tab (ML)" button.
 *
 * Loaded at boot but does nothing until called: the 25 MB model, ONNX Runtime and
 * the worker are fetched on first use only. Runs in a module Worker
 * (guitar-worker.js) that imports the app's own transpiled engine
 * (window.__TTP_ENGINE_URL__), so the notes come out of the SAME validated
 * post-processor + fingering the headless tests pin. Falls back to the main thread
 * if Workers are unavailable. The worker is ended after each job (a WASM heap never
 * shrinks). Never throws at boot. See guitar-model-core.js for the model + runtime.
 * ========================================================================== */
const BUILD_QS = (() => { try { return new URL(import.meta.url).search; } catch (_) { return ""; } })();
const WORKER_URL = new URL("./guitar-worker.js" + BUILD_QS, import.meta.url);
const CORE_URL = new URL("./guitar-model-core.js" + BUILD_QS, import.meta.url).href;

async function onMainThread(pcm, engineUrl, opts) {
  const [core, engine] = await Promise.all([import(/* @vite-ignore */ CORE_URL), import(/* @vite-ignore */ engineUrl)]);
  return core.transcribeGuitarPcm(pcm, engine, opts);
}

async function transcribeGuitarAudio(pcm16k, opts = {}) {
  if (!pcm16k || !pcm16k.length) throw new Error("no audio to transcribe");
  const engineUrl = typeof window !== "undefined" && window.__TTP_ENGINE_URL__;
  if (!engineUrl) throw new Error("the engine isn't loaded yet — try again in a moment");
  const pcm = Float32Array.from(pcm16k);                       // a copy: it is transferred
  let w = null;
  try { w = new Worker(WORKER_URL, { type: "module" }); } catch (_) { w = null; }
  if (!w) return onMainThread(pcm, engineUrl, opts);
  try {
    return await new Promise((resolve, reject) => {
      w.onmessage = (ev) => {
        const m = ev.data || {};
        if (m.type === "progress") { if (opts.onProgress) opts.onProgress(m.done, m.total); return; }
        if (m.type === "result") resolve({ notes: m.notes });
        else reject(new Error(m.message || "guitar transcription failed"));
      };
      w.onerror = (e) => reject(new Error((e && e.message) || "guitar worker crashed"));
      w.postMessage({ id: 1, pcm, engineUrl }, [pcm.buffer]);
    });
  } catch (err) {
    if (/worker|module|import/i.test(String(err && err.message))) return onMainThread(Float32Array.from(pcm16k), engineUrl, opts);
    throw err;
  } finally {
    try { w.terminate(); } catch (_) { /* gone */ }
  }
}

try {
  if (typeof window !== "undefined") window.TTP_GUITAR_MODEL = transcribeGuitarAudio;
} catch (_) { /* never wedge boot */ }
