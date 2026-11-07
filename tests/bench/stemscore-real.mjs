/* stemscore-real.mjs — a REAL record, its stems and its score: each stem against its score part, and
 * Guitar → Tab on the guitar ("other") stem with the score's guitar part linked.
 *
 *   node bench/stemscore-real.mjs --score <file.gp> --audio <mix.mp3> --stems <dir from split-file.mjs>
 *        [--guitar-model models/guitar-crnn/guitar-gaps.w8.onnx --ort <dir with onnxruntime-node>] [--tab-part N]
 *
 * The link is made on the full mix (as the app does); the stems are the separator's output
 * (bench/split-file.mjs). There is no ground truth here — the numbers say how closely each player
 * follows the file, and which bars differ; listen to those bars to judge. Dev-only. */
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process"; import { createRequire } from "node:module";
import * as L from "./lib.mjs";
const E = await L.loadEngine();
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const SCORE = arg("score"), AUDIO = arg("audio"), STEMS = arg("stems");
if (!SCORE || !AUDIO || !STEMS) { console.error("--score --audio --stems are required"); process.exit(2); }
const T = 16000;
const dec = (f) => { const raw = execFileSync("ffmpeg", ["-v", "error", "-i", f, "-ac", "1", "-ar", String(T), "-f", "f32le", "-"], { maxBuffer: 2 ** 31 }); return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4); };
const meta = JSON.parse(fs.readFileSync(path.join(STEMS, "meta.json"), "utf8"));
const stemMono = (k) => { const b = fs.readFileSync(path.join(STEMS, k + ".f32")), x = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4), n = x.length / 2, m = new Float32Array(n); for (let i = 0; i < n; i++) m[i] = 0.5 * (x[2 * i] + x[2 * i + 1]); return m; };
const bytes = new Uint8Array(fs.readFileSync(SCORE));
const first = await E.parseGuitarProOrXML(bytes, SCORE, true);
const ps = [];
for (const p of first.parts && first.parts.length ? first.parts : [{ index: 0, name: SCORE }]) ps.push({ score: p.index === first.partIndex ? first : await E.parseGuitarProOrXML(bytes, SCORE, true, p.index), name: p.name, drum: !!p.drum, index: p.index });
console.log("parts:", ps.map((p) => `${p.index}:${p.name} → ${E.scorePartRole(p)}`).join(" · "));
const mix = dec(AUDIO);
let t0 = Date.now();
const link = E.linkScoreToAudio(mix, T, ps, { tempo: first.tempo });
console.log(`link ok=${link.ok} match ${link.confidence} transpose ${link.transpose} ♩≈${link.tempo} (${Date.now() - t0} ms)`);
const full = {}, st16 = {};
for (const k of meta.stems) { full[k] = stemMono(k); st16[k] = E.resampleTo(full[k], meta.sampleRate, T); }
t0 = Date.now();
const charts = E.chartsFromStems(st16, T, { perStemChords: false, fullRate: { drums: full.drums, sampleRate: meta.sampleRate } });
const res = E.compareStemsToScore(charts, T, link, ps, { audio: { other: st16.other } });
console.log(`stems × parts (${Date.now() - t0} ms):`);
for (const r of res) {
  const valid = r.bars.filter((b) => b.agreement != null);
  console.log(`  ${r.role.padEnd(6)} ↔ ${r.parts.length ? r.parts.join(" + ") : "—"}: ${r.agreement != null ? (100 * r.agreement).toFixed(0) + "% (median bar " + (100 * r.median).toFixed(0) + "%)" : r.note}  · ${valid.length} bars compared, ${r.differs.length} differ${r.differs.length ? ": " + r.differs.slice(0, 16).join(", ") + (r.differs.length > 16 ? " …" : "") : ""}`);
}
// Guitar → Tab on the "other" stem, with a guitar part linked
const GM = arg("guitar-model"), ORT = arg("ort");
if (GM && ORT) {
  const ort = createRequire(path.join(ORT, "x.js"))("onnxruntime-node");
  const sess = await ort.InferenceSession.create(GM, { intraOpNumThreads: 4 });
  const heads = { onset: "reg_onset_output", offset: "reg_offset_output", frame: "frame_output", velocity: "velocity_output" };
  const model = async (seg) => { const r = await sess.run({ audio: new ort.Tensor("float32", Float32Array.from(seg), [1, seg.length]) }); const o = {}; for (const [k, n] of Object.entries(heads)) o[k] = r[n].data; return o; };
  t0 = Date.now();
  const g = await E.transcribeGuitar(st16.other, model, { keepOutputs: true });
  console.log(`guitar model on the other stem: ${g.notes.length} notes (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  const gtrs = ps.filter((p) => E.scorePartRole(p) === "guitar");
  const tabParts = arg("tab-part") != null ? [[ps.find((p) => p.index === +arg("tab-part"))]] : [...gtrs.map((p) => [p]), ...(gtrs.length > 1 ? [gtrs] : [])];
  for (const pl of tabParts) for (const follow of ["recording", "balanced", "score"]) {
    const part = { name: pl.map((p) => p.name).join(" + ") };
    const r = E.scoreInformedTab(g.notes, link, pl, { follow, out: g.out });
    const s = r.stats;
    console.log(`  tab with "${part.name}" (${follow}): ${s.scoreNotes} score notes → matched ${s.matched}, recovered ${s.recovered}, missed ${s.missed}; heard ${s.heard} (${s.extra} not in this part) · agreement ${(100 * s.agreement).toFixed(0)}% · capo ${r.capo} · ${r.notes.length} tab notes`);
  }
}
