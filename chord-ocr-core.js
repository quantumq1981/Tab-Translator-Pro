/* ==========================================================================
 * chord-ocr-core.js — runs the chord-symbol recogniser (docs/OMR-PLAN.md).
 * Browser-only glue; page layout, the model input, CTC decoding, the chord grammar
 * and page → chart are the pure engine's (`readChordPage` / `chordPageLayout` /
 * `chordOcrInput` / `chordOcrRead` / `chordPageScore`), validated headlessly
 * (tests/chord-ocr.mjs) and measured on rendered lead sheets (docs/OMR-PLAN.md).
 *
 * Model: our own small CTC recogniser (CNN + bidirectional GRU, ~0.6 M parameters),
 * trained only on synthetic chord images (scripts/chord-ocr/), same-origin, SHA-256
 * pinned, Cache-API cached. Input: [1, 1, 32, W] (ink = 1); output: [1, W/4, classes].
 *
 * Runtime: the SAME pinned ONNX Runtime Web build and iOS rails as the stem separator
 * (imported from stem-model-core.js): plain WASM 1.23.2 (ORT ≥ 1.24 breaks on
 * JavaScriptCore, microsoft/onnxruntime#33426), single thread, the WASM-reservation cap.
 * ========================================================================== */
const BUILD_QS = (() => { try { return new URL(import.meta.url).search; } catch (_) { return ""; } })();
const STEM_CORE_URL = new URL("./stem-model-core.js" + BUILD_QS, import.meta.url).href;
let _stemCore = null;
const stemCore = () => _stemCore || (_stemCore = import(/* @vite-ignore */ STEM_CORE_URL).catch((e) => { _stemCore = null; throw e; }));

export const CHORD_OCR_MODEL = {
  url: new URL("./models/chord-ocr/chord-ocr.onnx", import.meta.url).href,
  sha256: "__PIN__",
};

/* Weights: Cache API first, else a fetch; the bytes must match the pinned SHA-256 either way
 * (a partial download or a stale file is refused, and a bad cached copy is evicted). */
export async function chordOcrModelBytes(model = CHORD_OCR_MODEL, scope = globalThis) {
  const { sha256Hex } = await stemCore();
  let cache = null;
  try { cache = scope.caches ? await scope.caches.open("ttp-models") : null; } catch (_) { cache = null; }
  const key = `${model.url}#${model.sha256}`;
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) {
        const b = new Uint8Array(await hit.arrayBuffer());
        if (await sha256Hex(b) === model.sha256) return b;
        await cache.delete(key);
      }
    } catch (_) { /* fall through to the network */ }
  }
  const res = await scope.fetch(model.url);
  if (!res.ok) throw new Error(`could not download the chord reader (HTTP ${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const got = await sha256Hex(bytes);
  if (got !== model.sha256) throw new Error(`the chord reader failed its integrity check (SHA-256 ${got.slice(0, 12)}…, expected ${model.sha256.slice(0, 12)}…) — reload and try again`);
  if (cache) { try { await cache.put(key, new Response(bytes)); } catch (_) { /* quota: fine, just not cached */ } }
  return bytes;
}

/* One session for every page. Returns `run(data, width) → { logits, frames, classes }` —
 * exactly the per-box contract the engine's `readChordPage` takes. */
export async function chordOcrSession(bytes, ortImport = (u) => import(/* @vite-ignore */ u)) {
  const { ORT_WASM_PATHS, capWasmMemory } = await stemCore();
  capWasmMemory();
  const mod = await ortImport(ORT_WASM_PATHS + "ort.wasm.min.mjs");
  const ort = mod.default || mod;
  if (ort.env && ort.env.wasm) { ort.env.wasm.wasmPaths = ORT_WASM_PATHS; ort.env.wasm.numThreads = 1; }
  const s = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], enableCpuMemArena: false, enableMemPattern: false });
  const inName = s.inputNames[0], outName = s.outputNames[0];
  return {
    async run(data, width) {
      const r = await s.run({ [inName]: new ort.Tensor("float32", data, [1, 1, 32, width]) });
      const o = r[outName];
      return { logits: Float32Array.from(o.data), frames: o.dims[1], classes: o.dims[2] };
    },
    release() { try { const p = s.release && s.release(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* already gone */ } },
  };
}

/* The whole job: weights → session → engine.readChordPage per page → { pages: [{ layout, reads }] }. */
export async function readChordPages(pages, engine, opts = {}) {
  if (!pages || !pages.length) throw new Error("no page to read");
  const bytes = await chordOcrModelBytes();
  const sess = await chordOcrSession(bytes);
  try {
    const out = [];
    let firstBar = 1;                       // the bar each page starts on (a printed number overrides it)
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const r = await engine.readChordPage({ data: p.data, width: p.width, height: p.height }, (d, w) => sess.run(d, w),
        { firstBar, onProgress: (done, total) => { if (opts.onProgress) opts.onProgress(done, total, i); } });
      out.push(r);
      firstBar = (r.layout.firstNumber != null ? r.layout.firstNumber : firstBar) + r.layout.bars;
    }
    return { pages: out };
  } finally { sess.release(); }
}
