/* A REAL recording + its score: what linking buys, measured against the score itself.
 *   node bench/link-real.mjs --score <file.gp|.musicxml|.ptb|.mid> --audio <file.mp3|.m4a|.wav> [--vocab chart] [--weights 0.15,0.3,1]
 * The audio is decoded with ffmpeg (16 kHz mono). "Truth" here is the score's own harmony read on the
 * link's clock (comping parts, the oracle's names) — for a real record that is the best reference
 * there is, and it is only as right as the file and the alignment. Reported: the link (key, tempo,
 * match vs the best wrong key), and audio-only vs linked agreement with that reading (root / majmin /
 * exact name, sampled every 0.1 s), plus the linked decode's own agreement and disagreement count. */
import fs from "node:fs"; import { execFileSync } from "node:child_process";
import * as L from "./lib.mjs";
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const SCORE = arg("score"), AUDIO = arg("audio"), vocab = arg("vocab", "chart");
if (!SCORE || !AUDIO) { console.error("--score and --audio are required"); process.exit(2); }
const E = await L.loadEngine();
const raw = execFileSync("ffmpeg", ["-v", "error", "-i", AUDIO, "-ac", "1", "-ar", "16000", "-f", "f32le", "-"], { maxBuffer: 1 << 30 });
const pcm = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
const bytes = new Uint8Array(fs.readFileSync(SCORE));
const first = await E.parseGuitarProOrXML(bytes, SCORE, true);
const ps = [];
for (const p of first.parts && first.parts.length ? first.parts : [{ index: 0, name: SCORE }]) ps.push({ score: p.index === first.partIndex ? first : await E.parseGuitarProOrXML(bytes, SCORE, true, p.index), name: p.name, drum: !!p.drum });
const fr = E.nnlsChromagram(pcm, 16000, {});
const plain = E.analyzeAudioChordsV2(pcm, 16000, { vocabulary: vocab, _frames: fr });
const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const evAt = (evs, t) => evs.find((e) => t >= e.startSec && t < e.startSec + e.durSec);
let report = null;
for (const w of arg("weights", "0.15,0.3,1").split(",").map(Number)) {
  const t0 = Date.now();
  const r = E.analyzeAudioWithScore(pcm, 16000, ps, { tempo: first.tempo, vocabulary: vocab, _frames: fr, scoreWeight: w, force: true });
  const lk = r.link;
  if (!report) {
    report = lk;
    console.log(`link: ok=${lk.ok} transpose=${lk.transpose} match=${lk.confidence} (next best key ${lk.runnerUp && lk.runnerUp.confidence}) tempo≈${lk.tempo} (score ${first.tempo}) bars ${lk.bars.length} ↔ ${lk.coverage.audioFrom}–${lk.coverage.audioTo}s of ${lk.coverage.audioLen}s · parts ${lk.parts.map((p) => p.name + "×" + p.weight).join(", ")}`);
  }
  const parts = E.scoreLinkParts(ps), grid = E.scoreLinkPriorGrid(parts, lk.len, 0.5), states = E.chordStatesV2({ vocabulary: vocab });
  const k = ((lk.transpose % 12) + 12) % 12;
  const truth = (t) => { const q = E.linkSecToQ(lk, t); if (q < 0 || q >= lk.len) return null; const g = grid[Math.floor(q / 0.5)]; const ch = new Float64Array(12), bs = new Float64Array(12); for (let p = 0; p < 12; p++) { ch[(p + k) % 12] = g.chroma[p]; bs[(p + k) % 12] = g.bass[p]; } const b = E._scorePriorBonus({ chroma: ch, bass: bs }, states, { vocabulary: vocab }); return b ? states[b.best] : null; };
  const measure = (evs) => {
    let n = 0, root = 0, mm = 0, nm = 0, ex = 0;
    for (let t = lk.coverage.audioFrom; t < lk.coverage.audioTo; t += 0.1) {
      const tr = truth(t); if (!tr) continue; n++; const bb = L.triadClass(L.parseLabel(NAMES[tr.root] + (tr.writeQ || tr.quality).suffix, E.QUALITIES));
      const e = evAt(evs, t); if (!e) { if (bb) nm++; continue; }
      const pe = L.parseLabel(e.symbol, E.QUALITIES), name = NAMES[tr.root] + (tr.writeQ || tr.quality).suffix;
      if (pe && pe.root === tr.root) root++;
      const b = L.triadClass(L.parseLabel(name, E.QUALITIES)); if (b) { nm++; if (pe && pe.root === tr.root && L.triadClass(pe) === b) mm++; }
      if (E._sameChordClass(e.symbol, name)) ex++;
    }
    return `root ${(100 * root / n).toFixed(1)}  majmin ${(100 * mm / (nm || 1)).toFixed(1)}  exact ${(100 * ex / n).toFixed(1)}`;
  };
  if (w === +arg("weights", "0.15,0.3,1").split(",")[0]) console.log(`audio alone        : ${measure(plain.events)}  (${plain.events.length} chords)`);
  console.log(`linked, weight ${String(w).padEnd(4)}: ${measure(r.events)}  (${r.events.length} chords, agreement ${r.agreement}, ${r.disagreements} to review, ${Date.now() - t0} ms)`);
}
