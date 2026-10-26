/* js-eval.mjs — the APP's beat_this path, headless: engine.tsx's front end (beatThisLogMel →
 * windows → aggregate → peaks) around the committed int8 model, on onnxruntime-web 1.23.2's plain
 * WASM build (single thread, as the app pins it). Writes <track>.beats.json for
 * `bench/beatgrid.mjs <gs dir> --learned <out>`, and reports speed + memory. Dev-only.
 *
 *   node bench/beatthis/js-eval.mjs <22.05 kHz wav dir> <out dir> --ort <dir with onnxruntime-web@1.23.2> [--model m.onnx]
 *        [--match solo] [--every N] [--limit N] [--no-pad]   (single-thread WASM is ~0.5× real time: subsample for a quick read)
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadEngine } from "../lib.mjs";

const argv = process.argv.slice(2), flag = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const [inDir, outDir] = argv;
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..");
const modelPath = flag("--model") || path.join(repo, "models/beat-this/beat_this_final0.w8.onnx");
const eng = await loadEngine();
const mod = await import(pathToFileURL(path.join(flag("--ort"), "node_modules/onnxruntime-web/dist/ort.wasm.min.mjs")).href);
const ort = mod.default ?? mod;
ort.env.wasm.numThreads = 1; ort.env.logLevel = "error";
const sess = await ort.InferenceSession.create(fs.readFileSync(modelPath), { executionProviders: ["wasm"], enableCpuMemArena: false, enableMemPattern: false });
const model = async (w) => {
  const r = await sess.run({ [sess.inputNames[0]]: new ort.Tensor("float32", w.data, [1, w.frames, 128]) });
  return { beat: Float32Array.from(r.beat.data), downbeat: Float32Array.from(r.downbeat.data) };
};
function readWav(file) {
  const b = fs.readFileSync(file), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 12, sr = 0, ch = 1, data = null;
  while (p + 8 <= b.length) { const id = b.toString("ascii", p, p + 4), sz = dv.getUint32(p + 4, true); if (id === "fmt ") { ch = dv.getUint16(p + 10, true); sr = dv.getUint32(p + 12, true); } if (id === "data") { data = [p + 8, sz]; break; } p += 8 + sz + (sz & 1); }
  const n = Math.floor(data[1] / 2 / ch), x = new Float32Array(n);
  for (let i = 0; i < n; i++) { let v = 0; for (let c = 0; c < ch; c++) v += dv.getInt16(data[0] + 2 * (i * ch + c), true); x[i] = v / ch / 32768; }
  return { sr, x };
}
fs.mkdirSync(outDir, { recursive: true });
const every = +(flag("--every") || 1), match = flag("--match");
const files = fs.readdirSync(inDir).filter((f) => f.endsWith(".wav") && (!match || f.includes(match))).sort()
  .filter((_, i) => i % every === 0).slice(0, +(flag("--limit") || 1e9));
let secAudio = 0, secRun = 0, peak = 0;
for (const f of files) {
  const { sr, x } = readWav(path.join(inDir, f));
  const pcm = sr === 22050 ? x : eng.resampleTo(x, sr, 22050);
  const t0 = performance.now();
  const r = await eng.trackBeatsWithModel(pcm, model, { padShort: !argv.includes("--no-pad") });
  secRun += (performance.now() - t0) / 1000; secAudio += pcm.length / 22050;
  peak = Math.max(peak, process.memoryUsage().rss);
  fs.writeFileSync(path.join(outDir, f.replace(/\.wav$/, ".beats.json")), JSON.stringify(r));
  process.stderr.write(".");
}
process.stderr.write("\n");
console.log(`${files.length} tracks · ${(secRun / secAudio).toFixed(3)}× real time (single-thread WASM) · peak RSS ${(peak / 1e6).toFixed(0)} MB`);
