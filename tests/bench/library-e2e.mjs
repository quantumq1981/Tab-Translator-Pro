/* WO-6 library / setlists / bundles / print end to end (real app, headless Chromium):
 *   node bench/library-e2e.mjs --deps <dir> [--out <dir>]
 */
import fs from "node:fs"; import path from "node:path";
import { createRequire } from "node:module";
import { startApp, arg } from "./e2e-app.mjs";
const OUT = arg("out", process.cwd());
const require = createRequire(import.meta.url);
const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
const pdfText = async (buf) => { const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise; let t = ""; for (let i = 1; i <= doc.numPages; i++) t += (await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(" ") + "\n"; return { pages: doc.numPages, text: t }; };
const app = await startApp(); const { page, ok } = app;
const answers = [];
page.on("dialog", (d) => { const a = answers.shift(); if (d.type() === "prompt") d.accept(a != null ? a : d.defaultValue()); else d.accept(); });
const open = async (f) => { await page.getByRole("button", { name: "MusicXML / GP" }).click(); await page.locator('input[type="file"]').first().setInputFiles(path.resolve(app.repo, f)); await page.getByText(/bars ·/).first().waitFor({ timeout: 60000 }); await page.waitForTimeout(800); };
const lib = async () => { await page.getByRole("button", { name: "Library 📚" }).click(); await page.waitForTimeout(600); };
await open("blue-sky.gp");
await open("Steely Dan - Peg.gp4");
// a chord override on Peg (✎ Edit → first chord → "Gmaj9")
await page.getByRole("button", { name: "✎ Edit" }).click();
await page.locator('button[title*="guitar voicings"], [title^="tap to relabel"]').first().click().catch(() => {});
await lib();
const titles = await page.locator("section b").allInnerTexts();
ok("both opened files are in the library", titles.includes("blue-sky") && titles.includes("Steely Dan - Peg"), titles);
await page.getByPlaceholder(/search title/).fill("peg");
ok("search narrows to the match", (await page.getByRole("button", { name: "Open", exact: true }).count()) === 1);
await page.getByPlaceholder(/search title/).fill("");
// setlist: Friday = [Peg (+2), Blue Sky]
answers.push("Friday"); await page.getByRole("button", { name: "＋ New setlist" }).click(); await page.waitForTimeout(400);
for (const t of ["Steely Dan - Peg", "blue-sky"]) { const card = page.locator("section > div > div").filter({ has: page.locator("b", { hasText: t }) }).first(); await card.locator("select").selectOption({ label: "Friday" }); await page.waitForTimeout(300); }
const setBox = page.locator("div").filter({ has: page.locator("b", { hasText: /^Friday$/ }) }).filter({ has: page.getByText("transpose").first() }).last();
await setBox.getByRole("button", { name: "+", exact: true }).first().click(); await page.waitForTimeout(200);
await setBox.getByRole("button", { name: "+", exact: true }).first().click(); await page.waitForTimeout(300);
ok("setlist: two songs, the first transposed +2", (await setBox.getByText(/^\+2$/).count()) === 1 && (await setBox.getByText(/^\d\.$/).count()) === 2);
await setBox.getByRole("button", { name: "▶ Play set" }).click();
await page.getByText(/^▶ Friday$/).waitFor({ timeout: 30000 }); await page.getByText(/bars ·/).first().waitFor({ timeout: 60000 }); await page.waitForTimeout(800);
ok("Play set opens song 1 transposed +2", (await page.getByText(/\+2 st/).count()) >= 1 && /Peg/.test(await page.locator("body").innerText()));
await page.getByRole("button", { name: "Next ▶" }).click(); await page.waitForTimeout(2500);
ok("Next ▶ opens song 2 untransposed", /2 \/ 2/.test(await page.locator("body").innerText()) && /blue-sky/.test(await page.locator("body").innerText()) && (await page.getByText(/\+2 st/).count()) === 0);
// print the chart → PDF
await page.evaluate(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
await page.getByRole("button", { name: "🖨 Print / PDF" }).click(); await page.waitForTimeout(1500);
await page.emulateMedia({ media: "print" });
const pdf1 = await page.pdf({ format: "A4", preferCSSPageSize: true });
const t1 = await pdfText(pdf1); fs.writeFileSync(path.join(OUT, "print-chart.pdf"), pdf1);
ok("print: the chart prints with its header and chords (no app chrome)", t1.pages >= 2 && /blue-sky/.test(t1.text) && /\bE\b/.test(t1.text) && !/Upload a MusicXML/.test(t1.text) && !/Practice/.test(t1.text), { pages: t1.pages, head: t1.text.slice(0, 120) });
await page.emulateMedia({ media: "screen" }); await page.evaluate(() => { document.body.classList.remove("tdp-printing"); window.dispatchEvent(new Event("afterprint")); });
await page.getByRole("button", { name: "Tab", exact: true }).first().click();
await page.locator("[data-tab-view]").getByText(/bars drawn/).waitFor({ timeout: 120000 });
await page.getByRole("button", { name: "🖨 Print / PDF" }).click(); await page.waitForTimeout(1500);
await page.emulateMedia({ media: "print" });
const pdf2 = await page.pdf({ format: "A4", preferCSSPageSize: true }); fs.writeFileSync(path.join(OUT, "print-tab.pdf"), pdf2);
const t2 = await pdfText(pdf2);
ok("print: the 165-bar tab runs over many pages (not clipped to the screen box)", t2.pages >= 5, t2.pages);
await page.emulateMedia({ media: "screen" }); await page.evaluate(() => { document.body.classList.remove("tdp-printing"); window.dispatchEvent(new Event("afterprint")); });
// bundle → delete → import
await lib();
const card = page.locator("section > div > div").filter({ has: page.locator("b", { hasText: "Steely Dan - Peg" }) }).first();
const [dl] = await Promise.all([page.waitForEvent("download"), card.getByRole("button", { name: "⬇ bundle" }).click()]);
const bpath = path.join(OUT, dl.suggestedFilename()); await dl.saveAs(bpath);
await card.getByRole("button", { name: "delete" }).click(); await page.waitForTimeout(800);
ok("delete removes the project", !(await page.locator("section b").allInnerTexts()).includes("Steely Dan - Peg"));
await page.locator('section input[type="file"]').first().setInputFiles(bpath); await page.waitForTimeout(1200);
ok("the bundle imports back", (await page.locator("section b").allInnerTexts()).includes("Steely Dan - Peg") && /\.ttp\.zip$/.test(bpath));
// persistence across reload
await page.reload(); await page.waitForTimeout(800); await lib();
const after = await page.locator("section b").allInnerTexts();
ok("the library survives a reload (IndexedDB)", after.includes("Steely Dan - Peg") && after.includes("blue-sky") && after.includes("Friday"), after);
await page.screenshot({ path: path.join(OUT, "library.png"), fullPage: true });
ok("no console errors", app.errors().length === 0, app.errors());
await app.close();
process.exit(app.steps.every((s) => s.ok) ? 0 : 1);
