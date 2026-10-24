#!/usr/bin/env node
/* Build data/chords.json — the chord-voicing library the lead-sheet modal reads.
 *
 *   node scripts/build_chords_json.mjs
 *
 * Base: scripts/chords-db-base.json = tombatossals/chords-db guitar.json (MIT, © David
 * Rubert), as shipped by quantumq1981/Parker-songbook-tool (MIT). Deterministic:
 *   1. every base position is checked against the interval formula of the chord it is
 *      filed under (engine.tsx voicingFormula); a shape that doesn't sound that chord
 *      (wrong key, add9 filed as 9, a ♭5 triad filed as "alt" …) is dropped and counted;
 *   2. extra qualities the base lacks (7♯11, 13♭9, maj7♯11, m13, 9sus4 …) are added;
 *   3. every key × quality is topped up to TARGET shapes with grips from the engine's
 *      exhaustive fretboard search (enumerateChordGrips), marked "generated": true.
 * The engine is imported from source, so the file and the runtime can't disagree. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
const tmp = path.join(here, ".engine.build.mjs");
fs.writeFileSync(tmp, fs.readFileSync(path.join(repo, "engine.tsx"), "utf8"));
const E = await import(tmp + "?t=" + Date.now());
fs.unlinkSync(tmp);

const TARGET = 12;
const EXTRA_SUFFIXES = ["m13", "7#11", "7b13", "7#5#9", "7b9b13", "7#9b13", "7b9#11", "7#9#11", "7b9b5",
  "13b9", "13#11", "9sus4", "13sus4", "7sus2", "maj7#11", "maj9#11", "m7#5", "m7b9", "madd11", "add13"];
const OPEN = [40, 45, 50, 55, 59, 64];

const base = JSON.parse(fs.readFileSync(path.join(here, "chords-db-base.json"), "utf8"));
const out = { main: { ...base.main }, tunings: base.tunings, keys: base.keys, suffixes: [], chords: {} };
const suffixes = [...base.suffixes.filter((s) => !s.includes("/")), ...EXTRA_SUFFIXES];
const slashSuffixes = base.suffixes.filter((s) => s.includes("/"));
out.suffixes = [...suffixes, ...slashSuffixes];

const toPosition = (frets, fingers, barres) => {
  const fr = frets.filter((f) => f > 0);
  const max = fr.length ? Math.max(...fr) : 0;
  const baseFret = max <= 4 ? 1 : Math.min(...fr);
  const rel = (f) => (f > 0 ? f - baseFret + 1 : f);
  return { frets: frets.map(rel), fingers, baseFret, barres: [...new Set(barres.map((b) => rel(b.fret)))],
    midi: frets.map((f, s) => (f >= 0 ? OPEN[s] + f : null)).filter((m) => m != null), generated: true };
};

let kept = 0, dropped = 0, added = 0;
const droppedBy = {};
for (const key of base.keys) {
  const dkey = key.replace("#", "sharp");
  const pc = E.VOICING_DICT_KEYS.indexOf(dkey);
  const entries = base.chords[dkey] || [];
  const list = [];
  for (const suffix of [...suffixes, ...slashSuffixes]) {
    const entry = entries.find((e) => e.suffix === suffix);
    const sm = suffix.match(/^(.*?)\/([A-G][#b]?)$/);
    const formula = E.voicingFormula(sm ? sm[1] : suffix);
    const bassPcN = sm ? ({ C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 })[sm[2]] : null;
    if (!formula) throw new Error(`no formula for ${suffix}`);
    const positions = [];
    const seen = new Set();
    for (const p of entry ? entry.positions : []) {
      const n = E.normalizeDictPosition(p);
      const one = { suffixes: base.suffixes, chords: { [dkey]: [{ suffix, positions: [p] }] } };
      const ok = n && (sm
        ? E.dictVoicings(one, pc, sm[1], formula, bassPcN).length
        : E.dictVoicings(one, pc, suffix, formula).length);
      if (!ok || seen.has(n.frets.join(","))) { dropped++; (droppedBy[suffix] ||= 0); droppedBy[suffix]++; continue; }
      seen.add(n.frets.join(",")); positions.push(p); kept++;
    }
    if (!sm && positions.length < TARGET) {   // slash shapes are generated live (the modal's bass group)
      const grips = E.enumerateChordGrips(pc, formula, { bassPc: sm ? bassPcN : null, max: TARGET * 2 });
      for (const g of grips) {
        if (positions.length >= TARGET) break;
        const sig = g.frets.join(",");
        if (seen.has(sig)) continue;
        const fg = E.assignChordFingers(g.frets);
        if (!fg) continue;
        seen.add(sig); positions.push(toPosition(g.frets, fg.fingers, fg.barres)); added++;
      }
    }
    if (positions.length) list.push({ key, suffix, positions });
  }
  out.chords[dkey] = list;
}
const n = Object.values(out.chords).reduce((a, l) => a + l.reduce((b, e) => b + e.positions.length, 0), 0);
out.main = { ...base.main, numberOfChords: n,
  source: "tombatossals/chords-db guitar.json (MIT) via Parker-songbook-tool, validated + extended by scripts/build_chords_json.mjs",
  validation: { kept, dropped, generated: added } };
const file = path.join(repo, "data", "chords.json");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out));
console.log(`data/chords.json: ${n} positions, ${out.suffixes.length} suffixes × ${base.keys.length} keys; kept ${kept}, dropped ${dropped} (wrong pitches/duplicates), generated ${added}; ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
console.log("dropped by suffix:", JSON.stringify(droppedBy));
