/* AUDIT 2026-11-18 regression suite (docs/AUDIT-2026-11-18.md). One check per finding that can be
 * tested headlessly; behavioural wherever the code allows it. Storage (C2 / M1) has its own suite,
 * tests/session-store.mjs.
 *   M2.1  a .gpx whose sector pointer points back stops with an error (it used to loop forever),
 *         and the 7 corpus .gpx files unpack to byte-identical results with the old reader;
 *   m5    a .gpx that claims a huge size is refused before allocating it;
 *   M3    the off-thread wrappers re-run on the main thread ONLY when no worker exists, never after
 *         an engine error or a worker crash; guitar-model.js never retries on the main thread;
 *   M2    decode-handoff bytes are saved only after they parse; the restore marker; the error boundary;
 *   m4 / m7 / m9 and the loader rewrites (m8). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
globalThis.DOMParser = (await import("@xmldom/xmldom")).DOMParser;
const enginePath = path.join(here, ".engine.audit.mjs");
fs.writeFileSync(enginePath, fs.readFileSync(path.join(repo, "engine.tsx"), "utf8"));
const eng = await import(enginePath + "?t=" + Date.now());
const read = (f) => fs.readFileSync(path.join(repo, f), "utf8");
const ui = read("TabDecoderPro.tsx"), engSrc = read("engine.tsx"), html = read("index.html");

let failures = 0, passes = 0;
const expect = (cond, msg) => { if (cond) passes++; else { failures++; console.error("FAIL:", msg); } };
const section = (name) => console.log(`\n— ${name}`);

/* the GPX filesystem reader as it was at 1c84ce1 (alphaTab's GpxFileSystem port) — the reference */
function oldReadFS(data) {
  const SS = 0x1000, files = [], LE = eng._gpxLE32;
  let offset = SS, guard = 0;
  while (offset + 3 < data.length) {
    if (++guard > 1e6) throw new Error("old reader looped");
    if (LE(data, offset) === 2) {
      let name = ""; for (let i = 0; i < 127; i++) { const c = data[offset + 4 + i]; if (c === 0) break; name += String.fromCharCode(c); }
      const fileSize = LE(data, offset + 0x8c);
      const dpo = offset + 0x94; let sc = 0; const chunks = [];
      for (;;) { const sector = LE(data, dpo + 4 * sc++); if (sector === 0) break; offset = sector * SS; chunks.push(data.subarray(offset, offset + SS)); }
      let total = 0; chunks.forEach((c) => (total += c.length));
      const buf = new Uint8Array(total); let p = 0; chunks.forEach((c) => { buf.set(c, p); p += c.length; });
      files.push({ name, data: buf.subarray(0, Math.min(fileSize, buf.length)) });
    }
    offset += SS;
  }
  return files;
}

section("M2.1 · .gpx filesystem: bounded, and unchanged for real files");
{
  const SS = 0x1000;
  // BCFS, one file entry in sector 2 whose sector list ends on sector 1 (before the entry)
  const data = new Uint8Array(3 * SS), dv = new DataView(data.buffer);
  dv.setUint32(2 * SS, 2, true);
  "score.gpif".split("").forEach((ch, i) => (data[2 * SS + 4 + i] = ch.charCodeAt(0)));
  dv.setUint32(2 * SS + 0x8c, 100, true);
  dv.setUint32(2 * SS + 0x94, 1, true); dv.setUint32(2 * SS + 0x98, 0, true);
  const file = new Uint8Array(4 + data.length); file.set([0x42, 0x43, 0x46, 0x53]); file.set(data, 4); // "BCFS"
  // run in a worker so a regression shows up as a timeout, not a hung test run
  const t0 = Date.now();
  const res = await new Promise((resolve) => {
    const w = new Worker(`
      const { parentPort, workerData } = require("node:worker_threads");
      import(workerData.engine).then((eng) => {
        try { eng.parseGPX(new Uint8Array(workerData.file)); parentPort.postMessage({ ok: true }); }
        catch (e) { parentPort.postMessage({ ok: false, msg: String(e && e.message || e) }); }
      });`, { eval: true, workerData: { engine: enginePath, file: Array.from(file) } });
    const timer = setTimeout(() => { w.terminate(); resolve({ timeout: true }); }, 5000);
    w.on("message", (m) => { clearTimeout(timer); w.terminate(); resolve(m); });
  });
  expect(!res.timeout, "the looping .gpx does not hang the parser");
  expect(res.ok === false && /loops back/.test(res.msg || ""), `it fails closed with a clear error, got ${JSON.stringify(res)}`);
  expect(Date.now() - t0 < 4000, "…within a few seconds (parse < 1 s, worker start included)");

  const gpx = fs.readdirSync(repo).filter((f) => /\.gpx$/i.test(f));
  expect(gpx.length >= 5, `the corpus .gpx files are present (${gpx.length})`);
  let same = 0;
  for (const f of gpx) {
    const u8 = new Uint8Array(fs.readFileSync(path.join(repo, f)));
    const br = eng._gpxBitReader(u8), head = String.fromCharCode(...br.readBytes(4));
    const raw = head === "BCFZ" ? eng._gpxDecompress(br, true) : u8.subarray(4);
    const a = oldReadFS(raw), b = eng._gpxReadFS(raw);
    const eq = a.length === b.length && a.every((x, i) => x.name === b[i].name && x.data.length === b[i].data.length && x.data.every((v, j) => v === b[i].data[j]));
    expect(eq, `${f}: the bounded reader returns the same files byte-for-byte`);
    if (eq) same++;
    const sc = eng.parseGPX(u8);
    expect(sc.bars.length > 0, `${f}: still parses (${sc.bars.length} bars)`);
  }
  console.log(`  ${same}/${gpx.length} corpus .gpx files unpack identically`);
}

section("m5 · a .gpx that claims a huge size is refused");
{
  // BCFZ whose declared length is 2 GB
  const z = new Uint8Array([0x42, 0x43, 0x46, 0x5a, 0x00, 0x00, 0x00, 0x80, 0, 0, 0, 0]);
  let msg = ""; try { eng.parseGPX(z); } catch (e) { msg = e.message; }
  expect(/claims to unpack/.test(msg), `refused before allocating, got "${msg}"`);
  const SS = 0x1000, d = new Uint8Array(2 * SS), dv = new DataView(d.buffer);
  dv.setUint32(SS, 2, true); dv.setUint32(SS + 0x8c, 0x7fffffff, true);
  msg = ""; try { eng._gpxReadFS(d); } catch (e) { msg = e.message; }
  expect(/claims \d+ MB/.test(msg), `a file entry claiming 2 GB is refused, got "${msg}"`);
}

section("M3 · off-thread wrappers fall back only when there is no worker");
{
  // Extract the real policy helper and one real wrapper from the UI and run them with fakes.
  const start = ui.indexOf("/* --- off-thread call policy"), end = ui.indexOf("/* --- end off-thread call policy");
  expect(start > 0 && end > start, "the UI has one off-thread call policy (_offThread)");
  const policy = ui.slice(start, end);
  const mk = new Function("_engineRPC", "_detached", policy + "\nreturn { _offThread, workerUnavailable };");
  const engineErr = () => Promise.reject(new Error("Corrupt .gpx: its sector table loops back on itself."));
  const crashErr = () => { const e = new Error("engine worker crashed"); e.crashed = true; return Promise.reject(e); };
  const noWorker = () => { const e = new Error("no engine worker"); e.unavailable = true; return Promise.reject(e); };
  const run = async (rpc, transfer) => {
    const { _offThread } = mk(rpc, (a) => !!a && a.detached);
    let mainCalls = 0, err = null, out;
    try { out = await _offThread("fn", [], () => { mainCalls++; return "main"; }, transfer); } catch (e) { err = e; }
    return { mainCalls, err, out };
  };
  let r = await run(engineErr);
  expect(r.mainCalls === 0 && r.err && /Corrupt/.test(r.err.message), "an engine error is reported as it is — not re-run on the page");
  r = await run(crashErr);
  expect(r.mainCalls === 0 && r.err && r.err.crashed, "a worker crash (OOM) is reported — never re-run on the page's thread");
  r = await run(noWorker);
  expect(r.mainCalls === 1 && r.out === "main", "no worker at all → the same engine call on the main thread");
  r = await run(noWorker, [{ detached: true }]);
  expect(r.mainCalls === 0 && r.err, "buffers already handed to a worker that then failed can't be re-used → error, no fallback");
  r = await run(() => Promise.resolve("worker"));
  expect(r.mainCalls === 0 && r.out === "worker", "a worker answer is used as it is");

  // every *OffThread wrapper goes through the policy (no bare catch → main-thread call left)
  const bare = [...ui.matchAll(/try \{ return await _engineRPC\([^\n]*\n\s*catch \(\w*\) \{ return \w+\(/g)];
  expect(bare.length === 0, `no wrapper falls back on ANY error any more (${bare.length} left)`);
  const wrappers = [...ui.matchAll(/async function (\w+OffThread)\(/g)].map((m) => m[1]);
  const viaPolicy = wrappers.filter((w) => { const i = ui.indexOf(`async function ${w}(`); return /_offThread\(/.test(ui.slice(i, i + 700)); });
  expect(wrappers.length >= 10 && viaPolicy.length === wrappers.length, `every *OffThread wrapper uses _offThread (${viaPolicy.length}/${wrappers.length}: missing ${wrappers.filter((w) => !viaPolicy.includes(w)).join(", ")})`);
  expect(!/_engineWorkerDead = true; _engineWorker = null; _rpcPending\.forEach/.test(ui), "one crash no longer switches the worker off for the whole session");
  expect(/ready/.test(ui.slice(ui.indexOf("function _getEngineWorker"), ui.indexOf("function _getEngineWorker") + 2500)), "the worker reports ready, so a start-up failure (fallback) is told apart from a crash (no fallback)");
  const g = read("guitar-model.js");
  expect(!/catch \(err\)[\s\S]{0,300}onMainThread/.test(g) && /if \(!w\) return onMainThread/.test(g), "guitar-model.js: the main thread is used only when no Worker can be made (no retry after a failed run)");
}

section("M2.2 / M2.3 / M2.4 · the app can't be wedged by one bad file");
{
  const dec = ui.slice(ui.indexOf("const d = decodeRef.current; if (!d) return;"), ui.indexOf("const selectPart = (idx) =>"));
  const pre = dec.slice(0, dec.indexOf("(async () => {"));
  expect(!/saveSessionFile\(/.test(pre) && (pre.match(/persistSession\(/g) || []).length === 1 && /const keep = \(\) => persistSession\(/.test(pre), "the decode handoff no longer saves bytes before parsing (it only defines keep())");
  const pdfPart = dec.slice(dec.indexOf("if (isPdf) {"), dec.indexOf("} else {", dec.indexOf("if (isPdf) {")));
  const xmlPart = dec.slice(dec.indexOf("} else {", dec.indexOf("if (isPdf) {")));
  expect(pdfPart.indexOf("extractTokens(") > 0 && pdfPart.indexOf("keep();") > pdfPart.indexOf("setChart("), "PDF: kept only after it was read and charted");
  expect(xmlPart.indexOf("parseScoreOffThread(") > 0 && xmlPart.indexOf("keep();") > xmlPart.indexOf("setXmlScore(sc)"), "score: kept only after it parsed");
  expect(/sessionStore\.markRestore\(/.test(ui) && /finally \{ if \(marked\) sessionStore\.clearRestoreMark\(\)/.test(ui), "a restore holds the in-flight marker while it parses and clears it after");
  expect(/const mark = sessionStore\.restoreMark\(\);\s*\n?\s*if \(mark\) \{ setRestoreAsk/.test(ui) && /Restore anyway/.test(ui), "a marker left at launch asks (Restore anyway / Start fresh) instead of restoring");
  expect(/class AppErrorBoundary extends React\.Component/.test(ui) && /getDerivedStateFromError/.test(ui) && /<AppErrorBoundary><TabDecoderProApp \/><\/AppErrorBoundary>/.test(ui), "a top-level error boundary wraps the app");
  expect(/sessionStore\.clearSession\(\)/.test(ui.slice(ui.indexOf("class AppErrorBoundary"), ui.indexOf("export default function TabDecoderPro"))), "its Start fresh clears the saved session");
}

section("m4 / m7 / m8 / m9");
{
  const dec = ui.slice(ui.indexOf("async function decodeAudioBytes"), ui.indexOf("async function decodeAudioBytes") + 1500);
  expect(!/new AC\(\)[^\n]*\n[^\n]*decodeAudioData/.test(ui) && (ui.match(/decodeAudioData\(/g) || []).length === 1, "every audio decode goes through decodeAudioBytes");
  expect(/finally \{[^}]*\.close\(\)/.test(dec), "a failed audio decode closes its AudioContext (m4)");
  expect(!/\x00/.test(engSrc), "engine.tsx has no raw NUL byte (m9)");
  expect(/\/g, 'from "' \+ engineUrl/.test(html) && /\/g, 'from "' \+ storeUrl/.test(html), "the loader rewrites every ./engine.tsx and ./session-store.js import (m8)");
  expect(!fs.existsSync(path.join(here, "engine.tsx")), "the stale tests/engine.tsx copy is gone (m8)");
  expect(/xmlSeq = useRef\(0\)/.test(ui) && /if \(seq !== xmlSeq\.current\) return/.test(ui) && /if \(seq !== pdfSeq\.current\) return/.test(ui) && /if \(seq !== loadSeq\.current\) return/.test(ui), "a slow earlier upload can't overwrite a later one (m7)");
}

console.log(`\naudit-2026-11-18: ${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
