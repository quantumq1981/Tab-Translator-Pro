/* Score ↔ recording link benchmark.
 *   node bench/scorelink.mjs [--split dev|test] [--conds clean,noise,bleed] [--sec 60] [--weights 0.3,1,2]
 *
 * Each corpus comp part is rendered (lib.renderPart) with a TEMPO WARP the score does not know
 * about (±6 % sine over 12 bars, one bar 20 % slower — rubato), as a 60 s excerpt starting at the
 * first chord (so the score is LONGER than the recording and starts earlier). Then:
 *   audio      — the v2 decoder alone (vocabulary "chart"), the shipped default
 *   exact      — linked to the true score (the comp part, unwarped, at its ♩ marking)
 *   corrupt20  — linked to a score with 20 % of its bars WRONG (each such bar moved by 2–10 semitones)
 *   corrupt40  — 40 % of bars wrong
 *   blind20    — the corrupt20 score trusted blindly (scoreWeight 50): what copying a bad file gives
 *   transposed — linked to the exact score written 3 semitones higher (must detect −3)
 * Reported: chord accuracy vs the rendered truth (named in the chart vocabulary, MIREX-style), and
 * alignment error at the score's bar lines inside the excerpt. Truth is synthetic (deltas are the read). */
import fs from "node:fs"; import path from "node:path";
import * as L from "./lib.mjs";
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "1"] : null).filter(Boolean));
const eng = await L.loadEngine(args.engine ? path.resolve(args.engine) : undefined);
const cacheDir = path.join(L.here, ".cache-link"); fs.mkdirSync(cacheDir, { recursive: true });
const CONDS = (args.conds || "clean,noise,bleed").split(",");
const SEC = +(args.sec || 60);
const WEIGHTS = (args.weights || "1").split(",").map(Number);
const SONGS = L.CORPUS.map((c, i) => [...c, i]).filter(([, , , i]) => args.split === "dev" ? i % 2 === 0 : args.split === "test" ? i % 2 === 1 : true).slice(0, +(args.songs || 99));

function warped(score) {
  const base = score.tempo || 100;
  const map = score.bars.map((b, i) => ({ bar: b.number, beat: 0, bpm: +(base * (1 + 0.06 * Math.sin((2 * Math.PI * i) / 12)) * (i % 17 === 9 ? 0.8 : 1)).toFixed(3) }));
  return { ...score, tempoMap: map };
}
function corrupt(score, frac, seed) {
  const R = L.rng(seed), shifts = [2, 3, 4, 5, 7, 8, 9, 10];
  return { ...score, bars: score.bars.map((b) => {
    if (R() >= frac) return b;
    const k = shifts[Math.floor(R() * shifts.length)];
    return { ...b, events: b.events.map((e) => ({ ...e, midis: (e.midis || []).map((m) => m + k) })) };
  }) };
}
const transposed = (score, n) => ({ ...score, bars: score.bars.map((b) => ({ ...b, events: b.events.map((e) => ({ ...e, midis: (e.midis || []).map((m) => m + n) })) })) });

async function getItem(file, part, inst, cond, idx) {
  const key = `${idx}-${cond}-${SEC}`.replace(/\W/g, "_");
  const fa = path.join(cacheDir, key + ".f32"), fj = path.join(cacheDir, key + ".json");
  const bytes = new Uint8Array(fs.readFileSync(path.join(L.repo, file)));
  const sc = await eng.parseGuitarProOrXML(bytes, file, true, part);
  if (fs.existsSync(fa) && fs.existsSync(fj)) {
    const meta = JSON.parse(fs.readFileSync(fj, "utf8")); const b = fs.readFileSync(fa);
    return { ...meta, score: sc, audio: new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4) };
  }
  const ws = warped(sc);
  const R = L.rng(5000 + idx * 7 + CONDS.indexOf(cond));
  const r = L.renderPart(eng, ws, { sr: 44100, instrument: inst, seed: 17 + idx, maxSec: SEC });
  if (!r) return null;
  let a = r.audio;
  if (cond === "noise") a = L.addNoise(a, 20, R);
  if (cond === "bleed") a = L.addBleed(a, r.sr, r.bpm, 0.6, R, null);
  let pk = 0; for (let i = 0; i < a.length; i++) pk = Math.max(pk, Math.abs(a[i]));
  const out = new Float32Array(a.length); for (let i = 0; i < a.length; i++) out[i] = (0.8 * a[i]) / (pk || 1);
  // true bar-line times in the excerpt (warped clock, shifted by the excerpt start)
  const barTempos = eng.scoreBarTempos(ws, ws.tempo); let t = 0; const barSec = [];
  ws.bars.forEach((b, i) => { barSec.push(t - r.t0); const [n, d] = b.timeSig || ws.timeSig; t += ((n * 4) / d) * (60 / barTempos[i]); });
  const meta = { gt: r.gt, sr: r.sr, barSec, file, part, inst, cond };
  fs.writeFileSync(fa, Buffer.from(out.buffer)); fs.writeFileSync(fj, JSON.stringify(meta));
  return { ...meta, score: sc, audio: out };
}

const metrics = ["root", "majmin", "sevenths", "bass", "seg"];
const agg = {}, alignErr = { exact: [], corrupt20: [], transposed: [] }, detect = { ok: 0, n: 0 }, linkConf = [];
const add = (k, s) => { agg[k] = agg[k] || { n: 0 }; agg[k].n++; for (const m of metrics) agg[k][m] = (agg[k][m] || 0) + s[m]; };
for (const cond of CONDS) for (const [file, part, inst, ci] of SONGS) {
  const it = await getItem(file, part, inst, cond, ci);
  if (!it) continue;
  const sr0 = it.sr / Math.floor(it.sr / 16000), ds = eng.resampleTo(it.audio, it.sr, sr0);
  const total = it.gt[it.gt.length - 1].t1;
  const gt = it.gt.map((g) => ({ ...g, label: L.relabelForVocabulary(eng, g.label, "chart") }));
  // the score the user would have: the bars the recording plays, with 2 bars of slack each side
  // (semi-global: an intro/outro on either side must not throw the link)
  const inEx = it.barSec.map((t, i) => i).filter((i) => it.barSec[i + 1] != null ? it.barSec[i + 1] > 0 && it.barSec[i] < total : it.barSec[i] < total);
  const sub = (sc) => ({ ...sc, bars: sc.bars.slice(Math.max(0, inEx[0] - 2), inEx[inEx.length - 1] + 3) });
  it.score = sub(it.score);
  const fr = eng.nnlsChromagram(ds, sr0, {});
  const base = { vocabulary: "chart", _frames: fr, tempo: it.score.tempo, unroll: false };   // the renderer plays bars as written
  const run = (k, f) => { const r = f(); add(`${k}|${cond}`, L.score(gt, r.events || [], eng.QUALITIES, total)); return r; };
  run("audio", () => eng.analyzeAudioChordsV2(ds, sr0, base));
  const bars = (lk) => {           // alignment error at bar lines inside the excerpt (bar index = written order; corpus parts have repeats unrolled? use sourceBar)
    const errs = [];
    for (const b of lk.bars) { const tr = it.barSec[b.sourceBar - 1]; if (tr == null || tr < 0.5 || tr > total - 0.5) continue; errs.push(Math.abs(b.sec - tr)); }
    return errs;
  };
  for (const w of WEIGHTS) {
    const tag = WEIGHTS.length > 1 ? `@${w}` : "";
    const ex = run("exact" + tag, () => eng.analyzeAudioWithScore(ds, sr0, [{ score: it.score, name: "comp" }], { ...base, scoreWeight: w, force: true }));
    if (w === WEIGHTS[0] && ex.link && ex.link.ok) { alignErr.exact.push(...bars(ex.link)); linkConf.push(ex.link.confidence); }
    const c2 = corrupt(it.score, 0.2, 77 + ci);
    const cr = run("corrupt20" + tag, () => eng.analyzeAudioWithScore(ds, sr0, [{ score: c2, name: "comp" }], { ...base, scoreWeight: w, force: true }));
    if (w === WEIGHTS[0] && cr.link && cr.link.ok) alignErr.corrupt20.push(...bars(cr.link));
    run("corrupt40" + tag, () => eng.analyzeAudioWithScore(ds, sr0, [{ score: corrupt(it.score, 0.4, 91 + ci), name: "comp" }], { ...base, scoreWeight: w, force: true }));
  }
  const be = run("blindExact", () => eng.analyzeAudioWithScore(ds, sr0, [{ score: it.score, name: "comp" }], { ...base, scoreWeight: 50, scoreBassWeight: 10, force: true }));
  if (args.diag) {
    const at = (segs, t) => { for (const g of segs) if (t >= g.t0 && t < g.t1) return g.label; return null; };
    const es = (be.events || []).map((e) => ({ t0: e.startSec, t1: e.startSec + e.durSec, label: e.symbol }));
    const sc1 = L.score(gt, be.events || [], eng.QUALITIES, total);
    const bad = []; let last = "";
    for (let t = 0; t < total; t += 0.25) { const a = at(gt, t), b = at(es, t); const pa = L.parseLabel(a, eng.QUALITIES), pb = L.parseLabel(b, eng.QUALITIES); if ((pa ? pa.root : -1) !== (pb ? pb.root : -1)) { const k = a + "≠" + b; if (k !== last) bad.push(t.toFixed(1) + " " + k); last = k; } else last = ""; }
    { const lk = be.link, parts = eng.scoreLinkParts([{ score: it.score, name: "comp" }], { unroll: false }), grid = eng.scoreLinkPriorGrid(parts, lk.len, 0.5), states = eng.chordStatesV2({ vocabulary: "chart" });
      const N = ["C","C#","D","Eb","E","F","F#","G","Ab","A","Bb","B"]; let ok = 0, n = 0, okT = 0; const ex = [];
      for (let t = 0.05; t < total; t += 0.05) { const a = L.parseLabel(at(gt, t), eng.QUALITIES); if (!a) continue; n++;
        const q = eng.linkSecToQ(lk, t), g = grid[Math.floor(q / 0.5)]; const r = g && eng._scorePriorBonus(g, states, {}); if (r && states[r.best].root === a.root) ok++;
        // true-clock reading: the warped time → score q via the true bar times
        let bi = 0; while (bi + 1 < it.barSec.length && it.barSec[bi + 1] <= t) bi++; const b0 = it.barSec[bi], b1 = it.barSec[bi + 1] ?? b0 + 2; const qq = (bi - Math.max(0, inEx[0] - 2)) * 4 + 4 * (t - b0) / (b1 - b0);
        const g2 = grid[Math.floor(qq / 0.5)]; const r2 = g2 && eng._scorePriorBonus(g2, states, {}); if (r2 && states[r2.best].root === a.root) okT++; else if (ex.length < 6 && r2) ex.push(t.toFixed(2) + " " + at(gt, t) + "/" + N[states[r2.best].root]);
      }
      console.error(`  prior reading on link clock ${(100 * ok / n).toFixed(1)}  on TRUE clock ${(100 * okT / n).toFixed(1)}  ${ex.join(" | ")}`); }
    console.error(`  ${file} blind root ${(100 * sc1.root).toFixed(1)} :: ${bad.slice(0, 14).join(" | ")}`);
  }
  run("blind20", () => eng.analyzeAudioWithScore(ds, sr0, [{ score: corrupt(it.score, 0.2, 77 + ci), name: "comp" }], { ...base, scoreWeight: 50, scoreBassWeight: 10, force: true }));
  const tp = run("transposed", () => eng.analyzeAudioWithScore(ds, sr0, [{ score: transposed(it.score, 3), name: "comp" }], { ...base, scoreWeight: WEIGHTS[0], force: true }));
  if (tp.link && tp.link.ok) { detect.n++; if (tp.link.transpose === -3) detect.ok++; alignErr.transposed.push(...bars(tp.link)); }
  process.stderr.write(`${cond} ${file} [${part}] link ${tp.link && tp.link.ok ? tp.link.transpose : "x"}\n`);
}
const pct = (x) => (100 * x).toFixed(1).padStart(5);
console.log(`\nsplit=${args.split || "all"} songs=${SONGS.length} conds=${CONDS.join(",")}`);
console.log("variant".padEnd(22) + metrics.map((m) => m.padStart(9)).join(""));
const keys = Object.keys(agg);
const variants = [...new Set(keys.map((k) => k.split("|")[0]))];
for (const v of variants) {
  const all = { n: 0 }; for (const c of CONDS) { const a = agg[`${v}|${c}`]; if (!a) continue; all.n += a.n; for (const m of metrics) all[m] = (all[m] || 0) + a[m]; }
  for (const c of CONDS) { const a = agg[`${v}|${c}`]; if (a) console.log(`${v}|${c}`.padEnd(22) + metrics.map((m) => pct(a[m] / a.n).padStart(9)).join("")); }
  console.log(`${v}|ALL`.padEnd(22) + metrics.map((m) => pct(all[m] / all.n).padStart(9)).join(""));
}
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
for (const [k, a] of Object.entries(alignErr)) console.log(`align ${k.padEnd(11)} bars=${a.length} median=${(1000 * q(a, 0.5)).toFixed(0)}ms p90=${(1000 * q(a, 0.9)).toFixed(0)}ms ≤70ms=${pct(a.filter((x) => x <= 0.07).length / (a.length || 1))}% ≤150ms=${pct(a.filter((x) => x <= 0.15).length / (a.length || 1))}%`);
console.log(`transposition detected: ${detect.ok}/${detect.n}   link confidence median ${q(linkConf, 0.5).toFixed(3)}`);
