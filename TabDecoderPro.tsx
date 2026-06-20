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
 *   • MUSICXML / GP (Path C/D) — upload a MusicXML score or a Guitar Pro 7/8
 *     `.gp` file; meter, tuning and rhythm are read *exactly* from the file (no
 *     geometry guessing), only chord *symbols* are inferred via the same engine.
 *     Guitar Pro 3/4/5/6/7/8 AND Power Tab (.ptb) all import natively in-browser
 *     with zero new deps (`.gp` ZIP+XML, `.gpx` BCFZ filesystem, `.gp3/4/5` and
 *     `.ptb` binary). See Paths C–G below.
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

/* The recognition engine lives in ./engine.tsx (pure module). The in-browser
 * loader (index.html) transpiles it and rewrites this specifier to a Blob URL;
 * the headless tests import the same file. Import the full engine surface so
 * every call site below resolves exactly as it did when this was one file. */
import {
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
  scoreEventTimes,
  playScore,
} from "./engine.tsx";

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
      // alphaTab PDFs can emit this text-layer artifact between note names; it
      // is not tablature data and must not enter downstream chord clustering.
      if (s === "(single)") continue;
      const m = s.match(/\d+/);
      if (!m) continue;
      tokens.push({ x: it.transform[4], y: vp.height - it.transform[5], val: parseInt(m[0], 10), page: p });
    }
  }
  return { tokens, pages: pdf.numPages };
}

/* ==========================================================================
 *  SESSION PERSISTENCE (Roadmap Wave 1 #2) — OPFS + localStorage fallback
 *
 *  Turns the app from a one-shot decoder into a persistent workspace: the
 *  uploaded file's RAW BYTES are cached (OPFS — quota-free — when available,
 *  else a base64 localStorage fallback for small files) and a small JSON of
 *  UI state (mode, filename, spelling, part, chord overrides) rides in
 *  localStorage. On re-open we re-run the SAME validated parser paths the file
 *  inputs use (no separate restore path to drift), then re-apply the saved
 *  edits — so closing the tab no longer loses your work.
 *
 *  Why re-parse instead of serialising the score: score objects carry
 *  non-JSON re-parse state (_gpbuf / _gpxbuf / _ptbbuf / id-maps) that the
 *  ♯/♭ + part-switch need. Re-parsing from the cached bytes restores FULL
 *  fidelity for free and reuses code already validated by `npm test`. The
 *  Wave 1 #3 worker will make that re-parse non-blocking.
 *
 *  Everything here is browser-only (OPFS API + base64) — like extractTokens /
 *  playScore it's smoke-tested on hardware; `npm test` statically guards the
 *  contract (feature-detect, try/catch, localStorage fallback, one-shot). */
const SESS_META = "ttp:session:v1";   // localStorage: small UI-state JSON
const SESS_BIN_LS = "ttp:session:bin:v1"; // localStorage: base64 bytes (fallback only)
const SESS_BIN_OPFS = "session.bin";  // OPFS: raw file bytes (preferred)
const SESS_LS_MAX = 3_000_000;        // don't base64 huge files into localStorage

async function _opfsDir() {
  try {
    if (!navigator.storage || !navigator.storage.getDirectory) return null;
    return await navigator.storage.getDirectory();
  } catch (_) { return null; }
}
// OPFS write needs main-thread createWritable (Chrome; Safari 16.4+). Where it's
// missing (older Safari) we fall back to localStorage, so persistence still works.
async function _opfsWrite(bytes) {
  const dir = await _opfsDir(); if (!dir) return false;
  try {
    const fh = await dir.getFileHandle(SESS_BIN_OPFS, { create: true });
    if (typeof fh.createWritable !== "function") return false;
    const w = await fh.createWritable();
    await w.write(bytes); await w.close();
    return true;
  } catch (_) { return false; }
}
async function _opfsRead() {
  const dir = await _opfsDir(); if (!dir) return null;
  try {
    const fh = await dir.getFileHandle(SESS_BIN_OPFS);
    const f = await fh.getFile();
    return new Uint8Array(await f.arrayBuffer());
  } catch (_) { return null; }
}
async function _opfsRemove() {
  const dir = await _opfsDir(); if (!dir) return;
  try { await dir.removeEntry(SESS_BIN_OPFS); } catch (_) {}
}
const _bytesToB64 = (bytes) => { let s = ""; for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s); };
const _b64ToBytes = (b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };

// Persist the source bytes once (on upload/decode); chooses OPFS, else localStorage.
async function saveSessionFile(bytes) {
  try {
    const ok = await _opfsWrite(bytes);
    if (ok) { try { localStorage.removeItem(SESS_BIN_LS); } catch (_) {} return "opfs"; }
    if (bytes.length <= SESS_LS_MAX) { localStorage.setItem(SESS_BIN_LS, _bytesToB64(bytes)); return "ls"; }
    return "none"; // too big for localStorage and no OPFS — meta still saved, bytes won't restore
  } catch (err) { console.warn("session file save skipped:", err); return "none"; }
}
const saveSessionMeta = (meta) => { try { localStorage.setItem(SESS_META, JSON.stringify(meta)); } catch (err) { console.warn("session meta save skipped:", err); } };
const readSessionMeta = () => { try { const r = localStorage.getItem(SESS_META); return r ? JSON.parse(r) : null; } catch (_) { return null; } };
async function readSessionFile() {
  const fromOpfs = await _opfsRead();
  if (fromOpfs) return fromOpfs;
  try { const b = localStorage.getItem(SESS_BIN_LS); return b ? _b64ToBytes(b) : null; } catch (_) { return null; }
}
async function clearSession() {
  try { localStorage.removeItem(SESS_META); localStorage.removeItem(SESS_BIN_LS); } catch (_) {}
  await _opfsRemove();
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
  const [restored, setRestored] = useState(false); // showing a restored-from-cache session
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
      const bytes = new Uint8Array(buf.slice(0)); // copy for the session cache (PDF.js may detach buf)
      const { tokens, pages } = await extractTokens(buf);
      const c = buildChart(tokens);
      if (!c.measures.length) setPdfErr("No tab measures detected. Is this a digital (text) tab PDF rather than a scan?");
      setChart({ ...c, pages, fileName: f.name });
      setRestored(false);
      saveSessionFile(bytes); // meta is written by the persist effect
    } catch (err) {
      setPdfErr("Parse failed: " + (err && err.message ? err.message : String(err)));
    } finally { setPdfBusy(false); }
  };

  // Re-run the right parser for a stored score (MusicXML text or gpif XML).
  // Both store their source XML in _xml and produce the same score shape, so the
  // ♯/♭ re-spell and part-switch are identical for Path C and Path D.
  const _reparseScore = (prev, sharp, idx) => {
    if (!prev) return prev;
    let next;
    if (prev._ptbbuf) next = parsePowerTab(prev._ptbbuf, sharp, idx);           // Power Tab .ptb
    else if (prev._gpxbuf) next = parseGPX(prev._gpxbuf, sharp, idx);            // GP6 .gpx
    else if (prev._gpbuf) next = parseGP345(prev._gpbuf, sharp, idx);            // GP3/4/5 binary
    else if (prev._xml) next = prev.source === "gp" ? parseGPIF(prev._xml, sharp, idx) : parseMusicXML(prev._xml, sharp, idx);
    else return prev;
    next._gpbuf = prev._gpbuf; next._xml = prev._xml; next._gpxbuf = prev._gpxbuf; next._ptbbuf = prev._ptbbuf; return next;
  };

  const onXml = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setXmlErr(""); setXmlScore(null); clearSel();
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const sc = await parseGuitarProOrXML(bytes, f.name, useSharp); // MusicXML / GP3-8 auto-detect
      if (!sc.bars.length) setXmlErr("No measures found. Is this a MusicXML score or a Guitar Pro file?");
      setXmlScore(sc); setXmlName(f.name);
      setRestored(false);
      saveSessionFile(bytes); // meta is written by the persist effect
    } catch (err) {
      setXmlErr("Parse failed: " + (err && err.message ? err.message : String(err)));
    }
  };

  // re-recognise symbols when the sharp/flat spelling flips (keep part)
  useEffect(() => {
    setXmlScore((prev) => _reparseScore(prev, useSharp, prev ? prev.partIndex : 0));
  }, [useSharp]);

  /* ---- Reverse handoff RECEIVER — "Decode this tab" from Chord Sheet Maker Pro ----
   * The finishing apps (same GitHub Pages origin → shared localStorage) can hand a
   * raw GP/MusicXML/Power Tab/PDF file BACK here for recognition with this engine.
   * Contract mirrors the forward one: opened at `?import=decode`, the file bytes ride
   * in `ttp:decode:v1` as base64. We decode once on mount into a ref, then process it
   * (PDF waits for PDF.js via pdfReady) through the SAME paths the file inputs use, so
   * it lands on the right mode with a chart. One-shot + try/catch so a bad payload can
   * never wedge boot. See chord-sheet-maker/docs/HANDOFF-CONTRACT.md. */
  const decodeRef = useRef(null);
  const [decodeReq, setDecodeReq] = useState(0);
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.get("import") !== "decode") return;
      const raw = localStorage.getItem("ttp:decode:v1");
      localStorage.removeItem("ttp:decode:v1"); // one-shot
      if (window.history && history.replaceState) history.replaceState(null, "", window.location.pathname);
      if (!raw) return;
      const env = JSON.parse(raw);
      if (!env || env.v !== 1 || !env.b64) return;
      const bin = atob(env.b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      decodeRef.current = { bytes, filename: env.filename || "decoded tab" };
      setDecodeReq((n) => n + 1);
    } catch (err) { console.warn("decode handoff skipped:", err); }
  }, []);
  useEffect(() => {
    const d = decodeRef.current; if (!d) return;
    const isPdf = d.bytes[0] === 0x25 && d.bytes[1] === 0x50 && d.bytes[2] === 0x44 && d.bytes[3] === 0x46; // %PDF
    if (isPdf && !pdfReady) return; // wait for PDF.js to load
    decodeRef.current = null;
    setRestored(false);
    saveSessionFile(new Uint8Array(d.bytes.slice(0))); // a decoded tab becomes a restorable session too
    (async () => {
      if (isPdf) {
        setMode("pdf"); setPdfErr(""); setPdfBusy(true); setChart(null); clearSel();
        try {
          const { tokens, pages } = await extractTokens(d.bytes.buffer);
          const c = buildChart(tokens);
          if (!c.measures.length) setPdfErr("No tab measures detected. Is this a digital (text) tab PDF rather than a scan?");
          setChart({ ...c, pages, fileName: d.filename });
        } catch (err) { setPdfErr("Parse failed: " + (err && err.message ? err.message : String(err))); }
        finally { setPdfBusy(false); }
      } else {
        setMode("xml"); setXmlErr(""); setXmlScore(null); clearSel();
        try {
          const sc = await parseGuitarProOrXML(d.bytes, d.filename, useSharp);
          if (!sc.bars.length) setXmlErr("No measures found. Is this a MusicXML score or a Guitar Pro file?");
          setXmlScore(sc); setXmlName(d.filename);
        } catch (err) { setXmlErr("Parse failed: " + (err && err.message ? err.message : String(err))); }
      }
    })();
  }, [decodeReq, pdfReady]);

  const selectPart = (idx) => {
    setXmlScore((prev) => _reparseScore(prev, useSharp, idx));
    clearSel();
  };

  /* ---- Session persistence (Wave 1 #2) -----------------------------------
   * SAVE: the upload handlers cache the raw bytes once (saveSessionFile); this
   * effect keeps the small UI-state meta in sync as the chart, spelling, part,
   * or chord overrides change. RESTORE: on mount (unless an import param is
   * present — an incoming handoff/decode wins) we re-run the SAME parser paths
   * the file inputs use, gated on pdfReady for PDFs, then re-apply saved edits.
   * Mirror of the decode receiver: one-shot via a ref, wrapped in try/catch so
   * a stale/garbage cache can never wedge boot. */
  const restoringRef = useRef(false); // suppress transient meta writes mid-restore
  useEffect(() => {
    if (restoringRef.current) return; // the restore effect re-affirms meta itself
    const active = (mode === "pdf" && chart) ? { kind: "pdf", filename: chart.fileName }
                 : (mode === "xml" && xmlScore) ? { kind: "xml", filename: xmlName } : null;
    if (!active) return;
    saveSessionMeta({ v: 1, kind: active.kind, filename: active.filename, useSharp, overrides, partIndex: xmlScore ? (xmlScore.partIndex || 0) : 0 });
  }, [mode, chart, xmlScore, xmlName, overrides, useSharp]);

  const restoreRef = useRef(null);
  const [restoreReq, setRestoreReq] = useState(0);
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.get("import") === "decode" || p.get("import") === "handoff") return; // incoming import wins
      const meta = readSessionMeta();
      if (!meta || (meta.kind !== "pdf" && meta.kind !== "xml")) return;
      restoreRef.current = meta;
      setRestoreReq((n) => n + 1);
    } catch (err) { console.warn("session restore skipped:", err); }
  }, []);
  useEffect(() => {
    const meta = restoreRef.current; if (!meta) return;
    if (meta.kind === "pdf" && !pdfReady) return; // wait for PDF.js
    restoreRef.current = null;
    restoringRef.current = true;
    (async () => {
      try {
        const bytes = await readSessionFile();
        if (!bytes) { restoringRef.current = false; return; } // bytes evicted / too big — nothing to restore
        const sharp = meta.useSharp !== false;
        setUseSharp(sharp);
        if (meta.kind === "pdf") {
          setMode("pdf"); setPdfErr(""); setPdfBusy(true); setChart(null); clearSel();
          try {
            const { tokens, pages } = await extractTokens(bytes.buffer);
            const c = buildChart(tokens);
            setChart({ ...c, pages, fileName: meta.filename || "restored.pdf" });
          } finally { setPdfBusy(false); }
        } else {
          setMode("xml"); setXmlErr(""); setXmlScore(null); clearSel();
          let sc = await parseGuitarProOrXML(bytes, meta.filename || "restored", sharp);
          if (meta.partIndex) sc = _reparseScore(sc, sharp, meta.partIndex);
          setXmlScore(sc); setXmlName(meta.filename || "restored");
        }
        if (meta.overrides && Object.keys(meta.overrides).length) setOverrides(meta.overrides);
        setRestored(true);
        saveSessionMeta(meta); // re-affirm the restored state in one clean write
      } catch (err) { console.warn("session restore failed:", err); }
      finally { restoringRef.current = false; }
    })();
  }, [restoreReq, pdfReady]);

  const startFresh = async () => {
    try { await clearSession(); } catch (_) {}
    setChart(null); setXmlScore(null); setXmlName(""); setMode("manual"); clearSel(); setRestored(false);
  };

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
            {[["manual", "Manual"], ["pdf", "PDF Chart"], ["xml", "MusicXML / GP"]].map(([m, lbl]) => (
              <button key={m} onClick={() => { setMode(m); clearSel(); }} style={{ ...toggle(C), padding: "6px 14px", flex: "none", ...(mode === m ? activeToggle(C) : {}) }}>
                {lbl}
              </button>
            ))}
          </div>
        </header>

        {restored && (
          <div className="panel-rise" style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 14, padding: "8px 12px", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 12, color: C.dim }}>
            <span>↺ Restored your last session — your chart and edits are back. Upload a new file or</span>
            <button onClick={startFresh} style={{ ...toggle(C), padding: "4px 12px", flex: "none" }}>Start fresh</button>
          </div>
        )}

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
                      <button onClick={() => setUseSharp(true)} style={{ ...toggle(C), ...(useSharp ? activeToggle(C) : {}) }}>Default ♯♭</button>
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
                <SectionLabel C={C}>PATH C/D/E/F/G · MUSICXML · GUITAR PRO · POWER TAB → CHORD CHART</SectionLabel>
                {/* No `accept` filter on purpose: iOS maps `accept` extensions to UTIs, and
                    .gp/.gpx/.gp3/.gp4/.gp5/.ptb have no registered UTI, so iOS greys them out
                    (unselectable). Leaving it unset lets every file be picked on all platforms.
                    Do NOT re-add an extension allowlist here — it breaks GP/Power Tab upload on iOS. */}
                <input ref={xmlRef} type="file" onChange={onXml} style={{ display: "none" }} />
                <button onClick={() => xmlRef.current && xmlRef.current.click()}
                  style={{ width: "100%", background: C.bg, border: `1px dashed ${C.border}`, color: C.amber, borderRadius: 10, padding: "22px 12px", fontSize: 14, cursor: "pointer", fontFamily: "'IBM Plex Mono', monospace" }}>
                  ⬆  Upload a MusicXML, Guitar Pro or Power Tab file
                </button>
                <div style={{ fontSize: 11, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>
                  Reads <b>real</b> time signature, tuning &amp; rhythm straight from the file — no geometry guessing. Native: <b>MusicXML</b>, Guitar Pro <b>.gp</b> (7/8) / <b>.gpx</b> (6) / <b>.gp3 / .gp4 / .gp5</b>, and Power Tab <b>.ptb</b>.
                </div>
                {xmlErr && <div style={{ marginTop: 10, color: C.red, fontSize: 12 }}>{xmlErr}</div>}
                {xmlScore && xmlScore.parts && xmlScore.parts.length > 1 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 12 }}>
                    <span style={{ fontSize: 10, letterSpacing: 2, color: C.dim }}>PART</span>
                    {xmlScore.parts.map((p) => (
                      <button key={p.index} onClick={() => selectPart(p.index)} title={`chart the "${p.name}" part`}
                        style={{ ...chip(C), padding: "3px 9px", borderColor: xmlScore.partIndex === p.index ? C.amber : C.border, color: xmlScore.partIndex === p.index ? C.amber : C.dim }}>{p.name}</button>
                    ))}
                  </div>
                )}
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
  const [sent, setSent] = useState(false);
  const [bpm, setBpm] = useState(score.tempo || 100);
  const [playing, setPlaying] = useState(false);
  const [playKey, setPlayKey] = useState("");
  const player = useRef(null);

  const [showRoman, setShowRoman] = useState(false);
  const [simplify, setSimplify] = useState(false);

  const base = useMemo(() => (simplify ? simplifyScore(score, useSharp) : score), [simplify, score, useSharp]);
  const tscore = useMemo(() => transposeScore(base, semis, useSharp), [base, semis, useSharp]);
  const key = useMemo(() => analyzeKey(tscore), [tscore]);
  // "Mostly single notes" → the chart is a melodic line (e.g. a single-note PDF/tab
  // head), not block harmony. Simplify (1 chord/bar) duration-weights each bar's notes
  // into one inferred chord, which is the right tool there — so nudge the user to it.
  const melodic = useMemo(() => {
    let total = 0, single = 0;
    score.bars.forEach((b) => b.events.forEach((e) => { total++; if (e.midis && e.midis.length === 1) single++; }));
    return total >= 4 && single / total >= 0.5;
  }, [score]);

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
    const text = fmt === "abc" ? scoreToABC(tscore, opts)
      : fmt === "musicxml" ? scoreToMusicXML(tscore, opts)
      : fmt === "csmpn" ? scoreToCSMPN(tscore, opts)
      : fmt === "csml" ? scoreToCSML(tscore, opts)
      : scoreToChordPro(tscore, opts);
    setExp({ fmt, text }); setCopied(false);
  };
  const copy = () => { try { navigator.clipboard.writeText(exp.text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (_) {} };
  /* ---- Direct handoff → Chord Sheet Maker Pro --------------------------------
   * Both apps are served from the SAME GitHub Pages origin
   * (quantumq1981.github.io), so they share localStorage. We write the chart
   * into the versioned handoff envelope Pro already listens for
   * (`csm:handoff:v1` + `?import=handoff`; see chord-sheet-maker/docs/
   * HANDOFF-CONTRACT.md) and navigate to Pro, which loads it via its own
   * import pipeline. CSMPN is Pro's native source (preferred); ChordPro +
   * MusicXML ride along as fallbacks. MusicXML is dropped when large to stay
   * inside the localStorage quota. Same-tab navigation avoids mobile popup
   * blocking. Wrapped in try/catch so a failure never wedges the UI. */
  const sendToPro = () => {
    try {
      const opts = { overrides, title, key, useSharp, tempo: bpm };
      const formats = { csmpn: scoreToCSMPN(tscore, opts), chordpro: scoreToChordPro(tscore, opts) };
      try { const xml = scoreToMusicXML(tscore, opts); if (xml && xml.length < 1500000) formats.musicxml = xml; } catch (_) {}
      const env = {
        v: 1,
        source: "tab-translator-pro",
        createdAt: new Date().toISOString(),
        title: title || "Tab Decoder chart",
        transposeSemitones: semis,
        enharmonic: useSharp ? "sharps" : "flats",
        formats,
      };
      localStorage.setItem("csm:handoff:v1", JSON.stringify(env));
      setSent(true);
      window.location.assign(`${window.location.origin}/chord-sheet-maker-pro/?import=handoff`);
    } catch (e) { setSent(false); console.warn("Send to Pro failed:", e); }
  };
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
        <button onClick={() => setSimplify((s) => !s)} title="aggregate each bar's notes into one chord (for dense transcriptions)"
          style={{ ...chip(C), padding: "3px 9px", borderColor: simplify ? C.green : C.border, color: simplify ? C.green : C.dim }}>{simplify ? "1 chord/bar ✓" : "Simplify"}</button>
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
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4 }}>
          {[["chordpro", "ChordPro"], ["abc", "ABC"], ["musicxml", "MusicXML"], ["csmpn", "CSMPN"], ["csml", "ChordSlashML"]].map(([f, lbl]) => (
            <button key={f} onClick={() => doExport(f)} style={{ ...chip(C), padding: "3px 9px", borderColor: exp && exp.fmt === f ? C.cyan : C.border, color: exp && exp.fmt === f ? C.cyan : C.dim }}>{lbl}</button>
          ))}
          <span style={{ width: 1, alignSelf: "stretch", background: C.border, margin: "0 2px" }} />
          <button onClick={sendToPro} title="Open this chart in Chord Sheet Maker Pro (native CSMPN handoff)"
            style={{ ...chip(C), padding: "3px 10px", borderColor: sent ? C.green : C.amber, color: sent ? C.green : C.amber, fontWeight: 600 }}>{sent ? "opening Pro ✓" : "→ Chord Sheet Maker Pro"}</button>
        </span>
      </div>

      {melodic && !simplify && (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, fontSize: 11, color: C.amber, background: "rgba(233,162,75,0.08)", border: `1px solid ${C.amber}`, borderRadius: 8, padding: "7px 10px", marginBottom: 10 }}>
          <span style={{ flex: "1 1 240px" }}>♪ Mostly single notes — this looks like a melodic line, not block chords. <b>Simplify</b> infers one chord per bar from the notes that sound.</span>
          <button onClick={() => setSimplify(true)} style={{ ...chip(C), padding: "3px 10px", borderColor: C.amber, color: C.amber, fontWeight: 600 }}>Turn on Simplify</button>
        </div>
      )}

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
            <span style={{ fontSize: 10, letterSpacing: 2, color: C.dim }}>EXPORT · {exp.fmt === "abc" ? "ABC NOTATION" : exp.fmt === "musicxml" ? "MUSICXML" : exp.fmt === "csmpn" ? "CSMPN" : exp.fmt === "csml" ? "CHORDSLASHML" : "CHORDPRO"}</span>
            <span style={{ display: "inline-flex", gap: 6 }}>
              <button onClick={copy} style={{ ...chip(C), padding: "3px 9px", borderColor: copied ? C.green : C.border, color: copied ? C.green : C.dim }}>{copied ? "copied ✓" : "copy"}</button>
              <button onClick={() => setExp(null)} style={{ ...chip(C), padding: "3px 9px" }}>close</button>
            </span>
          </div>
          <textarea readOnly value={exp.text} spellCheck={false} className="tdp-scroll"
            style={{ width: "100%", height: 120, resize: "vertical", boxSizing: "border-box", background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, fontSize: 12, lineHeight: 1.5, fontFamily: "'IBM Plex Mono', monospace", outline: "none" }} />
          {exp.fmt === "abc" && <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>Real, playable notes + chord symbols — paste into any ABC player (e.g. abcjs / editor at abcnotation.com) to hear it.</div>}
          {exp.fmt === "musicxml" && <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>Save as <b>.musicxml</b> and open in MuseScore / Guitar Pro — carries chord symbols + notes + meter. Round-trips back into this app.</div>}
          {exp.fmt === "csmpn" && <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}><b>Chord Sheet Maker Pro</b>'s native fake-book source (one chord = one bar; <code>_</code> splits a bar) — also carries the real fingering (<code>{"{tab}"}</code>) and decoded strum rhythm (<code>{"{hybrid}"}</code>). Paste into Pro's editor, or use <b>→ Chord Sheet Maker Pro</b> to send it straight there.</div>}
          {exp.fmt === "csml" && <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}><b>ChordSlashML</b> — Pro's beat-slotted notation (<code>{"|"}</code> measures, <code>_</code> holds, <code>.</code> rests). Paste into Pro's <b>ChordSlashML</b> live editor.</div>}
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
