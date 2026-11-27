/* Scan with a DIGITAL score PDF (real app, headless Chromium): the text layer is read, not OCR'd.
 *   node bench/scan-pdf-e2e.mjs --deps <dir> --pdf <score.pdf> [--expect "Dm,C,Bb"] [--meter 3/4] [--section "Verse 1"]
 *     [--ocr]  also take the one-tap "Read with OCR instead" (needs cdn.jsdelivr.net for ONNX Runtime Web) and back
 * PDF.js 3.11.174 is served locally at the cdnjs URLs the app loads it from (the harness blocks cdnjs), the same
 * version as tests/node_modules/pdfjs-dist. Checks: the status says "text layer", no reader model was fetched, the
 * expected chords are on the page and in the chart, the PDF's title / tempo / meter / sections reach the chart, and
 * the CSMPN export carries them. Docs: docs/UG-PRO-PDF-CALIBRATION.md. */
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import { createRequire } from "node:module";
import { startApp, arg } from "./e2e-app.mjs";
const req = createRequire(path.join(path.dirname(new URL(import.meta.url).pathname), "../package.json"));
const PDF = arg("pdf"); if (!PDF) { console.error("--pdf <score.pdf> required"); process.exit(2); }
const want = (arg("expect", "") || "").split(",").filter(Boolean), meter = arg("meter", ""), section = arg("section", "");
const OUT = arg("out", fs.mkdtempSync(path.join(os.tmpdir(), "ttp-scanpdf-"))); fs.mkdirSync(OUT, { recursive: true });
const pdfjsDir = path.dirname(req.resolve("pdfjs-dist/build/pdf.min.js"));
const app = await startApp({ width: 430, height: 1100 }); const { page, ok } = app;
const js = (body) => ({ status: 200, headers: { "content-type": "text/javascript", "access-control-allow-origin": "*" }, body });
await page.context().route(/^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/3\.11\.174\/(pdf(?:\.worker)?\.min\.js)$/, (r) => {
  const f = r.request().url().match(/(pdf(?:\.worker)?\.min\.js)$/)[1]; r.fulfill(js(fs.readFileSync(path.join(pdfjsDir, f))));
});
const net = []; page.on("request", (r) => net.push(r.url()));
await page.reload(); await page.waitForTimeout(1500);
await page.getByRole("tab", { name: "Scan", exact: true }).click();
const t0 = Date.now();
await page.locator('input[type="file"]').first().setInputFiles(PDF);
const stat = page.getByText(/systems · \d+ bars · \d+ chords/);
await stat.waitFor({ timeout: 120000 });
const line = (await stat.textContent()) || "";
ok("the PDF is read from its text layer", /text layer/.test(line), { line: line.slice(0, 200), sec: ((Date.now() - t0) / 1000).toFixed(1) });
ok("no OCR model or runtime was fetched", !net.some((u) => /chord-ocr[^/]*\.onnx|onnxruntime/.test(u)), net.filter((u) => /onnx/.test(u)));
const labels = await page.locator('button[title] > span').evaluateAll((els) => els.map((e) => e.textContent));
ok("boxes on the page carry their reading", labels.length > 3, labels.slice(0, 12));
if (want.length) { const miss = want.filter((w) => !labels.includes(w)); ok(`expected chords on the page (${want.length - miss.length}/${want.length})`, !miss.length, miss); }
const nRows = await page.locator('input[type="checkbox"][aria-label^="select bar"]').count();
ok("every chord is in the review list, all certain", nRows > 0 && !(await page.getByText(/to check/).count()), { nRows });
// the chart + its export
const exp = page.getByRole("button", { name: /^CSMPN$/ }).first();
await exp.scrollIntoViewIfNeeded(); await exp.click();
const csmpn = (await page.locator("pre, textarea").filter({ hasText: "Title:" }).first().textContent()) || "";
fs.writeFileSync(path.join(OUT, "chart.csmpn"), csmpn);
const title = (line.match(/text layer/) && csmpn.match(/^Title: (.*)$/m) || [])[1];
ok("the chart is titled from the PDF", !!title && !/Scanned chart/.test(title), { title });
ok("the PDF's tempo reaches the chart", /^Tempo: \d+/m.test(csmpn), (csmpn.match(/^Tempo:.*$/m) || [""])[0]);
if (meter) {
  // CSMPN carries one Time: header; a mid-tune meter change is checked in the MusicXML export (a <time> per change)
  const [nb, nt] = meter.split("/");
  await page.getByRole("button", { name: /^MusicXML$/ }).first().click();
  const xml = (await page.locator("pre, textarea").filter({ hasText: "score-partwise" }).first().textContent()) || "";
  fs.writeFileSync(path.join(OUT, "chart.musicxml"), xml);
  ok(`the PDF's ${meter} reaches the chart (MusicXML <time>)`, xml.includes(`<beats>${nb}</beats><beat-type>${nt}</beat-type>`) || new RegExp(`<beats>${nb}</beats>\\s*<beat-type>${nt}</beat-type>`).test(xml), (xml.match(/<time>[\s\S]*?<\/time>/g) || []).slice(0, 3));
}
if (section) ok(`section "${section}" in the export`, csmpn.includes("- " + section), csmpn.split("\n").filter((l) => /^- /.test(l)).slice(0, 8));
await page.screenshot({ path: path.join(OUT, "scan-pdf.png"), fullPage: false });
if (process.argv.includes("--ocr")) {
  await page.getByRole("button", { name: "↻ Read with OCR instead" }).click();
  await page.getByText(/read as printed/).waitFor({ timeout: 240000 });
  ok("one tap reads the same pages with OCR", true);
  await page.getByRole("button", { name: "↻ Read the PDF's text" }).click();
  ok("and one tap back to the text layer", await page.getByText(/text layer/).first().isVisible());
}
ok("no console errors", app.errors().length === 0, app.errors());
await app.close();
console.log(`out: ${OUT}`);
if (app.steps.some((x) => !x.ok)) process.exit(1);
