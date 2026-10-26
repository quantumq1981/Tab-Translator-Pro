/* beatgrid.mjs — does the chart's beat grid sit on the recording's real beats? (GuitarSet)
 *
 *  Dev-only, Node. Nothing here ships. GuitarSet (Xi et al. 2018, CC-BY 4.0) was recorded to a
 *  click, and its `beats_s` are those beats, so it measures the two ways an audio chart can lay
 *  its beats:
 *    • fixed ♩=  — the old way: the detected tempo rounded to a whole BPM, laid from t = 0;
 *    • timeline  — `audioBeatTimeline` (the Muscriptor v0.4 port): regularised tracked beats,
 *                  least-squares tempo, bar 1 on the first beat, a tempo map when not steady;
 *    • tracked   — the tracker's raw beats (the ceiling for anything built on them);
 *    • ×2/÷2     — the timeline after the best of the manual ×2 / ÷2 buttons (what a user can fix).
 *  Beat F-measure at ±70 ms over the annotated span; tempo Acc1 = within 4 % of the annotation.
 *
 *  Data: scripts/guitarset_beats.py writes <track>.wav (22.05 kHz mono mic) + <track>.json
 *  (beats_s, tempo_bpm, style). Optional second dir: <track>.beats.json from another tracker
 *  ({ beats, downbeats }, e.g. bench/beatthis/eval.py --dump) scored the same way.
 *
 *    node bench/beatgrid.mjs <gs dir> [--learned <dir> [--only-learned]] [--limit N]
 *  --only-learned scores only the tracks the learned tracker has a file for (a like-for-like subset).
 */
import fs from "node:fs";
import path from "node:path";
import { loadEngine } from "./lib.mjs";

const eng = await loadEngine();
const argv = process.argv.slice(2);
const flag = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const dir = argv[0], learnedDir = flag("--learned"), limit = +(flag("--limit") || 1e9);

function readWav(file) {
  const b = fs.readFileSync(file), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 12, sr = 0, ch = 1, bits = 16, data = null;
  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4), sz = dv.getUint32(p + 4, true);
    if (id === "fmt ") { ch = dv.getUint16(p + 10, true); sr = dv.getUint32(p + 12, true); bits = dv.getUint16(p + 22, true); }
    if (id === "data") { data = [p + 8, sz]; break; }
    p += 8 + sz + (sz & 1);
  }
  if (bits !== 16 || !data) throw new Error("16-bit PCM only: " + file);
  const n = Math.floor(data[1] / 2 / ch), x = new Float32Array(n);
  for (let i = 0; i < n; i++) { let v = 0; for (let c = 0; c < ch; c++) v += dv.getInt16(data[0] + 2 * (i * ch + c), true); x[i] = v / ch / 32768; }
  return { sr, x };
}
function fMeasure(est, ref, tol = 0.07) {
  const lo = ref[0] - tol, hi = ref[ref.length - 1] + tol, e = est.filter((t) => t >= lo && t <= hi);
  if (!e.length || !ref.length) return 0;
  const used = new Uint8Array(e.length); let hit = 0, j = 0;
  for (const r of ref) {
    while (j < e.length && e[j] < r - tol) j++;
    for (let k = j; k < e.length && e[k] <= r + tol; k++) if (!used[k]) { used[k] = 1; hit++; break; }
  }
  const P = hit / e.length, R = hit / ref.length;
  return P + R ? (2 * P * R) / (P + R) : 0;
}
const gridTimes = (secAt, from, to) => { const out = []; for (let k = -4000; k < 4000; k++) { const t = secAt(k); if (t > to) break; if (t >= from) out.push(t); } return out; };

const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".beats.json")).sort().slice(0, limit);
const rows = [];
for (const f of files) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const ref = meta.beats_s; if (!ref || ref.length < 8) continue;
  const { sr, x } = readWav(path.join(dir, f.replace(/\.json$/, ".wav")));
  const pcm = eng.resampleTo(x, sr, 16000), dur = pcm.length / 16000;
  const det = eng.detectBeats(pcm, 16000);
  const r = { id: meta.track_id, style: meta.style, tempo: meta.tempo_bpm };
  const fixedBpm = Math.round(det.bpm);
  r.fixed = fMeasure(gridTimes((k) => (k * 60) / fixedBpm, 0, dur), ref);
  r.tracked = fMeasure(det.beats, ref);
  const tl = eng.audioBeatTimeline(det.beats, {}, { beatsPerBar: 4 });
  r.timeline = tl ? fMeasure(gridTimes((k) => eng.timelineSecondsAt(tl.timeline, k), 0, dur), ref) : 0;
  r.fixedFit = tl ? fMeasure(gridTimes((k) => eng.timelineSecondsAt(eng.audioBeatTimeline(det.beats, { tempoMap: false }, { beatsPerBar: 4 }).timeline, k), 0, dur), ref) : 0;
  r.best = r.timeline;
  for (const s of [0.5, 2]) { const t2 = eng.audioBeatTimeline(det.beats, { beatScale: s }, { beatsPerBar: 4 }); if (t2) r.best = Math.max(r.best, fMeasure(gridTimes((k) => eng.timelineSecondsAt(t2.timeline, k), 0, dur), ref)); }
  r.acc1Fixed = Math.abs(det.bpm / meta.tempo_bpm - 1) <= 0.04;
  r.acc1Fit = !!tl && Math.abs(tl.bpm / meta.tempo_bpm - 1) <= 0.04;
  r.steady = tl ? tl.steady : null;
  if (learnedDir) {
    const lf = path.join(learnedDir, meta.track_id + ".beats.json");
    if (fs.existsSync(lf)) {
      const L = JSON.parse(fs.readFileSync(lf, "utf8"));
      r.lTracked = fMeasure(L.beats, ref);
      const lt = eng.audioBeatTimeline(L.beats, {}, { beatsPerBar: 4, downbeats: L.downbeats });
      r.lTimeline = lt ? fMeasure(gridTimes((k) => eng.timelineSecondsAt(lt.timeline, k), 0, dur), ref) : 0;
      r.lAcc1 = !!lt && Math.abs(lt.bpm / meta.tempo_bpm - 1) <= 0.04;
      const db = ref.filter((_, i) => i % 4 === 0);
      r.lDown = L.downbeats && L.downbeats.length ? fMeasure(L.downbeats, db) : 0;
      r.lMeter = lt ? lt.grid.beatsPerBar : null;
    }
  }
  if (argv.includes("--only-learned") && r.lTracked == null) continue;
  rows.push(r);
  process.stderr.write(".");
}
process.stderr.write("\n");
const mean = (k, rs = rows) => { const v = rs.map((r) => r[k]).filter((x) => x != null); return v.length ? (100 * v.reduce((a, b) => a + (+b), 0)) / v.length : NaN; };
const line = (lbl, rs) => console.log(`${lbl.padEnd(10)} n=${String(rs.length).padStart(3)}  beat F: fixed ♩= ${mean("fixed", rs).toFixed(1)} · one-tempo ${mean("fixedFit", rs).toFixed(1)} · timeline ${mean("timeline", rs).toFixed(1)} · +×2/÷2 ${mean("best", rs).toFixed(1)} · tracked ${mean("tracked", rs).toFixed(1)}  | tempo Acc1: autocorr ${mean("acc1Fixed", rs).toFixed(0)}% · fit ${mean("acc1Fit", rs).toFixed(0)}%  | steady ${mean("steady", rs).toFixed(0)}%` +
  (rs.some((r) => r.lTracked != null) ? `  || learned: tracked ${mean("lTracked", rs).toFixed(1)} · timeline ${mean("lTimeline", rs).toFixed(1)} · Acc1 ${mean("lAcc1", rs).toFixed(0)}% · downbeat F ${mean("lDown", rs).toFixed(1)} · meter 4 ${(100 * rs.filter((r) => r.lMeter === 4).length / rs.length).toFixed(0)}%` : ""));
line("all", rows);
for (const st of ["comp", "solo"]) line(st, rows.filter((r) => r.style === st));
for (const g of ["BN", "Funk", "Jazz", "Rock", "SS"]) line(g, rows.filter((r) => r.id.split("_")[1].startsWith(g)));
if (argv.includes("--json")) console.log(JSON.stringify(rows));
