/* ==========================================================================
 * beat-worker.js — module Worker that runs the beat_this beat + downbeat tracker
 * off the main thread. Spawned by beat-model.js; never loaded at boot.
 *
 * Message in : { id, pcm, sampleRate, engineUrl }   (pcm = mono Float32Array, transferred)
 * Messages out: { id, type:"stage", stage } / { id, type:"progress", done, total } … then
 *               { id, type:"result", beats, downbeats } or { id, type:"error", message }
 * ========================================================================== */
const CORE_URL = new URL("./beat-model-core.js" + new URL(import.meta.url).search, import.meta.url).href;
let _core = null;
const core = () => _core || (_core = import(/* @vite-ignore */ CORE_URL).catch((e) => { _core = null; throw e; }));
self.onmessage = async (ev) => {
  // the message object is the job: trackBeatsJob takes job.pcm and clears it, so the audio is released
  // before the model loads (don't destructure pcm here — that would keep it alive for the whole run)
  const job = ev.data || {};
  const { id, engineUrl } = job;
  try {
    const [c, engine] = await Promise.all([core(), import(/* @vite-ignore */ engineUrl)]);
    const res = await c.trackBeatsJob(job, engine, {
      onProgress: (done, total) => self.postMessage({ id, type: "progress", done, total }),
      onStage: (stage) => self.postMessage({ id, type: "stage", stage }),
    });
    self.postMessage({ id, type: "result", beats: res.beats, downbeats: res.downbeats });
  } catch (err) {
    self.postMessage({ id, type: "error", message: String((err && err.message) || err) });
  }
};
