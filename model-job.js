/* ==========================================================================
 * model-job.js — one worker job at a time per model loader, with Cancel and a stall watch
 * (audit 2026-11-18 m6). Shared by guitar-model.js, beat-model.js, drum-model.js and
 * chord-ocr-model.js; the stem separator has its own (stem-model.js) for its block protocol.
 *
 *   const jobs = createJobRunner("guitar transcription");
 *   jobs.run(worker, message, transfer, { onMessage, onStall })  → Promise
 *   jobs.cancel()  → true if a job was stopped (its promise rejects with err.cancelled = true)
 *
 * onMessage(m) handles each worker message and returns { result } or { error } to finish, or
 * nothing to keep waiting. onStall(seconds) is called once when the worker has been quiet for
 * longer than max(3 min, 4 × the longest gap seen so far) — a WebKit run that has stopped making
 * progress used to leave the panel busy for good. The worker is the caller's; it is terminated
 * on cancel, and the caller still ends it in its own finally.
 * ========================================================================== */
export const STALL_MIN_MS = 180000;

export function createJobRunner(label, { stallMinMs = STALL_MIN_MS, tickMs = 5000, now = () => Date.now() } = {}) {
  let job = null;
  function cancel() {
    const j = job; if (!j) return false;
    job = null;
    try { j.w.terminate(); } catch (_) { /* already gone */ }
    const err = new Error(`${label} cancelled`); err.cancelled = true;
    j.finish(j.reject, err);
    return true;
  }
  function run(w, message, transfer, { onMessage, onStall } = {}) {
    return new Promise((resolve, reject) => {
      let last = now(), gap = 0, warned = false, settled = false;
      const timer = setInterval(() => {
        const quiet = now() - last;
        if (!warned && quiet > Math.max(stallMinMs, 4 * gap)) { warned = true; try { if (onStall) onStall(Math.round(quiet / 1000)); } catch (_) { /* UI callback */ } }
      }, tickMs);
      const finish = (fn, v) => { if (settled) return; settled = true; clearInterval(timer); if (job && job.w === w) job = null; fn(v); };
      job = { w, reject, finish };
      w.onmessage = (ev) => {
        const t = now(); gap = Math.max(gap, t - last); last = t; warned = false;
        let r; try { r = onMessage ? onMessage(ev.data || {}) : null; } catch (e) { r = { error: e }; }
        if (r && "result" in r) finish(resolve, r.result);
        else if (r && r.error) finish(reject, r.error instanceof Error ? r.error : new Error(String(r.error)));
      };
      w.onerror = (e) => finish(reject, new Error((e && e.message) || `${label} worker crashed`));
      try { w.postMessage(message, transfer || []); } catch (e) { finish(reject, e); }
    });
  }
  return { run, cancel, active: () => !!job };
}
