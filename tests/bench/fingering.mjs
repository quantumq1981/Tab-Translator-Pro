/* fingering.mjs — Stage 3 (string/fret assignment) baseline on the repo's own Guitar Pro files.
 *
 *  Dev-only, Node. Nothing here ships. Every GP track in the repo carries the fingering a
 *  transcriber WROTE (string + fret per note), so it is audio-free ground truth for the
 *  "which string is this pitch on" problem. We strip the fingering, keep the pitches, ask a
 *  heuristic to re-finger them, and count how many notes land on the written string.
 *
 *  Scope: standard-tuned 6-string tracks, no capo, events whose every pitch carries a fret.
 *  Split: even file index = dev (tune here), odd = test (report only) — same rule as run.mjs.
 *
 *    node bench/fingering.mjs            # both splits
 *    node bench/fingering.mjs --split test
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEngine } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const eng = await loadEngine();

const STD = [40, 45, 50, 55, 59, 64];   // engine index 0 = low E … 5 = high e
const MAX_FRET = 22;
const MAX_SPAN = 4;                      // fretted span a hand can hold (open strings excluded)
const MAX_SHAPES = 4000;                 // enumeration cap per event (6-note chords stay well under)
const W = { span: 0.3, fretSum: 0.04, open: 0.2, move: 0.5 };

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const splitArg = arg("--split", "all");

const candidates = (midi) => STD.map((open, s) => [s, midi - open]).filter(([, f]) => f >= 0 && f <= MAX_FRET);

/** Every assignment of an event's pitches to distinct strings that a hand can hold. */
function shapesFor(midis) {
  const out = [];
  const ms = [...midis].sort((a, b) => a - b);
  (function rec(i, used, acc) {
    if (out.length >= MAX_SHAPES) return;
    if (i === ms.length) {
      const fretted = acc.filter((n) => n.fret > 0).map((n) => n.fret);
      const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
      if (span <= MAX_SPAN) out.push(acc.slice());
      return;
    }
    for (const [string, fret] of candidates(ms[i])) {
      if (used.has(string)) continue;
      used.add(string); acc.push({ string, fret, midi: ms[i] });
      rec(i + 1, used, acc);
      acc.pop(); used.delete(string);
    }
  })(0, new Set(), []);
  return out;
}

const handPos = (shape) => {
  const fretted = shape.filter((n) => n.fret > 0).map((n) => n.fret);
  return fretted.length ? Math.min(...fretted) : null;
};
const shapeCost = (shape) => {
  const fretted = shape.filter((n) => n.fret > 0).map((n) => n.fret);
  const span = fretted.length ? Math.max(...fretted) - Math.min(...fretted) : 0;
  return W.span * span + W.fretSum * fretted.reduce((a, b) => a + b, 0) - W.open * (shape.length - fretted.length);
};

/** Viterbi over per-event shapes: shape cost + hand movement between consecutive events. */
function viterbiFingering(shapeSets) {
  let prev = shapeSets[0].map((sh) => ({ cost: shapeCost(sh), back: -1 }));
  const trellis = [prev];
  for (let t = 1; t < shapeSets.length; t++) {
    const cur = shapeSets[t].map((sh) => {
      const p = handPos(sh);
      let best = Infinity, bi = 0;
      shapeSets[t - 1].forEach((ps, j) => {
        const pp = handPos(ps);
        const move = p == null || pp == null ? 0 : Math.abs(p - pp);
        const c = prev[j].cost + W.move * move;
        if (c < best) { best = c; bi = j; }
      });
      return { cost: best + shapeCost(sh), back: bi };
    });
    trellis.push(cur);
    prev = cur;
  }
  let k = prev.reduce((bi, x, i, a) => (x.cost < a[bi].cost ? i : bi), 0);
  const picks = [];
  for (let t = shapeSets.length - 1; t >= 0; t--) { picks[t] = shapeSets[t][k]; k = trellis[t][k].back; }
  return picks;
}

const files = fs.readdirSync(repo).filter((f) => /\.(gp|gp3|gp4|gp5|gpx)$/i.test(f)).sort();
const tally = { dev: { tracks: 0, notes: 0, lowest: 0, dp: 0 }, test: { tracks: 0, notes: 0, lowest: 0, dp: 0 } };

for (const [fi, file] of files.entries()) {
  const split = fi % 2 === 0 ? "dev" : "test";
  if (splitArg !== "all" && splitArg !== split) continue;
  const bytes = new Uint8Array(fs.readFileSync(path.join(repo, file)));
  let first;
  try { first = await eng.parseGuitarProOrXML(bytes, true, 0); } catch { continue; }
  for (const { index } of first.parts || [{ index: 0 }]) {
    let score;
    try { score = await eng.parseGuitarProOrXML(bytes, true, index); } catch { continue; }
    if ((score.tuning && score.tuning !== "Standard") || score.capo) continue;
    const events = score.bars.flatMap((b) => b.events)
      .filter((e) => e.frets && Object.keys(e.frets).length && Object.keys(e.frets).length === e.midis.length);
    if (events.length < 20) continue;
    const truth = events.map((e) => Object.entries(e.frets).map(([s, fret]) => ({ string: +s, fret, midi: STD[+s] + fret })));
    const shapeSets = truth.map((notes) => shapesFor(notes.map((n) => n.midi)));
    if (shapeSets.some((s) => !s.length)) continue;   // a written stretch wider than MAX_SPAN
    const picks = viterbiFingering(shapeSets);
    const t = tally[split];
    t.tracks++;
    truth.forEach((notes, i) => notes.forEach((n) => {
      t.notes++;
      const lowest = candidates(n.midi).reduce((a, b) => (b[1] < a[1] ? b : a));
      if (lowest[0] === n.string) t.lowest++;
      const chosen = picks[i].find((x) => x.midi === n.midi);
      if (chosen && chosen.string === n.string) t.dp++;
    }));
  }
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + "%" : "—");
for (const [split, t] of Object.entries(tally)) {
  if (!t.notes) continue;
  console.log(`${split.padEnd(4)}  tracks ${String(t.tracks).padStart(3)}  notes ${String(t.notes).padStart(6)}  ` +
    `lowest-fret ${pct(t.lowest, t.notes).padStart(6)}  viterbi ${pct(t.dp, t.notes).padStart(6)}`);
}
