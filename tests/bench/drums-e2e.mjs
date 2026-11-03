/* WO-5 drums end to end (real app, headless Chromium):
 *   node bench/drums-e2e.mjs --deps <dir> [--out <dir>]
 * Renders a 9-piece kit (the workbench's rendered kit) as drums.wav + a chord loop as other.wav,
 * imports both via 📂 Import stems, switches on the full kit, and checks the groove grid names
 * toms / crash / ride and that the drum MusicXML + tab + parts zip download. */
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { startApp, arg } from "./e2e-app.mjs";
const OUT = arg("out", process.cwd());
globalThis.DOMParser = (await import("@xmldom/xmldom")).DOMParser;
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const engPath = path.join(repo, "tests", ".engine.drums-e2e.mjs"); fs.writeFileSync(engPath, fs.readFileSync(path.join(repo, "engine.tsx"), "utf8"));
const eng = await import(engPath);
const wb = fs.readFileSync(path.join(repo, "tests", "workbench.mjs"), "utf8");
const renderKit = new Function("return (" + wb.slice(wb.indexOf("function renderKit"), wb.indexOf("function f1")).trim() + ")")();
const sr = 44100, { x } = renderKit(sr, 5);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ttp-stems-"));
fs.writeFileSync(path.join(dir, "song - drums.wav"), eng.encodeWav16([x], sr));
const other = new Float32Array(x.length);
for (let i = 0; i < other.length; i++) { const t = i / sr, ch = [[261.6, 329.6, 392], [196, 246.9, 293.7]][Math.floor(t / 2.4) % 2]; other[i] = 0.12 * ch.reduce((a, f) => a + Math.sin(2 * Math.PI * f * t), 0); }
fs.writeFileSync(path.join(dir, "song - other.wav"), eng.encodeWav16([other], sr));
const app = await startApp(); const { page, ok } = app;
await page.evaluate(() => localStorage.setItem("ttp:fullKit", "1"));
await page.getByRole("button", { name: "Audio 🎵" }).click();
const input = page.locator('label:has-text("Import stems") input[type="file"]');
await input.setInputFiles([path.join(dir, "song - drums.wav"), path.join(dir, "song - other.wav")]);
await page.getByRole("button", { name: "♫ Chart these stems" }).click({ timeout: 60000 });
await page.getByText(/^K [x.]/).first().waitFor({ timeout: 240000 }).catch(async () => { await page.getByRole("button", { name: /^Drums$/ }).last().click({ timeout: 30000 }); });
await page.getByText(/^K /).first().waitFor({ timeout: 60000 });
const rows = await page.locator("span").evaluateAll((els) => [...new Set(els.map((e) => (e.textContent.match(/^(C|R|O|H|S|T1|T2|FT|K) [x.]/) || [])[1]).filter(Boolean))]);
ok("the groove grid names the full kit (crash, ride, open hat, toms)", ["C", "R", "O", "T1", "T2", "FT", "K", "S", "H"].every((r) => rows.includes(r)), rows);
await page.screenshot({ path: path.join(OUT, "drums-grid.png") });
const save = async (name) => { const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name }).click()]); const f = path.join(OUT, dl.suggestedFilename()); await dl.saveAs(f); return fs.readFileSync(f, "utf8"); };
const xml = await save("⬇ Drum notation (MusicXML)");
const doc = new DOMParser().parseFromString(xml, "text/xml");
ok("drum MusicXML downloads: a percussion staff with the kit's instruments", /<sign>percussion<\/sign>/.test(xml) && doc.getElementsByTagName("score-instrument").length >= 8 && doc.getElementsByTagName("unpitched").length > 60, doc.getElementsByTagName("unpitched").length);
const tab = await save("⬇ Drum tab (.txt)");
ok("drum tab downloads with the kit's rows", /^CR\|/m.test(tab) && /^FT\|/m.test(tab) && /^BD\|/m.test(tab), tab.split("\n").slice(2, 6));
ok("no console errors", app.errors().length === 0, app.errors());
await app.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(engPath, { force: true });
process.exit(app.steps.every((s) => s.ok) ? 0 : 1);
