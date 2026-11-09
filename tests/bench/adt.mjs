/* Drum transcription on REAL recorded drums — E-GMD (Expanded Groove MIDI Dataset,
 * Magenta, CC BY 4.0: a human drummer on a Roland TD-17, rendered through 43 sampled kits,
 * audio sample-aligned with the MIDI, velocities included). Work order WPO-ADT-001 §5.
 *
 *   node bench/adt.mjs --data <dir> [--split dev|test|all] [--variant base|full|adt]
 *                      [--opts '{"…":…}'] [--dump <est.json>] [--classes 5|7] [--limit n]
 *   node bench/adt.mjs --data <dir> --variant file --est <notes.json>   (score another system's output)
 *   node bench/adt.mjs --data <dir> --variant onnx --ort <dir with onnxruntime-web@1.23.2> [--model m.onnx]
 *        (the shipped drum model: engine.transcribeDrumsWithModel on ORT-web's plain WASM, one thread)
 *
 * <dir> holds truth.json + the WAVs, made by scripts/egmd_subset.py (dev = E-GMD
 * "validation", test = "test"; one kit per performance so no take is scored twice).
 * Dev-only — nothing here ships. */
import fs from "node:fs"; import path from "node:path";
import { loadEngine } from "./lib.mjs";
import { CLASSES5, CLASSES7, gmToClass, to5, newTally, scoreTrack, summary, beatF, readWav } from "./adt-metrics.mjs";

const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const DATA = arg("data"), SPLIT = arg("split", "all"), VARIANT = arg("variant", "adt"), N7 = arg("classes", "5") === "7";
const OPTS = JSON.parse(arg("opts", "{}")), LIMIT = +arg("limit", "0") || Infinity, DUMP = arg("dump");
if (!DATA) { console.error("--data <dir> required"); process.exit(2); }
const eng = await loadEngine();
let ORT = null, SESS = null;
if (VARIANT === "onnx") {
  const { pathToFileURL } = await import("node:url");
  const mod = await import(pathToFileURL(path.join(arg("ort"), "node_modules/onnxruntime-web/dist/ort.wasm.min.mjs")).href);
  ORT = mod.default || mod; ORT.env.wasm.numThreads = 1;
  const modelPath = arg("model", path.join(path.dirname(new URL(import.meta.url).pathname), "../../models/oaf-drums/oaf-drums.onnx"));
  SESS = await ORT.InferenceSession.create(fs.readFileSync(modelPath), { executionProviders: ["wasm"], enableCpuMemArena: false, enableMemPattern: false });
}
const ortRun = async (spec, frames) => {
  const r = await SESS.run({ [SESS.inputNames[0]]: new ORT.Tensor("float32", spec, [1, frames, 250, 1]) });
  return { onset: r[SESS.outputNames[0]].data, velocity: r[SESS.outputNames[1]].data };
};
const truth = JSON.parse(fs.readFileSync(path.join(DATA, "truth.json"), "utf8")).filter((o) => SPLIT === "all" || o.split === SPLIT).slice(0, LIMIT);

const ENG_CLASS = { kick: "kick", snare: "snare", hat: "hihat", openHat: "hihat", pedalHat: "hihat", tomHigh: "tom", tomMid: "tom", tomLow: "tom", crash: "crash", ride: "ride", hihat: "hihat", tom: "tom", cymbal: "cymbal" };
const classes = N7 ? CLASSES7 : CLASSES5, mapCls = N7 ? (c) => c : to5;
const T = newTally(classes), dump = [];
let EXT = null, sec = 0, audioSec = 0, beatSum = 0, beatN = 0, tempoOK = 0;

for (const o of truth) {
  const { x, sr } = readWav(fs.readFileSync(path.join(DATA, o.audio)));
  const ref = o.notes.map(([t, n, v]) => ({ t, cls: gmToClass(n), vel: v })).filter((h) => h.cls);
  const t0 = performance.now();
  let est;
  if (VARIANT === "adt" || VARIANT === "onnx") {
    const r = VARIANT === "onnx" ? await eng.transcribeDrumsWithModel(x, sr, ortRun, OPTS) : eng.transcribeDrumEvents(x, sr, OPTS);
    est = r.events.map((e) => ({ t: e.t_raw, cls: e.drum_class, vel: e.velocity, is_ghost: e.is_ghost, slotAbs: e.bar * r.slotsPerBar + e.slot }));
    if (r.beats && r.beats.length) { beatSum += beatF(o.beats, r.beats); beatN++; if (Math.abs(r.bpm - o.bpm) / o.bpm <= 0.04) tempoOK++; }
    o._grid = r;
  } else if (VARIANT === "file") {
    // an external system's output (e.g. the Magenta E-GMD baseline): [{ audio, notes:[[t, gm, vel]] }]
    EXT ??= new Map(JSON.parse(fs.readFileSync(arg("est"), "utf8")).map((r) => [r.audio, r.notes]));
    est = (EXT.get(o.audio) || []).map(([t, n, v]) => ({ t, cls: gmToClass(n), vel: v })).filter((h) => h.cls);
  } else {
    const hits = eng.transcribeDrums(x, sr, { ...OPTS, ...(VARIANT === "full" ? { kit: "full" } : {}) });
    est = hits.map((h) => ({ t: h.t, cls: ENG_CLASS[h.type], vel: null }));
  }
  sec += (performance.now() - t0) / 1000; audioSec += x.length / sr;
  // reference grid = the MIDI's own beats (E-GMD tempos are steady); slot = 16th from beat 0
  const B = o.beats, refSlot = (t) => {
    if (!B || B.length < 2) return null;
    let k = 0; while (k + 1 < B.length - 1 && B[k + 1] <= t) k++;
    return Math.round((k + (t - B[k]) / (B[k + 1] - B[k])) * 4);
  };
  // the estimate's slots are counted from ITS bar 1; align by the offset between the two grids
  let slotFn = null;
  if ((VARIANT === "adt" || VARIANT === "onnx") && o._grid && o._grid.events.length) {
    const off = []; for (const e of est.slice(0, 40)) { const rs = refSlot(e.t); if (rs != null) off.push(rs - e.slotAbs); }
    off.sort((a, b) => a - b); const shift = off.length ? off[off.length >> 1] : 0;
    for (const e of est) e.slotAbs += shift;
    slotFn = refSlot;
  }
  const tr = scoreTrack(T, ref, est, { mapCls, refSlot: slotFn, keep: !!DUMP });
  if (DUMP) dump.push({ audio: o.audio, ref: tr.R, est: tr.E, f: Object.fromEntries(classes.map((c) => [c, tr.cls[c].f])) });
}
const S = summary(T), pc = (v) => (v == null ? "—" : (100 * v).toFixed(1));
console.log(`E-GMD ${SPLIT} · ${truth.length} tracks · ${audioSec.toFixed(0)} s audio · variant ${VARIANT} ${JSON.stringify(OPTS)} · ${(sec / audioSec).toFixed(3)}× real time`);
console.log(`onset-only F ${pc(S.onset.f)} (P ${pc(S.onset.p)} R ${pc(S.onset.r)}) · class-aware F ${pc(S.overall.f)} (P ${pc(S.overall.p)} R ${pc(S.overall.r)})`);
console.log(classes.map((c) => `${c} ${pc(S.cls[c].f)} (n=${S.cls[c].nRef})`).join(" · "));
console.log(`simultaneous recall ${pc(S.simulRecall)} (n=${S.simulN}) · velocity MAE ${S.velMAE == null ? "—" : S.velMAE.toFixed(1)} MIDI, within 0.1 ${pc(S.velWithin)} · ghost recall ${pc(S.ghostRecall)} flagged ${pc(S.ghostFlagRecall)} flag-precision ${pc(S.ghostFlagPrecision)} (n=${S.ghostN})`);
if (beatN) console.log(`beat F ${pc(beatSum / beatN)} · tempo within 4 % ${tempoOK}/${beatN} · grid ±1 sixteenth ${pc(S.quant)}`);
if (DUMP) fs.writeFileSync(DUMP, JSON.stringify(dump));
if (arg("json")) fs.writeFileSync(arg("json"), JSON.stringify({ split: SPLIT, variant: VARIANT, opts: OPTS, summary: S, beatF: beatN ? beatSum / beatN : null, tempoOK, n: truth.length }));
