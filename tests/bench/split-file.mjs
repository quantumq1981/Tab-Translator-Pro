/* Split a real audio file into stems with the app's own separator core (stem-model-core.js +
 * the vendored library), in Node, with the ONNX session supplied by onnxruntime-node instead of
 * the browser's WASM build — same weights, same STFT/blocking/cross-fade code, much faster.
 *
 *   node bench/split-file.mjs --audio <file.mp3|.m4a|.wav> --model <scnet.int8.onnx> --ort <dir with onnxruntime-node> --out <dir>
 *
 * --model: the library's pinned full model (hf audiojs/scnet scnet.int8.onnx @ e71bcdb4…, SHA-256 98228931…)
 *          or the committed compact one (models/scnet-compact/scnet-f120.int8.onnx, add --compact 1).
 * Writes <out>/<stem>.f32 (interleaved stereo float32 at 44.1 kHz) + <out>/meta.json. Dev-only. */
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process";
import { createRequire } from "node:module"; import { fileURLToPath } from "node:url";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const AUDIO = arg("audio"), MODEL = arg("model"), ORT = arg("ort"), OUT = arg("out"), compact = arg("compact") === "1";
if (!AUDIO || !MODEL || !ORT || !OUT) { console.error("--audio --model --ort --out are required"); process.exit(2); }
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ort = createRequire(path.join(ORT, "x.js"))("onnxruntime-node");
fs.mkdirSync(OUT, { recursive: true });

const SR = 44100;
const raw = execFileSync("ffmpeg", ["-v", "error", "-i", AUDIO, "-ac", "2", "-ar", String(SR), "-f", "f32le", "-"], { maxBuffer: 2 ** 31 });
const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4), n = all.length / 2;
const L = new Float32Array(n), R = new Float32Array(n);
for (let i = 0; i < n; i++) { L[i] = all[2 * i]; R[i] = all[2 * i + 1]; }

// The bundle picks its Node or browser path from process.release.name once, at load; the browser path
// with our session hook never fetches anything.
Object.defineProperty(process, "release", { value: { name: "browser-bench" }, configurable: true });
const core = await import(path.join(repo, "stem-model-core.js"));
const sess = await ort.InferenceSession.create(MODEL, { intraOpNumThreads: 4, graphOptimizationLevel: compact ? "disabled" : "all" });
const inName = sess.inputNames[0], outName = sess.outputNames[0];
const frames = compact ? core.COMPACT_MODEL.frames : 476;
const session = async () => ({
  inputs: [{ name: inName, dims: [1, 4, 2049, frames] }], outputs: [{ name: outName, dims: [1, 16, 2049, frames] }],
  async run(feeds) {
    const f = feeds[inName];
    const r = await sess.run({ [inName]: new ort.Tensor("float32", f.data, f.dims) });
    const o = r[outName];
    return { [outName]: { data: o.data, dims: o.dims, type: "float32" } };
  },
  free() {},
});
const t0 = Date.now(); let last = 0;
const res = await core.separateInBlocks(L, R, SR, {
  session, compact, onProgress: (d, t) => { const now = Date.now(); if (now - last > 15000) { last = now; console.log(`${(100 * d / t).toFixed(0)}% · ${((now - t0) / 1000).toFixed(0)} s`); } },
});
const secs = (Date.now() - t0) / 1000;
for (const k of core.STEM_NAMES) {
  const [a, b] = res.stems[k], out = new Float32Array(2 * n);
  for (let i = 0; i < n; i++) { out[2 * i] = a[i]; out[2 * i + 1] = b[i]; }
  fs.writeFileSync(path.join(OUT, k + ".f32"), Buffer.from(out.buffer));
}
fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify({ audio: path.basename(AUDIO), sampleRate: SR, channels: 2, seconds: n / SR, stems: core.STEM_NAMES, splitSec: secs, model: path.basename(MODEL) }, null, 1));
console.log(`split ${(n / SR).toFixed(1)} s in ${secs.toFixed(0)} s (${(secs / (n / SR)).toFixed(2)}× real time) → ${OUT}`);
