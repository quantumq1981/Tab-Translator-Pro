/* Redesign step 1 (2026-11-27): UX review #10 #11 #12 #13 checked in the real app.
 *   node bench/polish-e2e.mjs [--shots <dir>]
 * Assembles the site as .github/workflows/pages.yml does, serves it, and drives headless Chromium twice:
 *   phone  (iPhone 13: 390 px, touch → `pointer: coarse`)   and   iPad (820 × 1180, touch)
 * Checks:
 *   #12 the mode row is a tablist with exactly one selected tab; the chart's view switch too; pressed toggles show ✓
 *       without it entering the accessible name
 *   #11 on a touch screen every visible button / select is at least 44 px tall (and 44 wide unless data-tight)
 *   #10 the readout shows "NOTES IN THIS CHORD", the bit strings / scores sit in a closed Details, the engine footer
 *       is folded
 *   #13 no native dialogs: deleting a library song hides it with an Undo toast; Undo brings it back; letting the toast
 *       run out really deletes it (gone after a reload)
 *   no horizontal page scroll at 390 px, no page errors */
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import http from "node:http";
import { execFileSync } from "node:child_process"; import { createRequire } from "node:module";

const here = path.dirname(new URL(import.meta.url).pathname), repo = path.resolve(here, "..", "..");
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium, devices } = require("/opt/node-tools/node_modules/playwright");
const shots = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
if (shots) fs.mkdirSync(shots, { recursive: true });
const yml = fs.readFileSync(path.join(repo, ".github/workflows/pages.yml"), "utf8");
const start = yml.indexOf("- name: Assemble site"), runAt = yml.indexOf("run: |", start);
const body = []; for (const ln of yml.slice(runAt + 6).split("\n").slice(1)) { if (ln.trim() && !/^ {10}/.test(ln)) break; body.push(ln.slice(10)); }
const site = fs.mkdtempSync(path.join(os.tmpdir(), "ttp-polish-"));
execFileSync("bash", ["-euo", "pipefail", "-c", body.join("\n").replace(/_site\b/g, site)], { cwd: repo, env: { ...process.env, GITHUB_SHA: "polish00deadbeef" }, stdio: "pipe" });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"), f = path.join(site, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname));
  fs.readFile(f, (e, d) => { if (e) { res.statusCode = 404; res.end(); return; } res.setHeader("content-type", MIME[path.extname(f)] || "application/octet-stream"); res.end(d); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const steps = []; const ok = (n, c, x) => { steps.push(!!c); console.log(c ? "OK  " : "FAIL", n, x !== undefined ? JSON.stringify(x).slice(0, 240) : ""); };

/* every visible, enabled control smaller than the 44 px touch minimum */
const smallControls = (page) => page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll(".tdp-app button, .tdp-app select")) {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === "hidden" || el.closest("details:not([open])") && el.tagName !== "SUMMARY") continue;
    const tight = el.hasAttribute("data-tight");
    if (r.height < 43.5 || (!tight && el.tagName === "BUTTON" && r.width < 43.5)) out.push(`${(el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 24)} ${Math.round(r.width)}×${Math.round(r.height)}`);
  }
  return out;
});

for (const [label, opts] of [["phone", { ...devices["iPhone 13"] }], ["iPad", { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }]]) {
  const ctx = await browser.newContext(opts);
  await ctx.route((u) => !u.href.startsWith(origin), (r) => r.abort());
  const page = await ctx.newPage();
  const logs = [], dialogs = [];
  page.on("pageerror", (e) => logs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_FAILED|net::/.test(m.text())) logs.push(m.text()); });
  page.on("dialog", (d) => { dialogs.push(d.type() + ": " + d.message()); d.dismiss(); });   // no native dialog of any kind (#13: prompts are inline fields now)
  await page.goto(origin + "/");
  await page.getByRole("tab", { name: "Manual", exact: true }).waitFor({ timeout: 30000 }); await page.waitForTimeout(500);
  const L = (s) => `${label}: ${s}`;

  ok(L("#12 pointer is coarse"), await page.evaluate(() => matchMedia("(pointer: coarse)").matches));
  // step 4: the 9-tab mode row became Open (6 ways in, a tablist) + Listen (2 tools, a tablist) + the bar
  const modeTabs = await page.evaluate(() => { const tl = document.querySelector('[role="tablist"][aria-label="Ways in"]'); return tl ? [...tl.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute("aria-selected")) : []; });
  ok(L("#12 the ways in are a tablist of 6 tabs, none selected before anything is open"), modeTabs.length === 6 && modeTabs.every((x) => x === "false"), modeTabs);
  await page.locator('.tdp-nav button[data-dest="listen"]').tap(); await page.waitForTimeout(300);
  await page.getByRole("tab", { name: "Tuner", exact: true }).tap(); await page.waitForTimeout(300);
  await page.getByRole("tab", { name: "Live chords", exact: true }).tap(); await page.waitForTimeout(300);
  const visited = await page.getByRole("tab", { name: "Tuner", exact: true }).evaluate((t) => getComputedStyle(t).borderTopColor);
  ok(L("#16 a tab you visited keeps the normal border (no white 'visited' look)"), visited === "rgb(51, 51, 61)", visited);
  await page.locator('.tdp-nav button[data-dest="open"]').tap(); await page.waitForTimeout(200);
  await page.getByRole("tab", { name: "Manual", exact: true }).tap(); await page.waitForTimeout(300);
  const wraps = await page.evaluate(() => [...document.querySelectorAll('.tdp-app button[aria-pressed="true"]')].filter((b) => b.getBoundingClientRect().height > 60).map((b) => b.innerText));
  ok(L("#12 selected toggles don't wrap onto extra lines"), !wraps.length, wraps);
  const small0 = await smallControls(page);
  ok(L("#11 Manual: every control ≥ 44 px"), !small0.length, small0);
  if (shots) await page.screenshot({ path: path.join(shots, `${label}-manual.png`), fullPage: false });

  // a score file: view switch, readout, details
  await page.locator('.tdp-nav button[data-dest="open"]').click(); await page.getByRole("tab", { name: "MusicXML / GP", exact: true }).click();
  await page.locator('input[type="file"]').first().setInputFiles(path.join(repo, "Steely Dan - Peg.gp4"));
  await page.getByText(/bars ·/).first().waitFor({ timeout: 60000 }); await page.waitForTimeout(800);
  const views = await page.evaluate(() => { const tl = document.querySelector('[role="tablist"][aria-label="View"]'); return tl ? [...tl.querySelectorAll('[role="tab"]')].map((t) => `${t.textContent}:${t.getAttribute("aria-selected")}`) : []; });
  ok(L("#12 the chart's view switch is a tablist, Chart selected"), views.length === 5 && views[0] === "Chart:true" && views.slice(1).every((v) => v.endsWith(":false")), views);
  const harm = page.getByRole("button", { name: "Harmony (all pitched parts)", exact: true });
  ok(L("#12 exact accessible names survive the ✓ (Harmony chip found by exact name)"), (await harm.count()) >= 1);
  const small1 = await smallControls(page);
  ok(L("#11 open chart: every control ≥ 44 px"), !small1.length, small1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(L("no horizontal page scroll"), overflow <= 1, overflow);
  // tap the first chord of the lead sheet
  await page.locator("button").filter({ hasText: /^[A-G][#b]?(maj7|m7|m|7|6|9)?$/ }).first().click(); await page.waitForTimeout(400);
  const ro = await page.evaluate(() => {
    const sec = document.querySelector("[data-chord-reading]");   // step 3: the reading lives in the chord sheet
    const det = sec && sec.querySelector("[data-readout-details]");
    return sec ? { notes: /Notes in this chord/.test(sec.innerText), shownBits: /0b[01]{12}/.test(sec.innerText.replace(/Details[\s\S]*$/, "")), detClosed: !!det && !det.open, detHasBits: !!det && /0b[01]{12}/.test(det.textContent), score: /score \d/.test(sec.innerText.replace(/Details[\s\S]*$/, "")) } : null;
  });
  ok(L("#10 the chord sheet shows the chord's notes"), ro && ro.notes, ro);
  ok(L("#10 bit strings and scores are hidden until Details opens"), ro && !ro.shownBits && !ro.score && ro.detClosed && ro.detHasBits, ro);
  const footer = await page.evaluate(() => { const f = document.querySelector("footer"); const d = f && f.querySelector("details"); return { folded: !!d && !d.open, visibleText: f ? f.innerText : "" }; });
  ok(L("#10 the engine footer is folded"), footer.folded && !/makeMask/.test(footer.visibleText), footer.visibleText.slice(0, 60));
  if (shots) { await page.screenshot({ path: path.join(shots, `${label}-chart.png`), fullPage: false }); }
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);   // the chord tap also opened the voicing modal

  // library delete → Undo → delete → commit
  await page.locator('.tdp-nav button[data-dest="library"]').click();
  await page.getByText("Peg", { exact: false }).first().waitFor({ timeout: 15000 }); await page.waitForTimeout(400);
  const rows = () => page.locator("b", { hasText: /Peg/ }).count();
  const n0 = await rows();
  await page.getByRole("button", { name: "delete", exact: true }).first().click(); await page.waitForTimeout(300);
  const toast = page.locator("[data-toast]");
  ok(L("#13 delete shows an Undo toast, no native dialog"), (await toast.count()) === 1 && /Deleted/.test(await toast.innerText()) && !dialogs.length, { dialogs });
  ok(L("#13 …and hides the song at once"), (await rows()) === n0 - 1, { n0, now: await rows() });
  if (shots) await page.screenshot({ path: path.join(shots, `${label}-toast.png`), fullPage: false });
  await toast.getByRole("button", { name: "Undo" }).click(); await page.waitForTimeout(400);
  ok(L("#13 Undo brings it back"), (await rows()) === n0 && (await toast.count()) === 0);
  await page.getByRole("button", { name: "delete", exact: true }).first().click();
  await page.waitForTimeout(9000);
  ok(L("#13 the toast ends by itself"), (await toast.count()) === 0);
  const idbCount = () => page.evaluate(() => new Promise((res) => { const rq = indexedDB.open("ttp-projects"); rq.onsuccess = () => { try { const c = rq.result.transaction("projects", "readonly").objectStore("projects").count(); c.onsuccess = () => res(c.result); c.onerror = () => res(-1); } catch (_) { res(-2); } }; rq.onerror = () => res(-3); }));
  await page.waitForTimeout(500);
  ok(L("#13 when it ends, the record is really deleted from IndexedDB"), (await idbCount()) === n0 - 1, await idbCount());
  await page.reload(); await page.locator('.tdp-nav button[data-dest="library"]').waitFor({ timeout: 30000 }); await page.waitForTimeout(800);
  await page.locator('.tdp-nav button[data-dest="library"]').click(); await page.waitForTimeout(1200);
  // U1 (PR #169): a song deleted while open stays deleted after a reload; opening the file again re-adds it
  ok(L("U1 the deleted open song doesn't come back after a reload"), (await rows()) === 0, await rows());
  await page.locator('.tdp-nav button[data-dest="open"]').click(); await page.getByRole("tab", { name: "MusicXML / GP", exact: true }).click();
  await page.locator('input[type="file"]').first().setInputFiles(path.join(repo, "Steely Dan - Peg.gp4"));
  await page.getByText(/bars ·/).first().waitFor({ timeout: 60000 }); await page.waitForTimeout(800);
  await page.locator('.tdp-nav button[data-dest="library"]').click(); await page.waitForTimeout(1200);
  ok(L("U1 …and opening the file again puts it back"), (await rows()) === 1, await rows());
  // two songs of one setlist deleted inside one Undo window: each commit prunes the CURRENT setlist (Codex P1 on #162)
  await page.getByRole("button", { name: "duplicate", exact: true }).first().click(); await page.waitForTimeout(600);
  await page.getByRole("button", { name: "＋ New setlist", exact: true }).click(); await page.getByRole("button", { name: "Create", exact: true }).click(); await page.waitForTimeout(600);   // the inline field's default name is "Gig"
  for (let i = 0; i < 2; i++) { await page.locator("select", { has: page.locator("option", { hasText: "+ setlist…" }) }).nth(i).selectOption({ label: "Gig" }); await page.waitForTimeout(500); }
  const setItems = () => page.evaluate(() => new Promise((res) => { const rq = indexedDB.open("ttp-projects"); rq.onsuccess = () => { const g = rq.result.transaction("setlists", "readonly").objectStore("setlists").getAll(); g.onsuccess = () => res(g.result.map((x) => x.items.length)); }; }));
  ok(L("#13 setup: one setlist holding two songs"), JSON.stringify(await setItems()) === "[2]", await setItems());
  await page.getByRole("button", { name: "delete", exact: true }).first().click(); await page.waitForTimeout(300);
  await page.getByRole("button", { name: "delete", exact: true }).first().click();
  await page.waitForTimeout(10000);
  ok(L("#13 both deletes commit and the setlist keeps neither song"), JSON.stringify(await setItems()) === "[0]" && (await idbCount()) === 0, { sets: await setItems(), projects: await idbCount() });
  const small2 = await smallControls(page);
  ok(L("#11 library: every control ≥ 44 px"), !small2.length, small2);

  ok(L("no native dialogs at all"), !dialogs.length, dialogs);
  ok(L("no page errors"), !logs.length, logs);
  await ctx.close();
}
await browser.close(); server.close();
const pass = steps.filter(Boolean).length;
console.log(`\n${pass}/${steps.length} passed`);
process.exit(pass === steps.length ? 0 : 1);
