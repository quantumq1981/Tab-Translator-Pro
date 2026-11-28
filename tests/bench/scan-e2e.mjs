/* Scan (real app, headless Chromium): a picture of a lead sheet → chord chart.
 *   node bench/scan-e2e.mjs --deps <dir> --image <page.png|jpg> [--expect "Cm7,F7,…"] [--out <dir>]
 * Uploads the image in the Scan mode, waits for the worker (the real model on the pinned ONNX Runtime
 * 1.23.2 from jsDelivr), checks the boxes, the review list (every chord, swipe right = approve, swipe
 * left = not a chord, tick + "Approve selected", Undo), a correction and the chart + CSMPN export.
 * (pdf.js comes from cdnjs, which the harness blocks — PDFs are not exercised here.) */
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { startApp, arg } from "./e2e-app.mjs";
const OUT = arg("out", fs.mkdtempSync(path.join(os.tmpdir(), "ttp-scan-")));
const IMG = arg("image"); if (!IMG) { console.error("--image <page> required"); process.exit(2); }
const want = (arg("expect", "") || "").split(",").filter(Boolean);
const app = await startApp({ width: 430, height: 1100 }); const { page, ok } = app;
const net = []; page.on("request", (r) => net.push(r.url()));
await page.getByRole("tab", { name: "Scan", exact: true }).click();
const t0 = Date.now();
await page.locator('input[type="file"]').first().setInputFiles(IMG);
const stat = page.getByText(/systems · \d+ bars · \d+ chords/);
await stat.waitFor({ timeout: 240000 });
const line = await stat.textContent();
ok("the page is read (systems, bars, chords)", /\d+ chords/.test(line), { line, sec: ((Date.now() - t0) / 1000).toFixed(1) });
ok("the model + pinned runtime were fetched, nothing else new", net.some((u) => /models\/chord-ocr\/chord-ocr\.onnx/.test(u)) && net.some((u) => /onnxruntime-web@1\.23\.2/.test(u)) && !net.some((u) => /onnxruntime-web@1\.(2[4-9]|3)/.test(u)));
const labels = await page.locator('button[title] > span').evaluateAll((els) => els.map((e) => e.textContent));
ok("boxes on the page carry their reading", labels.length > 3, labels.slice(0, 12));
if (want.length) { const hit = want.filter((w) => labels.includes(w)).length; ok(`expected chords found on the page (${hit}/${want.length})`, hit >= 0.9 * want.length, want.filter((w) => !labels.includes(w))); }
// the review list: every chord read is a row
const rows = page.locator('input[type="checkbox"][aria-label^="select bar"]');
const nRows = await rows.count(), nChords = +(line.match(/(\d+) chords/) || [])[1];
ok("every chord is listed for review", nRows === nChords && nRows > 0, { nRows, nChords });
const approvedN = async () => +(((await page.getByRole("button", { name: /^Approved \(/ }).textContent()) || "").match(/\d+/) || [0])[0];
const swipe = async (loc, dx) => { await loc.scrollIntoViewIfNeeded(); const b = await loc.boundingBox(); const y = b.y + b.height / 2, x = b.x + b.width / 2; await page.mouse.move(x, y); await page.mouse.down(); for (let k = 1; k <= 8; k++) await page.mouse.move(x + (dx * k) / 8, y); await page.mouse.up(); };
const rowBody = (i) => rows.nth(i).locator("..");
const a0 = await approvedN();
await swipe(rowBody(0), 140);
ok("swipe right approves a chord", (await approvedN()) === a0 + 1, { a0, after: await approvedN() });
await page.getByRole("button", { name: "↶ Undo" }).click();
ok("Undo takes the approval back", (await approvedN()) === a0);
if (nRows >= 3) {
  await rows.nth(1).check(); await rows.nth(2).check();
  await page.getByRole("button", { name: /Approve selected \(2\)/ }).click();
  ok("tick two rows → Approve selected approves both", (await approvedN()) === a0 + 2);
  const before = await rows.count();
  await swipe(rowBody(before - 1), -140);
  ok("swipe left marks a box not a chord (it leaves the list)", (await rows.count()) === before - 1, { before, after: await rows.count() });
  await page.getByRole("button", { name: "↶ Undo" }).click();
  ok("Undo brings it back", (await rows.count()) === before);
  await page.getByRole("button", { name: /^To check \(/ }).click();
  const chk = await rows.count(), want2 = +(((await page.getByRole("button", { name: /^To check \(/ }).textContent()) || "").match(/\d+/) || [0])[0];
  ok("the To-check filter leaves only the uncertain chords", chk === want2, { chk, want2 });
  const alt = page.locator('button[title^="use "]').first();
  if (await alt.count()) {
    const a1 = await approvedN(), name = await alt.textContent();
    await alt.click();
    ok("a runner-up reading chip uses it in one tap (approved)", (await approvedN()) === a1 + 1, { name });
    await page.getByRole("button", { name: "↶ Undo" }).click();
  }
  await page.screenshot({ path: path.join(OUT, "scan-review.png"), fullPage: false });
  await page.getByRole("button", { name: /^All \(/ }).click();
}
// the other reader: one tap re-reads the same page images with the hand-copied (Real Book) model
ok("the first read used the printed reader, nothing hand-copied fetched", /read as printed/.test(line) && !net.some((u) => /chord-ocr-hand\.onnx/.test(u)));
await page.getByRole("button", { name: /Read again as hand-copied/ }).click();
const stat2 = page.getByText(/read as hand-copied/);
await stat2.waitFor({ timeout: 240000 });
const line2 = await page.getByText(/systems · \d+ bars · \d+ chords/).textContent();
ok("↻ Read again as hand-copied: the hand reader is fetched and the list is rebuilt", net.some((u) => /models\/chord-ocr\/chord-ocr-hand\.onnx/.test(u)) && /\d+ chords/.test(line2), { line2 });
// correct the first box: tap it, type a chord, use it
const first = page.locator('button[title] > span').first(), before = await first.textContent();
await first.locator("..").click();
await page.getByPlaceholder("chord, e.g. Bb7").fill("Ebmaj7");
await page.getByRole("button", { name: "✓ Use" }).click();
ok("a tapped box can be corrected", (await page.locator('button[title] > span').first().textContent()) === "Ebmaj7", { before });
// the chart + an export
await page.getByRole("button", { name: /^CSMPN$/ }).first().click();
const txt = await page.locator("textarea, pre").evaluateAll((els) => els.map((e) => e.value || e.textContent).find((t) => /\|/.test(t) && /Title:/.test(t)) || "");
ok("the chart exports to CSMPN with the correction (spelled for the detected key: Eb or D#)", /(Eb|D#)maj7/.test(txt) && /\|/.test(txt), txt.split("\n").slice(0, 8));
await page.screenshot({ path: path.join(OUT, "scan.png"), fullPage: true });
ok("no horizontal overflow at 430 px", await page.evaluate(() => document.documentElement.scrollWidth <= 431));
ok("no console errors", app.errors().length === 0, app.errors());
console.log("screenshot:", path.join(OUT, "scan.png"));
await app.close();
process.exit(app.steps.every((s) => s.ok) ? 0 : 1);
