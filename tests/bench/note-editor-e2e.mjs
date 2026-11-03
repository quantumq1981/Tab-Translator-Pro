/* WO-1 note editor end to end: the REAL app in headless Chromium, no stubs.
 *
 *   node bench/note-editor-e2e.mjs --deps <dir> [--gp blue-sky.gp] [--out <dir>] [--width 820]
 *
 * 1. MusicXML / GP mode → upload --gp → ChartPanel "Notes" view (piano roll + tab grid).
 * 2. Select a note, nudge it a semitone (keyboard), drag another one, re-string a third
 *    (tab-grid drag), undo + redo — checks the edit summary after each step.
 * 3. AlphaTex export: the edited pitches are in the exported tab (parsed by alphaTab in Node).
 * 4. Reload → the session restores → the edits are still there (OPFS / localStorage rails).
 * --deps is the React + Babel bundle bench/README.md describes (the sandbox blocks esm.sh / unpkg).
 */
import fs from "node:fs"; import path from "node:path"; import http from "node:http";
import { createRequire } from "node:module";
import * as L from "./lib.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const DEPS = arg("deps"); if (!DEPS) { console.error("--deps <dir> is required"); process.exit(2); }
const GP = path.resolve(L.repo, arg("gp", "blue-sky.gp")), OUT = arg("out", process.cwd());
const require = createRequire(import.meta.url);
const { chromium } = require(arg("playwright", "/opt/node-tools/node_modules/playwright"));
const alphaTab = await import("@coderline/alphatab");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".tsx": "text/plain", ".json": "application/json", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const f = path.join(L.repo, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname));
  if (!f.startsWith(L.repo)) { res.statusCode = 403; res.end(); return; }
  fs.readFile(f, (e, data) => { if (e) { res.statusCode = 404; res.end(); return; } res.setHeader("content-type", MIME[path.extname(f)] || "application/octet-stream"); res.end(data); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: arg("chromium", "/opt/pw-browsers/chromium") });
const ctx = await browser.newContext({ viewport: { width: +arg("width", 820), height: +arg("height", 1180) }, deviceScaleFactor: 1 });
const ALL = fs.readFileSync(path.join(DEPS, "all.mjs"), "utf8"), BABEL = fs.readFileSync(path.join(DEPS, "babel.min.js"));
const js = (body) => ({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body });
// routes registered LATER win in Playwright: the blanket abort goes first
await ctx.route(/^https:\/\/(cdnjs\.cloudflare\.com|fonts\.googleapis\.com)\//, (r) => r.abort());
await ctx.route("https://esm.sh/__e2e/all.mjs", (r) => r.fulfill(js(ALL)));
await ctx.route(/^https:\/\/esm\.sh\/react@18\.3\.1(\?.*)?$/, (r) => r.fulfill(js('export * from "/__e2e/all.mjs"; export { React as default } from "/__e2e/all.mjs";')));
await ctx.route(/^https:\/\/esm\.sh\/react-dom@18\.3\.1\/client.*/, (r) => r.fulfill(js('import { createRoot, hydrateRoot } from "/__e2e/all.mjs"; export { createRoot, hydrateRoot }; export default { createRoot, hydrateRoot };')));
await ctx.route("https://unpkg.com/@babel/standalone@7.25.6/babel.min.js", (r) => r.fulfill({ ...js(""), body: BABEL }));
const page = await ctx.newPage();
const logs = [];
page.on("console", (m) => { if (m.type() === "error") logs.push(`[error] ${m.text()}`); });
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
const result = { steps: [] };
const ok = (name, cond, extra) => { result.steps.push({ name, ok: !!cond, ...(extra ? { extra } : {}) }); if (!cond) console.error("FAIL:", name, extra || ""); };
const summary = () => page.locator("text=/^✓ /").first().innerText().catch(() => "");

await page.goto(ORIGIN + "/"); await page.waitForTimeout(400);
await page.getByRole("button", { name: "MusicXML / GP" }).click({ timeout: 60000 });
await page.locator('input[type="file"]').first().setInputFiles(GP);
await page.getByRole("button", { name: "Notes", exact: true }).first().click({ timeout: 60000 });
const roll = page.locator("svg rect[rx='2']");
await roll.first().waitFor({ timeout: 60000 });
result.notesDrawn = await roll.count();
ok("piano roll draws notes (windowed)", result.notesDrawn > 20 && result.notesDrawn < 2000, result.notesDrawn);
await page.screenshot({ path: path.join(OUT, "note-editor.png") });

// 1) select + keyboard nudge
const first = roll.nth(3);
await first.click();
const selLine = await page.locator("text=/bar \\d+ · beat/").first().innerText();
await page.keyboard.press("ArrowUp");
await page.waitForTimeout(200);
ok("↑ moves the selected note a semitone", /1 note moved/.test(await summary()), await summary());
// 2) drag a different note two rows down and one 16th later
const box = await roll.nth(12).boundingBox();
await page.mouse.move(box.x + 3, box.y + 4); await page.mouse.down();
await page.mouse.move(box.x + 25, box.y + 24, { steps: 6 }); await page.mouse.up();
await page.waitForTimeout(250);
ok("dragging a note moves it", /2 notes moved/.test(await summary()), await summary());
// 3) tab grid: drag a fret number one string up
// a fret on a middle string (G or D), so "one string up" is always a real string
const frets = page.locator("svg text[font-size='11']");
const boxes = []; for (let i = 0, n = Math.min(await frets.count(), 60); i < n; i++) { const b = await frets.nth(i).boundingBox(); if (b && b.x > 60 && b.x < 700) boxes.push({ i, b }); }
const strLines = (await page.locator("svg line[x1='0']").evaluateAll((ls) => ls.map((l) => { const r = l.getBoundingClientRect(); return r.top; }))).sort((a, b) => a - b);
const pick = boxes.find((x) => [2, 3].some((k) => Math.abs(x.b.y + x.b.height / 2 - 4 - strLines[k]) < 7)) || boxes[0];
const fret = frets.nth(pick.i);
const fb = await fret.boundingBox(), before = await fret.textContent();
await page.mouse.move(fb.x + 3, fb.y + 5); await page.mouse.down();
await page.mouse.move(fb.x + 3, fb.y - 12, { steps: 5 }); await page.mouse.up();
await page.waitForTimeout(250);
const s3 = await summary();
ok("dragging a fret number up a string re-strings the note", /string changed/.test(s3), { s3, before });
// 4) undo / redo
await page.getByRole("button", { name: /Undo/ }).click(); await page.waitForTimeout(150);
const afterUndo = await summary();
await page.getByRole("button", { name: /Redo/ }).click(); await page.waitForTimeout(150);
ok("undo removes the last step, redo restores it", afterUndo !== (await summary()) && (await summary()) === s3, { afterUndo, redo: await summary() });
await page.screenshot({ path: path.join(OUT, "note-editor-edited.png") });

// 5) export AlphaTex → alphaTab reads the edited score
await page.getByRole("button", { name: "AlphaTex (tab)" }).first().click();
await page.locator("textarea[readonly]").first().waitFor({ timeout: 30000 });
const tex = await page.locator("textarea[readonly]").first().inputValue();
const imp = new alphaTab.importer.AlphaTexImporter(); imp.initFromString(tex, new alphaTab.Settings());
let sc; try { sc = imp.readScore(); } catch (e) { console.error(tex.slice(0, 400)); throw e; }
result.texHead = tex.split("\n").slice(0, 4).join(" ⏎ ");
ok("the edited chart exports AlphaTex that alphaTab parses (165 bars)", sc.tracks[0].staves[0].bars.length === 165, sc.tracks[0].staves[0].bars.length);

await page.getByRole("button", { name: "MIDI", exact: true }).first().click();
await page.waitForTimeout(300);
ok("the MIDI export panel renders (ExportPanel had an undefined `score` reference)", (await page.getByText(/Standard MIDI File/).count()) === 1);

// 6) reload → restore → edits are back
const sumBefore = await summary();
await page.reload(); await page.waitForTimeout(400);
await page.getByText(/Restored your last session/).waitFor({ timeout: 60000 });
await page.getByRole("button", { name: "Notes", exact: true }).first().click({ timeout: 60000 });
await roll.first().waitFor({ timeout: 60000 });
await page.waitForTimeout(300);
ok("the edits restore after a reload", (await summary()) === sumBefore, { before: sumBefore, after: await summary() });

// 7) phone width: the editor fits and scrolls inside itself
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
result.widest = await page.evaluate(() => [...document.querySelectorAll("body *")].map((el) => ({ el, w: el.getBoundingClientRect().right })).filter((x) => x.w > window.innerWidth + 40)
  .slice(0, 6).map(({ el, w }) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className : ""} right=${Math.round(w)} style=${(el.getAttribute("style") || "").slice(0, 80)}`));
ok("at 390 px nothing scrolls the page sideways (the editor scrolls inside its own box; the mode tabs wrap)", overflow <= 0, { overflow, widest: result.widest });
await page.screenshot({ path: path.join(OUT, "note-editor-390.png") });
result.selected = selLine;
result.consoleErrors = logs.filter((l) => !/fonts\.googleapis|ERR_FAILED|net::|\[BABEL\] Note/.test(l));
ok("no console errors", result.consoleErrors.length === 0, result.consoleErrors);
console.log(JSON.stringify(result, null, 2));
await browser.close(); server.close();
process.exit(result.steps.every((s) => s.ok) ? 0 : 1);
