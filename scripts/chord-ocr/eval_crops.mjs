// Recognition only: each crop (already a 32-px model input) → recogniser → engine.chordOcrRead.
// Right = same root, bass and tone set as the printed chord. Also: how often the reader is ≥80% sure and right.
import fs from "node:fs"; import path from "node:path";
import { loadEngine } from "../../tests/bench/lib.mjs";
const ort = (await import(path.resolve(process.env.ORT_WEB || "node_modules/onnxruntime-web/dist/ort.wasm.min.mjs"))).default;   // onnxruntime-web 1.23.2
ort.env.wasm.numThreads = 1; ort.env.logLevel = "error";
const [dir, model] = process.argv.slice(2), E = await loadEngine();
const sess = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(model)));
const idx = JSON.parse(fs.readFileSync(dir + "/inputs.json")), bin = fs.readFileSync(dir + "/inputs.bin");
const sig = (p) => p.rootPc + "|" + (p.bassPc ?? "") + "|" + p.formula.tones.map((t) => t.semi).sort((a, b) => a - b).join(",");
const st = {}; let off = 0; const bad = [];
for (const it of idx) {
  const n = 32 * it.w, f = new Float32Array(n); for (let i = 0; i < n; i++) f[i] = 1 - bin[off + i] / 255; off += n;
  const o = (await sess.run({ image: new ort.Tensor("float32", f, [1, 1, 32, it.w]) })).logits;
  const r = E.chordOcrRead(o.data, o.dims[1], o.dims[2]);
  const want = E.chordFromWritten(it.text.replace(/♯/g, "#").replace(/♭/g, "b"));
  const v = (st[it.split] ||= { n: 0, ok: 0, sure: 0, sureOk: 0, none: 0 });
  v.n++; const ok = !!(r && want && sig(r.parsed) === sig(want.parsed));
  if (ok) v.ok++; if (!r) v.none++; if (r && r.prob >= 0.8) { v.sure++; if (ok) v.sureOk++; }
  if (!ok && bad.length < 25) bad.push(it.text + "→" + (r ? r.raw : "∅"));
}
for (const [k, v] of Object.entries(st)) console.log(`${k}: right ${(100 * v.ok / v.n).toFixed(1)}% of ${v.n} · no read ${(100 * v.none / v.n).toFixed(1)}% · sure ${(100 * v.sure / v.n).toFixed(0)}%, of those right ${(100 * v.sureOk / v.sure).toFixed(1)}%`);
console.log(bad.join(" | "));
