/* Guards for lyrics from a score: Guitar Pro lyric capture, the assignment rules, performance order,
 * the timed LyricMap (+ vocal-line refinement), the exports and the UI wiring. Accuracy is measured by
 * tests/bench/lyricsync.mjs, not asserted here. */
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { loadEngine } from "./bench/lib.mjs";
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, "..");
const E = await loadEngine();
let pass = 0, fail = 0;
const expect = (ok, msg) => { if (ok) pass++; else { fail++; console.log("  ✗ " + msg); } };
const gp = async (f, part) => E.parseGuitarProOrXML(new Uint8Array(fs.readFileSync(path.join(repo, f))), f, true, part);

// ---- chunking --------------------------------------------------------------------------------------
{
  const c = E._lyricChunks("On a dark de-sert high way, _ cool\nwind\n\nin a - way [x2] two+words");
  const t = c.filter((x) => !x.melisma).map((x) => x.text);
  expect(t.join("|") === "On|a|dark|de|sert|high|way,|cool|wind|in|a|way|two words", "chunks: words, hyphen syllables, comments dropped, + joins");
  expect(c.find((x) => x.text === "de").wordEnd === false && c.find((x) => x.text === "sert").wordEnd === true, "a trailing hyphen marks a syllable inside a word");
  expect(c.filter((x) => x.melisma).length === 2, "\"_\" and a lone \"-\" each hold a note");
  const a = c.filter((x) => x.text === "a"); expect(a[1].wordEnd === false, "a lone \"-\" also joins the word (\"a - way\")");
  expect(c.find((x) => x.text === "wind").lineStart && c.find((x) => x.text === "in").stanza, "a newline starts a line, a blank line a stanza");
  expect(E._hyphenate("curious").join("") === "curious" && E._hyphenate("curious").length >= 2 && E._hyphenate("love").length === 1, "hyphenation splits a word into its syllables and keeps its letters");
}

// ---- assignment ------------------------------------------------------------------------------------
{
  const beats = [0, 1, 2, 3, 4, 5].map((q) => ({ bar: 1, q, qa: q, d: 1, midi: 60 + q, tied: q === 2 }));
  const r = E.assignLyricText(beats, "Hel-lo _ world");
  expect(r.mode === "direct" && r.syllables.map((s) => s.text + "@" + s.qa).join(" ") === "Hel@0 lo@1 world@4", "direct: one syllable per untied note, a tied note skipped, \"_\" holds a note");
  expect(r.syllables[1].end === 4, "the tied note and the held note extend the syllable before them");
  // whole words, two text lines, two sung phrases separated by a rest
  const B = [0, 1, 2, 3, 6, 7, 8, 9].map((q) => ({ bar: 1 + Math.floor(q / 4), q: q % 4, qa: q, d: 1, midi: 60, tied: false }));
  const p = E.assignLyricText(B, "Make a weep\nmake another", { mode: "phrases" });
  const at = (w) => (p.syllables.find((s) => s.text.toLowerCase().startsWith(w)) || {}).qa;
  expect(at("make") === 0 && p.syllables.filter((s) => /make/i.test(s.text))[1].qa === 6, "phrases: each line starts on its sung phrase's first note");
  expect(p.syllables.length >= 5 && p.syllables.every((s, i, a) => i === 0 || s.qa > a[i - 1].qa), "phrases: syllables on notes in order, an extra note held as a melisma");
}

// ---- real files ------------------------------------------------------------------------------------
{
  const hc = await gp("The Eagles - Hotel California.gp5");
  expect(hc.lyrics && hc.lyrics.trackName === "Vocals (Henley)" && hc.lyrics.mode === "direct" && hc.lyrics.syllables.length === 438, "Hotel California: 438 syllables on \"Vocals (Henley)\" by Guitar Pro's own rule");
  const other = await gp("The Eagles - Hotel California.gp5", 7);
  expect(other.lyrics && other.lyrics.syllables.length === 438, "the lyrics ride on every part's score");
  const pl = await gp("huey-lewis-and-the-news-power_of_love.gp4");
  expect(pl.lyrics && pl.lyrics.trackName === "Voice" && pl.lyrics.mode === "phrases" && pl.lyrics.syllables.length > 250, "Power of Love: whole-word text read by phrases on \"Voice\"");
  const sc = await gp("Tool - Schism.gp5");
  const syl = E.scoreLyricSyllables(sc), m = E.lyricMapFromSyllables(syl, E.scoreQToSec(sc));
  expect(m.lines.some((l) => /fall away/.test(l.text)), "Schism: \"a - way\" reads as one word");
  const peg = await gp("Steely Dan - Peg.gp4"), bs = await gp("Blue Sky ver.02.gp");
  expect(!("lyrics" in peg) && !("lyrics" in bs), "files without lyrics gain no lyrics field (outputs unchanged)");
}

// ---- performance order, timing, refinement ---------------------------------------------------------
{
  const bars = [1, 2].map((n) => ({ number: n, timeSig: [4, 4], events: [], ...(n === 1 ? { repeatStart: true, repeatEnd: true } : {}) }));
  const score = { bars, timeSig: [4, 4], tempo: 120, lyrics: { syllables: [
    { text: "one", bar: 1, q: 0, qa: 0, end: 1, midi: 60, wordEnd: true, lineStart: true, verse: 0 },
    { text: "two", bar: 1, q: 0, qa: 0, end: 1, midi: 62, wordEnd: true, lineStart: true, verse: 1 },
    { text: "three", bar: 2, q: 0, qa: 4, end: 5, midi: 64, wordEnd: true, verse: 0 } ] } };
  const ps = E.scoreLyricSyllables(score);
  expect(ps.map((s) => s.text + "@" + s.t).join(" ") === "one@0 two@4 three@8", "repeats: bar 1 sung twice takes verse 1 then verse 2; bar 2 follows");
  expect(E.scoreLyricSyllables(score, { unroll: false }).map((s) => s.text).join(" ") === "one three", "written order: the first verse");
  const syls = [0, 1, 2, 4, 5].map((t, i) => ({ text: ["Hel", "lo", "world", "next", "line"][i], t, d: 1, midi: 60, wordEnd: i !== 0, lineStart: i === 0 || i === 3 }));
  const map = E.lyricMapFromSyllables(syls, (q) => q * 0.5);
  expect(map.lines.length === 2 && map.lines[0].text === "Hello world" && map.lines[0].words[1].col === 3 && map.lines[1].startSec === 2, "the map: line breaks, joined syllables, syllable columns and times");
  const vocal = syls.map((s) => ({ midi: 60, startSec: s.t * 0.5 + 0.08, durSec: 0.3 }));
  const rm = E.lyricMapFromSyllables(syls, (q) => q * 0.5, { vocalNotes: vocal });
  expect(rm.refined === 5 && Math.abs(rm.lines[0].words[0].startSec - 0.08) < 1e-6, "refinement: each syllable moves to the sung onset");
  const far = syls.map((s) => ({ midi: 61, startSec: s.t * 0.5 + 0.05, durSec: 0.3 }));
  expect(E.lyricMapFromSyllables(syls, (q) => q * 0.5, { vocalNotes: far }).refined === 0, "refinement needs the syllable's pitch class");
  const link = { ok: true, beatTimes: [0, 0.6, 1.2, 1.8, 2.4, 3.0, 3.6, 4.2, 4.8], coverage: { audioFrom: 0, audioTo: 4.8 } };
  const lm = E.linkedLyricMap(link, [{ score: { ...score, lyrics: { ...score.lyrics, trackName: "V", mode: "direct" } } }]);
  expect(lm && lm.lines[0].words[0].startSec === 0 && lm.lines.flatMap((l) => l.words).find((w) => w.text === "two").startSec === 2.4, "linked: syllable times follow the link's beat times");
  expect(E.lyricLines(E.parseLyrics(E.lyricMapToText(map))).length === map.lines.length, "the map's text reads back to the same lines");
}

// ---- exports: chords on the syllable, word-timed LRC ----------------------------------------------
{
  const syls = [0, 1, 2, 3].map((t, i) => ({ text: ["Make", "a", "one", "man"][i], t, d: 1, midi: 60, wordEnd: true, lineStart: i === 0 }));
  const map = E.lyricMapFromSyllables(syls, (q) => q * 0.5);
  const chart = { timeSig: [4, 4], tempo: 120, bars: [{ number: 1, timeSig: [4, 4], events: [{ symbol: "C", midis: [60, 64, 67], beat: 0, qbeat: 0, durBeats: 2, qdur: 2 }, { symbol: "G", midis: [55, 59, 62], beat: 2, qbeat: 2, durBeats: 2, qdur: 2 }] }] };
  const sheet = E.scoreToLyricsSheet(chart, map, {}).split("\n");
  const i = sheet.indexOf("Make a one man");
  expect(i > 0 && sheet[i - 1].indexOf("G") === "Make a ".length, "chords-over-lyrics: the G sits over \"one\", the syllable sung at the change");
  const lrc = E.lyricsToLRC(map, { words: true });
  expect(/\[00:00\.00\]<00:00\.00>Make <00:00\.50>a <00:01\.00>one <00:01\.50>man/.test(lrc), "word-timed LRC: a stamp before every syllable");
  expect(!/</.test(E.lyricsToLRC(map)), "plain LRC unchanged");
}

// ---- UI contracts ----------------------------------------------------------------------------------
{
  const ui = fs.readFileSync(path.join(repo, "TabDecoderPro.tsx"), "utf8");
  expect(/linkedLyricMap,/.test(ui) && /lyricMapFromSyllables,/.test(ui) && /lyricMapToText,/.test(ui), "the UI imports the lyric map functions");
  expect(/scoreLyrics=\{lyricMap\}/.test(ui) && /lyricMap=\{linkLyrics\}/.test(ui) && /lyricMap=\{xmlLyrics\}/.test(ui), "linked audio charts and opened score files hand their lyrics to the lyric sheet");
  expect(/const strip = \(sc\) => \(\{[^\n]*lyrics: sc\.lyrics/.test(ui), "a linked score's parts keep their lyrics");
  expect(/onVocals=\{setStemVocals\}/.test(ui) && /vocalNotes/.test(ui), "the stems panel's vocal line refines linked lyrics");
  expect(/LRC \(word-timed\)/.test(ui) && /words: true/.test(ui), "the lyric sheet offers a word-timed LRC");
  expect(/textDecoration: "underline"/.test(ui), "the syllable being sung is lit during playback");
}

console.log(`score-lyrics: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
