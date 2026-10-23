/* Technique capture vs PyGuitarPro — dev-only cross-check of the GP3/4/5 effect bytes the
 * parsers now keep (bend, slide, hammer, harmonic, palm mute, vibrato, let ring, staccato,
 * trill, tremolo, grace, ghost). PyGuitarPro is the oracle; it never ships.
 *
 *   python scripts/pgp_techniques.py <dir of .gp3/.gp4/.gp5> /tmp/pgp_tech.json   (needs pyguitarpro)
 *   node bench/techniques.mjs /tmp/pgp_tech.json [<same dir>]                     (default: repo root)
 *
 * Reports, per (track × technique), whether both readers agree the technique is PRESENT.
 * Counts can differ legitimately — identical consecutive chords merge into one event in the
 * engine's score — so the read is presence agreement and "ours-only" (false positives).
 * Measured 2026-10-23 on the repo's 54 GP3/4/5 files: 2955 agree, 0 ours-only, 21 pgp-only.
 * Every pgp-only case is a technique that sits only on a REPEATED identical chord (GnR ghost
 * strums, Peg staccato stabs): `_gpBuildScore` keeps the first of consecutive identical chords,
 * so the repeat's tags go with it. That is the harmonic score model, not a byte misread.
 */
import fs from "node:fs"; import path from "node:path";
import * as L from "./lib.mjs";

const [pgpFile, dir = L.repo] = process.argv.slice(2);
if (!pgpFile) { console.error("usage: node bench/techniques.mjs <pgp_tech.json> [gp dir]"); process.exit(2); }
const eng = await L.loadEngine();
const pgp = JSON.parse(fs.readFileSync(pgpFile, "utf8"));
const SKIP = new Set(["accent", "dead", "tap"]);          // not counted by pgp_techniques.py
let agree = 0; const ourOnly = [], theirsOnly = [], totOurs = {}, totTheirs = {};
for (const [file, counts] of Object.entries(pgp)) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(dir, file)));
  for (const { index } of eng.parseGP345(bytes, true, 0).parts) {
    const sc = eng.parseGP345(bytes, true, index), ours = {};
    for (const b of sc.bars) for (const e of b.events) if (e.tech) for (const tags of Object.values(e.tech)) for (const t of tags) ours[t] = (ours[t] || 0) + 1;
    for (const t of eng.TECHNIQUES) {
      if (SKIP.has(t)) continue;
      const a = ours[t] || 0, b = counts[`${index}:${t}`] || 0;
      totOurs[t] = (totOurs[t] || 0) + a; totTheirs[t] = (totTheirs[t] || 0) + b;
      if ((a > 0) === (b > 0)) agree++;
      else (a > 0 ? ourOnly : theirsOnly).push(`${file}#${index} ${t} ours=${a} pgp=${b}`);
    }
  }
}
console.log(`presence agreement (track × technique): ${agree}   ours-only: ${ourOnly.length}   pgp-only: ${theirsOnly.length}`);
if (ourOnly.length) console.log(ourOnly.slice(0, 12).join("\n"));
if (theirsOnly.length) console.log(theirsOnly.slice(0, 12).join("\n"));
console.log("totals ours / pgp (ours ≤ pgp expected: identical consecutive chords merge)");
for (const t of Object.keys(totTheirs)) console.log(" ", t.padEnd(9), totOurs[t], "/", totTheirs[t]);
