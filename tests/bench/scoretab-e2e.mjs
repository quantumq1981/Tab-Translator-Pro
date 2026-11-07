/* Guitar → Tab with a linked score + stems vs the score, end to end in the REAL app (headless
 * Chromium, phone width): the real guitar worker + 25 MB model + ONNX Runtime 1.23.2, the real
 * stems panel. Flow: MusicXML/GP panel → upload the score → 🎧 Link a recording → upload the clip →
 * 🎸 Guitar → Tab (ML) → "TAB FROM THE SCORE" (fingering from the score, differences by bar, the
 * AlphaTex export parsed by alphaTab) → Tab follows: Score → 📂 Import stems → "STEMS VS THE SCORE".
 *
 *   node bench/scoretab-e2e.mjs --deps <dir> --score <file.gp> --audio <clip.mp3> --stems <dir of stem wavs> [--out <dir>]
 * Dev-only. */
import fs from "node:fs"; import path from "node:path";
import { startApp, arg } from "./e2e-app.mjs";

const SCORE = arg("score"), AUDIO = arg("audio"), STEMS = arg("stems"), OUT = arg("out", process.cwd());
if (!SCORE || !AUDIO || !STEMS) { console.error("--score --audio --stems are required"); process.exit(2); }
const alphaTab = await import("@coderline/alphatab");
const app = await startApp({ width: +arg("width", 390), height: +arg("height", 844), context: { hasTouch: true } });
const { page, ok } = app;
const t0 = Date.now();
const text = () => page.locator("body").innerText();

await page.getByRole("button", { name: "MusicXML / GP" }).click({ timeout: 60000 });
await page.locator('input[type="file"]').first().setInputFiles(SCORE);
await page.getByRole("button", { name: /Link a recording/ }).click({ timeout: 60000 });
await page.getByText(/upload the recording above to link it/).waitFor({ timeout: 60000 });
await page.locator("label", { hasText: "Upload audio" }).locator('input[type="file"]').setInputFiles(AUDIO);
await page.getByText(/linked — score bars/).waitFor({ timeout: 300000 });
ok("score linked to the clip", true);

await page.getByRole("button", { name: "🎸 Guitar → Tab (ML)" }).click();
await page.getByText("TAB FROM THE SCORE").waitFor({ timeout: 900000 });
let body = await text();
const m = body.match(/: (\d+) of (\d+) score notes heard/);
ok("TAB FROM THE SCORE: score notes heard reported", !!m && +m[2] > 0, m && m[0]);
ok("the tab chart's fingering comes from the score", /fingering from the score/.test(body) && /bars \(the score's\)/.test(body));
const chips = await page.getByRole("button", { name: /^▶ \d+/ }).count();
ok("differences listed by bar (tap to listen)", chips > 0 || /not heard/.test(body), chips);
// the tab chart's AlphaTex export (scoped to the panel that says "fingering from the score")
const tabPanel = page.locator("div").filter({ hasText: /fingering from the score/ }).filter({ has: page.getByRole("button", { name: "AlphaTex (tab)" }) }).last();
await tabPanel.getByRole("button", { name: "AlphaTex (tab)" }).first().click();
const tex = await tabPanel.locator("textarea, pre").last().evaluate((el) => el.value || el.textContent);
const imp = new alphaTab.importer.AlphaTexImporter(); imp.initFromString(tex, new alphaTab.Settings());
const sc = imp.readScore(); let notes = 0; for (const mb of sc.tracks[0].staves[0].bars) for (const v of mb.voices) for (const b of v.beats) notes += b.notes.length;
ok("AlphaTex export parses in alphaTab, every note on a string", notes > 0 && sc.tracks[0].staves[0].bars.length > 0, { bars: sc.tracks[0].staves[0].bars.length, notes });
await page.screenshot({ path: path.join(OUT, "scoretab-e2e-tab.png") });

await page.locator('button[title^="the score\'s notes on the recording"]').click();
await page.waitForTimeout(600);
body = await text();
ok("Tab follows: Score — extra notes left out, missed notes written in", /left out/.test(body) && /written in from the score/.test(body));

const wavs = fs.readdirSync(STEMS).filter((f) => /\.wav$/i.test(f)).map((f) => path.join(STEMS, f));
await page.locator('input[type="file"][multiple]').setInputFiles(wavs);
await page.getByText(/STEMS VS THE SCORE/).waitFor({ timeout: 600000 });
body = await text();
const rows = (body.match(/STEMS VS THE SCORE[\s\S]*?(?=TEMPO & BARS)/) || [""])[0];
console.log(rows.trim());
ok("bass stem ↔ the score's bass part, with an agreement", /Bass ↔ Electric Bass[^\n]*\d+%/.test(rows));
ok("guitar/keys stem ↔ both guitar parts", /↔ Electric Guitar \(jazz\) \+ Acoustic Guitar \(nylon\)/.test(rows));
ok("vocals stem: no matching part in the score", /Vocals — no matching part in the score/.test(rows));
ok("stem tabs carry the score part names", (await page.getByRole("button", { name: /Bass · Electric Bass/ }).count()) > 0);
await page.screenshot({ path: path.join(OUT, "scoretab-e2e-stems.png") });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok("no horizontal overflow at 390 px", overflow <= 1, overflow);
ok("no console errors", app.errors().length === 0, app.errors().slice(0, 5));
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
await app.close();
process.exit(app.steps.every((s) => s.ok) ? 0 : 1);
