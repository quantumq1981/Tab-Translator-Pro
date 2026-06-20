/* ============================================================================
 *  TAB DECODER · TabTranslator Pro — RECOGNITION ENGINE (pure module)
 *
 *  Extracted verbatim from TabDecoderPro.tsx (Roadmap Wave 1 #1). This file is
 *  pure ES — zero React, zero browser globals (the only browser seam,
 *  extractTokens via window.pdfjsLib, stays in the UI file). That purity is what
 *  lets the headless harness import it directly in Node AND lets a Web Worker
 *  run the full "raw bytes -> score" pipeline off the main thread (Wave 1 #3).
 *
 *  DO NOT add React/DOM/browser dependencies here. See CLAUDE.md invariants.
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
// Family enharmonic DEFAULT (always): Bb, C#, Eb, F#, Ab — never A#/Db/D#/Gb/G#.
// This is the default spelling (useSharp=true); NOTE_FLAT is the explicit all-flats override.
const NOTE_SHARP = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
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
  // Extended/altered qualities (rank high = uncommon → never win a ranking tie over
  // a plainer chord; they only win when they genuinely fit MORE of the voicing).
  { name: "Add 9",          suffix: "add9",  intervals: [0, 2, 4, 7],      rank: 15 },
  { name: "Minor-major 7",  suffix: "m(maj7)", intervals: [0, 3, 7, 11],   rank: 16 },
  { name: "6/9",            suffix: "6/9",   intervals: [0, 2, 4, 7, 9],   rank: 17 },
  { name: "Dominant 9th",   suffix: "9",     intervals: [0, 2, 4, 7, 10],  rank: 18 },
  { name: "Minor 9th",      suffix: "m9",    intervals: [0, 2, 3, 7, 10],  rank: 19 },
  { name: "Major 9th",      suffix: "maj9",  intervals: [0, 2, 4, 7, 11],  rank: 20 },
  { name: "7♭9",            suffix: "7♭9",   intervals: [0, 1, 4, 7, 10],  rank: 21 },
  { name: "7♯9",            suffix: "7♯9",   intervals: [0, 3, 4, 7, 10],  rank: 22 },
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
  // A single-note block is just that note — return the bare name (e.g. "E"), NOT
  // "E (single)". The annotation used to be baked into the symbol STRING, which
  // then flowed verbatim into every exporter (ABC/MusicXML/CSMPN) and the chart
  // label as spurious noise (`"E (single)"[E,,]/2`). The single-note fact is
  // carried by the `result.single` FLAG instead (the readout panel reads it to
  // hide chord-quality details), so dropping the suffix here cleans every consumer
  // at the single source without touching recognition logic or QUALITIES.
  if (result.single) return names[result.roots];
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
    // A staff system = a run of evenly-spaced string lines. Sparse systems (a
    // melodic line that only touches a few strings) can show as few as 3 lines,
    // so accept >=3; header/measure-number rows are single lines (excluded) and
    // sit in their own group (split by sysGap), so they don't slip through.
    const staves = groups.filter((g) => g.length >= 3).map((g) => ({ topY: Math.min(...g), botY: Math.max(...g) }));

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
/* True (un-quantised) onset + duration in beats, kept ALONGSIDE the integer
 * beat/durBeats (which the chord-grid chart view needs for CSS-grid placement).
 * `qbeat`/`qdur` carry the real timing so ABC export and playback are accurate
 * for dense melodic lines — where rounding several onsets to the same integer
 * beat would otherwise make durBeats = 0 (invalid ABC) and stack notes in time.
 * `qbeat` must already be set per event; `qdur` is always > 0. */
function _fillTrueDur(events, beats) {
  events.forEach((e, i) => { e.qdur = Math.max(1e-4, (i + 1 < events.length ? events[i + 1].qbeat : beats) - e.qbeat); });
}
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
      const b = i === 0 ? 0                                 // bar's first chord = downbeat
        : haveExt ? ((e.x - m.startX) / width) * beatsPerBar
        : i;                                               // no geometry → just sequence
      e.qbeat = Math.max(0, b);                            // true fractional position
      e.beat = Math.max(0, Math.min(beatsPerBar - 1, Math.round(b)));
    });
    for (let i = 1; i < events.length; i++)                // keep beats strictly increasing
      if (events[i].beat <= events[i - 1].beat)
        events[i].beat = Math.min(beatsPerBar - 1, events[i - 1].beat + 1);
    events.forEach((e, i) => { e.durBeats = (i + 1 < events.length ? events[i + 1].beat : beatsPerBar) - e.beat; });
    _fillTrueDur(events, beatsPerBar);
    return { number: m.number, events: events.map(({ x, ...e }) => e) };
  });
  return { timeSig: [beatsPerBar, 4], bars };
}

/* ---- simplify: aggregate each bar's notes into one best-fit chord ----------
 * For dense transcriptions (melody + harmony) the per-onset chart is noise. This
 * collapses every bar to a single chord by weighting each pitch class by the
 * total duration it sounds (so sustained/structural tones beat brief passing
 * notes) and keeping the strong ones, then running that chroma + the bar's bass
 * through the same engine. Output is the same score shape (one event/bar), so it
 * flows through render / transpose / playback / export unchanged. Opt-in — the
 * detailed per-onset path is untouched (Blue Sky stays as-is). ---------------- */
function simplifyScore(score, useSharp) {
  const bars = score.bars.map((bar) => {
    const sig = bar.timeSig || score.timeSig;
    const mk = { section: bar.section, repeatStart: bar.repeatStart, repeatEnd: bar.repeatEnd, ending: bar.ending }; // carry markers
    const pcW = new Array(12).fill(0);
    let any = false;
    for (const e of bar.events) {
      const w = Math.max(0.25, e.durBeats || 1);
      for (const m of e.midis || []) { pcW[m % 12] += w; any = true; }
    }
    if (!any) return { number: bar.number, timeSig: bar.timeSig, ...mk, events: [] };
    const maxW = Math.max(...pcW);
    const chroma = [];
    for (let pc = 0; pc < 12; pc++) if (pcW[pc] >= maxW * 0.2) chroma.push(pc); // drop weak passing tones
    // bass = lowest note that is a *structural* tone (kept pc), so a brief low
    // melody/passing note doesn't manufacture a spurious slash chord.
    let bassMidi = Infinity;
    for (const e of bar.events) for (const m of e.midis || []) if (pcW[m % 12] >= maxW * 0.2 && m < bassMidi) bassMidi = m;
    const result = recognise(chroma, makeMask(chroma), bassMidi % 12);
    const symbol = symbolOf(result, useSharp);
    let midis;                                            // clean voicing for playback/export
    if (result && !result.single && result.best) {
      const rootMidi = 48 + result.best.root;
      midis = result.best.quality.intervals.map((i) => rootMidi + i);
      if (result.isSlash) midis = [36 + result.bassPc, ...midis];
    } else midis = bassMidi === Infinity ? [] : [bassMidi];
    return { number: bar.number, timeSig: bar.timeSig, ...mk, events: [{ symbol, beat: 0, durBeats: sig[0], midis, frets: undefined }] };
  });
  return { ...score, bars, simplified: true };
}

/* ---- arrange: procedural rhythm generator (Roadmap Wave 2 #8) --------------
 * Turns a recognised HARMONIC chart (chords on their beats) into a rhythmic
 * ARRANGEMENT by stamping a comping/strum template across each bar — each hit
 * carries the chord SOUNDING at that position (so multi-chord bars keep their
 * changes). Pure + deterministic, no model — templates are fixed patterns. The
 * output is the SAME score shape every parser emits, so it flows untouched
 * through the exporters (CSMPN/CSML {hybrid} rhythm, MIDI, ABC), playback,
 * transpose and key analysis — zero new plumbing.
 *
 * Templates are per-beat sub-patterns (→ meter-independent; `tup` flags a tuplet
 * so the {hybrid}/CSMPN export draws the bracket). `block` is special-cased:
 * it keeps the existing onsets (the harmonic rhythm) — a clean sustain.
 *   block · quarters · eighths · shuffle (swung eighths) · sixteenths · skank (reggae off-beat)
 * HONEST LIMIT: CSMP's {hybrid} grid is eighth-resolution, so `sixteenths` round-trips
 * lossily into CSMPN/CSML slash-rhythm (positions collapse) — but the SCORE itself
 * (qbeat/qdur) is exact, so MIDI / ABC / playback render all 16ths faithfully.
 * `template` may be a name or `{ template }`; unknown name → passthrough. */
const ARRANGE_TEMPLATES = {
  block: null,                                                   // keep existing onsets
  quarters: [{ at: 0, dur: 1, tup: 0 }],                         // one strum per beat
  eighths: [{ at: 0, dur: 0.5, tup: 0 }, { at: 0.5, dur: 0.5, tup: 0 }],
  shuffle: [{ at: 0, dur: 2 / 3, tup: 3 }, { at: 2 / 3, dur: 1 / 3, tup: 3 }], // long-short swing
  sixteenths: [{ at: 0, dur: 0.25, tup: 0 }, { at: 0.25, dur: 0.25, tup: 0 }, { at: 0.5, dur: 0.25, tup: 0 }, { at: 0.75, dur: 0.25, tup: 0 }],
  skank: [{ at: 0.5, dur: 0.5, tup: 0 }],                        // reggae/ska: chord on the off-beat only
};
function arrangeScore(score, template = "quarters") {
  const name = (template && typeof template === "object" ? template.template : template) || "quarters";
  if (!(name in ARRANGE_TEMPLATES)) return score;               // unknown → never throw, passthrough
  const pat = ARRANGE_TEMPLATES[name];
  const bars = (score.bars || []).map((bar) => {
    const sig = bar.timeSig || score.timeSig || [4, 4];
    const beats = sig[0];
    const mk = { section: bar.section, repeatStart: bar.repeatStart, repeatEnd: bar.repeatEnd, ending: bar.ending };
    const src = (bar.events || []).map((e) => ({ ...e, _q: e.qbeat != null ? e.qbeat : e.beat })).sort((a, b) => a._q - b._q);
    if (!src.length) return { number: bar.number, timeSig: bar.timeSig, ...mk, events: [] };
    const chordAt = (pos) => { let c = src[0]; for (const e of src) { if (e._q <= pos + 1e-6) c = e; else break; } return c; };
    let onsets;
    if (pat === null) onsets = src.map((e) => ({ q: e._q, tup: e.tuplet || 0, src: e }));
    else { onsets = []; for (let b = 0; b < beats; b++) for (const h of pat) { const q = b + h.at; if (q < beats - 1e-6) onsets.push({ q, tup: h.tup, src: chordAt(q) }); } }
    const events = onsets.map((o) => ({
      symbol: o.src.symbol, midis: o.src.midis ? [...o.src.midis] : [], frets: o.src.frets,
      tuplet: o.tup || 0, qbeat: o.q, beat: Math.max(0, Math.min(beats - 1, Math.round(o.q))),
    }));
    for (let i = 1; i < events.length; i++) if (events[i].beat <= events[i - 1].beat) events[i].beat = Math.min(beats - 1, events[i - 1].beat + 1);
    events.forEach((e, i) => { e.durBeats = (i + 1 < events.length ? events[i + 1].beat : beats) - e.beat; });
    _fillTrueDur(events, beats);                                 // true qbeat/qdur for {hybrid}/ABC/playback/MIDI
    return { number: bar.number, timeSig: bar.timeSig, ...mk, events };
  });
  return { ...score, bars, arrangedAs: name };
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
function parseMusicXML(xml, useSharp = true, partIndex = 0) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (_xEls(doc, "parsererror").length) throw new Error("Not valid XML.");
  const partEls = _xEls(doc, "part");
  if (!partEls.length) throw new Error("No <part> found — is this a MusicXML score?");
  // instrument names from <part-list>, in document order, for the part picker
  const nameById = {};
  _xEls(doc, "score-part").forEach((sp) => { nameById[sp.getAttribute("id")] = _xChildText(sp, "part-name") || sp.getAttribute("id"); });
  const parts = partEls.map((pe, i) => ({ index: i, id: pe.getAttribute("id"), name: nameById[pe.getAttribute("id")] || `Part ${i + 1}` }));
  const idx = Math.max(0, Math.min(partEls.length - 1, partIndex | 0));
  const part = partEls[idx];

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
        const tm = _xFirst(node, "time-modification"); let tup = 0; if (tm) { const an = parseInt(_xChildText(tm, "actual-notes") || "0", 10); if (an > 1) tup = an; }
        if (!onsets.has(onset)) onsets.set(onset, { midis: [], frets: {}, tuplet: tup });
        const o = onsets.get(onset); o.midis.push(midi); if (eng != null && o.frets[eng] === undefined) o.frets[eng] = fret;
      } else if (tag === "backup") { cursor -= parseInt(_xChildText(node, "duration") || "0", 10) || 0; }
      else if (tag === "forward") { cursor += parseInt(_xChildText(node, "duration") || "0", 10) || 0; }
    }
    const divPerBeat = (divisions * 4) / beatType || divisions;
    const raw = [...onsets.entries()].sort((a, b2) => a[0] - b2[0]).map(([onset, o]) => ({
      symbol: symbolForMidis(o.midis, useSharp), midis: [...o.midis].sort((a, b2) => a - b2), frets: o.frets, tuplet: o.tuplet || 0, onset,
    }));
    const events = [];
    raw.forEach((e) => { const last = events[events.length - 1]; if (!last || last.symbol !== e.symbol) events.push(e); });
    events.forEach((e) => { e.qbeat = e.onset / divPerBeat; e.beat = Math.max(0, Math.min(beats - 1, Math.round(e.qbeat))); });
    for (let i = 1; i < events.length; i++) if (events[i].beat <= events[i - 1].beat) events[i].beat = Math.min(beats - 1, events[i - 1].beat + 1);
    events.forEach((e, i) => { e.durBeats = (i + 1 < events.length ? events[i + 1].beat : beats) - e.beat; });
    _fillTrueDur(events, beats);
    const number = parseInt(measure.getAttribute("number") || String(mi + 1), 10);
    // section/repeat/ending markers: <rehearsal> text, <barline><repeat>/<ending>
    const reh = _xFirst(measure, "rehearsal");
    const section = (reh && _xText(reh).trim()) || "";
    let repeatStart = false, repeatEnd = false, ending = null;
    _xEls(measure, "barline").forEach((bl) => {
      const rep = _xFirst(bl, "repeat"); const dir = rep && rep.getAttribute("direction");
      if (dir === "forward") repeatStart = true; else if (dir === "backward") repeatEnd = true;
      const end = _xFirst(bl, "ending"); const n = end && end.getAttribute("number");
      if (end && (end.getAttribute("type") === "start") && n) ending = String(n).split(/[,\s]+/)[0];
    });
    bars.push({ number, timeSig: [beats, beatType], section: section || undefined, repeatStart, repeatEnd, ending, events: events.map(({ onset, ...e }) => e) });
  });
  // tempo: <sound tempo="…"> if present, else a <metronome> per-minute (assume
  // it's a quarter-note BPM). null → callers default (e.g. 100 for playback).
  let tempo = null;
  const sound = _xEls(doc, "sound").find((s) => s.getAttribute("tempo"));
  if (sound) { const v = parseFloat(sound.getAttribute("tempo")); if (!isNaN(v)) tempo = v; }
  if (tempo == null) { const pm = _xFirst(doc, "per-minute"); if (pm) { const v = parseFloat(_xText(pm)); if (!isNaN(v)) tempo = v; } }
  return { source: "musicxml", timeSig: bars.length ? bars[0].timeSig : [beats, beatType], tuning: _tuningName(tuning), tempo, bars, parts, partIndex: idx };
}

/* ===========================================================================
 *  PATH D — Guitar Pro (GP7 / GP8 `.gp`) import
 *  --------------------------------------------------------------------------
 *  A `.gp` file is a plain ZIP whose `Content/score.gpif` is an XML document —
 *  so this is parseable with ZERO new dependencies: the ZIP is inflated with
 *  the platform's native `DecompressionStream('deflate-raw')` (present in the
 *  browser and Node ≥18) and the XML read with the same `DOMParser` Path C uses.
 *
 *  gpif is a flat list of elements joined by id references, not nested like
 *  MusicXML:  MasterBar.Bars[track] → Bar.Voices → Voice.Beats → Beat
 *  → { Rhythm ref, Notes ids } ; Note carries a direct
 *  `<Property name="Midi"><Number>` (so no pitch math) plus String/Fret. We
 *  resolve the id graph, accumulate each voice's onsets from a Rhythm-derived
 *  duration, run each onset's MIDI through the same engine, and emit the SAME
 *  score shape as buildScore / parseMusicXML — so the chart, exporters,
 *  transpose, key analysis and playback are all shared for free.
 *
 *  Older formats (GP3/4/5 binary, GPX binary filesystem, Power Tab) are NOT
 *  parsed here — they need binary readers / a dependency; the honest route for
 *  those stays "open in TuxGuitar/MuseScore → export MusicXML" (Path C).
 * ==========================================================================*/
const _GP_NV = { Whole: 4, Half: 2, Quarter: 1, Eighth: 0.5, "16th": 0.25, "32nd": 0.125, "64th": 0.0625, "128th": 0.03125 };
const _gpProp = (el, name) => _xEls(el, "Property").find((p) => p.getAttribute("name") === name) || null;
const _gpById = (doc, tag) => { const m = new Map(); _xEls(doc, tag).forEach((e) => { const id = e.getAttribute("id"); if (id != null) m.set(id, e); }); return m; };
const _gpIds = (txt) => (txt || "").trim().split(/\s+/).filter((s) => s.length);
function _gpRhythmQuarters(r) {
  if (!r) return 1;
  let q = _GP_NV[_xChildText(r, "NoteValue")]; if (q == null) q = 1;
  const dot = _xFirst(r, "AugmentationDot"); if (dot) { const c = parseInt(dot.getAttribute("count") || "1", 10); q *= c >= 2 ? 1.75 : 1.5; }
  const tup = _xFirst(r, "PrimaryTuplet"); if (tup) { const n = parseInt(tup.getAttribute("num") || "0", 10), d = parseInt(tup.getAttribute("den") || "0", 10); if (n > 0 && d > 0) q *= d / n; }
  return q;
}
/* Tuplet group size (num) of a Rhythm, or 0 — for the {hybrid} `tN` flag. */
function _gpRhythmTuplet(r) {
  const tup = r && _xFirst(r, "PrimaryTuplet"); if (!tup) return 0;
  const n = parseInt(tup.getAttribute("num") || "0", 10);
  return n > 1 ? n : 0;
}
function _gpNoteMidi(note) {
  const me = _gpProp(note, "Midi"); const n = me ? parseInt(_xChildText(me, "Number"), 10) : NaN;
  if (!isNaN(n)) return n;
  const pe = _gpProp(note, "ConcertPitch") || _gpProp(note, "TransposedPitch");
  const p = pe && _xFirst(pe, "Pitch");
  if (p) { const step = _xChildText(p, "Step"); const acc = _xChildText(p, "Accidental"); const oct = parseInt(_xChildText(p, "Octave") || "0", 10); if (step in STEP_SEMI) return oct * 12 + STEP_SEMI[step] + (acc === "#" ? 1 : acc === "b" ? -1 : 0); }
  // GP6 piano/concert parts encode pitch as Tone(<Step> = chromatic 0–11) + Octave(<Number>)
  const toneEl = _gpProp(note, "Tone"), octEl = _gpProp(note, "Octave");
  if (toneEl && octEl) { const step = parseInt(_xChildText(toneEl, "Step"), 10), oct = parseInt(_xChildText(octEl, "Number"), 10); if (!isNaN(step) && !isNaN(oct)) return oct * 12 + step; }
  return null;
}
function parseGPIF(xml, useSharp = true, partIndex = 0) {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (_xEls(doc, "parsererror").length) throw new Error("Not valid gpif XML.");
  const tracks = _xEls(doc, "Track").filter((t) => t.getAttribute("id") != null);
  if (!tracks.length) throw new Error("No <Track> found — is this a GP7/8 .gp file?");
  const parts = tracks.map((t, i) => ({ index: i, id: t.getAttribute("id"), name: (_xChildText(t, "Name") || `Track ${i + 1}`).trim() || `Track ${i + 1}` }));
  const idx = Math.max(0, Math.min(tracks.length - 1, partIndex | 0));

  const barMap = _gpById(doc, "Bar"), voiceMap = _gpById(doc, "Voice"), beatMap = _gpById(doc, "Beat"), noteMap = _gpById(doc, "Note"), rhythmMap = _gpById(doc, "Rhythm");
  // tuning of the chosen track (display only — MIDI is read directly per note)
  let tuning = null;
  const tunProp = _gpProp(tracks[idx], "Tuning") || (_xFirst(tracks[idx], "Staff") && _gpProp(_xFirst(tracks[idx], "Staff"), "Tuning"));
  if (tunProp) { const pit = _gpIds(_xChildText(tunProp, "Pitches")).map(Number); if (pit.length === 6 && pit.every((v) => !isNaN(v))) tuning = pit; } // gpif lists low→high (String 0 = low E)

  const bars = [];
  let lastSig = [4, 4];
  _xEls(doc, "MasterBar").forEach((mb, mi) => {
    const tt = _xChildText(mb, "Time");
    if (tt && /^\d+\/\d+$/.test(tt)) lastSig = tt.split("/").map((n) => parseInt(n, 10));
    const [bts, btype] = lastSig;
    // section/repeat/ending markers the gpif carries but we used to ignore
    const secEl = _xFirst(mb, "Section");
    const section = (secEl && (_xChildText(secEl, "Text") || "").trim()) || "";
    const repEl = _xFirst(mb, "Repeat");
    const repeatStart = !!(repEl && repEl.getAttribute("start") === "true");
    const repeatEnd = !!(repEl && repEl.getAttribute("end") === "true");
    const altTxt = (_xChildText(mb, "AlternateEndings") || "").trim();
    const ending = altTxt ? altTxt.split(/\s+/)[0] : null;
    const barIds = _gpIds(_xChildText(mb, "Bars"));
    const bar = barMap.get(barIds[idx]);
    const onsets = new Map(); // onsetQuarters -> { midis:[], frets:{} }
    if (bar) {
      _gpIds(_xChildText(bar, "Voices")).filter((v) => v !== "-1").forEach((vId) => {
        const voice = voiceMap.get(vId); if (!voice) return;
        let cursor = 0;
        _gpIds(_xChildText(voice, "Beats")).forEach((beatId) => {
          const beat = beatMap.get(beatId); if (!beat) return;
          const rRef = _xFirst(beat, "Rhythm"); const rEl = rRef && rhythmMap.get(rRef.getAttribute("ref")); const q = _gpRhythmQuarters(rEl); const tup = _gpRhythmTuplet(rEl);
          const noteIds = _gpIds(_xText(_xFirst(beat, "Notes")));
          if (noteIds.length) {
            if (!onsets.has(cursor)) onsets.set(cursor, { midis: [], frets: {}, tuplet: tup });
            const o = onsets.get(cursor);
            noteIds.forEach((nId) => {
              const note = noteMap.get(nId); if (!note) return;
              const sEl = _gpProp(note, "String"), fEl = _gpProp(note, "Fret");
              let s = null, f = null;
              if (sEl && fEl) { s = parseInt(_xChildText(sEl, "String"), 10), f = parseInt(_xChildText(fEl, "Fret"), 10); if (isNaN(s) || isNaN(f)) s = f = null; }
              // GP7/8 carry a direct <Midi>; GP6 gpif carries only String+Fret, so
              // fall back to tuning+fret (String 0 = low E, tuning low→high).
              let midi = _gpNoteMidi(note);
              if (midi == null && s != null) { const tun = tuning || TUNINGS.Standard; if (s >= 0 && s < tun.length) midi = tun[s] + f; }
              if (midi == null) return;
              o.midis.push(midi);
              if (s != null && s >= 0 && s <= 5 && o.frets[s] === undefined) o.frets[s] = f;
            });
          }
          cursor += q;
        });
      });
    }
    const qPerBeat = 4 / btype; // a "beat" = one 1/beatType note
    const raw = [...onsets.entries()].filter(([, o]) => o.midis.length).sort((a, b) => a[0] - b[0])
      .map(([onset, o]) => ({ symbol: symbolForMidis(o.midis, useSharp), midis: [...o.midis].sort((a, b) => a - b), frets: o.frets, tuplet: o.tuplet || 0, onset }));
    const events = [];
    raw.forEach((e) => { const last = events[events.length - 1]; if (!last || last.symbol !== e.symbol) events.push(e); });
    events.forEach((e) => { e.qbeat = e.onset / qPerBeat; e.beat = Math.max(0, Math.min(bts - 1, Math.round(e.qbeat))); });
    for (let i = 1; i < events.length; i++) if (events[i].beat <= events[i - 1].beat) events[i].beat = Math.min(bts - 1, events[i - 1].beat + 1);
    events.forEach((e, i) => { e.durBeats = (i + 1 < events.length ? events[i + 1].beat : bts) - e.beat; });
    _fillTrueDur(events, bts);
    bars.push({ number: mi + 1, timeSig: [bts, btype], section: section || undefined, repeatStart, repeatEnd, ending, events: events.map(({ onset, ...e }) => e) });
  });

  // tempo: first <Automation><Type>Tempo</Type> … <Value>BPM ref</Value>
  let tempo = null;
  const tAuto = _xEls(doc, "Automation").find((a) => _xChildText(a, "Type") === "Tempo");
  if (tAuto) { const v = parseFloat((_xChildText(tAuto, "Value") || "").split(/\s+/)[0]); if (!isNaN(v)) tempo = v; }
  return { source: "gp", timeSig: bars.length ? bars[0].timeSig : lastSig, tuning: _tuningName(tuning), tempo, bars, parts, partIndex: idx };
}

/* Inflate a `.gp` (GP7/8) ZIP and return its Content/score.gpif XML text.
 * Minimal central-directory ZIP reader + native deflate-raw — zero deps. */
async function gpUnzip(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eo = -1;
  for (let i = u8.length - 22; i >= 0 && i >= u8.length - 22 - 65536; i--) if (dv.getUint32(i, true) === 0x06054b50) { eo = i; break; }
  if (eo < 0) throw new Error("Not a .gp file (no ZIP directory).");
  const cdOff = dv.getUint32(eo + 16, true), cdCount = dv.getUint16(eo + 10, true);
  let p = cdOff, target = null;
  for (let n = 0; n < cdCount && dv.getUint32(p, true) === 0x02014b50; n++) {
    const method = dv.getUint16(p + 10, true), compSize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const lhOff = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    if (name.endsWith("score.gpif")) { target = { method, compSize, lhOff }; break; }
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!target) throw new Error("No score.gpif inside — is this a GP7/8 .gp file? (Older .gp3/4/5/.gpx are binary; export MusicXML instead.)");
  const lh = target.lhOff;
  if (dv.getUint32(lh, true) !== 0x04034b50) throw new Error("Corrupt .gp (bad local header).");
  const dataStart = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
  const comp = u8.subarray(dataStart, dataStart + target.compSize);
  if (target.method === 0) return new TextDecoder("utf-8").decode(comp);
  const stream = new Response(comp).body.pipeThrough(new DecompressionStream("deflate-raw"));
  return new TextDecoder("utf-8").decode(new Uint8Array(await new Response(stream).arrayBuffer()));
}
async function parseGP(buf, useSharp = true, partIndex = 0) { return parseGPIF(await gpUnzip(buf), useSharp, partIndex); }

/* ===========================================================================
 *  PATH E — Guitar Pro 3 / 4 / 5 (legacy BINARY formats)
 *  --------------------------------------------------------------------------
 *  Unlike GP7/8 (Path D, a ZIP of XML), GP3/4/5 are monolithic little-endian
 *  binary. This is a faithful, zero-dependency port of the documented reading
 *  order (verified against PyGuitarPro on the real corpus): every effect/chord/
 *  mix-table block is fully consumed so the byte cursor stays aligned even
 *  though we only keep each beat's duration and its notes (string+fret → MIDI
 *  via the track tuning). Output is the SAME score shape as parseGPIF /
 *  parseMusicXML (`source:"gp"`), so chart/export/transpose/playback are shared.
 *
 *  Versions diverge in: an extra octave byte + lyrics block (GP4+), 1- vs
 *  2-byte effect flags, the new-chord layout, and the mix-table flags byte.
 *  GP5's container is different enough (directory, RSE, 2 voices) to live in
 *  its own reader, parseGP5.
 * ==========================================================================*/
function _gpReader(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const dec = new TextDecoder("latin1");
  let pos = 0;
  const R = {
    get pos() { return pos; }, set pos(p) { pos = p; },
    skip(n) { pos += n; },
    u8() { return dv.getUint8(pos++); },
    i8() { return dv.getInt8(pos++); },
    bool() { return dv.getUint8(pos++) !== 0; },
    i16() { const v = dv.getInt16(pos, true); pos += 2; return v; },
    i32() { const v = dv.getInt32(pos, true); pos += 4; return v; },
    byteString(count) { const size = dv.getUint8(pos++); const s = dec.decode(u8.subarray(pos, pos + Math.min(size, count))); pos += count; return s; },
    intString() { const n = R.i32(); const s = dec.decode(u8.subarray(pos, pos + n)); pos += n; return s; },
    intByteString() { const n = R.i32(); return R.byteString(n - 1); },
    version() { return R.byteString(30); },
  };
  return R;
}
const _GP_TUPLET = { 3: [3, 2], 5: [5, 4], 6: [6, 4], 7: [7, 4], 9: [9, 8], 10: [10, 8], 11: [11, 8], 12: [12, 8], 13: [13, 8] };
// GP alternate-ending byte (bitmask of repeat passes) → a 1-based ending label, or null.
const _gpEndingLabel = (b) => (b ? String(Math.round(Math.log2(b & -b)) + 1) : null);
function _gpReadDuration(r, flags) {
  r._tuplet = 0;                              // side-channel: tuplet group size of this beat (0 = none)
  let q = 4 / (1 << (r.i8() + 2));            // value: -2→whole(4q) … 0→quarter(1q) … 2→16th(.25q)
  if (flags & 0x01) q *= 1.5;                 // dotted
  if (flags & 0x20) { const tv = r.i32(); const t = _GP_TUPLET[tv]; if (t) { q *= t[1] / t[0]; r._tuplet = tv; } } // tuplet (same bytes; capture the group size)
  return q;
}
function _gpReadBend(r) { r.i8(); r.i32(); const n = r.i32(); for (let i = 0; i < n; i++) { r.i32(); r.i32(); r.bool(); } }
function _gpReadGrace(r) { r.i8(); r.u8(); r.u8(); r.i8(); }            // fret, velocity, duration, transition
function _gpReadNoteEffects(r, v) {
  if (v >= 4) {
    const f1 = r.u8(), f2 = r.u8();
    if (f1 & 0x01) _gpReadBend(r);
    if (f1 & 0x10) _gpReadGrace(r);
    if (f2 & 0x04) r.i8();                                             // tremolo picking
    if (f2 & 0x08) r.i8();                                             // slide
    if (f2 & 0x10) r.i8();                                             // harmonic
    if (f2 & 0x20) { r.i8(); r.i8(); }                                 // trill
  } else {
    const f1 = r.u8();
    if (f1 & 0x01) _gpReadBend(r);
    if (f1 & 0x10) _gpReadGrace(r);                                    // 0x04 slide: no bytes in GP3
  }
}
function _gpReadBeatEffects(r, v) {
  if (v >= 4) {
    const f1 = r.u8(), f2 = r.u8();
    if (f1 & 0x20) r.i8();                                             // slap/tap
    if (f2 & 0x04) _gpReadBend(r);                                     // tremolo bar = bend
    if (f1 & 0x40) { r.i8(); r.i8(); }                                 // stroke
    if (f2 & 0x02) r.i8();                                             // pick stroke
  } else {
    const f1 = r.u8();
    if (f1 & 0x20) { const slap = r.u8(); if (slap === 0) r.i32(); else r.i32(); } // tremolo bar / tap value
    if (f1 & 0x40) { r.i8(); r.i8(); }                                 // stroke
  }
}
function _gpReadMixTableChange(r, v) {
  const vals = [r.i8(), r.i8(), r.i8(), r.i8(), r.i8(), r.i8(), r.i8()]; // instr,vol,bal,chorus,reverb,phaser,tremolo
  const tempo = r.i32();
  // durations follow for each changed param among volume..tremolo (vals[1..6]) then tempo
  for (let i = 1; i <= 6; i++) if (vals[i] >= 0) r.i8();
  if (tempo >= 0) r.i8();
  if (v >= 4) r.i8();                                                  // GP4 all-tracks flags byte
}
function _gpReadChord(r, v, stringCount) {
  const newFormat = r.bool();
  if (!newFormat) {                                                   // GP3 old chord
    r.intByteString();                                                // name
    const firstFret = r.i32();
    if (firstFret) for (let i = 0; i < 6; i++) r.i32();
    return;
  }
  if (v >= 4) {                                                       // GP4 new chord
    r.bool(); r.skip(3); r.u8(); r.u8(); r.u8(); r.i32(); r.i32(); r.bool();
    r.byteString(22); r.u8(); r.u8(); r.u8(); r.i32();
    for (let i = 0; i < 7; i++) r.i32();                              // frets
    r.u8();                                                           // barre count
    for (let i = 0; i < 15; i++) r.u8();                              // 5 frets + 5 starts + 5 ends
    for (let i = 0; i < 7; i++) r.bool();                            // omissions
    r.skip(1);
    for (let i = 0; i < 7; i++) r.i8();                              // fingerings
    r.bool();                                                         // show
  } else {                                                            // GP3 new chord
    r.bool(); r.skip(3); r.i32(); r.i32(); r.i32(); r.i32(); r.i32(); r.bool();
    r.byteString(22); r.i32(); r.i32(); r.i32(); r.i32();
    for (let i = 0; i < 6; i++) r.i32();                              // frets
    r.i32();                                                          // barre count
    for (let i = 0; i < 6; i++) r.i32();                              // 2 frets + 2 starts + 2 ends
    for (let i = 0; i < 7; i++) r.bool();                            // omissions
    r.skip(1);
  }
}
function _gpReadNote(r, v, stringNumber, tuning, state) {
  const flags = r.u8();
  let type = 1;
  if (flags & 0x20) type = r.u8();
  if (flags & 0x01) { r.i8(); r.i8(); }                               // time-independent duration
  if (flags & 0x10) r.i8();                                           // dynamic
  let fret = null;
  if (flags & 0x20) fret = r.i8();
  if (flags & 0x80) { r.i8(); r.i8(); }                               // fingering
  if (flags & 0x08) _gpReadNoteEffects(r, v);
  if (type === 2) { fret = state.lastFret[stringNumber]; if (fret == null) return null; } // tie → sustain prior pitch
  else if (type === 3) return null;                                   // dead/muted → no pitch
  if (fret == null) return null;
  fret = Math.min(Math.max(fret, 0), 99);
  state.lastFret[stringNumber] = fret;
  return { fret, midi: tuning[stringNumber - 1] + fret };
}
function _gpReadBeat(r, v, stringCount, tuning, state) {
  const flags = r.u8();
  let empty = false;
  if (flags & 0x40) { const st = r.u8(); empty = st === 0; }          // 0=empty, 2=rest
  const durQuarters = _gpReadDuration(r, flags);
  if (flags & 0x02) _gpReadChord(r, v, stringCount);
  if (flags & 0x04) r.intByteString();                               // text
  if (flags & 0x08) _gpReadBeatEffects(r, v);
  if (flags & 0x10) _gpReadMixTableChange(r, v);
  const stringFlags = r.u8();
  const midis = [], frets = {};
  for (let s = 1; s <= stringCount; s++) {
    if (stringFlags & (1 << (7 - s))) {
      const note = _gpReadNote(r, v, s, tuning, state);
      if (note) { midis.push(note.midi); frets[6 - s] = note.fret; }
    }
  }
  return { durQuarters: empty ? 0 : durQuarters, midis, frets, tuplet: r._tuplet || 0 };
}
function parseGP345(u8, useSharp = true, partIndex = 0) {
  const r = _gpReader(u8);
  const version = r.version();
  const v = /v5/.test(version) ? 5 : /v4/.test(version) ? 4 : /v3/.test(version) ? 3 : 0;
  if (v === 5) return parseGP5(u8, version, useSharp, partIndex);
  if (v !== 3 && v !== 4) throw new Error("Unrecognized Guitar Pro version: " + version);
  // --- song header ---
  for (let i = 0; i < 8; i++) r.intByteString();                     // title…instructions
  const noticeLines = r.i32(); for (let i = 0; i < noticeLines; i++) r.intByteString();
  r.bool();                                                          // triplet feel
  if (v >= 4) { r.i32(); for (let i = 0; i < 5; i++) { r.i32(); r.intString(); } } // lyrics
  const tempo = r.i32();
  r.i32();                                                           // key
  if (v >= 4) r.i8();                                                // octave
  for (let i = 0; i < 64; i++) { r.i32(); r.skip(8); }               // 64 MIDI channels (instr + 6 bytes + 2 blank)
  const measureCount = r.i32();
  const trackCount = r.i32();
  // --- measure headers (timeSig, inherited) ---
  const headers = [], meta = []; let num = 4, den = 4;
  for (let m = 0; m < measureCount; m++) {
    const flags = r.u8();
    if (flags & 0x01) num = r.i8();
    if (flags & 0x02) den = r.i8();
    const repeatStart = !!(flags & 0x04);                           // |: (flag only, no bytes)
    const repeatEnd = (flags & 0x08) ? (r.i8(), true) : false;      // repeat close (count byte)
    const ending = _gpEndingLabel((flags & 0x10) ? r.u8() : 0);     // alternate ending bitmask
    let section = "";
    if (flags & 0x20) { section = (r.intByteString() || "").trim(); r.skip(4); } // marker = section
    if (flags & 0x40) { r.i8(); r.i8(); }                           // key sig change
    headers.push([num, den]);
    meta.push({ section, repeatStart, repeatEnd, ending });
  }
  // --- tracks ---
  const tracks = [];
  for (let t = 0; t < trackCount; t++) {
    r.u8();                                                          // flags
    const name = r.byteString(40);
    const stringCount = r.i32();
    const tuning = [];
    for (let i = 0; i < 7; i++) { const tu = r.i32(); if (i < stringCount) tuning.push(tu); }
    r.i32();                                                         // port
    r.i32(); r.i32();                                                // channel + effect channel
    r.i32();                                                         // fret count
    const capo = r.i32();                                            // capo fret (kept for the export header)
    r.skip(4);                                                       // colour
    tracks.push({ name, stringCount, tuning, capo, measures: [] });
  }
  // --- measures (measure-major, then track) ---
  const state = tracks.map(() => ({ lastFret: {} }));
  for (let m = 0; m < measureCount; m++) {
    for (let t = 0; t < trackCount; t++) {
      const tr = tracks[t];
      const beatCount = r.i32();
      const beats = [];
      for (let b = 0; b < beatCount; b++) beats.push(_gpReadBeat(r, v, tr.stringCount, tr.tuning, state[t]));
      tr.measures.push({ timeSig: headers[m], meta: meta[m], voices: [beats] });
    }
  }
  return _gpBuildScore(tracks, tempo, version, useSharp, partIndex);
}
function _gpBuildScore(tracks, tempo, version, useSharp, partIndex) {
  const idx = Math.max(0, Math.min(tracks.length - 1, partIndex | 0));
  const tr = tracks[idx];
  const parts = tracks.map((t, i) => ({ index: i, id: String(i), name: (t.name || "").trim() || `Track ${i + 1}` }));
  const bars = tr.measures.map((m, mi) => {
    const [bts, btype] = m.timeSig;
    const onsets = new Map();
    m.voices.forEach((beats) => {                                     // GP5 has 2 voices; each restarts at beat 0
      let cursor = 0;
      beats.forEach((b) => {
        if (b.midis.length) { if (!onsets.has(cursor)) onsets.set(cursor, { midis: [], frets: {}, tuplet: b.tuplet || 0 }); const o = onsets.get(cursor); b.midis.forEach((x) => o.midis.push(x)); Object.keys(b.frets).forEach((k) => { if (o.frets[k] === undefined) o.frets[k] = b.frets[k]; }); }
        cursor += b.durQuarters;
      });
    });
    const qPerBeat = 4 / btype;
    const raw = [...onsets.entries()].filter(([, o]) => o.midis.length).sort((a, b) => a[0] - b[0])
      .map(([onset, o]) => ({ symbol: symbolForMidis(o.midis, useSharp), midis: [...o.midis].sort((a, b) => a - b), frets: o.frets, tuplet: o.tuplet || 0, onset }));
    const events = [];
    raw.forEach((e) => { const last = events[events.length - 1]; if (!last || last.symbol !== e.symbol) events.push(e); });
    events.forEach((e) => { e.qbeat = e.onset / qPerBeat; e.beat = Math.max(0, Math.min(bts - 1, Math.round(e.qbeat))); });
    for (let i = 1; i < events.length; i++) if (events[i].beat <= events[i - 1].beat) events[i].beat = Math.min(bts - 1, events[i - 1].beat + 1);
    events.forEach((e, i) => { e.durBeats = (i + 1 < events.length ? events[i + 1].beat : bts) - e.beat; });
    _fillTrueDur(events, bts);
    const md = m.meta || {};
    return { number: mi + 1, timeSig: [bts, btype], section: md.section || undefined, repeatStart: !!md.repeatStart, repeatEnd: !!md.repeatEnd, ending: md.ending || null, events: events.map(({ onset, ...e }) => e) };
  });
  return { source: "gp", timeSig: bars.length ? bars[0].timeSig : [4, 4], tuning: _tuningName(tr.tuning ? [...tr.tuning].reverse() : null), capo: tr.capo || 0, tempo, bars, parts, partIndex: idx };
}
/* ---- GP5: a separate reader (different container: RSE, page setup, directions,
 * 2 voices/measure, wider headers/tracks/notes). gt500 = format > 5.0.0 (v5.10),
 * which adds the RSE master effect, hide-tempo, track EQ and instrument-effect
 * names. Effect/chord/beat blocks reuse the GP4 helpers where identical. */
function _gp5RSEInstrument(r, gt500) { r.i32(); r.i32(); r.i32(); if (gt500) r.i32(); else { r.i16(); r.skip(1); } }
function _gp5Grace(r) { r.u8(); r.u8(); r.u8(); r.u8(); r.u8(); }
function _gp5Harmonic(r) { const t = r.i8(); if (t === 2) { r.u8(); r.i8(); r.u8(); } else if (t === 3) r.u8(); }
function _gp5NoteEffects(r) {
  const f1 = r.u8(), f2 = r.u8();
  if (f1 & 0x01) _gpReadBend(r);
  if (f1 & 0x10) _gp5Grace(r);
  if (f2 & 0x04) r.i8();                                              // tremolo picking
  if (f2 & 0x08) r.u8();                                              // slide flags
  if (f2 & 0x10) _gp5Harmonic(r);
  if (f2 & 0x20) { r.i8(); r.i8(); }                                  // trill
}
function _gp5MixTable(r, gt500) {
  const instrument = r.i8();
  _gp5RSEInstrument(r, gt500);
  if (!gt500) r.skip(1);
  const vals = [r.i8(), r.i8(), r.i8(), r.i8(), r.i8(), r.i8()];      // volume,balance,chorus,reverb,phaser,tremolo
  r.intByteString();                                                 // tempo name
  const tempo = r.i32();
  for (let i = 0; i < 6; i++) if (vals[i] >= 0) r.i8();              // durations
  if (tempo >= 0) { r.i8(); if (gt500) r.bool(); }
  r.i8();                                                            // mix-table flags
  r.i8();                                                            // wah
  if (gt500) { r.intByteString(); r.intByteString(); }              // RSE instrument effect name/category
}
function _gp5Note(r, stringNumber, tuning, state) {
  const flags = r.u8();
  let type = 1;
  if (flags & 0x20) type = r.u8();
  if (flags & 0x10) r.i8();                                          // dynamic
  let fret = null;
  if (flags & 0x20) fret = r.i8();
  if (flags & 0x80) { r.i8(); r.i8(); }                              // fingering
  if (flags & 0x01) r.skip(8);                                       // duration percent (f64)
  r.u8();                                                            // flags2 (always)
  if (flags & 0x08) _gp5NoteEffects(r);
  if (type === 2) { fret = state.lastFret[stringNumber]; if (fret == null) return null; }
  else if (type === 3) return null;
  if (fret == null) return null;
  fret = Math.min(Math.max(fret, 0), 99);
  state.lastFret[stringNumber] = fret;
  return { fret, midi: tuning[stringNumber - 1] + fret };
}
function _gp5Beat(r, stringCount, tuning, state, gt500) {
  const flags = r.u8();
  let empty = false;
  if (flags & 0x40) { const st = r.u8(); empty = st === 0; }
  const durQuarters = _gpReadDuration(r, flags);
  if (flags & 0x02) _gpReadChord(r, 4, stringCount);                 // GP4-format chord
  if (flags & 0x04) r.intByteString();
  if (flags & 0x08) _gpReadBeatEffects(r, 4);                        // GP4-format beat effects
  if (flags & 0x10) _gp5MixTable(r, gt500);
  const stringFlags = r.u8();
  const midis = [], frets = {};
  for (let s = 1; s <= stringCount; s++) {
    if (stringFlags & (1 << (7 - s))) { const note = _gp5Note(r, s, tuning, state); if (note) { midis.push(note.midi); frets[6 - s] = note.fret; } }
  }
  const f2 = r.i16();
  if (f2 & 0x0800) r.u8();                                           // break-secondary-beams count
  return { durQuarters: empty ? 0 : durQuarters, midis, frets, tuplet: r._tuplet || 0 };
}
function parseGP5(u8, version, useSharp = true, partIndex = 0) {
  const r = _gpReader(u8);
  r.version();                                                       // re-read 30-byte version
  const gt500 = !/v5\.00/.test(version);                             // 5.10+ has extra blocks
  for (let i = 0; i < 9; i++) r.intByteString();                     // info: 9 strings (GP5 splits words/music)
  const noticeLines = r.i32(); for (let i = 0; i < noticeLines; i++) r.intByteString();
  r.i32(); for (let i = 0; i < 5; i++) { r.i32(); r.intString(); }   // lyrics
  if (gt500) { r.i32(); r.i32(); for (let i = 0; i < 11; i++) r.i8(); } // RSE master effect (vol + reserved + EQ-11)
  r.skip(8 + 16 + 4); r.i16();                                       // page setup: size, margins, proportion, header/footer
  for (let i = 0; i < 10; i++) r.intByteString();                    // page-setup placeholder strings
  r.intByteString();                                                 // tempo name
  const tempo = r.i32();
  if (gt500) r.bool();                                               // hide tempo
  r.i8();                                                            // key
  r.i32();                                                           // octave
  for (let i = 0; i < 64; i++) { r.i32(); r.skip(8); }               // 64 MIDI channels
  r.skip(38);                                                        // directions: 19 shorts
  r.i32();                                                           // master reverb
  const measureCount = r.i32();
  const trackCount = r.i32();
  // --- measure headers ---
  const headers = [], meta = []; let num = 4, den = 4;
  for (let m = 0; m < measureCount; m++) {
    if (m > 0) r.skip(1);
    const flags = r.u8();
    if (flags & 0x01) num = r.i8();
    if (flags & 0x02) den = r.i8();
    const repeatStart = !!(flags & 0x04);                           // |: (flag only)
    const repeatEnd = (flags & 0x08) ? (r.i8(), true) : false;      // repeat close (count byte)
    let section = "";
    if (flags & 0x20) { section = (r.intByteString() || "").trim(); r.skip(4); } // marker = section
    if (flags & 0x40) { r.i8(); r.i8(); }                           // key sig
    const ending = _gpEndingLabel((flags & 0x10) ? r.u8() : 0);     // alt ending bitmask
    if (flags & 0x03) r.skip(4);                                     // time-sig beams
    if (!(flags & 0x10)) r.skip(1);
    r.u8();                                                          // triplet feel
    headers.push([num, den]);
    meta.push({ section, repeatStart, repeatEnd, ending });
  }
  // --- tracks ---
  const tracks = [];
  for (let t = 0; t < trackCount; t++) {
    if (t === 0 || !gt500) r.skip(1);
    r.u8();                                                          // flags1
    const name = r.byteString(40);
    const stringCount = r.i32();
    const tuning = [];
    for (let i = 0; i < 7; i++) { const tu = r.i32(); if (i < stringCount) tuning.push(tu); }
    r.i32();                                                         // port
    r.i32(); r.i32();                                                // channel
    r.i32(); const capo = r.i32();                                   // fret count, capo (kept for the export header)
    r.skip(4);                                                       // colour
    r.i16();                                                         // flags2
    r.u8(); r.u8(); r.u8();                                          // auto-accent, bank, humanize
    r.i32(); r.i32(); r.i32();                                       // clef transpose ×2 + unknown
    r.skip(12);
    _gp5RSEInstrument(r, gt500);
    if (gt500) { for (let i = 0; i < 4; i++) r.i8(); r.intByteString(); r.intByteString(); } // track EQ-4 + RSE effect names
    tracks.push({ name, stringCount, tuning, capo, measures: [] });
  }
  r.skip(gt500 ? 1 : 2);                                             // blank byte(s) after all tracks
  // --- measures (measure-major, then track; 2 voices each + line break) ---
  const state = tracks.map(() => ({ lastFret: {} }));
  for (let m = 0; m < measureCount; m++) {
    for (let t = 0; t < trackCount; t++) {
      const tr = tracks[t];
      const voices = [];
      for (let vi = 0; vi < 2; vi++) {
        const beatCount = r.i32();
        const beats = [];
        for (let b = 0; b < beatCount; b++) beats.push(_gp5Beat(r, tr.stringCount, tr.tuning, state[t], gt500));
        voices.push(beats);
      }
      if (r.pos < u8.length) r.u8();                                 // line break (absent on a final measure — PyGuitarPro reads default 0)
      tr.measures.push({ timeSig: headers[m], meta: meta[m], voices });
    }
  }
  return _gpBuildScore(tracks, tempo, version, useSharp, partIndex);
}

/* ===========================================================================
 *  PATH F — Guitar Pro 6 (`.gpx`)
 *  --------------------------------------------------------------------------
 *  A `.gpx` is a `BCFZ`-compressed `BCFS` filesystem (Guitar Pro 6's container)
 *  whose `score.gpif` is the SAME GPIF XML that GP7/8 use — so once the
 *  container is unpacked, parseGPIF does the rest (with the String+Fret
 *  fallback above, since GP6 notes carry no direct <Midi>). Zero deps: a
 *  bit-reader + the documented BCFZ LZ scheme + the sector filesystem, ported
 *  from alphaTab's GpxFileSystem. `BCFS` (uncompressed) is handled too.
 * ==========================================================================*/
function _gpxBitReader(u8) {
  let pos = 0, bit = 0;
  function readBit() { if (pos >= u8.length) throw { __gpxEof: true }; const v = (u8[pos] >> (7 - bit)) & 1; if (++bit === 8) { bit = 0; pos++; } return v; }
  function readBits(n) { let v = 0; for (let i = n - 1; i >= 0; i--) v |= readBit() << i; return v; }            // MSB-first
  function readBitsRev(n) { let v = 0; for (let i = 0; i < n; i++) v |= readBit() << i; return v; }              // LSB-first
  const readByte = () => readBits(8);
  const readBytes = (n) => { const a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = readByte(); return a; };
  return { readBits, readBitsRev, readByte, readBytes };
}
const _gpxLE32 = (d, o) => ((d[o + 3] << 24) | (d[o + 2] << 16) | (d[o + 1] << 8) | d[o]) >>> 0;
function _gpxDecompress(br, skipHeader) {                                                                        // BCFZ → raw bytes
  const expected = _gpxLE32(br.readBytes(4), 0);
  const out = [];
  try {
    while (out.length < expected) {
      if (br.readBits(1) === 1) {                                                                                // back-reference
        const wordSize = br.readBits(4);
        const offset = br.readBitsRev(wordSize), size = br.readBitsRev(wordSize);
        const sp = out.length - offset, toRead = Math.min(offset, size);
        for (let i = 0; i < toRead; i++) out.push(out[sp + i]);
      } else { const size = br.readBitsRev(2); for (let i = 0; i < size; i++) out.push(br.readByte()); }         // raw bytes
    }
  } catch (e) { if (!(e && e.__gpxEof)) throw e; }
  const u = new Uint8Array(out);
  return skipHeader ? u.subarray(4) : u;
}
function _gpxReadFS(data) {                                                                                       // BCFS sector filesystem
  const SS = 0x1000, files = [];
  let offset = SS;
  while (offset + 3 < data.length) {
    if (_gpxLE32(data, offset) === 2) {                                                                          // file entry
      let name = ""; for (let i = 0; i < 127; i++) { const c = data[offset + 4 + i]; if (c === 0) break; name += String.fromCharCode(c); }
      const fileSize = _gpxLE32(data, offset + 0x8c);
      const dpo = offset + 0x94; let sc = 0; const chunks = [];
      for (;;) { const sector = _gpxLE32(data, dpo + 4 * sc++); if (sector === 0) break; offset = sector * SS; chunks.push(data.subarray(offset, offset + SS)); }
      let total = 0; chunks.forEach((c) => (total += c.length));
      const buf = new Uint8Array(total); let p = 0; chunks.forEach((c) => { buf.set(c, p); p += c.length; });
      files.push({ name, data: buf.subarray(0, Math.min(fileSize, buf.length)) });
    }
    offset += SS;
  }
  return files;
}
function parseGPX(u8, useSharp = true, partIndex = 0) {
  const br = _gpxBitReader(u8);
  const header = String.fromCharCode(...br.readBytes(4));
  let fs;
  if (header === "BCFZ") fs = _gpxReadFS(_gpxDecompress(br, true));
  else if (header === "BCFS") fs = _gpxReadFS(u8.subarray(4));
  else throw new Error("Not a GP6 .gpx file.");
  const score = fs.find((f) => /score\.gpif$/i.test(f.name)) || fs.find((f) => /\.gpif$/i.test(f.name));
  if (!score) throw new Error("No score.gpif inside the .gpx.");
  return parseGPIF(new TextDecoder("utf-8").decode(score.data), useSharp, partIndex);
}

/* ===========================================================================
 *  PATH G — Power Tab (`.ptb`) import
 *  --------------------------------------------------------------------------
 *  Power Tab Editor's `.ptb` is an MFC-`CArchive`-style binary serialization
 *  (Brad Larsen's format). This is a faithful, zero-dependency port of the
 *  documented `Deserialize` order (from the open-source powertabeditor's
 *  `powertabdocument` classes). Nothing is length-prefixed, so EVERY object —
 *  even effects/diagrams/dynamics we discard — must be consumed exactly to stay
 *  aligned (clean EOF across the corpus is the validation). We keep each
 *  position's duration + its notes (string+fret → MIDI via the guitar tuning)
 *  and emit the SAME `source:"gp"` score shape, so the rest of the app is shared.
 *
 *  Layout: header → Guitar Score + Bass Score (each: guitars, chord diagrams,
 *  floating text, guitar-ins, tempo markers, dynamics, alt endings, SYSTEMS) →
 *  3 fonts → spacing/fade. A System is a staff line holding several measures
 *  delimited by barlines; each Position is a beat, each Note packs string+fret
 *  in one byte (top 3 bits = string from high E, bottom 5 = fret). Targets the
 *  ubiquitous v1.7 (=4) files; the new-format path also covers v1.5 (=3).
 * ==========================================================================*/
function _ptbReader(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const dec = new TextDecoder("latin1");
  let p = 0;
  const R = {
    get pos() { return p; }, get left() { return u8.length - p; },
    u8() { return dv.getUint8(p++); }, u16() { const v = dv.getUint16(p, true); p += 2; return v; },
    u32() { const v = dv.getUint32(p, true); p += 4; return v; }, i32() { const v = dv.getInt32(p, true); p += 4; return v; },
    skip(n) { p += n; }, bytes(n) { const a = u8.subarray(p, p + n); p += n; return a; },
    count() { const w = R.u16(); return w !== 0xffff ? w : R.u32(); },
    strLen() { const b = R.u8(); if (b < 0xff) return b; const w = R.u16(); if (w < 0xffff) return w; return R.u32(); },
    str() { const n = R.strLen(); const s = dec.decode(u8.subarray(p, p + n)); p += n; return s; },
    classInfo() { const wt = R.u16(); if (wt === 0x7fff) { R.u32(); return; } const ot = (((wt & 0x8000) << 16) | (wt & ~0x8000)) >>> 0; if (ot < 0x80000000) return; if (wt === 0xffff) { R.u16(); const len = R.u16(); R.skip(len); } },
    vector(fn) { const c = R.count(); const out = []; for (let i = 0; i < c; i++) { R.classInfo(); out.push(fn()); } return out; },
    smallVec(elem) { const n = R.u8(); return R.bytes(n * elem); },
    rect() { R.skip(16); },
  };
  return R;
}
const _ptbNew = (v) => v >= 3;                                                  // 1.5+ uses the modern object layout
const _ptbTuning = (r) => { r.str(); r.u8(); return { notes: [...r.smallVec(1)] }; }; // notes high→low
const _ptbGuitar = (r) => { r.u8(); const name = r.str(); r.skip(8); return { name, tuning: _ptbTuning(r) }; };
const _ptbChordName = (r, v) => { if (!_ptbNew(v)) { r.u8(); r.u8(); r.u16(); r.u8(); } else { r.u16(); r.u8(); r.u16(); r.u8(); } };
const _ptbChordDiagram = (r, v) => { _ptbChordName(r, v); r.u8(); r.smallVec(1); };
const _ptbFont = (r) => { r.str(); r.i32(); r.i32(); r.u8(); r.u8(); r.u8(); r.u32(); };
const _ptbFloatingText = (r, v) => { r.str(); r.rect(); r.u8(); _ptbFont(r); };
const _ptbGuitarIn = (r) => { r.u16(); r.u8(); r.u8(); r.u16(); };
const _ptbDynamic = (r, v) => { if (!_ptbNew(v)) { r.u16(); r.u8(); r.u8(); r.u8(); } else { r.u16(); r.u8(); r.u8(); r.u16(); } };
const _ptbSystemSymbol = (r) => { r.u16(); r.u8(); return r.u32(); };           // returns data (tempo BPM lives in the low word)
const _ptbTempoMarker = (r) => { const data = _ptbSystemSymbol(r); r.str(); return { data }; };
const _ptbDirection = (r) => { r.u8(); r.smallVec(2); };
const _ptbChordText = (r, v) => { r.u8(); _ptbChordName(r, v); };
const _ptbRhythmSlash = (r) => { r.u8(); r.u8(); r.u32(); };
const _ptbRehearsal = (r) => { r.u8(); r.str(); };
const _ptbBarline = (r, v) => { const pos = r.u8(); r.u8(); r.u8() /*keysig*/; const ts = r.u32(); r.u8() /*timesig pulses*/; _ptbRehearsal(r); return { pos, ts }; };
const _ptbNote = (r) => { const sd = r.u8(); r.u16(); r.smallVec(4); return { string: (sd & 0xe0) >> 5, fret: sd & 0x1f }; };
const _ptbPosition = (r, v) => { const pos = r.u8(); r.u16(); const data = r.u32(); r.smallVec(4); const notes = r.vector(() => _ptbNote(r)); return { pos, durType: (data >>> 24) & 0xff, dotted: data & 1, dbl: data & 2, notes }; };
const _ptbStaff = (r, v) => { r.u8(); r.skip(4); return { voices: [r.vector(() => _ptbPosition(r, v)), r.vector(() => _ptbPosition(r, v))] }; };
function _ptbSystem(r, v) {
  r.rect(); r.u8() /*endBar*/; r.skip(4);
  const startBar = _ptbBarline(r, v);
  r.vector(() => _ptbDirection(r)); r.vector(() => _ptbChordText(r, v)); r.vector(() => _ptbRhythmSlash(r));
  const staves = r.vector(() => _ptbStaff(r, v));
  const bars = r.vector(() => _ptbBarline(r, v));
  return { startBar, staves, bars };
}
function _ptbScore(r, v) {
  const guitars = r.vector(() => _ptbGuitar(r));
  r.vector(() => _ptbChordDiagram(r, v)); r.vector(() => _ptbFloatingText(r, v)); r.vector(() => _ptbGuitarIn(r));
  const tempoMarkers = r.vector(() => _ptbTempoMarker(r));
  r.vector(() => _ptbDynamic(r, v)); r.vector(() => _ptbSystemSymbol(r)) /*alt endings*/;
  const systems = r.vector(() => _ptbSystem(r, v));
  return { guitars, tempoMarkers, systems };
}
function _ptbHeader(r) {
  if (r.u32() !== 0x62617470) throw new Error("Not a Power Tab (.ptb) file.");
  const v = r.u16();
  const fileType = r.u8();
  if (fileType === 0) {                                                         // song
    r.u8(); r.str(); r.str();                                                   // contentType, title, artist
    const rel = r.u8();
    if (rel === 0) { r.u8(); r.str(); r.u16(); r.u8(); }                        // audio
    else if (rel === 1) { r.str(); r.u8(); }                                    // video
    else if (rel === 2) { r.str(); r.u16(); r.u16(); r.u16(); }                 // bootleg
    if (r.u8() === 0) { r.str(); r.str(); }                                     // authorType==known → composer, lyricist
    for (let i = 0; i < 7; i++) r.str();                                        // arranger…bassScoreNotes
  } else { r.str(); r.str(); r.u16(); r.u8(); r.str(); r.str(); r.str(); }      // lesson
  return v;
}
function _ptbTimeSig(data) {
  if (data & 0x400000) return { beats: 4, beatType: 4, show: !!(data & 0x100000) }; // common
  if (data & 0x800000) return { beats: 2, beatType: 2, show: !!(data & 0x100000) }; // cut
  return { beats: ((data >>> 27) & 0x1f) + 1, beatType: 1 << ((data >>> 24) & 0x7), show: !!(data & 0x100000) };
}
function parsePowerTab(u8, useSharp = true, partIndex = 0) {
  const r = _ptbReader(u8);
  const v = _ptbHeader(r);
  const guitarScore = _ptbScore(r, v);
  const bassScore = _ptbScore(r, v);
  // (3 document fonts + spacing/fade follow but aren't needed; parse stops here.)
  const all = [
    ...guitarScore.guitars.map((g) => ({ g, score: guitarScore, base: 0 })),
    ...bassScore.guitars.map((g) => ({ g, score: bassScore, base: guitarScore.guitars.length })),
  ];
  if (!all.length) throw new Error("No guitars found in the .ptb file.");
  const parts = all.map((x, i) => ({ index: i, id: String(i), name: (x.g.name || "").trim() || `Guitar ${i + 1}` }));
  const idx = Math.max(0, Math.min(all.length - 1, partIndex | 0));
  const sel = all[idx], staffIdx = idx - sel.base, tuning = sel.g.tuning.notes, tunLen = tuning.length;
  let tempo = null;
  const tm = guitarScore.tempoMarkers[0] || bassScore.tempoMarkers[0];
  if (tm) { const bpm = tm.data & 0xffff; if (bpm >= 20 && bpm <= 400) tempo = bpm; }

  const bars = []; let curTS = [4, 4], barNum = 1;
  for (const sys of sel.score.systems) {
    const staff = sys.staves[staffIdx]; if (!staff) continue;
    const positions = staff.voices[0];
    const barlines = [sys.startBar, ...sys.bars].slice().sort((a, b) => a.pos - b.pos);
    let maxPos = 1; positions.forEach((p) => { if (p.pos + 1 > maxPos) maxPos = p.pos + 1; }); barlines.forEach((b) => { if (b.pos + 1 > maxPos) maxPos = b.pos + 1; });
    for (let i = 0; i < barlines.length; i++) {
      const start = barlines[i].pos, end = i + 1 < barlines.length ? barlines[i + 1].pos : maxPos;
      const ts = _ptbTimeSig(barlines[i].ts); if (ts.show || barNum === 1) curTS = [ts.beats, ts.beatType];
      const [bts, btype] = curTS;
      const onsets = new Map(); let cursor = 0;
      positions.filter((p) => p.pos >= start && p.pos < end).forEach((pp) => {
        const durType = pp.durType >= 1 && pp.durType <= 64 ? pp.durType : 4;
        const durQ = (4 / durType) * (pp.dotted ? 1.5 : pp.dbl ? 1.75 : 1);
        if (pp.notes.length) {
          const o = { midis: [], frets: {} };
          pp.notes.forEach((n) => { const open = tuning[n.string]; if (open !== undefined) { o.midis.push(open + n.fret); const eng = tunLen - 1 - n.string; if (eng >= 0 && eng <= 5 && o.frets[eng] === undefined) o.frets[eng] = n.fret; } });
          if (o.midis.length) onsets.set(cursor, o);
        }
        cursor += durQ;
      });
      const qPerBeat = 4 / btype;
      const raw = [...onsets.entries()].sort((a, b) => a[0] - b[0]).map(([onset, o]) => ({ symbol: symbolForMidis(o.midis, useSharp), midis: [...o.midis].sort((a, b) => a - b), frets: o.frets, onset }));
      const events = [];
      raw.forEach((e) => { const last = events[events.length - 1]; if (!last || last.symbol !== e.symbol) events.push(e); });
      events.forEach((e) => { e.qbeat = e.onset / qPerBeat; e.beat = Math.max(0, Math.min(bts - 1, Math.round(e.qbeat))); });
      for (let k = 1; k < events.length; k++) if (events[k].beat <= events[k - 1].beat) events[k].beat = Math.min(bts - 1, events[k - 1].beat + 1);
      events.forEach((e, k) => { e.durBeats = (k + 1 < events.length ? events[k + 1].beat : bts) - e.beat; });
      _fillTrueDur(events, bts);                                     // true qbeat/qdur for ABC + playback (never 0)
      bars.push({ number: barNum++, timeSig: [bts, btype], events: events.map(({ onset, ...e }) => e) });
    }
  }
  return { source: "gp", timeSig: bars.length ? bars[0].timeSig : [4, 4], tuning: _tuningName(tuning.length === 6 ? [...tuning].reverse() : null), tempo, bars, parts, partIndex: idx };
}

/* Detect format from the file head and dispatch to the right parser. */
async function parseGuitarProOrXML(buf, fileName, useSharp = true, partIndex = 0) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const head = new TextDecoder("latin1").decode(u8.subarray(0, 32));
  if (u8[0] === 0x50 && u8[1] === 0x4b) { const xml = await gpUnzip(u8); const sc = parseGPIF(xml, useSharp, partIndex); sc._xml = xml; return sc; }        // GP7/8
  if (head.startsWith("BCFZ") || head.startsWith("BCFS")) { const sc = parseGPX(u8, useSharp, partIndex); sc._gpxbuf = u8; return sc; }                      // GP6 .gpx
  if (head.includes("FICHIER GUITAR PRO")) { const sc = parseGP345(u8, useSharp, partIndex); sc._gpbuf = u8; return sc; }                                  // GP3/4/5
  if (head.startsWith("ptab")) { const sc = parsePowerTab(u8, useSharp, partIndex); sc._ptbbuf = u8; return sc; }                                          // Power Tab .ptb
  const xml = new TextDecoder("utf-8").decode(u8); const sc = parseMusicXML(xml, useSharp, partIndex); sc._xml = xml; return sc;                            // MusicXML
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
  // ABC length multiplier (relative to L:1/4) = durBeats·4/beatType, as a reduced
  // fraction. Scale by 12 so eighths/sixteenths AND triplets stay integer, round
  // away float noise, and NEVER emit 0 — a 0 multiplier is invalid ABC (renderers
  // drop the note or fail to parse). Callers pass the TRUE duration (e.qdur).
  let num = Math.round(durBeats * 4 * 12), den = beatType * 12;
  if (num < 1) num = 1;
  const g = _gcd(num, den); num /= g; den /= g;
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
      const dur = abcDur(e.qdur != null ? e.qdur : e.durBeats, bt); // TRUE duration (never 0)
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
/* ---- CSMPN export: Chord Sheet Maker Pro's NATIVE fake-book source ---------
 * CSMPN is the source language of chord-sheet-maker-pro (the "finishing" app):
 * a header block (Title/Composer/Key/Time/Tempo) then `- Section` markers and
 * pipe-delimited bars (`| C | Am F | G |`). Multiple chords in one bar are
 * space-separated (standard fake-book grid); an empty/unrecognised bar becomes
 * `N.C.` (Pro's no-chord token). This is what the cross-app handoff hands over,
 * so Pro receives its own native syntax — no lossy re-parse. Honours overrides,
 * transpose (the score is already transposed by the caller), the ♯/♭ setting,
 * the detected key, and the (possibly user-edited) tempo. Mirrors the
 * scoreToChordPro grid layout (4 bars/row) for readability. */
const _csmpnSym = (s) => (!s || s === "—" ? "N.C." : s);
/* Largest slash-duration letter whose quarter-value is ≤ q. Used so a {hybrid}
 * event's notated duration never exceeds the gap to the next onset — CSMP drops
 * any event that overlaps the previous one (`beat < prevBeat + prevBeats`). */
const _CSMPN_DUR = [["w", 4], ["h", 2], ["q", 1], ["e", 0.5], ["s", 0.25]];
const _csmpnDurLetter = (q) => { for (const [l, v] of _CSMPN_DUR) if (q + 1e-6 >= v) return l; return "s"; };
/* Normal-note count for an N-tuplet (largest power of 2 ≤ N): 3→2, 5/6/7→4, 9→8.
 * Matches CSMP's hrTupletNormal — used to recover a tuplet event's WRITTEN note
 * value from its (shorter) sounding duration so a triplet-eighth notates as `e`. */
const _csmpnTupNormal = (n) => { let p = 1; while (p * 2 <= n) p *= 2; return p; };
/* Cumulative-quarter onset → CSMP hybrid beat position ("1","1&","2",…),
 * mirroring importGuitarPro.js `_cumQToHybridPos` (frac ≥ 0.4 → the "&" off-beat). */
const _csmpnHybridPos = (cumQ) => { const w = Math.floor(cumQ + 1e-6); return (cumQ - w >= 0.4 ? `${w + 1}&` : String(w + 1)); };
/* Event.frets ({engIdx→fret}, 0 = low E … 5 = high e) → CSMP {tab} voicing string,
 * ordered high-e (string 1) → low-E (string 6); a string with no fret is muted "x".
 * The decoder read these frets off the page, so the diagram is the REAL fingering,
 * not a generic shape. Returns null if nothing is fretted (or frets is absent —
 * e.g. after transpose, which drops position-specific frets). */
const _csmpnVoicing = (frets) => {
  if (!frets) return null;
  const out = []; let any = false;
  for (let eng = 5; eng >= 0; eng--) { if (frets[eng] != null) { out.push(String(frets[eng])); any = true; } else out.push("x"); }
  return any ? out.join(",") : null;
};
/* Performance headers shared by CSMPN + CSML: the decoder's detected tuning
 * (e.g. "Standard", "Drop D" — from the file, omitted for PDF charts that carry
 * none) and capo fret (GP3/4/5; 0 → omitted). `opts` overrides the score values.
 * Lets Pro render the right TAB/diagrams instead of assuming standard + no capo. */
function _csmPerfHeaders(score, opts) {
  const lines = [];
  const tuning = opts.tuning != null ? opts.tuning : score.tuning;
  if (tuning) lines.push(`Tuning: ${tuning}`);
  const capo = opts.capo != null ? opts.capo : score.capo;
  if (capo) lines.push(`Capo: ${capo}`);
  return lines;
}
function scoreToCSMPN(score, opts = {}) {
  const ov = opts.overrides || {};
  const [b, bt] = score.timeSig;
  const out = [`Title: ${opts.title || "Tab Decoder chart"}`];
  if (opts.composer) out.push(`Composer: ${opts.composer}`);
  const kn = keyName(opts.key, opts.useSharp !== false);
  if (kn) out.push(`Key: ${kn}`);
  out.push(`Time: ${b}/${bt}`);
  if (opts.tempo) out.push(`Tempo: ${Math.round(opts.tempo)}`);
  _csmPerfHeaders(score, opts).forEach((l) => out.push(l));
  out.push("");
  // CSMPN fakebook grammar: ONE bar = ONE whitespace token (parseBarStructures splits
  // on whitespace → each token is a bar). Multiple chords in a bar are joined with `_`
  // (Bb7_A7) — NOT spaces, which would make them separate bars. `|:`/`:|` are repeat
  // barline tokens; `1.`/`2.` mark endings; `- Name` starts a section; `%` repeats the
  // previous bar; an empty bar is `N.C.`. ~4 bars/row.
  const hasSections = score.bars.some((bar) => bar.section);
  let row = [], prevCell = null, curSection = null, n = 0;
  const flush = () => { if (row.length) { out.push(row.join(" ")); row = []; } };
  if (!hasSections) out.push("- Chart");
  score.bars.forEach((bar) => {
    if (hasSections && bar.section && bar.section !== curSection) { flush(); out.push("- " + bar.section); curSection = bar.section; prevCell = null; n = 0; }
    if (bar.repeatStart) row.push("|:");
    if (bar.ending) row.push(bar.ending + ".");
    let cell = bar.events.length ? bar.events.map((e) => _csmpnSym(_ovSym(bar, e, ov))).join("_") : "N.C.";
    if (cell !== "N.C." && cell === prevCell) cell = "%"; else prevCell = cell;
    row.push(cell);
    if (bar.repeatEnd) row.push(":|");
    if (++n % 4 === 0) { flush(); }
  });
  flush();

  // {tab} — unique chord voicings read off the page (Event.frets), so CSMP renders
  // the REAL fingering as a TAB staff + chord-diagram grid, not a generic shape.
  // First-seen voicing per chord wins (matches the GP importer). Naturally empty
  // when transposed (transposeScore drops frets), so a wrong fingering is never sent.
  if (opts.tab !== false) {
    const tabLines = [], seen = Object.create(null);
    score.bars.forEach((bar) => bar.events.forEach((e) => {
      const sym = _csmpnSym(_ovSym(bar, e, ov)), v = _csmpnVoicing(e.frets);
      if (v && sym !== "N.C." && !seen[sym]) { seen[sym] = true; tabLines.push(`  ${sym}: ${v}`); }
    }));
    if (tabLines.length) { out.push("{tab"); tabLines.forEach((l) => out.push(l)); out.push("}"); }
  }

  // {hybrid} — the REAL onset rhythm (qbeat/qdur, the decoder's true timing) as one
  // `barN:` line per bar, so CSMP's Slash-Rhythm View shows the actual strum/comp
  // rhythm instead of even slashes. Beat position is in quarter units (matches the GP
  // importer); duration is floor-mapped to the gap so CSMP never drops an event.
  if (opts.hybrid !== false) {
    const hyb = [];
    score.bars.forEach((bar, bi) => {
      const lbt = (bar.timeSig || score.timeSig)[1], evs = bar.events;
      const toks = evs.map((e, ei) => {
        const cumQ = (e.qbeat != null ? e.qbeat : e.beat) * 4 / lbt;
        // `tN` tuplet flag, but only when this event sits in a run of ≥2 same-tuplet
        // events — a lone tagged note would draw a spurious bracket. CSMP brackets
        // the group and skips its overlap check for same-tuplet events.
        const tup = e.tuplet | 0;
        const grouped = tup > 1 && ((ei > 0 && (evs[ei - 1].tuplet | 0) === tup) || (ei + 1 < evs.length && (evs[ei + 1].tuplet | 0) === tup));
        // Tuplet events: recover the WRITTEN note value (sounding × N/normal) so a
        // triplet-eighth notates as `e`, not its 1/3-quarter sounding `s`.
        let durQ = (e.qdur != null ? e.qdur : e.durBeats) * 4 / lbt;
        if (grouped) durQ *= tup / _csmpnTupNormal(tup);
        const pos = _csmpnHybridPos(cumQ), dur = _csmpnDurLetter(durQ), sym = _csmpnSym(_ovSym(bar, e, ov));
        return (e.midis && e.midis.length) ? `${pos}:${dur}(${sym})${grouped ? `t${tup}` : ""}` : `${pos}:r${dur}`;
      });
      if (toks.length) hyb.push(`  bar${bi + 1}: ${toks.join(" ")}`);
    });
    if (hyb.length) { out.push("{hybrid"); hyb.forEach((l) => out.push(l)); out.push("}"); }
  }
  return out.join("\n") + "\n";
}

/* ---- ChordSlashML export: CSMP's beat-slotted notation ----------------------
 * A DIFFERENT format from the CSMPN fakebook: `[Section]` labels and pipe-delimited
 * measures whose beat slots are space-separated. Each measure has `_csmlBeats`
 * slots (4/4→4, 12/8→4, 6/8→2, 9/8→3, 3/4→3); a chord sits on its beat, a bare
 * (space-separated) `_` holds the previous chord, `.` is a rest before the first
 * chord, and `A_B` (joined, no space) is a compound beat (two chords share one
 * slot). Mirrors CSMP's `csmlParse` grammar so it round-trips through the
 * ChordSlashML live editor. Honours overrides/transpose/♯♭/key/tempo via `opts`. */
const _csmlBeats = (num, den) => (den === 8 && num % 3 === 0 ? num / 3 : num);
const _ordinal = (s) => { const k = parseInt(s, 10); return k === 1 ? "1st" : k === 2 ? "2nd" : k === 3 ? "3rd" : k + "th"; };
function scoreToCSML(score, opts = {}) {
  const ov = opts.overrides || {};
  const [b, bt] = score.timeSig;
  const out = [`Title: ${opts.title || "Tab Decoder chart"}`];
  if (opts.composer) out.push(`Composer: ${opts.composer}`);
  const kn = keyName(opts.key, opts.useSharp !== false);
  if (kn) out.push(`Key: ${kn}`);
  out.push(`Time: ${b}/${bt}`);
  if (opts.tempo) out.push(`Tempo: ${Math.round(opts.tempo)}`);
  _csmPerfHeaders(score, opts).forEach((l) => out.push(l));
  out.push("");
  // each bar → its beat-slot string + repeat-barline flags; grouped into `[Section]`
  // (and `[Nth Ending]`) label blocks; rendered 4 measures/row with `|`/`|:`/`:|`.
  const mlist = score.bars.map((bar) => {
    const [num, den] = bar.timeSig || score.timeSig;
    const pulses = Math.max(1, _csmlBeats(num, den));
    const slots = new Array(pulses).fill(null);
    let any = false;
    bar.events.forEach((e) => {
      const sym = _csmpnSym(_ovSym(bar, e, ov));
      if (sym === "N.C.") return;
      const qb = e.qbeat != null ? e.qbeat : e.beat;
      const idx = Math.max(0, Math.min(pulses - 1, Math.round((qb * pulses) / num)));
      if (slots[idx]) slots[idx].push(sym); else slots[idx] = [sym];
      any = true;
    });
    let started = false;
    const cells = slots.map((s) => { if (s) { started = true; return s.join("_"); } return started ? "_" : "."; });
    if (!any) { cells[0] = "N.C."; for (let k = 1; k < cells.length; k++) cells[k] = "_"; }
    return { beats: cells.join(" "), repStart: !!bar.repeatStart, repEnd: !!bar.repeatEnd, section: bar.section || "", ending: bar.ending || null };
  });
  const hasSec = mlist.some((m) => m.section || m.ending);
  if (!hasSec) out.push("[Chart]");
  // render a run of measures as one barlined line (`|: A | B :|`), handling abutting repeats.
  const renderRow = (ms) => {
    const t = [];
    ms.forEach((m, i) => {
      if (i === 0) t.push(m.repStart ? "|:" : "|");
      else { const p = ms[i - 1]; if (p.repEnd) t.push(":|"); if (m.repStart) t.push("|:"); if (!p.repEnd && !m.repStart) t.push("|"); }
      t.push(m.beats);
    });
    t.push(ms[ms.length - 1].repEnd ? ":|" : "|");
    return t.join(" ");
  };
  let curSec = null, curEnd = null, run = [];
  const flush = () => { if (run.length) { out.push(renderRow(run)); run = []; } };
  mlist.forEach((m) => {
    if (m.section && m.section !== curSec) { flush(); out.push("[" + m.section + "]"); curSec = m.section; curEnd = null; }
    if (m.ending && m.ending !== curEnd) { flush(); out.push("[" + _ordinal(m.ending) + " Ending]"); curEnd = m.ending; }
    run.push(m);
    if (run.length === 4) flush();
  });
  flush();
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

/* ---- MIDI export: score → Standard MIDI File (format 0) -------------------
 * Deterministic + testable like the other exporters (no deps, no browser API):
 * returns a Uint8Array of a single-track SMF. Same timing model as
 * scoreEventTimes / ABC — a "beat" is one (1/beatType) note = 4/beatType quarters,
 * per-bar timeSig honoured (mid-tune meter changes emit a new time-sig meta). It
 * writes the actual voiced pitches (event.midis); the caller passes the already-
 * transposed score, so the .mid matches what's shown and heard. Tempo from
 * opts.tempo (falls back to score.tempo, then 100). PPQ = 480. */
function _midiVarLen(n) {
  n = n >>> 0;
  const out = [n & 0x7f];
  n >>>= 7;
  while (n > 0) { out.unshift((n & 0x7f) | 0x80); n >>>= 7; }
  return out;
}
function scoreToMidi(score, opts = {}) {
  const PPQ = 480;
  const bpm = Math.max(20, Math.min(400, Math.round(opts.tempo || score.tempo || 100)));
  const evs = []; // { tick, order, bytes } — order breaks ties: meta < noteOff < noteOn < endOfTrack
  const uspq = Math.round(60000000 / bpm);
  evs.push({ tick: 0, order: 0, bytes: [0xFF, 0x51, 0x03, (uspq >> 16) & 0xff, (uspq >> 8) & 0xff, uspq & 0xff] });
  let tQ = 0, maxTick = 0, prevSig = null;
  for (const bar of score.bars || []) {
    const sig = bar.timeSig || score.timeSig || [4, 4];
    const bb = sig[0], bt = sig[1];
    const barTick = Math.round(tQ * PPQ);
    if (!prevSig || prevSig[0] !== bb || prevSig[1] !== bt) {
      evs.push({ tick: barTick, order: 0, bytes: [0xFF, 0x58, 0x04, bb & 0xff, Math.max(0, Math.round(Math.log2(bt))) & 0xff, 24, 8] });
      prevSig = [bb, bt];
    }
    const q = (v) => (v * 4) / bt; // beats → quarters
    for (const e of bar.events || []) {
      const startQ = tQ + q(e.qbeat != null ? e.qbeat : e.beat);
      const durQ = Math.max(0.0625, q(e.qdur != null ? e.qdur : e.durBeats));
      const onTick = Math.round(startQ * PPQ);
      const offTick = Math.max(onTick + 1, Math.round((startQ + durQ) * PPQ));
      for (const m of e.midis || []) {
        const note = Math.max(0, Math.min(127, m | 0));
        evs.push({ tick: onTick, order: 2, bytes: [0x90, note, 80] });
        evs.push({ tick: offTick, order: 1, bytes: [0x80, note, 0] });
        if (offTick > maxTick) maxTick = offTick;
      }
    }
    tQ += q(bb);
    if (Math.round(tQ * PPQ) > maxTick) maxTick = Math.round(tQ * PPQ);
  }
  evs.push({ tick: maxTick, order: 3, bytes: [0xFF, 0x2F, 0x00] }); // end of track
  evs.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const track = [];
  let prevTick = 0;
  for (const ev of evs) { track.push(..._midiVarLen(Math.max(0, ev.tick - prevTick)), ...ev.bytes); prevTick = ev.tick; }
  const tl = track.length;
  const bytes = [
    0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) & 0xff, PPQ & 0xff, // MThd: format 0, 1 track, PPQ
    0x4D, 0x54, 0x72, 0x6B, (tl >>> 24) & 0xff, (tl >>> 16) & 0xff, (tl >>> 8) & 0xff, tl & 0xff, // MTrk + length
    ...track,
  ];
  return new Uint8Array(bytes);
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
      const startBeat = e.qbeat != null ? e.qbeat : e.beat;        // TRUE onset (dense lines)
      const durBeats = e.qdur != null ? e.qdur : e.durBeats;       // TRUE duration
      events.push({
        key: `${bar.number}.${e.beat}`, bar: bar.number, midis: e.midis || [],
        start: (tQ + q(startBeat)) * secPerQuarter, dur: Math.max(0.05, q(durBeats) * secPerQuarter),
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


/* ---- public surface ------------------------------------------------------
 * Every top-level engine binding is exported so the UI (TabDecoderPro.tsx),
 * the headless tests, and the future parse Web Worker can all import the ONE
 * engine — single source of truth, no copy, no drift. (Roadmap Wave 1 #1.) */
export {
  makeMask,
  popcount,
  rotateRight,
  toBinary12,
  TUNINGS,
  NOTE_SHARP,
  NOTE_FLAT,
  INTERVAL_LABELS,
  QUALITIES,
  PRESETS,
  parseTab,
  fretToMidi,
  normalise,
  recognise,
  symbolOf,
  symbolForFrets,
  symbolForMidis,
  fretsToMidis,
  median,
  clusterVals,
  estimateSpacing,
  buildChart,
  _fillTrueDur,
  buildScore,
  simplifyScore,
  STEP_SEMI,
  _xEls,
  _xFirst,
  _xText,
  _xChildText,
  _pitchToMidi,
  _parseTuning,
  _tuningName,
  parseMusicXML,
  _GP_NV,
  _gpProp,
  _gpById,
  _gpIds,
  _gpRhythmQuarters,
  _gpRhythmTuplet,
  _gpNoteMidi,
  parseGPIF,
  gpUnzip,
  parseGP,
  _gpReader,
  _GP_TUPLET,
  _gpEndingLabel,
  _gpReadDuration,
  _gpReadBend,
  _gpReadGrace,
  _gpReadNoteEffects,
  _gpReadBeatEffects,
  _gpReadMixTableChange,
  _gpReadChord,
  _gpReadNote,
  _gpReadBeat,
  parseGP345,
  _gpBuildScore,
  _gp5RSEInstrument,
  _gp5Grace,
  _gp5Harmonic,
  _gp5NoteEffects,
  _gp5MixTable,
  _gp5Note,
  _gp5Beat,
  parseGP5,
  _gpxBitReader,
  _gpxLE32,
  _gpxDecompress,
  _gpxReadFS,
  parseGPX,
  _ptbReader,
  _ptbNew,
  _ptbTuning,
  _ptbGuitar,
  _ptbChordName,
  _ptbChordDiagram,
  _ptbFont,
  _ptbFloatingText,
  _ptbGuitarIn,
  _ptbDynamic,
  _ptbSystemSymbol,
  _ptbTempoMarker,
  _ptbDirection,
  _ptbChordText,
  _ptbRhythmSlash,
  _ptbRehearsal,
  _ptbBarline,
  _ptbNote,
  _ptbPosition,
  _ptbStaff,
  _ptbSystem,
  _ptbScore,
  _ptbHeader,
  _ptbTimeSig,
  parsePowerTab,
  parseGuitarProOrXML,
  _PC_BY_NAME,
  _MAJ,
  _MIN,
  _MAJ_Q,
  _MIN_Q,
  _ROMAN,
  _classOf,
  _parseSym,
  qualCompatible,
  analyzeKey,
  _romanExt,
  romanFor,
  keyName,
  _ovSym,
  _ABC_LTR,
  _ABC_ACC,
  midiToAbc,
  _gcd,
  abcDur,
  _abcChordName,
  scoreToABC,
  scoreToChordPro,
  _csmpnSym,
  _CSMPN_DUR,
  _csmpnDurLetter,
  _csmpnTupNormal,
  _csmpnHybridPos,
  _csmpnVoicing,
  _csmPerfHeaders,
  scoreToCSMPN,
  _csmlBeats,
  _ordinal,
  scoreToCSML,
  _STEP_ALTER_SHARP,
  _STEP_ALTER_FLAT,
  _pcStepAlter,
  _XML_KIND,
  _midiToPitchXML,
  _typeForQuarters,
  _harmonyXML,
  scoreToMusicXML,
  transposeScore,
  ARRANGE_TEMPLATES,
  arrangeScore,
  _midiVarLen,
  scoreToMidi,
  scoreEventTimes,
  playScore,
};
