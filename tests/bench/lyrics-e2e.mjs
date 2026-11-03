/* WO-3 lyrics view end to end (real app, headless Chromium):
 *   node bench/lyrics-e2e.mjs --deps <dir> [--gp blue-sky.gp] [--vocal "Peg VOCALS ONLY - CzTvVJ.mp3"] [--out <dir>]
 * 1. GP chart → Lyrics view → paste a sheet → 🎯 Auto-align (no recording → spread over the bars)
 *    → chord lines over the words → nudge a line → ⬇ LRC.
 * 2. Audio mode → the repo's real isolated-vocal stem → its chord chart → Lyrics → 🎯 Auto-align
 *    to the vocal (voiced phrases, off-thread). Placeholder lines (no copyrighted text): checks the
 *    path runs and the lines land inside the sung part, in order. */
import fs from "node:fs"; import path from "node:path";
import { startApp, arg } from "./e2e-app.mjs";
const OUT = arg("out", process.cwd());
const app = await startApp();
const { page, ok } = app;
const GP = path.resolve(app.repo, arg("gp", "blue-sky.gp")), VOCAL = path.resolve(app.repo, arg("vocal", "Peg VOCALS ONLY - CzTvVJ.mp3"));
const sheet = "[Verse 1]\nThe morning light is on the hill\nAnd every road is calling\nI keep a song inside me still\nWhile all the leaves are falling\n\n[Chorus]\nSing it out\nSing it out tonight\n";

await page.getByRole("button", { name: "MusicXML / GP" }).click({ timeout: 60000 });
await page.locator('input[type="file"]').first().setInputFiles(GP);
await page.getByRole("button", { name: "Lyrics", exact: true }).first().click({ timeout: 60000 });
await page.locator("textarea").last().fill(sheet);
await page.getByRole("button", { name: /Auto-align to the bars/ }).click();
await page.getByText(/6 lines · spread over the bars/).waitFor({ timeout: 30000 });
const chordRows = await page.locator("div[title*='bar']").count();
ok("no recording: 6 lines spread over the chart's bars", chordRows === 6, chordRows);
const firstChordLine = await page.locator("div[title*='bar'] > div").first().textContent();
ok("the chart's chords sit above the first lyric line", /^[A-G]/.test(firstChordLine.trim()), firstChordLine);
const t0 = await page.locator("div[title*='bar']").nth(2).getAttribute("title");
await page.locator("div[title*='bar']").nth(2).click();
await page.getByRole("button", { name: "beat ▶" }).click();
const t1 = await page.locator("div[title*='bar']").nth(2).getAttribute("title");
ok("nudging a line a beat moves it", parseFloat(t1) > parseFloat(t0), { before: t0, after: t1 });
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "⬇ LRC" }).click()]);
const lrcPath = path.join(OUT, "lyrics.lrc"); await dl.saveAs(lrcPath);
const lrc = fs.readFileSync(lrcPath, "utf8");
ok("⬇ LRC saves one [mm:ss.xx] stamp per line", (lrc.match(/^\[\d\d:\d\d\.\d\d\]/gm) || []).length === 6, lrc.split("\n").slice(0, 4));
await page.screenshot({ path: path.join(OUT, "lyrics-gp.png") });

// 2) audio: the real vocal stem
await page.getByRole("button", { name: "Audio 🎵" }).click();
await page.locator('input[type="file"]').first().setInputFiles(VOCAL);
await page.getByText(/bars · ♩=/).first().waitFor({ timeout: 300000 });
await page.getByRole("button", { name: "Lyrics", exact: true }).first().click({ timeout: 60000 });
await page.locator("textarea").last().fill(sheet + "\n[Verse 2]\nA lantern burning in the rain\nA river running under\nI call your name and call again\nAnd listen for the thunder\n");
const ta = Date.now();
await page.getByRole("button", { name: /Auto-align to the vocal/ }).click();
await page.getByText(/10 lines · from the recording/).waitFor({ timeout: 120000 });
const starts = (await page.locator("div[title*='bar']").evaluateAll((els) => els.map((e) => parseFloat(e.getAttribute("title")))));
ok("vocal stem: 10 lines aligned to the recording, in order", starts.length === 10 && starts.every((t, i) => i === 0 || t > starts[i - 1]), { starts, sec: (Date.now() - ta) / 1000 });
await page.screenshot({ path: path.join(OUT, "lyrics-vocal.png") });
ok("no console errors", app.errors().length === 0, app.errors());
await app.close();
process.exit(app.steps.every((s) => s.ok) ? 0 : 1);
