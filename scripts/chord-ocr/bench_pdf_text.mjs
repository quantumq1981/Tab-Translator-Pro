// Digital score PDFs read from their TEXT LAYER (engine pdfChordPages) — measured against an independent truth: the
// Guitar Pro file the PDF was engraved from (Ultimate Guitar renders its "Pro" tabs from GP files with MuseScore).
// Every beat of a GP track can carry a chord diagram by name; the chords of a bar are those names in beat order.
// A chord counts as right when the PDF reading and the GP name are the same chord (root, bass and tone set — "C#7dim"
// in the GP file and "C#dim7" as engraved are one chord) and it lands in the right bar.
//   node bench_pdf_text.mjs <score.pdf> <source.gp | -> [--ocr <model.onnx>]      (pdfjs-dist 3.11.174 from tests/)
// With "-" for the GP file the text-layer reading itself is the truth (for PDFs whose source isn't available; validate it
// by eye first — docs/UG-PRO-PDF-CALIBRATION.md lists the pages checked).
// With --ocr the same pages are also rendered at the app's Scan resolution and read by the raster reader
// (readChordPage) — the vector-first vs OCR comparison of docs/UG-PRO-PDF-CALIBRATION.md.
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module"; import { fileURLToPath } from "node:url";
import { loadEngine } from "../../tests/bench/lib.mjs";
const here = path.dirname(fileURLToPath(import.meta.url)), req = createRequire(path.join(here, "../../tests/package.json"));
const pdfjs = req("pdfjs-dist/legacy/build/pdf.js");
const { DOMParser } = req("@xmldom/xmldom");
const E = await loadEngine(process.env.ENGINE || undefined);
const EO = process.env.OCR_ENGINE ? await loadEngine(process.env.OCR_ENGINE) : E;   // an older engine for the OCR side (A/B); truth + scoring stay on E
const args = process.argv.slice(2), pdfF = args[0], gpF = args[1], ocrModel = args.includes("--ocr") ? args[args.indexOf("--ocr") + 1] : null;

// ---- truth: the GP file's chord names per bar (the track that names the most beats)
let truth = [], ti = 0, tracks = [];
if (gpF !== "-") {
const gpif = await E.gpUnzip(new Uint8Array(fs.readFileSync(gpF)));   // Content/score.gpif as text
const X = new DOMParser().parseFromString(gpif, "text/xml");
const list = (nl) => Array.from({ length: nl ? nl.length : 0 }, (_, i) => nl.item(i));   // xmldom NodeLists aren't iterable
const kids = (n, tag) => list(n && n.childNodes).filter((c) => c.nodeName === tag);
const one = (n, tag) => kids(n, tag)[0];
const txt = (n) => (n ? n.textContent.trim() : "");
const byId = (tag) => { const m = new Map(); for (const n of list(X.getElementsByTagName(tag))) if (n.getAttribute("id") != null && n.parentNode && n.parentNode.nodeName === tag + "s") m.set(n.getAttribute("id"), n); return m; };
const Bars = byId("Bar"), Voices = byId("Voice"), Beats = byId("Beat");
tracks = kids(one(X.documentElement, "Tracks"), "Track");
const names = tracks.map((t) => { const m = new Map(); for (const p of list(t.getElementsByTagName("Property"))) if (p.getAttribute("name") === "DiagramCollection") for (const it of list(p.getElementsByTagName("Item"))) m.set(it.getAttribute("id"), it.getAttribute("name").trim()); return m; });
const masters = kids(one(X.documentElement, "MasterBars"), "MasterBar");
const truthOf = (ti) => masters.map((mb) => {
  const bid = txt(one(mb, "Bars")).split(/\s+/)[ti], bar = Bars.get(bid), out = [];
  if (!bar) return out;
  for (const vid of txt(one(bar, "Voices")).split(/\s+/)) { if (vid === "-1") continue; const v = Voices.get(vid); if (!v) continue;
    for (const beid of txt(one(v, "Beats")).split(/\s+/)) { const be = Beats.get(beid), c = be && one(be, "Chord"); if (c && names[ti].has(txt(c))) out.push(names[ti].get(txt(c))); } }
  return out;
});
let best = -1; tracks.forEach((_, i) => { const n = truthOf(i).flat().length; if (n > best) { best = n; ti = i; } });
truth = truthOf(ti);
}

// ---- the PDF read from its text layer
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(pdfF)), verbosity: 0 }).promise;
const vecs = [];
for (let p = 1; p <= doc.numPages; p++) { const pg = await doc.getPage(p), vp = pg.getViewport({ scale: 1 }); vecs.push(E.pdfPageVectors(await pg.getTextContent(), vp, await pg.getOperatorList(), pdfjs.OPS)); }
const t0 = performance.now(), R = E.pdfChordPages(vecs), ms = performance.now() - t0;
const perBar = (pages) => { const out = []; let base = 0; for (const pg of pages) { const L = pg.layout; if (L.firstNumber != null && L.firstNumber - 1 > base) base = L.firstNumber - 1;
  L.tokens.map((t, i) => [t, pg.reads[i]]).sort((a, b) => a[0].staff - b[0].staff || a[0].x0 - b[0].x0).forEach(([t, r]) => { if (r) (out[base + t.bar] ||= []).push(r.name); }); base += L.bars; } return out; };

// chord identity: root | bass | tone set (normalises every spelling through the chord grammar)
const sig = (n) => { if (/^N\.?C\.?$/i.test(n) || n === "—") return "NC"; const w = E.chordFromWritten(n.replace(/\s+/g, "")); if (!w || !w.parsed) return "?" + n; const p = w.parsed; return p.rootPc + "|" + (p.bassPc ?? "") + "|" + p.formula.tones.map((t) => t.semi).sort((a, b) => a - b).join(","); };
function score(got, label) {
  let n = 0, tp = 0, fp = 0, unparsed = 0; const miss = [], extra = [];
  const nb = Math.max(truth.length, got.length);
  for (let b = 0; b < nb; b++) {
    const A = (truth[b] || []).map(sig), B = (got[b] || []).map(sig);
    unparsed += A.filter((x) => x.startsWith("?")).length;
    const D = Array.from({ length: A.length + 1 }, () => new Array(B.length + 1).fill(0));
    for (let i = 1; i <= A.length; i++) for (let j = 1; j <= B.length; j++) D[i][j] = A[i - 1] === B[j - 1] ? D[i - 1][j - 1] + 1 : Math.max(D[i - 1][j], D[i][j - 1]);
    const k = D[A.length][B.length];
    n += A.length; tp += k; fp += B.length - k;
    if (k < A.length) miss.push(`${b + 1}:${(truth[b] || []).join(" ")}→${(got[b] || []).join(" ")}`);
    else if (k < B.length) extra.push(`${b + 1}:${(got[b] || []).join(" ")}`);
  }
  console.log(`${label}: ${n} chords in ${truth.length} bars · right in the right bar ${tp} (${(100 * tp / n).toFixed(1)}%) · extra ${fp} · precision ${(100 * tp / Math.max(1, tp + fp)).toFixed(1)}%${unparsed ? ` · ${unparsed} GP names the grammar can't read` : ""}`);
  if (miss.length) console.log("  missed/wrong: " + miss.slice(0, 12).join(" | ") + (miss.length > 12 ? ` … +${miss.length - 12}` : ""));
  if (extra.length) console.log("  extra: " + extra.slice(0, 12).join(" | "));
}
if (gpF === "-") { const pb = perBar(R.pages); truth = Array.from({ length: pb.length }, (_, b) => pb[b] || []); }
console.log(`${path.basename(pdfF)} — ${gpF === "-" ? "truth = the text layer" : `GP track ${ti} "${tracks[ti].getElementsByTagName("Name")[0]?.textContent}"`}, ${truth.length} bars`);
console.log(`text layer: "${R.title}" / ${R.artist} · tempo ${R.tempo} · ${R.pages.length} pages in ${ms.toFixed(0)} ms · bar numbers agree ${R.numbering.agree}/${R.numbering.printed}`);
score(perBar(R.pages), "TEXT LAYER");

if (ocrModel) {
  // the app's Scan path: each page rendered ≤ 1500 px wide, grey (here by poppler: pdftoppm -gray -scale-to-x 1500), then
  // every box read by the CTC reader with the chord grammar (readChordPage). env PNGJS_FROM / ORT_WEB: where pngjs and
  // onnxruntime-web 1.23.2 (the app's pinned runtime) are installed.
  const { execFileSync } = await import("node:child_process"), os = await import("node:os");
  const preq = createRequire(path.resolve(process.env.PNGJS_FROM || path.join(here, "package.json")));
  const { PNG } = preq("pngjs");
  const ort = (await import(path.resolve(process.env.ORT_WEB || path.join(here, "node_modules/onnxruntime-web/dist/ort.wasm.min.mjs")))).default;
  ort.env.wasm.numThreads = 1; ort.env.logLevel = "error";
  const sess = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(ocrModel)));
  const run = async (data, width) => { const o = (await sess.run({ image: new ort.Tensor("float32", data, [1, 1, 32, width]) })).logits; return { logits: o.data, frames: o.dims[1], classes: o.dims[2] }; };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ugocr-"));
  execFileSync("pdftoppm", ["-gray", "-scale-to-x", "1500", "-scale-to-y", "-1", "-png", pdfF, path.join(tmp, "p")]);
  const pngs = fs.readdirSync(tmp).filter((f) => f.endsWith(".png")).sort();
  const pages = []; let first = 1; const t1 = performance.now();
  for (const f of pngs) {
    const png = PNG.sync.read(fs.readFileSync(path.join(tmp, f))), ch = png.data.length / (png.width * png.height), g = new Uint8Array(png.width * png.height);
    for (let i = 0; i < g.length; i++) g[i] = png.data[ch * i];
    const r = await EO.readChordPage({ data: g, width: png.width, height: png.height }, run, { firstBar: first });
    first = (r.layout.firstNumber || first) + r.layout.bars; pages.push(r);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`OCR: ${pngs.length} pages in ${((performance.now() - t1) / 1000).toFixed(1)} s`);
  score(perBar(pages), "RASTER OCR");
}
