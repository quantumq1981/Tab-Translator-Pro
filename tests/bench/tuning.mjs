/* tuning.mjs — alternate tunings for the tab path, on the repo's own Guitar Pro files.
 *
 *  Dev-only, Node. Nothing here ships. Every GP track states its tuning, so it is ground truth for
 *  two questions Guitar → Tab has to answer:
 *   1. What does fingering in the WRONG tuning cost?  For each non-standard track, strip the
 *      written fingering, keep the sounding pitches, and finger them in the track's real tuning vs
 *      in standard. Score = % of notes on the written string (a pitch standard can't reach = wrong).
 *   2. Can the pitches alone tell the tuning?  `suggestGuitarTuning` on every 6-string guitar track
 *      whose tuning is one of GUITAR_TUNINGS: right answer, and — the number that matters most —
 *      how often it suggests a non-standard tuning for a STANDARD-tuned track.
 *  Split: even file index = dev (tune the margin here), odd = test (report only).
 *
 *    node bench/tuning.mjs                    # both questions, both splits
 *    node bench/tuning.mjs --margin 0.8       # detector margin (per-note cost)
 *    node bench/tuning.mjs --sweep            # margin sweep on DEV
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEngine } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const eng = await loadEngine();
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);

const presetOf = (t) => eng.GUITAR_TUNINGS.find((p) => p.midi.every((m, i) => m === t[i]));

async function loadCorpus() {
  const files = fs.readdirSync(repo).filter((f) => /\.(gp|gp3|gp4|gp5|gpx)$/i.test(f)).sort();
  const tracks = [];
  for (const [fi, file] of files.entries()) {
    const split = fi % 2 === 0 ? "dev" : "test";
    const bytes = new Uint8Array(fs.readFileSync(path.join(repo, file)));
    let first;
    try { first = await eng.parseGuitarProOrXML(bytes, file, true, 0); } catch { continue; }
    for (const { index } of first.parts || [{ index: 0 }]) {
      let s;
      try { s = await eng.parseGuitarProOrXML(bytes, file, true, index); } catch { continue; }
      const t = s.tuningMidi || [];
      if (eng.isPercussionTuning(t) || t.filter((m) => m != null).length !== 6 || s.capo) continue;
      const preset = presetOf(t);
      if (!preset) continue;                         // octave-shifted / bass / custom tunings
      const events = [], truth = [];
      let lastEnd = null;
      s.bars.forEach((b, bi) => b.events.forEach((e) => {
        const bpb = (b.timeSig || s.timeSig || [4, 4])[0];
        const on = bi * bpb + (e.qbeat ?? e.beat ?? 0), dur = e.qdur ?? e.durBeats ?? 1;
        if (e.frets && Object.keys(e.frets).length && Object.keys(e.frets).length === e.midis.length) {
          events.push({ midis: e.midis, gap: lastEnd == null ? 0 : Math.max(0, on - lastEnd) });
          truth.push(Object.entries(e.frets).map(([st, fret]) => ({ string: +st, midi: t[+st] + fret })));
        }
        lastEnd = on + dur;
      }));
      if (events.length < 20) continue;
      // Ground truth only where the written part is playable on its own tuning (GP files also hold
      // keyboard / vocal tracks with a guitar tuning whose notes sit below the low string).
      if (s.bars.some((b) => b.events.some((e) => (e.midis || []).some((m) => m < t[0] || m > t[5] + 24)))) continue;
      // A score of just the fingered events, for the detector (it reads bars/events like the app).
      const bars = [{ timeSig: [4, 4], events: events.map((e) => ({ midis: e.midis })) }];
      tracks.push({ split, file, part: index, tuning: preset.id, events, truth, score: { bars } });
    }
  }
  return tracks;
}

function stringAcc(tr, tuning) {
  const { shapes } = eng.fingerSequence(tr.events, tuning);
  let hit = 0, n = 0;
  tr.truth.forEach((notes, i) => {
    const sh = shapes[i] || [];
    for (const nt of notes) { n++; if (sh.some((x) => x.midi === nt.midi && x.string === nt.string)) hit++; }
  });
  return { hit, n };
}

const tracks = await loadCorpus();
const pct = (a, b) => (b ? (100 * a / b).toFixed(1) : "—");

// 1. cost of fingering in the wrong tuning
console.log("\n1. String accuracy, non-standard tracks — fingered in the real tuning vs in standard");
const ns = tracks.filter((t) => t.tuning !== "standard");
let A = { hit: 0, n: 0 }, B = { hit: 0, n: 0 };
for (const tr of ns) {
  const a = stringAcc(tr, eng.guitarTuning(tr.tuning).midi), b = stringAcc(tr, eng.guitarTuning("standard").midi);
  A.hit += a.hit; A.n += a.n; B.hit += b.hit; B.n += b.n;
  console.log(`   ${(tr.file.slice(0, 34) + "#" + tr.part).padEnd(38)} ${tr.tuning.padEnd(10)} real ${pct(a.hit, a.n).padStart(5)}%   standard ${pct(b.hit, b.n).padStart(5)}%   (${a.n} notes)`);
}
console.log(`   ALL ${ns.length} tracks: real tuning ${pct(A.hit, A.n)}%  vs  standard ${pct(B.hit, B.n)}%  (${A.n} notes)`);

// 2. detection
function detect(margin, split) {
  const rows = tracks.filter((t) => split === "all" || t.split === split);
  let stdN = 0, stdFP = 0, nsN = 0, nsRight = 0, nsSuggested = 0;
  const conf = [];
  for (const tr of rows) {
    const sug = eng.suggestGuitarTuning(tr.score, { margin });
    const got = sug ? sug.id : "standard";
    if (tr.tuning === "standard") { stdN++; if (got !== "standard") { stdFP++; conf.push(`std → ${got}  ${tr.file.slice(0, 30)}#${tr.part}`); } }
    else { nsN++; if (got !== "standard") nsSuggested++; if (got === tr.tuning) nsRight++; else conf.push(`${tr.tuning} → ${got}  ${tr.file.slice(0, 30)}#${tr.part}`); }
  }
  return { stdN, stdFP, nsN, nsRight, nsSuggested, conf };
}
if (has("--sweep")) {
  console.log("\n2. Margin sweep (DEV): standard false positives / non-standard right");
  for (const m of [0, 0.25, 0.5, 1, 2]) {
    const r = detect(m, "dev");
    console.log(`   margin ${String(m).padEnd(5)} std→other ${r.stdFP}/${r.stdN}   non-std right ${r.nsRight}/${r.nsN} (suggested ${r.nsSuggested})`);
  }
}
const margin = +arg("--margin", "0");
for (const split of ["dev", "test"]) {
  const r = detect(margin, split);
  console.log(`\n2. Detection (${split}, margin ${margin}): standard tracks wrongly flagged ${r.stdFP}/${r.stdN}; non-standard identified ${r.nsRight}/${r.nsN} (any suggestion ${r.nsSuggested}/${r.nsN})`);
  for (const c of r.conf) console.log("     " + c);
}
