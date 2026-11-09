/* 🥁 Drums in the Audio panel (real app, headless Chromium) — the owner's case: a drum-only file
 * uploaded in Audio mode was read as CHORDS.
 *   node bench/drum-audio-e2e.mjs --deps <dir> --wav <drum take: .wav or .mp3> [--ua "<UA>"] [--out <dir>]
 * 1. Upload it as "track.<ext>" (Chords mode, the default): the chord decoder runs, then the app says
 *    the file sounds like drums → tap "🥁 Read it as drums" → the drum chart (model), no chord chart.
 * 2. Reload and upload it as "Song - Drums.wav": it opens straight in 🥁 Drums. */
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { startApp, arg } from "./e2e-app.mjs";
const OUT = arg("out", fs.mkdtempSync(path.join(os.tmpdir(), "ttp-drum-audio-")));
const WAV = arg("wav"); if (!WAV) { console.error("--wav <drum take> required"); process.exit(2); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ttp-drumfile-"));
const EXT = path.extname(WAV) || ".wav";
fs.copyFileSync(WAV, path.join(dir, "track" + EXT)); fs.copyFileSync(WAV, path.join(dir, "Song - Drums" + EXT));
const ua = arg("ua");
const app = await startApp(ua ? { context: { userAgent: ua } } : {}); const { page, ok } = app;
const net = []; page.on("request", (r) => net.push(r.url()));
const upload = async (file) => page.locator('label:has-text("Upload audio") input[type="file"]').first().setInputFiles(path.join(dir, file));
await page.getByRole("button", { name: "Audio 🎵" }).click();
// 1 — opened as chords
await upload("track" + EXT);
const banner = page.getByText("This sounds like a drum recording");
await banner.waitFor({ timeout: 240000 });
ok("a drum file opened as Chords gets the drum suggestion", true, (await banner.locator("..").textContent()).slice(0, 160));
await page.getByRole("button", { name: "🥁 Read it as drums" }).click();
const head = page.getByText(/^DRUMS · \d+ hits/);
await head.waitFor({ timeout: 300000 });
const nHits = +((await head.textContent()).match(/(\d+) hits/) || [])[1];
ok("the drum reader read it (no chord decode)", nHits > 50, await head.textContent());
ok("the drum model did the reading", /Read by the drum model/.test(await page.locator("body").textContent()) && net.some((u) => /oaf-drums\.onnx/.test(u)));
ok("no chord-only controls in Drums mode (chord names, isolate vocals, guitar tab)", (await page.getByText("Chord names:").count()) === 0 && (await page.getByRole("button", { name: /Isolate vocals/ }).count()) === 0 && (await page.getByRole("button", { name: /Guitar → Tab/ }).count()) === 0);
const rows = await page.locator("span").evaluateAll((els) => [...new Set(els.map((e) => (e.textContent.match(/^(C|R|O|H|S|T1|T2|FT|K) [x.]/) || [])[1]).filter(Boolean))]);
ok("the groove grid shows the kit", ["K", "S", "H"].every((r) => rows.includes(r)), rows);
ok("Tempo & bars is offered for the drum reading", (await page.getByText("TEMPO & BARS").count()) > 0);
await page.screenshot({ path: path.join(OUT, "drum-audio.png"), fullPage: true });
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "⬇ Drums MIDI" }).click()]);
const f = path.join(OUT, dl.suggestedFilename()); await dl.saveAs(f); const mid = fs.readFileSync(f);
const vel = new Set(); for (let i = 0; i + 2 < mid.length; i++) if (mid[i] === 0x99) vel.add(mid[i + 2]);
ok("the MIDI is named after the file and keeps velocities", /^track-drums\.mid$/.test(dl.suggestedFilename()) && vel.size >= 20, { file: dl.suggestedFilename(), distinctVelocities: vel.size });
// 2 — a drum-named file opens straight in Drums
await page.reload(); await page.waitForTimeout(400);
await page.getByRole("button", { name: "Audio 🎵" }).click();
await upload("Song - Drums" + EXT);
await page.getByText(/^DRUMS · \d+ hits/).waitFor({ timeout: 300000 });
ok("a file named like a drum stem opens in 🥁 Drums", (await page.getByText("This sounds like a drum recording").count()) === 0);
ok("no console errors", app.errors().length === 0, app.errors());
await app.close(); fs.rmSync(dir, { recursive: true, force: true });
process.exit(app.steps.every((s) => s.ok) ? 0 : 1);
