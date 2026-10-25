// Usage (from tests/): node bench/beatthis/render.mjs <outDir>  — see bench/beatthis/README.md
// Render GP songs as comp+bass(+drums) mixes with exact beat/downbeat truth.
import fs from "node:fs"; import path from "node:path";
import * as L from "../lib.mjs";
const OUT = process.argv[2]; const SEC = 45, SR = 22050;
const eng = await L.loadEngine();
function drums(len, bpm, R, accentDownbeat, bpb) {
  const y = new Float32Array(len), spb = 60 / bpm;
  for (let b = 0; b * spb * SR < len; b++) {
    const at = Math.floor(b * spb * SR);
    if (b % 2 === 0) for (let i = 0; i < 0.3 * SR && at + i < len; i++) { const t = i / SR; y[at + i] += 0.9 * Math.sin(2 * Math.PI * (50 + 70 * Math.exp(-t * 30)) * t) * Math.exp(-t * 9); }
    else for (let i = 0; i < 0.18 * SR && at + i < len; i++) { const t = i / SR; y[at + i] += (0.5 * (R() * 2 - 1) + 0.3 * Math.sin(2 * Math.PI * 185 * t)) * Math.exp(-t * 22); }
    for (const off of [0, 0.5]) { const h = Math.floor((b + off) * spb * SR); let hp = 0, prev = 0; for (let i = 0; i < 0.05 * SR && h + i < len; i++) { const w = R() * 2 - 1; hp = 0.85 * (hp + w - prev); prev = w; y[h + i] += 0.25 * hp * Math.exp(-i / (SR * 0.012)); } }
  }
  return y;
}
const rms = (a) => { let s = 0; for (const v of a) s += v * v; return Math.sqrt(s / (a.length || 1)) || 1; };
const scaled = (a, r) => { const g = r / rms(a); return Float32Array.from(a, (v) => v * g); };
const meta = [];
for (const [file, bassPart] of Object.entries(L.BASS_PART)) {
  const idx = L.CORPUS.findIndex(([f]) => f === file); if (idx < 0) continue; const [, part, inst] = L.CORPUS[idx];
  const bytes = new Uint8Array(fs.readFileSync(path.join(L.repo, file)));
  const score = await eng.parseGuitarProOrXML(bytes, file, true, part);
  const r = L.renderPart(eng, score, { sr: SR, instrument: inst, seed: 17 + idx, maxSec: SEC }); if (!r) continue;
  const br = L.renderPart(eng, await eng.parseGuitarProOrXML(bytes, file, true, bassPart), { sr: SR, instrument: "bass", seed: 99, fromSec: r.t0, maxSec: SEC });
  // truth: bar starts from the score's meters at r.bpm, shifted by the excerpt start
  const beats = [], downs = []; let t = 0; let bpb0 = null;
  for (const bar of score.bars) {
    const [n, d] = bar.timeSig || score.timeSig || [4, 4];
    const beatSec = (60 / r.bpm) * 4 / d; const nb = (d === 8 && n % 3 === 0) ? n / 3 : n; const pulse = (n / nb) * beatSec;
    if (bpb0 == null) bpb0 = nb;
    for (let k = 0; k < nb; k++) { const tt = t + k * pulse - r.t0; if (tt >= 0 && tt < SEC) { beats.push(tt); if (k === 0) downs.push(tt); } }
    t += n * beatSec;
  }
  const len = r.audio.length, R = L.rng(5 + idx);
  const comp = scaled(r.audio, 0.1), bass = scaled(Float32Array.from({ length: len }, (_, i) => (br && br.audio[i]) || 0), 0.08);
  const dr = scaled(drums(len, r.bpm, R), 0.08);
  for (const [cond, withDrums] of [["drums", 1], ["nodrums", 0]]) {
    const mono = Float32Array.from({ length: len }, (_, i) => comp[i] + bass[i] + withDrums * dr[i]);
    const name = `${idx}-${cond}`;
    fs.writeFileSync(path.join(OUT, name + ".wav"), eng.encodeWav16([mono], SR));
    // our current tracker, on the 16 kHz path the app uses
    const pcm16 = eng.resampleTo ? eng.resampleTo(mono, SR, 16000) : mono;
    let ours = null; try { const db = eng.detectBeats(pcm16, 16000); ours = { bpm: db.bpm, beats: db.beats }; } catch (e) { ours = { err: String(e) }; }
    meta.push({ name, file, cond, bpm: r.bpm, beats, downbeats: downs, ours, timeSig: score.bars[0].timeSig || score.timeSig });
  }
  console.error(file, r.bpm, beats.length, downs.length);
}
fs.writeFileSync(path.join(OUT, "truth.json"), JSON.stringify(meta));
