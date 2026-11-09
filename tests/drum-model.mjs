/* DRUM MODEL suite — WPO-ADT-001 Phase 1 (2026-11-09): Magenta Onsets & Frames drums in the app.
 *   · oafDrumLogMel equals librosa's features for the model (fixture from librosa 1.0.0);
 *   · oafDrumWindows tiles the spectrogram; oafDrumHits decodes onset/velocity matrices;
 *   · transcribeDrumsWithModel with a fake session: windows, stitching, events, method;
 *   · drum MIDI carries a measured velocity (and is unchanged without one);
 *   · the model file matches its SHA-256 pin + NOTICE; the glue / loader / deploy / UI contracts.
 * The real model on real drums: tests/bench/adt.mjs --variant onnx (E-GMD). */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
globalThis.DOMParser = (await import("@xmldom/xmldom")).DOMParser;
const enginePath = path.join(here, ".engine.drummodel.mjs");
fs.writeFileSync(enginePath, fs.readFileSync(path.join(repo, "engine.tsx"), "utf8"));
const eng = await import(enginePath + "?t=" + Date.now());
const read = (f) => fs.readFileSync(path.join(repo, f), "utf8");

let failures = 0, passes = 0;
const expect = (cond, msg) => { if (cond) passes++; else { failures++; console.error("FAIL:", msg); } };
const section = (name) => console.log(`\n— ${name}`);

/* the fixture's signal (tests/fixtures/oaf-drums-logmel.json was computed by librosa from it) */
function signal() {
  const sr = 44100, n = Math.round(0.6 * sr), x = new Float32Array(n); let s = 12345;
  const R = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    x[i] = 0.8 * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-t * 25)) * t) * Math.exp(-t * 8)
      + (t > 0.2 && t < 0.35 ? 0.3 * R() * Math.exp(-(t - 0.2) * 20) : 0) + 0.05 * Math.sin(2 * Math.PI * 3150 * t);
  }
  return x;
}

section("oafDrumLogMel — the model's input, equal to librosa");
{
  const fx = JSON.parse(read("tests/fixtures/oaf-drums-logmel.json"));
  const r = eng.oafDrumLogMel(signal());
  let mx = 0; for (let i = 0; i < fx.db.length; i++) mx = Math.max(mx, Math.abs(r.spec[i] - fx.db[i]));
  expect(r.frames === fx.frames && r.spec.length === fx.frames * 250, `frames ${r.frames} = librosa's ${fx.frames}`);
  expect(mx < 0.01, `power_to_db(mel) within 0.01 dB of librosa (max |Δ| ${mx.toFixed(4)})`);
  const top = Math.max(...r.spec), bottom = Math.min(...r.spec);
  expect(Math.abs(top - bottom - 80) < 1e-3, "floored at the file's max − 80 dB (top_db)");
  const at48 = eng.oafDrumInput(eng.resampleTo(signal(), 44100, 48000), 48000);
  expect(Math.abs(at48.frames - r.frames) <= 1, "48 kHz input is resampled to the model's 44.1 kHz grid");
  expect(eng.OAF_DRUMS.fps > 86.1 && eng.OAF_DRUMS.fps < 86.2, "86.13 frames/s");
}

section("oafDrumWindows — bounded-memory windows that tile the spectrogram");
{
  for (const T of [1, 500, 1200, 1201, 5000]) {
    const w = eng.oafDrumWindows(T, 1200, 172);
    let cov = 0, ok = true;
    w.forEach((x, i) => { if (x.keepFrom !== (i ? w[i - 1].keepTo : 0) || x.start > x.keepFrom || x.end < x.keepTo || x.start < 0 || x.end > T || x.keepFrom - x.start > 172 || x.end - x.keepTo > 172) ok = false; cov += x.keepTo - x.keepFrom; });
    expect(ok && cov === T && w[w.length - 1].keepTo === T, `T=${T}: ${w.length} windows, cores tile [0, T) exactly, ≤ 172 frames of context`);
  }
}

section("oafDrumHits — decoding the onset and velocity matrices");
const P = 88, col = (pitch) => pitch - 21;
function mats(T, marks) {
  const on = new Float32Array(T * P), vel = new Float32Array(T * P);
  for (const [t, pitch, p, v, len = 2] of marks) for (let u = t; u < t + len; u++) { on[u * P + col(pitch)] = u === t + 1 ? p : Math.max(0.55, p - 0.1); vel[u * P + col(pitch)] = v; }
  return { on, vel };
}
{
  const { on, vel } = mats(400, [[10, 36, 0.95, 0.8], [100, 38, 0.7, 0.3], [200, 46, 0.9, 0.5], [300, 51, 0.8, 0.6], [301, 53, 0.9, 0.6], [350, 60, 0.99, 0.9]]);
  const h = eng.oafDrumHits(on, vel, 400);
  expect(h.length === 4, `four hits (a non-drum column is ignored; ride + bell at one instant = one ride) — ${h.map((x) => x.type)}`);
  const k = h.find((x) => x.type === "kick");
  expect(k && Math.abs(k.t - 10 / eng.OAF_DRUMS.fps) < 1e-3 && k.vel === Math.round(0.8 * 127) && k.prob === 0.95, "the hit is at the rising frame, velocity × 127, prob = the run's peak");
  expect(h.map((x) => x.type).join() === "kick,snare,hat,ride", "pitch → piece map (36 kick, 38 snare, 46 hat, 51/53 ride)");
  const below = eng.oafDrumHits(on, vel, 400, { threshold: 0.96 });
  expect(below.length === 0, "threshold respected");
  expect(eng.OAF_DRUM_PIECES[48] === "tomMid" && eng.DRUM_PIECE_CLASS.tomMid === "tom" && eng.OAF_DRUM_PIECES[49] === "crash", "toms + crash map to rows the exporters draw");
}

section("transcribeDrumsWithModel — a fake session through the whole pipeline");
{
  const sr = 44100, sec = 30, x = new Float32Array(sec * sr);       // silent audio; the fake model "hears" a groove
  const fps = eng.OAF_DRUMS.fps, bpm = 120, beat = 60 / bpm;
  const marks = [];
  for (let b = 0; b < 56; b++) { const f = Math.round((1 + b * beat) * fps); marks.push([f, b % 2 ? 38 : 36, 0.9, b % 8 === 7 ? 0.35 : 0.85]); }
  const calls = [];
  // the fake run needs the window's absolute position: wrap the windows ourselves
  const T = eng.oafDrumInput(x, sr).frames, wins = eng.oafDrumWindows(T, 600, 86);
  const { on, vel } = mats(T, marks);
  let wi = 0;
  const runAbs = async (spec, frames) => {
    const w = wins[wi++]; calls.push(frames);
    expect(spec.length === frames * 250 && frames === w.end - w.start, "each window is its frames × 250 values");
    return { onset: on.subarray(w.start * P, w.end * P), velocity: vel.subarray(w.start * P, w.end * P) };
  };
  const prog = [];
  const beats = Array.from({ length: 60 }, (_, i) => 1 + i * beat);
  const r = await eng.transcribeDrumsWithModel(x, sr, runAbs, { chunk: 600, pad: 86, beats, bpm, onProgress: (d, n) => prog.push([d, n]) });
  expect(r.method === "oaf-drums", "method says which detector ran");
  expect(calls.length === wins.length && prog.length === wins.length && prog[prog.length - 1][0] === prog[prog.length - 1][1], `${wins.length} windows run, progress reported to completion`);
  expect(r.events.length === 56, `every model hit is an event (${r.events.length}/56, none lost at window seams)`);
  expect(r.events.every((e) => ["kick", "snare"].includes(e.drum_class)), "classes from the model");
  const sn = r.events.filter((e) => e.drum_class === "snare");
  expect(sn.every((e) => e.slot === 4 || e.slot === 12), "the snare lands on beats 2 and 4 of the caller's grid");
  const quiet = r.events.filter((e) => e.velocity === Math.round(0.35 * 127)), loud = r.events.filter((e) => e.velocity === Math.round(0.85 * 127));
  expect(quiet.length === 7 && loud.length === 49, "velocities are the model's own");
  expect(quiet.every((e) => e.is_ghost) && loud.filter((e) => e.drum_class === "snare").every((e) => !e.is_ghost), "the model's quiet snares are flagged ghost, its accents are not");
  expect(r.events.every((e) => e.confidence === 0.9), "confidence = the model's onset probability");
  let bad = false; try { await eng.transcribeDrumsWithModel(x, sr, async (s, f) => ({ onset: new Float32Array(f * P), velocity: null }), { beats, bpm, onProgress: () => { throw new Error("ui"); } }); } catch (_) { bad = true; }
  expect(!bad, "a throwing progress callback or a missing velocity head can't break the run");
}

section("drum MIDI carries the measured velocity");
{
  const noteOns = (bytes) => { const out = []; for (let i = 0; i + 2 < bytes.length; i++) if (bytes[i] === 0x99) out.push([bytes[i + 1], bytes[i + 2]]); return out; };
  const hits = [{ t: 0.5, type: "kick" }, { t: 1, type: "snare", velocity: 30 }, { t: 1.5, type: "tomMid", velocity: 200 }];
  const kit = noteOns(eng.drumKitToMidi(hits, { bpm: 120 })), basic = noteOns(eng.drumHitsToMidi(hits, { bpm: 120 }));
  expect(kit[0][1] === 100 && kit[1][1] === 30 && kit[2][1] === 127, `drumKitToMidi: default 100, measured 30, clamped 127 — ${JSON.stringify(kit)}`);
  expect(basic[0][1] === 100 && basic[1][1] === 30, "drumHitsToMidi too");
  const plain = [{ t: 0.5, type: "kick" }, { t: 1, type: "snare" }];
  expect(Buffer.from(eng.drumKitToMidi(plain, { bpm: 120 })).equals(Buffer.from(eng.drumKitToMidi(plain.map((h) => ({ ...h })), { bpm: 120 }))) && noteOns(eng.drumKitToMidi(plain, { bpm: 120 })).every(([, v]) => v === 100), "hits without a velocity export as before");
}

section("the shipped model + glue contracts");
{
  const model = fs.readFileSync(path.join(repo, "models/oaf-drums/oaf-drums.onnx"));
  const sha = crypto.createHash("sha256").update(model).digest("hex");
  const core = read("drum-model-core.js"), glue = read("drum-model.js"), worker = read("drum-worker.js");
  expect(core.includes(`sha256: "${sha}"`), `drum-model-core.js pins the committed model (${sha.slice(0, 12)}…)`);
  expect(model.length > 4e6 && model.length < 6e6, `the model is ~5 MB (${(model.length / 1e6).toFixed(1)} MB)`);
  const notice = read("models/oaf-drums/NOTICE");
  expect(/Apache License/.test(notice) && notice.includes(sha) && /E-GMD/.test(notice) && /CC BY 4\.0/.test(notice) && /oaf_drums_export\.py/.test(notice), "NOTICE: Apache-2.0 text, the file's SHA-256, E-GMD attribution, how it was made");
  expect(/stem-model-core\.js/.test(core) && /capWasmMemory\(\)/.test(core) && /ORT_WASM_PATHS/.test(core) && /numThreads = 1/.test(core), "core: the pinned ORT 1.23.2 plain WASM rails from stem-model-core.js, one thread, the memory cap");
  expect(/sha256Hex\(b\) === model\.sha256/.test(core) && /cache\.delete\(key\)/.test(core) && /integrity check/.test(core), "core: SHA-256 checked, a bad cached copy evicted");
  expect(/engine\.transcribeDrumsWithModel/.test(core) && /sess\.release\(\)/.test(core), "core: the engine's pipeline, the session released");
  expect(/window\.TTP_DRUM_MODEL = transcribeDrumAudio/.test(glue) && /type: "module"/.test(glue) && /w\.terminate\(\)/.test(glue), "drum-model.js publishes TTP_DRUM_MODEL, runs a module worker, ends it after the job");
  expect(!/catch \(err\)[\s\S]{0,200}onMainThread/.test(glue) && /if \(!w\) return onMainThread/.test(glue), "the main thread is used only when no Worker can be made (a failed worker run is not retried there)");
  expect(/transcribeDrumPcm/.test(worker) && /type: "progress"/.test(worker), "the worker runs the core and reports progress");
  const html = read("index.html"), pages = read(".github/workflows/pages.yml");
  expect(/<script type="module" src="\.\/drum-model\.js"><\/script>/.test(html), "index.html loads drum-model.js");
  expect(/cp drum-model\.js drum-model-core\.js drum-worker\.js _site\//.test(pages) && /models\/oaf-drums\/oaf-drums\.onnx models\/oaf-drums\/NOTICE/.test(pages) && /drum-model\.js\?v=\$\{BUILD\}/.test(pages), "pages.yml ships the glue, model + NOTICE, and stamps drum-model.js");
  const ui = read("TabDecoderPro.tsx");
  expect(/window\.TTP_DRUM_MODEL/.test(ui) && /ttp:drumModel/.test(ui) && /stemMono\(t\.list\.filter\(\(x\) => x\.role === "drums"\)\)/.test(ui), "the stems panel re-reads the drums stem with the model (per-device toggle)");
  expect(/fullKit \|\| chart\.model \? drumKitToMidi/.test(ui), "a model-read drum chart exports through the full-kit MIDI writer (velocities kept)");
  expect(/showing the built-in reading/.test(ui), "a model failure keeps the built-in reading");
  expect(read("engine.txt") === read("engine.tsx") && read("TabDecoderPro.txt") === read("TabDecoderPro.tsx"), ".txt mirrors are current");
}

try { fs.unlinkSync(enginePath); } catch {}
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
