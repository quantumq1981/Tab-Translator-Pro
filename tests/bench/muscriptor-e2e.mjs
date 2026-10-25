/* Muscriptor sheets zip end to end: the REAL app in headless Chromium, no stubs. Dev-only.
 *
 *   node bench/muscriptor-e2e.mjs --deps <dir> [--zip fixtures/muscriptor-saddle-up_sheets.zip] [--out <dir>]
 *
 * --deps: the React + Babel bundle scnet-e2e.mjs describes (the sandbox blocks esm.sh / unpkg).
 * MusicXML / GP mode → upload the zip → checks it lands on "Harmony (all pitched parts)", the
 * key and the spelling, switches to one part and back, flips the spelling, reloads (session
 * restore), then uploads the zip's score.mid alone. Phone viewport (390×844).
 */
import fs from "node:fs"; import path from "node:path"; import http from "node:http";
import { createRequire } from "node:module";
import * as L from "./lib.mjs";
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const DEPS = arg("deps"); if (!DEPS) { console.error("--deps <dir> is required"); process.exit(2); }
const ZIP = path.resolve(L.repo, "tests", arg("zip", "fixtures/muscriptor-saddle-up_sheets.zip")), OUT = arg("out", process.cwd());
const require = createRequire(import.meta.url);
const { chromium } = require(arg("playwright", "/opt/node-tools/node_modules/playwright"));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".tsx": "text/plain", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const f = path.join(L.repo, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname));
  if (!f.startsWith(L.repo)) { res.statusCode = 403; res.end(); return; }
  fs.readFile(f, (e, data) => { if (e) { res.statusCode = 404; res.end(); return; } res.setHeader("content-type", MIME[path.extname(f)] || "application/octet-stream"); res.end(data); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: arg("chromium", "/opt/pw-browsers/chromium") });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const ALL = fs.readFileSync(path.join(DEPS, "all.mjs"), "utf8"), BABEL = fs.readFileSync(path.join(DEPS, "babel.min.js"));
const js = (body) => ({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body });
await ctx.route("https://esm.sh/__e2e/all.mjs", (r) => r.fulfill(js(ALL)));
await ctx.route(/^https:\/\/esm\.sh\/react@18\.3\.1(\?.*)?$/, (r) => r.fulfill(js('export * from "/__e2e/all.mjs"; export { React as default } from "/__e2e/all.mjs";')));
await ctx.route(/^https:\/\/esm\.sh\/react-dom@18\.3\.1\/client.*/, (r) => r.fulfill(js('import { createRoot, hydrateRoot } from "/__e2e/all.mjs"; export { createRoot, hydrateRoot }; export default { createRoot, hydrateRoot };')));
await ctx.route("https://unpkg.com/@babel/standalone@7.25.6/babel.min.js", (r) => r.fulfill({ ...js(""), body: BABEL }));
await ctx.route(/^https:\/\/cdnjs\.cloudflare\.com\//, (r) => r.abort());
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => { if (m.type() === "error") logs.push(`[error] ${m.text()}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
const R = {};
const harmony = () => page.getByRole("button", { name: "Harmony (all pitched parts)" });
// the selected part chip is drawn in the amber accent: compare against the mode button's colour is fragile, so
// read both chips and call "on" the one whose colour differs from the majority of part chips
const isOn = async (loc) => { const c = await loc.evaluate((b) => getComputedStyle(b).color); const others = await page.locator("button").filter({ hasText: /piano|bass|guitar|drums|voice|percussion/i }).evaluateAll((bs) => bs.map((b) => getComputedStyle(b).color)); const off = others.sort((a, b) => others.filter((x) => x === b).length - others.filter((x) => x === a).length)[0]; return c !== off; };
const chartText = async () => (await page.locator("body").innerText());
await page.goto(ORIGIN + "/"); await page.waitForTimeout(500);
await page.getByRole("button", { name: "MusicXML / GP" }).click({ timeout: 60000 });
const up = page.locator('input[type="file"]').first();
await up.setInputFiles(ZIP);
await harmony().waitFor({ timeout: 60000 });
await page.getByText(/1 chord\/bar ✓/).first().waitFor({ timeout: 30000 });
let t = await chartText();
R.zip = { harmonySelected: await isOn(harmony()), key: (t.match(/key (\S+) \(/) || [])[1], simplified: /1 chord\/bar ✓/.test(t), hasFm9: /Fm9/.test(t), hasDbmaj7: /Dbmaj7|D♭maj7/.test(t), sharpRoots: (t.match(/\b[CDGA]#(?:m|maj|7|\b)/g) || []).length };
await page.screenshot({ path: path.join(OUT, "muscriptor-harmony.png"), fullPage: true });
await page.getByRole("button", { name: /piano/i }).first().click(); await page.waitForTimeout(800);
t = await chartText(); R.piano = { harmonySelected: await isOn(harmony()), key: (t.match(/key (\S+) \(/) || [])[1] };
await harmony().click(); await page.waitForTimeout(800);
await page.locator("select").filter({ hasText: "Spell for key" }).first().selectOption("family"); await page.waitForTimeout(500);
t = await chartText(); R.familySpelling = { hasC: /C#maj7|C#\b/.test(t), hasDb: /Dbmaj7/.test(t) };
await page.locator("select").filter({ hasText: "Spell for key" }).first().selectOption("key"); await page.waitForTimeout(500);
await page.reload(); await page.waitForTimeout(1500);
await page.getByText(/Restored/).first().waitFor({ timeout: 60000 }).catch(() => {});
await harmony().waitFor({ timeout: 60000 }).catch(() => {});
t = await chartText(); R.restored = { banner: /Restored/.test(t), harmonySelected: (await harmony().count()) ? await isOn(harmony()) : false, hasDbmaj7: /Dbmaj7/.test(t) };
// the zip's MIDI on its own
const mid = path.join(OUT, "score.mid");
{ const eng = await L.loadEngine(); const z = new Uint8Array(fs.readFileSync(ZIP)); fs.writeFileSync(mid, await eng._zipRead(z, eng._zipEntries(z).find((e) => e.name === "score.mid"))); }
await page.getByRole("button", { name: "MusicXML / GP" }).click().catch(() => {});
await page.locator('input[type="file"]').first().setInputFiles(mid);
await page.waitForTimeout(1500);
t = await chartText(); R.midi = { harmonySelected: (await harmony().count()) ? await isOn(harmony()) : false, key: (t.match(/key (\S+) \(/) || [])[1], hasFm9: /Fm9/.test(t) };
await page.screenshot({ path: path.join(OUT, "muscriptor-midi.png"), fullPage: true });
R.overflowX = await page.evaluate(() => { const W = window.innerWidth; const wide = [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > W + 1 && getComputedStyle(e).position !== "fixed").map((e) => `${e.tagName}.${(e.textContent || "").trim().slice(0, 30)} → ${Math.round(e.getBoundingClientRect().right)}`); return { scrollWidth: document.documentElement.scrollWidth, width: W, widest: wide.slice(-6) }; });
R.errors = logs;
console.log(JSON.stringify(R, null, 1));
await browser.close(); server.close();
