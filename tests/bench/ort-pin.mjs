/* ORT pin check: does the pinned ONNX Runtime Web (1.23.2) separate EXACTLY like the 1.30.0 the vendored
 * library imports? Runs the same SCNet session on both releases' plain WASM builds (single thread, the
 * options stem-model-core.js uses) on a fixed pseudo-random spectrogram and compares the outputs bit for
 * bit, plus create time, run time and peak RSS.
 *
 *   node bench/ort-pin.mjs --a <dir with onnxruntime-web@1.30.0> --b <dir with onnxruntime-web@1.23.2> [--full <scnet.int8.onnx>]
 *
 * Each dir is an npm project (`npm i onnxruntime-web@<ver>`). Without --full only the committed compact
 * model is checked; --full adds the full-size model (the library's pinned Hugging Face file, SHA-256
 * 98228931…). Each release runs in its own process, so the two runtimes never share globals.
 *
 * Why this exists (2026-10-23): ORT ≥ 1.24 ships Abseil 20250814, which JavaScriptCore miscompiles —
 * session creation fails with "Could not find OrtValue with name '…'" on device (microsoft/onnxruntime
 * #33426). The app pins 1.23.2 for every WASM session; this proves the pin costs nothing in quality.
 * Measured 2026-10-23 (Linux x64, Node 22, two runs): compact AND full outputs bit-identical (max |Δ| = 0),
 * peak RSS within ~4 % (full: 1554–1565 vs 1614–1615 MB), steady-state run time within noise.
 */
import fs from "node:fs"; import path from "node:path"; import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const here = fileURLToPath(import.meta.url), repo = path.resolve(path.dirname(here), "..", "..");
const COMPACT = path.join(repo, "models", "scnet-compact", "scnet-f120.int8.onnx");

if (arg("child")) {
  // child: one release, one model → stats on stdout, raw output to --dump
  const [dir, model, frames, level, dump] = [arg("child"), arg("model"), +arg("frames"), arg("level"), arg("dump")];
  const mod = await import(pathToFileURL(path.join(dir, "node_modules/onnxruntime-web/dist/ort.wasm.min.mjs")).href);
  const ort = mod.default ?? mod;
  ort.env.wasm.numThreads = 1; ort.env.logLevel = "error";
  const bytes = new Uint8Array(fs.readFileSync(model));
  let peak = 0; const tick = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 20);
  const t0 = performance.now();
  const s = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], enableCpuMemArena: false, enableMemPattern: false, ...(level === "default" ? {} : { graphOptimizationLevel: level }) });
  const createMs = performance.now() - t0;
  const x = new Float32Array(4 * 2049 * frames); let seed = 1;
  for (let i = 0; i < x.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; x[i] = (seed / 0x7fffffff - 0.5) * 0.2 * Math.exp(-(i % 2049) / 600); }
  const runMs = []; let o;
  for (let k = 0; k < 2; k++) { const t = performance.now(); o = (await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", x, [1, 4, 2049, frames]) }))[s.outputNames[0]]; runMs.push(performance.now() - t); }
  clearInterval(tick); peak = Math.max(peak, process.memoryUsage().rss);
  fs.writeFileSync(dump, Buffer.from(o.data.buffer, o.data.byteOffset, o.data.byteLength));
  console.log(JSON.stringify({ version: JSON.parse(fs.readFileSync(path.join(dir, "node_modules/onnxruntime-web/package.json"), "utf8")).version, createMs: Math.round(createMs), runMs: runMs.map(Math.round), peakRssMB: Math.round(peak / 2 ** 20) }));
  process.exit(0);
}

const A = arg("a"), B = arg("b"), FULL = arg("full");
if (!A || !B) { console.error("usage: node bench/ort-pin.mjs --a <onnxruntime-web@1.30.0 dir> --b <onnxruntime-web@1.23.2 dir> [--full <scnet.int8.onnx>]"); process.exit(2); }
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "ort-pin-"));
const cases = [{ name: "compact (low-memory)", model: COMPACT, frames: 120, level: "disabled" }];
if (FULL) cases.push({ name: "full", model: FULL, frames: 476, level: "default" });
let ok = true;
for (const c of cases) {
  const runs = [A, B].map((dir, i) => {
    const dump = path.join(tmp, `${i}.bin`);
    const r = spawnSync(process.execPath, [here, "--child", dir, "--model", c.model, "--frames", String(c.frames), "--level", c.level, "--dump", dump], { encoding: "utf8" });
    if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
    return { ...JSON.parse(r.stdout.trim().split("\n").pop()), out: new Float32Array(new Uint8Array(fs.readFileSync(dump)).buffer) };
  });
  const [a, b] = runs.map((r) => r.out);
  let maxAbs = 0, err = 0, pow = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > maxAbs) maxAbs = d; err += d * d; pow += a[i] * a[i]; }
  const same = a.length === b.length && maxAbs === 0;
  ok = ok && same;
  console.log(JSON.stringify({ model: c.name, [runs[0].version]: { createMs: runs[0].createMs, runMs: runs[0].runMs, peakRssMB: runs[0].peakRssMB }, [runs[1].version]: { createMs: runs[1].createMs, runMs: runs[1].runMs, peakRssMB: runs[1].peakRssMB }, maxAbsDiff: maxAbs, relErrDb: pow ? +(10 * Math.log10(err / pow || 1e-30)).toFixed(1) : null, bitIdentical: same }));
}
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(ok ? 0 : 1);
