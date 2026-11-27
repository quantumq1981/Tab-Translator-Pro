/* Redesign step 3 (2026-11-27): the chord sheet + the polish kit, in the real app.
 *   node bench/sheet-e2e.mjs [--repo <checkout>] [--shots <dir>]
 * Assembles the site as .github/workflows/pages.yml does, serves it, and on iPhone 13 and a touch iPad (820 × 1180):
 *   - a chart (Peg.gp4) has no side readout column; the app's text is the system UI font, chords Space Mono
 *   - tapping a chord slides up a sheet docked to the bottom edge with the chord's notes, intervals, match %, other
 *     readings and its diagrams; focus starts inside, Tab stays inside, Escape closes and focus returns to the chord
 *   - dragging the handle a little springs back; dragging it far closes the sheet
 *   - Change chord renames the chart's chord (Undo toast puts it back); a "could also be" tap uses that name
 *   - while the chart plays, the sounding chord carries the glow class; a button pressed down is scaled to .96
 *   - section colour bands on a file with sections (Black Cow); the waveform scrubber seeks a recording
 *   - prefers-reduced-motion: the sheet does not animate; no horizontal scroll; no page errors */
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
const site = fs.mkdtempSync(path.join(os.tmpdir(), "ttp-sheet-"));
execFileSync("bash", ["-euo", "pipefail", "-c", body.join("\n").replace(/_site\b/g, site)], { cwd: repo, env: { ...process.env, GITHUB_SHA: "sheet00deadbeef" }, stdio: "pipe" });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"), f = path.join(site, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname));
  fs.readFile(f, (e, d) => { if (e) { res.statusCode = 404; res.end(); return; } res.setHeader("content-type", MIME[path.extname(f)] || "application/octet-stream"); res.end(d); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const steps = []; const ok = (n, c, x) => { steps.push(!!c); console.log(c ? "OK  " : "FAIL", n, x !== undefined ? JSON.stringify(x).slice(0, 260) : ""); };


// a 12 s WAV: C major then G major (sine partials) for the Audio panel's waveform
const sr = 16000, secs = 12, pcm = new Float32Array(sr * secs);
const chord = (t) => (t < 6 ? [48, 52, 55, 60] : [43, 47, 50, 55]);
for (let i = 0; i < pcm.length; i++) { const t = i / sr; let v = 0; for (const m of chord(t)) v += Math.sin(2 * Math.PI * 440 * Math.pow(2, (m - 69) / 12) * t) / 5; pcm[i] = v * (t < 6 ? 0.9 : 0.45) * Math.min(1, (t % 6) * 8); }
const WAV = path.join(site, "sheet-test.wav"); const wav = Buffer.alloc(44 + pcm.length * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(36 + pcm.length * 2, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(pcm.length * 2, 40);
for (let i = 0; i < pcm.length; i++) wav.writeInt16LE(Math.round(pcm[i] * 32767), 44 + 2 * i);
fs.writeFileSync(WAV, wav);

const CHORD_RE = /^[A-G][#b]?(maj7|m7|m|7|6|9|maj9|m9|7sus4|sus4|m7b5|dim7?)?(\/[A-G][#b]?)?$/;
for (const [label, opts] of [["phone", { ...devices["iPhone 13"] }], ["iPad", { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 }]]) {
  const ctx = await browser.newContext(opts);
  await ctx.route((u) => !u.href.startsWith(origin), (r) => r.abort());
  const page = await ctx.newPage();
  const logs = [];
  page.on("pageerror", (e) => logs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_FAILED|net::/.test(m.text())) logs.push(m.text()); });
  await page.goto(origin + "/");
  const L = (s) => `${label}: ${s}`;
  const modeTab = (name) => page.getByRole("tab", { name, exact: true });
  await modeTab("Manual").waitFor({ timeout: 30000 }); await page.waitForTimeout(500);
  await modeTab("Manual").click(); await page.waitForTimeout(300);
  ok(L("Manual keeps its LIVE READOUT"), await page.getByText("LIVE READOUT", { exact: true }).isVisible());
  await page.locator('.tdp-nav button[data-dest="open"]').click(); await modeTab("MusicXML / GP").click();
  await page.locator('input[type="file"]').first().setInputFiles(path.join(repo, "Steely Dan - Peg.gp4"));
  await page.getByText(/bars ·/).first().waitFor({ timeout: 60000 }); await page.waitForTimeout(800);

  const layout = await page.evaluate(() => {
    const cols = document.querySelector(".tdp-cols"), secs = cols ? [...cols.children].filter((c) => c.tagName === "SECTION") : [];
    const chordBtn = [...document.querySelectorAll(".tdp-bar button")][0];
    return { sections: secs.length, readout: /CHORD READOUT|LIVE READOUT/.test(document.body.innerText), w: secs[0] ? Math.round(secs[0].getBoundingClientRect().width) : 0, cw: cols ? Math.round(cols.getBoundingClientRect().width) : 0,
      appFont: getComputedStyle(document.querySelector(".tdp-app")).fontFamily, chordFont: chordBtn ? getComputedStyle(chordBtn).fontFamily : "",
      fontHref: [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href).join(" ") };
  });
  ok(L("a chart has no side readout; the chart takes the full width"), layout.sections === 1 && !layout.readout && layout.w >= layout.cw - 1, layout);
  ok(L("body text is the system UI font; chords are Space Mono; IBM Plex is not requested"), /system-ui/.test(layout.appFont) && /Space Mono/.test(layout.chordFont) && !/Plex/.test(layout.fontHref) && /Space\+Mono/.test(layout.fontHref), layout);

  // ---- tap a chord → the sheet
  const firstChord = page.locator(".tdp-bar button").first();
  const chordName = (await firstChord.innerText()).split("\n")[0].trim();
  await firstChord.click(); await page.waitForTimeout(700);
  const dlg = page.getByRole("dialog");
  const geo = await page.evaluate(() => { const s = document.querySelector("[data-chord-sheet]"), r = s && s.getBoundingClientRect(); return r ? { bottom: Math.round(r.bottom), top: Math.round(r.top), h: window.innerHeight, w: Math.round(r.width), vw: window.innerWidth } : null; });
  ok(L("tapping a chord opens a sheet docked to the bottom edge"), (await dlg.count()) === 1 && geo && Math.abs(geo.bottom - geo.h) <= 2 && geo.top > 0, geo);
  const rd = await page.evaluate(() => { const r = document.querySelector("[data-chord-reading]"); return r ? { text: r.innerText, pills: r.querySelectorAll("b").length, det: (() => { const d = r.querySelector("[data-readout-details]"); return d ? { open: d.open, bits: /0b[01]{12}/.test(d.textContent) } : null; })() } : null; });
  ok(L("the sheet reads the chord: notes + intervals, match %, Hear it, Change chord"), rd && /Notes in this chord/.test(rd.text) && /\d+% match/.test(rd.text) && /\bR\b/.test(rd.text) && /Hear it/.test(rd.text) && /Change chord/.test(rd.text) && rd.pills >= 3, rd && rd.text.slice(0, 200));
  ok(L("bit masks / scores only behind a closed Details"), rd && rd.det && !rd.det.open && rd.det.bits && !/0b[01]{12}/.test(rd.text.replace(/Details[\s\S]*$/, "")), rd && rd.det);
  ok(L("the diagrams are still there (voicings below the reading)"), (await dlg.locator("svg").count()) >= 3 || /voicing/.test(await dlg.innerText()));
  const focus0 = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("aria-label"));
  for (let i = 0; i < 40; i++) await page.keyboard.press("Tab");
  const inside = await page.evaluate(() => !!document.activeElement.closest("[data-chord-sheet]"));
  ok(L("focus starts on close and Tab stays inside the sheet"), focus0 === "close" && inside, { focus0, inside });
  if (shots) await page.screenshot({ path: path.join(shots, `${label}-sheet.png`) });
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  const back = await page.evaluate(() => document.activeElement && document.activeElement.closest(".tdp-bar") ? document.activeElement.innerText.split("\n")[0].trim() : null);
  ok(L("Escape closes; focus returns to the chord"), (await dlg.count()) === 0 && back === chordName, { back, chordName });

  // ---- drag the handle: a little → springs back; far → closes
  const dragBy = async (dy, steps) => {
    const h = await page.locator("[data-sheet-handle]").boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down();
    for (let i = 1; i <= steps; i++) { await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2 + (dy * i) / steps); await page.waitForTimeout(16); }
    await page.mouse.up(); await page.waitForTimeout(450);
  };
  await firstChord.click(); await page.waitForTimeout(600);
  await dragBy(40, 20);
  const tf = await page.evaluate(() => getComputedStyle(document.querySelector("[data-chord-sheet]")).transform);
  ok(L("a short drag springs back"), (await dlg.count()) === 1 && (tf === "none" || /matrix\(1, 0, 0, 1, 0, 0\)/.test(tf)), tf);
  await dragBy(260, 12);
  ok(L("dragging the handle down closes the sheet"), (await dlg.count()) === 0);

  // ---- Change chord + Undo, and "could also be"
  await firstChord.click(); await page.waitForTimeout(600);
  await dlg.getByRole("button", { name: "✎ Change chord" }).click();
  await dlg.getByRole("textbox", { name: "new chord name" }).fill("F#13"); await page.keyboard.press("Enter"); await page.waitForTimeout(400);
  const renamed = (await page.locator(".tdp-bar button").first().innerText()).split("\n")[0].trim();
  const toast = page.getByRole("status").filter({ hasText: "F#13" });
  ok(L("Change chord renames the chart's chord and offers Undo"), (await dlg.count()) === 0 && renamed === "F#13*" && (await toast.count()) === 1, { renamed });
  await toast.getByRole("button", { name: "Undo" }).click(); await page.waitForTimeout(400);
  const undone = (await page.locator(".tdp-bar button").first().innerText()).split("\n")[0].trim();
  ok(L("Undo puts the detected chord back"), undone === chordName, { undone, chordName });
  await firstChord.click(); await page.waitForTimeout(600);
  const alt = dlg.locator("[data-chord-reading] button").filter({ hasText: "%" }).first();
  const altName = (await alt.locator("b").innerText()).trim();
  await alt.click(); await page.waitForTimeout(400);
  const used = (await page.locator(".tdp-bar button").first().innerText()).split("\n")[0].trim();
  ok(L("tapping a 'could also be' reading uses that name"), used === altName + "*", { used, altName });
  await page.getByRole("status").getByRole("button", { name: "Undo" }).first().click().catch(() => {}); await page.waitForTimeout(300);

  // ---- playhead glow + tactile press
  await page.getByRole("button", { name: "▶ Play" }).first().click(); await page.waitForTimeout(1600);
  const glow = await page.evaluate(() => { const n = document.querySelector(".tdp-now"); return n ? { name: n.innerText.split("\n")[0], shadow: getComputedStyle(n, "::after").boxShadow } : null; });
  ok(L("the sounding chord carries the playhead glow"), glow && CHORD_RE.test(glow.name.replace(/\*$/, "")) && /rgba/.test(glow.shadow), glow);
  await page.getByRole("button", { name: /■ Stop/ }).first().click().catch(() => {}); await page.waitForTimeout(200);
  const tab = page.getByRole("tab", { name: "Chart", exact: true }); const tb = await tab.boundingBox();
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2); await page.mouse.down(); await page.waitForTimeout(200);
  const pressed = await tab.evaluate((el) => getComputedStyle(el).transform);
  await page.mouse.up();
  ok(L("a pressed button is scaled to .96"), /matrix\(0\.96, 0, 0, 0\.96/.test(pressed), pressed);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(L("no horizontal page scroll"), overflow <= 1, overflow);

  // ---- section colour bands (Black Cow has Intro / Verse / Chorus …)
  await page.locator('input[type="file"]').first().setInputFiles(path.join(repo, "Steely Dan - Black Cow.gp"));
  await page.waitForTimeout(2500);
  const bands = await page.evaluate(() => [...document.querySelectorAll(".tdp-bar [data-section]")].map((s) => ({ k: s.getAttribute("data-section"), t: s.textContent, c: getComputedStyle(s).color, b: getComputedStyle(s.closest(".tdp-bar")).borderLeftColor })));
  const kinds = new Set(bands.map((b) => b.k)), cols = new Set(bands.map((b) => b.b));
  ok(L("section labels + colour bands (different kinds, different colours)"), bands.length >= 3 && kinds.size >= 2 && cols.size >= 2, bands.slice(0, 5));
  if (shots) await page.screenshot({ path: path.join(shots, `${label}-sections.png`) });

  // ---- waveform scrubber (Audio)
  await page.locator('.tdp-nav button[data-dest="open"]').click(); await modeTab("Audio 🎵").click(); await page.waitForTimeout(400);
  await page.locator("label", { hasText: "Upload audio" }).locator('input[type="file"]').setInputFiles(WAV);
  await page.locator("[data-waveform]").first().waitFor({ timeout: 90000 }); await page.waitForTimeout(500);
  const wv = page.locator("[data-waveform]").first(); const wb = await wv.boundingBox();
  await wv.click({ position: { x: wb.width * 0.5, y: wb.height / 2 } }); await page.waitForTimeout(900);
  const now = await wv.getAttribute("aria-valuenow");
  ok(L("tapping the waveform plays from there"), +now >= 5 && +now <= 8, { now });
  await page.getByRole("button", { name: /■ Stop stem/ }).first().click().catch(() => {});
  if (shots) await wv.screenshot({ path: path.join(shots, `${label}-waveform.png`) });
  ok(L("no page errors"), !logs.length, logs.slice(0, 4));
  await ctx.close();
}

// ---- a short screen (phone in landscape, review on #165): everything in the sheet can be scrolled to, × stays visible
{
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  await ctx.route((u) => !u.href.startsWith(origin), (r) => r.abort());
  const page = await ctx.newPage(); await page.goto(origin + "/");
  await page.getByRole("tab", { name: "MusicXML / GP", exact: true }).click({ timeout: 30000 });
  await page.locator('input[type="file"]').first().setInputFiles(path.join(repo, "Steely Dan - Peg.gp4"));
  await page.getByText(/bars ·/).first().waitFor({ timeout: 60000 }); await page.waitForTimeout(500);
  await page.locator(".tdp-bar button").first().click(); await page.waitForTimeout(900);
  await page.locator("[data-chord-reading] summary").click(); await page.waitForTimeout(200);   // Details open = tallest header
  const sc = await page.evaluate(() => {
    const el = document.querySelector("[data-sheet-scroll]"); el.scrollTop = el.scrollHeight;
    const box = el.getBoundingClientRect(), last = [...el.querySelectorAll("div")].filter((d) => /Tap a diagram to hear it/.test(d.textContent) && !d.querySelector("div")).pop();
    const lr = last && last.getBoundingClientRect(), x = document.querySelector('[data-chord-sheet] button[aria-label="close"]').getBoundingClientRect();
    return { scrolls: el.scrollHeight > el.clientHeight, lastVisible: !!lr && lr.top >= box.top - 1 && lr.bottom <= box.bottom + 1, closeVisible: x.top >= 0 && x.bottom <= window.innerHeight, sheetBottom: Math.round(document.querySelector("[data-chord-sheet]").getBoundingClientRect().bottom), h: window.innerHeight };
  });
  ok("short screen: the whole sheet scrolls to its last line; × stays on screen", sc.scrolls && sc.lastVisible && sc.closeVisible && Math.abs(sc.sheetBottom - sc.h) <= 2, sc);
  if (shots) await page.screenshot({ path: path.join(shots, "landscape-sheet.png") });
  await ctx.close();
}

// ---- prefers-reduced-motion
{
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, reducedMotion: "reduce" });
  await ctx.route((u) => !u.href.startsWith(origin), (r) => r.abort());
  const page = await ctx.newPage(); await page.goto(origin + "/");
  await page.getByRole("tab", { name: "MusicXML / GP", exact: true }).click({ timeout: 30000 });
  await page.locator('input[type="file"]').first().setInputFiles(path.join(repo, "Steely Dan - Peg.gp4"));
  await page.getByText(/bars ·/).first().waitFor({ timeout: 60000 }); await page.waitForTimeout(500);
  await page.locator(".tdp-bar button").first().click(); await page.waitForTimeout(100);
  const anim = await page.evaluate(() => { const s = document.querySelector("[data-chord-sheet]"); const cs = s && getComputedStyle(s); return cs ? { a: cs.animationDuration, t: cs.transitionDuration } : null; });
  ok("reduced motion: the sheet neither animates nor springs", anim && parseFloat(anim.a) < 0.01 && parseFloat(anim.t) < 0.01, anim);
  await ctx.close();
}
await browser.close(); server.close(); fs.rmSync(site, { recursive: true, force: true });
console.log(`${steps.filter(Boolean).length}/${steps.length} passed`);
process.exit(steps.every(Boolean) ? 0 : 1);
