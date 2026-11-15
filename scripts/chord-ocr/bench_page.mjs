// Real pages with hand-read truth (truth/*.json): page PNG → engine.readChordPage with a model → chords per
// system, matched in reading order (LCS on root + bass + tone set) → right, in the right bar, extra, missed.
//   node bench_page.mjs <truth.json> <model.onnx> <dir with the page PNGs>     (env ORT_WEB: ort.wasm.min.mjs 1.23.2)
// A page's systems are matched to staves by the staff's top-line y (±30 px), so render the PDF exactly as the
// truth file's "source" says. Extra = a chord read on a system that has no such chord there (or off-system).
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
import { loadEngine } from "../../tests/bench/lib.mjs";
const [truthF, model, dir] = process.argv.slice(2);
const ort = (await import(path.resolve(process.env.ORT_WEB || "node_modules/onnxruntime-web/dist/ort.wasm.min.mjs"))).default;
ort.env.wasm.numThreads = 1; ort.env.logLevel = "error";
const require = createRequire(path.resolve(process.env.PNGJS_FROM || "package.json"));
const { PNG } = require("pngjs");
const E = await loadEngine();
const sess = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(model)));
const run = async (data, width) => { const o = (await sess.run({ image: new ort.Tensor("float32", data, [1, 1, 32, width]) })).logits; return { logits: o.data, frames: o.dims[1], classes: o.dims[2] }; };
const sig = (n) => { const p = E.chordFromWritten(n).parsed; return p.rootPc + "|" + (p.bassPc ?? "") + "|" + p.formula.tones.map((t) => t.semi).sort((a, b) => a - b).join(","); };
const T = JSON.parse(fs.readFileSync(truthF)).pages;
let tp = 0, fp = 0, fn = 0, bar = 0, sure = 0, sureOk = 0, first = 1, n = 0; const miss = [], extra = [], per = [];
for (const [file, tr] of Object.entries(T)) {
  const png = PNG.sync.read(fs.readFileSync(path.join(dir, file))), ch = png.data.length / (png.width * png.height), g = new Uint8Array(png.width * png.height);
  for (let i = 0; i < g.length; i++) g[i] = ch >= 3 ? Math.round(0.299 * png.data[ch * i] + 0.587 * png.data[ch * i + 1] + 0.114 * png.data[ch * i + 2]) : png.data[ch * i];
  const { layout: L, reads } = await E.readChordPage({ data: g, width: png.width, height: png.height }, run, { firstBar: first });
  first = (L.firstNumber || first) + L.bars;
  const bySys = tr.systems.map(() => []), tp0 = tp, n0 = n, fp0 = fp;
  L.tokens.forEach((t, i) => {
    const r = reads[i]; if (!r) return;
    const st = L.staves[t.staff], k = tr.ys.findIndex((y) => Math.abs(y - st.a[0]) < 30);
    if (k < 0) { fp++; extra.push(`${file} off-system ${r.name}`); return; }
    bySys[k].push({ t, r, bis: t.bar - st.barFrom + 1 });
  });
  tr.systems.forEach((want, k) => {
    const got = bySys[k].sort((a, b) => a.t.x0 - b.t.x0), A = want.map((x) => sig(x[1])), B = got.map((x) => sig(x.r.name));
    const D = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
    for (let i = 1; i <= A.length; i++) for (let j = 1; j <= B.length; j++) D[i][j] = A[i - 1] === B[j - 1] ? D[i - 1][j - 1] + 1 : Math.max(D[i - 1][j], D[i][j - 1]);
    const mi = new Set(), mj = new Set();
    for (let i = A.length, j = B.length; i && j;) { if (A[i - 1] === B[j - 1]) { mi.add(i - 1); mj.add(j - 1); if (want[i - 1][0] === got[j - 1].bis) bar++; i--; j--; } else if (D[i - 1][j] >= D[i][j - 1]) i--; else j--; }
    n += A.length; tp += mi.size; fn += A.length - mi.size; fp += B.length - mj.size;
    want.forEach((x, q) => { if (!mi.has(q)) miss.push(`${file}#${k + 1} ${x[1]}`); });
    got.forEach((x, q) => { if (x.r.prob >= 0.8) { sure++; if (mj.has(q)) sureOk++; } if (!mj.has(q)) extra.push(`${file}#${k + 1} ${x.r.name}:${Math.round(100 * x.r.prob)}`); });
  });
  per.push(`${file}: ${tp - tp0}/${n - n0} right, ${fp - fp0} extra`);
}
console.log(`${n} chords: right ${tp} (${(100 * tp / n).toFixed(1)}%), in the right bar ${bar} · extra ${fp} · missed ${fn} · precision ${(100 * tp / (tp + fp)).toFixed(1)}% · ≥80% sure ${sure}, right ${sureOk}`);
console.log(per.join(" · "));
console.log("missed:", miss.join(", ")); console.log("extra:", extra.join(", "));
