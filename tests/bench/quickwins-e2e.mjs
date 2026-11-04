/* Workbench quick wins end to end (real app, headless Chromium):
 *   node bench/quickwins-e2e.mjs --deps <dir> [--gp "Steely Dan - Peg.gp4"] [--out <dir>]
 * Edit a chord, transpose +2 → the edit moves with the chart (and back at 0); the numerals toggle
 * cycles I·V·vi → Nashville 1·5·6m → off; ⧉ Image puts a PNG of the chart on the clipboard. */
import path from "node:path";
import { startApp, arg } from "./e2e-app.mjs";
const OUT = arg("out", process.cwd());
const app = await startApp({ context: { permissions: ["clipboard-read", "clipboard-write"] } });
const { page, ok } = app;
await page.getByRole("button", { name: "MusicXML / GP" }).click({ timeout: 60000 });
await page.locator('input[type="file"]').first().setInputFiles(path.resolve(app.repo, arg("gp", "Steely Dan - Peg.gp4")));
const chords = page.locator('button[title*="guitar voicings"], button[title="click to re-label"]');
await chords.first().waitFor({ timeout: 60000 });
const first = async () => (await chords.first().innerText()).split("\n")[0].trim();

// 1 — an edit follows the transpose
await page.getByRole("button", { name: "✎ Edit" }).click();
await chords.first().click();
const input = page.locator("input[autofocus], input:focus").first();
await input.fill("A7"); await input.press("Enter"); await page.waitForTimeout(200);
await page.getByRole("button", { name: "✓ Editing" }).click();
const at0 = await first();
const plus = page.locator("span", { hasText: /^transpose$/ }).locator("xpath=following-sibling::button[1]");
await plus.click(); await plus.click(); await page.waitForTimeout(300);
const at2 = await first();
await page.getByRole("button", { name: "0", exact: true }).click(); await page.waitForTimeout(300);
const back = await first();
ok("a chord edit transposes with the chart (A7 → B7 at +2 → A7 at 0)", at0 === "A7*" && at2 === "B7*" && back === "A7*", { at0, at2, back });

// 2 — the numerals toggle has a Nashville state
const numerals = page.getByRole("button", { name: /^(I·V·vi|1·5·6m)/ });
await numerals.click(); await page.waitForTimeout(200);
const roman = (await chords.nth(1).innerText()).split("\n")[1] || "";
await numerals.click(); await page.waitForTimeout(200);
const label = (await numerals.innerText()).trim(), nns = (await chords.nth(1).innerText()).split("\n")[1] || "";
await numerals.click(); await page.waitForTimeout(200);
const offLines = (await chords.nth(1).innerText()).split("\n").filter(Boolean).length;
ok("numerals: I·V·vi → Nashville → off", /[IViv]/.test(roman) && label === "1·5·6m ✓" && /^[b#]?[1-7]/.test(nns) && offLines === 1, { roman, label, nns, offLines });
await page.screenshot({ path: path.join(OUT, "quickwins-chart.png") });

// 3 — ⧉ Image → a PNG on the clipboard
await page.getByRole("button", { name: "⧉ Image" }).click();
await page.getByRole("button", { name: "image ✓" }).waitFor({ timeout: 15000 });
const png = await page.evaluate(async () => {
  const items = await navigator.clipboard.read(); const it = items.find((i) => i.types.includes("image/png")); if (!it) return null;
  const b = await it.getType("image/png"); const bmp = await createImageBitmap(b); return { size: b.size, w: bmp.width, h: bmp.height };
});
ok("⧉ Image puts the chart on the clipboard as a 2× PNG", png && png.size > 5000 && png.w === 1760 && png.h > 200, png);
ok("no console errors", app.errors().length === 0, app.errors());
await app.close();
process.exit(app.steps.every((s) => s.ok) ? 0 : 1);
