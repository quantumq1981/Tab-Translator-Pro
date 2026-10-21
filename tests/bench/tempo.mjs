import fs from "node:fs"; import path from "node:path"; import * as L from "./lib.mjs";
const eng = await L.loadEngine(); const cache = path.join(L.here, ".cache");
let ok = 0, half = 0, dbl = 0, other = 0; const rows = [];
for (let i = 0; i < L.CORPUS.length; i++) {
  const meta = JSON.parse(fs.readFileSync(path.join(cache, `${i}_clean.json`))); const b = fs.readFileSync(path.join(cache, `${i}_clean.f32`));
  const ds = L.boxDecimate(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4), meta.sr, 16000);
  const bt = eng.detectBeats(ds.audio, ds.sr); const r = bt.bpm / meta.bpm;
  const k = Math.abs(r - 1) < 0.04 ? "ok" : Math.abs(r - 0.5) < 0.03 ? "half" : Math.abs(r - 2) < 0.08 ? "double" : Math.abs(r-1.5)<0.06||Math.abs(r-0.667)<0.03||Math.abs(r-0.333)<0.02||Math.abs(r-3)<0.1 ? "triple" : "other";
  if (k === "ok") ok++; else if (k === "half") half++; else if (k === "double") dbl++; else other++;
  rows.push(`${i} ${meta.file.slice(0, 26)} gt ${meta.bpm} det ${bt.bpm} ${k}`);
}
console.log(rows.join("\n")); console.log({ ok, half, dbl, other });
