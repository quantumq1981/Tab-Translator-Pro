"""Recognition-only eval set in the HELD-OUT handwriting fonts (Kalam, Schoolbell): every chord of the
truth corpus drawn by synth.render with those fonts. → <out>/index.json + crops (32 px tall, as the model sees)."""
import json, os, random, re, sys
from PIL import Image
import synth
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
rng = random.Random(11); fonts = synth.text_fonts(holdout=True)
truth = json.load(open("lead/truth.json")); idx = []
for t in truth:
    for b in t["bars"]:
        for c in b:
            sym = c["symbol"].replace("♯", "#").replace("♭", "b")
            m = re.match(r"^([A-G])([#b]?)(.*?)(?:/([A-G][#b]?))?$", sym)
            r = synth.render(rng, fonts, label=(m[1], m[2], m[3], "/" + m[4] if m[4] else ""))
            if not r: continue
            name = f"{len(idx):05d}.png"; Image.fromarray(r[0]).save(os.path.join(out, name))
            idx.append({"crop": name, "text": r[1], "split": t["split"]})
json.dump(idx, open(os.path.join(out, "index.json"), "w")); print(len(idx), "held-out-font crops")
