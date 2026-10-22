/* ============================================================================
 *  Audio-chord BENCHMARK library (dev-only, Node). Not shipped.
 *
 *  Why this exists: SynHarmonics v2.0 §8 — "accuracy claims must be falsifiable".
 *  The repo has no annotated real chord audio (Zenodo/GuitarSet is unreachable from
 *  the dev sandbox), but it DOES have ~30 Guitar Pro files whose comp/rhythm tracks
 *  state every note exactly. So: render those tracks to audio with physically-
 *  motivated synths (Karplus-Strong plucked strings, inharmonic additive piano,
 *  drawbar organ), with the documented augmentations (noise, room, detune, stem
 *  bleed), and score the engine's audio decode against the notated harmony, MIREX-
 *  style (root / majmin / sevenths / exact pitch-set, + segmentation quality).
 *
 *  Ground truth = the engine's own `recognise` of the NOTATED voicing (the GP
 *  importer's event symbol), held until the next chordal event — i.e. "what the
 *  stem actually plays", which is exactly what an audio decoder should recover.
 * ========================================================================== */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

export const here = path.dirname(url.fileURLToPath(import.meta.url));
export const repo = path.resolve(here, "../..");

export async function loadEngine(srcPath = path.join(repo, "engine.tsx")) {
  if (!globalThis.DOMParser) globalThis.DOMParser = (await import("@xmldom/xmldom")).DOMParser;
  const tmp = path.join(here, `.engine-${path.basename(srcPath, ".tsx")}.mjs`);
  fs.writeFileSync(tmp, fs.readFileSync(srcPath, "utf8"));
  return import(tmp + "?t=" + Date.now());
}

/* ---- deterministic PRNG (so every run renders byte-identical audio) ---- */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/* ---- label algebra ---------------------------------------------------- */
const PC = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11, Cb: 11, Fb: 4, "E#": 5, "B#": 0 };
export function parseLabel(sym, QUALITIES) {
  if (!sym || sym === "N" || sym === "—" || sym === "N.C.") return null;
  const m = String(sym).match(/^([A-G](?:#|b)?)(.*)$/);
  if (!m) return null;
  let rest = m[2], bass = null;
  const sl = rest.match(/^(.*)\/([A-G](?:#|b)?)$/);
  if (sl && !/6\/9$/.test(rest)) { rest = sl[1]; bass = PC[sl[2]]; }
  const q = QUALITIES.find((qq) => qq.suffix === rest);
  if (!q) return null;
  const root = PC[m[1]];
  return { root, suffix: rest, intervals: q.intervals, pcs: new Set(q.intervals.map((i) => (root + i) % 12)), bass: bass == null ? root : bass };
}
// mir_eval-style reductions. null = "outside this vocabulary" (excluded from the metric).
export function triadClass(lab) {
  const iv = new Set(lab.intervals);
  if (iv.has(4) && iv.has(7) && !iv.has(3)) return "maj";
  if (iv.has(3) && iv.has(7) && !iv.has(4)) return "min";
  if (iv.has(3) && iv.has(4) && iv.has(7) && iv.has(10)) return "maj";   // 7#9 = dominant
  return null;
}
export function seventhClass(lab) {
  const t = triadClass(lab);
  if (!t) return null;
  const iv = new Set(lab.intervals);
  if (iv.has(9) && !iv.has(10) && !iv.has(11)) return null;             // 6ths are outside 'sevenths'
  if (iv.has(10)) return t + "7";
  if (iv.has(11)) return t + "maj7";
  return t;
}

/* ---- synths ------------------------------------------------------------ */
const mtof = (m, cents = 0) => 440 * Math.pow(2, (m - 69 + cents / 100) / 12);

/* Extended Karplus-Strong plucked string: lowpassed noise excitation (brightness),
 * pick-position comb, two-point averaging loop filter with a decay-calibrated loop
 * gain, fractional delay by linear interpolation. Writes into `out` from `start`
 * for `len` samples, then a 60 ms damping release (a fretting hand lifting off). */
export function pluck(out, sr, start, len, freq, amp, R, opts = {}) {
  // loop delay = L + frac (linear-interp read) + 0.5 (two-point average) = sr/freq exactly
  const P = sr / freq - 0.5;
  const L = Math.max(2, Math.floor(P)), frac = P - L;
  const excLen = L + 1;
  const bright = opts.bright != null ? opts.bright : 0.5;
  const exc = new Float64Array(excLen);
  let lp = 0;
  for (let i = 0; i < excLen; i++) { lp += bright * ((R() * 2 - 1) - lp); exc[i] = lp; }
  const pp = Math.max(1, Math.round(excLen * (opts.pickPos || 0.13)));
  for (let i = excLen - 1; i >= pp; i--) exc[i] -= exc[i - pp];
  const t60 = opts.t60 || Math.max(0.8, 4.5 - 0.035 * (12 * Math.log2(freq / 82.4)));
  const g = Math.pow(10, -3 / (t60 * freq));
  const rel = Math.floor(0.06 * sr), total = len + rel;
  const s = new Float64Array(total + 1);
  let yPrev = 0;
  for (let n = 0; n < total; n++) {
    const a = n - L >= 0 ? s[n - L] : 0, b = n - L - 1 >= 0 ? s[n - L - 1] : 0;
    const y = (1 - frac) * a + frac * b;
    const damp = n < len ? 1 : 0.92;
    s[n] = (n < excLen ? exc[n] : 0) + damp * g * 0.5 * (y + yPrev);
    yPrev = y;
    if (start + n >= 0 && start + n < out.length) out[start + n] += amp * s[n];
  }
}
/* Electric bass: additive, fundamental-dominant (partial k at 1/k² with faster decay for
 * upper partials), 5 ms attack, finger-style. The guitar `pluck` above is no bass: its
 * pick-position comb strips the fundamental (2% of its energy sits below 150 Hz), so a
 * separator rightly files it under "other" and YIN can't lock onto it. */
export function bassNote(out, sr, start, len, freq, amp) {
  const rel = Math.floor(0.05 * sr), total = len + rel, att = Math.floor(0.005 * sr);
  for (let k = 1; k <= 10; k++) {
    const fk = k * freq; if (fk > 0.45 * sr) break;
    const ak = amp / (k * k), tau = 1.6 / (1 + 0.6 * (k - 1)), w = 2 * Math.PI * fk / sr;
    for (let n = 0; n < total; n++) {
      const i = start + n; if (i < 0 || i >= out.length) continue;
      const env = (n < att ? n / att : 1) * Math.exp(-n / (tau * sr)) * (n < len ? 1 : Math.exp(-(n - len) / (0.012 * sr)));
      out[i] += ak * env * Math.sin(w * n);
    }
  }
}
/* Inharmonic additive piano/e-piano: partial k at k·f·sqrt(1+B·k²), 1/k^1.1 rolloff,
 * per-partial exponential decay (upper partials die faster), 4 ms attack. */
export function pianoNote(out, sr, start, len, freq, amp, opts = {}) {
  const B = opts.B != null ? opts.B : 0.0003, K = opts.partials || 10;
  const parts = [];
  for (let k = 1; k <= K; k++) {
    const f = k * freq * Math.sqrt(1 + B * k * k);
    if (f > sr * 0.45) break;
    parts.push({ w: (2 * Math.PI * f) / sr, a: Math.pow(k, -(opts.rolloff || 1.1)), d: Math.exp(-(0.6 + 0.9 * k) / (sr * (opts.decay || 1.6))) });
  }
  const rel = Math.floor(0.08 * sr), atk = Math.floor(0.004 * sr), total = len + rel;
  for (const p of parts) {
    let env = 1;
    for (let n = 0; n < total && start + n < out.length; n++) {
      env *= p.d;
      const e = (n < atk ? n / atk : 1) * (n < len ? 1 : Math.max(0, 1 - (n - len) / rel));
      out[start + n] += amp * p.a * env * e * Math.sin(p.w * n);
    }
  }
}
/* Drawbar organ (8' 4' 2⅔' 2'): steady partials, no decay, key click. */
export function organNote(out, sr, start, len, freq, amp) {
  const bars = [[1, 1], [2, 0.7], [3, 0.45], [4, 0.35], [6, 0.15]];
  const rel = Math.floor(0.03 * sr), total = len + rel;
  for (const [h, a] of bars) {
    const w = (2 * Math.PI * h * freq) / sr;
    if (h * freq > sr * 0.45) continue;
    for (let n = 0; n < total && start + n < out.length; n++) {
      const e = n < 80 ? n / 80 : n < len ? 1 : Math.max(0, 1 - (n - len) / rel);
      out[start + n] += amp * a * e * Math.sin(w * n);
    }
  }
}

/* ---- render a parsed score part to audio + ground-truth harmony ----------- */
export function renderPart(eng, score, opts = {}) {
  const sr = opts.sr || 44100, bpm = opts.bpm || score.tempo || 100;
  const R = rng(opts.seed || 1);
  const cents = opts.cents || 0, inst = opts.instrument || "guitar";
  const timed = eng.scoreEventTimes(score, bpm).events;
  const flat = [];
  for (const bar of score.bars) for (const e of bar.events) flat.push(e);
  // excerpt window: start at the first chordal event
  const isChordal = (e) => e.midis && new Set(e.midis.map((m) => m % 12)).size >= 3;
  let first = opts.fromSec != null ? timed.findIndex((t) => t.start >= opts.fromSec - 1e-6) : flat.findIndex(isChordal);
  if (first < 0) return null;
  const t0 = opts.fromSec != null ? opts.fromSec : timed[first].start, maxDur = opts.maxSec || 75;
  const out = new Float32Array(Math.ceil((maxDur + 2) * sr));
  const gt = [];                                   // { t0, t1, label }
  let curLab = null, lastSound = 0, strumDir = 1;
  const voiceEnd = new Map();                      // string/voice → active note end (for KS cut-off)
  for (let i = first; i < flat.length; i++) {
    const e = flat[i], tm = timed[i];
    const st = tm.start - t0;
    if (st >= maxDur) break;
    if (!e.midis || !e.midis.length) continue;
    const dur = Math.min(tm.dur, maxDur - st);
    // ground truth: chordal events set the harmony; sparse ones inherit it
    if (isChordal(e)) {
      if (curLab && st > lastSound + 1.5) gt.push({ t0: lastSound, t1: st, label: null });   // a real rest
      if (gt.length && gt[gt.length - 1].label === e.symbol && gt[gt.length - 1].t1 >= st - 1e-6) gt[gt.length - 1].t1 = st + dur;
      else { if (gt.length && gt[gt.length - 1].t1 < st) gt[gt.length - 1].t1 = st; gt.push({ t0: st, t1: st + dur, label: e.symbol }); }
      curLab = e.symbol;
    } else if (gt.length) {
      if (st > lastSound + 1.5) { gt.push({ t0: lastSound, t1: st, label: null }); gt.push({ t0: st, t1: st + dur, label: curLab }); }
      else gt[gt.length - 1].t1 = Math.max(gt[gt.length - 1].t1, st + dur);
    }
    lastSound = Math.max(lastSound, st + dur);
    // synthesis
    const mids = [...e.midis].sort((a, b) => a - b);
    const vel = 0.55 + 0.35 * R();
    const spread = inst === "guitar" ? (0.006 + 0.012 * R()) : 0.002;
    strumDir = -strumDir;
    mids.forEach((m, j) => {
      const order = strumDir > 0 ? j : mids.length - 1 - j;
      const s0 = Math.floor((st + order * spread) * sr), len = Math.max(1, Math.floor(dur * sr));
      const f = mtof(m, cents), a = (vel * 0.5) / Math.sqrt(mids.length);
      if (inst === "guitar") pluck(out, sr, s0, len, f, a, R, { bright: 0.35 + 0.4 * vel, pickPos: 0.1 + 0.08 * R() });
      else if (inst === "bass") bassNote(out, sr, s0, len, f, a);
      else if (inst === "organ") organNote(out, sr, s0, len, f, a * 0.6);
      else pianoNote(out, sr, s0, len, f, a, { B: 0.00015 * Math.pow(10, (m - 48) / 36) });   // Fletcher-like: wound bass strings ~1e-4, treble ~1e-3
    });
  }
  // close the tail
  if (gt.length) gt[gt.length - 1].t1 = Math.min(gt[gt.length - 1].t1, maxDur);
  const len = Math.ceil(Math.min(maxDur, lastSound + 0.5) * sr);
  return { audio: out.subarray(0, len), sr, gt: gt.filter((g) => g.t1 > g.t0), bpm, t0 };
}

/* ---- augmentations (v2.0 §4.2: noise, pitch, room) ------------------------ */
export function addNoise(x, snrDb, R) {
  let p = 0; for (let i = 0; i < x.length; i++) p += x[i] * x[i];
  p /= x.length || 1;
  const np = p / Math.pow(10, snrDb / 10);
  // pink-ish: one-pole lowpassed white blended with white
  const y = new Float32Array(x.length);
  let lp = 0, b = 0;
  for (let i = 0; i < x.length; i++) { const w = R() * 2 - 1; lp += 0.05 * (w - lp); b = 0.6 * w + 2.2 * lp; y[i] = b; }
  let q = 0; for (let i = 0; i < y.length; i++) q += y[i] * y[i];
  const g = Math.sqrt(np / (q / y.length || 1));
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] + g * y[i];
  return out;
}
/* Room: FFT convolution with an exponentially decaying noise IR (RT60, wet mix). */
export function addRoom(eng, x, sr, rt60, wet, R) {
  const irLen = Math.floor(rt60 * sr);
  const ir = new Float64Array(irLen);
  for (let i = 0; i < irLen; i++) ir[i] = (R() * 2 - 1) * Math.pow(10, (-3 * i) / irLen) * (i < sr * 0.01 ? 0 : 1);
  let e = 0; for (let i = 0; i < irLen; i++) e += ir[i] * ir[i];
  const g = 1 / Math.sqrt(e || 1);
  const B = 1 << 15, N = B * 2;
  let n2 = 1; while (n2 < irLen + B) n2 <<= 1;
  const H_re = new Float64Array(n2), H_im = new Float64Array(n2);
  for (let i = 0; i < irLen; i++) H_re[i] = ir[i] * g;
  eng._fft(H_re, H_im);
  const out = new Float64Array(x.length + irLen);
  for (let s = 0; s < x.length; s += B) {
    const re = new Float64Array(n2), im = new Float64Array(n2);
    for (let i = 0; i < B && s + i < x.length; i++) re[i] = x[s + i];
    eng._fft(re, im);
    for (let k = 0; k < n2; k++) { const a = re[k], b = im[k]; re[k] = a * H_re[k] - b * H_im[k]; im[k] = a * H_im[k] + b * H_re[k]; }
    eng._ifft(re, im);
    for (let i = 0; i < n2 && s + i < out.length; i++) out[s + i] += re[i];
  }
  void N;
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = (1 - wet) * x[i] + wet * out[i];
  return y;
}
/* Stem bleed: a drum kit (kick/snare/hats) + optional bass line under the stem, as an
 * imperfect separator leaves behind. `level` is relative RMS of the bleed. */
export function addBleed(x, sr, bpm, level, R, bassAudio) {
  const y = new Float32Array(x.length);
  const spb = 60 / bpm;
  for (let b = 0; b * spb * sr < x.length; b++) {
    const at = Math.floor(b * spb * sr);
    if (b % 2 === 0) for (let i = 0; i < 0.3 * sr && at + i < y.length; i++) { const t = i / sr; y[at + i] += 0.9 * Math.sin(2 * Math.PI * (50 + 70 * Math.exp(-t * 30)) * t) * Math.exp(-t * 9); }
    else for (let i = 0; i < 0.18 * sr && at + i < y.length; i++) { const t = i / sr; y[at + i] += (0.5 * (R() * 2 - 1) + 0.3 * Math.sin(2 * Math.PI * 185 * t)) * Math.exp(-t * 22); }
    for (const off of [0, 0.5]) { const h = Math.floor((b + off) * spb * sr); let hp = 0, prev = 0; for (let i = 0; i < 0.05 * sr && h + i < y.length; i++) { const w = R() * 2 - 1; hp = 0.85 * (hp + w - prev); prev = w; y[h + i] += 0.25 * hp * Math.exp(-i / (sr * 0.012)); } }
  }
  if (bassAudio) for (let i = 0; i < y.length && i < bassAudio.length; i++) y[i] += bassAudio[i] * 1.5;
  const rms = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / (a.length || 1)); };
  const g = (level * rms(x)) / (rms(y) || 1);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = x[i] + g * y[i];
  return out;
}

/* The app's CURRENT downsampler (TabDecoderPro.tsx `dsChan`): box-average decimation. */
export function boxDecimate(x, sr, target = 16000) {
  const factor = Math.max(1, Math.floor(sr / target));
  const L = Math.floor(x.length / factor), o = new Float32Array(L);
  for (let i = 0; i < L; i++) { let v = 0; for (let j = 0; j < factor; j++) v += x[i * factor + j]; o[i] = v / factor; }
  return { audio: o, sr: sr / factor };
}

/* ---- MIREX-style scoring ---------------------------------------------------
 * Frame-sampled at 10 ms. For each metric, frames whose REFERENCE falls outside the
 * metric's vocabulary are excluded (mir_eval convention). Reference N frames count
 * (an estimate must be N there). Segmentation = 1 − max(under, over) directional
 * Hamming distance (Harte 2010 / mir_eval.chord.seg). */
export function score(gt, est, QUALITIES, totalSec) {
  const hop = 0.01;
  const at = (segs, t) => { for (const s of segs) if (t >= s.t0 && t < s.t1) return s.label; return null; };
  const estSegs = est.map((e) => ({ t0: e.startSec, t1: e.startSec + e.durSec, label: e.symbol }));
  const m = { root: [0, 0], majmin: [0, 0], sevenths: [0, 0], pcs: [0, 0], bass: [0, 0] };
  for (let t = 0; t < totalSec; t += hop) {
    const rl = parseLabel(at(gt, t), QUALITIES), el = parseLabel(at(estSegs, t), QUALITIES);
    const isN = !rl;
    // root
    m.root[1]++; if (isN ? !el : el && el.root === rl.root) m.root[0]++;
    // bass (inversion-aware root of the sounding bass)
    if (!isN) { m.bass[1]++; if (el && el.bass === rl.bass) m.bass[0]++; }
    // majmin
    const rt = isN ? "N" : triadClass(rl);
    if (rt) { m.majmin[1]++; const et = el ? triadClass(el) : "N"; if (isN ? !el : el && el.root === rl.root && et === rt) m.majmin[0]++; }
    const rs = isN ? "N" : seventhClass(rl);
    if (rs) { m.sevenths[1]++; const es = el ? seventhClass(el) : "N"; if (isN ? !el : el && el.root === rl.root && es === rs) m.sevenths[0]++; }
    m.pcs[1]++; if (isN ? !el : el && [...rl.pcs].every((p) => el.pcs.has(p)) && el.pcs.size === rl.pcs.size) m.pcs[0]++;
  }
  const r = {};
  for (const k of Object.keys(m)) r[k] = m[k][1] ? m[k][0] / m[k][1] : 0;
  r.seg = segmentation(gt, estSegs, totalSec);
  return r;
}
function dirHamming(a, b) {                       // Σ over a's segments of (len − max overlap with any b)
  let s = 0;
  for (const x of a) {
    let best = 0;
    for (const y of b) { const o = Math.min(x.t1, y.t1) - Math.max(x.t0, y.t0); if (o > best) best = o; }
    s += (x.t1 - x.t0) - best;
  }
  return s;
}
function segmentation(gt, est, total) {
  const fill = (segs) => {                         // contiguous cover of [0,total]
    const out = []; let t = 0;
    for (const s of [...segs].sort((a, b) => a.t0 - b.t0)) { if (s.t0 > t) out.push({ t0: t, t1: s.t0 }); out.push({ t0: Math.max(t, s.t0), t1: Math.min(total, s.t1) }); t = Math.min(total, s.t1); }
    if (t < total) out.push({ t0: t, t1: total });
    return out.filter((s) => s.t1 > s.t0);
  };
  const g = fill(gt), e = fill(est);
  const under = dirHamming(g, e) / total, over = dirHamming(e, g) / total;
  return 1 - Math.max(under, over);
}

/* ---- corpus: unique songs × their most chordal comp track ------------------ */
export const CORPUS = [
  ["Blue Sky ver.02.gp", 1, "guitar"],
  ["Boz Scaggs - Lowdown.gpx", 2, "piano"],
  ["Charlie Parker - Anthropology.gp5", 1, "guitar"],
  ["Charlie Parker - Billies Bounce.gp4", 3, "piano"],
  ["Charlie Parker - Blues For Alice (ver 2).gp5", 1, "guitar"],
  ["Charlie Parker - Confirmation.gp", 0, "guitar"],
  ["Charlie Parker - Jazz Chord Soloing.gp", 0, "guitar"],
  ["Charlie Parker - Ornithology.gp3", 2, "piano"],
  ["Charlie Parker - Parkers Mood.gp4", 1, "piano"],
  ["Robben Ford - Aint Got Nothin But The Blues.gp", 1, "guitar"],
  ["Robben Ford - Revelation.gp", 0, "guitar"],
  ["Steely Dan - Black Cow.gp", 0, "guitar"],
  ["Steely Dan - Peg.gp4", 3, "guitar"],
  ["Steely Dan - Peg.gp4", 6, "piano"],
  ["Stevie Ray Vaughan & Double Trouble - Tightrope.gp4", 2, "guitar"],
  ["band-the_weight.gpx", 0, "guitar"],
  ["clapton-eric-help_the_poor.gp4", 5, "guitar"],
  ["gaye-marvin-i_heard_it_through_the_grapevine.gp4", 1, "guitar"],
  ["gaye-marvin-i_heard_it_through_the_grapevine.gp4", 0, "organ"],
  ["huey-lewis-and-the-news-if_this_is_it.gp4", 5, "piano"],
  ["huey-lewis-and-the-news-power_of_love.gp4", 3, "organ"],
  ["steely-dan-hey_nineteen.gp3", 2, "guitar"],
  ["steely-dan-kid_charlemegne.gp3", 0, "guitar"],
  ["the-black-crowes-bad_luck_blue_eyes_goodbye.gp4", 0, "guitar"],
  ["parker_charlie-cheryl.gp4", 1, "guitar"],
  ["what you won't do for love.gp", 0, "guitar"],
  ["Elvis Presley - Suspicious Minds.gp4", 0, "guitar"],
  ["John Coltrane - My Favorite Things.gpx", 0, "piano"],
];
// the bass track for the "bleed" condition, when the file has one
export const BASS_PART = {
  "Steely Dan - Peg.gp4": 7, "Steely Dan - Black Cow.gp": 1, "steely-dan-kid_charlemegne.gp3": 4,
  "Charlie Parker - Ornithology.gp3": 0, "gaye-marvin-i_heard_it_through_the_grapevine.gp4": 3,
  "huey-lewis-and-the-news-if_this_is_it.gp4": 6, "huey-lewis-and-the-news-power_of_love.gp4": 6,
  "Robben Ford - Aint Got Nothin But The Blues.gp": 2, "band-the_weight.gpx": 1,
};
