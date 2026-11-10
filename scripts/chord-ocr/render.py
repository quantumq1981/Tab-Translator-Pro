"""Render lead-sheet MusicXML with verovio → page PNGs (grey) + chord boxes in pixels.
Each <harm> text gets a unique fill colour in a second render; its pixel extent is the box."""
import sys, json, re, os, io, verovio, cairosvg, numpy as np
from PIL import Image
src, out, zoom = sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 1.5
os.makedirs(out, exist_ok=True)
tk = verovio.toolkit()
tk.setOptions({"svgBoundingBoxes": False, "pageWidth": 2100, "pageHeight": 2970, "scale": 40, "footer": "none", "header": "none", "breaks": "auto"})
res = []
for f in sorted(x for x in os.listdir(src) if x.endswith(".musicxml")):
    tk.loadFile(os.path.join(src, f))
    for p in range(1, tk.getPageCount() + 1):
        svg = tk.renderToSVG(p).replace("\uea66", "\u266f").replace("\uea64", "\u266d").replace("\ueca5", "\u2669")
        svg = re.sub(r'<tspan font-family="Leipzig" font-size="\d+px">([\u266d\u266f])', r'<tspan font-family="DejaVu Sans" font-size="360px">\1', svg)
        texts, meas = [], []
        svg_m = svg
        def col(m):
            k = len(texts) + 1
            seg = m.group(0)
            txt = "".join(re.findall(r'<tspan[^>]*>([^<]+)</tspan>', seg))
            texts.append(txt)
            meas.append(svg_m.count('class="measure"', 0, m.start()) - 1)
            c = "#%02x%02x%02x" % (255, k // 256, k % 256)
            return seg.replace("<text ", '<text fill="%s" ' % c, 1)
        svg_c = re.sub(r'<g id="[^"]+" class="harm">.*?</text>', col, svg, flags=re.S)
        def ras(s):
            png = cairosvg.svg2png(bytestring=s.encode(), scale=zoom, background_color="white")
            return np.asarray(Image.open(io.BytesIO(png)).convert("RGB"))
        a, c = ras(svg), ras(svg_c)
        boxes = []
        r, g, b = c[..., 0].astype(int), c[..., 1].astype(int), c[..., 2].astype(int)
        for k, t in enumerate(texts, 1):
            m = (r > 200) & (g == k // 256) & (b == k % 256) & ((g + b) > 0 if k else True)
            # anti-aliasing: also accept near-colour pixels
            ys, xs = np.nonzero(m)
            if len(xs) == 0: boxes.append(None); continue
            boxes.append([int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1])
        name = f"{f[:-9]}_p{p}.png"
        Image.fromarray(a).convert("L").save(os.path.join(out, name))
        res.append({"file": f[:-9], "page": p, "png": name, "measures": svg.count('class="measure"'), "harms": [{"text": t, "box": bx, "measure": mi} for t, bx, mi in zip(texts, boxes, meas)]})
json.dump(res, open(os.path.join(out, "boxes.json"), "w"))
nh = sum(len(r["harms"]) for r in res); nb = sum(1 for r in res for h in r["harms"] if h["box"])
chars = sorted({ch for r in res for h in r["harms"] for ch in h["text"] if ord(ch) > 127})
print(len(res), "pages,", nh, "harms,", nb, "boxed; non-ascii:", [hex(ord(c)) for c in chars])
