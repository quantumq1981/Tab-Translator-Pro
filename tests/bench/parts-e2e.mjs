/* All parts end-to-end: the REAL Tab Translator Pro and the REAL Chord Sheet Maker Pro served from one
 * origin (as on GitHub Pages), headless Chromium. Dev-only.
 *
 *   node bench/parts-e2e.mjs --deps <dir> --csmp <chord-sheet-maker-pro checkout> --stems <a.wav> <b.wav> …
 *
 * Imports stems (names decide the roles: guitar/other, bass, drums, vocals), charts them, presses
 * "⬇ All parts (zip)" (checks the zip's file list with our own reader), then "→ Chord Sheet Maker Pro
 * (all parts)" and checks that CSMP loads the band chart and files every part in its song library.
 */
import fs from "node:fs"; import path from "node:path"; import http from "node:http";
import { createRequire } from "node:module";
import * as L from "./lib.mjs";

const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const DEPS = arg("deps"), CSMP = arg("csmp"), si = argv.indexOf("--stems"), STEMS = si >= 0 ? argv.slice(si + 1).filter((a) => !a.startsWith("--")) : [];
if (!DEPS || !CSMP || !STEMS.length) { console.error("--deps, --csmp and --stems are required"); process.exit(2); }
const require = createRequire(import.meta.url);
const { chromium } = require(arg("playwright", "/opt/node-tools/node_modules/playwright"));
const eng = await L.loadEngine();
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".tsx": "text/plain", ".json": "application/json", ".css": "text/css", ".wav": "audio/wav", ".onnx": "application/octet-stream", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  let base = L.repo, p = u.pathname;
  if (p.startsWith("/chord-sheet-maker-pro/")) { base = CSMP; p = p.slice("/chord-sheet-maker-pro".length); }
  else if (p.startsWith("/Tab-Translator-Pro/")) p = p.slice("/Tab-Translator-Pro".length);
  const f = path.join(base, decodeURIComponent(p.endsWith("/") ? p + "index.html" : p));
  if (!f.startsWith(base)) { res.statusCode = 403; res.end(); return; }
  fs.readFile(f, (e, data) => { if (e) { res.statusCode = 404; res.end(); return; } res.setHeader("content-type", MIME[path.extname(f)] || "application/octet-stream"); res.end(data); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, acceptDownloads: true });
const ALL = fs.readFileSync(path.join(DEPS, "all.mjs"), "utf8"), BABEL = fs.readFileSync(path.join(DEPS, "babel.min.js"));
const js = (body) => ({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body });
await ctx.route("https://esm.sh/__e2e/all.mjs", (r) => r.fulfill(js(ALL)));
await ctx.route(/^https:\/\/esm\.sh\/react@18\.3\.1(\?.*)?$/, (r) => r.fulfill(js('export * from "/__e2e/all.mjs"; export { React as default } from "/__e2e/all.mjs";')));
await ctx.route(/^https:\/\/esm\.sh\/react-dom@18\.3\.1\/client.*/, (r) => r.fulfill(js('import { createRoot, hydrateRoot } from "/__e2e/all.mjs"; export { createRoot, hydrateRoot }; export default { createRoot, hydrateRoot };')));
await ctx.route("https://unpkg.com/@babel/standalone@7.25.6/babel.min.js", (r) => r.fulfill({ ...js(""), body: BABEL }));
await ctx.route(/^https:\/\/cdnjs\.cloudflare\.com\//, (r) => r.abort());
const page = await ctx.newPage();
const logs = []; page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
const out = {};
await page.goto(ORIGIN + "/Tab-Translator-Pro/"); await page.waitForTimeout(500);
await page.getByRole("button", { name: "Audio 🎵" }).click({ timeout: 60000 });
await page.locator('input[type="file"][multiple]').first().setInputFiles(STEMS);
await page.getByRole("button", { name: "♫ Chart these stems" }).click({ timeout: 120000 });
await page.getByText("TEMPO & BARS · shared by every stem chart").waitFor({ timeout: 600000 });
out.tabs = await page.locator("button").filter({ hasText: /^(Band|Guitar|Other|Bass|Vocals|Drums|Keys)/ }).allInnerTexts();
const dl = page.waitForEvent("download");
await page.getByRole("button", { name: "⬇ All parts (zip)" }).click();
const d = await dl; const zp = path.join(path.dirname(new URL(import.meta.url).pathname), ".parts-e2e.zip"); await d.saveAs(zp);
const zb = new Uint8Array(fs.readFileSync(zp)); out.zipName = d.suggestedFilename(); out.zipFiles = eng._zipEntries(zb).map((e) => e.name);
const full = new TextDecoder().decode(await eng._zipRead(zb, eng._zipEntries(zb).find((e) => e.name === "full_score.musicxml")));
out.fullScoreParts = (full.match(/<score-part /g) || []).length;
fs.unlinkSync(zp);
await page.getByRole("button", { name: "→ Chord Sheet Maker Pro (all parts)" }).click();
await page.waitForURL(/chord-sheet-maker-pro/, { timeout: 60000 });
await page.waitForFunction(() => /parts? saved to the library/.test(document.body.innerText), null, { timeout: 60000 }).catch(() => {});
out.csmpStatus = (await page.locator("body").innerText()).split("\n").find((l) => /Imported from/.test(l)) || null;
out.library = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem("csmpn_library") || "[]").map((e) => e.title); } catch (_) { return null; } });
out.sourceHead = await page.evaluate(() => (document.getElementById("source") || document.querySelector("textarea") || {}).value?.split("\n").slice(0, 6).join(" / "));
out.errors = logs.slice(0, 6);
console.log(JSON.stringify(out, null, 1));
await browser.close(); server.close();
