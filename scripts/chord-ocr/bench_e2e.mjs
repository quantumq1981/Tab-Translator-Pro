// Page image → engine.readChordPage (layout + crops + recogniser on onnxruntime-web 1.23.2 WASM,
// 1 thread + CTC beam + chord grammar) → chords per bar, vs truth. Score: a truth chord counts when a
// read in the SAME bar, near the same x, has the same root, bass and tone set.
import fs from "node:fs"; import path from "node:path";
import { loadEngine } from "../../tests/bench/lib.mjs";
const ort = (await import(path.resolve(process.env.ORT_WEB || "node_modules/onnxruntime-web/dist/ort.wasm.min.mjs"))).default;   // onnxruntime-web 1.23.2
ort.env.wasm.numThreads = 1; ort.env.logLevel = "error";
const [dir, model, splitArg] = process.argv.slice(2);
const E = await loadEngine();
const sess = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(model)));
const run = async (data, width) => { const o = (await sess.run({ image: new ort.Tensor("float32", data, [1, 1, 32, width]) })).logits; return { logits: o.data, frames: o.dims[1], classes: o.dims[2] }; };
const sig = (p) => p.rootPc + "|" + (p.bassPc ?? "") + "|" + p.formula.tones.map((t) => t.semi).sort((a, b) => a - b).join(",");
const pages = JSON.parse(fs.readFileSync(dir + "/boxes.json")), truth = JSON.parse(fs.readFileSync("lead/truth.json"));
const st = {}; const bad = [];
for (const p of pages) {
  const sp = truth.find((x) => x.id === p.file).split; if (splitArg && sp !== splitArg) continue;
  const v = (st[sp] ||= { tp: 0, fp: 0, fn: 0, nameOk: 0, ms: 0, pages: 0, tok: 0, sure: 0, sureOk: 0 });
  const img = { data: new Uint8Array(fs.readFileSync(dir + "/" + p.png.replace(".png", ".raw"))), width: p.w, height: p.h };
  const t0 = performance.now();
  const { layout, reads } = await E.readChordPage(img, run);
  v.ms += performance.now() - t0; v.pages++; v.tok += layout.tokens.length;
  const got = layout.tokens.map((t, i) => ({ t, r: reads[i] })).filter((g) => g.r);
  const used = new Set();
  for (const h of p.harms) {
    const want = E.chordFromWritten(h.text).parsed, cx = (h.box[0] + h.box[2]) / 2;
    const k = got.findIndex((g, i) => !used.has(i) && cx >= g.t.x0 - 4 && cx <= g.t.x1 + 4 && Math.abs((h.box[1] + h.box[3]) / 2 - (g.t.y0 + g.t.y1) / 2) < 40);
    if (k < 0) { v.fn++; if (bad.length < 30) bad.push(h.text + "→∅"); continue; }
    used.add(k);
    const g = got[k], ok = sig(g.r.parsed) === sig(want);
    if (ok) v.nameOk++;
    if (g.r.prob >= 0.8) { v.sure++; if (ok) v.sureOk++; }
    if (ok && g.t.bar === h.measure) v.tp++; else { v.fn++; v.fp++; if (bad.length < 30) bad.push(h.text + "→" + g.r.raw + (ok ? "@bar" + g.t.bar + "≠" + h.measure : "")); }
  }
  v.fp += got.length - used.size;
}
for (const [k, v] of Object.entries(st)) {
  console.log(`${k} (${v.pages} pages) chord right in its bar: P ${(100 * v.tp / (v.tp + v.fp)).toFixed(1)} R ${(100 * v.tp / (v.tp + v.fn)).toFixed(1)} | name right ${(100 * v.nameOk / (v.tp + v.fn)).toFixed(1)}% | sure (≥0.8) ${(100 * v.sure / (v.nameOk + (v.tp + v.fn - v.nameOk))).toFixed(0)}% of chords, right ${(100 * v.sureOk / v.sure).toFixed(1)}% | ${(v.ms / v.pages).toFixed(0)} ms/page, ${(v.tok / v.pages).toFixed(0)} boxes`);
}
console.log(bad.join(" | "));
