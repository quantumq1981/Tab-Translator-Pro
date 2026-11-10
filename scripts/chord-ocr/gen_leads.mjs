// Lead sheets with KNOWN chord symbols, from the repo's Guitar Pro corpus: every pitched part read
// together (Harmony), one chord per bar or half bar (Simplify-like via the lead-sheet chord rule),
// named in the Pro vocabulary, melody = top note of each onset. Output: <out>/<i>.musicxml + truth.json.
import fs from "node:fs"; import path from "node:path";
import { loadEngine } from "../../tests/bench/lib.mjs";
const E = await loadEngine();
const repo = new URL("../../", import.meta.url).pathname, out = process.argv[2], maxBars = +(process.argv[3] || 24);
const files = fs.readdirSync(repo).filter((f) => /\.(gp|gp3|gp4|gp5|gpx)$/i.test(f)).sort();
const truth = [];
for (let fi = 0; fi < files.length; fi++) {
  const f = files[fi];
  let sc;
  try { sc = await E.parseGuitarProOrXML(new Uint8Array(fs.readFileSync(path.join(repo, f))), f, true, E.HARMONY_PART); } catch (e) { continue; }
  if (!sc || !sc.bars || sc.bars.length < 8) continue;
  const named = E.respellScore(E.simplifyScore(sc, true), "chart");
  const bars = [];
  for (let bi = 0; bi < Math.min(maxBars, sc.bars.length); bi++) {
    const b = sc.bars[bi], nb = named.bars[bi], ts = b.timeSig || sc.timeSig || [4, 4];
    const evs = (nb.events || []).filter((e) => e.symbol && e.symbol !== "—" && (e.midis || []).length > 1);
    const chords = evs.map((e) => ({ q: e.qbeat ?? e.beat ?? 0, symbol: e.symbol, midis: e.midis }));
    const melody = [];
    for (const e of b.events || []) {
      const m = Math.max(...(e.midis || [0])); if (!(m > 0)) continue;
      let top = m; while (top < 64) top += 12; while (top > 81) top -= 12;
      melody.push({ q: e.qbeat ?? e.beat, d: e.qdur ?? e.durBeats ?? 1, midi: top });
    }
    // monophonic + inside the bar
    melody.sort((a, b2) => a.q - b2.q);
    const mel = melody.filter((n, i, a) => (i === 0 || n.q > a[i - 1].q + 1e-6) && n.q < ts[0]);
    mel.forEach((n, i) => { n.d = Math.min(n.d, (i + 1 < mel.length ? mel[i + 1].q : ts[0]) - n.q); });
    bars.push({ number: bi + 1, timeSig: ts, melody: mel.filter((n) => n.d > 0.12), chords });
  }
  const nChords = bars.reduce((s, b) => s + b.chords.length, 0);
  if (nChords < 8) continue;
  const key = E.analyzeKey({ bars: bars.map((b) => ({ events: b.chords.map((c) => ({ symbol: c.symbol, durBeats: 1, midis: c.midis })) })), timeSig: [4, 4] });
  const lead = { title: f.replace(/\.[^.]+$/, ""), composer: "", tempo: sc.tempo || 100, timeSig: bars[0].timeSig, key: null, parts: [], melodyPart: 0, bars };
  const xml = E.leadSheetToMusicXML(lead, { key: null });
  const id = String(truth.length).padStart(3, "0");
  fs.writeFileSync(path.join(out, id + ".musicxml"), xml);
  truth.push({ id, file: f, split: fi % 2 ? "test" : "dev", bars: bars.map((b) => b.chords.map((c) => ({ q: c.q, symbol: c.symbol }))) });
}
fs.writeFileSync(path.join(out, "truth.json"), JSON.stringify(truth));
const all = truth.flatMap((t) => t.bars.flat().map((c) => c.symbol));
const freq = {}; all.forEach((s) => { const k = s.replace(/^[A-G][#b]?/, "X").replace(/\/[A-G][#b]?$/, "/Y"); freq[k] = (freq[k] || 0) + 1; });
console.log(truth.length, "lead sheets,", all.length, "chord symbols; kinds:", Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 18).map(([k, v]) => k + ":" + v).join(" "));
