// Survey the repo's Guitar Pro corpus for chordal (rhythm/comp) tracks.
import fs from "node:fs"; import path from "node:path"; import url from "node:url";
const here = path.dirname(url.fileURLToPath(import.meta.url)), repo = path.resolve(here, "../..");
globalThis.DOMParser = (await import("@xmldom/xmldom")).DOMParser;
const src = fs.readFileSync(path.join(repo, "engine.tsx"), "utf8");
const tmp = path.join(here, ".engine.mjs"); fs.writeFileSync(tmp, src);
const eng = await import(tmp);
const files = fs.readdirSync(repo).filter((f) => /\.(gp[345x]?|gp)$/i.test(f));
for (const f of files) {
  let s; try { s = await eng.parseGuitarProOrXML(new Uint8Array(fs.readFileSync(path.join(repo, f))), f, true, 0); } catch (e) { console.log("FAIL", f, e.message); continue; }
  const parts = s.parts || [{ index: 0, name: "?" }];
  const rows = [];
  for (const p of parts) {
    let sc = p.index === 0 ? s : null;
    try { if (!sc) sc = await eng.parseGuitarProOrXML(new Uint8Array(fs.readFileSync(path.join(repo, f))), f, true, p.index); } catch { continue; }
    let ev = 0, ch = 0; for (const b of sc.bars) for (const e of b.events) { if (!e.midis || !e.midis.length) continue; ev++; if (new Set(e.midis.map((m) => m % 12)).size >= 3) ch++; }
    rows.push(`${p.index}:${(p.name || "").slice(0, 18)} ev=${ev} chord=${ev ? (ch / ev).toFixed(2) : 0}`);
  }
  console.log(f.slice(0, 50).padEnd(50), "tempo", s.tempo, "bars", s.bars.length, "|", rows.join(" | "));
}
