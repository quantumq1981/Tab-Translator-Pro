"""music21's reading of every MusicXML lyric in its own corpus — the truth for tests/bench/lyricsxml.mjs.

  python -m venv m21 && m21/bin/pip install music21
  m21/bin/python -I scripts/m21_lyrics_dump.py <music21/corpus dir> <out.json>

Output: [{ file (relative to the corpus), parts: [[ [measure index, offset in quarters, lyric number, text,
syllabic], ... ] per part ] }] for every .mxl / .xml / .musicxml file that contains <lyric>. Grace notes and
empty lyrics are skipped. Dev-only; the corpus is music21's, not shipped."""
import glob, json, os, sys, warnings, zipfile
warnings.filterwarnings("ignore")
from music21 import converter

root, out_path = sys.argv[1], sys.argv[2]
files = sorted(glob.glob(root + "/**/*.mxl", recursive=True) + glob.glob(root + "/**/*.xml", recursive=True) + glob.glob(root + "/**/*.musicxml", recursive=True))
out = []
for f in files:
    try:
        if f.endswith(".mxl"):
            z = zipfile.ZipFile(f)
            names = [x for x in z.namelist() if (x.endswith(".xml") or x.endswith(".musicxml")) and "META" not in x]
            x = z.read(names[0]).decode("utf-8", "replace")
        else:
            x = open(f, encoding="utf-8", errors="replace").read()
    except Exception:
        continue
    if "<lyric" not in x:
        continue
    try:
        s = converter.parse(f)
    except Exception:
        continue
    parts = []
    for p in s.parts:
        syl = []
        for mi, m in enumerate(p.getElementsByClass("Measure")):
            for n in m.recurse().notes:
                if n.duration.isGrace:
                    continue
                for l in n.lyrics:
                    if l.text:
                        syl.append([mi, float(n.getOffsetInHierarchy(m)), str(l.number), l.text, l.syllabic or "single"])
        parts.append(syl)
    out.append({"file": os.path.relpath(f, root), "parts": parts})
json.dump(out, open(out_path, "w"))
print(len(out), "files with lyrics")
