"""PyGuitarPro technique counts per track, the oracle for tests/bench/techniques.mjs. Dev-only.
usage: python scripts/pgp_techniques.py <dir of .gp3/.gp4/.gp5> /tmp/pgp_tech.json   (needs pyguitarpro)"""
import sys, json, glob, os, guitarpro
out = {}
for f in sorted(glob.glob(os.path.join(sys.argv[1], "*.gp[345]"))):
    try: song = guitarpro.parse(f)
    except Exception as e: continue
    c = {}
    for ti, tr in enumerate(song.tracks):
        for m in tr.measures:
            for v in m.voices:
                for b in v.beats:
                    for n in b.notes:
                        if n.type == guitarpro.NoteType.dead: continue
                        e = n.effect; be = b.effect
                        tags = []
                        if e.isBend: tags.append("bend")
                        if e.hammer: tags.append("hammer")
                        if e.slides: tags.append("slide")
                        if e.isHarmonic or (be.isHarmonic if hasattr(be, "isHarmonic") else False): tags.append("harmonic")
                        if e.palmMute: tags.append("palmMute")
                        if e.vibrato or be.vibrato: tags.append("vibrato")
                        if e.letRing: tags.append("letRing")
                        if e.staccato: tags.append("staccato")
                        if e.isTrill: tags.append("trill")
                        if e.isTremoloPicking: tags.append("tremolo")
                        if e.isGrace: tags.append("grace")
                        if e.ghostNote: tags.append("ghost")
                        for t in tags: c[f"{ti}:{t}"] = c.get(f"{ti}:{t}", 0) + 1
    out[os.path.basename(f)] = c
json.dump(out, open(sys.argv[2], "w"))
print(len(out), "files")
