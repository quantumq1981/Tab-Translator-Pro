/* MusicXML lyrics on 338 Bach chorales (music21's encodings — see fixtures/bach-chorales/NOTICE.md),
 * checked against music21's own reading of the same files (truth.json, written by
 * scripts/m21_lyrics_dump.py). Every syllable: same bar, same position, same verse, same text, same word
 * join. Plus the sung order: a chorale whose repeat carries verse 2 sings every written syllable once.
 * Test-only fixtures; nothing here ships. */
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { loadEngine } from "./bench/lib.mjs";
const here = path.dirname(fileURLToPath(import.meta.url)), dir = path.join(here, "fixtures/bach-chorales");
const E = await loadEngine();
const TRUTH = JSON.parse(fs.readFileSync(path.join(dir, "truth.json"), "utf8"));
let pass = 0, fail = 0;
const expect = (ok, msg) => { if (ok) pass++; else { fail++; console.log("  ✗ " + msg); } };
let files = 0, tot = 0, pos = 0, txt = 0, join = 0, extra = 0, partOk = 0, multi = 0, sungOnce = 0, sungFiles = 0, ms = 0;
const misses = [];
for (const [name, t] of Object.entries(TRUTH)) {
  const t0 = Date.now();
  const sc = await E.parseGuitarProOrXML(new Uint8Array(fs.readFileSync(path.join(dir, name))), name, true, 0);
  ms += Date.now() - t0; files++;
  const L = sc.lyrics;
  if (!L) { misses.push(`${name}: no lyrics read`); tot += t.syl.length; continue; }
  if (L.track === t.part) partOk++;
  const nums = [...new Set(t.syl.map((s) => s[2]))].sort((a, b) => (parseInt(a) || 1e9) - (parseInt(b) || 1e9));
  if (nums.length > 1) multi++;
  const key = (bi, q, v) => `${bi}|${(+q).toFixed(3)}|${v}`;
  const mine = new Map(L.syllables.map((s) => [key(s.bi, s.q, s.verse), s]));
  for (const [bi, q, num, text, syl] of t.syl) {
    tot++;
    const k = key(bi, q, nums.indexOf(num)), s = mine.get(k);
    if (!s) { if (misses.length < 10) misses.push(`${name} bar index ${bi} +${q} verse ${num} "${text}" not read`); continue; }
    mine.delete(k); pos++;
    if (s.text === text.trim()) txt++; else if (misses.length < 10) misses.push(`${name} "${s.text}" vs "${text}"`);
    if (s.wordEnd === (syl === "s" || syl === "e")) join++;
  }
  extra += mine.size;
  // sung order: when every bar carrying verse k is sung at least k times, each written syllable is sung once
  const passes = new Map(); for (const bi of E.lyricPassOrder(sc)) passes.set(bi, (passes.get(bi) || 0) + 1);
  const versesIn = new Map(); for (const s of L.syllables) { if (!versesIn.has(s.bi)) versesIn.set(s.bi, new Set()); versesIn.get(s.bi).add(s.verse); }
  if (nums.length > 1 && [...versesIn.entries()].every(([bi, v]) => (passes.get(bi) || 0) >= v.size)) {
    sungFiles++; if (E.scoreLyricSyllables(sc).length === L.syllables.length) sungOnce++;
  }
}
const pct = (a, b) => (100 * a) / Math.max(1, b);
console.log(`bach chorales: ${files} files (${multi} with several verses), ${tot} syllables — position ${pct(pos, tot).toFixed(2)} %, text ${pct(txt, tot).toFixed(2)} %, word joins ${pct(join, tot).toFixed(2)} %, extra ${extra}, ${(ms / files).toFixed(0)} ms/file`);
expect(files === Object.keys(TRUTH).length && files >= 300, "every chorale parses");
expect(partOk === files, `the lyric part is the one music21 reads (${partOk}/${files})`);
expect(pct(pos, tot) >= 99.9, `syllables on the same note and verse as music21: ${pct(pos, tot).toFixed(2)} %`);
expect(pct(txt, tot) >= 99.9, `same text: ${pct(txt, tot).toFixed(2)} %`);
expect(pct(join, tot) >= 99.8, `same word joins: ${pct(join, tot).toFixed(2)} %`);
expect(extra <= 2, `no invented syllables (${extra})`);
expect(sungFiles >= 100 && sungOnce === sungFiles, `repeat carries verse 2: every written syllable sung once (${sungOnce}/${sungFiles})`);
// a Te Deum (bwv328): extra verses only in a few repeated sections — sung once through, never the whole piece again
{
  const sc = await E.parseGuitarProOrXML(new Uint8Array(fs.readFileSync(path.join(dir, "bwv328.mxl"))), "bwv328.mxl", true, 0);
  const base = sc.bars.length, order = E.lyricPassOrder(sc);
  expect(order.length < 2 * base && E.scoreLyricSyllables(sc).length < sc.lyrics.syllables.length + 50, `bwv328: local multi-verse sections don't repeat the whole piece (${order.length} bars sung for ${base} written)`);
}
if (misses.length) console.log(misses.join("\n"));
console.log(`bach-lyrics: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
