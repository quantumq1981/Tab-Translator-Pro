/* VENDORED DEPENDENCIES suite — audit 2026-11-18 C1 / M4 (docs/AUDIT-2026-11-18.md).
 *   · the app's own PDF.js (vendor/pdfjs-4.10.38, the legacy build) reads Blue Sky to the validated
 *     165-bar chart through the app's options (isEvalSupported: false) — so the file that ships is the
 *     file that is tested (path-a-smoke.mjs keeps 3.11.174 as an independent reference reader);
 *   · every vendored file matches the SHA-256 in its NOTICE.txt (React, PDF.js, ONNX Runtime);
 *   · the boot path names no third-party host: React, PDF.js and ONNX Runtime are same-origin, Babel is
 *     loaded only by the development path and only with its SRI hash;
 *   · scripts/build_app.mjs (the deploy-time transpile) produces modules whose imports are all
 *     same-origin, and stamps index.html. */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const read = (f) => fs.readFileSync(path.join(repo, f), "utf8");
let failures = 0, passes = 0;
const expect = (cond, msg) => { if (cond) passes++; else { failures++; console.error("FAIL:", msg); } };
const section = (name) => console.log(`\n— ${name}`);

section("the shipped PDF.js (4.10.38 legacy) reads Blue Sky like the reference");
{
  const pdfjs = await import(path.join(repo, "vendor/pdfjs-4.10.38/pdf.min.mjs"));
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(repo, "vendor/pdfjs-4.10.38/pdf.worker.min.mjs")).href; // as the app sets it
  expect(pdfjs.version === "4.10.38", `vendored PDF.js is 4.10.38 (got ${pdfjs.version})`);
  fs.writeFileSync(path.join(here, ".engine.vendored.mjs"), read("engine.tsx"));
  const eng = await import(path.join(here, ".engine.vendored.mjs") + "?t=" + Date.now());
  const data = new Uint8Array(fs.readFileSync(path.join(repo, "Blue Sky - The Allman Brothers Band.pdf")));
  const pdf = await pdfjs.getDocument({ data, isEvalSupported: false, enableXfa: false, verbosity: 0 }).promise;
  const tokens = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p), vp = page.getViewport({ scale: 1 }), tc = await page.getTextContent();
    for (const it of tc.items) { const s = (it.str || "").trim(); if (s === "(single)") continue; const m = s.match(/\d+/); if (!m) continue; tokens.push({ x: it.transform[4], y: vp.height - it.transform[5], val: parseInt(m[0], 10), page: p }); }
  }
  const chart = eng.buildChart(tokens);
  const bars = chart.measures.map((m) => { const syms = m.columns.map((c) => eng.symbolForFrets(c.frets, true)); return syms.filter((s, i) => i === 0 || s !== syms[i - 1]).join(" "); });
  expect(bars.length === 165, `165 bars (got ${bars.length})`);
  expect(bars.slice(0, 8).join(" ") === "E A A E E A A E", `verse E A A E E A A E (got ${bars.slice(0, 8).join(" ")})`);
  const ol = await (await pdf.getPage(1)).getOperatorList();
  expect(ol.fnArray.includes(pdfjs.OPS.constructPath) && Array.isArray(ol.argsArray[ol.fnArray.indexOf(pdfjs.OPS.constructPath)][0]), "constructPath still carries [ops, coords, …] (what pdfPageVectors reads)");
  await pdf.destroy();
}

section("vendored files match their pinned SHA-256");
for (const [dir, files] of [
  ["vendor/react-18.3.1", ["react.production.min.js", "react-dom.production.min.js"]],
  ["vendor/pdfjs-4.10.38", ["pdf.min.mjs", "pdf.worker.min.mjs"]],
  ["vendor/onnxruntime-web-1.23.2", ["ort.wasm.min.mjs", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]],
]) {
  const notice = read(`${dir}/NOTICE.txt`);
  for (const f of files) {
    const h = crypto.createHash("sha256").update(fs.readFileSync(path.join(repo, dir, f))).digest("hex");
    expect(new RegExp(f.replace(/\./g, "\\.") + "\\s+" + h).test(notice), `${dir}/${f} matches its pin`);
  }
}

section("the boot path names no third-party host");
{
  const html = read("index.html"), ui = read("TabDecoderPro.tsx"), pages = read(".github/workflows/pages.yml");
  expect(!/<script[^>]+src="https?:/.test(html), "index.html loads no script from another origin");
  expect(!/esm\.sh|importmap/.test(html.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\/[^\n]*/g, "")), "no esm.sh React, no import map");
  expect(/src="\.\/vendor\/react-18\.3\.1\/react\.production\.min\.js"/.test(html) && /src="\.\/vendor\/react-18\.3\.1\/react-dom\.production\.min\.js"/.test(html), "React + ReactDOM are same-origin");
  expect(/BABEL_SRI = "sha384-[A-Za-z0-9+/=]{64}"/.test(html) && /s\.integrity = BABEL_SRI/.test(html) && /if \(window\.__TTP_BUILD__\)/.test(html), "Babel loads only on the development path, with its SRI hash");
  const sri = html.match(/BABEL_SRI = "(sha384-[^"]+)"/)[1];
  const babel = fs.readFileSync(path.join(here, "node_modules/@babel/standalone/babel.min.js"));
  expect(sri === "sha384-" + crypto.createHash("sha384").update(babel).digest("base64"), "the SRI hash is the hash of the pinned @babel/standalone 7.25.6");
  expect(!/cdnjs|pdf\.js\/3\./.test(ui) && /vendor\/pdfjs-4\.10\.38\//.test(ui), "the UI loads PDF.js from vendor/pdfjs-4.10.38, not cdnjs");
  for (const d of ["react-18.3.1", "pdfjs-4.10.38", "onnxruntime-web-1.23.2"]) expect(new RegExp(`cp -r vendor/${d.replace(/\./g, "\\.")}/\\. _site/vendor/${d.replace(/\./g, "\\.")}/`).test(pages), `the deploy ships vendor/${d}`);
  expect(/npm ci/.test(pages) && !/run: npm install/.test(pages) && fs.existsSync(path.join(here, "package-lock.json")), "CI installs from the committed lockfile (npm ci)");
  const pkg = JSON.parse(read("tests/package.json"));
  expect(Object.values(pkg.devDependencies).every((v) => /^\d+\.\d+\.\d+$/.test(v)), "test dependencies are pinned to exact versions");
}

section("deploy-time build (scripts/build_app.mjs)");
{
  const site = fs.mkdtempSync(path.join(os.tmpdir(), "ttp-site-"));
  fs.copyFileSync(path.join(repo, "index.html"), path.join(site, "index.html"));
  execFileSync(process.execPath, [path.join(repo, "scripts/build_app.mjs"), site, "t3st"], { stdio: "pipe" });
  const app = fs.readFileSync(path.join(site, "build/app.js"), "utf8"), shim = fs.readFileSync(path.join(site, "build/react-shim.js"), "utf8");
  const imports = [...app.matchAll(/(?:^|;)import[^;]*?from\s*"([^"]+)"/gm)].map((m) => m[1]); // compact output: imports share a line
  expect(imports.length === 3 && imports.every((u) => /^\.\/(engine|session-store|react-shim)\.js\?v=t3st$/.test(u)), `app.js imports only its same-origin siblings (${imports.join(", ")})`);
  expect(/export default R;/.test(shim) && /export const useState = R\.useState;/.test(shim), "the React shim re-exports the vendored React");
  expect(fs.readFileSync(path.join(site, "index.html"), "utf8").includes('window.__TTP_BUILD__ = "t3st"'), "index.html is stamped, which switches the loader to build/");
  expect(fs.readFileSync(path.join(site, "build/session-store.js"), "utf8") === read("session-store.js"), "build/session-store.js is the source, as is");
  // perf audit 2026-11-26: deployed modules ship without comments / layout whitespace, and are preloaded
  const eng = fs.readFileSync(path.join(site, "build/engine.js"), "utf8"), page = fs.readFileSync(path.join(site, "index.html"), "utf8");
  const jsComments = (t) => (t.match(/\/\*/g) || []).length; // the few left in app.js are CSS comments inside its <style> string
  expect(jsComments(app) < 20 && jsComments(eng) < 20 && app.split("\n").length < 200 && eng.length < read("engine.tsx").length * 0.7, `build/ modules carry no comments (engine.js ${Math.round(eng.length / 1024)} KB vs ${Math.round(read("engine.tsx").length / 1024)} KB source)`);
  for (const f of ["engine.js", "app.js", "session-store.js", "react-shim.js"]) expect(page.includes(`<link rel="modulepreload" href="./build/${f}?v=t3st" />`), `index.html preloads build/${f} at the stamped URL the page imports`);
  fs.rmSync(site, { recursive: true, force: true });
}

section("load-time rails (perf audit 2026-11-26)");
{
  const html = read("index.html"), ui = read("TabDecoderPro.tsx");
  const head = html.slice(0, html.indexOf("</head>"));
  expect(/<script defer src="\.\/vendor\/react-18\.3\.1\/react\.production\.min\.js"><\/script>/.test(html) && /<script defer src="\.\/vendor\/react-18\.3\.1\/react-dom\.production\.min\.js"><\/script>/.test(html), "React loads with defer (never blocks the parser / first paint)");
  expect(head.indexOf("#boot {") < head.indexOf("react.production.min.js"), "the splash CSS comes before every script");
  expect(!/<script(?![^>]*\b(?:defer|async|type="module"))[^>]*\bsrc=/.test(html), "no parser-blocking external script in index.html");
  const glue = ["note-model.js", "stem-model.js", "guitar-model.js", "drum-model.js", "chord-ocr-model.js", "beat-model.js", "tab-view.js"];
  expect(glue.every((f) => html.includes(`<script type="module" async src="./${f}"></script>`)), "the model glue modules are async (they never hold up the boot module)");
  expect(!/fonts\.googleapis\.com/.test(ui) && /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^"]*" media="print" onload="this\.media='all'"/.test(html) && /rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin/.test(html), "web fonts: requested from <head>, non-blocking, preconnected; none from the app's CSS");
  expect(/const \[pdfWanted, setPdfWanted\] = useState\(false\)/.test(ui) && /if \(!pdfWanted\) return;/.test(ui) && /\}, \[pdfWanted\]\);/.test(ui), "PDF.js loads on demand, not at boot");
  expect(/if \(mode === "pdf" \|\| mode === "scan"\) setPdfWanted\(true\)/.test(ui), "the PDF Chart and Scan tabs ask for PDF.js");
  expect((ui.match(/!pdfReady\) \{ setPdfWanted\(true\);/g) || []).length === 3, "a decode, a restore (both checks) and a library open of a PDF ask for PDF.js before they wait for it");
}

console.log(`\nvendored: ${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
