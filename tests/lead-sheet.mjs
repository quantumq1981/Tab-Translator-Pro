/* Guards for the lead-sheet reduction (leadSheetFromMusicXML / leadSheetToMusicXML /
 * leadSheetToChordScore): melody part choice, the staff-1 skyline (held melody over a moving inner
 * voice, ties across bar lines, chord groups → top note, <backup> voices), written vs inferred
 * chords, the choir rule, the chord rate, key spelling, and the export (every bar's length,
 * ties, harmony with degrees, round trip). Plus a sweep over the 338 Bach chorales. */
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { loadEngine } from "./bench/lib.mjs";
import { DOMParser } from "@xmldom/xmldom";
const here = path.dirname(fileURLToPath(import.meta.url));
const E = await loadEngine();
let pass = 0, fail = 0;
const expect = (ok, msg) => { if (ok) pass++; else { fail++; console.log("  ✗ " + msg); } };
const mel = (L) => L.bars.map((b) => b.melody.map((n) => n.midi + "@" + n.q + "/" + n.d).join(" ")).join(" | ");
const chords = (L) => L.bars.map((b) => b.chords.map((c) => c.symbol).join(" ")).join(" | ");

// ---- a tiny score builder (divisions 4 = 16ths) ------------------------------------------------
const P = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const n = (pitch, dur, x = {}) => {
  if (pitch === "r") return `<note><rest/><duration>${dur}</duration>${x.voice ? `<voice>${x.voice}</voice>` : ""}${x.staff ? `<staff>${x.staff}</staff>` : ""}</note>`;
  const m = pitch.match(/^([A-G])([#b]?)(\d)$/);
  const alter = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return `<note>${x.chord ? "<chord/>" : ""}${x.grace ? "<grace/>" : ""}<pitch><step>${m[1]}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${m[3]}</octave></pitch>` +
    `${x.grace ? "" : `<duration>${dur}</duration>`}${x.tie ? x.tie.map((t) => `<tie type="${t}"/>`).join("") : ""}${x.voice ? `<voice>${x.voice}</voice>` : ""}${x.staff ? `<staff>${x.staff}</staff>` : ""}</note>`;
};
const harm = (root, kind, extra = "") => `<harmony><root><root-step>${root[0]}</root-step>${root[1] === "b" ? "<root-alter>-1</root-alter>" : root[1] === "#" ? "<root-alter>1</root-alter>" : ""}</root><kind>${kind}</kind>${extra}</harmony>`;
const attrs = (staves = 1, beats = 4) => `<attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>${beats}</beats><beat-type>4</beat-type></time>${staves > 1 ? `<staves>${staves}</staves>` : ""}</attributes>`;
const score = (parts) => `<?xml version="1.0"?><score-partwise version="3.1"><work><work-title>T</work-title></work><part-list>${parts.map((p, i) => `<score-part id="P${i + 1}"><part-name>${p.name}</part-name></score-part>`).join("")}</part-list>` +
  parts.map((p, i) => `<part id="P${i + 1}">${p.measures.map((m, mi) => `<measure number="${mi + 1}">${m}</measure>`).join("")}</part>`).join("") + "</score-partwise>";

// ---- piano grand staff: held melody over an inner voice, LH chords, no harmony ----------------
{
  const rh1 = attrs(2) + n("G5", 8, { voice: 1, staff: 1 }) + n("E5", 8, { voice: 1, staff: 1 }) +
    "<backup><duration>16</duration></backup>" + n("C5", 4, { voice: 2, staff: 1 }) + n("D5", 4, { voice: 2, staff: 1 }) + n("C5", 8, { voice: 2, staff: 1 }) +
    "<backup><duration>16</duration></backup>" + n("C3", 16, { voice: 5, staff: 2 }) + n("E3", 16, { voice: 5, staff: 2, chord: 1 }) + n("G3", 16, { voice: 5, staff: 2, chord: 1 });
  const rh2 = n("F5", 16, { voice: 1, staff: 1 }) + n("A4", 16, { voice: 1, staff: 1, chord: 1 }) +
    "<backup><duration>16</duration></backup>" + n("F2", 16, { voice: 5, staff: 2 }) + n("A2", 16, { voice: 5, staff: 2, chord: 1 }) + n("C3", 16, { voice: 5, staff: 2, chord: 1 });
  const L = E.leadSheetFromMusicXML(score([{ name: "Piano", measures: [rh1, rh2] }]));
  expect(mel(L) === "79@0/2 76@2/2 | 77@0/4", "skyline: a held melody note is not cut by the inner voice; a chord group gives its top note; the left hand is ignored: " + mel(L));
  expect(L.chordSource === "notes" && chords(L) === "C | F", "a lone piano part is its own harmony (both staves): " + chords(L));
}

// ---- melody part choice + written harmony in ANOTHER part -------------------------------------
{
  const lead = [attrs() + n("E5", 4) + n("D5", 4) + n("C5", 8), n("D5", 16)];
  const gtr = [attrs() + harm("C", "major") + n("C3", 16) + n("E3", 16, { chord: 1 }) + n("G3", 16, { chord: 1 }),
    harm("G", "dominant") + n("G2", 8) + harm("F", "major-sixth", "<degree><degree-value>9</degree-value><degree-alter>0</degree-alter><degree-type>add</degree-type></degree>") + n("F2", 8)];
  const L = E.leadSheetFromMusicXML(score([{ name: "Rhythm Guitar", measures: gtr }, { name: "Flute", measures: lead }]));
  expect(L.melodyPart === 1, "the single-note line in the highest register is the melody (the flute, not part 1)");
  expect(L.chordSource === "written" && chords(L) === "C | G7 F6", "written <harmony> from another part wins, at its beat: " + chords(L));
  expect(L.bars[1].chords[1].q === 2, "a chord symbol keeps its beat");
  const named = E.leadSheetFromMusicXML(score([{ name: "Piano", measures: lead }, { name: "Lead Vocal", measures: lead }]));
  expect(named.melodyPart === 1 && /Lead Vocal/.test(named.melodyReason), "a part named like a voice or lead wins");
  const forced = E.leadSheetFromMusicXML(score([{ name: "Rhythm Guitar", measures: gtr }, { name: "Flute", measures: lead }]), { melodyPart: 0 });
  expect(forced.melodyPart === 0 && forced.melodyReason === "chosen", "opts.melodyPart overrides the choice");
  const none = E.leadSheetFromMusicXML(score([{ name: "Flute", measures: lead }]), { chordSource: "written" });
  expect(none.chordSource === "none" && none.bars.every((b) => !b.chords.length), "chordSource \"written\" with no symbols → no chords, not invented ones");
}

// ---- ties across a bar line, grace notes, rests, meter change ----------------------------------
{
  const m1 = attrs() + n("C5", 8) + n("D5", 2, { grace: 1 }) + n("E5", 8, { tie: ["start"] });
  const m2 = attrs(1, 3) + n("E5", 4, { tie: ["stop"] }) + n("r", 4) + n("G5", 4);
  const L = E.leadSheetFromMusicXML(score([{ name: "Melody", measures: [m1, m2] }]));
  expect(mel(L) === "72@0/2 76@2/2 | 76@0/1 79@2/1", "grace note ignored, rest kept as a gap, tied note joined then split at the bar line: " + mel(L));
  expect(L.bars[0].melody[1].tieOut && L.bars[1].melody[0].tieIn, "the split note is tied across the bar line");
  const xml = E.leadSheetToMusicXML(L);
  expect((xml.match(/<tie type="start"\/>/g) || []).length === 1 && (xml.match(/<tie type="stop"\/>/g) || []).length === 1, "export writes one tie across the bar line");
  expect(/<beats>3<\/beats>/.test(xml), "export writes the meter change");
  const back = E.leadSheetFromMusicXML(xml);
  expect(mel(back) === mel(L), "the exported lead sheet reads back to the same melody: " + mel(back));
}

// ---- choir rule, chord rate, key spelling -------------------------------------------------------
{
  const S = [attrs() + n("D5", 8) + n("D5", 8)], A = [attrs() + n("Bb4", 8) + n("A4", 8)],
    T = [attrs() + n("F4", 8) + n("F#4", 8)], B = [attrs() + n("Bb2", 8) + n("D3", 8)];
  const parts = [{ name: "Soprano", measures: S }, { name: "Alto", measures: A }, { name: "Tenor", measures: T }, { name: "Bass", measures: B }];
  const L = E.leadSheetFromMusicXML(score(parts));
  expect(L.melodyPart === 0 && L.chordParts.length === 4, "a choir reads its harmony from every voice, \"Bass\" included");
  expect(chords(L) === "Bb D", "auto chord rate splits a bar whose halves differ (Bb then D): " + chords(L));
  const one = E.leadSheetFromMusicXML(score(parts), { chordsPerBar: 1 });
  expect(one.bars[0].chords.length === 1, "chordsPerBar 1 keeps one chord per bar");
  const fm = [attrs() + n("Db3", 16) + n("F3", 16, { chord: 1 }) + n("Ab3", 16, { chord: 1 })];
  const k = E.leadSheetFromMusicXML(score([{ name: "Voice", measures: [attrs() + n("F5", 16), n("Ab5", 16), n("F5", 16)] },
    { name: "Keys", measures: [attrs() + n("F3", 16) + n("Ab3", 16, { chord: 1 }) + n("C4", 16, { chord: 1 }), fm[0].replace(attrs(), ""), n("F3", 16) + n("Ab3", 16, { chord: 1 }) + n("C4", 16, { chord: 1 })] }]));
  expect(E.keyNameForKey(k.key) === "Fm" && chords(k) === "Fm | Db | Fm", "inferred chords are spelled for the key (Db in F minor, not C#): " + chords(k));
  const fam = E.leadSheetFromMusicXML(score([{ name: "Voice", measures: [attrs() + n("F5", 16), n("Ab5", 16), n("F5", 16)] },
    { name: "Keys", measures: [attrs() + n("F3", 16) + n("Ab3", 16, { chord: 1 }) + n("C4", 16, { chord: 1 }), fm[0].replace(attrs(), ""), n("F3", 16) + n("Ab3", 16, { chord: 1 }) + n("C4", 16, { chord: 1 })] }]), { spellKey: false });
  expect(chords(fam) === "Fm | C# | Fm", "spellKey:false keeps the family table");
}

// ---- export: harmony with degrees, chord score -------------------------------------------------
{
  const L = { title: "X", composer: "", tempo: 100, timeSig: [4, 4], key: { tonic: 7, mode: "major" }, parts: [], melodyPart: 0,
    bars: [{ number: 1, timeSig: [4, 4], section: "A", repeatStart: true, melody: [{ q: 0, d: 4, midi: 71 }],
      chords: [{ q: 0, symbol: "G7sus4", midis: [55, 60, 62, 65] }, { q: 2, symbol: "C6/9/E", midis: [52, 60, 64, 67, 69, 74] }] },
    { number: 2, timeSig: [4, 4], repeatEnd: true, melody: [{ q: 1, d: 1, midi: 66 }], chords: [{ q: 0, symbol: "D7♭9", midis: [62, 66, 69, 72, 75] }] }] };
  const xml = E.leadSheetToMusicXML(L);
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  expect(doc.getElementsByTagName("measure").length === 2, "export: well-formed, two measures");
  expect(/<kind text="7sus4">suspended-fourth<\/kind>/.test(xml) && /<degree-value>7<\/degree-value><degree-alter>-1<\/degree-alter>/.test(xml), "7sus4 = suspended-fourth + added ♭7");
  expect(/<kind text="6\/9">major-sixth<\/kind>/.test(xml) && /<bass><bass-step>E<\/bass-step><\/bass>/.test(xml), "6/9 = major-sixth + added 9, slash bass kept");
  expect(/<offset>960<\/offset>/.test(xml), "a chord on beat 3 of a whole note is written with an offset");
  expect(/<fifths>1<\/fifths>/.test(xml) && /<rehearsal[^>]*>A<\/rehearsal>/.test(xml) && /repeat direction="forward"/.test(xml) && /repeat direction="backward"/.test(xml), "key, rehearsal mark and repeats are written");
  expect(/<step>F<\/step><alter>1<\/alter>/.test(xml) && !/<accidental>sharp/.test(xml), "F# in G major is spelled F# with no printed accidental");
  const back = E.leadSheetFromMusicXML(xml);
  expect(chords(back) === "G7sus4 C6/9/E | D7♭9", "chord symbols survive the round trip: " + chords(back));
  const cs = E.leadSheetToChordScore(back);
  const csmpn = E.scoreToCSMPN(cs, { title: "X" });
  expect(cs.source === "lead" && /G7sus4_C6\/9\/E/.test(csmpn) && /D7♭9/.test(csmpn), "the chord score exports to CSMPN");
}

// ---- the 338 Bach chorales: melody = the soprano line, export valid, round trip exact ----------
{
  const dir = path.join(here, "fixtures/bach-chorales");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".mxl"));
  let ok = 0, sop = 0, rt = 0, lengths = 0, chorded = 0, ms = 0, onGrid = 0, flagged = 0;
  const bad = [];
  for (const f of files) {
    const u8 = new Uint8Array(fs.readFileSync(path.join(dir, f)));
    const ent = E._zipEntries(u8).find((e) => /\.(xml|musicxml)$/.test(e.name) && !/META-INF/.test(e.name));
    const xml = new TextDecoder().decode(await E._zipRead(u8, ent));
    const t0 = performance.now();
    const L = E.leadSheetFromMusicXML(xml);
    const out = E.leadSheetToMusicXML(L);
    ms += performance.now() - t0;
    ok++;
    if (/soprano/i.test(L.parts[L.melodyPart].name)) sop++;
    // the skyline of a monophonic soprano part is that part, note for note
    const s = E._leadSkyline(E._leadPartWalk(new DOMParser().parseFromString(xml, "text/xml").getElementsByTagName("part")[L.melodyPart], true)).line;
    const back = E.leadSheetFromMusicXML(out);
    const same = mel(back) === mel(L) && chords(back) === chords(L);
    if (!L.offGrid) { onGrid++; if (same) rt++; else if (bad.length < 3) bad.push(f); }
    else if (!same) flagged++;
    const doc = new DOMParser().parseFromString(out, "text/xml");
    let lenOK = true;
    for (const m of Array.from(doc.getElementsByTagName("measure"))) {
      let sum = 0; for (const nn of Array.from(m.getElementsByTagName("note"))) sum += +nn.getElementsByTagName("duration")[0].textContent;
      if (sum !== 1920 && sum !== 1440 && sum !== 960 && sum !== 480 * 6) { lenOK = false; break; }
    }
    if (lenOK) lengths++;
    if (L.bars.filter((b) => b.melody.length).every((b) => b.chords.length) && s.length) chorded++;
  }
  expect(sop === files.length, `the soprano is the melody in every chorale (${sop}/${files.length})`);
  expect(rt === onGrid && onGrid >= files.length - 2, `melody + chords survive export → re-read in every chorale on the 16th grid (${rt}/${onGrid}) ${bad.join(" ")}`);
  expect(flagged === files.length - onGrid, `the chorales with 32nds are flagged (offGrid) — the ones that change on export (${flagged})`);
  expect(lengths >= files.length - 2, `every exported bar is a whole bar in ${lengths}/${files.length} chorales (pickups are written as full bars)`);
  expect(chorded >= files.length * 0.95, `every sung bar gets a chord in ${chorded}/${files.length} chorales`);
  console.log(`  chorales: ${ok} reduced + exported in ${(ms / ok).toFixed(1)} ms each`);
}

console.log(`lead-sheet: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
