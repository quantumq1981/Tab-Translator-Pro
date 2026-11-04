/* Chord READING suite (2026-11-04) — how the audio decoder reads a recording:
 *   · minimum chord length (minDurationChordPath — the semi-Markov decode), proven EXACT against
 *     brute force on small random instances;
 *   · the user's key (keyLockPenalties + analyzeAudioChordsV2({ key, keyLock }));
 *   · evidence-adaptive decoding (weak evidence → steadier chords);
 *   · deleting / merging chords from the review list (removeChordEvents, mergeShortChords);
 *   · the UI contract (controls, re-decode wiring, chart key picker → decode, stems).
 * Accuracy lives in tests/bench/rhythm-key.mjs (dev/test split, full-mix condition). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
globalThis.DOMParser = (await import("@xmldom/xmldom")).DOMParser;
const enginePath = path.join(here, ".engine.chordreading.mjs");
fs.writeFileSync(enginePath, fs.readFileSync(path.join(repo, "engine.tsx"), "utf8"));
const eng = await import(enginePath + "?t=" + Date.now());
const uiSrc = fs.readFileSync(path.join(repo, "TabDecoderPro.tsx"), "utf8");

let failures = 0, passes = 0;
const expect = (cond, msg) => { if (cond) passes++; else { failures++; console.error("FAIL:", msg); } };
const section = (name) => console.log(`\n— ${name}`);
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

/* ---------------------------------------------------------------------------- */
section("minimum chord length — semi-Markov decode");
{
  // the score the DP maximises: Σ emission − cp·#label changes, every chord run ≥ D except a
  // run touching either end; the no-chord label (last) may be any length
  const scoreOf = (E, path, cp) => { let s = 0; for (let t = 0; t < E.length; t++) { s += E[t][path[t]]; if (t && path[t] !== path[t - 1]) s -= cp; } return s; };
  const valid = (path, D, NC) => {
    let i = 0;
    while (i < path.length) { let j = i; while (j < path.length && path[j] === path[i]) j++; if (path[i] !== NC && j - i < D && i > 0 && j < path.length) return false; i = j; }
    return true;
  };
  const brute = (E, D, cp) => {
    const T = E.length, K = E[0].length; let best = -Infinity;
    const p = new Array(T).fill(0);
    const rec = (t) => { if (t === T) { if (valid(p, D, K - 1)) best = Math.max(best, scoreOf(E, p, cp)); return; } for (let k = 0; k < K; k++) { p[t] = k; rec(t + 1); } };
    rec(0); return best;
  };
  const R = rng(7);
  let exact = 0, tried = 0, allValid = true;
  for (let n = 0; n < 60; n++) {
    const T = 5 + Math.floor(R() * 4), K = 3, D = 2 + Math.floor(R() * 2), cp = R() * 0.4;
    const E = Array.from({ length: T }, () => Array.from({ length: K }, () => R()));
    const path = eng.minDurationChordPath(E, null, D, { changePenalty: cp });
    tried++;
    if (!valid(path, D, K - 1)) allValid = false;
    if (Math.abs(scoreOf(E, path, cp) - brute(E, D, cp)) < 1e-9) exact++;
  }
  expect(allValid, "every decoded path keeps each chord for at least the minimum (rests and the two end runs excepted)");
  expect(exact === tried, `the decode is EXACT: optimal score on ${exact}/${tried} random instances checked by brute force`);
  expect(eng.minDurationChordPath([[1, 0], [0, 1]], null, 1, {}) === null, "a minimum of one unit leaves the HMM's own Viterbi path in charge (returns null)");
  // flicker: two labels alternating every unit with a small edge → one label held, not 12 changes
  const E = Array.from({ length: 12 }, (_, t) => [t % 2 ? 0.5 : 0.52, t % 2 ? 0.52 : 0.5, 0]);
  const p = eng.minDurationChordPath(E, null, 4, { changePenalty: 0.01 });
  let ch = 0; for (let t = 1; t < p.length; t++) if (p[t] !== p[t - 1]) ch++;
  expect(ch <= 2, `alternating evidence no longer flips every unit (changes: ${ch})`);
  // a forced rest (gated) stays a rest
  const g = new Array(12).fill(false); g[5] = g[6] = true;
  const pg = eng.minDurationChordPath(E, g, 3, {});
  expect(pg[5] === 2 && pg[6] === 2, "a gated (silent) span is decoded as no-chord");
}

/* ---------------------------------------------------------------------------- */
section("the user's key");
{
  const states = eng.chordStatesV2({ vocabulary: "chart" });
  const pick = (root, suffix) => states.findIndex((s) => s.root === root && (s.writeQ || s.quality).suffix === suffix && !s.inversion);
  const G = { tonic: 7, mode: "major" };
  const guide = eng.keyLockPenalties(states, G, {}), strict = eng.keyLockPenalties(states, G, { keyLock: "strict" });
  const at = (pen, r, q) => pen[pick(r, q)];
  // diatonic in G: G C D Em Am7 D7 F#m7♭5 — no penalty
  expect([[7, ""], [0, ""], [2, ""], [4, "m"], [9, "m7"], [2, "7"], [6, "m7♭5"]].every(([r, q]) => at(guide, r, q) === 0 && at(strict, r, q) === 0),
    "every diatonic chord of G major (incl. Am7 = ii7, D7 = V7, F#m7♭5 = vii) is free in both modes");
  expect(at(guide, 9, "7") > 0 && at(guide, 9, "") > 0 && at(guide, 8, "7") > at(guide, 9, ""), "in G, A / A7 / Ab7 cost something, Ab7 (three foreign tones) the most");
  expect(at(strict, 9, "7") >= 1e3 && at(strict, 9, "") >= 1e3 && at(strict, 7, "m") >= 1e3, "'only key chords' removes A7, A and Gm in G");
  expect(at(strict, 5, "") === 0 && at(strict, 0, "m") === 0 && at(strict, 3, "") === 0, "…but keeps the borrowed ♭VII (F), iv (Cm) and ♭VI (Eb)");
  expect(at(guide, 5, "") > 0 && at(guide, 5, "") < at(guide, 9, "7"), "with 'prefer', ♭VII costs less than a secondary dominant");
  const Am = eng.keyLockPenalties(states, "Am", { keyLock: "strict" });
  expect(at(Am, 4, "7") === 0 && at(Am, 2, "") === 0 && at(Am, 4, "m") === 0, "in A minor, E7 (harmonic minor V7), D (dorian IV) and Em are allowed");
  expect(eng.keyLockPenalties(states, null, {}) === null && eng.keyLockPenalties(states, "Dsus4", {}) === null, "no key / not a key → no penalties");

  // decode audio IN a key: an A-major triad heard in a song the user says is in G (strict) is
  // re-read as an in-key chord, and no event or alternative is outside G
  const VSR = 16000;
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const sig = new Float32Array(VSR * 8);
  const tone = (f, t0, t1, a) => { for (let i = Math.floor(t0 * VSR); i < Math.floor(t1 * VSR); i++) { let v = 0; for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * h * f * i / VSR) / h; sig[i] += a * v; } };
  for (const [t0, t1, ms] of [[0, 2, [55, 59, 62]], [2, 4, [57, 61, 64]], [4, 6, [50, 54, 57]], [6, 8, [55, 59, 62]]]) for (const m of ms) tone(hz(m), t0, t1, 0.12);
  const beats = []; for (let t = 0; t <= 8.0001; t += 0.5) beats.push(+t.toFixed(3));
  const free = eng.analyzeAudioChordsV2(sig, VSR, { vocabulary: "chart", beats, bpm: 120 });
  const inG = eng.analyzeAudioChordsV2(sig, VSR, { vocabulary: "chart", beats, bpm: 120, key: "G", keyLock: "strict" });
  // a chord is "outside G" when a tone (or its bass) is not in the G-major scale and it is not
  // one of the borrowed chords 'only key chords' keeps (F, Cm, Eb, Bb and their 7ths)
  const G_SCALE = new Set([7, 9, 11, 0, 2, 4, 6]), MIX = new Set([3, 8, 10]);
  const outOfG = (sym) => {
    const p = eng.parseChordSymbolForVoicings(sym); if (!p.ok) return false;
    const pcs = p.formula.tones.map((t) => (p.rootPc + t.semi) % 12).concat(p.bassPc != null ? [p.bassPc] : []);
    if (pcs.every((x) => G_SCALE.has(x))) return false;
    const rel = (p.rootPc - 7 + 12) % 12;
    return !([10, 8, 3, 5].includes(rel) && pcs.every((x) => G_SCALE.has(x) || MIX.has((x - 7 + 12) % 12)));
  };
  expect(free.events.some((e) => e.symbol === "A"), `without a key the A-major chord reads A (${free.events.map((e) => e.symbol).join(" ")})`);
  expect(!inG.events.some((e) => outOfG(e.symbol)) && !inG.events.some((e) => (e.alternatives || []).some((a) => outOfG(a.symbol))),
    `in G (only key chords) no event or alternative is A / A7 / C# / Ab / Bb (${inG.events.map((e) => e.symbol).join(" ")})`);
  expect(inG.key && inG.key.tonic === 7 && inG.key.mode === "major" && inG.key.set === true, "the result carries the user's key, marked as set");
  expect(inG.events[0].symbol === "G" && inG.events[inG.events.length - 1].symbol === "G", "the in-key chords still read correctly (G … G)");
}

/* ---------------------------------------------------------------------------- */
section("evidence-adaptive decoding");
{
  const VSR = 16000;
  const sig = new Float32Array(VSR * 6);
  const R = rng(3);
  for (let i = 0; i < sig.length; i++) { const t = i / VSR; sig[i] = 0.1 * (Math.sin(2 * Math.PI * 261.6 * t) + Math.sin(2 * Math.PI * 329.6 * t) + Math.sin(2 * Math.PI * 392 * t)) + 0.02 * (R() * 2 - 1); }
  const beats = []; for (let t = 0; t <= 6.0001; t += 0.5) beats.push(+t.toFixed(3));
  const clean = eng.analyzeAudioChordsV2(sig, VSR, { beats, bpm: 120 });
  expect(clean.evidence > 0.72 && !clean.adapted, `a clear chord is decoded as heard (evidence ${clean.evidence}, not adapted)`);
  const forced = eng.analyzeAudioChordsV2(sig, VSR, { beats, bpm: 120, adaptiveBelow: 1.01 });
  expect(forced.adapted === true && typeof forced.evidence === "number", "below the evidence threshold the decode is re-run steadier and says so (adapted)");
  const off = eng.analyzeAudioChordsV2(sig, VSR, { beats, bpm: 120, adaptiveBelow: 1.01, adaptive: false });
  expect(!off.adapted, "adaptive:false keeps the plain decode");
  const explicit = eng.analyzeAudioChordsV2(sig, VSR, { beats, bpm: 120, adaptiveBelow: 1.01, changePenalty: 0.14 });
  expect(!explicit.adapted, "an explicit changePenalty is never overridden");
  const min = eng.analyzeAudioChordsV2(sig, VSR, { beats, bpm: 120, minChordBeats: 2 });
  expect(min.events.every((e, i) => i === 0 || i === min.events.length - 1 || e.durSec >= 0.999), "minChordBeats: 2 → no inner chord shorter than two beats (1 s at 120 bpm)");
}

/* ---------------------------------------------------------------------------- */
section("review list — delete / merge");
{
  const ev = [
    { symbol: "C", startSec: 0, durSec: 1, prob: 0.9 },
    { symbol: "G", startSec: 1, durSec: 0.2, prob: 0.3 },
    { symbol: "C", startSec: 1.2, durSec: 0.8, prob: 0.8 },
    { symbol: "Am", startSec: 2, durSec: 2, prob: 0.9 },
  ];
  const snap = JSON.stringify(ev);
  const r1 = eng.removeChordEvents(ev, [1]);
  expect(r1.length === 2 && r1[0].symbol === "C" && r1[0].startSec === 0 && Math.abs(r1[0].durSec - 2) < 1e-9 && r1[1].symbol === "Am",
    `deleting the G: the C before rings on and joins the C after (${r1.map((e) => `${e.symbol}@${e.startSec}+${e.durSec}`).join(" ")})`);
  const r0 = eng.removeChordEvents(ev, [0]);
  expect(r0[0].symbol === "G" && r0[0].startSec === 0 && Math.abs(r0[0].durSec - 1.2) < 1e-9, "deleting the FIRST chord gives its time to the next one");
  expect(JSON.stringify(ev) === snap, "the input timeline is never mutated");
  expect(eng.removeChordEvents(ev, []).length === 4 && eng.removeChordEvents(ev, [0, 1, 2, 3]).length === 0 && eng.removeChordEvents(ev, [99]).length === 4, "nothing / everything / out-of-range");
  const m = eng.mergeShortChords(ev, 0.5);
  expect(m.length === 2 && m.map((e) => e.symbol).join(" ") === "C Am", "merging chords shorter than ½ s removes the 0.2 s G");
  const kept = eng.mergeShortChords([ev[0], { ...ev[1], reviewed: true }, ev[2]], 0.5);
  expect(kept.some((e) => e.symbol === "G"), "a chord the user reviewed is never merged away");
}

/* ---------------------------------------------------------------------------- */
section("UI contract");
{
  expect(/function ChordReadingControls/.test(uiSrc) && /function chordReadingOpts/.test(uiSrc), "the chord-reading controls ship");
  expect(/_usePref\("ttp:keyUse", "prefer"/.test(uiSrc) && /_usePref\("ttp:chordChanges", "auto"/.test(uiSrc), "key use (prefer) and chord changes (auto) are per-device preferences");
  expect(/vocabulary: vocab, sixNine, \.\.\.chordReadingOpts\(rd\.songKey, rd\.keyUse, rd\.changes\)/.test(uiSrc), "the chord decode passes the song key, key use and chord-change length");
  expect(/keyOverride=\{songKey\} setKeyOverride=\{\(k\) => setSongKey\(k \|\| ""\)\}/.test(uiSrc), "the audio chart's key picker IS the song key — picking a key there re-reads the chords in it");
  expect(/\[songKey, keyUse, changes\]\);/.test(uiSrc) && /run\(s\.cur, s\.sr, kind\); \}/.test(uiSrc), "changing the song key / key use / chord changes re-decodes");
  expect(/onRemove=\{removeChords\} onMergeShort=\{mergeShort\}/.test(uiSrc) && /removeChordEvents\(evs, idx\)/.test(uiSrc) && /mergeShortChords\(evs,/.test(uiSrc), "the review list can delete chords and merge the short ones");
  expect(/✕ Delete selected/.test(uiSrc) && /aria-label=\{`delete chord at/.test(uiSrc), "per-row ✕ and a batch delete in the review list");
  expect(/reading=\{chordReadingOpts\(songKey, keyUse, changes\)\}/.test(uiSrc) && /\.\.\.\(readRefS\.current \|\| \{\}\)/.test(uiSrc) && /readKey\]\);/.test(uiSrc), "the stem charts use (and re-chart on) the same chord reading");
  expect(/beatInfo\.adapted/.test(uiSrc) && /id="ttp-stems"/.test(uiSrc), "a weak-evidence (full mix) decode says so and points to the stem split");
  const src = fs.readFileSync(path.join(repo, "engine.tsx"), "utf8");
  expect(/^\s+minDurationChordPath,$/m.test(src) && /^\s+keyLockPenalties,$/m.test(src) && /^\s+removeChordEvents,$/m.test(src) && /^\s+mergeShortChords,$/m.test(src), "the new engine functions are exported");
}

try { fs.unlinkSync(enginePath); } catch (_) {}
console.log(`\nchord-reading: ${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
