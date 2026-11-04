/* Chord READING end to end (2026-11-04): the REAL app in headless Chromium, Audio mode, a rendered
 * FULL MIX of a G-major song (bench/fullmix.mjs — Suspicious Minds, every track + a vibrato lead +
 * drums). Checks: the weak-evidence banner, Song key → re-decode (prefer / only key chords), the
 * chart's own key picker driving the decode, chord-change length, the review list's ✕ / merge.
 *
 *   node bench/fullmix.mjs   (once, writes the renders)
 *   node bench/reading-e2e.mjs --deps <dir> [--idx 26] [--width 390 --height 844] [--out <dir>]
 * --deps = the React + Babel bundle described in scnet-e2e.mjs / README.md. Dev-only. */
import fs from "node:fs"; import path from "node:path"; import http from "node:http";
import { createRequire } from "node:module";
import * as L from "./lib.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const DEPS = arg("deps"); if (!DEPS) { console.error("--deps <dir> is required"); process.exit(2); }
const OUT = arg("out", process.cwd());
const idx = +arg("idx", 26);
const require = createRequire(import.meta.url);
const { chromium } = require(arg("playwright", "/opt/node-tools/node_modules/playwright"));

// the render → a 16-bit WAV
const base = path.join(L.here, ".cache", `${idx}_fullmix`);
const meta = JSON.parse(fs.readFileSync(base + ".json", "utf8"));
const raw = fs.readFileSync(base + ".f32"), a = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
const wav = Buffer.alloc(44 + a.length * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(36 + a.length * 2, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(meta.sr, 24); wav.writeUInt32LE(meta.sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(a.length * 2, 40);
for (let i = 0; i < a.length; i++) wav.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(a[i] * 32767))), 44 + 2 * i);
const WAV = path.join(OUT, `fullmix-${idx}.wav`); fs.writeFileSync(WAV, wav);

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
const ctx = await browser.newContext({ viewport: { width: +arg("width", 390), height: +arg("height", 844) }, deviceScaleFactor: 1, hasTouch: true });
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

const chartSyms = async () => (await page.locator('button[title*="guitar voicings"]').allInnerTexts()).map((t) => t.trim().split("\n")[0].replace(/\?$/, ""));
const reviewRows = () => page.locator('button[aria-label^="delete chord at"]').count();
const settle = async () => {
  await page.waitForTimeout(400);
  await page.waitForFunction(() => !/Analyz/i.test(document.body.innerText), null, { timeout: 240000 });
  await page.locator('button[title*="guitar voicings"]').first().waitFor({ timeout: 240000 });
  await page.waitForTimeout(500);
  return chartSyms();
};
// out of G major (borrowed F / Cm / Eb / Bb count as in key, as 'only key chords' allows them)
const G = new Set([7, 9, 11, 0, 2, 4, 6]), PC = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
const outOfG = (s) => { const m = /^([A-G][#b]?)(m(?!aj))?([^/]*)(?:\/([A-G][#b]?))?/.exec(s); if (!m) return false; const r = PC[m[1]]; const minor = !!m[2];
  const tones = [r, (r + (minor ? 3 : 4)) % 12, (r + (/♭5|b5|dim/.test(m[3]) ? 6 : 7)) % 12]; if (/7/.test(m[3])) tones.push((r + (/maj7/.test(m[3]) ? 11 : /dim7/.test(m[3]) ? 9 : 10)) % 12); if (/sus4/.test(m[3])) tones[1] = (r + 5) % 12;
  if (m[4]) tones.push(PC[m[4]]); if (tones.every((x) => G.has(x))) return false; return ![5, 0, 3, 10].includes(r) || !tones.every((x) => G.has(x) || [10, 3, 8].includes(x)); };
const stats = (s) => ({ chords: s.length, outOfG: s.filter(outOfG).length, sample: s.slice(0, 16).join(" ") });

const out = { song: meta.file, idx };
await page.goto(ORIGIN + "/"); await page.waitForTimeout(500);
if (arg("debug")) { await page.waitForTimeout(8000); await page.screenshot({ path: path.join(OUT, "boot.png") }); console.log(logs.join("\n")); console.log((await page.locator("body").innerText()).slice(0, 600)); process.exit(0); }
await page.getByRole("button", { name: "Audio 🎵" }).click({ timeout: 60000 });
await page.locator("label", { hasText: "Upload audio" }).locator('input[type="file"]').setInputFiles(WAV);
out.auto = stats(await settle());
out.weakBanner = await page.getByText("Weak chord evidence").first().isVisible().catch(() => false);
out.autoReviewRows = await reviewRows();
await page.locator('select[title^="the song\'s key"]').first().scrollIntoViewIfNeeded();
await page.screenshot({ path: path.join(OUT, "reading-e2e-auto.png") });
await page.getByText("Weak chord evidence").first().scrollIntoViewIfNeeded().catch(() => {});
await page.screenshot({ path: path.join(OUT, "reading-e2e-banner.png") });

const songKey = page.locator('select[title^="the song\'s key"]').first();
await songKey.selectOption("G");
out.prefer = stats(await settle());
out.preferActive = await page.getByRole("button", { name: "Prefer key ✓" }).first().isVisible();
out.metaReadIn = await page.getByText("read in G").first().isVisible().catch(() => false);
await page.getByRole("button", { name: /^Only key chords/ }).first().click();
out.only = stats(await settle());
out.keyUseStored = await page.evaluate(() => localStorage.getItem("ttp:keyUse"));

// the chart's own key picker drives the decode
const chartKey = page.locator('select[title^="the detected key drives"]').first();
await chartKey.selectOption("D");
out.chartPickerD = stats(await settle());
out.songKeyNow = await songKey.inputValue();
await songKey.selectOption("G"); await settle();

await page.getByRole("button", { name: /^≥ 1 bar/ }).first().click();
out.oneBar = stats(await settle());
await page.getByRole("button", { name: /^Auto/ }).filter({ hasText: /^Auto( ✓)?$/ }).first().click();
await settle();
const showAll = page.getByRole("button", { name: /^show all/ });
if (await showAll.count()) { await showAll.first().click(); await page.waitForTimeout(300); }
const before = await reviewRows();
if (before) { await page.locator('button[aria-label^="delete chord at"]').first().click(); await page.waitForTimeout(800); }
out.review = { before, afterDelete: await reviewRows() };
const merge = page.getByRole("button", { name: /^⇤ Merge/ });
out.mergeOffered = await merge.count();
if (out.mergeOffered) { await merge.first().click(); await page.waitForTimeout(800); out.review.afterMerge = await reviewRows(); out.mergeLeft = await merge.count(); }
await page.screenshot({ path: path.join(OUT, "reading-e2e-key.png") });
out.overflowX = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
out.errors = logs.filter((l) => !/ERR_FAILED|net::/.test(l));
console.log(JSON.stringify(out, null, 2));
await browser.close(); server.close();
