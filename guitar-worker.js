/* ==========================================================================
 * guitar-worker.js — module Worker that runs guitar note transcription off the
 * main thread. Spawned by guitar-model.js; never loaded at boot.
 *
 * Why a worker: single-threaded WASM inference is minutes for a full song (GitHub
 * Pages can't send COOP/COEP, so no threads). The post-processing + fingering run
 * here too, in the SAME engine the page uses (imported from its Blob URL).
 *
 * Message in : { id, pcm, engineUrl, keepOnset? }   (pcm = mono 16 kHz Float32Array, transferred)
 * Messages out: { id, type:"progress", done, total } … then
 *               { id, type:"result", notes, onset? } or { id, type:"error", message }
 * ========================================================================== */
const CORE_URL = new URL("./guitar-model-core.js" + new URL(import.meta.url).search, import.meta.url).href;
let _core = null;
const core = () => _core || (_core = import(/* @vite-ignore */ CORE_URL).catch((e) => { _core = null; throw e; }));
self.onmessage = async (ev) => {
  const { id, pcm, engineUrl, keepOnset } = ev.data || {};
  try {
    const [c, engine] = await Promise.all([core(), import(/* @vite-ignore */ engineUrl)]);
    const res = await c.transcribeGuitarPcm(pcm, engine, { keepOnset, onProgress: (done, total) => self.postMessage({ id, type: "progress", done, total }) });
    if (res.onset) self.postMessage({ id, type: "result", notes: res.notes, onset: res.onset }, [res.onset.buffer]);
    else self.postMessage({ id, type: "result", notes: res.notes });
  } catch (err) {
    self.postMessage({ id, type: "error", message: String((err && err.message) || err) });
  }
};
