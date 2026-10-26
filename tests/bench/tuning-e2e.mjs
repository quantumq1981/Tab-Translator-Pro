/* tuning-e2e.mjs — the Guitar → Tab tuning picker + capo in the real app.
 *
 *  Dev-only. Headless Chromium runs the actual app (React/Babel from --deps, same recipe as
 *  scnet-e2e.mjs). The guitar MODEL is replaced by a stub that returns a fixed Drop-D riff, so this
 *  checks the new UI, not the CRNN (guitar-e2e.mjs covers that): the suggestion appears, "Use Drop D"
 *  re-fingers the tab, the capo stepper writes \capo, and alphaTab sounds the riff's exact pitches in
 *  every state.
 *    node bench/tuning-e2e.mjs --deps <dir> [--shot out.png] [--playwright <path>]
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import * as L from "./lib.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const DEPS = arg("deps");
if (!DEPS) { console.error("--deps <dir> is required"); process.exit(2); }
const require = createRequire(import.meta.url);
const { chromium } = require(arg("playwright", "/opt/node-tools/node_modules/playwright"));
const alphaTab = await import("@coderline/alphatab");

// A Drop-D riff: low-D power chords, an open-position G, single notes (sounding pitches).
const RIFF = [[38, 45, 50], [38, 45, 50], [41, 48, 53], [43, 50, 55, 59, 64], [38], [38], [45, 50], [38, 45, 50, 57, 62, 66], [38, 45, 50], [43, 50, 55]];
const NOTES = RIFF.flatMap((ms, i) => ms.map((midi) => ({ midi, startSec: i * 0.5, endSec: i * 0.5 + 0.45, velocity: 90 })));
const WANT = RIFF.flat().sort((a, b) => a - b).join();
const STUB = `window.TTP_GUITAR_MODEL = async (pcm, opts) => { if (opts && opts.onProgress) opts.onProgress(1, 1); return { notes: ${JSON.stringify(NOTES)} }; };`;

// 6 s of a quiet D chord as the "recording" (any decodable audio will do)
const sr = 44100, n = sr * 6, wav = Buffer.alloc(44 + n * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) { const t = i / sr; const v = 0.15 * (Math.sin(2 * Math.PI * 73.4 * t) + Math.sin(2 * Math.PI * 110 * t) + Math.sin(2 * Math.PI * 146.8 * t)); wav.writeInt16LE(Math.round(v * 32767 / 3), 44 + i * 2); }
const wavPath = path.join(L.here, ".cache", "tuning-e2e.wav");
fs.mkdirSync(path.dirname(wavPath), { recursive: true }); fs.writeFileSync(wavPath, wav);

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".tsx": "text/plain", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/guitar-model.js") { res.setHeader("content-type", "text/javascript"); res.end(STUB); return; }
  const f = path.join(L.repo, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname));
  if (!f.startsWith(L.repo)) { res.statusCode = 403; res.end(); return; }
  fs.readFile(f, (e, data) => { if (e) { res.statusCode = 404; res.end(); return; } res.setHeader("content-type", MIME[path.extname(f)] || "application/octet-stream"); res.end(data); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: +arg("width", 390), height: 844 } });
const ALL = fs.readFileSync(path.join(DEPS, "all.mjs"), "utf8"), BABEL = fs.readFileSync(path.join(DEPS, "babel.min.js"));
const js = (body) => ({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body });
await ctx.route("https://esm.sh/__e2e/all.mjs", (r) => r.fulfill(js(ALL)));
await ctx.route(/^https:\/\/esm\.sh\/react@18\.3\.1(\?.*)?$/, (r) => r.fulfill(js('export * from "/__e2e/all.mjs"; export { React as default } from "/__e2e/all.mjs";')));
await ctx.route(/^https:\/\/esm\.sh\/react-dom@18\.3\.1\/client.*/, (r) => r.fulfill(js('import { createRoot, hydrateRoot } from "/__e2e/all.mjs"; export { createRoot, hydrateRoot }; export default { createRoot, hydrateRoot };')));
await ctx.route("https://unpkg.com/@babel/standalone@7.25.6/babel.min.js", (r) => r.fulfill({ ...js(""), body: BABEL }));
await ctx.route(/^https:\/\/cdnjs\.cloudflare\.com\//, (r) => r.abort());
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const results = [];
const check = (ok, label) => { results.push([ok, label]); console.log(`${ok ? "✓" : "✗"} ${label}`); };
const readTex = (tex) => {
  const imp = new alphaTab.importer.AlphaTexImporter(); imp.initFromString(tex, new alphaTab.Settings());
  const st = imp.readScore().tracks[0].staves[0];
  const pitches = st.bars.flatMap((b) => b.voices.flatMap((v) => v.beats.flatMap((bt) => bt.notes.filter((x) => !x.isTieDestination).map((x) => x.realValue)))).sort((a, b) => a - b).join();
  return { st, pitches };
};

await page.goto(ORIGIN + "/");
await page.getByRole("button", { name: "Audio 🎵" }).click({ timeout: 60000 });
await page.locator('input[type="file"]:not([multiple])').first().setInputFiles(wavPath);
const btn = page.getByRole("button", { name: "🎸 Guitar → Tab (ML)" });
await btn.waitFor({ timeout: 120000 });
await page.waitForFunction(() => !document.body.innerText.includes("⏳ Analyzing"), null, { timeout: 300000 });
await btn.click();
const meta = page.getByText(/notes from the guitar model/).first();
await meta.waitFor({ timeout: 60000 });
const panel = meta.locator("xpath=..");
const sugg = page.getByText(/sit below standard tuning's low E/);
await sugg.waitFor({ timeout: 20000 }).catch(() => {});
check(await sugg.count() > 0 && /Drop D/.test(await sugg.first().innerText()), "the suggestion line appears and names Drop D");
const metaText = () => page.getByText(/from the guitar ML model/).first().innerText();
check(/Standard/.test(await metaText()), "the tab starts in standard (suggested, not applied)");

await panel.getByRole("button", { name: "AlphaTex (tab)" }).click();
// the export panel snapshots its text when the button is pressed (every format does), so press it again
const texNow = async () => { await panel.getByRole("button", { name: "AlphaTex (tab)" }).click(); await page.waitForTimeout(150); return panel.locator("textarea").first().inputValue(); };
let tex = await texNow();
check(/notes? outside this instrument's range/.test(tex) && /\\tuning \(E4 B3 G3 D3 A2 E2\)/.test(tex), "in standard the low Ds are unplayable — the export says so");

await page.getByRole("button", { name: "Use Drop D" }).click();
await page.waitForTimeout(400);
check(/Drop D/.test(await metaText()) && (await page.getByText(/sit below standard tuning's low E/).count()) === 0, "Use Drop D applies it; the suggestion goes away");
tex = await texNow();
if (arg("dump")) fs.writeFileSync(arg("dump"), tex);
let r = readTex(tex);
check(/\\tuning \(E4 B3 G3 D3 A2 D2\)/.test(tex) && !/outside this instrument's range/.test(tex) && r.pitches === WANT, `Drop D: tuning line, no notes left out, alphaTab sounds the riff exactly (${r.pitches === WANT ? "match" : r.pitches})`);

const plus = page.getByRole("button", { name: "capo up" });
await plus.click(); await plus.click(); await page.waitForTimeout(400);
tex = await texNow(); r = readTex(tex);
check(/\\capo 2/.test(tex) && r.st.capo === 2 && /capo 2/.test(await metaText()), "capo +2 → \\capo 2 in the export (alphaTab reads capo 2) and in the meta line");
const lowest = 38 + 2, kept = WANT.split(",").map(Number).filter((m) => m >= lowest).join();
check(r.pitches === kept, `with capo 2 on Drop D, alphaTab sounds every riff pitch the capo'd strings can reach, and only those (${r.pitches.split(",").length}/${WANT.split(",").length}; the low Ds sit under the capo)`);
await page.getByRole("button", { name: "capo down" }).click(); await page.getByRole("button", { name: "capo down" }).click(); await page.waitForTimeout(300);
r = readTex(await texNow());
check(r.pitches === WANT && r.st.capo === 0, "capo back to 0 → the riff again, exactly");
if (arg("shot")) await panel.screenshot({ path: arg("shot") });
check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
await browser.close(); server.close();
process.exit(results.every(([ok]) => ok) ? 0 : 1);
