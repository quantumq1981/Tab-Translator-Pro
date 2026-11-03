/* WO-7 techniques end to end: the REAL app + REAL guitar CRNN (25 MB, same-origin) + pinned ONNX
 * Runtime 1.23.2 (jsDelivr). A rendered single-line guitar phrase with known techniques (the
 * workbench's renderLine, at 44.1 kHz) → Audio mode → 🎸 Guitar → Tab (ML) → the technique badges
 * and the AlphaTex export.   node bench/techniques-e2e.mjs --deps <dir> [--out <dir>] */
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { startApp, arg } from "./e2e-app.mjs";
const OUT = arg("out", process.cwd());
globalThis.DOMParser = (await import("@xmldom/xmldom")).DOMParser;
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const engPath = path.join(repo, "tests", ".engine.tech-e2e.mjs"); fs.writeFileSync(engPath, fs.readFileSync(path.join(repo, "engine.tsx"), "utf8"));
const eng = await import(engPath);
const wb = fs.readFileSync(path.join(repo, "tests", "workbench.mjs"), "utf8");
const renderLine = new Function("return (" + wb.slice(wb.indexOf("function renderLine"), wb.indexOf("{\n  for (const [sr, snr] of")).trim() + ")")();
const { x } = renderLine(44100);
const wav = path.join(os.tmpdir(), `ttp-line-${process.pid}.wav`); fs.writeFileSync(wav, eng.encodeWav16([x], 44100));
const app = await startApp(); const { page, ok } = app;
await page.getByRole("button", { name: "Audio 🎵" }).click();
await page.locator('input[type="file"]:not([multiple])').first().setInputFiles(wav);
const btn = page.getByRole("button", { name: "🎸 Guitar → Tab (ML)" });
await btn.waitFor({ timeout: 120000 });
await page.waitForFunction(() => !document.body.innerText.includes("⏳ Analyzing"), null, { timeout: 300000 });
const t0 = Date.now(); await btn.click();
await page.getByText(/notes from the guitar model/).waitFor({ timeout: 900000 });
await page.getByText(/reading techniques/).waitFor({ state: "detached", timeout: 120000 }).catch(() => {});
await page.waitForTimeout(800);
const notesLine = await page.getByText(/notes from the guitar model/).innerText();
const badges = await page.locator("span").evaluateAll((els) => els.map((e) => e.textContent.trim()).filter((t) => /^\d+ (bend|vibrato|slide|hammer\/pull|palm mute|ghost)s?$/.test(t)));
ok("the guitar model transcribes the phrase and the technique reader names what it hears", badges.length >= 3, { notes: notesLine.slice(0, 40), badges, sec: (Date.now() - t0) / 1000 });
const panel = page.locator("div").filter({ has: page.getByText(/notes from the guitar model/) }).last();
await page.getByRole("button", { name: "AlphaTex (tab)" }).first().click();       // the guitar tab chart renders before the chord chart
await page.locator("textarea[readonly]").first().waitFor({ timeout: 30000 });
const tex = await page.locator("textarea[readonly]").first().inputValue();
const marks = { bend: /b \(0 \d\)/.test(tex), hammer: /\{[^}]*\bh\b/.test(tex), slide: /\bsl\b/.test(tex), palmMute: /\bpm\b/.test(tex), vibrato: /\bv\b/.test(tex) };
ok("the AlphaTex tab carries the techniques", Object.values(marks).filter(Boolean).length >= 3, marks);
await page.screenshot({ path: path.join(OUT, "techniques.png"), fullPage: false });
ok("no console errors", app.errors().length === 0, app.errors());
await app.close(); fs.rmSync(wav, { force: true }); fs.rmSync(engPath, { force: true });
process.exit(app.steps.every((s) => s.ok) ? 0 : 1);
