/* Score ↔ recording link end to end: the REAL app in headless Chromium (phone width).
 *   MusicXML / GP panel → upload a score → "🎧 Link a recording →" → Audio panel opens with the
 *   score attached → upload the recording → the linked chart (the score's bars on the recording's
 *   clock), the link readout, review rows with the score's chord one tap away, Chords follow →
 *   Score, Unlink back to the recording alone.
 *
 *   node bench/link-e2e.mjs --deps <dir> --score <file.gp|.musicxml|…> --audio <file.mp3|.wav> [--out <dir>]
 * --deps = the React + Babel bundle (bench/README.md). Dev-only. */
import path from "node:path";
import { startApp, arg } from "./e2e-app.mjs";

const SCORE = arg("score"), AUDIO = arg("audio"), OUT = arg("out", process.cwd());
if (!SCORE || !AUDIO) { console.error("--score and --audio are required"); process.exit(2); }
const app = await startApp({ width: +arg("width", 390), height: +arg("height", 844), context: { hasTouch: true } });
const { page, ok } = app;
const t0 = Date.now();
const waitIdle = async () => { await page.waitForTimeout(400); await page.waitForFunction(() => !/Analyzing…|linking…/.test(document.body.innerText), null, { timeout: 300000 }); await page.waitForTimeout(400); };
const text = () => page.locator("body").innerText();

await page.getByRole("button", { name: "MusicXML / GP" }).click({ timeout: 60000 });
await page.locator('input[type="file"]').first().setInputFiles(SCORE);
await page.getByRole("button", { name: /Link a recording/ }).waitFor({ timeout: 60000 });
ok("score panel offers 🎧 Link a recording", true);
await page.getByRole("button", { name: /Link a recording/ }).click();
await page.getByText(/upload the recording above to link it/).waitFor({ timeout: 60000 });
ok("Audio panel opens with the score attached", (await text()).includes(path.basename(SCORE)));

await page.locator("label", { hasText: "Upload audio" }).locator('input[type="file"]').setInputFiles(AUDIO);
await page.getByText(/linked — score bars/).waitFor({ timeout: 300000 });
await waitIdle();
const body = await text();
const readout = (body.match(/linked — score bars[^\n]*/) || [""])[0];
const agree = +((body.match(/agrees with the score (\d+)%/) || [])[1] || NaN);
ok("link readout (bars ↔ recording, ♩, key, match)", /♩≈\d+/.test(readout) && /match \d+%/.test(readout), readout);
ok("agreement reported", agree > 50, agree);
ok("chart is on the score's bars, following the recording", /bars \(the score's\)/.test(body) && /follows the recording/.test(body));
const scoreChips = await page.getByRole("button", { name: /📄 score/ }).count();
ok("disagreements listed in review with the score's chord", scoreChips > 0, scoreChips);
await page.screenshot({ path: path.join(OUT, "link-e2e-linked.png"), fullPage: false });
await page.getByText(/linked — score bars/).scrollIntoViewIfNeeded();
await page.screenshot({ path: path.join(OUT, "link-e2e-readout.png") });

// one tap: take the score's chord for the first disagreement
if (scoreChips) {
  const pending = async () => +(((await text()).match(/(\d+) of \d+ chords uncertain/) || [])[1] || 0);
  const before = await pending();
  await page.getByRole("button", { name: /📄 score/ }).first().click();
  await page.getByRole("button", { name: /Commit selected/ }).click();
  await page.waitForTimeout(600);
  const after = await pending();
  ok("committing the score's chord removes it from review", after < before, { before, after });
}

// Chords follow → Score
await page.locator('button[title^="trust the file"]').click();
await waitIdle();
await page.getByText(/linked — score bars/).waitFor({ timeout: 300000 });
const agree2 = +(((await text()).match(/agrees with the score (\d+)%/) || [])[1] || NaN);
ok("Chords follow: Score raises agreement", agree2 >= agree, { balanced: agree, score: agree2 });
await page.locator('button[title^="the score\'s harmony unless"]').click();
await waitIdle();

// no horizontal page scroll at phone width
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok("no horizontal overflow at 390 px", overflow <= 1, overflow);

// Unlink → the recording alone
await page.getByRole("button", { name: /Unlink/ }).click();
await waitIdle();
await page.waitForFunction(() => /from audio(?! \+)/.test(document.body.innerText) && !/bars \(the score's\)/.test(document.body.innerText), null, { timeout: 300000 });
ok("Unlink returns to the recording alone", true);
// the sibling apps' sender: `ttp:decode:v1` with intent "link" → the score opens, then the Audio panel with it attached
{
  const b64 = (await import("node:fs")).readFileSync(SCORE).toString("base64");
  await page.evaluate(([name, data]) => localStorage.setItem("ttp:decode:v1", JSON.stringify({ v: 1, source: "chord-sheet-maker", createdAt: new Date().toISOString(), filename: name, b64: data, intent: "link" })), [path.basename(SCORE), b64]);
  await page.goto(app.origin + "/?import=decode");
  const okText = await page.waitForFunction(() => /upload the recording above to link it|linked — score bars/.test(document.body.innerText), null, { timeout: 60000 }).then(() => true, () => false);
  if (!okText) { await page.screenshot({ path: path.join(OUT, "link-e2e-intent-fail.png") }); console.log((await text()).slice(0, 3000)); }
  ok("ttp:decode:v1 intent \"link\" (from Chord Sheet Maker / Pro) opens the Audio panel with the score attached", (await text()).includes(path.basename(SCORE)));
}
ok("no console errors", app.errors().length === 0, app.errors().slice(0, 5));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await app.close();
process.exit(app.steps.every((s) => s.ok) ? 0 : 1);
