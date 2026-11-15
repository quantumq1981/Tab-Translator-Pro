"""Hand-copied "Real Book" style chord symbols (the Hal Leonard Real Book / Berklee Real Book look) for
fine-tuning the recogniser. What makes that hand different from every training font:

* the suffix is SMALL (about half the root letter) and RAISED so its top sits at or above the root's top;
* minor is a dash ("A-7"), major seventh "maj7" / "Δ7", "°7", "ø7";
* the "7" is a short hook — a top stroke that bends into a short stem — not a font's full-size 7. At the
  recogniser's 32-px input that hook looked like the loop of a 9 (or a 1), so a Real Book "A-7" was read
  "A-9" / "A-1". Here it is DRAWN as a stroke (random proportions, curvature, stroke width), as are the
  9 and the 1 sometimes, so the model has to tell the three apart by shape, not by font.

Letters come from the hand-style fonts (MuseJazz Text, Petaluma Script and the handwriting faces); a share
of samples keep the font's own 7. Labels are the chord exactly as drawn, as in synth.py."""
import math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import synth

HAND = ("MuseJazzText", "PetalumaScript", "PatrickHand", "Caveat", "ArchitectsDaughter", "GochiHand", "IndieFlower",
        "ShadowsIntoLight", "ReenieBeanie", "PermanentMarker", "Handlee", "Neucha", "ComingSoon", "Sriracha", "Itim")

def hand_fonts(fonts):
    hf = [f for f in fonts if any(h in f[0] for h in HAND)]
    mj = [f for f in hf if "MuseJazz" in f[0] or "Petaluma" in f[0]]
    return hf, mj

# Real Book qualities, as written there (weights roughly by how often they appear in the books)
RB_QUAL = [(26, [""]), (24, ["-7"]), (16, ["7"]), (14, ["maj7", "Δ7"]), (8, ["-"]), (5, ["7(b9)", "7b9"]), (4, ["9"]),
           (4, ["13"]), (5, ["ø7", "-7(b5)"]), (4, ["°7", "o7"]), (4, ["7sus4", "7sus"]), (3, ["6"]), (3, ["-6"]),
           (3, ["-9"]), (2, ["maj9", "Δ9"]), (2, ["7(#9)", "7#9"]), (2, ["7(#11)"]), (2, ["+7", "7(#5)"]),
           (2, ["-11"]), (2, ["69", "6/9"]), (1, ["-(maj7)", "-Δ7"]), (1, ["7alt", "alt"]), (1, ["13(b9)"])]
_W = [w for w, _ in RB_QUAL]

def _stroke(d, pts, w, ink):
    d.line(pts, fill=ink, width=max(1, int(round(w))), joint="curve")
    r = w / 2
    for x, y in (pts[0], pts[-1]): d.ellipse([x - r, y - r, x + r, y + r], fill=ink)

def _bez(p0, p1, p2, n=10):
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]) for t in (i / n for i in range(n + 1))]

def draw_digit(d, rng, ch, x, top, h, sw, ink):
    """A hand-drawn 7, 9 or 1 of height h whose top is at `top`; returns its advance width."""
    j = lambda a: a * rng.uniform(0.85, 1.15)
    if ch == "7":
        w = h * j(0.62)
        tl = (x, top + h * rng.uniform(0.05, 0.2)); tr = (x + w, top + h * rng.uniform(-0.02, 0.08))
        corner = (x + w * rng.uniform(0.75, 1.0), top + h * rng.uniform(0.0, 0.15))
        stem_end = (x + w * rng.uniform(0.25, 0.55), top + h * rng.uniform(0.75, 1.0))
        bar = _bez(tl, ((tl[0] + tr[0]) / 2, min(tl[1], tr[1]) - h * rng.uniform(0, 0.08)), tr)
        drop = _bez(tr, (corner[0] + w * 0.05, corner[1] + h * rng.uniform(0.1, 0.3)), stem_end)
        _stroke(d, bar + drop[1:], sw, ink)
        return w + sw
    if ch == "9":
        w = h * j(0.6); cx, cy, r = x + w * 0.5, top + h * 0.3, h * j(0.27)
        loop = [(cx + r * math.cos(a), cy + r * math.sin(a) * 1.05) for a in np.linspace(0.2, 2 * math.pi + 0.2, 18)]
        tail = _bez((cx + r, cy), (cx + r * rng.uniform(0.6, 1.1), top + h * 0.7), (cx + r * rng.uniform(-0.6, 0.4), top + h))
        _stroke(d, loop + tail, sw, ink)
        return w + sw
    if ch == "1":
        w = h * j(0.3)
        pts = [(x, top + h * rng.uniform(0.15, 0.3)), (x + w * 0.7, top), (x + w * rng.uniform(0.4, 0.8), top + h)]
        _stroke(d, pts, sw, ink)
        return w + sw
    raise ValueError(ch)

def render_rb(rng, fonts):
    """→ (grey uint8 image H×W, label) in the hand-copied Real Book style."""
    hf, mj = hand_fonts(fonts)
    path, cmap = rng.choice(mj if mj and rng.random() < 0.5 else hf)
    root = rng.choice("ABCDEFG"); acc = rng.choices(["", "#", "b"], [62, 14, 24])[0]
    q = rng.choice(rng.choices(RB_QUAL, _W)[0][1])
    if any(c in "Δ°ø" and ord(c) not in cmap for c in q):
        q = q.replace("Δ7", "maj7").replace("Δ9", "maj9").replace("°", "o").replace("ø7", "-7(b5)")
    bass = "/" + rng.choice("ABCDEFG") + rng.choices(["", "b"], [80, 20])[0] if rng.random() < 0.08 else ""
    size = rng.randint(40, 64)
    font = ImageFont.truetype(path, size)
    scale = rng.uniform(0.4, 0.62)                        # the suffix is about half the root
    sfont = ImageFont.truetype(path, max(12, int(size * scale)))
    img = Image.new("L", (size * 12, size * 3), 255); d = ImageDraw.Draw(img)
    ink = rng.randint(0, 60); sw = max(2, size * rng.uniform(0.045, 0.085))   # a fine pen, like the books'
    base = int(size * 1.9)
    x = size // 2
    x += synth._draw(d, (x, base), root, font, ink)
    cap = font.getbbox(root, anchor="ls")[1]              # negative: the root's top above the baseline
    if acc:
        if rng.random() < 0.5:
            af = ImageFont.truetype(rng.choice(synth.ACC_FONTS), int(size * rng.uniform(0.6, 0.85)))
            x += synth._draw(d, (x + rng.randint(-1, 3), base - int(size * rng.uniform(0.1, 0.35))), {"#": "♯", "b": "♭"}[acc], af, ink) + rng.randint(0, 3)
        else: x += synth._draw(d, (x, base), acc, font, ink)
    if q:
        x += rng.randint(0, int(size * 0.15))
        stop = base + cap + int(size * rng.uniform(-0.12, 0.08))      # the suffix's top: at or above the root's top
        s_cap = -sfont.getbbox("7", anchor="ls")[1]
        sbase = stop + s_cap
        hook = rng.random() < 0.75
        for ch in q:
            if ch in "791" and hook and ch.isdigit():
                dh = s_cap * rng.uniform(0.85, 1.1)
                x += draw_digit(d, rng, ch, x, sbase - dh, dh, sw * rng.uniform(0.7, 1.0), ink) + rng.randint(0, 2)
            elif ch == "-" and rng.random() < 0.6:                      # the Real Book minus: a short thick dash at mid-root height
                y = base + cap * rng.uniform(0.45, 0.6); L = size * rng.uniform(0.22, 0.35)
                _stroke(d, [(x, y + rng.uniform(-1, 1)), (x + L, y + rng.uniform(-2, 1))], sw, ink); x += L + rng.randint(1, 4)
            else:
                x += synth._draw(d, (x, sbase), ch, sfont, ink)
    if bass:
        x += rng.randint(1, 6); x += synth._draw(d, (x, base), "/", font, ink)
        x += synth._draw(d, (x, base), bass[1], font, ink)
        if bass[2:]: x += synth._draw(d, (x, base), bass[2:], font, ink)
    a = np.asarray(img); ys, xs = np.nonzero(a < 200)
    if len(xs) == 0: return None
    pad = rng.randint(2, 12)
    if rng.random() < 0.25:                                # the top of a triplet "3" / note stem under the chord, caught by the crop
        sx = rng.randint(int(xs.min()), int(xs.max())); sy = int(ys.max()) + rng.randint(2, 8)
        _stroke(d, [(sx, sy + pad), (sx + size * 0.12, sy + rng.randint(0, 3)), (sx + size * 0.2, sy + pad)], sw, ink)
    im = img.crop((max(0, xs.min() - pad), max(0, ys.min() - pad), min(a.shape[1], xs.max() + pad), min(a.shape[0], ys.max() + pad)))
    if rng.random() < 0.2:
        sh = rng.uniform(0.05, 0.2); im = im.transform(im.size, Image.AFFINE, (1, sh, -sh * im.size[1] / 2, 0, 1, 0), resample=Image.BILINEAR, fillcolor=255)
    return synth.to_input(synth.augment(rng, im)), root + acc + q + bass

if __name__ == "__main__":
    import os, sys
    rng = random.Random(int(sys.argv[1]) if len(sys.argv) > 1 else 1); F = synth.text_fonts()
    os.makedirs("rb_samples", exist_ok=True)
    for i in range(30):
        r = render_rb(rng, F)
        if r: Image.fromarray(r[0]).save(f"rb_samples/{i:02d}_{r[1].replace('/', '_')}.png")
