/* Redesign step 5 (2026-11-27): one Open, routed by the file's bytes — in the real app.
 *   node bench/open-e2e.mjs [--repo <checkout>] [--shots <dir>]
 * Assembles the site as .github/workflows/pages.yml does and, on iPhone 13 and a touch iPad (820 × 1180), drops /
 * picks each kind of file on the ONE drop zone and checks where it lands:
 *   Guitar Pro (.gp4) and MusicXML → the score chart · a tab PDF → PDF Chart · a PDF that is neither clearly → the
 *   "how should this PDF be read?" question → Scan · a PNG photo → Scan · a WAV → Audio (a chord chart) · ASCII tab
 *   text → Manual (read) · ChordPro → Lyrics (the sheet) · an unreadable file → a message, stays on Open ·
 *   drag-and-drop works like the picker · the picker has no `accept` filter (iOS) · no page errors. */
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import http from "node:http";
import { execFileSync } from "node:child_process"; import { createRequire } from "node:module";

const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(arg("--repo") || path.join(here, "..", ".."));
const shots = arg("--shots"); if (shots) fs.mkdirSync(shots, { recursive: true });
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium, devices } = require("/opt/node-tools/node_modules/playwright");
const yml = fs.readFileSync(path.join(repo, ".github/workflows/pages.yml"), "utf8");
const start = yml.indexOf("- name: Assemble site"), runAt = yml.indexOf("run: |", start);
const body = []; for (const ln of yml.slice(runAt + 6).split("\n").slice(1)) { if (ln.trim() && !/^ {10}/.test(ln)) break; body.push(ln.slice(10)); }
const site = fs.mkdtempSync(path.join(os.tmpdir(), "ttp-open-"));
execFileSync("bash", ["-euo", "pipefail", "-c", body.join("\n").replace(/_site\b/g, site)], { cwd: repo, env: { ...process.env, GITHUB_SHA: "open00deadbeef" }, stdio: "pipe" });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"), f = path.join(site, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname));
  fs.readFile(f, (e, d) => { if (e) { res.statusCode = 404; res.end(); return; } res.setHeader("content-type", MIME[path.extname(f)] || "application/octet-stream"); res.end(d); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const steps = []; const ok = (n, c, x) => { steps.push(!!c); console.log(c ? "OK  " : "FAIL", n, x !== undefined ? JSON.stringify(x).slice(0, 260) : ""); };




const W = fs.mkdtempSync(path.join(os.tmpdir(), "ttp-open-files-"));
const put = (name, data) => { const f = path.join(W, name); fs.writeFileSync(f, data); return f; };
// a 6 s WAV: C major
const sr = 16000, pcm = new Float32Array(sr * 6);
for (let i = 0; i < pcm.length; i++) { const t = i / sr; let v = 0; for (const m of [48, 52, 55, 60]) v += Math.sin(2 * Math.PI * 440 * Math.pow(2, (m - 69) / 12) * t) / 5; pcm[i] = v * 0.8; }
const wav = Buffer.alloc(44 + pcm.length * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(36 + pcm.length * 2, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(pcm.length * 2, 40);
for (let i = 0; i < pcm.length; i++) wav.writeInt16LE(Math.round(pcm[i] * 32767), 44 + 2 * i);
const FILES = {
  gp: path.join(repo, "Steely Dan - Peg.gp4"),
  xml: path.join(repo, "tests/fixtures/sample.musicxml"),
  tabPdf: path.join(repo, "Blue Sky - The Allman Brothers Band.pdf"),
  otherPdf: path.join(repo, "FiguredBassMHGPLReadMe.pdf"),
  png: put("chart-photo", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")),   // no extension on purpose
  wav: put("take.wav", wav),
  tab: put("riff.txt", "e|---0-----0---|\nB|---1-----3---|\nG|---0-----0---|\nD|---2-----0---|\nA|---3-----2---|\nE|---------3---|\n"),
  cho: put("song.cho", "{title: Open Road}\n{artist: The Testers}\n{soc}\n[C]Drive all [G]night\n[Am]Under the [F]lights\n{eoc}\n"),
  bin: put("thing.bin", Buffer.from(Array.from({ length: 200 }, (_, i) => (i * 37) % 256 & (i % 3 ? 0 : 255)))),
};

for (const [label, opts] of [["phone", { ...devices["iPhone 13"] }], ["iPad", { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }]]) {
  const ctx = await browser.newContext(opts);
  await ctx.route((u) => !u.href.startsWith(origin), (r) => r.abort());
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  const L = (s) => `${label}: ${s}`;
  const current = () => page.evaluate(() => { const b = document.querySelector('.tdp-nav [aria-current="page"]'); return b ? b.getAttribute("data-dest") : null; });
  const toOpen = async () => { await page.locator('.tdp-nav button[data-dest="open"]').click(); await page.locator("[data-drop-zone]").waitFor({ timeout: 15000 }); };
  const give = async (f) => { await toOpen(); await page.locator("[data-open-input]").setInputFiles(f); };
  await page.goto(origin + "/");
  await page.locator("[data-drop-zone]").waitFor({ timeout: 30000 }); await page.waitForTimeout(300);
  ok(L("one drop zone + Choose a file on Open; the picker has no accept filter (iOS)"), (await page.locator("[data-open-input]").getAttribute("accept")) === null && await page.getByRole("button", { name: "Choose a file" }).isVisible());
  if (shots) await page.screenshot({ path: path.join(shots, `${label}-open.png`) });

  await give(FILES.gp); await page.getByText(/bars ·/).first().waitFor({ timeout: 60000 });
  ok(L("Guitar Pro → the score chart"), (await current()) === "chart" && /Peg/.test(await page.locator("[data-song-title]").innerText()) && (await page.locator(".tdp-bar").count()) > 50);
  await give(FILES.xml); await page.waitForTimeout(1500);
  ok(L("MusicXML → the score chart"), (await current()) === "chart" && /sample/.test(await page.locator("[data-song-title]").innerText().catch(() => "")));
  await give(FILES.tabPdf); await page.getByText(/systems ·/).first().waitFor({ timeout: 90000 });
  ok(L("a tab PDF → PDF Chart (fret numbers read)"), (await current()) === "chart" && /Blue Sky/.test(await page.locator("[data-song-title]").innerText()));
  await give(FILES.otherPdf); await page.locator("[data-pdf-ask]").waitFor({ timeout: 60000 });
  ok(L("a PDF that is neither clearly → the app asks"), (await current()) === "open" && /How should/.test(await page.locator("[data-pdf-ask]").innerText()));
  if (shots) await page.screenshot({ path: path.join(shots, `${label}-pdf-ask.png`) });
  await page.getByRole("button", { name: "Read the chord symbols" }).click(); await page.waitForTimeout(1200);
  ok(L("…'Read the chord symbols' opens it in Scan"), (await current()) === "chart" && await page.getByText(/SCAN A LEAD SHEET/).isVisible() && await page.getByText(/FiguredBassMHGPLReadMe/).first().isVisible().catch(() => false));
  await give(FILES.png); await page.waitForTimeout(1200);
  ok(L("a photo (PNG, no extension) → Scan, which reads it"), (await current()) === "chart" && await page.getByText(/SCAN A LEAD SHEET/).isVisible() && /0 systems|No staves found/.test(await page.locator(".tdp-main").innerText()));   // a 1×1 image: read, no staves
  await give(FILES.wav); await page.getByText(/bars ·/).first().waitFor({ timeout: 90000 });
  ok(L("a recording (WAV) → Audio, read into a chord chart"), (await current()) === "chart" && await page.locator("[data-waveform]").first().isVisible());
  await give(FILES.tab); await page.waitForTimeout(800);
  const manual = await page.evaluate(() => ({ ta: (document.querySelector("textarea") || {}).value || "", readout: /LIVE READOUT/.test(document.body.innerText) }));
  ok(L("ASCII tab text → Manual, read"), (await current()) === "chart" && manual.readout && /e\|---0/.test(manual.ta), manual.ta.slice(0, 30));
  await give(FILES.cho); await page.waitForTimeout(800);
  ok(L("ChordPro → Lyrics, the sheet without chords"), (await current()) === "chart" && /OPEN ROAD|Open Road/.test(await page.locator(".tdp-main").innerText()) && /Drive all night/.test(await page.locator(".tdp-main").innerText()));
  await give(FILES.bin); await page.waitForTimeout(600);
  const m = await page.locator("[data-open-msg]").innerText();
  ok(L("an unreadable file → a message, stays on Open"), (await current()) === "open" && /doesn't look like a score, a PDF, a photo, a recording or text/.test(m), m);
  // drag-and-drop = the picker
  const xmlText = fs.readFileSync(FILES.xml, "utf8");
  await page.evaluate((t) => { const dt = new DataTransfer(); dt.items.add(new File([t], "dropped.musicxml", { type: "" })); const z = document.querySelector("[data-drop-zone]"); for (const ty of ["dragenter", "dragover", "drop"]) z.dispatchEvent(new DragEvent(ty, { bubbles: true, cancelable: true, dataTransfer: dt })); }, xmlText);
  await page.waitForTimeout(1500);
  ok(L("drag-and-drop routes the same way"), (await current()) === "chart" && /dropped/.test(await page.locator("[data-song-title]").innerText().catch(() => "")));
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(L("no horizontal page scroll"), ov <= 1, ov);
  ok(L("no page errors"), !errs.length, errs.slice(0, 3));
  await ctx.close();
}
await browser.close(); server.close(); fs.rmSync(site, { recursive: true, force: true }); fs.rmSync(W, { recursive: true, force: true });
console.log(`${steps.filter(Boolean).length}/${steps.length} passed`);
process.exit(steps.every(Boolean) ? 0 : 1);
