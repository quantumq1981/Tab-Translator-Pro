/* FULL-MIX condition for the chord benchmark (2026-11-04).
 *   node bench/fullmix.mjs            → writes bench/.cache/<idx>-fullmix(.f32|.json) and -fullmixdet
 * The other conditions render ONE comp track (an isolated stem). Users also feed whole records:
 * here every pitched track of the Guitar Pro song (other guitars, keys, bass, the melody line)
 * is rendered from the comp track's start, summed with a drum kit, and scored against the comp
 * track's chords (the same truth as `clean`). The loudest single-note part (the tune) is voiced
 * as a VOCAL-like lead with vibrato (5.5 Hz, ±35 ¢) and mixed on top, the way a singer sits in a
 * pop mix. `fullmixdet` is the same mix detuned +45 ¢ — an old tape running fast, where a
 * record sits between two semitones. Truth labels are unaffected by the detune (a decoder should
 * compensate tuning). Deterministic. */
import fs from "node:fs"; import path from "node:path";
import * as L from "./lib.mjs";
const eng = await L.loadEngine();
const cacheDir = path.join(L.here, ".cache"); fs.mkdirSync(cacheDir, { recursive: true });
const SEC = 60;

function leadVoice(out, sr, start, len, freq, amp, R) {
  // a sung-like line: 6 harmonics with a formant-ish rolloff, 5.5 Hz vibrato ±35 ¢, soft attack
  const vib = 5.3 + 0.5 * R(), depth = 0.35 / 12, ph0 = R() * 6.28;
  let ph = 0;
  for (let i = 0; i < len && start + i < out.length; i++) {
    const t = i / sr;
    const env = Math.min(1, t / 0.06) * Math.min(1, (len - i) / (0.05 * sr));
    const f = freq * Math.pow(2, depth * Math.sin(2 * Math.PI * vib * t + ph0) * Math.min(1, t / 0.25));
    ph += (2 * Math.PI * f) / sr;
    let v = 0; for (let h = 1; h <= 6; h++) v += Math.sin(h * ph) / (h * (h > 2 ? 1.6 : 1));
    out[start + i] += amp * env * v;
  }
}
function renderMono(eng, sc, t0, sr, cents, R) {
  // a single-note part as the vocal-like lead
  const timed = eng.scoreEventTimes(sc, sc.tempo || 100).events;
  const flat = []; for (const b of sc.bars) for (const e of b.events) flat.push(e);
  const out = new Float32Array(Math.ceil((SEC + 2) * sr));
  for (let i = 0; i < flat.length; i++) {
    const st = timed[i].start - t0; if (st < 0 || st >= SEC) continue;
    const e = flat[i]; if (!e.midis || !e.midis.length) continue;
    const m = Math.max(...e.midis);
    leadVoice(out, sr, Math.floor(st * sr), Math.floor(Math.min(timed[i].dur, SEC - st) * sr), 440 * Math.pow(2, (m - 69 + cents / 100) / 12), 0.25, R);
  }
  return out;
}
const rms = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / (a.length || 1)); };
const instFor = (name, sc) => {
  const n = (name || "").toLowerCase();
  if (/bass/.test(n) || (sc.tuningMidi && sc.tuningMidi.filter((x) => x != null)[0] < 36)) return "bass";
  if (/organ|hammond/.test(n)) return "organ";
  if (/piano|keys|rhodes|wurl|clav|synth|string/.test(n)) return "piano";
  return "guitar";
};

for (const [file, part, inst, ci] of L.CORPUS.map((c, i) => [...c, i])) {
  for (const cond of ["fullmix", "fullmixdet"]) {
    const key = `${ci}_${cond}`;
    if (fs.existsSync(path.join(cacheDir, key + ".f32"))) continue;
    const cents = cond === "fullmixdet" ? 45 : 0;
    const bytes = new Uint8Array(fs.readFileSync(path.join(L.repo, file)));
    const comp = await eng.parseGuitarProOrXML(bytes, file, true, part);
    const R = L.rng(5000 + ci);
    const c = L.renderPart(eng, comp, { sr: 44100, instrument: inst, seed: 17 + ci, cents, maxSec: SEC });
    if (!c) continue;
    const sr = c.sr, mix = new Float32Array(c.audio.length);
    const compR = rms(c.audio);
    for (let i = 0; i < mix.length; i++) mix[i] = c.audio[i];
    const parts = (comp.parts || []).map((p) => p.index).filter((p) => p !== part);
    let lead = null, leadScore = 0;
    for (const p of parts) {
      let sc; try { sc = await eng.parseGuitarProOrXML(bytes, file, true, p); } catch (_) { continue; }
      if (!sc || !sc.bars || (sc.tuningMidi && eng.isPercussionTuning && eng.isPercussionTuning(sc.tuningMidi))) continue;
      const evs = sc.bars.flatMap((b) => b.events).filter((e) => e.midis && e.midis.length);
      if (!evs.length) continue;
      const single = evs.filter((e) => e.midis.length === 1).length / evs.length;
      const pname = ((comp.parts.find((x) => x.index === p) || {}).name) || "";
      if (/drum|perc/i.test(pname)) continue;
      const it = instFor(pname, sc);
      // the tune: a mostly single-note, non-bass part with the highest median pitch
      if (single > 0.8 && it !== "bass") {
        const med = evs.map((e) => Math.max(...e.midis)).sort((a, b) => a - b)[evs.length >> 1];
        if (med > leadScore) { leadScore = med; lead = sc; }
        continue;
      }
      const r = L.renderPart(eng, sc, { sr, instrument: it, seed: 300 + p, cents, fromSec: c.t0, maxSec: SEC });
      if (!r) continue;
      const g = it === "bass" ? 1.0 : 0.6;
      const rr = rms(r.audio) || 1;
      for (let i = 0; i < mix.length && i < r.audio.length; i++) mix[i] += (g * compR * r.audio[i]) / rr;
    }
    if (lead) {
      const v = renderMono(eng, lead, c.t0, sr, cents, R), vr = rms(v.subarray(0, mix.length)) || 1;
      for (let i = 0; i < mix.length; i++) mix[i] += (1.4 * compR * v[i]) / vr;      // the singer sits on top
    }
    const out = L.addBleed(mix, sr, c.bpm, 0.5, R, null);          // the drum kit
    let pk = 0; for (let i = 0; i < out.length; i++) pk = Math.max(pk, Math.abs(out[i]));
    const f = new Float32Array(out.length); for (let i = 0; i < out.length; i++) f[i] = (0.8 * out[i]) / (pk || 1);
    fs.writeFileSync(path.join(cacheDir, key + ".f32"), Buffer.from(f.buffer));
    fs.writeFileSync(path.join(cacheDir, key + ".json"), JSON.stringify({ gt: c.gt, sr, bpm: c.bpm, file, part, inst, cond, lead: !!lead, parts: parts.length }));
    console.log(key, file.slice(0, 40), "parts", parts.length, "lead", !!lead);
  }
}
