// SMT on onnxruntime-web 1.23.2, single-thread WASM in Node (the app's phone runtime): speed, memory, SER.
import fs from "node:fs";
const S = process.argv[2], D = process.argv[3], N = +(process.argv[4] || 8);
const ort = (await import(S + "/ortweb/node_modules/onnxruntime-web/dist/ort.wasm.min.mjs")).default;
ort.env.wasm.numThreads = 1; ort.env.logLevel = "error";
const cfg = JSON.parse(fs.readFileSync(S + "/smt-w/config.json")); const i2w = cfg.i2w, bos = cfg.w2i["<bos>"];
let peak = 0; const tick = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 20);
const opt = { executionProviders: ["wasm"], enableCpuMemArena: false, enableMemPattern: false };
const t0 = performance.now();
const E = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(D + "/smt-enc.onnx")), opt);
const Dd = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(D + "/smt-dec.onnx")), opt);
const createMs = performance.now() - t0;
const meta = JSON.parse(fs.readFileSync(S + "/webimgs/meta.json"));
const ed = (a, b) => { let d = [...Array(b.length + 1).keys()]; for (let i = 1; i <= a.length; i++) { let p = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] !== b[j - 1])); p = t; } } return d[b.length]; };
let err = 0, tot = 0, encMs = 0, tokMs = 0, ntok = 0;
for (let k = 0; k < N; k++) {
  const m = meta[k]; const buf = fs.readFileSync(`${S}/webimgs/${k}.f32`);
  const x = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  let t = performance.now();
  const { crossK, crossV } = await E.run({ image: new ort.Tensor("float32", x, [1, 1, m.h, m.w]) });
  encMs += performance.now() - t; t = performance.now();
  let pK = new ort.Tensor("float32", new Float32Array(0), [8, 4, 0, 64]), pV = pK, tok = bos; const out = [];
  for (let s = 0; s < 1280; s++) {
    const r = await Dd.run({ token: new ort.Tensor("int64", BigInt64Array.from([BigInt(tok)]), [1, 1]), step: new ort.Tensor("int64", BigInt64Array.from([BigInt(s)]), [1]), crossK, crossV, pastK: pK, pastV: pV });
    const lg = r.logits.data; let best = 0; for (let i = 1; i < lg.length; i++) if (lg[i] > lg[best]) best = i;
    pK = r.presentK; pV = r.presentV; tok = best;
    if (i2w[best] === "<eos>") break; out.push(i2w[best]);
  }
  tokMs += performance.now() - t; ntok += out.length + 1;
  err += ed(out, m.gt); tot += m.gt.length;
}
clearInterval(tick); peak = Math.max(peak, process.memoryUsage().rss);
console.log(JSON.stringify({ models: D.split("/").pop(), systems: N, SER: +(100 * err / tot).toFixed(2), createMs: Math.round(createMs), encMsPerSystem: Math.round(encMs / N), msPerToken: +(tokMs / ntok).toFixed(1), secPerSystem: +((encMs + tokMs) / N / 1000).toFixed(2), meanTokens: Math.round(ntok / N), peakRssMB: Math.round(peak / 2 ** 20) }));
process.exit(0);
