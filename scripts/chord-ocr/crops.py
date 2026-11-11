import json, os, sys
from PIL import Image
pages, out = sys.argv[1], sys.argv[2]; os.makedirs(out, exist_ok=True)
truth = {t["id"]: t for t in json.load(open("lead/truth.json"))}
idx = []
for r in json.load(open(os.path.join(pages, "boxes.json"))):
    im = Image.open(os.path.join(pages, r["png"]))
    for k, h in enumerate(r["harms"]):
        x0, y0, x1, y1 = h["box"]; p = 6
        c = im.crop((x0 - p, y0 - p, x1 + p, y1 + p))
        c = c.resize((c.width * 3, c.height * 3), Image.LANCZOS)
        name = f"{r['png'][:-4]}_{k:03d}.png"; c.save(os.path.join(out, name))
        idx.append({"crop": name, "text": h["text"], "split": truth[r["file"]]["split"]})
json.dump(idx, open(os.path.join(out, "index.json"), "w")); print(len(idx))
