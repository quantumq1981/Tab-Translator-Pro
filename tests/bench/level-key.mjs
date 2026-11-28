/* Level key vs shown key — every GP / Power Tab file in the repo, opened as the app opens it
 * (Harmony when ≥ 2 parts merge), with the chart's default settings (auto-Simplify on a melodic or
 * merged chart, Pro names). Compares:
 *   shown   = the key the chart shows before a level is chosen (chartKeyCandidates: the notes for a melodic
 *             chart, chord function on the named chart otherwise);
 *   old     = the key the Beginner level used to read (analyzeKey on the raw score);
 *   level   = the key the Beginner chart is in, and its capo.
 * After the fix the level starts from `shown`, and with a level on the chart shows `shown + transposedBy` (the last
 * column counts files where RE-analysing the level's simpler chords would have disagreed — the reason it isn't).
 * Usage: node bench/level-key.mjs [--list]  */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
globalThis.DOMParser = (await import("@xmldom/xmldom")).DOMParser;
const ep = path.join(here, ".engine.levelkey.mjs");
fs.writeFileSync(ep, fs.readFileSync(path.join(repo, "engine.tsx"), "utf8"));
const E = await import(ep + "?t=" + Date.now());
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { if (f === "node_modules" || f.startsWith(".")) continue; const p = path.join(d, f); const st = fs.statSync(p); if (st.isDirectory()) walk(p); else if (/\.(gp[345x]?|ptb)$/i.test(f)) files.push(p); } })(repo);
files.sort();
const name = (k) => k ? E.keyName(k, true) : "—";
const list = process.argv.includes("--list");
let n = 0, before = 0, after = 0, capoDiff = 0;
for (const f of files) {
  const bytes = new Uint8Array(fs.readFileSync(f));
  let sc;
  try {
    sc = await E.parseGuitarProOrXML(bytes, path.basename(f), true);
    if (sc && sc.parts && sc.parts.length >= 2) {
      try { const h = await E.parseGuitarProOrXML(bytes, path.basename(f), true, E.HARMONY_PART); if (h && h.merged && (h.mergedParts || []).length >= 2 && h.bars && h.bars.length) sc = h; } catch (_) {}
    }
  } catch (e) { continue; }
  if (!sc || !sc.bars || !sc.bars.length || E.isPercussionTuning && sc.tuningMidi && E.isPercussionTuning(sc.tuningMidi)) continue;
  const shownOf = (src, s) => { const c = E.chartKeyCandidates(src, E.respellScore(s, "chart", { useSharp: true }), { limit: 1 })[0]; return c ? { tonic: c.tonic, mode: c.mode } : null; };
  const simp = (E.isMelodicScore(sc) || sc.merged) ? E.simplifyScore(sc, true) : sc;
  const shown = shownOf(sc, simp);
  if (!shown) continue;
  n++;
  const old = E.analyzeKey(sc);
  const oldLvl = E.arrangementLevels(sc, "beginner", { useSharp: true });
  const newLvl = E.arrangementLevels(sc, "beginner", { useSharp: true, key: shown });
  const same = (a, b) => a && b && a.tonic === b.tonic && a.mode === b.mode;
  const mis = !same(old, shown);
  if (mis) before++;
  // after: the level's key is the shown key moved by the level's own transposition
  const lvlKey = { tonic: ((shown.tonic + newLvl.transposedBy) % 12 + 12) % 12, mode: shown.mode };
  const shownOnLevel = shownOf(newLvl.score, newLvl.score);
  if (!same(lvlKey, shownOnLevel)) after++;
  if (oldLvl.capo !== newLvl.capo) capoDiff++;
  if (list && (mis || !same(lvlKey, shownOnLevel))) console.log(`${path.basename(f)} [${sc.merged ? "Harmony" : "part " + (sc.partIndex || 0)}]  shown ${name(shown)} · old level ${name(old)} capo ${oldLvl.capo} → new capo ${newLvl.capo} (level chart ${name(lvlKey)}; re-analysed ${name(shownOnLevel)})`);
}
console.log(`files ${n} · shown ≠ old level key ${before} · capo hint changed ${capoDiff} · level chart re-analysed ≠ shown+transposition ${after}`);
fs.rmSync(ep, { force: true });
