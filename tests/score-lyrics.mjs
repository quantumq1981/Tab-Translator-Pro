/* Guards for lyrics from a score: Guitar Pro (3–8, .gpx) and MusicXML lyric capture, the assignment rules, performance order,
 * the timed LyricMap (+ vocal-line refinement), the exports and the UI wiring. Accuracy is measured by
 * tests/bench/lyricsync.mjs, not asserted here. */
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { loadEngine } from "./bench/lib.mjs";
import { XMLSerializer } from "@xmldom/xmldom";
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

// ---- MusicXML <lyric> -----------------------------------------------------------------------------
{
  const n = (step, oct, lyr = "", extra = "") => `<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>${extra.includes("half") ? 2 : 1}</duration><voice>1</voice>${extra.replace("half", "")}${lyr}</note>`;
  const ly = (num, syl, txt, more = "") => `<lyric number="${num}"><syllabic>${syl}</syllabic><text>${txt}</text>${more}</lyric>`;
  const xml = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>Piano</part-name></score-part><score-part id="P2"><part-name>Voice</part-name></score-part></part-list>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><barline location="left"><repeat direction="forward"/></barline><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration></note></measure>
  <measure number="2"><note><pitch><step>G</step><octave>2</octave></pitch><duration>4</duration></note><barline location="right"><repeat direction="backward"/></barline></measure><measure number="2a"><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration></note></measure></part>
  <part id="P2"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><barline location="left"><repeat direction="forward"/></barline>
   ${n("C", 4, ly(1, "begin", "Hel") + ly(2, "begin", "Ver"))}${n("D", 4, ly(1, "end", "lo") + ly(2, "end", "se"))}${n("E", 4, ly(1, "single", "world,") + ly(2, "single", "two"))}${n("F", 4, ly(1, "single", "sing") + ly(2, "single", "now"))}</measure>
  <measure number="2">${n("G", 4, ly(1, "single", "on", "<extend/>") + ly(2, "single", "too"), 'half<tie type="start"/>')}${n("G", 4, "", 'half<tie type="stop"/>')}<barline location="right"><repeat direction="backward"/></barline></measure>
  <measure number="2a">${n("C", 4, '<lyric number="1"><syllabic>single</syllabic><text>a</text><elision/><syllabic>single</syllabic><text>men</text><end-line/></lyric>')}<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><lyric number="1"><text>dup</text></lyric></note>${n("D", 4, ly(1, "single", "Next"))}<note><rest/><duration>2</duration><voice>1</voice></note></measure></part></score-partwise>`;
  const sc = E.parseMusicXML(xml, true, 0), L = sc.lyrics;
  expect(L && L.trackName === "Voice" && L.mode === "notes" && sc.parts[sc.partIndex].name === "Piano", "MusicXML: the chosen Piano part carries the Voice part's lyrics");
  const v = (k) => L.syllables.filter((x) => x.verse === k).map((x) => x.text).join(" ");
  expect(v(0) === "Hel lo world, sing on a men Next" && v(1) === "Ver se two now too", "MusicXML: each lyric number is a verse; an elision joins two syllables; a chord's second lyric is not read twice");
  const S = (t) => L.syllables.find((x) => x.text === t);
  expect(S("Hel").wordEnd === false && S("lo").wordEnd === true && S("on").end - S("on").qa === 4, "MusicXML: syllabic begin/end, and a tied note holds the syllable on");
  expect(S("a men").bi === 2 && S("on").bi === 1 && sc.bars[1].number === sc.bars[2].number, "MusicXML: bars numbered 2 and 2a stay apart (bar index, not number)");
  const sung = E.scoreLyricSyllables(sc);
  expect(sung.map((x) => x.text).join(" ") === "Hel lo world, sing on Ver se two now too a men Next", "MusicXML: verse 1 on the first pass of a repeat, verse 2 on the second");
  expect(sung.find((x) => x.text === "Next").lineStart && !sung.find((x) => x.text === "a men").lineStart, "MusicXML: <end-line/> breaks the line");
  const map = E.lyricMapFromSyllables(sung, E.scoreQToSec(sc));
  expect(map.lines.length >= 2 && map.lines[map.lines.length - 1].text === "Next", "MusicXML: the lyric map reads the lines");
  expect(!("lyrics" in E.parseMusicXML(fs.readFileSync(path.join(repo, "tests/fixtures/sample.musicxml"), "utf8"), true, 0)), "MusicXML without lyrics gains no field");
  // an over-full bar (9 quarters in 4/4, as in a Bach chorale) must not swallow the next bar's syllables
  const of = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P1"><part-name>S</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${["C", "D", "E", "F", "G", "A"].map((st, i) => n(st, 4, ly(1, "single", "w" + i))).join("")}</measure><measure number="2">${n("B", 4, ly(1, "single", "Hei"))}</measure></part></score-partwise>`;
  const ol = E.parseMusicXML(of, true, 0).lyrics.syllables.map((x) => x.text).join(" ");
  expect(ol === "w0 w1 w2 w3 w4 w5 Hei", "MusicXML: an over-full bar does not overlap the next one");
  // fermatas mark phrase ends when the file has no end-line
  const fx = xml.replace(/<end-line\/>/g, "").replace(ly(1, "single", "world,"), ly(1, "single", "world,") + "<notations><fermata/></notations>").replace(ly(1, "single", "on", "<extend/>"), ly(1, "single", "on", "<extend/>") + "<notations><fermata/></notations>");
  const fl = E.scoreLyricSyllables(E.parseMusicXML(fx, true, 0));
  expect(fl.find((x) => x.text === "sing").lineStart && !fl.find((x) => x.text === "Next").lineStart, "MusicXML: without end-line, lines break after a fermata");
}

// ---- sung order: repeats + verses -------------------------------------------------------------------
{
  // a hymn: three verses under one line of music, no repeat sign → the song is sung three times
  const nt = (st, l1, l2, l3) => `<note><pitch><step>${st}</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice>${[l1, l2, l3].map((t, i) => `<lyric number="${i + 1}"><syllabic>single</syllabic><text>${t}</text></lyric>`).join("")}</note>`;
  const tri = (a, b, c) => [a, b, c].map((st, i) => `<note>${i ? "<chord/>" : ""}<pitch><step>${st}</step><octave>3</octave></pitch><duration>4</duration></note>`).join("");
  const hymn = `<?xml version="1.0"?><score-partwise><part-list><score-part id="P0"><part-name>Organ</part-name></score-part><score-part id="P1"><part-name>Voice</part-name></score-part></part-list>
  <part id="P0"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${tri("C", "E", "G")}</measure><measure number="2">${tri("G", "B", "D")}</measure></part>
  <part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${nt("C", "Ho-", "Joy", "Peace")}${nt("E", "ly", "to", "on")}</measure>
  <measure number="2">${nt("G", "Lord", "all", "earth")}${nt("D", "God", "men", "Amen")}</measure></part></score-partwise>`;
  const sc = E.parseMusicXML(hymn, true, 0);
  expect(E.lyricPassOrder(sc).join(" ") === "0 1 0 1 0 1", "a hymn with three verses and no repeat is sung three times");
  const sung = E.scoreLyricSyllables(sc);
  expect(sung.map((x) => x.text).join(" ") === "Ho- ly Lord God Joy to all men Peace on earth Amen" && sung[4].t === 8, "verse 2 starts after verse 1, on the second time through");
  expect(E.scoreLyricSyllables(sc, { strophic: false }).length === 4 && E.scoreLyricSyllables(sc, { unroll: false }).length === 4, "strophic: false / written order keep one pass");
  const re = E.scoreInPassOrder(sc, E.lyricPassOrder(sc));
  expect(re.bars.length === 6 && re.bars[2].number === 1 && sc.bars.length === 2, "scoreInPassOrder: bars in sung order, numbers kept, the score untouched");
  // the sheet's chords follow the sung order: the third time through still opens on C
  const map = { ...E.lyricMapFromSyllables(sung, E.scoreQToSec(sc)), passOrder: E.lyricPassOrder(sc) };
  const rows = E.lyricSheetRows(sc, map, {}), lines = rows.filter((r) => r.type === "line");
  expect(lines.map((r) => r.text).join(" / ") === "Ho- ly Lord God / Joy to all men / Peace on earth Amen", "each verse starts a line");
  expect(rows.filter((r) => r.type === "blank").length >= 2, "each further time through the song starts a stanza");
  const peace = lines.find((r) => /Peace/.test(r.text));
  expect(peace && peace.chordLine && /^C\b/.test(peace.chordLine), "lyric sheet: chords placed on the sung order (verse 3 opens on C)");
  const noOrder = E.lyricSheetRows(sc, { ...map, passOrder: undefined }, {}).filter((r) => r.type === "line").find((r) => /Peace/.test(r.text));
  expect(!noOrder || !noOrder.chordLine || !/^C\b/.test(noOrder.chordLine), "lyric sheet: without the pass order the chords run out after one pass");
  // repeat + verses (a chorale): verse 2 on the repeat, no extra pass
  const bars = [1, 2].map((n) => ({ number: n, timeSig: [4, 4], events: [], ...(n === 1 ? { repeatStart: true, repeatEnd: true } : {}) }));
  const ch = { bars, timeSig: [4, 4], lyrics: { syllables: [{ text: "a", bar: 1, bi: 0, q: 0, qa: 0, end: 1, verse: 0 }, { text: "b", bar: 1, bi: 0, q: 0, qa: 0, end: 1, verse: 1 }, { text: "c", bar: 2, bi: 1, q: 0, qa: 4, end: 5, verse: 0 }] } };
  expect(E.lyricPassOrder(ch).join(" ") === "0 0 1", "a repeat that already sings each verse adds no pass");
}

// ---- Guitar Pro 6/7/8 (gpif) -----------------------------------------------------------------------
{
  const bc = await gp("Steely Dan - Black Cow.gp"), L = bc.lyrics;
  expect(L && L.mode === "beats" && L.trackName === "Saxophone  Alto" && L.syllables.length === 266, "GP7: the syllables Guitar Pro placed under notes are read (266, on the lead line's track)");
  expect(L.syllables[0].text === "In" && L.syllables[0].bar === 8 && L.syllables[0].q === 3, "GP7: the first syllable sits where Guitar Pro put it (bar 8, beat 4)");
  const map = E.lyricMapFromSyllables(E.scoreLyricSyllables(bc), E.scoreQToSec(bc));
  expect(map.lines.slice(0, 3).map((l) => l.text).join(" / ") === "In the cor ner / Of my eye / I saw you in Ru dy's", "GP7: line breaks come from the track text (on the Singers track)");
  const other = await gp("Steely Dan - Black Cow.gp", 1);
  expect(other.lyrics && other.lyrics.syllables.length === 266, "GP7: the lyrics ride on every part's score");
  // text only (no syllables under notes): read like GP4/5, from the 0-based Offset bar; grace notes get none
  const xml = await E.gpUnzip(new Uint8Array(fs.readFileSync(path.join(repo, "Steely Dan - Black Cow.gp"))));
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  for (const b of E._xEls(doc, "Beat")) for (const el of E._xEls(b, "Lyrics")) el.parentNode.removeChild(el);
  const tr = E._xEls(doc, "Track").filter((t) => t.getAttribute("id") != null);
  const text = E._xEls(E._xEls(tr[6], "Lyrics")[0], "Text")[0].textContent;
  E._xEls(E._xEls(tr[6], "Lyrics")[0], "Text")[0].textContent = "";
  const line = E._xEls(E._xEls(tr[8], "Lyrics")[0], "Line")[0];
  E._xEls(line, "Text")[0].textContent = text; E._xEls(line, "Offset")[0].textContent = "7";
  const T = E.parseGPIF(new XMLSerializer().serializeToString(doc), true, 0).lyrics;
  expect(T && T.mode === "direct" && T.syllables.length === 266 && T.syllables[0].bar === 8, "gpif text only: read note by note from bar Offset + 1");
  const graceQa = new Set(L.beats.filter((b) => b.grace).map((b) => b.qa.toFixed(4)));
  expect(graceQa.size > 0 && !T.syllables.some((x) => graceQa.has(x.qa.toFixed(4))), "gpif text only: no syllable on a grace note");
  // GP6 (.gpx, BCFZ): same XML — a voice track with text and no placed syllables
  const gx = new Uint8Array(fs.readFileSync(path.join(repo, "band-the_weight.gpx"))), br = E._gpxBitReader(gx); br.readBytes(4);
  const fsys = E._gpxReadFS(E._gpxDecompress(br, true)), gxml = new TextDecoder().decode(fsys.find((f) => /score\.gpif$/i.test(f.name)).data);
  expect(!("lyrics" in E.parseGPIF(gxml, true, 0)), "GP6 without lyrics gains no field");
  const d6 = new DOMParser().parseFromString(gxml, "text/xml");
  const sop = E._xEls(d6, "Track").filter((t) => t.getAttribute("id") != null).find((t) => /Alto Voice/.test(E._xChildText(t, "Name")));   // (its Soprano track has no notes)
  const l6 = E._xEls(E._xEls(sop, "Lyrics")[0], "Line")[0];
  E._xEls(l6, "Text")[0].textContent = "Pulled in-to Na-za-reth,\nwas feel-in' 'bout half past dead"; E._xEls(l6, "Offset")[0].textContent = "0";
  const g6 = E.parseGPIF(new XMLSerializer().serializeToString(d6), true, 0), L6 = g6.lyrics;
  expect(L6 && /Alto Voice/.test(L6.trackName) && L6.syllables[0].bar === 5 && L6.mode === "direct" && L6.syllables[0].text === "Pulled" && L6.syllables[1].text === "in" && L6.syllables[1].wordEnd === false, "GP6: a voice track's text is read onto its notes (in-to = two syllables of one word)");
  expect(L6.syllables.find((x) => x.text === "was").lineStart, "GP6: the text's newline starts a lyric line");
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
  expect(/lyricPassOrder\(xmlScore\)/.test(ui) && !/scoreLyricSyllables\(xmlScore, \{ unroll: false \}\)/.test(ui) && /passOrder: order/.test(ui), "an opened score's lyrics are read in sung order and carry the pass order to the sheet");
}

console.log(`score-lyrics: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
