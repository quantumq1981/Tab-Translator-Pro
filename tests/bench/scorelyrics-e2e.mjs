/* Lyrics from a score, end to end in the REAL app (headless Chromium, phone width): MusicXML/GP panel →
 * open a Guitar Pro 4/5 file with lyrics → Lyrics view → "📄 Lyrics from the score" → the sheet shows the
 * score's words with chords over them, and a word-timed LRC is offered. Optional --audio links a recording
 * first (🎧 Link a recording) and checks the Audio panel's lyric sheet uses the recording's clock.
 *
 *   node bench/scorelyrics-e2e.mjs --deps <dir> --score <file.gp5> [--audio <mp3>] [--out <dir>]
 * Dev-only. */
import path from "node:path";
import { startApp, arg } from "./e2e-app.mjs";
const SCORE = arg("score"), AUDIO = arg("audio"), OUT = arg("out", process.cwd());
if (!SCORE) { console.error("--score is required"); process.exit(2); }
const app = await startApp({ width: +arg("width", 390), height: +arg("height", 844), context: { hasTouch: true } });
const { page, ok } = app;
const text = () => page.locator("body").innerText();

await page.getByRole("button", { name: "MusicXML / GP" }).click({ timeout: 60000 });
await page.locator('input[type="file"]').first().setInputFiles(SCORE);
await page.getByRole("button", { name: "Lyrics", exact: true }).first().click({ timeout: 60000 });
await page.getByRole("button", { name: /Lyrics from the score/ }).click({ timeout: 60000 });
await page.waitForTimeout(800);
let body = await text();
ok("the score's lyrics fill the sheet", /On a dark de ?sert high ?way/i.test(body), (body.match(/On a dark[^\n]*/) || [""])[0]);
ok("a word-timed LRC is offered", (await page.getByRole("button", { name: /LRC \(word-timed\)/ }).count()) > 0);
await page.screenshot({ path: path.join(OUT, "scorelyrics-e2e-score.png") });

if (AUDIO) {
  await page.getByRole("button", { name: /Link a recording/ }).click({ timeout: 60000 });
  await page.getByText(/upload the recording above to link it/).waitFor({ timeout: 60000 });
  await page.locator("label", { hasText: "Upload audio" }).locator('input[type="file"]').setInputFiles(AUDIO);
  await page.getByText(/linked — score bars/).waitFor({ timeout: 300000 });
  // the linked chart's view switch (not the app's "Lyrics" mode tab): the last Chart·Grid·Tab·Notes·Lyrics row
  const n = await page.getByRole("button", { name: "Lyrics", exact: true }).count();
  await page.getByRole("button", { name: "Lyrics", exact: true }).last().click();
  await page.getByRole("button", { name: /Lyrics from the score/ }).last().click({ timeout: 60000 });
  await page.waitForTimeout(800);
  body = await text();
  ok("linked: the lyric sheet uses the recording's clock", /On a dark de ?sert high ?way/i.test(body) && /recording's clock|linked/i.test(body));
  await page.screenshot({ path: path.join(OUT, "scorelyrics-e2e-linked.png") });
}
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok("no horizontal overflow at 390 px", overflow <= 1, overflow);
ok("no console errors", app.errors().length === 0, app.errors().slice(0, 5));
await app.close();
process.exit(app.steps.every((s) => s.ok) ? 0 : 1);
