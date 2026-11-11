"""Phone-photo condition: each rendered page warped by a random homography (rotation ±maxrot°,
mild perspective), uneven light, blur, sensor noise, JPEG. Truth boxes mapped through the same
homography. Usage: photo.py <pages_dir> <out_dir> <seed> <maxrot>"""
import io, json, math, os, sys, random
import numpy as np
from PIL import Image, ImageFilter
src, out, seed, maxrot = sys.argv[1], sys.argv[2], int(sys.argv[3]), float(sys.argv[4])
os.makedirs(out, exist_ok=True)
rng = random.Random(seed); nrng = np.random.default_rng(seed)
pages = json.load(open(os.path.join(src, "boxes.json")))
def solve_h(src_pts, dst_pts):
    A = []
    for (x, y), (u, v) in zip(src_pts, dst_pts):
        A += [[x, y, 1, 0, 0, 0, -u * x, -u * y], [0, 0, 0, x, y, 1, -v * x, -v * y]]
    b = [c for p in dst_pts for c in p]
    h = np.linalg.solve(np.array(A, float), np.array(b, float))
    return np.append(h, 1).reshape(3, 3)
for p in pages:
    im = Image.open(os.path.join(src, p["png"])).convert("L"); W, H = im.size
    a = math.radians(rng.uniform(-maxrot, maxrot)); cx, cy = W / 2, H / 2
    corners = [(0, 0), (W, 0), (W, H), (0, H)]
    def rot(x, y): return (cx + (x - cx) * math.cos(a) - (y - cy) * math.sin(a), cy + (x - cx) * math.sin(a) + (y - cy) * math.cos(a))
    j = 0.03 * W
    dst = [(x + rng.uniform(-j, j), y + rng.uniform(-j, j)) for x, y in (rot(*c) for c in corners)]
    mx, my = min(x for x, _ in dst), min(y for _, y in dst)
    dst = [(x - mx + 20, y - my + 20) for x, y in dst]
    OW, OH = int(max(x for x, _ in dst) + 20), int(max(y for _, y in dst) + 20)
    Hm = solve_h(corners, dst); Hi = np.linalg.inv(Hm); Hi = Hi / Hi[2, 2]
    w = im.transform((OW, OH), Image.PERSPECTIVE, tuple(Hi.flatten()[:8]), resample=Image.BICUBIC, fillcolor=255)
    arr = np.asarray(w, np.float32)
    yy, xx = np.mgrid[0:OH, 0:OW]
    gx, gy = rng.uniform(-1, 1), rng.uniform(-1, 1)
    light = 1 - 0.35 * ((gx * (xx / OW - 0.5) + gy * (yy / OH - 0.5)) + 0.5) * rng.uniform(0.4, 1.0)   # a shadow ramp
    paper = rng.uniform(200, 245)
    arr = (arr / 255.0) * paper * light + nrng.normal(0, rng.uniform(2, 7), arr.shape)
    w = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(rng.uniform(0.4, 1.1)))
    s = rng.uniform(0.8, 1.15); w = w.resize((int(OW * s), int(OH * s)), Image.BILINEAR)
    b = io.BytesIO(); w.save(b, "JPEG", quality=rng.randint(55, 85)); w = Image.open(io.BytesIO(b.getvalue())).convert("L")
    w.save(os.path.join(out, p["png"]))
    np.asarray(w).tofile(os.path.join(out, p["png"][:-4] + ".raw"))
    q = dict(p); q["w"], q["h"] = w.size
    hs = []
    for h in p["harms"]:
        x0, y0, x1, y1 = h["box"]
        pts = np.array([[x0, y0, 1], [x1, y0, 1], [x1, y1, 1], [x0, y1, 1]], float) @ Hm.T
        pts = pts[:, :2] / pts[:, 2:] * s
        hs.append({**h, "box": [int(pts[:, 0].min()), int(pts[:, 1].min()), int(pts[:, 0].max()) + 1, int(pts[:, 1].max()) + 1]})
    q["harms"] = hs; q["rot"] = math.degrees(a)
    json.dump(None, open(os.devnull, "w"))
    p.update(q)
json.dump(pages, open(os.path.join(out, "boxes.json"), "w"))
print(len(pages), "photo pages")
