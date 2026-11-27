/* Redesign step 2 (2026-11-27): UX review #5 (chart toolbar) and #9 (export row → Share menu), in the real app.
 *   node bench/toolbar-e2e.mjs [--repo <checkout>] [--shots <dir>] [--measure-only]
 * Assembles the site as .github/workflows/pages.yml does, serves it, opens a Guitar Pro file on iPhone 13 and on a
 * touch iPad (820 × 1180) and checks:
 *   - the toolbar holds only the everyday controls (view tabs, Edit, transpose, play + tempo, ⚙ Settings, ⇪ Share)
 *   - the first bar of the chart starts much higher on the page (measured; `--repo <main checkout> --measure-only`
 *     gives the before number)
 *   - ⚙ Settings opens a panel with the chord-name / arrangement / practice controls, Escape closes it, and a changed
 *     setting is counted on the button
 *   - ⇪ Share opens a menu grouped by use; choosing MusicXML closes it and shows the export; Advanced is collapsed;
 *     Chord Sheet Maker Pro, Print / PDF and Image are in it
 *   - the toolbar stays pinned while the page scrolls; ≥ 44 px controls; no horizontal scroll; no page errors */
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import http from "node:http";
import { execFileSync } from "node:child_process"; import { createRequire } from "node:module";

const arg = (k) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : null);
const here = path.dirname(new URL(import.meta.url).pathname);
const repo = path.resolve(arg("--repo") || path.join(here, "..", ".."));
const shots = arg("--shots"); if (shots) fs.mkdirSync(shots, { recursive: true });
const measureOnly = process.argv.includes("--measure-only");
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium, devices } = require("/opt/node-tools/node_modules/playwright");
const yml = fs.readFileSync(path.join(repo, ".github/workflows/pages.yml"), "utf8");
const start = yml.indexOf("- name: Assemble site"), runAt = yml.indexOf("run: |", start);
const body = []; for (const ln of yml.slice(runAt + 6).split("\n").slice(1)) { if (ln.trim() && !/^ {10}/.test(ln)) break; body.push(ln.slice(10)); }
const site = fs.mkdtempSync(path.join(os.tmpdir(), "ttp-toolbar-"));
execFileSync("bash", ["-euo", "pipefail", "-c", body.join("\n").replace(/_site\b/g, site)], { cwd: repo, env: { ...process.env, GITHUB_SHA: "toolbar0deadbeef" }, stdio: "pipe" });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"), f = path.join(site, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname));
  fs.readFile(f, (e, d) => { if (e) { res.statusCode = 404; res.end(); return; } res.setHeader("content-type", MIME[path.extname(f)] || "application/octet-stream"); res.end(d); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const steps = []; const ok = (n, c, x) => { steps.push(!!c); console.log(c ? "OK  " : "FAIL", n, x !== undefined ? JSON.stringify(x).slice(0, 260) : ""); };

/* page y of the first bar of the lead sheet (bar "1"), and of the chart panel's first control */
const firstBarY = (page) => page.evaluate(() => {
  const n = [...document.querySelectorAll("span")].find((s) => s.textContent.trim() === "1" && s.parentElement && /[A-G]/.test(s.parentElement.innerText.replace(/^1/, "")));
  return n ? Math.round(n.getBoundingClientRect().top + window.scrollY) : null;
});
const small = (page, sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.height && (r.height < 43.5 || (el.tagName === "BUTTON" && r.width < 43.5)); }).map((el) => `${(el.getAttribute("aria-label") || el.innerText || "").trim().slice(0, 20)} ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`), sel);

for (const [label, opts] of [["phone", { ...devices["iPhone 13"] }], ["iPad", { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }]]) {
  const ctx = await browser.newContext(opts);
  await ctx.route((u) => !u.href.startsWith(origin), (r) => r.abort());
  const page = await ctx.newPage();
  const logs = [];
  page.on("pageerror", (e) => logs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_FAILED|net::/.test(m.text())) logs.push(m.text()); });
  await page.goto(origin + "/");
  const modeTab = (name) => page.getByRole("tab", { name, exact: true }).or(page.getByRole("button", { name, exact: true })).first();
  await modeTab("Manual").waitFor({ timeout: 30000 }); await page.waitForTimeout(500);
  const L = (s) => `${label}: ${s}`;
  await modeTab("MusicXML / GP").click();
  await page.locator('input[type="file"]').first().setInputFiles(path.join(repo, "Steely Dan - Peg.gp4"));
  await page.getByText(/bars ·/).first().waitFor({ timeout: 60000 }); await page.waitForTimeout(800);
  const y = await firstBarY(page);
  console.log(`     ${label}: first bar at page y = ${y}`);
  if (measureOnly) { await ctx.close(); continue; }
  ok(L("#5 the first bar starts within 1.5 screens of the top"), y && y < opts.viewport.height * 1.5, { y, screen: opts.viewport.height });

  const tb = page.locator('[role="toolbar"][aria-label="Chart"]');
  const tbItems = await tb.evaluate((el) => [...el.querySelectorAll("button, select, label")].filter((b) => b.getBoundingClientRect().width).map((b) => (b.getAttribute("aria-label") || b.innerText).trim()));
  ok(L("#5 toolbar = view tabs, Edit, transpose, play + tempo, Settings, Share"), tbItems.length <= 15 && tbItems.includes("⇪ Share") && tbItems.some((t) => /^⚙ Settings/.test(t)) && tbItems.includes("▶ Play") && !tbItems.some((t) => /Simplify|MusicXML$|ChordPro|Practice|Level/.test(t)), tbItems);
  const tbSmall = await small(page, '[role="toolbar"][aria-label="Chart"] button');
  ok(L("#11 toolbar controls ≥ 44 px"), !tbSmall.length, tbSmall);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(L("no horizontal page scroll"), overflow <= 1, overflow);
  if (shots) await page.screenshot({ path: path.join(shots, `${label}-toolbar.png`) });

  // ⚙ Settings
  const settingsBtn = tb.getByRole("button", { name: /^⚙ Settings/ });
  await settingsBtn.click(); await page.waitForTimeout(300);
  const region = page.getByRole("region", { name: "Chart settings" });
  const regionText = await region.innerText();
  ok(L("#5 Settings opens: chord names, arrangement, practice"), /CHORD NAMES/.test(regionText) && /ARRANGEMENT/.test(regionText) && /PRACTICE/.test(regionText) && /Simplify|1 chord\/bar/.test(regionText) && /Practice/.test(regionText) && (await region.locator("select").count()) >= 3, regionText.replace(/\s+/g, " ").slice(0, 200));
  ok(L("#5 the Settings button says it is open"), (await settingsBtn.getAttribute("aria-expanded")) === "true");
  const regSmall = await small(page, '[aria-label="Chart settings"] button, [aria-label="Chart settings"] select');
  ok(L("#11 settings controls ≥ 44 px"), !regSmall.length, regSmall);
  if (shots) await page.screenshot({ path: path.join(shots, `${label}-settings.png`) });
  const before = (await settingsBtn.innerText()).trim();
  await region.getByRole("button", { name: /Simplify|1 chord\/bar/ }).click(); await page.waitForTimeout(300);
  const after = (await settingsBtn.innerText()).trim();
  ok(L("#5 a changed setting is counted on the ⚙ button"), before !== after && /· \d/.test(after + before), { before, after });
  await region.getByRole("button", { name: /Simplify|1 chord\/bar/ }).click(); await page.waitForTimeout(200);
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  ok(L("#5 Escape closes the panel"), (await region.count()) === 0);

  // ⇪ Share
  await tb.getByRole("button", { name: "⇪ Share" }).click(); await page.waitForTimeout(300);
  const share = page.getByRole("region", { name: "Share" });
  const shareText = await share.innerText();
  ok(L("#9 Share is grouped by use, Chord Sheet Maker Pro first"), shareText.indexOf("Chord Sheet Maker Pro") < shareText.indexOf("FOR NOTATION APPS") && /AS TEXT/.test(shareText) && /Print \/ PDF/.test(shareText) && /Image/.test(shareText), shareText.replace(/\s+/g, " ").slice(0, 220));
  ok(L("#9 every format row explains what it is for"), /MuseScore/.test(shareText) && /DAW/.test(shareText) && /songbook/.test(shareText));
  ok(L("#9 Advanced (CSMPN, ChordSlashML, AI prompt) is collapsed"), !(await share.getByRole("button", { name: "CSMPN", exact: true }).isVisible()));
  ok(L("#9 the old names still reach the buttons (exact accessible names)"), (await share.getByRole("button", { name: "AlphaTex (tab)", exact: true }).count()) === 1 && (await share.getByRole("button", { name: /^Open in Chord Sheet Maker Pro/ }).count()) === 1);
  const shSmall = await small(page, '[aria-label="Share"] button, [aria-label="Share"] select');
  ok(L("#11 share controls ≥ 44 px"), !shSmall.length, shSmall);
  if (shots) await page.screenshot({ path: path.join(shots, `${label}-share.png`) });
  await share.getByRole("button", { name: "MusicXML", exact: true }).click(); await page.waitForTimeout(800);
  ok(L("#9 choosing MusicXML closes the menu and shows the export"), (await share.count()) === 0 && (await page.getByText(/EXPORT · MUSICXML/).isVisible()), await page.getByText(/EXPORT ·/).first().innerText().catch(() => ""));

  // sticky
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200);
  const y0 = await tb.evaluate((el) => el.getBoundingClientRect().top);
  await page.evaluate((y) => window.scrollTo(0, window.scrollY + y + 400), y0); await page.waitForTimeout(300);   // scroll past the toolbar's own position
  const y1 = await tb.evaluate((el) => el.getBoundingClientRect().top);
  if (opts.viewport.width >= 600) ok(L("#5 the toolbar stays pinned while the page scrolls"), y0 > 0 && Math.abs(y1) <= 1, { y0: Math.round(y0), y1: Math.round(y1) });
  else ok(L("#5 on a phone the (4-row) toolbar scrolls with the page instead of covering it"), y1 < -100, { y0: Math.round(y0), y1: Math.round(y1) });
  if (shots) await page.screenshot({ path: path.join(shots, `${label}-scrolled.png`) });
  if (opts.viewport.width >= 600) {   // opening a panel from the pinned toolbar, far down the chart (Codex on #163)
    for (const [btn, reg] of [[/^⚙ Settings/, "Chart settings"], ["⇪ Share", "Share"]]) {
      await tb.getByRole("button", { name: btn }).click(); await page.waitForTimeout(300);
      const box = await page.getByRole("region", { name: reg }).boundingBox();
      ok(L(`#5 ${reg} opened from the pinned toolbar shows on screen`), box && box.y >= 0 && box.y < opts.viewport.height / 2 && box.y + box.height <= opts.viewport.height + 1, box && { y: Math.round(box.y), h: Math.round(box.height) });
      await page.keyboard.press("Escape"); await page.waitForTimeout(200);
    }
  }

  ok(L("no page errors"), !logs.length, logs);
  await ctx.close();
}
await browser.close(); server.close();
if (!measureOnly) { const pass = steps.filter(Boolean).length; console.log(`\n${pass}/${steps.length} passed`); process.exit(pass === steps.length ? 0 : 1); }
