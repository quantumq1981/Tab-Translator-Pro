/* Redesign step 4 (2026-11-27): the four destinations, in the real app.
 *   node bench/nav-e2e.mjs [--repo <checkout>] [--shots <dir>]
 * Assembles the site as .github/workflows/pages.yml does and, on iPhone 13, an iPad in portrait (820 × 1180, touch) and
 * an iPad in landscape (1180 × 820, touch):
 *   - first launch lands on Open: six ways in, each with what it is for; Open / Chart / Listen / Library always on
 *     screen — a bottom bar under 1024 px, a left rail at 1024 px and up
 *   - Chart before anything is open is an empty state that points to Open
 *   - a way in goes to Chart; the song's name is in the app bar; scrolled to the end, nothing hides under the bar
 *   - Listen holds Live chords + Tuner; Chart comes back to the same chart; Library; Open offers "Back to <song>"
 *   - landscape: a tapped chord opens an inspector BESIDE the chart (not modal; the chart makes room, another chord can
 *     be tapped); phone: still the modal bottom sheet over the bar; toasts sit above the bar
 *   - a reload restores straight to Chart; Start fresh goes back to Open; 44 px targets; no sideways scroll; no errors */
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
const site = fs.mkdtempSync(path.join(os.tmpdir(), "ttp-nav-"));
execFileSync("bash", ["-euo", "pipefail", "-c", body.join("\n").replace(/_site\b/g, site)], { cwd: repo, env: { ...process.env, GITHUB_SHA: "nav000deadbeef" }, stdio: "pipe" });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"), f = path.join(site, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname));
  fs.readFile(f, (e, d) => { if (e) { res.statusCode = 404; res.end(); return; } res.setHeader("content-type", MIME[path.extname(f)] || "application/octet-stream"); res.end(d); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const steps = []; const ok = (n, c, x) => { steps.push(!!c); console.log(c ? "OK  " : "FAIL", n, x !== undefined ? JSON.stringify(x).slice(0, 260) : ""); };



const peg = path.join(repo, "Steely Dan - Peg.gp4");
for (const [label, opts] of [["phone", { ...devices["iPhone 13"] }], ["iPad portrait", { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }], ["iPad landscape", { viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }]]) {
  const wide = opts.viewport.width >= 1024;
  const ctx = await browser.newContext(opts);
  await ctx.route((u) => !u.href.startsWith(origin), (r) => r.abort());
  const page = await ctx.newPage();
  const logs = [];
  page.on("pageerror", (e) => logs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_FAILED|net::/.test(m.text())) logs.push(m.text()); });
  const L = (s) => `${label}: ${s}`;
  const nav = (d) => page.locator(`.tdp-nav button[data-dest="${d}"]`);
  const current = () => page.evaluate(() => { const b = document.querySelector('.tdp-nav [aria-current="page"]'); return b ? b.getAttribute("data-dest") : null; });
  await page.goto(origin + "/");
  await page.getByRole("tab", { name: "MusicXML / GP", exact: true }).waitFor({ timeout: 30000 }); await page.waitForTimeout(400);

  const first = await page.evaluate(() => ({ h: (document.querySelector("#tdp-open-h") || {}).textContent, ways: [...document.querySelectorAll('[role="tablist"][aria-label="Ways in"] [role="tab"]')].map((t) => [t.getAttribute("aria-label"), (document.getElementById(t.getAttribute("aria-describedby")) || {}).textContent || ""]), old: !!document.querySelector('[role="tablist"][aria-label="Mode"]') }));
  ok(L("first launch lands on Open: six ways in, each says what it is for; no 9-tab row"), first.h === "Open" && first.ways.length === 6 && first.ways.every(([n, d]) => n && d.length > 20) && !first.old && (await current()) === "open", first.ways.map((w) => w[0]));
  const geo = await page.evaluate(() => { const r = document.querySelector(".tdp-nav").getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight, btns: [...document.querySelectorAll(".tdp-nav button")].map((b) => { const q = b.getBoundingClientRect(); return [b.innerText.trim(), Math.round(q.width), Math.round(q.height)]; }) }; });
  ok(L(wide ? "a left rail, full height" : "a bottom bar across the screen"), wide ? geo.x === 0 && geo.y === 0 && geo.h === geo.vh && geo.w <= 90 : Math.abs(geo.y + geo.h - geo.vh) <= 1 && geo.w === geo.vw && geo.h <= 90, geo);
  ok(L("Open · Chart · Listen · Library, each ≥ 44 px"), geo.btns.map((b) => b[0]).join(",") === "Open,Chart,Listen,Library" && geo.btns.every((b) => b[1] >= 44 && b[2] >= 44), geo.btns);
  if (shots) await page.screenshot({ path: path.join(shots, `${label}-open.png`) });

  await nav("chart").click(); await page.waitForTimeout(200);
  ok(L("Chart before anything is open: an empty state pointing to Open"), (await page.locator("[data-chart-empty]").isVisible()) && (await current()) === "chart");
  await page.getByRole("button", { name: "Open a file" }).click(); await page.waitForTimeout(200);
  ok(L("…and its button goes to Open"), (await current()) === "open");

  await page.getByRole("tab", { name: "MusicXML / GP", exact: true }).click(); await page.waitForTimeout(200);
  ok(L("a way in goes to Chart"), (await current()) === "chart" && !(await page.locator("#tdp-open-h").count()));
  await page.locator('input[type="file"]').first().setInputFiles(peg);
  await page.getByText(/bars ·/).first().waitFor({ timeout: 60000 }); await page.waitForTimeout(700);
  const title = await page.locator("[data-song-title]").innerText().catch(() => "");
  ok(L("the song's name is in the app bar"), /Peg/.test(title), title);
  const end = await page.evaluate(async () => {
    window.scrollTo(0, document.documentElement.scrollHeight); await new Promise((r) => setTimeout(r, 300));
    const bars = [...document.querySelectorAll(".tdp-bar")], last = bars[bars.length - 1].getBoundingClientRect(), n = document.querySelector(".tdp-nav").getBoundingClientRect(), foot = document.querySelector("footer").getBoundingClientRect();
    return { lastBottom: Math.round(last.bottom), footBottom: Math.round(foot.bottom), navTop: Math.round(n.top), navRight: Math.round(n.right), lastLeft: Math.round(last.left), sw: document.documentElement.scrollWidth - innerWidth };
  });
  ok(L("scrolled to the end, nothing is hidden under the bar / rail"), (wide ? end.lastLeft >= end.navRight : end.footBottom <= end.navTop + 1) && end.sw <= 1, end);
  if (shots) await page.screenshot({ path: path.join(shots, `${label}-chart-end.png`) });

  await nav("listen").click(); await page.waitForTimeout(300);
  const listen = await page.evaluate(() => [...document.querySelectorAll('[role="tablist"][aria-label="Listen"] [role="tab"]')].map((t) => `${t.textContent}:${t.getAttribute("aria-selected")}`));
  ok(L("Listen = Live chords + Tuner"), (await current()) === "listen" && listen.length === 2 && /Live chords/.test(listen[0]) && /Tuner/.test(listen[1]), listen);
  await page.getByRole("tab", { name: "Tuner", exact: true }).click(); await page.waitForTimeout(300);
  ok(L("Tuner opens inside Listen"), (await page.getByText(/Tuning/).first().isVisible()) && (await current()) === "listen");
  await nav("chart").click(); await page.waitForTimeout(400);
  ok(L("Chart comes back to the same chart"), (await page.locator(".tdp-bar").count()) > 50 && /Peg/.test(await page.locator("[data-song-title]").innerText()));
  await nav("listen").click(); await page.waitForTimeout(200);
  ok(L("Listen remembers the last tool (Tuner)"), await page.getByRole("tab", { name: "Tuner", exact: true }).evaluate((t) => t.getAttribute("aria-selected") === "true"));
  await nav("library").click(); await page.waitForTimeout(400);
  ok(L("Library"), (await current()) === "library");
  await nav("open").click(); await page.waitForTimeout(200);
  const cont = page.locator("[data-continue]");
  ok(L("Open offers Back to the song"), /Peg/.test(await cont.innerText()) && (await page.getByRole("tab", { name: "MusicXML / GP", exact: true }).getAttribute("aria-selected")) === "true");
  await cont.click(); await page.waitForTimeout(300);
  ok(L("…which returns to Chart"), (await current()) === "chart" && (await page.locator(".tdp-bar").count()) > 50);

  // the chord sheet: an inspector beside the chart when wide, the modal sheet otherwise
  await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(200);
  const chords = page.locator(".tdp-bar button");
  await chords.nth(0).click(); await page.waitForTimeout(700);
  const sh = await page.evaluate(() => { const s = document.querySelector("[data-chord-sheet]"), r = s.getBoundingClientRect(), m = document.querySelector(".tdp-cols").getBoundingClientRect(), dlg = s.closest('[role="dialog"]'); return { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), vw: innerWidth, modal: dlg.getAttribute("aria-modal"), chartRight: Math.round(m.right), lock: document.body.style.overflow, cls: document.documentElement.classList.contains("tdp-inspecting"), z: getComputedStyle(dlg).zIndex }; });
  if (wide) ok(L("wide: the chord opens an inspector beside the chart (not modal, no scroll lock, the chart makes room)"), sh.right === sh.vw && sh.w === 360 && sh.modal === "false" && sh.chartRight <= sh.left && sh.lock !== "hidden" && sh.cls, sh);
  else ok(L("the chord opens the modal bottom sheet over the bar"), sh.modal === "true" && +sh.z > 50 && !sh.cls, sh);
  if (shots) await page.screenshot({ path: path.join(shots, `${label}-chord.png`) });
  if (wide) {
    const name2 = (await chords.nth(1).innerText()).split("\n")[0].trim();
    await chords.nth(1).click(); await page.waitForTimeout(600);
    const t2 = (await page.locator("[data-chord-sheet] [data-sheet-title] span").first().innerText()).trim();
    ok(L("wide: another chord can be tapped while the inspector is open"), t2 === name2 || t2.replace(/\*$/, "") === name2.replace(/\*$/, ""), { t2, name2 });
  }
  // a toast (rename + Undo) sits above the bar
  await page.locator("[data-chord-sheet]").getByRole("button", { name: "✎ Change chord" }).click();
  await page.locator("[data-chord-sheet]").getByRole("textbox", { name: "new chord name" }).fill("F#13"); await page.keyboard.press("Enter"); await page.waitForTimeout(400);
  const tg = await page.evaluate(() => { const t = document.querySelector("[data-toast]"), n = document.querySelector(".tdp-nav"); if (!t) return null; const a = t.getBoundingClientRect(), b = n.getBoundingClientRect(); return { tBottom: Math.round(a.bottom), navTop: Math.round(b.top), tLeft: Math.round(a.left), navRight: Math.round(b.right) }; });
  ok(L("the Undo toast is not under the bar / rail"), tg && (wide ? tg.tLeft >= tg.navRight : tg.tBottom <= tg.navTop), tg);
  await page.getByRole("status").getByRole("button", { name: "Undo" }).first().click(); await page.waitForTimeout(300);
  ok(L("inspector closed: the page gives its room back"), !(await page.evaluate(() => document.documentElement.classList.contains("tdp-inspecting"))));

  // a reload restores straight to Chart; Start fresh returns to Open
  await page.waitForTimeout(800);
  await page.reload(); await page.getByText(/Restored your last session/).waitFor({ timeout: 60000 }); await page.waitForTimeout(500);
  ok(L("a reload restores straight to Chart"), (await current()) === "chart" && (await page.locator(".tdp-bar").count()) > 50);
  await page.getByRole("button", { name: "Start fresh" }).first().click(); await page.waitForTimeout(400);
  ok(L("Start fresh goes back to Open"), (await current()) === "open" && (await page.locator("#tdp-open-h").count()) === 1);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(L("no horizontal page scroll"), ov <= 1, ov);
  ok(L("no page errors"), !logs.length, logs.slice(0, 4));
  await ctx.close();
}
await browser.close(); server.close(); fs.rmSync(site, { recursive: true, force: true });
console.log(`${steps.filter(Boolean).length}/${steps.length} passed`);
process.exit(steps.every(Boolean) ? 0 : 1);
