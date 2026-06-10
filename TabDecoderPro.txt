import React, { useEffect, useMemo, useRef, useState } from "react";

/* ============================================================================
 *  TAB DECODER · TabTranslator Pro  —  functional prototype  (v0.2)
 *  Single-file React component. Pure-JS recognition engine, zero build step.
 *
 *  Three input modes (one shared recognition engine):
 *   • MANUAL  — paste / pick an ASCII tab slice, analyse one chord block.
 *   • PDF CHART (Path A) — upload a *digital* (alphaTab-rendered) tab PDF; the
 *     parser reconstructs string/column geometry from text positions, runs every
 *     chord column through the SAME engine, and renders a lead-sheet / grid chart
 *     (consecutive identical symbols inside a bar are collapsed). 4/4 + standard
 *     tuning are ASSUMED — the PDF text layer carries no meter/tuning we can read.
 *   • MUSICXML (Path C) — upload a MusicXML score; meter, tuning and rhythm are
 *     read *exactly* from the file (no geometry guessing), only chord *symbols*
 *     are inferred via the same engine. Guitar Pro / MuseScore export MusicXML.
 *
 *  Both chart modes share one ChartPanel: lead-sheet / grid views, inline chord
 *  re-labelling (overrides), whole-chart transpose, and ChordPro / ABC export
 *  (ABC emits real playable notes + chord symbols).
 *
 *  Path A is for PDFs whose fret numbers are real text (e.g. anything exported
 *  from chord-sheet-maker-pro / alphaTab). Scanned/photographed tab (raster) is
 *  Path B — out of scope here, needs an OMR/Vision pipeline.
 *
 *  ENGINE INVARIANT: every chord-quality bitmask is DERIVED from an interval
 *  array via makeMask(). Do NOT hardcode binary literals — the source spec's
 *  literals disagreed with their own interval comments (it labelled
 *  0b000010010101 as 0,4,7,10 but that value is actually {0,2,4,7}). Deriving
 *  from intervals is the single source of truth and is verified by unit cases.
 * ==========================================================================*/

/* ---- bit helpers --------------------------------------------------------- */
const makeMask = (intervals) => intervals.reduce((m, i) => m | (1 << (i % 12)), 0);
const popcount = (n) => { let c = 0; while (n) { c += n & 1; n >>= 1; } return c; };
const rotateRight = (mask, r) => ((mask >> r) | (mask << (12 - r))) & 0xfff; // root r → bit 0
const toBinary12 = (mask) => mask.toString(2).padStart(12, "0");

/* ---- static data stores -------------------------------------------------- */
const TUNINGS = {
  Standard: [40, 45, 50, 55, 59, 64], // E2 A2 D3 G3 B3 E4  (index 0 = lowest)
  "Drop D": [38, 45, 50, 55, 59, 64], // D2 A2 D3 G3 B3 E4
};
const NOTE_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTE_FLAT  = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const INTERVAL_LABELS = ["R", "♭2", "2", "♭3", "3", "4", "♭5", "5", "♭6", "6", "♭7", "7"];

const QUALITIES = [
  { name: "Power chord",    suffix: "5",     intervals: [0, 7],        rank: 6 },
  { name: "Major",          suffix: "",      intervals: [0, 4, 7],     rank: 0 },
  { name: "Minor",          suffix: "m",     intervals: [0, 3, 7],     rank: 1 },
  { name: "Diminished",     suffix: "dim",   intervals: [0, 3, 6],     rank: 7 },
  { name: "Augmented",      suffix: "aug",   intervals: [0, 4, 8],     rank: 8 },
  { name: "Sus2",           suffix: "sus2",  intervals: [0, 2, 7],     rank: 5 },
  { name: "Sus4",           suffix: "sus4",  intervals: [0, 5, 7],     rank: 4 },
  { name: "Major 6th",      suffix: "6",     intervals: [0, 4, 7, 9],  rank: 9 },
  { name: "Minor 6th",      suffix: "m6",    intervals: [0, 3, 7, 9],  rank: 10 },
  { name: "Dominant 7th",   suffix: "7",     intervals: [0, 4, 7, 10], rank: 2 },
  { name: "Major 7th",      suffix: "maj7",  intervals: [0, 4, 7, 11], rank: 11 },
  { name: "Minor 7th",      suffix: "m7",    intervals: [0, 3, 7, 10], rank: 3 },
  { name: "Half-dim 7th",   suffix: "m7♭5",  intervals: [0, 3, 6, 10], rank: 12 },
  { name: "Diminished 7th", suffix: "dim7",  intervals: [0, 3, 6, 9],  rank: 13 },
  { name: "7sus4",          suffix: "7sus4", intervals: [0, 5, 7, 10], rank: 14 },
].map((q) => ({ ...q, mask: makeMask(q.intervals) }));

const PRESETS = [
  { label: "C major",        tuning: "Standard", tab: "e|-0-|\nB|-1-|\nG|-0-|\nD|-2-|\nA|-3-|\nE|-x-|" },
  { label: "G major",        tuning: "Standard", tab: "e|-3-|\nB|-0-|\nG|-0-|\nD|-0-|\nA|-2-|\nE|-3-|" },
  { label: "A minor",        tuning: "Standard", tab: "e|-0-|\nB|-1-|\nG|-2-|\nD|-2-|\nA|-0-|\nE|-x-|" },
  { label: "E minor",        tuning: "Standard", tab: "e|-0-|\nB|-0-|\nG|-0-|\nD|-2-|\nA|-2-|\nE|-0-|" },
  { label: "F (barre)",      tuning: "Standard", tab: "e|-1-|\nB|-1-|\nG|-2-|\nD|-3-|\nA|-3-|\nE|-1-|" },
  { label: "C/E (slash)",    tuning: "Standard", tab: "e|-0-|\nB|-1-|\nG|-0-|\nD|-2-|\nA|-3-|\nE|-0-|" },
  { label: "D/F# (slash)",   tuning: "Standard", tab: "e|-2-|\nB|-3-|\nG|-2-|\nD|-0-|\nA|-0-|\nE|-2-|" },
  { label: "Asus4",          tuning: "Standard", tab: "e|-0-|\nB|-3-|\nG|-2-|\nD|-2-|\nA|-0-|\nE|-x-|" },
  { label: "Dm7",            tuning: "Standard", tab: "e|-1-|\nB|-1-|\nG|-2-|\nD|-0-|\nA|-x-|\nE|-x-|" },
  { label: "G7",             tuning: "Standard", tab: "e|-1-|\nB|-0-|\nG|-0-|\nD|-0-|\nA|-2-|\nE|-3-|" },
  { label: "Cmaj7 (no 5th)", tuning: "Standard", tab: "e|-0-|\nB|-0-|\nG|-x-|\nD|-2-|\nA|-3-|\nE|-x-|" },
  { label: "D5 (Drop D)",    tuning: "Drop D",   tab: "e|----|\nB|----|\nG|----|\nD|--0-|\nA|--0-|\nD|--0-|" },
];

/* ---- ASCII tab parser (manual mode) -------------------------------------- */
function parseTab(text) {
  const raw = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const stringLines = raw.filter((l) => /[-x|0-9]/i.test(l)).slice(0, 6);
  if (stringLines.length === 0) return { strings: [], blocks: [] };
  const stripped = stringLines.map((l) => {
    const m = l.match(/^\s*[a-gA-G][#b]?\d?\s*\|?(.*)$/);
    return m ? m[1] : l.replace(/^\|/, "");
  });
  const n = stripped.length;
  const events = [];
  const strings = [];
  stripped.forEach((content, k) => {
    const stringIndex = n - 1 - k; // top line = highest string
    strings.push({ idx: stringIndex, content: stringLines[k] });
    for (let i = 0; i < content.length; i++) {
      if (/[0-9]/.test(content[i])) {
        let num = content[i], j = i + 1;
        while (j < content.length && /[0-9]/.test(content[j])) { num += content[j]; j++; }
        events.push({ stringIndex, col: i, fret: parseInt(num, 10) });
        i = j - 1;
      }
    }
  });
  const TOL = 1;
  events.sort((a, b) => a.col - b.col);
  const blocks = [];
  let cur = null;
  for (const ev of events) {
    if (!cur || ev.col > cur.anchor + TOL) { cur = { anchor: ev.col, col: ev.col, notes: [] }; blocks.push(cur); }
    if (!cur.notes.some((nN) => nN.stringIndex === ev.stringIndex)) cur.notes.push({ stringIndex: ev.stringIndex, fret: ev.fret });
  }
  return { strings, blocks: blocks.map(({ col, notes }) => ({ col, notes })) };
}

/* ---- engine core --------------------------------------------------------- */
function fretToMidi(block, tuningArr, capo, useSharp) {
  return block.notes
    .map(({ stringIndex, fret }) => {
      const open = tuningArr[stringIndex];
      if (open === undefined) return null;
      const midi = open + capo + fret;
      return { stringIndex, fret, midi, name: (useSharp ? NOTE_SHARP : NOTE_FLAT)[midi % 12] };
    })
    .filter(Boolean)
    .sort((a, b) => a.midi - b.midi);
}
function normalise(notes) {
  if (notes.length === 0) return { chroma: [], chordMask: 0, bassPc: null, bassMidi: null };
  const bassMidi = notes[0].midi;
  const chroma = [...new Set(notes.map((nN) => nN.midi % 12))].sort((a, b) => a - b);
  return { chroma, chordMask: makeMask(chroma), bassPc: bassMidi % 12, bassMidi };
}
function recognise(chroma, chordMask, bassPc) {
  if (chroma.length === 0) return null;
  if (chroma.length === 1) return { roots: chroma[0], single: true, candidates: [], bassPc };
  const candidates = [];
  for (const root of chroma) {
    const transposed = rotateRight(chordMask, root);
    for (const q of QUALITIES) {
      const inter = popcount(transposed & q.mask);
      const extra = popcount(transposed & ~q.mask & 0xfff);
      const missing = popcount(q.mask & ~transposed & 0xfff);
      const score = inter - 0.8 * extra - 1.2 * missing;       // ranking
      const confidence = inter / (inter + extra + missing);    // displayed (Jaccard)
      candidates.push({ root, quality: q, transposed, inter, extra, missing, score, confidence });
    }
  }
  candidates.sort((a, b) => (b.score - a.score) || (a.quality.rank - b.quality.rank));
  const best = candidates[0];
  return { best, candidates: candidates.slice(0, 4), isSlash: bassPc !== null && best.root !== bassPc, bassPc };
}
function symbolOf(result, useSharp) {
  if (!result) return "—";
  const names = useSharp ? NOTE_SHARP : NOTE_FLAT;
  if (result.single) return names[result.roots] + " (single)";
  const { best, isSlash, bassPc } = result;
  const sym = names[best.root] + best.quality.suffix;
  return isSlash ? `${sym}/${names[bassPc]}` : sym;
}
// frets keyed by engine string index (0 = low E) → chord symbol (standard tuning)
function symbolForFrets(fretsByEng, useSharp) {
  const notes = Object.entries(fretsByEng).map(([si, fret]) => ({ stringIndex: +si, fret }));
  const midi = fretToMidi({ notes }, TUNINGS.Standard, 0, useSharp);
  const norm = normalise(midi);
  return symbolOf(recognise(norm.chroma, norm.chordMask, norm.bassPc), useSharp);
}
// a set of absolute MIDI notes → chord symbol (used by the MusicXML path, where
// pitch is explicit so no tuning/fret round-trip is needed)
function symbolForMidis(midis, useSharp) {
  const notes = [...new Set(midis)].sort((a, b) => a - b).map((m) => ({ midi: m }));
  const norm = normalise(notes);
  return symbolOf(recognise(norm.chroma, norm.chordMask, norm.bassPc), useSharp);
}
// frets (engine-keyed, standard tuning) → absolute MIDI list. Lets the PDF path
// carry real pitches into export/playback the same way the MusicXML path does.
function fretsToMidis(fretsByEng) {
  return Object.entries(fretsByEng)
    .map(([si, fret]) => { const open = TUNINGS.Standard[+si]; return open === undefined ? null : open + fret; })
    .filter((m) => m != null)
    .sort((a, b) => a - b);
}

/* ============================================================================
 *  PATH A — digital PDF parser (PDF.js text positions → chord chart)
 *  Mirrors the validated reference algorithm:
 *   1. extract integer text tokens with (x, top-down y)
 *   2. cluster y → string lines; group lines → staff systems (run of ≥4)
 *   3. per system: assign notes to strings by round((y-topY)/spacing)
 *   4. cluster x → chord columns; map columns to measures via the number row
 *   5. recognise each column; collapse consecutive duplicates per measure
 * ==========================================================================*/
const median = (a) => { const s = [...a].sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
function clusterVals(vals, gap) {
  const s = [...new Set(vals)].sort((a, b) => a - b);
  if (!s.length) return [];
  const out = []; let cur = [s[0]];
  for (let i = 1; i < s.length; i++) { if (s[i] - cur[cur.length - 1] <= gap) cur.push(s[i]); else { out.push(median(cur)); cur = [s[i]]; } }
  out.push(median(cur)); return out;
}
function estimateSpacing(ys) {
  const s = [...new Set(ys)].sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < s.length; i++) { const g = s[i] - s[i - 1]; if (g > 0.5 && g < 20) gaps.push(g); }
  if (!gaps.length) return 7;
  gaps.sort((a, b) => a - b);
  return median(gaps.slice(0, Math.max(1, Math.ceil(gaps.length / 2)))) || 7;
}
function buildChart(tokens) {
  const pages = {};
  tokens.forEach((t) => (pages[t.page] = pages[t.page] || []).push(t));
  const measures = new Map();
  let systemsFound = 0, columnsFound = 0;

  Object.values(pages).forEach((ds) => {
    if (ds.length < 6) return;
    const spacing = estimateSpacing(ds.map((d) => d.y));
    const lineGap = spacing * 0.5, sysGap = spacing * 2.2, colGap = spacing * 1.3, pad = spacing * 0.7;

    const lines = clusterVals(ds.map((d) => d.y), lineGap);
    const groups = []; let cur = [lines[0]];
    for (let i = 1; i < lines.length; i++) { if (lines[i] - cur[cur.length - 1] <= sysGap) cur.push(lines[i]); else { groups.push(cur); cur = [lines[i]]; } }
    groups.push(cur);
    const staves = groups.filter((g) => g.length >= 4).map((g) => ({ topY: Math.min(...g), botY: Math.max(...g) }));

    staves.forEach((st, si) => {
      systemsFound++;
      const lo = st.topY - pad, hi = st.topY + spacing * 5 + pad;
      const staffNotes = ds.filter((d) => d.y >= lo && d.y <= hi);

      const prevBot = si > 0 ? staves[si - 1].botY : -Infinity;
      const cand = ds.filter((d) => d.y > prevBot + pad && d.y < st.topY - pad);
      let marks = [];
      if (cand.length) {
        const rowLines = clusterVals(cand.map((d) => d.y), lineGap);
        let bestRow = null, bestCount = -1;
        rowLines.forEach((ry) => { const c = cand.filter((d) => Math.abs(d.y - ry) <= lineGap).length; if (c > bestCount) { bestCount = c; bestRow = ry; } });
        marks = cand.filter((d) => Math.abs(d.y - bestRow) <= lineGap).map((d) => ({ num: d.val, x: d.x })).sort((a, b) => a.x - b.x);
        marks = marks.filter((m, i) => !(i > 0 && i < marks.length - 1 && m.num > marks[i - 1].num + 3 && m.num > marks[i + 1].num));
      }

      staffNotes.sort((a, b) => a.x - b.x);
      const cols = []; let cc = [];
      for (const d of staffNotes) { if (cc.length && d.x - cc[cc.length - 1].x > colGap) { cols.push(cc); cc = []; } cc.push(d); }
      if (cc.length) cols.push(cc);

      // Horizontal extent of each bar in this system: from its measure-number
      // mark to the next mark (last bar runs to the system's right edge). Used
      // downstream to quantise chord onsets onto beats; purely additive.
      const sysRightX = staffNotes.length ? staffNotes[staffNotes.length - 1].x : null;
      const markExt = new Map();
      marks.forEach((mk, i) => {
        const startX = mk.x;
        const endX = i + 1 < marks.length ? marks[i + 1].x
          : (sysRightX != null ? sysRightX + colGap : startX + colGap * 4);
        markExt.set(mk.num, { startX, endX });
      });

      cols.forEach((col) => {
        const cx = Math.min(...col.map((d) => d.x));
        const frets = {};
        col.forEach((d) => {
          const top = Math.round((d.y - st.topY) / spacing); // 0 = high e
          if (top < 0 || top > 5) return;
          const eng = 5 - top;                                // 0 = low E
          if (frets[eng] === undefined) frets[eng] = d.val;
        });
        if (!Object.keys(frets).length) return;
        let meas = null;
        for (const m of marks) if (cx >= m.x - pad) meas = m.num;
        if (meas == null) return;
        columnsFound++;
        if (!measures.has(meas)) measures.set(meas, { number: meas, columns: [] });
        const mo = measures.get(meas);
        mo.columns.push({ x: cx, frets });
        if (mo.startX === undefined && markExt.has(meas)) {
          const e = markExt.get(meas); mo.startX = e.startX; mo.endX = e.endX;
        }
      });
    });
  });

  const list = [...measures.values()].sort((a, b) => a.number - b.number);
  list.forEach((m) => m.columns.sort((a, b) => a.x - b.x));
  return { measures: list, systemsFound, columnsFound };
}

/* ---- score model: chords placed on beats within each bar -----------------
 * Turns the geometric chart into a lead-sheet-shaped score. Consecutive
 * identical symbols collapse to one event (the chord's onset). Each onset's x
 * is quantised onto a beat using the bar's horizontal extent (Invariant: the
 * bar's FIRST chord is the downbeat). 4/4 is assumed — time-signature detection
 * from the PDF is a clean future task. Durations fill to the next onset.
 * ------------------------------------------------------------------------- */
function buildScore(chart, useSharp, beatsPerBar = 4) {
  const bars = chart.measures.map((m) => {
    const events = [];
    m.columns.forEach((c) => {
      const symbol = symbolForFrets(c.frets, useSharp);
      const last = events[events.length - 1];
      if (!last || last.symbol !== symbol) events.push({ symbol, frets: c.frets, midis: fretsToMidis(c.frets), x: c.x });
    });
    const haveExt = typeof m.startX === "number" && typeof m.endX === "number" && m.endX > m.startX;
    const width = haveExt ? m.endX - m.startX : 0;
    events.forEach((e, i) => {
      let b = i === 0 ? 0                                   // bar's first chord = downbeat
        : haveExt ? Math.round(((e.x - m.startX) / width) * beatsPerBar)
        : i;                                               // no geometry → just sequence
      e.beat = Math.max(0, Math.min(beatsPerBar - 1, b));
    });
    for (let i = 1; i < events.length; i++)                // keep beats strictly increasing
      if (events[i].beat <= events[i - 1].beat)
        events[i].beat = Math.min(beatsPerBar - 1, events[i - 1].beat + 1);
    events.forEach((e, i) => { e.durBeats = (i + 1 < events.length ? events[i + 1].beat : beatsPerBar) - e.beat; });
    return { number: m.number, events: events.map(({ x, ...e }) => e) };
  });
  return { timeSig: [beatsPerBar, 4], bars };
}

/* ============================================================================
 *  PATH C — MusicXML import  (explicit meter + tuning + rhythm, no recognition
 *  of geometry needed). MusicXML encodes <time>, <staff-tuning> and every
 *  note's <duration>/<pitch>/<string>+<fret>, so meter, tuning and beat
 *  placement are EXACT — only the chord *symbol* is inferred, by running each
 *  onset's simultaneous pitches through the same engine. Guitar Pro files can
 *  be exported to MusicXML, so this covers them too. Uses the browser's built-in
 *  DOMParser — zero new app dependencies.
 *
 *  Output is the SAME score shape buildScore produces:
 *    { source, timeSig:[beats,beatType], tuning, bars:[{ number, timeSig,
 *      events:[{ symbol, beat, durBeats, midis, frets }] }] }
 *  so the lead-sheet / grid renderer and the exporters are shared across paths.
 * ==========================================================================*/
const STEP_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const _xEls = (parent, tag) => (parent ? Array.from(parent.getElementsByTagName(tag)) : []);
const _xFirst = (parent, tag) => { const e = _xEls(parent, tag); return e.length ? e[0] : null; };
const _xText = (el) => (el && el.textContent != null ? String(el.textContent).trim() : "");
const _xChildText = (parent, tag) => _xText(_xFirst(parent, tag));
function _pitchToMidi(p) {
  const step = _xChildText(p, "step");
  const alter = parseInt(_xChildText(p, "alter") || "0", 10) || 0;
  const oct = parseInt(_xChildText(p, "octave") || "4", 10);
  if (!(step in STEP_SEMI)) return null;
  return (oct + 1) * 12 + STEP_SEMI[step] + alter;
}
function _parseTuning(staffTunings) {
  const arr = [];
  staffTunings.forEach((st) => {
    const line = parseInt(st.getAttribute("line") || "0", 10); // line 1 = bottom = low string
    const step = _xChildText(st, "tuning-step");
    const oct = parseInt(_xChildText(st, "tuning-octave") || "0", 10);
    const alter = parseInt(_xChildText(st, "tuning-alter") || "0", 10) || 0;
    if (line >= 1 && line <= 6 && step in STEP_SEMI) arr[line - 1] = (oct + 1) * 12 + STEP_SEMI[step] + alter;
  });
  return arr.length === 6 && arr.every((v) => typeof v === "number") ? arr : null;
}
function _tuningName(arr) {
  if (!arr) return "Standard";
  for (const [n, t] of Object.entries(TUNINGS)) if (t.every((v, i) => v === arr[i])) return n;
  return "Custom";
}
function parseMusicXML(xml, useSharp = true) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (_xEls(doc, "parsererror").length) throw new Error("Not valid XML.");
  const part = _xFirst(doc, "part");
  if (!part) throw new Error("No <part> found — is this a MusicXML score?");

  let divisions = 1, beats = 4, beatType = 4, tuning = null;
  const bars = [];
  _xEls(part, "measure").forEach((measure, mi) => {
    let cursor = 0, lastOnset = 0;
    const onsets = new Map(); // onset(div) -> { midis:[], frets:{} }
    for (let node = measure.firstChild; node; node = node.nextSibling) {
      if (node.nodeType !== 1) continue;
      const tag = node.nodeName;
      if (tag === "attributes") {
        const d = _xChildText(node, "divisions"); if (d) divisions = parseInt(d, 10) || divisions;
        const t = _xFirst(node, "time");
        if (t) { const b = _xChildText(t, "beats"), bt = _xChildText(t, "beat-type"); if (b) beats = parseInt(b, 10) || beats; if (bt) beatType = parseInt(bt, 10) || beatType; }
        const sts = _xEls(node, "staff-tuning"); if (sts.length) { const tu = _parseTuning(sts); if (tu) tuning = tu; }
      } else if (tag === "note") {
        if (_xFirst(node, "grace")) continue;
        const dur = parseInt(_xChildText(node, "duration") || "0", 10) || 0;
        const isChord = !!_xFirst(node, "chord");
        const isRest = !!_xFirst(node, "rest");
        const onset = isChord ? lastOnset : cursor;
        if (!isChord) { lastOnset = cursor; cursor += dur; }
        if (isRest) continue;
        let midi = null, eng = null, fret = null;
        const p = _xFirst(node, "pitch"); if (p) midi = _pitchToMidi(p);
        const tech = _xFirst(node, "technical");
        if (tech) {
          const sNum = parseInt(_xChildText(tech, "string"), 10);
          const f = parseInt(_xChildText(tech, "fret"), 10);
          if (!isNaN(sNum) && !isNaN(f)) { eng = 6 - sNum; fret = f; if (midi == null) { const open = (tuning || TUNINGS.Standard)[eng]; if (open != null) midi = open + f; } }
        }
        if (midi == null) continue;
        if (!onsets.has(onset)) onsets.set(onset, { midis: [], frets: {} });
        const o = onsets.get(onset); o.midis.push(midi); if (eng != null && o.frets[eng] === undefined) o.frets[eng] = fret;
      } else if (tag === "backup") { cursor -= parseInt(_xChildText(node, "duration") || "0", 10) || 0; }
      else if (tag === "forward") { cursor += parseInt(_xChildText(node, "duration") || "0", 10) || 0; }
    }
    const divPerBeat = (divisions * 4) / beatType || divisions;
    const raw = [...onsets.entries()].sort((a, b2) => a[0] - b2[0]).map(([onset, o]) => ({
      symbol: symbolForMidis(o.midis, useSharp), midis: [...o.midis].sort((a, b2) => a - b2), frets: o.frets, onset,
    }));
    const events = [];
    raw.forEach((e) => { const last = events[events.length - 1]; if (!last || last.symbol !== e.symbol) events.push(e); });
    events.forEach((e) => { e.beat = Math.max(0, Math.min(beats - 1, Math.round(e.onset / divPerBeat))); });
    for (let i = 1; i < events.length; i++) if (events[i].beat <= events[i - 1].beat) events[i].beat = Math.min(beats - 1, events[i - 1].beat + 1);
    events.forEach((e, i) => { e.durBeats = (i + 1 < events.length ? events[i + 1].beat : beats) - e.beat; });
    const number = parseInt(measure.getAttribute("number") || String(mi + 1), 10);
    bars.push({ number, timeSig: [beats, beatType], events: events.map(({ onset, ...e }) => e) });
  });
  // tempo: <sound tempo="…"> if present, else a <metronome> per-minute (assume
  // it's a quarter-note BPM). null → callers default (e.g. 100 for playback).
  let tempo = null;
  const sound = _xEls(doc, "sound").find((s) => s.getAttribute("tempo"));
  if (sound) { const v = parseFloat(sound.getAttribute("tempo")); if (!isNaN(v)) tempo = v; }
  if (tempo == null) { const pm = _xFirst(doc, "per-minute"); if (pm) { const v = parseFloat(_xText(pm)); if (!isNaN(v)) tempo = v; } }
  return { source: "musicxml", timeSig: bars.length ? bars[0].timeSig : [beats, beatType], tuning: _tuningName(tuning), tempo, bars };
}

/* ---- key + roman-numeral analysis ----------------------------------------
 * Infers the most likely major/minor key by scoring all 24 keys: each chord
 * adds its duration if it's diatonic to that key (a reduced amount if only its
 * root fits — a borrowed quality), with a small cadential bonus for the last/
 * first chord being the tonic. `romanFor` then labels a chord relative to that
 * key; non-diatonic chords fall back to their absolute symbol. Pure + testable.
 * ------------------------------------------------------------------------- */
const _PC_BY_NAME = (() => { const m = {}; NOTE_SHARP.forEach((n, i) => (m[n] = i)); NOTE_FLAT.forEach((n, i) => (m[n] = i)); return m; })();
const _MAJ = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
const _MIN = { 0: 0, 2: 1, 3: 2, 5: 3, 7: 4, 8: 5, 10: 6, 11: 6 }; // 11 = leading-tone vii°
const _MAJ_Q = { 0: "maj", 2: "min", 4: "min", 5: "maj", 7: "maj", 9: "min", 11: "dim" };
const _MIN_Q = { 0: "min", 2: "dim", 3: "maj", 5: "min", 7: "min", 8: "maj", 10: "maj", 11: "dim" };
const _ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];
function _classOf(suf) {
  if (suf === "5") return "power";
  if (suf === "m7♭5" || suf === "m7b5") return "dim";
  if (suf === "dim" || suf === "dim7") return "dim";
  if (suf === "aug") return "aug";
  if (/^m(?!aj)/.test(suf)) return "min";        // m, m7, m6 — but not maj7
  if (suf === "7" || suf === "9" || suf === "13" || suf === "7sus4") return "dom";
  if (suf.startsWith("sus")) return "sus";
  return "maj";                                   // "", 6, maj7
}
function _parseSym(symbol) {
  if (!symbol) return { pc: null };
  const head = String(symbol).split("/")[0];
  const mm = head.match(/^([A-G][#b♯♭]?)(.*)$/);
  if (!mm) return { pc: null };
  const root = mm[1].replace("♯", "#").replace("♭", "b");
  const pc = _PC_BY_NAME[root];
  if (pc === undefined) return { pc: null };
  return { pc, suffix: mm[2], cls: _classOf(mm[2]) };
}
function qualCompatible(mode, rel, cls) {
  const exp = (mode === "major" ? _MAJ_Q : _MIN_Q)[rel];
  if (exp === undefined) return false;
  if (cls === "power" || cls === "sus") return true;          // no 3rd → fits either
  if (exp === "maj") return cls === "maj" || cls === "dom";
  if (exp === "min") return cls === "min" || (mode === "minor" && rel === 7 && (cls === "maj" || cls === "dom")); // harmonic V
  if (exp === "dim") return cls === "dim";
  return false;
}
function analyzeKey(score) {
  const parsed = [];
  for (const b of score.bars) for (const e of b.events) { const p = _parseSym(e.symbol); if (p.pc != null) parsed.push({ ...p, dur: Math.max(0.5, e.durBeats || 1) }); }
  if (!parsed.length) return null;
  const total = parsed.reduce((s, p) => s + p.dur, 0);
  const first = parsed[0].pc, last = parsed[parsed.length - 1].pc;
  let best = null;
  for (let tonic = 0; tonic < 12; tonic++) for (const mode of ["major", "minor"]) {
    const idx = mode === "major" ? _MAJ : _MIN;
    let sc = 0;
    for (const p of parsed) { const rel = (p.pc - tonic + 12) % 12; if (rel in idx) sc += qualCompatible(mode, rel, p.cls) ? p.dur : p.dur * 0.3; }
    if (last === tonic) sc += total * 0.08;
    if (first === tonic) sc += total * 0.04;
    if (!best || sc > best.sc) best = { tonic, mode, sc };
  }
  return { tonic: best.tonic, mode: best.mode, confidence: best.sc / (total || 1) };
}
const _romanExt = (suf) => ({ "7": "7", m7: "7", dim7: "7", maj7: "maj7", "6": "6", m6: "6", sus2: "sus2", sus4: "sus4", "7sus4": "7sus4" }[suf] || "");
function romanFor(symbol, key) {
  const p = _parseSym(symbol);
  if (p.pc == null || !key) return symbol;
  const rel = (p.pc - key.tonic + 12) % 12;
  const idx = (key.mode === "major" ? _MAJ : _MIN)[rel];
  if (idx === undefined) return symbol;            // non-diatonic → absolute symbol
  const base = _ROMAN[idx];
  let num;
  if (p.cls === "dim") num = base.toLowerCase() + (p.suffix === "m7♭5" || p.suffix === "m7b5" ? "ø" : "°");
  else if (p.cls === "min") num = base.toLowerCase();
  else if (p.cls === "aug") num = base + "+";
  else num = base;
  return num + _romanExt(p.suffix);
}
function keyName(key, useSharp) {
  if (!key) return null;
  return (useSharp ? NOTE_SHARP : NOTE_FLAT)[key.tonic] + (key.mode === "minor" ? "m" : "");
}

/* ---- exporters: a score → ChordPro grid / ABC (chords + playable notes) ----
 * Both accept an `overrides` map ({ "<bar>.<beat>": "Symbol" }) so user edits
 * flow straight into the exported text. ABC emits the actual chord tones as
 * notes (with the symbol as a guitar-chord annotation) so the result is real,
 * playable music — that's what the in-app preview / play-sheet-music consume.
 * ------------------------------------------------------------------------- */
const _ovSym = (bar, e, ov) => (ov && ov[`${bar.number}.${e.beat}`] != null ? ov[`${bar.number}.${e.beat}`] : e.symbol);
const _ABC_LTR = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"];
const _ABC_ACC = ["", "^", "", "^", "", "", "^", "", "^", "", "^", ""];
function midiToAbc(m) {
  const pc = ((m % 12) + 12) % 12, oct = Math.floor(m / 12) - 1;
  let note = _ABC_LTR[pc];
  if (oct >= 5) { note = note.toLowerCase(); for (let o = 6; o <= oct; o++) note += "'"; }
  else { for (let o = oct; o < 4; o++) note += ","; }
  return _ABC_ACC[pc] + note;
}
const _gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) { const t = b; b = a % b; a = t; } return a || 1; };
function abcDur(durBeats, beatType) {
  let num = durBeats * 4, den = beatType; const g = _gcd(num, den); num /= g; den /= g;
  if (den === 1) return num === 1 ? "" : String(num);
  return (num === 1 ? "" : String(num)) + "/" + den;
}
const _abcChordName = (s) => s.replace(/♭/g, "b").replace(/♯/g, "#").replace(/"/g, "");
function scoreToABC(score, opts = {}) {
  const ov = opts.overrides || {};
  const [b0, bt0] = score.timeSig;
  const out = ["X:1", `T:${opts.title || "Tab Decoder chart"}`, `M:${b0}/${bt0}`, "L:1/4"];
  if (opts.tempo) out.push(`Q:1/4=${Math.round(opts.tempo)}`);
  out.push(`K:${keyName(opts.key, opts.useSharp !== false) || "C"}`);
  let curSig = `${b0}/${bt0}`, body = "";
  score.bars.forEach((bar, bi) => {
    const [bb, bt] = bar.timeSig || score.timeSig;
    const sig = `${bb}/${bt}`;
    let cell = "";
    if (sig !== curSig) { cell += `[M:${sig}]`; curSig = sig; }
    bar.events.forEach((e) => {
      const dur = abcDur(e.durBeats, bt);
      const inner = e.midis && e.midis.length ? `[${e.midis.map(midiToAbc).join("")}]${dur}` : `z${dur}`;
      cell += `"${_abcChordName(_ovSym(bar, e, ov))}"${inner} `;
    });
    body += cell.trim() + " |";
    body += (bi + 1) % 4 === 0 ? "\n" : " ";
  });
  out.push(body.trim());
  return out.join("\n") + "\n";
}
function scoreToChordPro(score, opts = {}) {
  const ov = opts.overrides || {};
  const [b, bt] = score.timeSig;
  const out = [`{title: ${opts.title || "Tab Decoder chart"}}`, `{time: ${b}/${bt}}`];
  if (opts.key) out.push(`{key: ${keyName(opts.key, opts.useSharp !== false)}}`);
  out.push("{start_of_grid}");
  let row = [];
  score.bars.forEach((bar, bi) => {
    row.push(bar.events.map((e) => _ovSym(bar, e, ov)).join(" "));
    if ((bi + 1) % 4 === 0) { out.push("| " + row.join(" | ") + " |"); row = []; }
  });
  if (row.length) out.push("| " + row.join(" | ") + " |");
  out.push("{end_of_grid}");
  return out.join("\n") + "\n";
}

/* ---- MusicXML export: a proper round-trippable chord chart -----------------
 * Emits both a <harmony> (chord symbol, so MuseScore / Guitar Pro show it above
 * the staff) AND the voiced <note> pitches (so the staff is real music). Because
 * the notes are present, re-importing through parseMusicXML reconstructs the same
 * symbols — the export/import round-trip is itself a test. Honours overrides +
 * transpose (the score is already transposed by the caller) and per-bar meter. */
const _STEP_ALTER_SHARP = [["C", 0], ["C", 1], ["D", 0], ["D", 1], ["E", 0], ["F", 0], ["F", 1], ["G", 0], ["G", 1], ["A", 0], ["A", 1], ["B", 0]];
const _STEP_ALTER_FLAT = [["C", 0], ["D", -1], ["D", 0], ["E", -1], ["E", 0], ["F", 0], ["G", -1], ["G", 0], ["A", -1], ["A", 0], ["B", -1], ["B", 0]];
const _pcStepAlter = (pc, useSharp) => (useSharp ? _STEP_ALTER_SHARP : _STEP_ALTER_FLAT)[((pc % 12) + 12) % 12];
const _XML_KIND = { "": "major", m: "minor", "7": "dominant", maj7: "major-seventh", m7: "minor-seventh", m6: "minor-sixth", "6": "major-sixth", dim: "diminished", dim7: "diminished-seventh", "m7♭5": "half-diminished", m7b5: "half-diminished", aug: "augmented", sus2: "suspended-second", sus4: "suspended-fourth", "7sus4": "dominant", "5": "power" };
function _midiToPitchXML(m, useSharp) {
  const [step, alter] = _pcStepAlter(((m % 12) + 12) % 12, useSharp);
  return { step, alter, oct: Math.floor(m / 12) - 1 };
}
function _typeForQuarters(q) {
  const T = { 4: ["whole", 0], 2: ["half", 0], 1: ["quarter", 0], 0.5: ["eighth", 0], 0.25: ["16th", 0], 6: ["whole", 1], 3: ["half", 1], 1.5: ["quarter", 1], 0.75: ["eighth", 1] };
  return T[q] ? { type: T[q][0], dot: T[q][1] } : null;
}
function _harmonyXML(sym, useSharp) {
  const p = _parseSym(sym);
  if (p.pc == null) return "";
  const [rs, ra] = _pcStepAlter(p.pc, useSharp);
  let s = `      <harmony>\n        <root><root-step>${rs}</root-step>${ra ? `<root-alter>${ra}</root-alter>` : ""}</root>\n        <kind>${_XML_KIND[p.suffix] !== undefined ? _XML_KIND[p.suffix] : "major"}</kind>\n`;
  const slash = String(sym).split("/")[1];
  if (slash) { const bp = _PC_BY_NAME[slash.replace("♯", "#").replace("♭", "b")]; if (bp !== undefined) { const [bs, ba] = _pcStepAlter(bp, useSharp); s += `        <bass><bass-step>${bs}</bass-step>${ba ? `<bass-alter>${ba}</bass-alter>` : ""}</bass>\n`; } }
  return s + "      </harmony>";
}
function scoreToMusicXML(score, opts = {}) {
  const ov = opts.overrides || {}, useSharp = opts.useSharp !== false, div = 4;
  const L = ['<?xml version="1.0" encoding="UTF-8"?>', '<score-partwise version="3.1">',
    "  <part-list><score-part id=\"P1\"><part-name>Chords</part-name></score-part></part-list>", '  <part id="P1">'];
  let prevSig = null, wroteDiv = false;
  score.bars.forEach((bar, bi) => {
    const [bb, bt] = bar.timeSig || score.timeSig;
    L.push(`    <measure number="${bar.number}">`);
    const sigChanged = !prevSig || prevSig[0] !== bb || prevSig[1] !== bt;
    if (!wroteDiv || sigChanged) {
      L.push("      <attributes>");
      if (!wroteDiv) { L.push(`        <divisions>${div}</divisions>`); wroteDiv = true; }
      if (sigChanged) L.push(`        <time><beats>${bb}</beats><beat-type>${bt}</beat-type></time>`);
      L.push("      </attributes>");
    }
    prevSig = [bb, bt];
    if (bi === 0 && opts.tempo) L.push(`      <sound tempo="${opts.tempo}"/>`);
    bar.events.forEach((e) => {
      const sym = ov[`${bar.number}.${e.beat}`] != null ? ov[`${bar.number}.${e.beat}`] : e.symbol;
      const durDiv = Math.max(1, Math.round((e.durBeats * div * 4) / bt));
      const h = _harmonyXML(sym, useSharp); if (h) L.push(h);
      const midis = e.midis && e.midis.length ? e.midis : [];
      if (!midis.length) { L.push(`      <note><rest/><duration>${durDiv}</duration></note>`); return; }
      const ty = _typeForQuarters(durDiv / div);
      midis.forEach((m, ci) => {
        const p = _midiToPitchXML(m, useSharp);
        L.push("      <note>");
        if (ci > 0) L.push("        <chord/>");
        L.push(`        <pitch><step>${p.step}</step>${p.alter ? `<alter>${p.alter}</alter>` : ""}<octave>${p.oct}</octave></pitch>`);
        L.push(`        <duration>${durDiv}</duration>`);
        if (ty) { L.push(`        <type>${ty.type}</type>`); if (ty.dot) L.push("        <dot/>"); }
        L.push("      </note>");
      });
    });
    L.push("    </measure>");
  });
  L.push("  </part>", "</score-partwise>", "");
  return L.join("\n");
}

/* Transpose a whole score by n semitones. Shifts every event's MIDI and lets the
 * engine re-name the chord (so spelling follows the sharp/flat setting for free).
 * Frets are dropped — they're tuning/position-specific — so downstream readouts
 * fall back to the transposed pitches. n === 0 is a no-op passthrough. */
function transposeScore(score, n, useSharp) {
  if (!n) return score;
  const bars = score.bars.map((b) => ({
    ...b,
    events: b.events.map((e) => {
      const midis = (e.midis || []).map((m) => m + n);
      return { ...e, midis, frets: undefined, symbol: midis.length ? symbolForMidis(midis, useSharp) : e.symbol };
    }),
  }));
  return { ...score, bars, transposedBy: n };
}

/* ---- playback: schedule a score on a wall-clock, then synth it ------------
 * scoreEventTimes is PURE (testable headlessly): it flattens the score into
 * timed chord events in SECONDS at `bpm` (a quarter-note BPM). A "beat" in our
 * model is one (1/beatType) note, so its length in quarters is `4/beatType` —
 * the same conversion the ABC exporter uses. Per-bar timeSig is honoured, so a
 * mid-tune meter change keeps the clock correct. ------------------------------ */
function scoreEventTimes(score, bpm) {
  const secPerQuarter = 60 / bpm;
  let tQ = 0; const events = [];
  for (const bar of score.bars) {
    const [bb, bt] = bar.timeSig || score.timeSig;
    const q = (v) => (v * 4) / bt; // beats → quarters
    bar.events.forEach((e) => {
      events.push({
        key: `${bar.number}.${e.beat}`, bar: bar.number, midis: e.midis || [],
        start: (tQ + q(e.beat)) * secPerQuarter, dur: Math.max(0.05, q(e.durBeats) * secPerQuarter),
      });
    });
    tQ += q(bb);
  }
  return { events, duration: tQ * secPerQuarter };
}
// Web Audio synth (browser only; no deps). Returns a controller with stop().
function playScore(score, bpm, { onEvent, onEnd } = {}) {
  const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  const ctx = new AC();
  const { events, duration } = scoreEventTimes(score, bpm);
  const master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
  const t0 = ctx.currentTime + 0.08;
  const timers = [];
  events.forEach((ev) => {
    const st = t0 + ev.start, en = st + ev.dur, vol = 0.22 / Math.max(1, ev.midis.length);
    ev.midis.forEach((m) => {
      const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = 440 * Math.pow(2, (m - 69) / 12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(vol, st + 0.012);
      g.gain.setValueAtTime(vol, Math.max(st + 0.012, en - 0.06)); g.gain.linearRampToValueAtTime(0.0001, en);
      o.connect(g); g.connect(master); o.start(st); o.stop(en + 0.03);
    });
    if (onEvent) timers.push(setTimeout(() => onEvent(ev.key), ev.start * 1000 + 80));
  });
  let done = false;
  const endTimer = setTimeout(() => { done = true; if (onEnd) onEnd(); try { ctx.close(); } catch (_) {} }, duration * 1000 + 300);
  return { stop() { timers.forEach(clearTimeout); clearTimeout(endTimer); try { ctx.close(); } catch (_) {} if (!done && onEnd) onEnd(); } };
}

async function extractTokens(buf) {
  const pdfjsLib = window.pdfjsLib;
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const tokens = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      const s = (it.str || "").trim();
      const m = s.match(/\d+/);
      if (!m) continue;
      tokens.push({ x: it.transform[4], y: vp.height - it.transform[5], val: parseInt(m[0], 10), page: p });
    }
  }
  return { tokens, pages: pdf.numPages };
}

/* ========================================================================== */
/*  UI                                                                        */
/* ========================================================================== */
export default function TabDecoderPro() {
  const [mode, setMode] = useState("manual");
  const [tab, setTab] = useState(PRESETS[5].tab);
  const [tuningName, setTuningName] = useState("Standard");
  const [capo, setCapo] = useState(0);
  const [useSharp, setUseSharp] = useState(true);
  const [blockIdx, setBlockIdx] = useState(0);

  const [pdfReady, setPdfReady] = useState(false);
  const [pdfErr, setPdfErr] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [chart, setChart] = useState(null);
  const [selFrets, setSelFrets] = useState(null);
  const [selMidis, setSelMidis] = useState(null);
  const [selKey, setSelKey] = useState("");
  const [overrides, setOverrides] = useState({}); // "<bar>.<beat>" -> user-edited symbol
  const [xmlScore, setXmlScore] = useState(null);
  const [xmlErr, setXmlErr] = useState("");
  const [xmlName, setXmlName] = useState("");
  const fileRef = useRef(null);
  const xmlRef = useRef(null);

  useEffect(() => {
    if (window.pdfjsLib) { setPdfReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; setPdfReady(true); };
    s.onerror = () => setPdfErr("Could not load PDF.js from CDN. Check network/connector settings.");
    document.body.appendChild(s);
  }, []);

  const clearSel = () => { setSelFrets(null); setSelMidis(null); setSelKey(""); setOverrides({}); };

  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setPdfErr(""); setPdfBusy(true); setChart(null); clearSel();
    try {
      const buf = await f.arrayBuffer();
      const { tokens, pages } = await extractTokens(buf);
      const c = buildChart(tokens);
      if (!c.measures.length) setPdfErr("No tab measures detected. Is this a digital (text) tab PDF rather than a scan?");
      setChart({ ...c, pages, fileName: f.name });
    } catch (err) {
      setPdfErr("Parse failed: " + (err && err.message ? err.message : String(err)));
    } finally { setPdfBusy(false); }
  };

  const onXml = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setXmlErr(""); setXmlScore(null); clearSel();
    try {
      const text = await f.text();
      const sc = parseMusicXML(text, useSharp); sc._xml = text;
      if (!sc.bars.length) setXmlErr("No measures found. Is this a MusicXML score (.musicxml / .xml)?");
      setXmlScore(sc); setXmlName(f.name);
    } catch (err) {
      setXmlErr("Parse failed: " + (err && err.message ? err.message : String(err)));
    }
  };

  // re-recognise MusicXML symbols when the sharp/flat spelling flips
  useEffect(() => {
    setXmlScore((prev) => { if (!prev || !prev._xml) return prev; const next = parseMusicXML(prev._xml, useSharp); next._xml = prev._xml; return next; });
  }, [useSharp]);

  const pickChord = (key, e) => { setSelKey(key); setSelFrets(e.frets || null); setSelMidis(e.midis || null); };

  const tuningArr = TUNINGS[tuningName];
  const parsed = useMemo(() => parseTab(tab), [tab]);
  const blocks = parsed.blocks;
  const safeIdx = Math.min(blockIdx, Math.max(0, blocks.length - 1));
  const manualBlock = blocks[safeIdx];

  const displayNotes = useMemo(() => {
    const useFrets = mode === "pdf" && selFrets && Object.keys(selFrets).length;
    if (useFrets) {
      const notes = Object.entries(selFrets).map(([si, fret]) => ({ stringIndex: +si, fret }));
      return fretToMidi({ notes }, TUNINGS.Standard, 0, useSharp);
    }
    if (mode !== "manual" && selMidis) {
      const nm = useSharp ? NOTE_SHARP : NOTE_FLAT;
      return [...selMidis].sort((a, b) => a - b).map((m) => ({ midi: m, name: nm[m % 12] }));
    }
    return manualBlock ? fretToMidi(manualBlock, tuningArr, capo, useSharp) : [];
  }, [mode, selFrets, selMidis, manualBlock, tuningArr, capo, useSharp]);

  const norm = useMemo(() => normalise(displayNotes), [displayNotes]);
  const result = useMemo(() => recognise(norm.chroma, norm.chordMask, norm.bassPc), [norm]);

  const scoreView = useMemo(() => (chart ? buildScore(chart, useSharp) : null), [chart, useSharp]);

  const names = useSharp ? NOTE_SHARP : NOTE_FLAT;
  const symbol = symbolOf(result, useSharp);
  const best = result && !result.single ? result.best : null;
  const conf = best ? best.confidence : 0;
  const confColor = conf >= 0.999 ? "#98c379" : conf >= 0.7 ? "#57d1d6" : "#e9a24b";
  const applyPreset = (p) => { setTuningName(p.tuning); setTab(p.tab); setBlockIdx(0); };

  const C = { bg: "#0b0e10", panel: "#14181b", raised: "#1b2024", border: "#2a3036",
    text: "#e6e1d7", dim: "#8a8f8c", amber: "#e9a24b", cyan: "#57d1d6", red: "#e06c75", green: "#98c379" };

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100%", fontFamily: "'IBM Plex Mono', ui-monospace, monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap');
        @keyframes glowpulse {0%{transform:scale(.97);opacity:0;}100%{transform:scale(1);opacity:1;}}
        @keyframes rise {from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
        .panel-rise{animation:rise .5s cubic-bezier(.2,.7,.2,1) both;}
        .chord-pop{animation:glowpulse .35s ease-out;}
        .led{transition:background .18s ease,box-shadow .18s ease,color .18s ease;}
        .tdp-scroll::-webkit-scrollbar{width:8px;height:8px;}
        .tdp-scroll::-webkit-scrollbar-thumb{background:#2a3036;border-radius:8px;}
        textarea::placeholder{color:#5a605d;}
        .meas:hover{border-color:#e9a24b88!important;}
      `}</style>

      <div style={{ position: "relative", maxWidth: 1100, margin: "0 auto", padding: "20px 16px 40px" }}>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(120% 60% at 50% -10%, rgba(233,162,75,.10), transparent 60%)" }} />
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: .35, backgroundImage: "repeating-linear-gradient(0deg, rgba(255,255,255,.015) 0 1px, transparent 1px 3px)" }} />

        <header className="panel-rise" style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 22, letterSpacing: 1 }}>TAB<span style={{ color: C.amber }}>·</span>DECODER</span>
            <span style={{ color: C.dim, fontSize: 12, letterSpacing: 3 }}>TABTRANSLATOR PRO</span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {[["manual", "Manual"], ["pdf", "PDF Chart"], ["xml", "MusicXML"]].map(([m, lbl]) => (
              <button key={m} onClick={() => { setMode(m); clearSel(); }} style={{ ...toggle(C), padding: "6px 14px", flex: "none", ...(mode === m ? activeToggle(C) : {}) }}>
                {lbl}
              </button>
            ))}
          </div>
        </header>

        <div style={{ position: "relative", display: "grid", gridTemplateColumns: mode !== "manual" ? "minmax(0,1.25fr) minmax(0,1fr)" : "minmax(0,1fr) minmax(0,1fr)", gap: 16 }}>
          <section className="panel-rise" style={{ animationDelay: ".05s", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
            {mode === "manual" ? (
              <>
                <SectionLabel C={C}>INPUT · TAB SOURCE</SectionLabel>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                  {PRESETS.map((p) => (
                    <button key={p.label} onClick={() => applyPreset(p)} style={{ ...chip(C), borderColor: tab === p.tab ? C.amber : C.border, color: tab === p.tab ? C.amber : C.dim }}>{p.label}</button>
                  ))}
                </div>
                <textarea value={tab} onChange={(e) => { setTab(e.target.value); setBlockIdx(0); }} spellCheck={false} className="tdp-scroll"
                  placeholder={"e|-0-|\nB|-1-|\nG|-0-|\nD|-2-|\nA|-3-|\nE|-x-|"}
                  style={{ width: "100%", height: 150, resize: "vertical", background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, fontSize: 14, lineHeight: 1.5, fontFamily: "'IBM Plex Mono', monospace", outline: "none", boxSizing: "border-box" }} />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
                  <Control C={C} label="TUNING">
                    <div style={{ display: "flex", gap: 6 }}>
                      {Object.keys(TUNINGS).map((t) => (<button key={t} onClick={() => setTuningName(t)} style={{ ...toggle(C), ...(tuningName === t ? activeToggle(C) : {}) }}>{t}</button>))}
                    </div>
                  </Control>
                  <Control C={C} label="SPELLING">
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => setUseSharp(true)} style={{ ...toggle(C), ...(useSharp ? activeToggle(C) : {}) }}>Sharps ♯</button>
                      <button onClick={() => setUseSharp(false)} style={{ ...toggle(C), ...(!useSharp ? activeToggle(C) : {}) }}>Flats ♭</button>
                    </div>
                  </Control>
                  <Control C={C} label={`CAPO · fret ${capo}`}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <button onClick={() => setCapo((c) => Math.max(0, c - 1))} style={stepper(C)}>−</button>
                      <div style={{ flex: 1, textAlign: "center", color: capo ? C.amber : C.dim, fontSize: 14 }}>{capo}</div>
                      <button onClick={() => setCapo((c) => Math.min(12, c + 1))} style={stepper(C)}>+</button>
                    </div>
                  </Control>
                  <Control C={C} label={`CHORD BLOCK · ${blocks.length} found`}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <button disabled={blocks.length < 2} onClick={() => setBlockIdx((i) => Math.max(0, i - 1))} style={stepper(C)}>◀</button>
                      <div style={{ flex: 1, textAlign: "center", fontSize: 13 }}>{blocks.length ? `${safeIdx + 1} / ${blocks.length}` : "—"}</div>
                      <button disabled={blocks.length < 2} onClick={() => setBlockIdx((i) => Math.min(blocks.length - 1, i + 1))} style={stepper(C)}>▶</button>
                    </div>
                  </Control>
                </div>
                <SectionLabel C={C} style={{ marginTop: 16 }}>PITCH BREAKDOWN</SectionLabel>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {displayNotes.length === 0 && <span style={{ color: C.dim, fontSize: 13 }}>No fretted notes in this block.</span>}
                  {displayNotes.slice().reverse().map((nN, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px" }}>
                      <span style={{ color: C.dim }}>{nN.stringIndex !== undefined ? `str ${nN.stringIndex} · fret ${nN.fret}` : "note"}</span>
                      <span style={{ color: nN.midi === norm.bassMidi ? C.red : C.text }}>{nN.name}{nN.midi === norm.bassMidi ? "  ← bass" : ""} <span style={{ color: C.dim }}>· midi {nN.midi}</span></span>
                    </div>
                  ))}
                </div>
              </>
            ) : mode === "pdf" ? (
              <>
                <SectionLabel C={C}>PATH A · DIGITAL TAB PDF → CHORD CHART</SectionLabel>
                <input ref={fileRef} type="file" accept="application/pdf" onChange={onFile} style={{ display: "none" }} />
                <button onClick={() => fileRef.current && fileRef.current.click()} disabled={!pdfReady || pdfBusy}
                  style={{ width: "100%", background: C.bg, border: `1px dashed ${C.border}`, color: pdfReady ? C.amber : C.dim, borderRadius: 10, padding: "22px 12px", fontSize: 14, cursor: pdfReady ? "pointer" : "default", fontFamily: "'IBM Plex Mono', monospace" }}>
                  {!pdfReady ? "loading PDF.js…" : pdfBusy ? "parsing…" : "⬆  Upload a tab PDF  (tap to choose)"}
                </button>
                <div style={{ fontSize: 11, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>
                  For digital tab PDFs (alphaTab / chord-sheet-maker-pro exports). Standard tuning &amp; 4/4 assumed. For exact meter &amp; tuning, use the MusicXML tab.
                </div>
                {pdfErr && <div style={{ marginTop: 10, color: C.red, fontSize: 12 }}>{pdfErr}</div>}
                {scoreView && (
                  <ChartPanel score={scoreView} title={chart.fileName}
                    meta={`${scoreView.bars.length} bars · ${chart.systemsFound} systems · ${chart.pages} pp · 4/4 assumed`}
                    C={C} useSharp={useSharp} overrides={overrides} setOverrides={setOverrides} selKey={selKey} onPick={pickChord} />
                )}
              </>
            ) : (
              <>
                <SectionLabel C={C}>PATH C · MUSICXML → CHORD CHART</SectionLabel>
                <input ref={xmlRef} type="file" accept=".xml,.musicxml,application/xml,text/xml" onChange={onXml} style={{ display: "none" }} />
                <button onClick={() => xmlRef.current && xmlRef.current.click()}
                  style={{ width: "100%", background: C.bg, border: `1px dashed ${C.border}`, color: C.amber, borderRadius: 10, padding: "22px 12px", fontSize: 14, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace" }}>
                  ⬆  Upload a MusicXML file  (.musicxml / .xml)
                </button>
                <div style={{ fontSize: 11, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>
                  Reads <b>real</b> time signature, tuning &amp; rhythm straight from the file — no geometry guessing. Guitar Pro / MuseScore can export MusicXML (File → Export).
                </div>
                {xmlErr && <div style={{ marginTop: 10, color: C.red, fontSize: 12 }}>{xmlErr}</div>}
                {xmlScore && (
                  <ChartPanel score={xmlScore} title={xmlName}
                    meta={`${xmlScore.bars.length} bars · ${xmlScore.tuning} tuning · ${xmlScore.timeSig.join("/")}`}
                    C={C} useSharp={useSharp} overrides={overrides} setOverrides={setOverrides} selKey={selKey} onPick={pickChord} />
                )}
              </>
            )}
          </section>

          <section className="panel-rise" style={{ animationDelay: ".1s", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
            <SectionLabel C={C}>{mode !== "manual" && (selFrets || selMidis) ? "CHORD READOUT" : "LIVE READOUT"}</SectionLabel>
            <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "22px 16px", textAlign: "center", marginBottom: 14 }}>
              <div key={symbol} className="chord-pop" style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 54, lineHeight: 1, color: C.cyan, textShadow: `0 0 26px ${C.cyan}55` }}>{symbol}</div>
              {result && result.isSlash && <div style={{ marginTop: 8, fontSize: 11, letterSpacing: 2, color: C.red }}>SLASH CHORD · BASS ≠ ROOT</div>}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <Field C={C} k="ROOT" v={best ? names[best.root] : "—"} color={C.amber} />
              <Field C={C} k="QUALITY" v={best ? best.quality.name : "—"} />
              <Field C={C} k="BASS" v={norm.bassPc !== null ? names[norm.bassPc] : "—"} color={result && result.isSlash ? C.red : C.text} />
              <Field C={C} k="SUFFIX" v={best ? (best.quality.suffix || "(none)") : "—"} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 5 }}>
                <span>CONFIDENCE</span><span style={{ color: confColor }}>{best ? `${Math.round(conf * 100)}%` : "—"}{best && best.missing > 0 ? ` · missing ${best.missing}` : ""}{best && best.extra > 0 ? ` · +${best.extra} extra` : ""}</span>
              </div>
              <div style={{ height: 8, background: C.bg, borderRadius: 8, border: `1px solid ${C.border}`, overflow: "hidden" }}>
                <div style={{ width: `${conf * 100}%`, height: "100%", background: confColor, transition: "width .25s ease, background .25s ease" }} />
              </div>
            </div>

            <SectionLabel C={C}>CHROMA BITMASK · absolute (bit i = pitch-class i)</SectionLabel>
            <div style={{ fontSize: 13, color: C.dim, marginBottom: 6 }}>
              <span style={{ color: C.text }}>0b{toBinary12(norm.chordMask)}</span><span style={{ marginLeft: 8 }}>= {norm.chordMask}</span><span style={{ marginLeft: 8, fontSize: 11 }}>(MSB B → LSB C)</span>
            </div>
            <LedRow mask={norm.chordMask} labels={NOTE_SHARP} C={C} litColor={C.cyan} />

            {best && (
              <>
                <SectionLabel C={C} style={{ marginTop: 14 }}>ROOT-RELATIVE · matched intervals</SectionLabel>
                <div style={{ fontSize: 13, color: C.dim, marginBottom: 6 }}>
                  <span style={{ color: C.text }}>0b{toBinary12(best.transposed)}</span><span style={{ marginLeft: 8 }}>vs DB 0b{toBinary12(best.quality.mask)}</span>
                </div>
                <LedRow mask={best.transposed} labels={INTERVAL_LABELS} C={C} litColor={C.amber} dbMask={best.quality.mask} />
              </>
            )}

            {result && !result.single && (
              <>
                <SectionLabel C={C} style={{ marginTop: 16 }}>CANDIDATES</SectionLabel>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {result.candidates.map((c, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, background: C.bg, border: `1px solid ${i === 0 ? C.amber + "66" : C.border}`, borderRadius: 6, padding: "5px 10px" }}>
                      <span style={{ color: i === 0 ? C.text : C.dim }}>{names[c.root]}{c.quality.suffix}  <span style={{ color: C.dim }}>· {c.quality.name}</span></span>
                      <span style={{ color: C.dim }}>score {c.score.toFixed(2)} · {Math.round(c.confidence * 100)}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>

        <footer style={{ position: "relative", marginTop: 18, fontSize: 11, color: C.dim, lineHeight: 1.6 }}>
          Engine: pure JS · masks derived via makeMask() · rotateRight() for root candidates · ranking score (−0.8·extra, −1.2·missing), Jaccard confidence ·
          Path A: PDF.js text-position reconstruction (string / column / measure geometry) → same engine → one-chord-per-bar collapse.
        </footer>
      </div>
    </div>
  );
}

/* ---- chart panel: lead sheet / grid + inline editing + transpose + export --
 * Shared by the PDF (Path A) and MusicXML (Path C) modes — both pass a score of
 * the same shape, so the renderer, editor and exporters are identical. Edits are
 * lifted to the parent as an `overrides` map ("<bar>.<beat>" -> symbol) so they
 * survive view/transpose changes and feed straight into export. */
function ChartPanel({ score, title, meta, C, useSharp, overrides, setOverrides, selKey, onPick }) {
  const [view, setView] = useState("chart");
  const [editMode, setEditMode] = useState(false);
  const [editKey, setEditKey] = useState("");
  const [draft, setDraft] = useState("");
  const [semis, setSemis] = useState(0);
  const [exp, setExp] = useState(null); // null | { fmt, text }
  const [copied, setCopied] = useState(false);
  const [bpm, setBpm] = useState(score.tempo || 100);
  const [playing, setPlaying] = useState(false);
  const [playKey, setPlayKey] = useState("");
  const player = useRef(null);

  const [showRoman, setShowRoman] = useState(false);

  const tscore = useMemo(() => transposeScore(score, semis, useSharp), [score, semis, useSharp]);
  const key = useMemo(() => analyzeKey(tscore), [tscore]);

  useEffect(() => { setBpm(score.tempo || 100); }, [score.tempo]);
  const stopPlay = () => { if (player.current) { player.current.stop(); player.current = null; } setPlaying(false); setPlayKey(""); };
  useEffect(() => stopPlay, []); // stop on unmount
  useEffect(() => { stopPlay(); }, [score, semis]); // stop if the music changes underneath playback
  const togglePlay = () => {
    if (playing) { stopPlay(); return; }
    const ctl = playScore(tscore, bpm, { onEvent: setPlayKey, onEnd: () => { setPlaying(false); setPlayKey(""); player.current = null; } });
    if (!ctl) return; // no Web Audio
    player.current = ctl; setPlaying(true);
  };
  const bumpBpm = (d) => setBpm((b) => Math.max(40, Math.min(240, b + d)));
  const symOf = (bar, e) => { const v = overrides[`${bar.number}.${e.beat}`]; return v != null ? v : e.symbol; };
  const doExport = (fmt) => {
    const opts = { overrides, title, key, useSharp, tempo: bpm };
    const text = fmt === "abc" ? scoreToABC(tscore, opts) : fmt === "musicxml" ? scoreToMusicXML(tscore, opts) : scoreToChordPro(tscore, opts);
    setExp({ fmt, text }); setCopied(false);
  };
  const copy = () => { try { navigator.clipboard.writeText(exp.text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (_) {} };
  const bump = (d) => setSemis((s) => Math.max(-11, Math.min(11, s + d)));

  let prevSig = null;
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, fontSize: 11, color: C.dim, margin: "14px 0 6px" }}>
        <span style={{ color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{title}</span>
        <span>{meta}{semis ? ` · ${semis > 0 ? "+" : ""}${semis} st` : ""}{key ? ` · key ${keyName(key, useSharp)}` : ""}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {[["chart", "Chart"], ["grid", "Grid"]].map(([v, lbl]) => (
          <button key={v} onClick={() => setView(v)} style={{ ...chip(C), padding: "3px 9px", borderColor: view === v ? C.amber : C.border, color: view === v ? C.amber : C.dim }}>{lbl}</button>
        ))}
        <button onClick={() => { setEditMode((m) => !m); setEditKey(""); }} disabled={view !== "chart"}
          style={{ ...chip(C), padding: "3px 9px", opacity: view !== "chart" ? 0.4 : 1, borderColor: editMode ? C.green : C.border, color: editMode ? C.green : C.dim }}>{editMode ? "✓ Editing" : "✎ Edit"}</button>
        <button onClick={() => setShowRoman((r) => !r)} title={key ? `key of ${keyName(key, useSharp)}` : "key analysis"}
          style={{ ...chip(C), padding: "3px 9px", borderColor: showRoman ? C.cyan : C.border, color: showRoman ? C.cyan : C.dim }}>{showRoman ? "I·V·vi ✓" : "I·V·vi"}</button>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 2 }}>
          <button onClick={() => bump(-1)} style={{ ...chip(C), padding: "3px 8px" }}>−</button>
          <span style={{ fontSize: 11, minWidth: 44, textAlign: "center", color: semis ? C.amber : C.dim }}>transpose</span>
          <button onClick={() => bump(1)} style={{ ...chip(C), padding: "3px 8px" }}>+</button>
          {semis !== 0 && <button onClick={() => setSemis(0)} style={{ ...chip(C), padding: "3px 8px" }}>0</button>}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 2 }}>
          <button onClick={togglePlay} title={playing ? "stop" : "play the chart"}
            style={{ ...chip(C), padding: "3px 10px", borderColor: playing ? C.green : C.border, color: playing ? C.green : C.amber }}>{playing ? "■ Stop" : "▶ Play"}</button>
          <button onClick={() => bumpBpm(-5)} style={{ ...chip(C), padding: "3px 8px" }}>−</button>
          <span style={{ fontSize: 11, minWidth: 46, textAlign: "center", color: C.dim }}>♩={bpm}</span>
          <button onClick={() => bumpBpm(5)} style={{ ...chip(C), padding: "3px 8px" }}>+</button>
        </span>
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4 }}>
          {[["chordpro", "ChordPro"], ["abc", "ABC"], ["musicxml", "MusicXML"]].map(([f, lbl]) => (
            <button key={f} onClick={() => doExport(f)} style={{ ...chip(C), padding: "3px 9px", borderColor: exp && exp.fmt === f ? C.cyan : C.border, color: exp && exp.fmt === f ? C.cyan : C.dim }}>{lbl}</button>
          ))}
        </span>
      </div>

      {view === "chart" ? (
        <>
          <div className="tdp-scroll" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(146px, 1fr))", gap: "10px 0", maxHeight: 420, overflow: "auto", paddingRight: 4 }}>
            {tscore.bars.map((bar) => {
              const sig = bar.timeSig || tscore.timeSig;
              const sigChanged = !prevSig || prevSig[0] !== sig[0] || prevSig[1] !== sig[1];
              prevSig = sig;
              return (
                <div key={bar.number} style={{ position: "relative", borderLeft: `2px solid ${C.border}`, padding: "16px 8px 6px 10px", minHeight: 44 }}>
                  <span style={{ position: "absolute", top: 2, left: 10, fontSize: 9, color: C.dim }}>{bar.number}</span>
                  {sigChanged && <span style={{ position: "absolute", top: 2, right: 6, fontSize: 9, color: C.amber }}>{sig.join("/")}</span>}
                  <div style={{ display: "grid", gridTemplateColumns: `repeat(${sig[0]}, 1fr)`, alignItems: "center", columnGap: 2, minHeight: 24 }}>
                    {bar.events.map((e, i) => {
                      const k = `${bar.number}.${e.beat}`;
                      const cur = symOf(bar, e);
                      const edited = overrides[k] != null;
                      const gridCol = `${e.beat + 1} / span ${Math.max(1, e.durBeats)}`;
                      if (editMode && editKey === k) {
                        const commit = () => { const v = draft.trim(); setOverrides((o) => { const n = { ...o }; if (!v || v === e.symbol) delete n[k]; else n[k] = v; return n; }); setEditKey(""); };
                        return (
                          <input key={i} autoFocus value={draft} onChange={(ev) => setDraft(ev.target.value)} onBlur={commit}
                            onKeyDown={(ev) => { if (ev.key === "Enter") commit(); if (ev.key === "Escape") setEditKey(""); }}
                            style={{ gridColumn: gridCol, width: "100%", boxSizing: "border-box", background: C.bg, color: C.amber, border: `1px solid ${C.amber}`, borderRadius: 4, padding: "1px 3px", font: "700 14px 'Space Mono', monospace" }} />
                        );
                      }
                      const isSel = selKey === k;
                      const isPlaying = playKey === k;
                      return (
                        <button key={i} onClick={() => (editMode ? (setEditKey(k), setDraft(cur)) : onPick(k, e))} title={editMode ? "click to re-label" : `beat ${e.beat + 1}`}
                          style={{ gridColumn: gridCol, justifySelf: "start", textAlign: "left", background: isPlaying ? `${C.green}22` : "transparent", borderRadius: 4, border: "none", borderBottom: isSel ? `2px solid ${C.amber}` : "2px solid transparent", padding: "0 2px", cursor: "pointer", color: isPlaying ? C.green : edited ? C.green : isSel ? C.amber : C.cyan, fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: cur.length > 4 ? 13 : 16, lineHeight: 1.2, transition: "background .1s, color .1s" }}>
                          <span style={{ display: "block" }}>{cur}{edited ? "*" : ""}</span>
                          {showRoman && key && <span style={{ display: "block", fontSize: 9, fontWeight: 400, color: C.dim, marginTop: 1 }}>{romanFor(cur, key)}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 8 }}>
            {editMode ? "Edit mode · click a chord to re-label it (blank = revert to detected). * marks edits." : "Lead sheet · chords sit on the beat they change. Tap a chord to inspect its voicing →"}
          </div>
        </>
      ) : (
        <>
          <div className="tdp-scroll" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(74px, 1fr))", gap: 6, maxHeight: 420, overflow: "auto", paddingRight: 4 }}>
            {tscore.bars.map((bar) => {
              const collapsed = bar.events.map((e) => symOf(bar, e));
              const k = `${bar.number}`;
              const isSel = selKey === k;
              return (
                <button key={k} className="meas" onClick={() => onPick(k, bar.events[0] || {})}
                  style={{ position: "relative", background: C.bg, border: `1px solid ${isSel ? C.amber : C.border}`, borderRadius: 8, padding: "10px 4px 8px", cursor: "pointer", minHeight: 56, textAlign: "center" }}>
                  <span style={{ position: "absolute", top: 3, left: 6, fontSize: 9, color: C.dim }}>{bar.number}</span>
                  <div style={{ marginTop: 6, fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: collapsed.join(" ").length > 6 ? 13 : 17, color: C.cyan, lineHeight: 1.15 }}>{collapsed.join(" ")}</div>
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 8 }}>Tap any bar to inspect its voicing in the readout →</div>
        </>
      )}

      {exp && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 10, letterSpacing: 2, color: C.dim }}>EXPORT · {exp.fmt === "abc" ? "ABC NOTATION" : exp.fmt === "musicxml" ? "MUSICXML" : "CHORDPRO"}</span>
            <span style={{ display: "inline-flex", gap: 6 }}>
              <button onClick={copy} style={{ ...chip(C), padding: "3px 9px", borderColor: copied ? C.green : C.border, color: copied ? C.green : C.dim }}>{copied ? "copied ✓" : "copy"}</button>
              <button onClick={() => setExp(null)} style={{ ...chip(C), padding: "3px 9px" }}>close</button>
            </span>
          </div>
          <textarea readOnly value={exp.text} spellCheck={false} className="tdp-scroll"
            style={{ width: "100%", height: 120, resize: "vertical", boxSizing: "border-box", background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, fontSize: 12, lineHeight: 1.5, fontFamily: "'IBM Plex Mono', monospace", outline: "none" }} />
          {exp.fmt === "abc" && <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>Real, playable notes + chord symbols — paste into any ABC player (e.g. abcjs / editor at abcnotation.com) to hear it.</div>}
          {exp.fmt === "musicxml" && <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>Save as <b>.musicxml</b> and open in MuseScore / Guitar Pro — carries chord symbols + notes + meter. Round-trips back into this app.</div>}
        </div>
      )}
    </>
  );
}

/* ---- presentational helpers ---------------------------------------------- */
function SectionLabel({ children, C, style }) { return <div style={{ fontSize: 10, letterSpacing: 2.5, color: C.dim, margin: "0 0 8px", ...style }}>{children}</div>; }
function Control({ label, children, C }) { return (<div><div style={{ fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 5 }}>{label}</div>{children}</div>); }
function Field({ k, v, C, color }) {
  return (<div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 10px" }}>
    <div style={{ fontSize: 9, letterSpacing: 2, color: C.dim }}>{k}</div>
    <div style={{ fontSize: 18, color: color || C.text, marginTop: 2 }}>{v}</div></div>);
}
function LedRow({ mask, labels, C, litColor, dbMask }) {
  return (<div style={{ display: "grid", gridTemplateColumns: "repeat(12,1fr)", gap: 4 }}>
    {Array.from({ length: 12 }).map((_, i) => {
      const lit = (mask >> i) & 1;
      const inDb = dbMask !== undefined ? (dbMask >> i) & 1 : null;
      const missing = inDb && !lit, extra = inDb === 0 && lit;
      const bg = lit ? litColor : missing ? "transparent" : C.bg;
      const border = missing ? `1px dashed ${C.red}` : extra ? `1px solid ${C.red}` : `1px solid ${C.border}`;
      return (<div key={i} className="led" style={{ textAlign: "center" }}>
        <div style={{ height: 22, borderRadius: 4, background: bg, border, boxShadow: lit ? `0 0 10px ${litColor}88` : "none" }} />
        <div style={{ fontSize: 9, color: lit ? litColor : missing ? C.red : C.dim, marginTop: 3 }}>{labels[i]}</div></div>);
    })}
  </div>);
}

/* ---- inline style atoms --------------------------------------------------- */
const chip = (C) => ({ background: C.bg, border: `1px solid ${C.border}`, color: C.dim, borderRadius: 999, padding: "4px 10px", fontSize: 11, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace" });
const toggle = (C) => ({ flex: 1, background: C.bg, border: `1px solid ${C.border}`, color: C.dim, borderRadius: 6, padding: "7px 4px", fontSize: 12, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace" });
const activeToggle = (C) => ({ borderColor: C.amber, color: C.amber, boxShadow: `inset 0 0 12px ${C.amber}22` });
const stepper = (C) => ({ width: 30, background: C.bg, border: `1px solid ${C.border}`, color: C.text, borderRadius: 6, padding: "6px 0", fontSize: 14, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace" });
