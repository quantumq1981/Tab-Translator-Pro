"""Crops → one binary of model inputs (uint8, 32 rows each, ink dark) + index with widths."""
import json, sys, numpy as np
from PIL import Image
import synth
d = sys.argv[1]; idx = json.load(open(d + "/index.json")); buf = []
for it in idx:
    a = np.asarray(Image.open(d + "/" + it["crop"]).convert("L"))
    a = a if a.shape[0] == 32 else synth.to_input(Image.fromarray(a))
    it["w"] = int(a.shape[1]); buf.append(a.astype(np.uint8).tobytes())
open(d + "/inputs.bin", "wb").write(b"".join(buf)); json.dump(idx, open(d + "/inputs.json", "w")); print(len(idx))
