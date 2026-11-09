/* The drum model in the REAL app (headless Chromium) — WPO-ADT-001 Phase 1:
 *   node bench/drum-model-e2e.mjs --deps <dir> --wav <E-GMD drum take.wav> [--ua "<UA>"] [--out <dir>]
 * Imports the take as "song - drums.wav" (+ a quiet chord stem) via 📂 Import stems, charts the stems,
 * and checks: the drum model ran (its worker, the pinned ORT 1.23.2 plain WASM, the same-origin model —
 * nothing else), the groove grid shows the model's toms / ride rows, the MIDI download carries spread
 * velocities, no console errors; then the toggle off brings back the built-in reading.
 * Accuracy itself is measured in Node on the same engine: bench/adt.mjs --variant onnx. */
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { startApp, arg } from "./e2e-app.mjs";
import { readWav } from "./adt-metrics.mjs";
const OUT = arg("out", fs.mkdtempSync(path.join(os.tmpdir(), "ttp-drum-e2e-")));
const WAV = arg("wav"); if (!WAV) { console.error("--wav <drum take> required"); process.exit(2); }
const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const engPath = path.join(repo, "tests", ".engine.drum-model-e2e.mjs"); fs.writeFileSync(engPath, fs.readFileSync(path.join(repo, "engine.tsx"), "utf8"));
const eng = await import(engPath);
const { x, sr } = readWav(fs.readFileSync(WAV));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ttp-drumstems-"));
fs.writeFileSync(path.join(dir, "song - drums.wav"), eng.encodeWav16([x], sr));
const other = new Float32Array(x.length);
for (let i = 0; i < other.length; i++) { const t = i / sr, ch = [[261.6, 329.6, 392], [196, 246.9, 293.7]][Math.floor(t / 2.5) % 2]; other[i] = 0.06 * ch.reduce((a, f) => a + Math.sin(2 * Math.PI * f * t), 0); }
fs.writeFileSync(path.join(dir, "song - other.wav"), eng.encodeWav16([other], sr));

const ua = arg("ua");
const app = await startApp(ua ? { context: { userAgent: ua } } : {}); const { page, ok } = app;
const net = [];
page.on("request", (r) => net.push(r.url()));
await page.getByRole("button", { name: "Audio 🎵" }).click();
const t0 = Date.now();
await page.locator('label:has-text("Import stems") input[type="file"]').setInputFiles([path.join(dir, "song - drums.wav"), path.join(dir, "song - other.wav")]);
await page.getByRole("button", { name: "♫ Chart these stems" }).click({ timeout: 60000 });
const note = page.getByText(/Drum model: \d+ hits/).first();
await page.getByRole("button", { name: /^Drums$/ }).last().click({ timeout: 240000 }).catch(() => {});
await note.waitFor({ timeout: 300000 });
const secs = (Date.now() - t0) / 1000;
const noteText = await note.textContent();
const nHits = +(noteText.match(/Drum model: (\d+) hits/) || [])[1];
ok("the drum model read the drums stem", nHits > 50, noteText.slice(0, 200));
const local = net.filter((u) => /127\.0\.0\.1/.test(u)).map((u) => new URL(u).pathname);
const remote = [...new Set(net.filter((u) => !/127\.0\.0\.1|esm\.sh\/(__e2e|react)|unpkg\.com\/@babel|fonts\.g|cdnjs/.test(u)))];
const published = await page.evaluate(() => typeof window.TTP_DRUM_MODEL);   // drum-model.js loads at boot, before the listener
ok("glue + model loaded same-origin (worker, core, model fetched on use)", published === "function" && ["/drum-worker.js", "/drum-model-core.js", "/models/oaf-drums/oaf-drums.onnx"].every((p) => local.includes(p)), local.filter((p) => /drum|oaf/.test(p)));
ok("only ONNX Runtime Web 1.23.2's plain build from the network", remote.length > 0 && remote.every((u) => /cdn\.jsdelivr\.net\/npm\/onnxruntime-web@1\.23\.2\/dist\/ort(-wasm-simd-threaded)?\.(wasm\.min\.mjs|mjs|wasm)$/.test(u)), remote);
const rows = await page.locator("span").evaluateAll((els) => [...new Set(els.map((e) => (e.textContent.match(/^(C|R|O|H|S|T1|T2|FT|K) [x.]/) || [])[1]).filter(Boolean))]);
ok("the groove grid shows the model's toms and cymbals next to kick / snare / hat", ["K", "S", "H", "T2"].every((r) => rows.includes(r)) && (rows.includes("R") || rows.includes("C")), rows);
await page.screenshot({ path: path.join(OUT, "drum-model-grid.png") });
const save = async (name) => { const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name }).click()]); const f = path.join(OUT, dl.suggestedFilename()); await dl.saveAs(f); return fs.readFileSync(f); };
const mid = await save("⬇ Drums MIDI");
const ons = []; for (let i = 0; i + 2 < mid.length; i++) if (mid[i] === 0x99) ons.push([mid[i + 1], mid[i + 2]]);
const vels = new Set(ons.map(([, v]) => v)), notes = new Set(ons.map(([n]) => n));
ok("the MIDI keeps the model's velocities (many distinct values) and its kit pieces", ons.length > 50 && vels.size >= 20 && notes.has(36) && notes.has(38) && notes.has(47), { notes: ons.length, distinctVelocities: vels.size, gm: [...notes].sort((a, b) => a - b) });
const xml = (await save("⬇ Drum notation (MusicXML)")).toString("utf8");
ok("drum MusicXML has the toms", /<sign>percussion<\/sign>/.test(xml) && /Mid Tom/.test(xml));
// toggle the model off → re-chart with the built-in reading
await page.getByRole("button", { name: "🥁 drum model ✓" }).click();
await page.getByRole("button", { name: "full kit" }).first().waitFor({ timeout: 240000 });
const noteGone = await page.getByText(/Drum model: \d+ hits/).count();
ok("toggling the model off re-charts with the built-in reading", noteGone === 0);
let stored = null; try { stored = await page.evaluate(() => localStorage.getItem("ttp:drumModel")); } catch (_) {}
ok("the choice is remembered per device", stored === "0", stored);
ok("no console errors", app.errors().length === 0, app.errors());
console.log(JSON.stringify({ seconds: +secs.toFixed(1), audioSeconds: +(x.length / sr).toFixed(1), hits: nHits, out: OUT }));
await app.close(); fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(engPath, { force: true });
process.exit(app.steps.every((s) => s.ok) ? 0 : 1);
