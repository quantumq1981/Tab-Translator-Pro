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
  CHORD_CLASSIFIER,
  classifyChromaQuality,
  arbitrateChord,
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
  isMelodicScore,
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
  describeScore,
  scoreToMusicPrompt,
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
  freqToMidi,
  midiToFreq,
  midiToNoteName,
  midiToStaffPos,
  staffLayout,
  detectPitch,
  transcribeMonophonic,
  _fft,
  pcmToChroma,
  chordFromChroma,
  extractCenter,
  harmonicClarity,
  transcribeWithNoteModel,
  detectChord,
  transcribeChords,
  audioEventsToScore,
  _cosDist,
  _dtw,
  scoreChromaSequence,
  pcmChromaSequence,
  alignPcmToScore,
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

/* ==========================================================================
 *  PARSE WEB WORKER (Roadmap Wave 1 #3) — non-blocking binary parsing
 *
 *  Dense binary parsers (parseGP345 / parsePowerTab) are pure-JS byte loops that
 *  can block the main thread for 100s of ms on a large file — noticeable jank,
 *  especially on mobile Safari. We run them off-thread in a module Worker that
 *  imports the SAME transpiled engine the UI uses (published at a Blob URL by the
 *  index.html loader as window.__TTP_ENGINE_URL__) — one engine, no copy, no drift.
 *
 *  HONEST LIMIT: only DOMParser-free parsers can run here. DOMParser is window-
 *  only (absent in Workers), so the XML-based paths (MusicXML, GP6/7/8 gpif) stay
 *  on the main thread — the browser's native XML parser is fast C++ anyway. We
 *  route GP3/4/5 + Power Tab to the worker and everything else stays main-thread.
 *
 *  PROGRESSIVE ENHANCEMENT: every call falls back to the identical main-thread
 *  engine call if the worker is unavailable or errors, so correctness NEVER
 *  depends on the worker (it's pure offloading). This RPC infra is also the home
 *  for the Wave 3 ONNX classifier. Browser-only glue — smoke-test on hardware. */
let _engineWorker = null, _engineWorkerDead = false, _rpcSeq = 0;
const _rpcPending = new Map();
function _getEngineWorker() {
  if (_engineWorker || _engineWorkerDead) return _engineWorker;
  try {
    const engineUrl = typeof window !== "undefined" && window.__TTP_ENGINE_URL__;
    if (!engineUrl || typeof Worker === "undefined") { _engineWorkerDead = true; return null; }
    const code =
      "import * as E from " + JSON.stringify(engineUrl) + ";\n" +
      "self.onmessage = async (ev) => {\n" +
      "  const { id, fn, args } = ev.data;\n" +
      "  try { const result = await E[fn](...args); self.postMessage({ id, ok: true, result }); }\n" +
      "  catch (err) { self.postMessage({ id, ok: false, error: String((err && err.message) || err) }); }\n" +
      "};";
    const w = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })), { type: "module" });
    w.onmessage = (ev) => {
      const { id, ok, result, error } = ev.data || {};
      const p = _rpcPending.get(id); if (!p) return;
      _rpcPending.delete(id);
      ok ? p.resolve(result) : p.reject(new Error(error || "worker error"));
    };
    w.onerror = () => { _engineWorkerDead = true; _engineWorker = null; _rpcPending.forEach((p) => p.reject(new Error("worker crashed"))); _rpcPending.clear(); };
    _engineWorker = w;
    return w;
  } catch (_) { _engineWorkerDead = true; return null; }
}
function _engineRPC(fn, args) {
  return new Promise((resolve, reject) => {
    const w = _getEngineWorker();
    if (!w) { reject(new Error("no engine worker")); return; }
    const id = ++_rpcSeq;
    _rpcPending.set(id, { resolve, reject });
    try { w.postMessage({ id, fn, args }); } catch (err) { _rpcPending.delete(id); reject(err); }
  });
}
// True only for DOMParser-free formats the worker can actually parse.
function _workerableBytes(bytes) {
  try { const head = new TextDecoder("latin1").decode(bytes.subarray(0, 32)); return head.includes("FICHIER GUITAR PRO") || head.startsWith("ptab"); }
  catch (_) { return false; }
}
// bytes -> score, off-thread when possible; ALWAYS falls back to the same engine
// call on the main thread so a missing/broken worker never changes the result.
async function parseScoreOffThread(bytes, filename, sharp) {
  if (_workerableBytes(bytes)) {
    try { return await _engineRPC("parseGuitarProOrXML", [bytes, filename, sharp]); }
    catch (err) { console.warn("worker parse fell back to main thread:", err && err.message); }
  }
  return parseGuitarProOrXML(bytes, filename, sharp);
}
/* PCM → chord/note events, off-thread when possible (the analysis is a heavy pure-JS
 * FFT/YIN loop that would jank the main thread on a long stem); ALWAYS falls back to
 * the identical main-thread engine call so correctness never depends on the worker. */
async function analyzeAudioOffThread(samples, sr, kind, opts = {}) {
  const fn = kind === "notes" ? "transcribeMonophonic" : "transcribeChords";
  try { return await _engineRPC(fn, [samples, sr, opts]); }
  catch (_) { return (kind === "notes" ? transcribeMonophonic : transcribeChords)(samples, sr, opts); }
}
/* DTW audio↔score alignment off-thread (heavy: FFTs + DP), main-thread fallback. */
async function alignPcmToScoreOffThread(samples, sr, score, opts = {}) {
  try { return await _engineRPC("alignPcmToScore", [samples, sr, score, opts]); }
  catch (_) { return alignPcmToScore(samples, sr, score, opts); }
}
/* Center-channel (vocal) isolation off-thread (heavy: STFT/ISTFT), main-thread fallback. */
async function extractCenterOffThread(left, right, sr, opts = {}) {
  try { return await _engineRPC("extractCenter", [left, right, sr, opts]); }
  catch (_) { return extractCenter(left, right, sr, opts); }
}
/* Harmonic-clarity metric off-thread (FFT pass), main-thread fallback. */
async function harmonicClarityOffThread(samples, sr, opts = {}) {
  try { return await _engineRPC("harmonicClarity", [samples, sr, opts]); }
  catch (_) { return harmonicClarity(samples, sr, opts); }
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
  const [xmlBusy, setXmlBusy] = useState(false); // parsing GP/MusicXML (may be off-thread)
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
    setXmlErr(""); setXmlScore(null); setXmlBusy(true); clearSel();
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const sc = await parseScoreOffThread(bytes, f.name, useSharp); // MusicXML / GP3-8 auto-detect (binary GP/PTB off-thread)
      if (!sc.bars.length) setXmlErr("No measures found. Is this a MusicXML score or a Guitar Pro file?");
      setXmlScore(sc); setXmlName(f.name);
      setRestored(false);
      saveSessionFile(bytes); // meta is written by the persist effect
    } catch (err) {
      setXmlErr("Parse failed: " + (err && err.message ? err.message : String(err)));
    } finally { setXmlBusy(false); }
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
        setMode("xml"); setXmlErr(""); setXmlScore(null); setXmlBusy(true); clearSel();
        try {
          const sc = await parseScoreOffThread(d.bytes, d.filename, useSharp);
          if (!sc.bars.length) setXmlErr("No measures found. Is this a MusicXML score or a Guitar Pro file?");
          setXmlScore(sc); setXmlName(d.filename);
        } catch (err) { setXmlErr("Parse failed: " + (err && err.message ? err.message : String(err))); }
        finally { setXmlBusy(false); }
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
          setMode("xml"); setXmlErr(""); setXmlScore(null); setXmlBusy(true); clearSel();
          try {
            let sc = await parseScoreOffThread(bytes, meta.filename || "restored", sharp);
            if (meta.partIndex) sc = _reparseScore(sc, sharp, meta.partIndex);
            setXmlScore(sc); setXmlName(meta.filename || "restored");
          } finally { setXmlBusy(false); }
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
  // Wave 3 #10 — DISPLAY-ONLY second opinion. The engine stays the oracle: arbitrateChord
  // only consults the classifier when the engine is unsure, and we surface its read as a
  // supplementary readout line — we NEVER rewrite `symbol`/the chart (that preserves the
  // validated corpus). chromaVec = the 12-bit absolute mask expanded to a 0/1 vector.
  const arb = useMemo(() => {
    if (!result || result.single || !result.best) return null;
    const chromaVec = Array.from({ length: 12 }, (_, i) => (norm.chordMask >> i) & 1);
    return arbitrateChord(result, chromaVec, {});
  }, [result, norm.chordMask]);

  const scoreView = useMemo(() => (chart ? buildScore(chart, useSharp) : null), [chart, useSharp]);

  const names = useSharp ? NOTE_SHARP : NOTE_FLAT;
  const symbol = symbolOf(result, useSharp);
  const best = result && !result.single ? result.best : null;
  const conf = best ? best.confidence : 0;
  const confColor = conf >= 0.999 ? "#98c379" : conf >= 0.7 ? "#57d1d6" : "#e9a24b";
  const applyPreset = (p) => { setTuningName(p.tuning); setTab(p.tab); setBlockIdx(0); };

  const C = { bg: "#0b0b0f", panel: "#17171d", raised: "#22222b", border: "#33333d",
    text: "#efe9dc", dim: "#9aa0a6", amber: "#ff6b35", chord: "#ffd9c7", cyan: "#57d1d6", red: "#e06c75", green: "#98c379" };
    // Family 1 "stage" palette (dark). amber = the brand orange (#ff6b35) and
    // chord = the warm family chord tone (#ffd9c7). The cyan /
    // red / green and the confidence-scale amber (confColor above, #e9a24b) stay as
    // semantic status colors, not the brand.

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100%", fontFamily: "'IBM Plex Mono', ui-monospace, monospace" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Space+Mono:wght@400;700&display=swap');
        @keyframes glowpulse {0%{transform:scale(.97);opacity:0;}100%{transform:scale(1);opacity:1;}}
        @keyframes rise {from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
        @keyframes pulse {0%,100%{opacity:1;}50%{opacity:.25;}}
        .panel-rise{animation:rise .5s cubic-bezier(.2,.7,.2,1) both;}
        .chord-pop{animation:glowpulse .35s ease-out;}
        .led{transition:background .18s ease,box-shadow .18s ease,color .18s ease;}
        .tdp-scroll::-webkit-scrollbar{width:8px;height:8px;}
        .tdp-scroll::-webkit-scrollbar-thumb{background:#33333d;border-radius:8px;}
        textarea::placeholder{color:#5a605d;}
        .meas:hover{border-color:#ff6b3588!important;}
        .tdp-cols{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:16px;}
        .tdp-cols.manual{grid-template-columns:minmax(0,1fr) minmax(0,1fr);}
        @media (max-width:760px){.tdp-cols,.tdp-cols.manual{grid-template-columns:1fr;}}
        @media print {
          /* scroll boxes only print their visible slice → everything below the fold
             was being cut off. Expand them so the whole chart prints. */
          .tdp-scroll{max-height:none!important;overflow:visible!important;}
          .tdp-cols,.tdp-cols.manual{grid-template-columns:1fr!important;}
          .no-print{display:none!important;}
          /* keep the styled colours on paper + don't split a bar/card across pages */
          *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;}
          .meas,.tdp-bar{break-inside:avoid;page-break-inside:avoid;}
          textarea.tdp-scroll{height:auto!important;}
        }
      `}</style>

      <div style={{ position: "relative", maxWidth: 1100, margin: "0 auto", padding: "20px 16px 40px" }}>
        <header className="panel-rise" style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 22, letterSpacing: 1 }}>TAB<span style={{ color: C.amber }}>·</span>DECODER</span>
            <span style={{ color: C.dim, fontSize: 12, letterSpacing: 3 }}>TABTRANSLATOR PRO</span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {[["manual", "Manual"], ["pdf", "PDF Chart"], ["xml", "MusicXML / GP"], ["audio", "Audio 🎵"], ["lyrics", "Lyrics 🎙️"], ["tuner", "Tuner 🎤"]].map(([m, lbl]) => (
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

        {mode === "tuner" ? <LiveTuner C={C} useSharp={useSharp} /> : mode === "lyrics" ? <LyricsCapture C={C} /> : mode === "audio" ? <AudioImport C={C} useSharp={useSharp} /> : (
        <div className={"tdp-cols" + (mode === "manual" ? " manual" : "")} style={{ position: "relative" }}>
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
                <button onClick={() => xmlRef.current && xmlRef.current.click()} disabled={xmlBusy}
                  style={{ width: "100%", background: C.bg, border: `1px dashed ${C.border}`, color: C.amber, borderRadius: 10, padding: "22px 12px", fontSize: 14, cursor: xmlBusy ? "default" : "pointer", fontFamily: "'IBM Plex Mono', monospace" }}>
                  {xmlBusy ? "parsing…" : "⬆  Upload a MusicXML, Guitar Pro or Power Tab file"}
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
              <div key={symbol} className="chord-pop" style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 54, lineHeight: 1, color: C.chord }}>{symbol}</div>
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

            {arb && arb.source === "classifier" && arb.secondOpinion && (
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 16, padding: "8px 11px", background: "rgba(87,209,214,0.07)", border: `1px dashed ${C.cyan}`, borderRadius: 8, fontSize: 12 }}>
                <span style={{ color: C.cyan, fontWeight: 600 }}>🤖 2nd opinion</span>
                <span style={{ color: C.text, fontFamily: "'Space Mono', monospace", fontWeight: 700 }}>{names[arb.secondOpinion.root]}{arb.secondOpinion.quality.suffix}</span>
                <span style={{ color: C.dim }}>· {Math.round(arb.secondOpinion.confidence * 100)}% model</span>
                <span style={{ flexBasis: "100%", color: C.dim, fontSize: 10, lineHeight: 1.4 }}>engine was unsure ({Math.round(conf * 100)}%); shown for reference — the chart keeps the engine's read.</span>
              </div>
            )}

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
        )}

        <footer className="no-print" style={{ position: "relative", marginTop: 18, fontSize: 11, color: C.dim, lineHeight: 1.6 }}>
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
  const [downloaded, setDownloaded] = useState(false);
  const [sent, setSent] = useState(false);
  const [bpm, setBpm] = useState(score.tempo || 100);
  const [playing, setPlaying] = useState(false);
  const [playKey, setPlayKey] = useState("");
  const player = useRef(null);
  const [refName, setRefName] = useState("");      // reference-audio (a recording to play along with the chart)
  const [refPlaying, setRefPlaying] = useState(false);
  const [refErr, setRefErr] = useState("");
  const [alignSegs, setAlignSegs] = useState(null); // DTW sec→key segments (null = linear tempo map)
  const [aligning, setAligning] = useState(false);
  const refAudio = useRef({});

  const [showRoman, setShowRoman] = useState(false);
  // "Mostly single notes" → the chart is a melodic line (an arpeggiated part / a
  // single-note PDF/tab head), not block harmony. Simplify (1 chord/bar) duration-weights
  // each bar's notes into one inferred chord — the right tool there — so it's AUTO-ENABLED
  // for a melodic chart (a densely arpeggiated GP part would otherwise export "quartered",
  // a chord per note), with the raw per-onset view one toggle away.
  const melodic = useMemo(() => isMelodicScore(score), [score]);
  const [simplify, setSimplify] = useState(() => isMelodicScore(score));
  const [arrange, setArrange] = useState("off"); // off | block | quarters | eighths | shuffle

  const simp = useMemo(() => (simplify ? simplifyScore(score, useSharp) : score), [simplify, score, useSharp]);
  const base = useMemo(() => (arrange === "off" ? simp : arrangeScore(simp, arrange)), [simp, arrange]);
  const tscore = useMemo(() => transposeScore(base, semis, useSharp), [base, semis, useSharp]);
  const key = useMemo(() => analyzeKey(tscore), [tscore]);
  // A local, zero-dep analog of the ListenHub music skill's `describe` — a one-glance
  // summary (complexity + human tags) of whatever the chart currently is (post
  // simplify/arrange/transpose). Pure metadata; never touches recognition.
  const describe = useMemo(() => describeScore(tscore, { useSharp, title }), [tscore, useSharp, title]);

  useEffect(() => { setBpm(score.tempo || 100); }, [score.tempo]);
  // Re-apply the melodic auto-default whenever a new score loads (upload / part switch /
  // decode / restore) — a melodic part auto-simplifies, a block-harmony part reverts to
  // per-onset. Mid-session the user's manual toggle stands until the next score change.
  useEffect(() => { setSimplify(isMelodicScore(score)); }, [score]);
  const stopPlay = () => { if (player.current) { player.current.stop(); player.current = null; } setPlaying(false); setPlayKey(""); };
  const stopRef = () => { const s = refAudio.current; if (s.raf) cancelAnimationFrame(s.raf); if (s.src) { try { s.src.stop(); } catch (_) {} s.src = null; } if (s.ctx && s.ctx.state !== "closed") { try { s.ctx.close(); } catch (_) {} s.ctx = null; } s.raf = null; setRefPlaying(false); setPlayKey(""); };
  useEffect(() => () => { stopPlay(); stopRef(); }, []); // stop on unmount
  useEffect(() => { stopPlay(); stopRef(); setAlignSegs(null); }, [score, semis]); // music changed → stop + drop the stale alignment
  const togglePlay = () => {
    if (playing) { stopPlay(); return; }
    stopRef();
    const ctl = playScore(tscore, bpm, { onEvent: setPlayKey, onEnd: () => { setPlaying(false); setPlayKey(""); player.current = null; } });
    if (!ctl) return; // no Web Audio
    player.current = ctl; setPlaying(true);
  };
  /* Reference audio: play a real recording (e.g. the isolated-vocal stem) WHILE the
   * chart's exact (notated/recognised) harmonies highlight in sync. The beat→seconds
   * map is the pure scoreEventTimes at the current ♩=bpm — so nudge the tempo until
   * the highlight tracks the recording. Browser-only glue (engine stays pure). */
  const attachRef = async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    setRefErr(""); setAlignSegs(null); stopRef();
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) { setRefErr("Web Audio isn't available."); return; }
      const ab = await f.arrayBuffer(); const dctx = new AC();
      const buf = await new Promise((res, rej) => { const p = dctx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
      try { dctx.close(); } catch (_) {}
      // downsampled mono copy for DTW alignment (16k is plenty for chroma)
      const chs = buf.numberOfChannels, n = buf.length, mono = new Float32Array(n);
      for (let c = 0; c < chs; c++) { const d = buf.getChannelData(c); for (let i = 0; i < n; i++) mono[i] += d[i] / chs; }
      const factor = Math.max(1, Math.floor(buf.sampleRate / 16000)), dsLen = Math.floor(n / factor), ds = new Float32Array(dsLen);
      for (let i = 0; i < dsLen; i++) { let v = 0; for (let j = 0; j < factor; j++) v += mono[i * factor + j]; ds[i] = v / factor; }
      refAudio.current = { ...refAudio.current, buf, ds, dsr: buf.sampleRate / factor }; setRefName(f.name);
    } catch (_) { setRefErr("Couldn't decode that audio file."); }
  };
  const autoAlign = () => {
    const s = refAudio.current; if (!s.ds) return;
    setAligning(true); setRefErr("");
    setTimeout(async () => {                                   // let "aligning…" paint
      try {
        const res = await alignPcmToScoreOffThread(s.ds, s.dsr, tscore, { hopSec: 0.25 });
        const segs = res && res.segments, conf = res ? res.confidence : 0;
        if (segs && segs.length && conf >= 0.35) setAlignSegs(segs);           // good enough → follow the recording
        else { setAlignSegs(null); setRefErr(segs && segs.length ? `Auto-align match was weak (${Math.round(conf * 100)}%) — nudge ♩= instead.` : "Couldn't auto-align — use ♩= instead."); }
      }
      catch (_) { setRefErr("Auto-align failed — use ♩= instead."); }
      setAligning(false);
    }, 30);
  };
  const toggleRef = () => {
    const s = refAudio.current;
    if (refPlaying) { stopRef(); return; }
    if (!s.buf) return;
    stopPlay(); // don't run the synth at the same time
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC(); const src = ctx.createBufferSource(); src.buffer = s.buf; src.connect(ctx.destination);
      const times = scoreEventTimes(tscore, bpm).events; // linear beat→sec map (fallback / when not auto-aligned)
      const segs = alignSegs;                            // DTW sec→key segments (when auto-aligned)
      src.onended = () => { if (refAudio.current.src === src) stopRef(); };
      src.start(); s.ctx = ctx; s.src = src; s.startedAt = ctx.currentTime; setRefPlaying(true);
      const loop = () => {
        const t = ctx.currentTime - s.startedAt;
        let key = "";
        if (segs) { for (const sg of segs) { if (sg.sec <= t) key = sg.key || ""; else break; } }   // DTW alignment
        else { for (const ev of times) { if (t >= ev.start && t < ev.start + ev.dur) { key = ev.key; break; } } } // linear
        setPlayKey(key);
        if (t <= s.buf.duration) s.raf = requestAnimationFrame(loop);
      };
      s.raf = requestAnimationFrame(loop);
    } catch (_) { setRefErr("Playback failed."); stopRef(); }
  };
  const bumpBpm = (d) => setBpm((b) => Math.max(40, Math.min(240, b + d)));
  const symOf = (bar, e) => { const v = overrides[`${bar.number}.${e.beat}`]; return v != null ? v : e.symbol; };
  const doExport = (fmt) => {
    const opts = { overrides, title, key, useSharp, tempo: bpm };
    if (fmt === "midi") { setExp({ fmt, bytes: scoreToMidi(tscore, opts) }); setCopied(false); setDownloaded(false); return; } // binary
    const text = fmt === "abc" ? scoreToABC(tscore, opts)
      : fmt === "musicxml" ? scoreToMusicXML(tscore, opts)
      : fmt === "csmpn" ? scoreToCSMPN(tscore, opts)
      : fmt === "csml" ? scoreToCSML(tscore, opts)
      : fmt === "music" ? scoreToMusicPrompt(tscore, opts).command
      : scoreToChordPro(tscore, opts);
    setExp({ fmt, text }); setCopied(false); setDownloaded(false);
  };
  const copy = () => { try { navigator.clipboard.writeText(exp.text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (_) {} };
  // Download the generated export as a real file. Extension/MIME per format so it
  // opens in the right tool (.musicxml → MuseScore/Guitar Pro, .abc → ABC players).
  const _EXPORT_EXT = { abc: "abc", musicxml: "musicxml", chordpro: "chordpro", csmpn: "csmpn", csml: "csml", midi: "mid", music: "sh" };
  const _EXPORT_MIME = { musicxml: "application/vnd.recordare.musicxml+xml", midi: "audio/midi" };
  const download = () => {
    try {
      if (!exp) return;
      const ext = _EXPORT_EXT[exp.fmt] || "txt";
      const mime = _EXPORT_MIME[exp.fmt] || "text/plain";
      const base = (title || "chart").replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "chart";
      const blob = exp.bytes ? new Blob([exp.bytes], { type: mime }) : new Blob([exp.text], { type: mime + ";charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${base}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setDownloaded(true); setTimeout(() => setDownloaded(false), 1500);
    } catch (err) { console.warn("download failed:", err); }
  };
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

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, fontSize: 11, color: C.dim, margin: "14px 0 6px" }}>
        <span style={{ color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>{title}</span>
        <span>{meta}{semis ? ` · ${semis > 0 ? "+" : ""}${semis} st` : ""}{key ? ` · key ${keyName(key, useSharp)}` : ""}</span>
      </div>
      {describe && describe.tags.length > 0 && (
        <div className="no-print" title="a local read of this chart (the music skill's `describe`, on-device)"
          style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, margin: "0 0 8px", fontSize: 10, color: C.dim }}>
          <span style={{ letterSpacing: 1.5, textTransform: "uppercase", color: C.dim }}>{describe.complexity} · {describe.uniqueChords} chord{describe.uniqueChords === 1 ? "" : "s"}</span>
          {describe.tags.map((t, i) => (
            <span key={i} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 999, padding: "1px 8px", color: C.dim, whiteSpace: "nowrap" }}>{t}</span>
          ))}
        </div>
      )}
      <div className="no-print" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {[["chart", "Chart"], ["grid", "Grid"]].map(([v, lbl]) => (
          <button key={v} onClick={() => setView(v)} style={{ ...chip(C), padding: "3px 9px", borderColor: view === v ? C.amber : C.border, color: view === v ? C.amber : C.dim }}>{lbl}</button>
        ))}
        <button onClick={() => { setEditMode((m) => !m); setEditKey(""); }} disabled={view !== "chart"}
          style={{ ...chip(C), padding: "3px 9px", opacity: view !== "chart" ? 0.4 : 1, borderColor: editMode ? C.green : C.border, color: editMode ? C.green : C.dim }}>{editMode ? "✓ Editing" : "✎ Edit"}</button>
        <button onClick={() => setShowRoman((r) => !r)} title={key ? `key of ${keyName(key, useSharp)}` : "key analysis"}
          style={{ ...chip(C), padding: "3px 9px", borderColor: showRoman ? C.cyan : C.border, color: showRoman ? C.cyan : C.dim }}>{showRoman ? "I·V·vi ✓" : "I·V·vi"}</button>
        <button onClick={() => setSimplify((s) => !s)} title="aggregate each bar's notes into one chord (for dense transcriptions)"
          style={{ ...chip(C), padding: "3px 9px", borderColor: simplify ? C.green : C.border, color: simplify ? C.green : C.dim }}>{simplify ? "1 chord/bar ✓" : "Simplify"}</button>
        <select value={arrange} onChange={(e) => setArrange(e.target.value)} title="stamp a strum/comping rhythm across each bar (exports as CSMPN/CSML slash-rhythm)"
          style={{ ...chip(C), padding: "3px 9px", borderColor: arrange !== "off" ? C.cyan : C.border, color: arrange !== "off" ? C.cyan : C.dim, background: C.raised, cursor: "pointer" }}>
          <option value="off">Arrange…</option>
          <option value="block">↳ Block (sustain)</option>
          <option value="quarters">↳ Quarters</option>
          <option value="eighths">↳ Eighths</option>
          <option value="shuffle">↳ Shuffle</option>
          <option value="sixteenths">↳ Sixteenths</option>
          <option value="skank">↳ Skank (off-beat)</option>
        </select>
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
        <span style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>
          {[["chordpro", "ChordPro"], ["abc", "ABC"], ["musicxml", "MusicXML"], ["midi", "MIDI"], ["csmpn", "CSMPN"], ["csml", "ChordSlashML"]].map(([f, lbl]) => (
            <button key={f} onClick={() => doExport(f)} style={{ ...chip(C), padding: "3px 9px", borderColor: exp && exp.fmt === f ? C.cyan : C.border, color: exp && exp.fmt === f ? C.cyan : C.dim }}>{lbl}</button>
          ))}
          <span style={{ width: 1, alignSelf: "stretch", background: C.border, margin: "0 2px" }} />
          <button onClick={() => doExport("music")} title="Turn this chart into a ready-to-run `listenhub music generate` command (ListenHub / Mureka AI music CLI) — recognize → generate"
            style={{ ...chip(C), padding: "3px 9px", borderColor: exp && exp.fmt === "music" ? C.cyan : C.border, color: exp && exp.fmt === "music" ? C.cyan : C.dim }}>🎵 Generate audio ↗</button>
          <button onClick={sendToPro} title="Open this chart in Chord Sheet Maker Pro (native CSMPN handoff)"
            style={{ ...chip(C), padding: "3px 10px", borderColor: sent ? C.green : C.amber, color: sent ? C.green : C.amber, fontWeight: 600 }}>{sent ? "opening Pro ✓" : "→ Chord Sheet Maker Pro"}</button>
        </span>
      </div>

      <div className="no-print" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 11, color: C.dim }}>
        <label style={{ ...chip(C), padding: "4px 10px", cursor: "pointer" }}>
          🎵 Reference audio
          <input type="file" onChange={attachRef} style={{ display: "none" }} />
        </label>
        {refName && <>
          <button onClick={toggleRef} title="play the recording with the chart highlighting in sync"
            style={{ ...chip(C), padding: "4px 12px", borderColor: refPlaying ? C.green : C.border, color: refPlaying ? C.green : C.amber }}>{refPlaying ? "■ Stop audio" : "▶ Play with chart"}</button>
          <button onClick={autoAlign} disabled={aligning} title="automatically align the recording to the chart (DTW) — no ♩= needed"
            style={{ ...chip(C), padding: "4px 12px", borderColor: alignSegs ? C.green : C.border, color: aligning ? C.dim : alignSegs ? C.green : C.cyan }}>{aligning ? "aligning…" : alignSegs ? "🎯 auto-synced ✓" : "🎯 Auto-align"}</button>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>{refName}</span>
          <span style={{ color: C.dim }}>{alignSegs ? "· following the recording" : "· Auto-align, or nudge ♩="}</span>
        </>}
        {refErr && <span style={{ color: C.red }}>{refErr}</span>}
      </div>

      {melodic && !simplify && <MelodicNudge C={C} onSimplify={() => setSimplify(true)} />}

      {view === "chart"
        ? <LeadSheetView score={tscore} C={C} overrides={overrides} setOverrides={setOverrides} editMode={editMode}
            editKey={editKey} setEditKey={setEditKey} draft={draft} setDraft={setDraft} selKey={selKey}
            playKey={playKey} showRoman={showRoman} musicKey={key} onPick={onPick} symOf={symOf} />
        : <GridView score={tscore} C={C} symOf={symOf} selKey={selKey} onPick={onPick} />}

      <ExportPanel exp={exp} setExp={setExp} C={C} bpm={bpm} semis={semis}
        copy={copy} download={download} copied={copied} downloaded={downloaded} extOf={(f) => _EXPORT_EXT[f] || "txt"} />
    </>
  );
}

/* ---- view layer: pure presentational sub-views ----------------------------
 * ChartPanel is the CONTROLLER (state + score transforms + export/playback
 * handlers); these render its output. Splitting them keeps the panel from
 * bloating as new views (Audio/Practice, Wave 3) land — each is just another
 * sibling here, switched on `view`, with no shared-state entanglement. Pure
 * props in, JSX out — no engine internals, no own persistent state. */
function MelodicNudge({ C, onSimplify }) {
  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, fontSize: 11, color: C.amber, background: "rgba(233,162,75,0.08)", border: `1px solid ${C.amber}`, borderRadius: 8, padding: "7px 10px", marginBottom: 10 }}>
      <span style={{ flex: "1 1 240px" }}>♪ Mostly single notes — this looks like a melodic line, not block chords. <b>Simplify</b> infers one chord per bar from the notes that sound.</span>
      <button onClick={onSimplify} style={{ ...chip(C), padding: "3px 10px", borderColor: C.amber, color: C.amber, fontWeight: 600 }}>Turn on Simplify</button>
    </div>
  );
}
/* Lead-sheet view: chords on their beat, barlines, inline relabel in Edit mode.
 * `musicKey` is the detected key (named to avoid clashing with React list keys). */
function LeadSheetView({ score, C, overrides, setOverrides, editMode, editKey, setEditKey, draft, setDraft, selKey, playKey, showRoman, musicKey, onPick, symOf }) {
  let prevSig = null;
  return (
    <>
      <div className="tdp-scroll" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(146px, 1fr))", gap: "10px 0", maxHeight: 420, overflow: "auto", paddingRight: 4 }}>
        {score.bars.map((bar) => {
          const sig = bar.timeSig || score.timeSig;
          const sigChanged = !prevSig || prevSig[0] !== sig[0] || prevSig[1] !== sig[1];
          prevSig = sig;
          return (
            <div key={bar.number} className="tdp-bar" style={{ position: "relative", borderLeft: `2px solid ${C.border}`, padding: "16px 8px 6px 10px", minHeight: 44 }}>
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
                      {showRoman && musicKey && <span style={{ display: "block", fontSize: 9, fontWeight: 400, color: C.dim, marginTop: 1 }}>{romanFor(cur, musicKey)}</span>}
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
  );
}
/* Grid view: the compact one-symbol-per-bar card grid. */
function GridView({ score, C, symOf, selKey, onPick }) {
  return (
    <>
      <div className="tdp-scroll" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(74px, 1fr))", gap: 6, maxHeight: 420, overflow: "auto", paddingRight: 4 }}>
        {score.bars.map((bar) => {
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
  );
}
/* Export preview: the generated text (or MIDI byte summary) + copy/download. */
function ExportPanel({ exp, setExp, C, bpm, semis, copy, download, copied, downloaded, extOf }) {
  if (!exp) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 10, letterSpacing: 2, color: C.dim }}>EXPORT · {exp.fmt === "abc" ? "ABC NOTATION" : exp.fmt === "musicxml" ? "MUSICXML" : exp.fmt === "midi" ? "MIDI FILE" : exp.fmt === "csmpn" ? "CSMPN" : exp.fmt === "csml" ? "CHORDSLASHML" : exp.fmt === "music" ? "LISTENHUB · GENERATE AUDIO" : "CHORDPRO"}</span>
        <span style={{ display: "inline-flex", gap: 6 }}>
          {!exp.bytes && <button onClick={copy} style={{ ...chip(C), padding: "3px 9px", borderColor: copied ? C.green : C.border, color: copied ? C.green : C.dim }}>{copied ? "copied ✓" : "copy"}</button>}
          <button onClick={download} title={`download as .${extOf(exp.fmt)}`} style={{ ...chip(C), padding: "3px 9px", borderColor: downloaded ? C.green : C.border, color: downloaded ? C.green : C.cyan }}>{downloaded ? "saved ✓" : "⬇ download"}</button>
          <button onClick={() => setExp(null)} style={{ ...chip(C), padding: "3px 9px" }}>close</button>
        </span>
      </div>
      {exp.bytes ? (
        <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 12px", fontSize: 12, color: C.dim, lineHeight: 1.6 }}>
          🎹 Standard MIDI File · {exp.bytes.length.toLocaleString()} bytes · ♩={bpm}{semis ? ` · transposed ${semis > 0 ? "+" : ""}${semis} st` : ""}. Binary, so there's nothing to copy — hit <b style={{ color: C.cyan }}>⬇ download</b> to save the <b>.mid</b> and open it in any DAW or notation app.
        </div>
      ) : (
        <textarea readOnly value={exp.text} spellCheck={false} className="tdp-scroll"
          style={{ width: "100%", height: 120, resize: "vertical", boxSizing: "border-box", background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, fontSize: 12, lineHeight: 1.5, fontFamily: "'IBM Plex Mono', monospace", outline: "none" }} />
      )}
      {exp.fmt === "abc" && <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>Real, playable notes + chord symbols — paste into any ABC player (e.g. abcjs / editor at abcnotation.com) to hear it.</div>}
      {exp.fmt === "musicxml" && <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>Save as <b>.musicxml</b> and open in MuseScore / Guitar Pro — carries chord symbols + notes + meter. Round-trips back into this app.</div>}
      {exp.fmt === "csmpn" && <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}><b>Chord Sheet Maker Pro</b>'s native fake-book source (one chord = one bar; <code>_</code> splits a bar) — also carries the real fingering (<code>{"{tab}"}</code>) and decoded strum rhythm (<code>{"{hybrid}"}</code>). Paste into Pro's editor, or use <b>→ Chord Sheet Maker Pro</b> to send it straight there.</div>}
      {exp.fmt === "csml" && <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}><b>ChordSlashML</b> — Pro's beat-slotted notation (<code>{"|"}</code> measures, <code>_</code> holds, <code>.</code> rests). Paste into Pro's <b>ChordSlashML</b> live editor.</div>}
      {exp.fmt === "music" && <div style={{ fontSize: 11, color: C.dim, marginTop: 6 }}>A ready-to-run <b>ListenHub / Mureka</b> command (<code>@marswave/listenhub-cli</code>, <code>npm i -g</code>, Node ≥ 20) that turns this chart's key / tempo / meter / progression into a prompt for a fresh AI track. The CLI needs Node + login, so it runs in <b>your</b> terminal — <b>copy</b> it, then <code>listenhub auth login</code> once and paste. The <b>recognize → generate</b> half of the pipeline.</div>}
    </div>
  );
}

/* ---- Live tuner (Wave 3 #11 mic seam) ------------------------------------
 * BROWSER-ONLY glue (engine stays pure): getUserMedia + AudioContext → Float32
 * time-domain frames → the engine's pure YIN `detectPitch`, polled on rAF. This
 * is the mic analogue of the PDF.js seam; it can't be headless-tested, so it's
 * heavily feature-detected + try/catch'd and degrades to a clear message. Shows
 * the live note, a ±50¢ tuning meter, frequency and clarity. Monophonic (one
 * note at a time) — the foundation Practice mode (#12) will build on. */
function LiveTuner({ C, useSharp }) {
  const [listening, setListening] = useState(false);
  const [pitch, setPitch] = useState(null);   // { note, freq, cents, clarity }
  const [err, setErr] = useState("");
  const ref = useRef({});

  const stop = () => {
    const s = ref.current;
    if (s.raf) cancelAnimationFrame(s.raf);
    if (s.stream) s.stream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} });
    if (s.ctx && s.ctx.state !== "closed") { try { s.ctx.close(); } catch (_) {} }
    ref.current = {};
    setListening(false);
  };
  useEffect(() => stop, []); // stop on unmount

  const start = async () => {
    setErr("");
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setErr("Microphone access isn't available in this browser."); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { setErr("Web Audio isn't available in this browser."); stream.getTracks().forEach((t) => t.stop()); return; }
      const ctx = new AC();
      if (ctx.state === "suspended") { try { await ctx.resume(); } catch (_) {} }
      const srcNode = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      srcNode.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      ref.current = { stream, ctx, analyser, buf };
      setListening(true);
      const tick = () => {
        const s = ref.current; if (!s.analyser) return;
        if (s.analyser.getFloatTimeDomainData) s.analyser.getFloatTimeDomainData(s.buf);
        else { s.byte = s.byte || new Uint8Array(s.analyser.fftSize); s.analyser.getByteTimeDomainData(s.byte); for (let i = 0; i < s.buf.length; i++) s.buf[i] = (s.byte[i] - 128) / 128; }
        const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
        if (now - (s.last || 0) > 70) {                       // throttle UI updates
          s.last = now;
          const p = detectPitch(s.buf, s.ctx.sampleRate, { useSharp });
          if (p && p.clarity > 0.7) {
            const cents = Math.round((freqToMidi(p.freq) - p.midi) * 100);
            setPitch({ note: p.note, freq: p.freq, cents, clarity: p.clarity });
          }
        }
        s.raf = requestAnimationFrame(tick);
      };
      ref.current.raf = requestAnimationFrame(tick);
    } catch (e) {
      setErr(e && e.name === "NotAllowedError" ? "Microphone permission was denied — allow it in your browser settings and try again." : "Couldn't start the microphone.");
      stop();
    }
  };

  const inTune = pitch && Math.abs(pitch.cents) <= 5;
  const centsColor = !pitch ? C.dim : inTune ? C.green : Math.abs(pitch.cents) <= 15 ? C.amber : C.red;
  return (
    <section className="panel-rise" style={{ position: "relative", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, maxWidth: 560, margin: "0 auto" }}>
      <SectionLabel C={C}>LIVE TUNER · monophonic (YIN pitch detection)</SectionLabel>
      <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: "26px 16px", textAlign: "center", marginBottom: 14 }}>
        <div style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 64, lineHeight: 1, color: pitch ? C.cyan : C.dim }}>
          {pitch ? pitch.note : listening ? "…" : "—"}
        </div>
        {pitch && <div style={{ marginTop: 10, fontSize: 12, color: C.dim }}>{pitch.freq.toFixed(1)} Hz · {pitch.cents > 0 ? "+" : ""}{pitch.cents}¢ · clarity {Math.round(pitch.clarity * 100)}%</div>}
        {!pitch && listening && <div style={{ marginTop: 10, fontSize: 12, color: C.dim }}>Listening… play a single note.</div>}
      </div>

      {/* ±50¢ tuning meter */}
      <div style={{ position: "relative", height: 14, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 6, overflow: "hidden" }}>
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 2, background: C.border, transform: "translateX(-50%)" }} />
        {pitch && <div style={{ position: "absolute", top: 1, bottom: 1, width: 6, borderRadius: 3, background: centsColor, left: `calc(${50 + Math.max(-50, Math.min(50, pitch.cents))}% - 3px)`, transition: "left .08s linear, background .1s" }} />}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: C.dim, marginBottom: 18 }}><span>♭ −50¢</span><span style={{ color: inTune ? C.green : C.dim }}>{inTune ? "IN TUNE" : "0"}</span><span>+50¢ ♯</span></div>

      <div style={{ textAlign: "center" }}>
        <button onClick={listening ? stop : start} style={{ ...toggle(C), display: "inline-block", flex: "none", padding: "10px 26px", fontSize: 14, ...(listening ? activeToggle(C) : {}), borderColor: listening ? C.green : C.border, color: listening ? C.green : C.text }}>
          {listening ? "■ Stop" : "🎤 Listen"}
        </button>
      </div>
      {err && <div style={{ marginTop: 12, color: C.red, fontSize: 12, textAlign: "center" }}>{err}</div>}
      <div style={{ marginTop: 16, fontSize: 11, color: C.dim, lineHeight: 1.6, textAlign: "center" }}>
        Pure-JS YIN detection — locks the fundamental, not an overtone. Best with a clean single note (a tuner / melody line), not full chords. Needs mic permission; nothing leaves your device.
      </div>
    </section>
  );
}

/* ---- Lyrics capture (live speech-to-text via the Web Speech API) -----------
 * BROWSER-ONLY glue (engine stays pure — there is NO DSP for words; lyrics are
 * automatic speech recognition, a trained model). We use the browser's built-in
 * `SpeechRecognition`, so there is zero model download and nothing to bundle.
 *
 * HONEST LIMITS (surfaced in the UI, not hidden):
 *  - It listens to the LIVE MICROPHONE, not an uploaded file — the standard Web
 *    Speech API has no file input. Workflow: play the song out loud on any
 *    speaker; this transcribes the vocals the mic hears.
 *  - NOT supported on iOS Safari (the app's primary target) — feature-detected
 *    with a clear message there. Works in Chrome / desktop Safari / Edge.
 *  - On Chrome the audio is sent to Google's servers for recognition (the engine
 *    is the browser's, not ours) — so it is NOT fully on-device. Stated in-panel.
 *  - Accuracy is conversational-speech ASR over sung, music-bedded vocals — a
 *    rough draft you clean up, not a karaoke-perfect transcript.
 * Can't be headless-tested (live mic + browser ASR) — device only. */
function LyricsCapture({ C }) {
  const [listening, setListening] = useState(false);
  const [finalText, setFinalText] = useState("");
  const [interim, setInterim] = useState("");
  const [err, setErr] = useState("");
  const [lang, setLang] = useState("en-US");
  const [copied, setCopied] = useState(false);
  const [level, setLevel] = useState(0);       // live mic RMS (0..~0.5) — proof sound is reaching the mic
  const [quiet, setQuiet] = useState(false);   // level ~0 for several seconds while "listening" → warn
  const [noWords, setNoWords] = useState(false); // sound IS arriving but ASR finds no words → explain
  const ref = useRef({});

  const SR = (typeof window !== "undefined") && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const supported = !!SR;

  /* Level meter: a parallel getUserMedia + AnalyserNode tap (same seam as
   * LiveTuner). SpeechRecognition gives ZERO feedback about the input signal —
   * this is what lets the panel tell "mic is dead / wrong input device" apart
   * from "sound arrives but the recognizer can't parse singing". Optional: if
   * it can't start, recognition still runs without it. */
  const stopMeter = () => {
    const s = ref.current;
    if (s.raf) { cancelAnimationFrame(s.raf); s.raf = null; }
    if (s.stream) { s.stream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} }); s.stream = null; }
    if (s.ctx && s.ctx.state !== "closed") { try { s.ctx.close(); } catch (_) {} }
    s.ctx = null; s.an = null;
    setLevel(0); setQuiet(false);
  };
  const startMeter = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { stream.getTracks().forEach((t) => { try { t.stop(); } catch (_) {} }); return; }
      const ctx = new AC();
      if (ctx.state === "suspended") { try { await ctx.resume(); } catch (_) {} }
      const an = ctx.createAnalyser(); an.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Float32Array(an.fftSize);
      Object.assign(ref.current, { stream, ctx, an, buf, quietMs: 0, lastT: 0, uiT: 0 });
      const tick = () => {
        const s = ref.current; if (!s.an) return;
        if (s.an.getFloatTimeDomainData) s.an.getFloatTimeDomainData(s.buf);
        else { s.byte = s.byte || new Uint8Array(s.an.fftSize); s.an.getByteTimeDomainData(s.byte); for (let i = 0; i < s.buf.length; i++) s.buf[i] = (s.byte[i] - 128) / 128; }
        let sum = 0; for (let i = 0; i < s.buf.length; i++) sum += s.buf[i] * s.buf[i];
        const rms = Math.sqrt(sum / s.buf.length);
        const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
        const dt = s.lastT ? now - s.lastT : 0; s.lastT = now;
        s.quietMs = rms < 0.01 ? (s.quietMs || 0) + dt : 0;   // ~silence at the mic
        if (now - (s.uiT || 0) > 90) { s.uiT = now; setLevel(rms); setQuiet(s.quietMs > 3000); }
        s.raf = requestAnimationFrame(tick);
      };
      ref.current.raf = requestAnimationFrame(tick);
    } catch (_) {} // meter is a diagnostic extra — recognition runs without it
  };

  const stop = () => {
    const s = ref.current;
    s.wantStop = true;
    if (s.rec) { try { s.rec.stop(); } catch (_) {} }
    stopMeter();
    setListening(false); setInterim(""); setNoWords(false);
  };
  useEffect(() => stop, []); // stop + release the mic on unmount

  /* Build a wired recognizer. Split out so the onend auto-restart can fall back
   * to a FRESH instance — Chrome can throw InvalidStateError on an immediate
   * re-start(), and the old silent `catch {}` left the session dead behind a
   * "Listening…" light (the reported bug). */
  const makeRec = () => {
    const rec = new SR();
    rec.continuous = true;       // keep going across pauses
    rec.interimResults = true;   // show words as they're heard
    rec.lang = lang;
    rec.onresult = (e) => {
      let live = "", done = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) done += r[0].transcript; else live += r[0].transcript;
      }
      if (done.trim() || live.trim()) { ref.current.noSpeech = 0; setNoWords(false); }
      if (done.trim()) setFinalText((t) => (t ? t.replace(/\s+$/, "") + "\n" : "") + done.trim());
      setInterim(live);
    };
    rec.onerror = (ev) => {
      const k = ev && ev.error;
      if (k === "no-speech") {                                          // recognizer heard nothing it calls speech; onend auto-restarts
        const s = ref.current; s.noSpeech = (s.noSpeech || 0) + 1;
        if (s.noSpeech >= 2) setNoWords(true);                          // recurring → tell the user why nothing appears
        return;
      }
      if (k === "aborted") return;                                      // benign; onend auto-restarts
      if (k === "audio-capture") { stopMeter(); return; }               // mic busy — free our meter tap so the recognizer can grab it; onend retries
      if (k === "not-allowed" || k === "service-not-allowed") { setErr("Microphone permission was denied — allow it in your browser settings and try again."); stop(); }
      else setErr("Speech recognition error: " + (k || "unknown") + ".");
    };
    rec.onend = () => {
      const s = ref.current;
      if (s.wantStop || s.rec !== rec) { if (s.wantStop) { setInterim(""); setListening(false); } return; }
      // Web Speech ends on silence — restart to capture a whole song. Restart
      // async, and on failure rebuild the recognizer; if THAT fails, say so
      // instead of leaving a dead session that claims to be listening.
      setTimeout(() => {
        const s2 = ref.current;
        if (s2.wantStop || s2.rec !== rec) return;
        try { rec.start(); }
        catch (_) {
          try { const fresh = makeRec(); s2.rec = fresh; fresh.start(); }
          catch (__) { setErr("Speech recognition stopped and couldn't restart — tap Listen to start again."); setListening(false); setInterim(""); }
        }
      }, 120);
    };
    return rec;
  };

  const start = () => {
    setErr(""); setNoWords(false);
    if (!supported) { setErr("Live lyrics capture isn't supported in this browser (notably iOS Safari). Try Chrome, Edge or desktop Safari."); return; }
    try {
      const rec = makeRec();
      ref.current = { rec, wantStop: false, noSpeech: 0 };
      rec.start();
      setListening(true);
      startMeter();              // fire-and-forget; failure just means no level bar
    } catch (_) { setErr("Couldn't start speech recognition."); stop(); }
  };

  const restart = () => { stop(); setTimeout(start, 120); };               // apply a language change to a live session
  const clear = () => { setFinalText(""); setInterim(""); };
  const copy = () => {
    const txt = finalText.trim(); if (!txt) return;
    try { navigator.clipboard.writeText(txt); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch (_) {}
  };
  const download = () => {
    const txt = finalText.trim(); if (!txt) return;
    try {
      const blob = new Blob([txt + "\n"], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "lyrics.txt";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (_) {}
  };

  const LANGS = [["en-US", "English (US)"], ["en-GB", "English (UK)"], ["es-ES", "Español"], ["fr-FR", "Français"], ["de-DE", "Deutsch"], ["it-IT", "Italiano"], ["pt-BR", "Português"], ["ja-JP", "日本語"]];

  return (
    <section className="panel-rise" style={{ position: "relative", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, maxWidth: 620, margin: "0 auto" }}>
      <SectionLabel C={C}>LYRICS CAPTURE · live speech-to-text (Web Speech API)</SectionLabel>
      <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.6, marginBottom: 14 }}>
        Play the song out loud on any speaker and tap <b>Listen</b> — this transcribes the vocals your mic hears, live. It uses your <b>browser's built-in</b> speech recognition (no model download). Best on clean, vocal-forward audio; treat the result as a draft to tidy.
      </div>

      {!supported ? (
        <div style={{ fontSize: 13, color: C.amber, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16, lineHeight: 1.6 }}>
          Live lyrics capture isn't available in this browser — the Web Speech API is unsupported here (notably <b>iOS Safari</b>). It works in <b>Chrome</b>, <b>Edge</b> and <b>desktop Safari</b>.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 14 }}>
            <button onClick={listening ? stop : start} style={{ ...toggle(C), flex: "none", padding: "9px 22px", fontSize: 14, ...(listening ? activeToggle(C) : {}), borderColor: listening ? C.red : C.amber, color: listening ? C.red : C.amber }}>
              {listening ? "■ Stop" : "🎙️ Listen"}
            </button>
            <select value={lang} onChange={(e) => { setLang(e.target.value); if (listening) restart(); }} style={{ ...chip(C), padding: "7px 10px", cursor: "pointer" }}>
              {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            {listening && <span style={{ fontSize: 12, color: C.red, display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: C.red, display: "inline-block", animation: "pulse 1s infinite" }} />Listening…</span>}
            {listening && (
              <span title="live microphone input level — if this doesn't move, no sound is reaching the mic" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={{ position: "relative", width: 90, height: 8, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", display: "inline-block" }}>
                  <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, Math.round(level * 400))}%`, background: level > 0.01 ? C.green : C.dim, transition: "width .09s linear" }} />
                </span>
                <span style={{ fontSize: 10, color: level > 0.01 ? C.green : C.dim }}>mic</span>
              </span>
            )}
          </div>

          {listening && quiet && (
            <div style={{ fontSize: 12, color: C.amber, background: C.bg, border: `1px solid ${C.amber}`, borderRadius: 8, padding: "8px 12px", marginBottom: 12, lineHeight: 1.6 }}>
              ⚠ <b>No sound is reaching the microphone.</b> The recognizer is running but has nothing to hear — check which input device your browser is using (site mic settings / OS sound input), that the mic isn't muted, and that the song is playing out loud near it.
            </div>
          )}
          {listening && !quiet && noWords && (
            <div style={{ fontSize: 12, color: C.dim, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 12px", marginBottom: 12, lineHeight: 1.6 }}>
              🎤 Sound is reaching the mic, but the recognizer hasn't caught any <i>words</i> yet — browser speech recognition is built for talking and struggles with singing over instruments. Try a vocal-forward section, turn the vocal up (or use an isolated-vocal stem), and move the speaker closer to the mic.
            </div>
          )}

          <div style={{ minHeight: 140, maxHeight: 300, overflowY: "auto", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, fontSize: 14, lineHeight: 1.7, color: C.text, whiteSpace: "pre-wrap", marginBottom: 12 }}>
            {finalText ? finalText : !listening && <span style={{ color: C.dim }}>Transcribed lyrics will appear here…</span>}
            {interim && <span style={{ color: C.dim }}>{finalText ? " " : ""}{interim}</span>}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button onClick={copy} disabled={!finalText.trim()} style={{ ...chip(C), padding: "6px 14px", opacity: finalText.trim() ? 1 : 0.4, color: copied ? C.green : C.text, borderColor: copied ? C.green : C.border }}>{copied ? "✓ Copied" : "Copy"}</button>
            <button onClick={download} disabled={!finalText.trim()} style={{ ...chip(C), padding: "6px 14px", opacity: finalText.trim() ? 1 : 0.4 }}>Download .txt</button>
            <button onClick={clear} disabled={!finalText.trim() && !interim} style={{ ...chip(C), padding: "6px 14px", opacity: (finalText.trim() || interim) ? 1 : 0.4, color: C.dim }}>Clear</button>
          </div>
        </>
      )}

      {err && <div style={{ marginTop: 12, color: C.red, fontSize: 12 }}>{err}</div>}
      <div style={{ marginTop: 16, fontSize: 11, color: C.dim, lineHeight: 1.6 }}>
        Note: in Chrome the audio is sent to Google's speech servers for recognition (the recognizer is the browser's, not this app) — so unlike the rest of Tab Translator, lyrics capture isn't fully on-device. Needs mic permission.
      </div>
    </section>
  );
}

/* ---- StaffView — an extracted note line on a real musical staff ------------
 * Presentational SVG only: all pitch→staff-position math is the engine's pure
 * `staffLayout` (headless-tested); this just draws it. Notes are laid left→right
 * in played order with even spacing — a READING view for the musician (the
 * timeline cards keep the timestamps). Clef is auto-picked from the register
 * (vocal/lead → treble, bass stem → bass); ledger lines and ♯/♭ accidentals
 * follow the family spelling. The active playback note is highlighted and kept
 * scrolled into view. */
function StaffView({ events, activeIdx, C, useSharp }) {
  const boxRef = useRef(null);
  const layout = useMemo(() => staffLayout(events.map((e) => e.midi), useSharp), [events, useSharp]);
  const STEP = 7, DX = 34, LEFT = 56, PAD = 12, LABEL_H = 20;
  const steps = layout.notes.map((n) => n.step);
  const maxStep = (steps.length ? Math.max(8, ...steps) : 8) + 2;
  const minStep = (steps.length ? Math.min(0, ...steps) : 0) - 2;
  const yOf = (s) => PAD + (maxStep - s) * STEP;
  const width = LEFT + events.length * DX + 24;
  const height = yOf(minStep) + LABEL_H;
  useEffect(() => {                                  // follow playback: keep the active note in view
    const el = boxRef.current;
    if (!el || activeIdx < 0) return;
    const x = LEFT + activeIdx * DX;
    if (x < el.scrollLeft + 40 || x > el.scrollLeft + el.clientWidth - 60) el.scrollLeft = Math.max(0, x - el.clientWidth / 2);
  }, [activeIdx]);
  if (!layout.notes.length) return null;
  const ledgers = (step) => {                        // even steps outside the 0..8 staff body
    const out = [];
    for (let s = -2; s >= step; s -= 2) out.push(s);
    for (let s = 10; s <= step; s += 2) out.push(s);
    return out;
  };
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: 2, color: C.dim, marginBottom: 4 }}>
        STAFF · {layout.clef === "bass" ? "BASS CLEF" : "TREBLE CLEF"} (auto from register)
      </div>
      <div ref={boxRef} className="tdp-scroll" style={{ overflowX: "auto", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 10 }}>
        <svg width={width} height={height} style={{ display: "block" }}>
          {[0, 2, 4, 6, 8].map((s) => <line key={s} x1={6} y1={yOf(s)} x2={width - 6} y2={yOf(s)} stroke={C.border} strokeWidth={1} />)}
          <text x={10} y={layout.clef === "bass" ? yOf(6) + STEP : yOf(2)} fontSize={40} fill={C.dim} dominantBaseline="middle">{layout.clef === "bass" ? "𝄢" : "𝄞"}</text>
          {layout.notes.map((n, i) => {
            const x = LEFT + i * DX, y = yOf(n.step), active = i === activeIdx;
            const color = active ? C.amber : C.cyan;
            const ev = events[i];
            return (
              <g key={i}>
                <title>{`${n.name} · ${ev.startSec.toFixed(2)}s · ${ev.durSec.toFixed(2)}s`}</title>
                {ledgers(n.step).map((s) => <line key={s} x1={x - 10} y1={yOf(s)} x2={x + 10} y2={yOf(s)} stroke={C.border} strokeWidth={1} />)}
                {n.acc && <text x={x - 15} y={y} fontSize={13} fill={color} dominantBaseline="middle" textAnchor="middle">{n.acc === "#" ? "♯" : "♭"}</text>}
                <ellipse cx={x} cy={y} rx={6.4} ry={4.7} fill={color} style={active ? { filter: `drop-shadow(0 0 5px ${C.amber})` } : undefined} />
                <text x={x} y={height - 6} fontSize={9} fill={active ? C.amber : C.dim} textAnchor="middle" fontFamily="'IBM Plex Mono', monospace">{n.name}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/* ---- Audio import (Wave 3/4: chords/notes from an isolated stem) -----------
 * BROWSER-ONLY glue (engine stays pure): upload an audio file → Web Audio
 * `decodeAudioData` (the one step that needs the browser; handles MP3/M4A/WAV) →
 * mono + downsample → the engine's pure analysis (transcribeChords for a chordal
 * stem, transcribeMonophonic for a bass/lead), run OFF-THREAD with main-thread
 * fallback. Plays the file back with a live highlight on the current event.
 * HONEST: works on a CLEAN ISOLATED stem (one instrument) — a full mix won't
 * recognise reliably. Can't be headless-tested (decode + playback) — device only;
 * the analysis engine under it is unit-tested. */
function AudioImport({ C, useSharp }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [kind, setKind] = useState("chords");        // chords | notes
  const [isolate, setIsolate] = useState(false);     // center-channel (vocal) isolation before analysis
  const [ab, setAb] = useState(null);                // { mix, iso } harmonic-clarity A/B, or "busy"
  const [mlScore, setMlScore] = useState(null);      // ML note-transcription result (basic-pitch), when a model is wired
  const [raw, setRaw] = useState([]);                // raw engine events (chords: {symbol,midis,…}; notes: {note,…})
  const [bpm, setBpm] = useState(120);
  const [bpb, setBpb] = useState(4);                 // beats per bar
  const [simple, setSimple] = useState(false);       // triad/7th bias (no 9th/extension over-labels) — good for vocal harmony
  const [overrides, setOverrides] = useState({});
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const ref = useRef({});                            // { audioBuf, ds, sr, ctx, src, raf, startedAt }
  const TARGET = 16000;

  const stopPlay = () => {
    const s = ref.current;
    if (s.raf) cancelAnimationFrame(s.raf);
    if (s.src) { try { s.src.stop(); } catch (_) {} s.src = null; }
    if (s.ctx && s.ctx.state !== "closed") { try { s.ctx.close(); } catch (_) {} s.ctx = null; }
    s.raf = null; setPlaying(false);
  };
  useEffect(() => () => stopPlay(), []);

  const run = (ds, sr, k) => {
    setBusy(true); setErr("");
    const opts = k === "notes" ? { hop: Math.floor(sr * 0.08) } : { hopSec: 0.12, smoothSec: 0.5, ...(simple ? { maxRank: 14 } : {}) };
    setTimeout(async () => {                          // let "Analyzing…" paint first
      try { setRaw((await analyzeAudioOffThread(ds, sr, k, opts)) || []); }
      catch (_) { setErr("Analysis failed on this file."); }
      setBusy(false);
    }, 30);
  };

  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    setErr(""); setName(f.name); setBusy(true); setRaw([]); setOverrides({}); setAb(null); setMlScore(null); stopPlay();
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) { setErr("Web Audio isn't available in this browser."); setBusy(false); return; }
      const ab = await f.arrayBuffer();
      const dctx = new AC();
      const audioBuf = await new Promise((res, rej) => { const p = dctx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
      try { dctx.close(); } catch (_) {}
      const chs = audioBuf.numberOfChannels;
      const factor = Math.max(1, Math.floor(audioBuf.sampleRate / TARGET));
      const sr = audioBuf.sampleRate / factor;
      // Downsample each channel to ~16k (plenty for chroma) so the STFT isolation + the
      // analysis both stay light. Keep L/R so we can center-extract on demand.
      const dsChan = (d) => { const L = Math.floor(d.length / factor), o = new Float32Array(L); for (let i = 0; i < L; i++) { let v = 0; for (let j = 0; j < factor; j++) v += d[i * factor + j]; o[i] = v / factor; } return o; };
      const l = audioBuf.getChannelData(0);
      const r = chs >= 2 ? audioBuf.getChannelData(1) : l;
      const L16 = dsChan(l), R16 = dsChan(r);
      const mono = new Float32Array(L16.length);
      for (let i = 0; i < L16.length; i++) mono[i] = (L16[i] + R16[i]) / 2;
      ref.current = { audioBuf, L16, R16, mono, sr, stereo: chs >= 2 };
      setDur(audioBuf.duration);
      prepare(isolate, kind);
    } catch (_) { setErr("Couldn't decode audio from that file — try an audio file, or a video that has an audio track."); setBusy(false); }
  };

  // Build the analysis buffer (center-extracted vocals when isolate is on + the file is
  // stereo, else the plain mono downmix), cache it, then run the recogniser on it.
  const prepare = async (iso, k) => {
    const s = ref.current; if (!s.mono) return;
    if (iso && s.stereo) {
      setBusy(true); setErr("");
      try { s.cur = await extractCenterOffThread(s.L16, s.R16, s.sr, { minFreq: 100 }); }
      catch (_) { s.cur = s.mono; }
    } else s.cur = s.mono;
    run(s.cur, s.sr, k);
  };
  const switchKind = (k) => { setKind(k); setOverrides({}); const s = ref.current; if (s.cur) run(s.cur, s.sr, k); };
  // Re-analyse when the Simple (no-extensions) toggle flips — `run` reads the fresh `simple`.
  const simpleRef = useRef(simple);
  useEffect(() => { if (simpleRef.current !== simple) { simpleRef.current = simple; const s = ref.current; if (s.cur) run(s.cur, s.sr, kind); } }, [simple]);
  const toggleIsolate = () => { const v = !isolate; setIsolate(v); setOverrides({}); prepare(v, kind); };
  /* Per-voice ML note transcription (basic-pitch). Pure-JS multi-F0 can't do dense vocal
   * harmony, so this runs a PLUGGABLE, hosted model — `window.TTP_NOTE_MODEL(pcm, sr)` →
   * { onsets, frames, frameRate, minMidi } — then the pure engine decoder turns it into a
   * chart. No model wired yet → a clear message (the model + iOS inference is the device-
   * only, must-be-hosted seam; the decode/score half is done + tested). */
  const voices = async () => {
    const s = ref.current; if (!s.cur) { setErr("Upload audio first."); return; }
    const model = typeof window !== "undefined" ? window.TTP_NOTE_MODEL : null;
    if (typeof model !== "function") { setErr("Per-voice note transcription needs an ML note model (basic-pitch) — not configured on this build. See docs/ML-NOTES.md."); return; }
    setBusy(true); setErr(""); setMlScore(null);
    try { const { score } = await transcribeWithNoteModel(s.cur, s.sr, model, { bpm, beatsPerBar: bpb, useSharp }); setMlScore(score); }
    catch (e) { setErr("Note transcription failed: " + (e && e.message ? e.message : "unknown")); }
    setBusy(false);
  };
  // A/B: does center-extraction actually clean up THIS file's harmony? Compare the
  // harmonic clarity of the raw downmix vs. the isolated center (the delta is the read).
  const runAB = async () => {
    const s = ref.current; if (!s.mono || !s.stereo) return;
    setAb("busy");
    try {
      const iso = await extractCenterOffThread(s.L16, s.R16, s.sr, { minFreq: 100 });
      const [mix, isoC] = await Promise.all([harmonicClarityOffThread(s.mono, s.sr), harmonicClarityOffThread(iso, s.sr)]);
      setAb({ mix, iso: isoC });
    } catch (_) { setAb(null); }
  };

  const play = () => {
    const s = ref.current; if (!s.audioBuf) return;
    if (playing) { stopPlay(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      const src = ctx.createBufferSource(); src.buffer = s.audioBuf; src.connect(ctx.destination);
      src.onended = () => { if (ref.current.src === src) stopPlay(); };
      src.start(); s.ctx = ctx; s.src = src; s.startedAt = ctx.currentTime; setPlaying(true);
      const loop = () => { const t = ctx.currentTime - s.startedAt; setPos(t); if (t <= s.audioBuf.duration) s.raf = requestAnimationFrame(loop); };
      s.raf = requestAnimationFrame(loop);
    } catch (_) { setErr("Playback failed."); stopPlay(); }
  };

  // chords → a real score (re-quantised live as bpm / time-sig change); notes → a timeline
  const audioScore = useMemo(() => (kind === "chords" && raw.length ? audioEventsToScore(raw, { bpm, beatsPerBar: bpb, useSharp }) : null), [kind, raw, bpm, bpb, useSharp]);
  const noteEvents = kind === "notes" ? raw.map((e) => ({ label: e.note, midi: e.midi, startSec: e.startSec, durSec: e.durSec })) : [];
  const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  const activeIdx = noteEvents.findIndex((e) => pos >= e.startSec && pos < e.startSec + e.durSec);

  return (
    <section className="panel-rise" style={{ position: "relative", background: C.panel, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
      <SectionLabel C={C}>AUDIO → CHART · isolated-stem recognition (experimental)</SectionLabel>
      <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.6, marginBottom: 12 }}>
        Upload a <b>clean, isolated instrument stem</b> (one guitar / piano / bass) — an <b>audio file</b> (MP3/M4A/WAV) <b>or a video</b> (MP4/MOV; the audio track is extracted). Decoded + analysed entirely on your device; nothing is uploaded. Chordal stems → a chord chart (export / send to Pro); a single-note stem (bass/lead) → notes. For a <b>full stereo mix</b>, tap <b>🎤 Isolate vocals</b> to center-extract the vocal (where lead + backing harmony usually sit) before charting — the zero-download karaoke trick.
        <br /><span style={{ color: C.dim }}>Already have real stems? A <b>ListenHub / Mureka</b> <code>listenhub music stem --audio song.mp3</code> split (per-instrument stems) drops straight in here — that separated stem is the cleanest possible input. <b>⚖ A/B clarity</b> tells you whether the separation actually helped before you commit to charting it.</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 14 }}>
        <label style={{ ...toggle(C), flex: "none", padding: "8px 16px", cursor: "pointer", borderColor: C.amber, color: C.amber }}>
          ⬆ Upload audio / video
          {/* NO accept filter on purpose: iOS maps accept→UTIs and GREYS OUT valid
              audio files (MP3/M4A/WAV), leaving only video selectable. decodeAudioData
              validates the file instead — same lesson as the Guitar Pro upload. */}
          <input type="file" onChange={onFile} style={{ display: "none" }} />
        </label>
        <span style={{ display: "inline-flex", gap: 4 }}>
          {[["chords", "Chords (guitar/piano)"], ["notes", "Notes (bass/lead)"]].map(([k, lbl]) => (
            <button key={k} onClick={() => switchKind(k)} disabled={busy} style={{ ...chip(C), padding: "5px 10px", borderColor: kind === k ? C.cyan : C.border, color: kind === k ? C.cyan : C.dim }}>{lbl}</button>
          ))}
        </span>
        <button onClick={toggleIsolate} disabled={busy} title="isolate the center channel (where vocals usually sit) before analysing — for scoring sung harmony from a full mix"
          style={{ ...chip(C), padding: "5px 10px", borderColor: isolate ? C.green : C.border, color: isolate ? C.green : C.dim }}>{isolate ? "🎤 Vocals isolated ✓" : "🎤 Isolate vocals"}</button>
        {kind === "chords" && <button onClick={() => { setSimple((v) => !v); setOverrides({}); }} disabled={busy} title="bias to plain triads / 7ths — stops dense/vocal audio being over-labelled with 9ths & extensions"
          style={{ ...chip(C), padding: "5px 10px", borderColor: simple ? C.cyan : C.border, color: simple ? C.cyan : C.dim }}>{simple ? "△ Simple ✓" : "△ Simple"}</button>}
        {kind === "chords" && <button onClick={voices} disabled={busy} title="per-VOICE note transcription (the actual sung notes, not just a chord) via a pluggable ML model — for dense vocal harmony"
          style={{ ...chip(C), padding: "5px 10px", borderColor: mlScore ? C.green : C.border, color: mlScore ? C.green : C.dim }}>🎼 Voices (ML)</button>}
        {ref.current.stereo && <button onClick={runAB} disabled={busy || ab === "busy"} title="does isolating the center actually clean up THIS file's harmony? compares chroma clarity of the mix vs. the isolated center"
          style={{ ...chip(C), padding: "5px 10px", borderColor: C.border, color: C.dim }}>{ab === "busy" ? "measuring…" : "⚖ A/B clarity"}</button>}
        {name && <span style={{ fontSize: 11, color: C.dim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{name}{dur ? ` · ${fmt(dur)}` : ""}</span>}
      </div>

      {busy && <div style={{ fontSize: 13, color: C.amber, marginBottom: 12 }}>⏳ Analyzing… (FFT over the whole stem)</div>}
      {err && <div style={{ fontSize: 12, color: C.red, marginBottom: 12 }}>{err}</div>}

      {/* A/B clarity readout: is center-extraction worth it on THIS file? */}
      {ab && ab !== "busy" && (() => {
        const helps = ab.iso - ab.mix > 0.02;
        const pct = ab.mix > 0 ? Math.round(((ab.iso - ab.mix) / ab.mix) * 100) : 0;
        return (
          <div style={{ fontSize: 12, color: C.dim, marginBottom: 12, padding: "8px 12px", background: C.raised, border: `1px solid ${helps ? C.green : C.border}`, borderRadius: 8, lineHeight: 1.6 }}>
            <b style={{ color: C.text }}>Harmony clarity</b> — mix <b style={{ color: C.amber }}>{ab.mix.toFixed(3)}</b> · isolated <b style={{ color: helps ? C.green : C.amber }}>{ab.iso.toFixed(3)}</b> ({pct >= 0 ? "+" : ""}{pct}%).{" "}
            {helps
              ? <span style={{ color: C.green }}>Isolation cleans up the harmony here — worth using 🎤. (If it's still not clean enough, that's the case where a heavy ML separator might pay off.)</span>
              : <span>Isolation isn't improving clarity on this file — the vocal may not be centered, or it's already clean. A heavy ML separator likely wouldn't help either.</span>}
          </div>
        );
      })()}

      {/* VOICES (ML) → the per-voice note transcription, rendered through the shared chart */}
      {mlScore && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: C.green, marginBottom: 6 }}>🎼 Per-voice note transcription (ML) — the actual sung notes, editable + exportable like any chart.</div>
          <ChartPanel score={mlScore} title={(name || "Vocals") + " · voices"} meta={`${mlScore.bars.length} bars · from ML notes`} C={C} useSharp={useSharp} overrides={overrides} setOverrides={setOverrides} selKey="" onPick={() => {}} />
        </div>
      )}

      {/* CHORDS → editable chart + export/handoff, with a tempo/meter grid control */}
      {kind === "chords" && audioScore && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 8, fontSize: 11, color: C.dim }}>
            <button onClick={play} style={{ ...chip(C), padding: "4px 12px", borderColor: playing ? C.green : C.border, color: playing ? C.green : C.amber }}>{playing ? "■ Stop stem" : "▶ Play stem"}</button>
            <span>{fmt(pos)} / {fmt(dur)}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <button onClick={() => setBpm((b) => Math.max(40, b - 5))} style={{ ...chip(C), padding: "3px 8px" }}>−</button>
              <span style={{ minWidth: 54, textAlign: "center", color: C.amber }}>♩={bpm}</span>
              <button onClick={() => setBpm((b) => Math.min(240, b + 5))} style={{ ...chip(C), padding: "3px 8px" }}>+</button>
            </span>
            <select value={bpb} onChange={(e) => setBpb(+e.target.value)} style={{ ...chip(C), padding: "3px 8px", background: C.raised, cursor: "pointer" }}>
              <option value={4}>4/4</option><option value={3}>3/4</option><option value={6}>6/8</option>
            </select>
            <span style={{ color: C.dim }}>set tempo so the bars line up</span>
          </div>
          <ChartPanel score={audioScore} title={name || "Audio stem"} meta={`${audioScore.bars.length} bars · ♩=${bpm} · from audio`} C={C} useSharp={useSharp} overrides={overrides} setOverrides={setOverrides} selKey="" onPick={() => {}} />
          <div style={{ fontSize: 11, color: C.dim, marginTop: 10, lineHeight: 1.6 }}>
            Rough sketch from a clean stem — tap <b>✎ Edit</b> to fix labels, set <b>♩=</b> so bars align, then <b>CSMPN</b> / <b>→ Chord Sheet Maker Pro</b> to send it on. Dense voicings / bleed will mislabel.
          </div>
        </>
      )}

      {/* NOTES → a simple note timeline */}
      {kind === "notes" && !!noteEvents.length && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <button onClick={play} style={{ ...chip(C), padding: "5px 14px", borderColor: playing ? C.green : C.border, color: playing ? C.green : C.amber }}>{playing ? "■ Stop" : "▶ Play"}</button>
            <span style={{ fontSize: 11, color: C.dim }}>{fmt(pos)} / {fmt(dur)} · {noteEvents.length} notes</span>
          </div>
          <StaffView events={noteEvents} activeIdx={activeIdx} C={C} useSharp={useSharp} />
          <div className="tdp-scroll" style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 360, overflow: "auto", paddingRight: 4 }}>
            {noteEvents.map((e, i) => (
              <div key={i} title={`${fmt(e.startSec)} · ${e.durSec.toFixed(2)}s`} style={{ minWidth: 54, textAlign: "center", padding: "8px 6px", borderRadius: 8, border: `1px solid ${i === activeIdx ? C.amber : C.border}`, background: i === activeIdx ? `${C.amber}18` : C.bg }}>
                <div style={{ fontFamily: "'Space Mono', monospace", fontWeight: 700, fontSize: 15, color: i === activeIdx ? C.amber : C.cyan }}>{e.label}</div>
                <div style={{ fontSize: 9, color: C.dim, marginTop: 2 }}>{fmt(e.startSec)}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: C.dim, marginTop: 12, lineHeight: 1.6 }}>The bass/lead line (YIN) on a real staff — clef auto-picked from the register, ♯/♭ per the spelling toggle. For an isolated-vocal stem this traces the (loudest) sung line; for a bass stem, the root movement. The cards above carry the timestamps.</div>
        </>
      )}
    </section>
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
