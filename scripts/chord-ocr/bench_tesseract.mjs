import fs from "node:fs"; import { createWorker } from "tesseract.js";
const dir = process.argv[2], psm = process.argv[3] || "7", idx = JSON.parse(fs.readFileSync(dir + "/index.json"));
const w = await createWorker("eng", 1, { langPath: process.env.TESSDATA || process.cwd() + "/tessdata", cacheMethod: "none", gzip: true });
await w.setParameters({ tessedit_pageseg_mode: psm, tessedit_char_whitelist: "ABCDEFGabcdefgijmnoMsuΔ0123456789#/()+-♯♭°ø" });
const norm = (s) => s.replace(/\s+/g, "").replace(/♯/g, "#").replace(/♭/g, "b").replace(/Maj/g, "maj");
const noAcc = (s) => s.replace(/(?<=[A-G])[#b]/g, "");
const res = [];
for (const it of idx) {
  const { data } = await w.recognize(dir + "/" + it.crop);
  res.push({ ...it, got: norm(data.text), want: norm(it.text), conf: data.confidence });
}
fs.writeFileSync(dir + "/tess-" + psm + ".json", JSON.stringify(res));
for (const sp of ["dev", "test"]) {
  const r = res.filter((x) => x.split === sp), acc = r.filter((x) => /(?<=[A-G])[#b]/.test(x.want));
  const f = (a, p) => (100 * a.filter(p).length / a.length).toFixed(1);
  console.log(sp, r.length, "exact", f(r, (x) => x.got === x.want), "ignoring accidentals", f(r, (x) => noAcc(x.got) === noAcc(x.want)),
    "| with accidental", acc.length, "exact", f(acc, (x) => x.got === x.want));
}
await w.terminate();
