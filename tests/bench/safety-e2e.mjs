/* UX-safety fixes (docs/UX-REVIEW-2026-11-26.md #1 #2 #3 #4 #14), checked in the real app:
 *   node bench/safety-e2e.mjs
 * Assembles the site exactly as .github/workflows/pages.yml does (the deployed, prebuilt path), serves it and drives
 * headless Chromium:
 *   #4  a multi-part Guitar Pro file opens on Harmony, and bar 1 has a chord
 *   #3  outside Manual the readout is empty until a chord of THIS chart is tapped
 *   #1  a chord edit survives re-tapping the current tab, Tuner and back, PDF Chart and back
 *   #14 Start fresh → Undo puts chart + edit back (and the session survives a reload); Start fresh then a reload
 *       before the Undo window ends does not restore the old session; letting the window run out clears it
 *   #2  with an edit on an audio chart, Chords → Notes asks first (Keep my edits keeps it); a chord-names change
 *       waits with the "previous reading" note; Read again re-reads */
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import http from "node:http";
import { execFileSync } from "node:child_process"; import { createRequire } from "node:module";

const here = path.dirname(new URL(import.meta.url).pathname), repo = path.resolve(here, "..", "..");
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("/opt/node-tools/node_modules/playwright");
const yml = fs.readFileSync(path.join(repo, ".github/workflows/pages.yml"), "utf8");
const start = yml.indexOf("- name: Assemble site"), runAt = yml.indexOf("run: |", start);
const body = []; for (const ln of yml.slice(runAt + 6).split("\n").slice(1)) { if (ln.trim() && !/^ {10}/.test(ln)) break; body.push(ln.slice(10)); }
const site = fs.mkdtempSync(path.join(os.tmpdir(), "ttp-safety-"));
execFileSync("bash", ["-euo", "pipefail", "-c", body.join("\n").replace(/_site\b/g, site)], { cwd: repo, env: { ...process.env, GITHUB_SHA: "safe000deadbeef" }, stdio: "pipe" });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"), f = path.join(site, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname));
  fs.readFile(f, (e, d) => { if (e) { res.statusCode = 404; res.end(); return; } res.setHeader("content-type", MIME[path.extname(f)] || "application/octet-stream"); res.end(d); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 } });
await ctx.route((u) => !u.href.startsWith(origin), (r) => r.abort());
const page = await ctx.newPage();
const logs = []; page.on("pageerror", (e) => logs.push(e.message)); page.on("console", (m) => { if (m.type() === "error" && !/ERR_FAILED|net::/.test(m.text())) logs.push(m.text()); });
const steps = []; const ok = (n, c, x) => { steps.push(!!c); console.log(c ? "OK  " : "FAIL", n, x !== undefined ? JSON.stringify(x).slice(0, 200) : ""); };
const tab = async (name) => { const t = page.getByRole("tab", { name, exact: true }).first(); if (!(await t.isVisible().catch(() => false))) await page.locator(`.tdp-nav button[data-dest="${/Tuner|Live chords/.test(name) ? "listen" : "open"}"]`).click(); await t.click(); };   // step 4: through the bar
const count = (t) => page.locator("button", { hasText: t }).count();
const boot = async () => { await page.locator(".tdp-nav button").first().waitFor({ timeout: 30000 }); await page.waitForTimeout(500); };
const amber = "rgb(255, 107, 53)";

await page.goto(origin + "/"); await boot();

// ---- #4 multi-part → Harmony
await tab("MusicXML / GP");
await page.locator('input[type="file"]').first().setInputFiles(path.join(repo, "Steely Dan - Peg.gp4"));
await page.getByText(/bars ·/).first().waitFor({ timeout: 60000 });
await page.waitForTimeout(800);
const harmColor = await page.getByRole("button", { name: "Harmony (all pitched parts)" }).evaluate((b) => getComputedStyle(b).color);
ok("#4 Peg opens on Harmony (all pitched parts)", harmColor === amber, harmColor);
const bar1 = await page.evaluate(() => { const n = [...document.querySelectorAll("span")].find((s) => s.textContent.trim() === "1"); return n ? n.parentElement.innerText : ""; });
ok("#4 bar 1 is not empty", /[A-G]/.test(bar1.replace(/^1/, "")), bar1.slice(0, 60));

// ---- #3 empty readout until a chord is tapped
ok("#3 a chart has no readout column (step 3: a tapped chord opens the chord sheet)", !(await page.getByText("LIVE READOUT", { exact: true }).isVisible().catch(() => false)) && !(await page.locator("[data-chord-sheet]").count()));
ok("#3 the Manual preset chord (C/E) is not shown", !(await page.getByText("SLASH CHORD · BASS ≠ ROOT").isVisible().catch(() => false)));

// ---- #1 an edit survives tab changes
await page.getByRole("button", { name: /Edit/ }).first().click(); await page.waitForTimeout(300);
const chip = page.locator("button").filter({ hasText: /^[A-G][#b]?(m|maj7|m7|7)?\d?$/ }).first();
const before = (await chip.textContent()).trim(); await chip.click(); await page.waitForTimeout(200);
await page.locator("input:focus").fill("F#13"); await page.locator("input:focus").press("Enter"); await page.waitForTimeout(400);
ok("#1 edit made", (await count("F#13")) > 0, before);
await tab("MusicXML / GP"); await page.waitForTimeout(300);
ok("#1 edit survives re-tapping the current tab", (await count("F#13")) > 0);
await tab("Tuner 🎤"); await page.waitForTimeout(300); await tab("MusicXML / GP"); await page.waitForTimeout(300);
ok("#1 edit survives Tuner → back", (await count("F#13")) > 0);
await tab("PDF Chart"); await page.waitForTimeout(300);
ok("#1 the PDF tab does not show the GP chart's edit", (await count("F#13")) === 0);
await tab("MusicXML / GP"); await page.waitForTimeout(300);
ok("#1 edit survives PDF Chart → back", (await count("F#13")) > 0);
// the panel remounted on the tab switch, so it is out of edit mode: a tap picks the chord (and opens its voicings)
await page.locator("button").filter({ hasText: /^[A-G][#b]?(m|maj7|m7|7)?\d?$/ }).first().click(); await page.waitForTimeout(600);
ok("#3 tapping a chord shows THIS chart's chord in the sheet", /Notes in this chord/.test(await page.locator("[data-chord-reading]").innerText().catch(() => "")));
await page.keyboard.press("Escape"); await page.waitForTimeout(200);

// ---- #14 Start fresh with Undo
await page.waitForTimeout(800); // the session meta write
await page.reload(); await boot();
await page.getByText(/Restored your last session/).waitFor({ timeout: 30000 });
ok("#14 setup: the session restores with the edit", (await count("F#13")) > 0);
await page.getByRole("button", { name: "Start fresh" }).click(); await page.waitForTimeout(300);
ok("#14 Start fresh shows Undo", await page.getByRole("button", { name: "Undo", exact: true }).isVisible());
ok("#14 the screen is reset", (await count("F#13")) === 0);
await page.getByRole("button", { name: "Undo", exact: true }).click(); await page.waitForTimeout(600);
ok("#14 Undo puts the chart and the edit back", (await count("F#13")) > 0);
ok("#14 the pending-clear flag is gone after Undo", (await page.evaluate(() => localStorage.getItem("ttp:fresh:pending"))) === null);
await page.waitForTimeout(800); await page.reload(); await boot();
ok("#14 after Undo the session still restores", await page.getByText(/Restored your last session/).isVisible().catch(() => false) && (await count("F#13")) > 0);
await page.getByRole("button", { name: "Start fresh" }).click(); await page.waitForTimeout(200);
await page.reload(); await boot(); await page.waitForTimeout(1500);
ok("#14 a reload inside the Undo window does not restore the old session", !(await page.getByText(/Restored your last session/).isVisible().catch(() => false)) && (await count("F#13")) === 0);
await page.reload(); await boot(); await page.waitForTimeout(1500);
ok("#14 …and it stays cleared on the next launch", !(await page.getByText(/Restored your last session/).isVisible().catch(() => false)));
// the window running out
await tab("MusicXML / GP");
await page.locator('input[type="file"]').first().setInputFiles(path.join(repo, "Steely Dan - Peg.gp4"));
await page.getByText(/bars ·/).first().waitFor({ timeout: 60000 }); await page.waitForTimeout(1200);
await page.reload(); await boot(); await page.getByText(/Restored your last session/).waitFor({ timeout: 30000 });
await page.getByRole("button", { name: "Start fresh" }).click();
await page.waitForTimeout(11000);
ok("#14 Undo disappears when the window ends", !(await page.getByRole("button", { name: "Undo", exact: true }).isVisible().catch(() => false)));
await page.reload(); await boot(); await page.waitForTimeout(1500);
ok("#14 after the window the session is gone", !(await page.getByText(/Restored your last session/).isVisible().catch(() => false)));
// a file opened inside the window replaces the old session — a reload then must NOT delete the new one (Codex, PR #160)
await tab("MusicXML / GP");
await page.locator('input[type="file"]').first().setInputFiles(path.join(repo, "Steely Dan - Peg.gp4"));
await page.getByText(/bars ·/).first().waitFor({ timeout: 60000 }); await page.waitForTimeout(1200);
await page.reload(); await boot(); await page.getByText(/Restored your last session/).waitFor({ timeout: 30000 });
await page.getByRole("button", { name: "Start fresh" }).click(); await page.waitForTimeout(200);
await tab("MusicXML / GP");
await page.locator('input[type="file"]').first().setInputFiles(path.join(repo, "Steely Dan - Black Cow.gp"));
await page.getByText(/bars ·/).first().waitFor({ timeout: 60000 }); await page.waitForTimeout(1500);
ok("#14 opening a file inside the window cancels the pending clear", (await page.evaluate(() => localStorage.getItem("ttp:fresh:pending"))) === null && !(await page.getByRole("button", { name: "Undo", exact: true }).isVisible().catch(() => false)));
await page.reload(); await boot();
await page.getByText(/Restored your last session/).waitFor({ timeout: 30000 }).catch(() => {});
ok("#14 …and a reload restores the NEW file", await page.getByText(/Restored your last session/).isVisible().catch(() => false) && await page.getByText(/Black Cow/).first().isVisible().catch(() => false));
await page.getByRole("button", { name: "Start fresh" }).click(); await page.waitForTimeout(11000); // leave a clean slate for #2

// ---- #2 audio re-reads ask first
await tab("Audio 🎵"); await page.waitForTimeout(500);
if (!(await page.getByText("Upload audio / video").count())) { await page.screenshot({ path: path.join(os.tmpdir(), "safety-audio.png") }); console.log("audio panel missing; screenshot", path.join(os.tmpdir(), "safety-audio.png")); }
// headless Chromium here doesn't decode this MP3 (unchanged main behaves the same), so feed 40 s of it as WAV
const wav = path.join(site, "backing.wav");
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", path.join(repo, "isolated Backing VOCALS ONLY ALL 3 Chorus’ - 6JuVUq.mp3"), "-t", "40", "-ac", "2", "-ar", "22050", wav]);
await page.locator("label", { hasText: "Upload audio" }).locator('input[type="file"]').setInputFiles(wav);
await page.getByRole("button", { name: /Edit/ }).first().waitFor({ timeout: 120000 }).catch(async (e) => { await page.screenshot({ path: path.join(os.tmpdir(), "safety-audio2.png"), fullPage: true }); throw e; });
await page.waitForTimeout(1000);
await page.getByRole("button", { name: /Edit/ }).first().click(); await page.waitForTimeout(300);
await page.locator("button").filter({ hasText: /^[A-G][#b]?(m|maj7|m7|7|sus4)?\d?$/ }).first().click(); await page.waitForTimeout(200);
await page.locator("input:focus").fill("Bb13"); await page.locator("input:focus").press("Enter"); await page.waitForTimeout(400);
ok("#2 audio edit made", (await count("Bb13")) > 0);
await page.getByRole("button", { name: /^Notes/ }).first().click(); await page.waitForTimeout(400);
const bar = page.locator("[data-pending-read]");
ok("#2 Chords → Notes asks first", await bar.isVisible(), await bar.textContent().catch(() => ""));
await page.getByRole("button", { name: "Keep my edits" }).click(); await page.waitForTimeout(300);
ok("#2 Keep my edits: still on chords, edit kept", !(await bar.isVisible()) && (await count("Bb13")) > 0);
await page.getByRole("button", { name: "Basic", exact: true }).first().click(); await page.waitForTimeout(500);
ok("#2 a chord-names change waits and says the chart is the previous reading", await bar.isVisible() && /previous reading/.test(await bar.textContent()));
ok("#2 …and the edit is still there", (await count("Bb13")) > 0);
await page.getByRole("button", { name: "Read again" }).click();
await page.waitForTimeout(500); await page.getByRole("button", { name: /Edit/ }).first().waitFor({ timeout: 120000 }); await page.waitForTimeout(1500);
ok("#2 Read again re-reads (the edit goes, as the bar said)", !(await bar.isVisible().catch(() => false)) && (await count("Bb13")) === 0);
await page.getByRole("button", { name: "Pro", exact: true }).first().click(); await page.waitForTimeout(400); // put the pref back
ok("#2 with no edits a setting change re-reads at once (no bar)", !(await bar.isVisible().catch(() => false)));

ok("no page errors", logs.length === 0, logs.slice(0, 3));
await browser.close(); server.close(); fs.rmSync(site, { recursive: true, force: true });
console.log(`\n${steps.filter(Boolean).length}/${steps.length} passed`);
process.exit(steps.every(Boolean) ? 0 : 1);
