/* Audit 2026-11-18 M4 verification (real app, headless Chromium):
 *   node bench/deployed-e2e.mjs [--playwright <path>] [--chromium <path>]
 * Assembles the site EXACTLY as .github/workflows/pages.yml does (its "Assemble site" script, run with a
 * temp dir in place of _site), serves it, and BLOCKS EVERY REQUEST THAT ISN'T TO THE SITE ITSELF. The app
 * must start (prebuilt: no Babel), read a tab PDF through the vendored PDF.js 4.10.38, open a Guitar Pro
 * file, and run an ML model (drum model) on the vendored ONNX Runtime. Logs every blocked request. */
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import http from "node:http";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import * as L from "./lib.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const require = createRequire(import.meta.url);
const { chromium } = require(arg("playwright", "/opt/node-tools/node_modules/playwright"));

// 1. the deploy's own assembly script
const yml = fs.readFileSync(path.join(L.repo, ".github/workflows/pages.yml"), "utf8");
const start = yml.indexOf("- name: Assemble site"), runAt = yml.indexOf("run: |", start);
const lines = yml.slice(runAt + 6).split("\n");
const body = [];
for (const ln of lines.slice(1)) { if (ln.trim() && !/^ {10}/.test(ln)) break; body.push(ln.slice(10)); }
const site = fs.mkdtempSync(path.join(os.tmpdir(), "ttp-deployed-"));
const script = body.join("\n").replace(/_site\b/g, site);
execFileSync("bash", ["-euo", "pipefail", "-c", script], { cwd: L.repo, env: { ...process.env, GITHUB_SHA: "e2e0000deadbeef" }, stdio: "inherit" });

// 2. serve it
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm", ".woff2": "font/woff2", ".onnx": "application/octet-stream" };
const served = new Set();
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"), f = path.join(site, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname));
  if (!f.startsWith(site)) { res.statusCode = 403; res.end(); return; }
  if (u.pathname === "/__pdf") { res.setHeader("content-type", "application/pdf"); res.end(fs.readFileSync(path.join(L.repo, "Kid Charlemagne - Steeley Dan.pdf"))); return; }
  fs.readFile(f, (e, d) => { if (e) { res.statusCode = 404; res.end(); return; } served.add(u.pathname); res.setHeader("content-type", MIME[path.extname(f)] || "application/octet-stream"); res.end(d); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

// 3. a browser that can reach nothing else
const browser = await chromium.launch({ executablePath: arg("chromium", "/opt/pw-browsers/chromium") });
const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 } });
const blocked = [];
await ctx.route((url) => !url.href.startsWith(origin), (r) => { blocked.push(r.request().url()); r.abort(); });
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => { if (m.type() === "error") logs.push(m.text()); });
page.on("pageerror", (e) => logs.push(e.message));
const steps = [];
const ok = (name, cond, extra) => { steps.push(!!cond); console.log(cond ? "OK  " : "FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ""); };

await page.goto(origin + "/");
await page.getByText("TAB").first().waitFor({ timeout: 30000 });
await page.waitForTimeout(800);
ok("the app starts with every third-party host blocked", await page.getByRole("tab", { name: "MusicXML / GP" }).count() > 0, logs.slice(0, 2));
ok("prebuilt path: build/app.js + build/engine.js served, Babel never requested", served.has("/build/app.js") && served.has("/build/engine.js") && !blocked.some((u) => /babel/.test(u)), [...served].filter((s) => s.startsWith("/build")));
ok("React comes from vendor/react-18.3.1", served.has("/vendor/react-18.3.1/react.production.min.js") && served.has("/vendor/react-18.3.1/react-dom.production.min.js"));

// Path A: a tab PDF through the vendored PDF.js
await page.getByRole("button", { name: /PDF/ }).first().click();
await page.locator('input[type="file"]').first().setInputFiles(path.join(L.repo, "Blue Sky - The Allman Brothers Band.pdf"));
await page.getByText(/165 bars/).first().waitFor({ timeout: 60000 }).catch(() => {});
ok("Path A reads Blue Sky (165 bars) with the vendored PDF.js 4.10.38", /165 bars/.test(await page.locator("body").innerText()) && served.has("/vendor/pdfjs-4.10.38/pdf.min.mjs") && served.has("/vendor/pdfjs-4.10.38/pdf.worker.min.mjs"));

// Scan renders PDF pages to a canvas: the 4.x render API through the hardened options
const render = await page.evaluate(async () => {
  const bytes = new Uint8Array(await (await fetch("/__pdf")).arrayBuffer());
  const pdf = await window.pdfjsLib.getDocument({ data: bytes, isEvalSupported: false, enableXfa: false }).promise;
  const pg = await pdf.getPage(1), vp = pg.getViewport({ scale: 1 }), c = document.createElement("canvas");
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const cx = c.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, c.width, c.height);
  await pg.render({ canvasContext: cx, viewport: vp }).promise;
  const d = cx.getImageData(0, 0, c.width, c.height).data; let dark = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark++;
  return { w: c.width, h: c.height, dark };
});
ok("a PDF page renders to a canvas (Scan) with PDF.js 4", render.dark > 1000, render);

// Guitar Pro (worker parse: build/engine.js imported by the engine worker)
await page.getByRole("tab", { name: "MusicXML / GP" }).click();
await page.locator('input[type="file"]').first().setInputFiles(path.join(L.repo, "Steely Dan - Peg.gp4"));
await page.getByText(/bars ·/).first().waitFor({ timeout: 60000 }).catch(() => {});
ok("a Guitar Pro file opens", /Peg/.test(await page.locator("body").innerText()));

// an ML model on the vendored ONNX Runtime
const drum = await page.evaluate(async () => {
  if (typeof window.TTP_DRUM_MODEL !== "function") return { err: "no TTP_DRUM_MODEL" };
  const sr = 44100, x = new Float32Array(sr * 3);
  for (let k = 0; k < 6; k++) { const i0 = Math.round((0.25 + k * 0.5) * sr); for (let i = 0; i < 4000; i++) x[i0 + i] += Math.sin(2 * Math.PI * (60 + 90 * Math.exp(-i / 800)) * i / sr) * Math.exp(-i / 1500); }
  try { const r = await window.TTP_DRUM_MODEL(x, sr, {}); return { events: (r.events || []).length, method: r.method }; } catch (e) { return { err: String(e && e.message || e) }; }
});
ok("the drum model runs on the same-origin ONNX Runtime", !drum.err && served.has("/vendor/onnxruntime-web-1.23.2/ort.wasm.min.mjs") && served.has("/vendor/onnxruntime-web-1.23.2/ort-wasm-simd-threaded.wasm"), drum);

const real = blocked.filter((u) => !/fonts\.(googleapis|gstatic)\.com/.test(u));
ok("no third-party request was needed (web fonts aside)", real.length === 0, real.slice(0, 5));
const errs = logs.filter((l) => !/fonts\.googleapis|ERR_FAILED|net::|W:onnxruntime/.test(l));
ok("no console errors", errs.length === 0, errs.slice(0, 3));
console.log(`blocked: ${blocked.length} request(s)${blocked.length ? " — " + [...new Set(blocked.map((u) => new URL(u).host))].join(", ") : ""}`);
await browser.close(); server.close(); fs.rmSync(site, { recursive: true, force: true });
const all = steps.every(Boolean);
console.log(all ? "\nALL OK" : "\nSOME CHECKS FAILED");
process.exit(all ? 0 : 1);
