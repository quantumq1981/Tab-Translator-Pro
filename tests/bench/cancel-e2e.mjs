/* Audit 2026-11-18 m6 end to end (real app, headless Chromium):
 *   node bench/cancel-e2e.mjs --deps <dir>
 * Loads a rendered guitar line in the Audio panel, starts 🎸 Guitar → Tab (the real worker + model),
 * presses ✕ Cancel while it runs, and checks the job stops (worker ended, "Cancelled.", panel usable),
 * then runs it again to the end. */
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { startApp } from "./e2e-app.mjs";

// 12 s of plucked notes at 44.1 kHz, as a 16-bit WAV
const sr = 44100, n = sr * 12, x = new Float32Array(n);
[40, 45, 50, 55, 59, 64, 59, 55, 50, 45, 40, 47].forEach((m, k) => {
  const f = 440 * 2 ** ((m - 69) / 12), i0 = k * sr;
  for (let i = 0; i < sr * 0.9; i++) x[i0 + i] += 0.4 * Math.exp(-i / (sr * 0.35)) * (Math.sin(2 * Math.PI * f * i / sr) + 0.4 * Math.sin(4 * Math.PI * f * i / sr));
});
const wav = Buffer.alloc(44 + n * 2);
wav.write("RIFF", 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) wav.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(x[i] * 32767))), 44 + 2 * i);
const wavPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ttp-cancel-")), "guitar-line.wav");
fs.writeFileSync(wavPath, wav);

const app = await startApp();
const { page, ok } = app;
await page.evaluate(() => {
  const W = window.Worker; window.__workers = [];
  window.Worker = class extends W { constructor(u, o) { super(u, o); const rec = { url: String(u), ended: false }; window.__workers.push(rec); const t = this.terminate.bind(this); this.terminate = () => { rec.ended = true; t(); }; } };
});
await page.getByRole("button", { name: /^Audio/ }).first().click();
await page.locator('input[type="file"]').first().setInputFiles(wavPath);
await page.getByRole("button", { name: /Guitar → Tab/ }).first().waitFor({ timeout: 60000 });
await page.waitForTimeout(2500);
await page.getByRole("button", { name: /Guitar → Tab/ }).first().click();
await page.getByRole("button", { name: "✕ Cancel" }).first().waitFor({ timeout: 30000 });
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "✕ Cancel" }).first().click();
await page.getByText("Cancelled.").first().waitFor({ timeout: 15000 }).catch(() => {});
const after = await page.evaluate(() => window.__workers.filter((w) => /guitar-worker/.test(w.url)));
ok("✕ Cancel stops Guitar → Tab: the guitar worker is ended and the panel says Cancelled.", after.length === 1 && after[0].ended && /Cancelled\./.test(await page.locator("body").innerText()), after);
ok("the button is gone once the job stopped", (await page.getByRole("button", { name: "✕ Cancel" }).count()) === 0);
await page.getByRole("button", { name: /Guitar → Tab/ }).first().click();
await page.getByRole("button", { name: "✕ Cancel" }).first().waitFor({ timeout: 30000 }).catch(() => {});
await page.waitForFunction(() => !/Transcribing guitar/.test(document.body.innerText), null, { timeout: 300000 }).catch(() => {});
await page.waitForTimeout(1000);
const body = await page.locator("body").innerText();
if (process.env.DEBUG) console.log("--- after re-run:", body.split("\n").filter((l) => /guitar|Guitar|notes|Cancel|failed|⏳|TAB ·|bars/.test(l)).slice(0, 25).join("\n"));
const tabDone = await page.locator("[data-tab-view]").count();
ok("run again: it completes after a cancel (the guitar tab is drawn)", !/Guitar transcription failed/.test(body) && !/Cancelled\./.test(body) && !/Transcribing guitar/.test(body) && tabDone > 0, { tabDone });
const errs = app.errors();
ok("no console errors", errs.length === 0, errs.slice(0, 3));
const all = app.steps.every((s) => s.ok);
await app.close();
console.log(all ? "\nALL OK" : "\nSOME CHECKS FAILED");
process.exit(all ? 0 : 1);
