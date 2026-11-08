/* MusicXML lyrics read by the engine vs music21's reading of the same files (dev-only).
 *   python -I scripts/m21_lyrics_dump.py <music21/corpus> <truth.json>   (every file with <lyric>, per part, per note:
 *                                          [measure index, offset in quarters, lyric number, text, syllabic])
 *   node bench/lyricsxml.mjs --corpus <music21/corpus> --truth <truth.json> [--limit N]
 * For each file the part the engine chooses (part 0 if it has lyrics, else the first that does) is compared
 * syllable by syllable: same bar, same position, same verse rank, same text, and the word join
 * (syllabic begin/middle = inside a word). */
import fs from "node:fs"; import path from "node:path";
import { loadEngine } from "./lib.mjs";
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const E = await loadEngine();
const CORPUS = arg("corpus"), TRUTH = JSON.parse(fs.readFileSync(arg("truth"), "utf8")), LIMIT = +arg("limit", 1e9);
let files = 0, failed = 0, tot = 0, pos = 0, txt = 0, join = 0, extra = 0, verseFiles = 0, ms = 0; const bad = [];
for (const rec of TRUTH.slice(0, LIMIT)) {
  const f = path.join(CORPUS, rec.file);
  let sc; const t0 = Date.now();
  try { sc = await E.parseGuitarProOrXML(new Uint8Array(fs.readFileSync(f)), path.basename(f), true, 0); } catch (e) { failed++; bad.push(rec.file + ": " + e.message); continue; }
  ms += Date.now() - t0;
  const L = sc.lyrics; files++;
  const pi = L ? L.track : rec.parts.findIndex((p) => p.length);
  const truth = rec.parts[pi] || [];
  const nums = [...new Set(truth.map((t) => t[2]))].sort((a, b) => (parseInt(a) || 1e9) - (parseInt(b) || 1e9));
  if (nums.length > 1) verseFiles++;
  const key = (bar, q, v) => `${bar}|${(+q).toFixed(3)}|${v}`;
  const mine = new Map(((L && L.syllables) || []).map((s) => [key(s.bi, s.q, s.verse), s]));
  for (const t of truth) {
    tot++;
    const s = mine.get(key(t[0], t[1], nums.indexOf(t[2])));
    if (!s) { if (bad.length < +arg("show", 12)) bad.push(`${rec.file} m${t[0]} +${t[1]} v${t[2]} "${t[3]}" missing`); continue; }
    pos++; mine.delete(key(t[0], t[1], nums.indexOf(t[2])));
    if (s.text === t[3]) txt++; else if (bad.length < 12) bad.push(`${rec.file} m${t[0]} "${s.text}" vs "${t[3]}"`);
    if (s.wordEnd === (t[4] === "single" || t[4] === "end")) join++;
  }
  extra += mine.size;
}
const pct = (a, b) => (b ? ((100 * a) / b).toFixed(2) + " %" : "—");
console.log(`files ${files} (with several verses ${verseFiles}), failed ${failed} · syllables ${tot}: position ${pct(pos, tot)} · text ${pct(txt, tot)} · word joins ${pct(join, tot)} · extra ${extra} · parse ${(ms / Math.max(1, files)).toFixed(0)} ms/file`);
if (bad.length) console.log(bad.join("\n"));
