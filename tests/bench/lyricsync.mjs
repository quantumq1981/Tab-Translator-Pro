/* lyricsync.mjs — syllable-level lyric timing from a linked score, measured.
 *
 * 1) --assign-eval: the PHRASE reader (for files that store whole words, not syllables) scored against
 *    Guitar Pro's own syllable placement on files that DO store syllables. The lyric text is reduced to
 *    plain words (syllable breaks, "_" holds and hyphens removed, the file's line breaks kept), read with
 *    assignLyricText(mode "phrases"), and each word's first syllable is compared with the note Guitar Pro
 *    puts it on: % of words on the exact note, % within one note.
 *       node bench/lyricsync.mjs --assign-eval
 * 2) A real record + its score: link, time every syllable, and check the times against the sung onsets of
 *    the record's vocal stem (bench/split-file.mjs) — there is no word-timestamp ground truth for these
 *    records, so the vocal stem is the evidence: for each syllable the distance to the nearest sung onset
 *    of the same pitch class, and whether a note is sounding in the syllable's first 0.15 s; before and
 *    after the vocal-line refinement.
 *       node bench/lyricsync.mjs --score <file.gp5> --audio <mix.mp3> [--stems <split dir>] [--lines 6]
 * Dev-only. */
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process";
import * as L from "./lib.mjs";
const E = await L.loadEngine();
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes("--" + k);
const T = 16000;

if (has("assign-eval")) {
  let words = 0, exact = 0, near1 = 0; const TOT = { dq: [], b1: 0 };
  for (const f of ["The Eagles - Hotel California.gp5", "Nirvana - Heart Shaped Box.gp5", "Tool - Schism.gp5"]) {
    const sc = await E.parseGuitarProOrXML(new Uint8Array(fs.readFileSync(path.join(L.repo, f))), f, true);
    // rebuild the lyric track's beats and its text the way _gpLyrics does
    const truth = sc.lyrics.syllables.filter((s) => s.verse === 0);
    const firsts = []; let inWord = false;
    for (const s of truth) { if (!inWord) firsts.push(s); inWord = !s.wordEnd; }
    // plain words with the original line structure (line starts from the truth)
    // --breaks rest: a line break before a word that follows a rest of ≥ 1 beat (how lyric text is usually laid out)
    const BRK = arg("breaks", "file"), NTq = sc.lyrics.beats.filter((b) => !b.tied);
    const restBefore = (qa) => { let prevEnd = -Infinity; for (const b of NTq) { if (b.qa >= qa - 1e-6) break; prevEnd = Math.max(prevEnd, b.qa + b.d); } return qa - prevEnd; };
    const wordsTxt = []; let w = "", startLine = false;
    for (const s of truth) { if (!w && wordsTxt.length && (BRK === "rest" ? restBefore(s.qa) >= 1 : s.lineStart)) startLine = true; w += s.text; if (s.wordEnd) { wordsTxt.push((startLine ? "\n" : "") + w.replace(/[_]/g, "")); w = ""; startLine = false; } }
    const text = wordsTxt.join(" ").replace(/ \n/g, "\n");
    const B = sc.lyrics.beats, NT = B.filter((b) => !b.tied);
    const r = E.assignLyricText(B, text, { mode: "phrases", params: JSON.parse(arg("params", "{}")) });
    // words with their first syllable's note, both readings; matched by text (LCS) so a merged or skipped word
    // doesn't shift every later comparison
    const wordsOf = (syls) => { const out = []; let cur = null; for (const s of syls) { if (!cur) cur = { text: "", qa: s.qa }; cur.text += s.text; if (s.wordEnd) { out.push({ ...cur, key: cur.text.toLowerCase().replace(/[^a-z']/g, "") }); cur = null; } } return out; };
    const tw = wordsOf(truth), ew = wordsOf(r.syllables);
    const idxOf = (qa) => { let lo = 0, hi = NT.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (NT[m].qa < qa - 1e-6) lo = m + 1; else hi = m; } return lo; };
    const A = tw.length, Bn = ew.length, dp = Array.from({ length: A + 1 }, () => new Int32Array(Bn + 1));
    for (let i = A - 1; i >= 0; i--) for (let j = Bn - 1; j >= 0; j--) dp[i][j] = tw[i].key === ew[j].key ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0, ex = 0, n1 = 0, nm = 0, b1 = 0; const dq = [];
    while (i < A && j < Bn) { if (tw[i].key === ew[j].key) { nm++; const a = idxOf(tw[i].qa), c = idxOf(ew[j].qa); if (a === c) ex++; if (Math.abs(a - c) <= 1) n1++; const d = Math.abs(tw[i].qa - ew[j].qa); dq.push(d); if (d <= 1 + 1e-6) b1++; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++; }
    dq.sort((x, y) => x - y); TOT.dq.push(...dq); TOT.b1 += b1;
    const nW = A;
    console.log(`${f.padEnd(34)} words ${A} (read ${Bn}, matched ${nm}) · exact note ${(100 * ex / nW).toFixed(1)}% · within one note ${(100 * n1 / nW).toFixed(1)}% · within a beat ${(100 * b1 / nW).toFixed(1)}% · median error ${dq[dq.length >> 1].toFixed(2)} beats`);
    words += nW; exact += ex; near1 += n1;
  }
  TOT.dq.sort((x, y) => x - y);
  console.log(`ALL: exact ${(100 * exact / words).toFixed(1)}% · within one note ${(100 * near1 / words).toFixed(1)}% · within a beat ${(100 * TOT.b1 / words).toFixed(1)}% · median error ${TOT.dq[TOT.dq.length >> 1].toFixed(2)} beats  (${words} words)`);
  process.exit(0);
}

/* 3) --synthetic: known truth. Every pitched part of each lyric file is rendered with a tempo drift the score
 *    doesn't know (±6 % sine over 12 bars, one bar 20 % slower — bench/scorelink.mjs's warp), the vocal line
 *    as a sustained voice, from 8 s before the first sung syllable for --sec seconds. The mix is linked to
 *    the file; each syllable's linked time is compared with its true rendered time. "refined" adds the
 *    vocal-line refinement from the rendered vocal alone (a perfect vocal stem).
 *       node bench/lyricsync.mjs --synthetic [--sec 0]      (0 = whole songs, as a real record is) */
if (has("synthetic")) {
  const SEC = +arg("sec", 0), SR = 44100;
  const warped = (score) => { const base = score.tempo || 100; return { ...score, tempoMap: score.bars.map((b, i) => ({ bar: b.number, beat: 0, bpm: +(base * (1 + 0.06 * Math.sin((2 * Math.PI * i) / 12)) * (i % 17 === 9 ? 0.8 : 1)).toFixed(3) })) }; };
  const all = { link: [], refined: [] };
  for (const f of ["The Eagles - Hotel California.gp5", "huey-lewis-and-the-news-power_of_love.gp4", "Nirvana - Heart Shaped Box.gp5", "Tool - Schism.gp5"]) {
    const bytes = new Uint8Array(fs.readFileSync(path.join(L.repo, f)));
    const first = await E.parseGuitarProOrXML(bytes, f, true);
    const ps = []; for (const p of first.parts) ps.push({ score: p.index === first.partIndex ? first : await E.parseGuitarProOrXML(bytes, f, true, p.index), name: p.name, drum: !!p.drum, index: p.index });
    const lyrTrack = first.lyrics.track;
    const ws0 = warped(ps[0].score), bt = E.scoreBarTempos(ws0, ws0.tempo), barSec = []; { let t = 0; ws0.bars.forEach((b, i) => { barSec.push(t); const [n, d] = b.timeSig || ws0.timeSig; t += ((n * 4) / d) * (60 / bt[i]); }); }
    const barQ = []; { let a = 0; ws0.bars.forEach((b) => { barQ.push(a); const [n, d] = b.timeSig || ws0.timeSig; a += (n * 4) / d; }); }
    const trueSec = (q) => { let i = barQ.length - 1; while (i > 0 && barQ[i] > q + 1e-9) i--; return barSec[i] + (q - barQ[i]) * (60 / bt[i]); };
    const syl = E.scoreLyricSyllables(first, { unroll: false });
    const songEnd = barSec[barSec.length - 1] + 4;
    const from = SEC > 0 ? Math.max(0, trueSec(syl[0].t) - 8) : 0, LEN = SEC > 0 ? SEC : songEnd;   // --sec 0 = the whole song
    let mix = null, voc = null;
    for (const p of ps) {
      if (p.drum || E.scorePartRole(p) === "drums") continue;
      const role = E.scorePartRole(p), inst = p.index === lyrTrack ? "organ" : role === "bass" ? "bass" : role === "piano" ? "piano" : "guitar";
      const r = L.renderPart(E, warped(p.score), { sr: SR, instrument: inst, seed: 3 + p.index, fromSec: from, maxSec: LEN });
      if (!r) continue;
      const a = r.audio, gain = p.index === lyrTrack ? 1.4 : 0.6;
      if (!mix) mix = new Float32Array(Math.ceil(LEN * SR));
      for (let i = 0; i < Math.min(a.length, mix.length); i++) mix[i] += gain * a[i];
      if (p.index === lyrTrack) { voc = new Float32Array(mix.length); for (let i = 0; i < Math.min(a.length, voc.length); i++) voc[i] = a[i]; }
    }
    let pk = 0; for (const x of mix) pk = Math.max(pk, Math.abs(x)); for (let i = 0; i < mix.length; i++) mix[i] *= 0.8 / (pk || 1);
    const m16 = E.resampleTo(mix, SR, T), v16 = E.resampleTo(voc, SR, T);
    const link = E.linkScoreToAudio(m16, T, ps, { tempo: first.tempo, unroll: false });
    let w = 512; while (w < (2.2 * T) / 75) w <<= 1;
    const vn = E.transcribeMonophonic(v16, T, { minFreq: 75, maxFreq: 1100, window: w, hop: Math.round(T * 0.02), minClarity: 0.6, minDurSec: 0.08 });
    const inWin = syl.filter((x) => { const t = trueSec(x.t) - from; return t > 0.5 && t < LEN - 1; });
    const res = {};
    for (const [k, o] of [["link", {}], ["refined", { vocalNotes: vn }]]) {
      const map = E.lyricMapFromSyllables(inWin, (q) => E.linkQToSec(link, q), o);
      const words = map.lines.flatMap((l) => l.words), errs = [];
      words.forEach((wd, i) => { const tr = trueSec(inWin[i].t) - from; errs.push(Math.abs(wd.startSec - tr)); });
      errs.sort((a, c) => a - c); all[k].push(...errs);
      res[k] = `median ${(1000 * errs[errs.length >> 1]).toFixed(0)} ms · ≤50 ms ${(100 * errs.filter((e) => e <= 0.05).length / errs.length).toFixed(0)}% · ≤100 ms ${(100 * errs.filter((e) => e <= 0.1).length / errs.length).toFixed(0)}% · ≤200 ms ${(100 * errs.filter((e) => e <= 0.2).length / errs.length).toFixed(0)}%`;
    }
    console.log(`${f.slice(0, 34).padEnd(34)} link ${link.confidence} · ${inWin.length} syllables · link only: ${res.link}  ·  refined: ${res.refined}`);
  }
  for (const k of ["link", "refined"]) { const e = all[k].sort((a, c) => a - c); console.log(`ALL ${k.padEnd(7)}: median ${(1000 * e[e.length >> 1]).toFixed(0)} ms · ≤50 ms ${(100 * e.filter((x) => x <= 0.05).length / e.length).toFixed(1)}% · ≤100 ms ${(100 * e.filter((x) => x <= 0.1).length / e.length).toFixed(1)}% · ≤200 ms ${(100 * e.filter((x) => x <= 0.2).length / e.length).toFixed(1)}% (${e.length} syllables)`); }
  process.exit(0);
}

const SCORE = arg("score"), AUDIO = arg("audio"), STEMS = arg("stems");
if (!SCORE || !AUDIO) { console.error("--score and --audio are required (or --assign-eval)"); process.exit(2); }
const dec = (f) => { const raw = execFileSync("ffmpeg", ["-v", "error", "-i", f, "-ac", "1", "-ar", String(T), "-f", "f32le", "-"], { maxBuffer: 2 ** 31 }); return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4); };
const bytes = new Uint8Array(fs.readFileSync(SCORE));
const first = await E.parseGuitarProOrXML(bytes, SCORE, true);
const ps = []; for (const p of first.parts || [{ index: 0, name: SCORE }]) ps.push({ score: p.index === first.partIndex ? first : await E.parseGuitarProOrXML(bytes, SCORE, true, p.index), name: p.name, drum: !!p.drum });
const mix = dec(AUDIO);
let t0 = Date.now();
const link = E.linkScoreToAudio(mix, T, ps, { tempo: first.tempo });
console.log(`link ok=${link.ok} match ${link.confidence} (next key ${link.runnerUp && link.runnerUp.confidence}) transpose ${link.transpose} ♩≈${link.tempo} (score ${first.tempo}) · bars ${link.bars.filter((b) => b.matched).length}/${link.bars.length} ↔ ${link.coverage.audioFrom}–${link.coverage.audioTo}s of ${link.coverage.audioLen}s (${Date.now() - t0} ms)`);
const map0 = E.linkedLyricMap(link, ps);
console.log(`lyrics: track "${map0.track}" (${map0.mode}) · ${map0.syllableCount} syllables · ${map0.lines.length} lines`);
for (const l of map0.lines.slice(0, +arg("lines", 6))) console.log(`  ${l.startSec.toFixed(2).padStart(7)}  ${l.text}`);
if (STEMS) {
  const b = fs.readFileSync(path.join(STEMS, "vocals.f32")), x = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4), n = x.length / 2, m = new Float32Array(n);
  for (let i = 0; i < n; i++) m[i] = 0.5 * (x[2 * i] + x[2 * i + 1]);
  const v16 = E.resampleTo(m, 44100, T);
  let w = 512; while (w < (2.2 * T) / 75) w <<= 1;
  const vn = E.transcribeMonophonic(v16, T, { minFreq: 75, maxFreq: 1100, window: w, hop: Math.round(T * 0.02), minClarity: 0.6, minDurSec: 0.08 });
  const map1 = E.linkedLyricMap(link, ps, { vocalNotes: vn });
  const evalMap = (map) => {
    const ons = vn.map((v) => ({ pc: ((v.midi % 12) + 12) % 12, t: v.startSec, e: v.startSec + v.durSec })).sort((a, c) => a.t - c.t);
    const syls = map.lines.flatMap((l) => l.words);
    // pitch class of each syllable from the score (same order as the map)
    const ref = E.scoreLyricSyllables(ps.find((p) => p.score.lyrics).score);
    let dSum = [], w10 = 0, w20 = 0, voiced = 0, n = 0;
    syls.forEach((s, i) => {
      const r = ref.find((x) => Math.abs(E.linkQToSec(link, x.t) - s.startSec) < 5 && x.text === s.text) || null;
      const pc = r ? ((r.midi % 12) + 12) % 12 : null;
      let bd = Infinity; for (const o of ons) { if (o.t < s.startSec - 1) continue; if (o.t > s.startSec + 1) break; if (pc == null || o.pc === pc) bd = Math.min(bd, Math.abs(o.t - s.startSec)); }
      n++; if (bd < 1) dSum.push(bd); if (bd <= 0.1) w10++; if (bd <= 0.2) w20++;
      if (ons.some((o) => o.t < s.startSec + 0.15 && o.e > s.startSec)) voiced++;
    });
    dSum.sort((a, c) => a - c);
    return `median distance to the sung onset ${(1000 * (dSum[dSum.length >> 1] || 0)).toFixed(0)} ms · within 100 ms ${(100 * w10 / n).toFixed(1)}% · within 200 ms ${(100 * w20 / n).toFixed(1)}% · a sung note in the first 0.15 s ${(100 * voiced / n).toFixed(1)}%`;
  };
  console.log(`vocal stem: ${vn.length} sung notes`);
  console.log(`  score-timed (link only):      ${evalMap(map0)}`);
  console.log(`  + vocal-line refinement:      ${evalMap(map1)}  (${map1.refined} of ${map1.syllableCount} syllables moved to a sung onset)`);
  // a random-offset control: shift every syllable 0.5 s → what chance looks like
  const ctrl = { ...map0, lines: map0.lines.map((l) => ({ ...l, words: l.words.map((wd) => ({ ...wd, startSec: wd.startSec + 0.5 })) })) };
  console.log(`  control (all shifted +0.5 s): ${evalMap(ctrl)}`);
}
