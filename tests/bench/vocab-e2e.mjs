/* Chord-vocabulary picker end to end: the REAL app in headless Chromium, a real audio file in
 * Audio mode. Reads the decoded chart under Chart (default) → Full → Basic, and checks the choice
 * survives a reload. Dev-only.
 *
 *   node bench/vocab-e2e.mjs --deps <dir> [--audio "<file in repo>"] [--width 390 --height 844]
 *   node bench/vocab-e2e.mjs --deps <dir> --gp "<Guitar Pro file in repo>" [--part N]   # the ChartPanel picker on a file import
 *
 * --deps is the React + Babel bundle scnet-e2e.mjs describes (the sandbox blocks esm.sh / unpkg). */
import fs from "node:fs"; import path from "node:path"; import http from "node:http";
import { createRequire } from "node:module";
import * as L from "./lib.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const DEPS = arg("deps"); if (!DEPS) { console.error("--deps <dir> is required"); process.exit(2); }
const AUDIO = path.resolve(L.repo, arg("audio", "isolated Backing VOCALS ONLY ALL 3 Chorus’ - 6JuVUq.mp3"));   // headless Chromium: pass a WAV if MP3 decode is unavailable
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
const ctx = await browser.newContext({ viewport: { width: +arg("width", 390), height: +arg("height", 844) }, deviceScaleFactor: 2, hasTouch: true });
const ALL = fs.readFileSync(path.join(DEPS, "all.mjs"), "utf8"), BABEL = fs.readFileSync(path.join(DEPS, "babel.min.js"));
const js = (body) => ({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body });
await ctx.route("https://esm.sh/__e2e/all.mjs", (r) => r.fulfill(js(ALL)));
await ctx.route(/^https:\/\/esm\.sh\/react@18\.3\.1(\?.*)?$/, (r) => r.fulfill(js('export * from "/__e2e/all.mjs"; export { React as default } from "/__e2e/all.mjs";')));
await ctx.route(/^https:\/\/esm\.sh\/react-dom@18\.3\.1\/client.*/, (r) => r.fulfill(js('import { createRoot, hydrateRoot } from "/__e2e/all.mjs"; export { createRoot, hydrateRoot }; export default { createRoot, hydrateRoot };')));
await ctx.route("https://unpkg.com/@babel/standalone@7.25.6/babel.min.js", (r) => r.fulfill({ ...js(""), body: BABEL }));
await ctx.route(/^https:\/\/(?!esm\.sh|unpkg\.com)/, (r) => r.abort());
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => { if (m.type() === "error") logs.push(`[error] ${m.text()}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

const chartSyms = async () => (await page.locator('button[title*="guitar voicings"]').allInnerTexts()).map((t) => t.trim().split("\n")[0]);
const settle = async (prev) => {   // wait for the re-analysis to land: "Analyzing" gone and the chart rendered
  await page.waitForTimeout(400);
  await page.waitForFunction(() => !/Analyz/i.test(document.body.innerText), null, { timeout: 180000 });
  await page.locator('button[title*="guitar voicings"]').first().waitFor({ timeout: 180000 });
  await page.waitForTimeout(500);
  return chartSyms();
};
const stats = (s) => ({ chords: s.length, slash: s.filter((x) => /\/[A-G]/.test(x.replace("6/9", ""))).length, sus2_69_add9: s.filter((x) => /sus2|6\/9|add9/.test(x)).length, maj7: s.filter((x) => /maj7/.test(x)).length, maj9: s.filter((x) => /maj9/.test(x)).length, m11: s.filter((x) => /m11/.test(x)).length, sample: s.slice(0, 14).join(" ") });

await page.goto(ORIGIN + "/"); await page.waitForTimeout(500);
if (arg("gp")) {
  // a file import is named by the oracle; the ChartPanel picker re-names it (respellScore)
  await page.getByRole("button", { name: "MusicXML / GP" }).click({ timeout: 60000 });
  await page.locator('input[type="file"]').first().setInputFiles(path.resolve(L.repo, arg("gp")));
  if (arg("part")) { await page.locator('button[title^="chart the "]').nth(+arg("part")).click(); }
  await page.locator('button[title*="guitar voicings"]').first().waitFor({ timeout: 60000 }); await page.waitForTimeout(600);
  const res = { chart: stats(await chartSyms()), chartActive: await page.getByRole("button", { name: "Pro ✓" }).first().isVisible() };
  await page.getByRole("button", { name: /^Full$/ }).first().click(); await page.waitForTimeout(600);
  res.full = stats(await chartSyms());
  await page.getByRole("button", { name: /^Pro$/ }).first().click(); await page.waitForTimeout(600);
  res.back = stats(await chartSyms());
  res.errors = logs.filter((l) => !/ERR_FAILED/.test(l));
  await page.screenshot({ path: path.join(arg("out", process.cwd()), "vocab-e2e-gp.png") });
  console.log(JSON.stringify(res, null, 2)); await browser.close(); server.close(); process.exit(0);
}
await page.getByRole("button", { name: "Audio 🎵" }).click({ timeout: 60000 });
await page.locator('label', { hasText: 'Upload audio' }).locator('input[type="file"]').setInputFiles(AUDIO);
const out = {};
out.chart = stats(await settle());
out.chartActive = await page.getByRole("button", { name: "Pro ✓" }).first().isVisible();
const six = page.locator("label", { hasText: "6/9 →" }).locator("select").first();
out.sixNineDefault = await six.inputValue();
await six.selectOption("maj7");
out.chartMaj7 = stats(await settle());
out.sixNineStored = await page.evaluate(() => localStorage.getItem("ttp:sixNine"));
await page.getByRole("button", { name: /^Full$/ }).first().click();
out.full = stats(await settle());
await page.getByRole("button", { name: /^Basic$/ }).first().click();
out.basic = stats(await settle());
out.stored = await page.evaluate(() => localStorage.getItem("ttp:chordVocab"));
await page.screenshot({ path: path.join(arg("out", process.cwd()), "vocab-e2e.png"), fullPage: false });
await page.reload(); await page.waitForTimeout(500);
await page.getByRole("button", { name: "Audio 🎵" }).click({ timeout: 60000 });
await page.locator('label', { hasText: 'Upload audio' }).locator('input[type="file"]').setInputFiles(AUDIO);
await settle();
out.afterReload = (await page.getByRole("button", { name: "Basic ✓" }).first().isVisible()) ? "Basic ✓" : "lost";
out.errors = logs;
console.log(JSON.stringify(out, null, 2));
await browser.close(); server.close();
