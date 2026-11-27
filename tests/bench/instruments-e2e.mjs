/* WO-4 instruments + arrangement levels end to end (real app, headless Chromium):
 *   node bench/instruments-e2e.mjs --deps <dir> [--gp "Steely Dan - Peg.gp4"] [--out <dir>]
 * Opens a chord's voicing modal → Ukulele (4-string svguitar diagrams) → Mandolin → Bass → Piano
 * (keyboard SVGs) → next ▶ walks the chart with voice-leading → left-handed + capo; then the
 * Level select (Beginner = plain triads, capo hint). */
import path from "node:path";
import { startApp, arg } from "./e2e-app.mjs";
/* redesign step 2: exports live in the chart's ⇪ Share menu, chord-name / arrangement / practice controls in ⚙ Settings */
const openChartPanel = async (scope, which) => { const b = scope.getByRole("button", { name: which === "share" ? "⇪ Share" : /^⚙ Settings/ }).first(); if ((await b.getAttribute("aria-expanded")) !== "true") { await b.click(); await new Promise((r) => setTimeout(r, 200)); } };
const OUT = arg("out", process.cwd());
const app = await startApp();
const { page, ok } = app;
const GP = path.resolve(app.repo, arg("gp", "Steely Dan - Peg.gp4"));
await page.getByRole("tab", { name: "MusicXML / GP" }).click({ timeout: 60000 });
await page.locator('input[type="file"]').first().setInputFiles(GP);
const chordBtn = page.locator('button[title*="guitar voicings"]');
await chordBtn.first().waitFor({ timeout: 60000 });
await chordBtn.first().click();
const modal = page.getByRole("dialog");
await modal.locator("svg").first().waitFor({ timeout: 30000 });
const header = async () => (await modal.locator("span").first().innerText()).trim();
const strings = async () => modal.locator("svg").first().evaluate((svg) => svg.querySelectorAll("line, path").length);
for (const [name, n] of [["Ukulele", 4], ["Mandolin", 4], ["Bass (4)", 4]]) {
  await modal.getByRole("button", { name, exact: true }).click(); await page.waitForTimeout(500);
  const count = await modal.getByText(/\d+ voicings?$/).innerText().catch(() => "?");
  const tiles = await modal.locator("section button").count();
  const labels = await modal.locator("section button > div:last-child").allInnerTexts();
  ok(`${name}: diagrams render with ${n} strings`, tiles >= 3 && labels.slice(0, 3).every((l) => l.split(" · ")[0].trim().split(/\s+/).length === n), { count, tiles, labels: labels.slice(0, 3) });
}
await page.screenshot({ path: path.join(OUT, "voicings-bass.png") });
await modal.getByRole("button", { name: "Piano", exact: true }).click(); await page.waitForTimeout(500);
const keyboards = await modal.locator("svg[aria-label^='keys']").count();
ok("Piano: keyboard diagrams", keyboards >= 6, keyboards);
const h0 = await header();
await modal.getByRole("button", { name: /next .* ▶/ }).click(); await page.waitForTimeout(500);
const h1 = await header(), moved = await modal.getByText(/ st move/).count();
ok("next ▶ walks to the chart's next chord, ranked by voice-leading", h1 !== h0 && moved > 0, { from: h0, to: h1, moved });
await page.screenshot({ path: path.join(OUT, "voicings-piano.png") });
await modal.getByRole("button", { name: "Ukulele", exact: true }).click(); await page.waitForTimeout(300);
const before = (await modal.locator("section button > div:last-child").first().innerText()).trim();
await modal.getByRole("button", { name: "left-handed", exact: true }).click(); await page.waitForTimeout(300);
const after = (await modal.locator("section button > div:last-child").first().innerText()).trim();
ok("left-handed mirrors the diagram (string order reversed)", after === before.split(" ").reverse().join(" "), { before, after });
await modal.getByRole("button", { name: "+", exact: true }).click(); await page.waitForTimeout(300);
ok("capo + : frets shown above the capo", /capo 1/.test(await modal.locator("section button > div:last-child").first().innerText()));
await modal.getByRole("button", { name: "close" }).click();
// arrangement level — on a B♭ tune (Anthropology), so Beginner has to move the key and give a capo
await page.locator('input[type="file"]').first().setInputFiles(path.resolve(app.repo, "Charlie Parker - Anthropology.gp5"));
await page.waitForTimeout(1500);
// A multi-part file opens on Harmony (UX review #4). Harmony + the Chords part read the relative minor (G minor →
// Em shapes, capo 3 — the same notes, so it still plays along); the melody part reads B♭. First Harmony: any capo
// hint must match the level's own transposition. Then Track 1 for the exact B♭ → A shapes, capo 1 case.
const levelSel = () => page.locator("select").filter({ has: page.locator("option[value='beginner']") });
await openChartPanel(page, "settings"); await levelSel().selectOption("beginner");
await page.waitForTimeout(500);
ok("Harmony (opened by default): Beginner gives a capo hint to play along", (await page.getByText(/capo [1-7] to play along/i).count()) === 1, await page.getByText(/to play along/i).allInnerTexts());
await page.getByRole("button", { name: "Track 1", exact: true }).click(); await page.waitForTimeout(800);
if (!(await levelSel().count())) await openChartPanel(page, "settings");
await levelSel().selectOption("beginner");
await page.waitForTimeout(500);
const syms = await page.locator('button[title*="guitar voicings"]').allInnerTexts();
const clean = syms.map((s) => s.split("\n")[0].trim()).filter(Boolean);
ok("Level: Beginner shows plain triads", clean.length > 4 && clean.every((s) => /^[A-G][#b]?m?(\*)?$/.test(s)), clean.slice(0, 12));
ok("…moved to an open-chord key with a capo hint to play along (B♭ → A shapes, capo 1)", (await page.getByText(/capo 1 to play along/i).count()) === 1);
await page.screenshot({ path: path.join(OUT, "level-beginner.png") });
ok("no console errors", app.errors().length === 0, app.errors());
await app.close();
process.exit(app.steps.every((s) => s.ok) ? 0 : 1);
