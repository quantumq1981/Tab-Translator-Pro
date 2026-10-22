/* ==========================================================================
 * stem-worker.js — module Worker that runs SCNet stem separation off the main
 * thread. Spawned by stem-model.js; never loaded at boot.
 *
 * Why a worker: GitHub Pages can't send COOP/COEP, so ONNX Runtime's WASM runs
 * single-threaded — a 4-minute song is minutes of compute that would freeze the
 * page on the main thread. WebGPU (when the device has it) is used from here too.
 *
 * Message in : { id, left, right, sampleRate, opts:{ device, step, blockSec, compact } }
 * Messages out: { id, type:"progress", done, total } … then
 *               { id, type:"result", sampleRate, stems:{ vocals:[L,R], drums, bass, other } }
 *               or { id, type:"error", message }
 * ========================================================================== */
import { separateInBlocks } from "./stem-model-core.js";

self.onmessage = async (ev) => {
  const { id, left, right, sampleRate, opts } = ev.data || {};
  try {
    const res = await separateInBlocks(left, right, sampleRate, {
      ...(opts || {}),
      onProgress: (done, total) => self.postMessage({ id, type: "progress", done, total }),
    });
    const transfer = [];
    for (const k of Object.keys(res.stems)) for (const ch of res.stems[k]) transfer.push(ch.buffer);
    self.postMessage({ id, type: "result", sampleRate: res.sampleRate, stems: res.stems, device: res.device, compact: res.compact }, transfer);
  } catch (err) {
    self.postMessage({ id, type: "error", message: String((err && err.message) || err) });
  }
};
