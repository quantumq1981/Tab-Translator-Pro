/* U1 (handoff 2026-11-27): deleting the song that is OPEN from the Library must not bring it back — not on the next
 * edit of the open chart (its debounced project save re-put the record) and not on the next launch (the session
 * restore re-added the file). Opening the file again on purpose puts it back. Real app, headless Chromium:
 *   node bench/library-delete-e2e.mjs --deps <dir> [--out <dir>]
 */
import path from "node:path";
import { startApp, arg } from "./e2e-app.mjs";
const OUT = arg("out", process.cwd());
const openChartPanel = async (scope, which) => { const b = scope.getByRole("button", { name: which === "share" ? "⇪ Share" : /^⚙ Settings/ }).first(); if ((await b.getAttribute("aria-expanded")) !== "true") { await b.click(); await new Promise((r) => setTimeout(r, 200)); } };
const app = await startApp(); const { page, ok } = app;
const open = async (f) => { await page.locator('.tdp-nav button[data-dest="open"]').click(); await page.getByRole("tab", { name: "MusicXML / GP" }).click(); await page.locator('input[type="file"]').first().setInputFiles(path.resolve(app.repo, f)); await page.getByText(/bars ·/).first().waitFor({ timeout: 60000 }); await page.waitForTimeout(800); };
const lib = async () => { await page.locator('.tdp-nav button[data-dest="library"]').click(); await page.waitForTimeout(700); };
const titles = () => page.locator("section b").allInnerTexts();
const stored = () => page.evaluate(() => new Promise((res) => { const rq = indexedDB.open("ttp-projects"); rq.onsuccess = () => { const db = rq.result; const t = db.transaction("projects").objectStore("projects").getAll(); t.onsuccess = () => res(t.result.map((r) => r.title)); t.onerror = () => res(null); }; rq.onerror = () => res(null); }));

await open("Steely Dan - Peg.gp4");
await open("blue-sky.gp");                       // blue-sky is the OPEN song
await lib();
ok("both songs are in the library", (await titles()).includes("blue-sky") && (await titles()).includes("Steely Dan - Peg"), await titles());
const card = page.locator("section > div > div").filter({ has: page.locator("b", { hasText: "blue-sky" }) }).first();
await card.getByRole("button", { name: "delete" }).click(); await page.waitForTimeout(300);
await page.getByRole("button", { name: "Dismiss" }).last().click();   // ✕ on the toast commits the delete now
await page.waitForTimeout(1200);
ok("the delete is committed (gone from IndexedDB)", !(await stored()).includes("blue-sky"), await stored());
// an edit to the still-open chart (a key) runs the debounced project save
await page.locator('.tdp-nav button[data-dest="chart"]').click(); await page.waitForTimeout(600);
await openChartPanel(page, "settings");
await page.locator("select").filter({ has: page.locator("option", { hasText: /^Key: auto/ }) }).first().selectOption({ index: 2 });
await page.waitForTimeout(1500);
ok("editing the open chart doesn't put it back", !(await stored()).includes("blue-sky"), await stored());
await page.reload(); await page.getByText(/bars ·/).first().waitFor({ timeout: 60000 }); await page.waitForTimeout(1500);
ok("the chart itself is still restored after a reload", /blue-sky/.test(await page.locator("body").innerText()));
await lib();
ok("…and the library still doesn't have it", !(await titles()).includes("blue-sky") && (await titles()).includes("Steely Dan - Peg"), await titles());
await page.reload(); await page.waitForTimeout(2500); await lib();
ok("…nor after a second launch", !(await stored()).includes("blue-sky"), await stored());
await open("blue-sky.gp");                        // opened again on purpose → back in the library
await lib();
ok("opening the file again puts it back", (await titles()).includes("blue-sky"), await titles());
await page.screenshot({ path: path.join(OUT, "library-delete.png"), fullPage: true });
ok("no console errors", app.errors().length === 0, app.errors());
await app.close();
process.exit(app.steps.every((s) => s.ok) ? 0 : 1);
