/* ==========================================================================
 * chord-ocr-worker.js — module Worker that reads chord symbols off page images.
 * Spawned by chord-ocr-model.js; never loaded at boot. Layout, decoding and the
 * chord grammar run here too, in the SAME engine the page uses (its Blob URL).
 *
 * Message in : { id, pages:[{ data, width, height }], engineUrl }   (data transferred)
 * Messages out: { id, type:"progress", done, total, page } … then
 *               { id, type:"result", result } or { id, type:"error", message }
 * ========================================================================== */
const CORE_URL = new URL("./chord-ocr-core.js" + new URL(import.meta.url).search, import.meta.url).href;
let _core = null;
const core = () => _core || (_core = import(/* @vite-ignore */ CORE_URL).catch((e) => { _core = null; throw e; }));
self.onmessage = async (ev) => {
  const { id, pages, engineUrl } = ev.data || {};
  try {
    const [c, engine] = await Promise.all([core(), import(/* @vite-ignore */ engineUrl)]);
    const result = await c.readChordPages(pages, engine, { onProgress: (done, total, page) => self.postMessage({ id, type: "progress", done, total, page }) });
    self.postMessage({ id, type: "result", result });
  } catch (err) {
    self.postMessage({ id, type: "error", message: String((err && err.message) || err) });
  }
};
