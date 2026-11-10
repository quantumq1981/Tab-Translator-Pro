/* Scan 📷 (real app, headless Chromium): a picture of a lead sheet → chord chart.
 *   node bench/scan-e2e.mjs --deps <dir> --image <page.png|jpg> [--expect "Cm7,F7,…"] [--out <dir>]
 * Uploads the image in the Scan mode, waits for the worker (the real model on the pinned ONNX Runtime
 * 1.23.2 from jsDelivr), checks the boxes, the review list, a correction and the chart + CSMPN export.
 * (pdf.js comes from cdnjs, which the harness blocks — PDFs are not exercised here.) */
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { startApp, arg } from "./e2e-app.mjs";
const OUT = arg("out", fs.mkdtempSync(path.join(os.tmpdir(), "ttp-scan-")));
const IMG = arg("image"); if (!IMG) { console.error("--image <page> required"); process.exit(2); }
const want = (arg("expect", "") || "").split(",").filter(Boolean);
const app = await startApp({ width: 430, height: 1100 }); const { page, ok } = app;
const net = []; page.on("request", (r) => net.push(r.url()));
await page.getByRole("button", { name: "Scan 📷" }).click();
const t0 = Date.now();
await page.locator('input[type="file"]').first().setInputFiles(IMG);
const stat = page.getByText(/systems · \d+ bars · \d+ chords read/);
await stat.waitFor({ timeout: 240000 });
const line = await stat.textContent();
ok("the page is read (systems, bars, chords)", /\d+ chords read/.test(line), { line, sec: ((Date.now() - t0) / 1000).toFixed(1) });
ok("the model + pinned runtime were fetched, nothing else new", net.some((u) => /models\/chord-ocr\/chord-ocr\.onnx/.test(u)) && net.some((u) => /onnxruntime-web@1\.23\.2/.test(u)) && !net.some((u) => /onnxruntime-web@1\.(2[4-9]|3)/.test(u)));
const labels = await page.locator('button[title] > span').evaluateAll((els) => els.map((e) => e.textContent));
ok("boxes on the page carry their reading", labels.length > 3, labels.slice(0, 12));
if (want.length) { const hit = want.filter((w) => labels.includes(w)).length; ok(`expected chords found on the page (${hit}/${want.length})`, hit >= 0.9 * want.length, want.filter((w) => !labels.includes(w))); }
// correct the first box: tap it, type a chord, use it
const first = page.locator('button[title] > span').first(), before = await first.textContent();
await first.locator("..").click();
await page.getByPlaceholder("chord, e.g. Bb7").fill("Ebmaj7");
await page.getByRole("button", { name: "✓ Use" }).click();
ok("a tapped box can be corrected", (await page.locator('button[title] > span').first().textContent()) === "Ebmaj7", { before });
// the chart + an export
await page.getByRole("button", { name: /^CSMPN$/ }).first().click();
const txt = await page.locator("textarea, pre").evaluateAll((els) => els.map((e) => e.value || e.textContent).find((t) => /\|/.test(t) && /Title:/.test(t)) || "");
ok("the chart exports to CSMPN with the correction", /Ebmaj7/.test(txt) && /\|/.test(txt), txt.split("\n").slice(0, 8));
await page.screenshot({ path: path.join(OUT, "scan.png"), fullPage: true });
ok("no horizontal overflow at 430 px", await page.evaluate(() => document.documentElement.scrollWidth <= 431));
ok("no console errors", app.errors().length === 0, app.errors());
console.log("screenshot:", path.join(OUT, "scan.png"));
await app.close();
process.exit(app.steps.every((s) => s.ok) ? 0 : 1);
