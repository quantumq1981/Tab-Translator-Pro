/* ==========================================================================
 * drum-worker.js — module Worker that runs drum transcription off the main thread.
 * Spawned by drum-model.js; never loaded at boot. The features, decoding and grid
 * run here too, in the SAME engine the page uses (imported from its Blob URL).
 *
 * Message in : { id, pcm, sampleRate, engineUrl, opts }   (pcm = mono Float32Array, transferred)
 * Messages out: { id, type:"progress", done, total } … then
 *               { id, type:"result", result } or { id, type:"error", message }
 * ========================================================================== */
const CORE_URL = new URL("./drum-model-core.js" + new URL(import.meta.url).search, import.meta.url).href;
let _core = null;
const core = () => _core || (_core = import(/* @vite-ignore */ CORE_URL).catch((e) => { _core = null; throw e; }));
self.onmessage = async (ev) => {
  const { id, pcm, sampleRate, engineUrl, opts } = ev.data || {};
  try {
    const [c, engine] = await Promise.all([core(), import(/* @vite-ignore */ engineUrl)]);
    const result = await c.transcribeDrumPcm(pcm, sampleRate, engine, { ...(opts || {}), onProgress: (done, total) => self.postMessage({ id, type: "progress", done, total }) });
    self.postMessage({ id, type: "result", result });
  } catch (err) {
    self.postMessage({ id, type: "error", message: String((err && err.message) || err) });
  }
};
