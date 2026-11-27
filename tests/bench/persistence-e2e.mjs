/* Audit 2026-11-18 C2 / M1 / M2.3 end to end (real app, headless Chromium):
 *   node bench/persistence-e2e.mjs --deps <dir>
 * Two browsers in one run:
 *   · Safari / iOS 15.2–18.x — FileSystemFileHandle.prototype.createWritable removed by an init
 *     script, so OPFS can be listed and opened but not written (what those engines ship);
 *   · Chromium as it is (full OPFS, i.e. Safari 26-like).
 * Checks: a file opened and reloaded restores with its edit; no zero-length OPFS file appears; a
 * library left behind by the old code (empty session.bin + bytes in localStorage) still restores;
 * a restore that never finished asks instead of looping; "Restore anyway" then opens it. */
import { startApp } from "./e2e-app.mjs";

const NO_WRITABLE = `try { if (typeof FileSystemFileHandle !== "undefined") delete FileSystemFileHandle.prototype.createWritable; } catch (_) {}`;
const opfsState = (page) => page.evaluate(async () => {
  const out = { files: {}, ls: Object.keys(localStorage).filter((k) => k.startsWith("ttp:")) };
  try {
    const root = await navigator.storage.getDirectory();
    for await (const [n, h] of root.entries()) {
      if (h.kind === "file") out.files[n] = (await h.getFile()).size;
      else for await (const [m, g] of h.entries()) if (g.kind === "file") out.files[n + "/" + m] = (await g.getFile()).size;
    }
  } catch (e) { out.err = String(e); }
  out.idbSession = await new Promise((res) => {
    const r = indexedDB.open("ttp-projects", 1);
    r.onsuccess = () => { try { const t = r.result.transaction("files", "readonly").objectStore("files").get("__session__"); t.onsuccess = () => res(t.result ? t.result.byteLength : 0); t.onerror = () => res(-1); } catch (_) { res(-2); } };
    r.onerror = () => res(-3);
  });
  return out;
});
const openScore = async (page, repo, f) => {
  await page.getByRole("tab", { name: "MusicXML / GP" }).click();
  await page.locator('input[type="file"]').first().setInputFiles(`${repo}/${f}`);
  await page.getByText(/bars ·/).first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
};
const reload = async (page) => { await page.reload(); await page.waitForTimeout(600); };
const setKey = async (page, k) => { const sel = page.locator("select").filter({ has: page.locator("option", { hasText: /^Key: auto/ }) }).first(); await sel.selectOption({ value: k }); await page.waitForTimeout(900); };

let allOk = true;
for (const mode of ["safari18", "chromium"]) {
  console.log(`\n=== ${mode} ===`);
  const app = await startApp();
  const { page, ctx, ok, repo } = app;
  if (mode === "safari18") { await ctx.addInitScript(NO_WRITABLE); await reload(page); }
  ok(`${mode}: createWritable ${mode === "safari18" ? "absent" : "present"}`, (await page.evaluate(() => typeof FileSystemFileHandle !== "undefined" && typeof FileSystemFileHandle.prototype.createWritable === "function")) === (mode !== "safari18"));

  await openScore(page, repo, "Steely Dan - Peg.gp4");
  await setKey(page, "G");
  let st = await opfsState(page);
  const meta = await page.evaluate(() => JSON.parse(localStorage.getItem("ttp:session:v1") || "null"));
  ok(`${mode}: the metadata carries the stored bytes' size + hash`, meta && meta.file && meta.file.size > 0 && /^sha256:/.test(meta.file.hash) && meta.keyOverride === "G", meta && { file: meta.file, key: meta.keyOverride });
  ok(`${mode}: no zero-length OPFS file anywhere`, !Object.values(st.files).some((n) => n === 0), st.files);
  if (mode === "safari18") ok("safari18: the bytes went to IndexedDB, not the shared localStorage", st.idbSession > 0 && !st.ls.includes("ttp:session:bin:v1"), st);
  else ok("chromium: the bytes went to OPFS only", st.files["session.bin"] > 0 && st.idbSession === 0 && !st.ls.includes("ttp:session:bin:v1"), st);

  await reload(page);
  await page.getByText(/bars ·/).first().waitFor({ timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(800);
  const body = await page.locator("body").innerText();
  ok(`${mode}: reload restores the chart with its key correction`, /Restored your last session/.test(body) && /Peg/.test(body) && /key G \(set\)/.test(body), body.match(/key [^\n]{0,20}/));

  // the restore marker: a launch after a restore that never finished asks first
  await page.evaluate(() => localStorage.setItem("ttp:restore:inflight", JSON.stringify({ filename: "Steely Dan - Peg.gp4", at: Date.now() })));
  await reload(page); await page.waitForTimeout(1500);
  const asked = await page.locator("body").innerText();
  ok(`${mode}: a leftover in-flight marker → asks, does not auto-restore`, /didn’t finish opening/.test(asked) && !/Restored your last session/.test(asked) && !/bars ·/.test(asked));
  await page.getByRole("button", { name: "Restore anyway" }).click();
  await page.getByText(/bars ·/).first().waitFor({ timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(800);
  ok(`${mode}: Restore anyway opens it and clears the marker`, /Peg/.test(await page.locator("body").innerText()) && (await page.evaluate(() => localStorage.getItem("ttp:restore:inflight"))) === null);

  if (mode === "safari18") {
    // what the OLD code left on these devices: an empty session.bin and the real bytes in localStorage
    await page.evaluate(async () => {
      const r = await fetch("/blue-sky.gp"), u = new Uint8Array(await r.arrayBuffer());
      let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      localStorage.setItem("ttp:session:bin:v1", btoa(s));
      localStorage.setItem("ttp:session:v1", JSON.stringify({ v: 1, kind: "xml", filename: "blue-sky.gp", useSharp: true, overrides: {}, partIndex: 0 }));
      const root = await navigator.storage.getDirectory(); await root.getFileHandle("session.bin", { create: true }); // the stray empty file
      await new Promise((res) => { const q = indexedDB.open("ttp-projects", 1); q.onsuccess = () => { const t = q.result.transaction("files", "readwrite"); t.objectStore("files").delete("__session__"); t.oncomplete = res; t.onerror = res; }; q.onerror = res; });
    });
    st = await opfsState(page);
    ok("safari18: set up the old code's leftovers (empty session.bin)", st.files["session.bin"] === 0, st.files);
    await reload(page);
    await page.getByText(/bars ·/).first().waitFor({ timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const b2 = await page.locator("body").innerText();
    ok("safari18: an old session restores from localStorage (it used to read 0 bytes)", /blue-sky/.test(b2) && /165 bars/.test(b2), b2.match(/\d+ bars/));
    st = await opfsState(page);
    ok("safari18: the stray empty session.bin was swept", st.files["session.bin"] === undefined, st.files);
  }
  const errs = app.errors();
  ok(`${mode}: no console errors`, errs.length === 0, errs.slice(0, 3));
  allOk = allOk && app.steps.every((s) => s.ok);
  await app.close();
}
console.log(allOk ? "\nALL OK" : "\nSOME CHECKS FAILED");
process.exit(allOk ? 0 : 1);
