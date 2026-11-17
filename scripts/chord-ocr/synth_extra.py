"""Synthetic images for the 2026-11-15 add-ons (docs/OMR-PLAN.md "Guitar books, N.C. and the chord-lane traps"):

* N.C. — the no-chord mark, printed in the chord lane with capital N, C and periods ("N.C.", sometimes
  "N.C.(A7)": the chord the melody implies, not played). Labelled as drawn; the engine reads it as no chord.
* Negatives the earlier mix lacked (labelled EMPTY): guitar-book text in or near the chord lane — P.M., H, P,
  sl., 1/2, full, 1 1/2, let ring, w/ bar, Gtr. 1, Rhy. Fig. 1, Riff A, 8va, loco, tacet, Ped., sim., cresc.,
  rit. … — and articulation marks drawn as strokes: the bend / marcato hat "Λ" (read "A" at 97 % before),
  accents ">", rows of hats, fermatas, tremolo / vibrato squiggles.
* Chords with the traps of a real crop (label unchanged): stems and beam fragments of rhythm slashes in the
  bottom 15 % of the 32-px crop, and a fret grid's nut bar under the baseline.
* Real Book layouts: altered extensions STACKED in two tiers ("#9" over "b13", labelled top tier first) and
  slash chords with a steep diagonal slash and a smaller bass dropped below the baseline.
All built on synth.py's fonts, augmentation and 32-px input."""
import math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import synth, synth_rb

# (no digit-only marks — "1/2", "1 1/2", "(3)", "8va": labelling digits EMPTY taught the reader to drop the "11" of
# "Gm11" — held-out handwriting −1 point; the chord grammar already rejects any reading of them without a root)
GUITAR_WORDS = ["P.M.", "P.M. - - -", "P.M. - - - - -", "H", "P", "H P", "sl.", "full", "full full",
                "let ring", "let ring - - -", "slow release", "w/ bar", "w/ bar - - -", "Gtr. 1", "Gtr. 2", "Gtrs. 1 & 2",
                "Rhy. Fig. 1", "End Rhy. Fig. 1", "w/ Rhy. Fig. 1", "Riff A", "End Riff A", "loco",
                "tacet", "Ped.", "sim.", "simile", "cresc.", "dim.", "decresc.", "rit.", "rall.", "accel.", "a tempo",
                "D.S. al Coda", "D.C. al Fine", "D.S.S. al Coda 2", "To Coda", "Fine", "Coda", "Outro", "Guitar Solo",
                "Moderately", "Slow Blues", "Moderate Rock", "Fade out", "Repeat and fade", "N.H.", "A.H.", "T", "tr",
                "Harm.", "pick scrape", "w/ slide", "divisi", "Free time", "Spoken:", "*", "**", "†", "x", "Verse", "Chorus", "Bridge", "Intro", "Interlude", "Pre-Chorus", "mf", "f", "p", "pp", "ff", "mp", "sfz"]

def _fonts(rng, fonts):
    hf, _ = synth_rb.hand_fonts(fonts)
    return rng.choice(hf if hf and rng.random() < 0.4 else fonts)

def _crop(rng, img, italic=0.0):
    if italic:
        img = img.transform(img.size, Image.AFFINE, (1, italic, -italic * img.size[1] / 2, 0, 1, 0), resample=Image.BILINEAR, fillcolor=255)
    a = np.asarray(img); ys, xs = np.nonzero(a < 200)
    if len(xs) == 0: return None
    pad = rng.randint(2, 12)
    return img.crop((max(0, xs.min() - pad), max(0, ys.min() - pad), min(a.shape[1], xs.max() + pad), min(a.shape[0], ys.max() + pad)))

def render_nc(rng, fonts):
    path, cmap = _fonts(rng, fonts)
    size = rng.randint(30, 60); font = ImageFont.truetype(path, size)
    img = Image.new("L", (size * 14, size * 3), 255); d = ImageDraw.Draw(img)
    ink = rng.randint(0, 70); x, base = size // 2, int(size * 1.9)
    dots = rng.random() < 0.3                                  # hand-made periods: small round dots
    label = "N.C."
    for ch in "N.C.":
        if ch == "." and dots:
            r = size * rng.uniform(0.05, 0.09); x += size * 0.08
            d.ellipse([x - r, base - 2 * r, x + r, base], fill=ink); x += r + size * rng.uniform(0.05, 0.15)
        else: x += synth._draw(d, (x, base), ch, font, ink)
    if rng.random() < 0.15:                                    # "N.C.(A7)": the implied harmony in parentheses
        root, acc, q, _ = synth.sample_label(rng)
        q = q if all(c in synth.CHARSET for c in q) and q and q[0] not in "(Δ°ø" else rng.choice(["", "7", "m7", "m"])
        inner = root + acc + q
        x += rng.randint(2, 10)
        for ch in "(" + inner + ")": x += synth._draw(d, (x, base), ch, font, ink)
        label += "(" + inner + ")"
    im = _crop(rng, img, rng.uniform(0.1, 0.25) if rng.random() < 0.25 else 0)
    return None if im is None else (synth.to_input(synth.augment(rng, im)), label)

def _hat(d, x, base, h, w, sw, ink, kind):
    if kind == "hat":   pts = [(x, base), (x + w / 2, base - h), (x + w, base)]
    elif kind == "vee": pts = [(x, base - h), (x + w / 2, base), (x + w, base - h)]
    elif kind == "acc": pts = [(x, base - h), (x + w, base - h / 2), (x, base)]
    else:               pts = [(x + i * w / 6, base - h / 2 + (h / 3) * (1 if i % 2 else -1)) for i in range(7)]   # squiggle
    synth_rb._stroke(d, pts, sw, ink)

def render_marks(rng, fonts):
    """Articulation marks above a staff, drawn as strokes: one or a row of hats / accents / squiggles,
    sometimes with a staccato dot or a fermata arc. Label empty."""
    size = rng.randint(30, 60)
    img = Image.new("L", (size * 12, size * 3), 255); d = ImageDraw.Draw(img)
    ink = rng.randint(0, 70); sw = max(1.5, size * rng.uniform(0.04, 0.1)); base = int(size * 1.9); x = size // 2
    kind = rng.choices(["hat", "vee", "acc", "sq"], [55, 10, 25, 10])[0]
    for _ in range(rng.choice([1, 1, 1, 2, 3, 4])):
        h = size * rng.uniform(0.35, 0.8); w = h * rng.uniform(0.6, 1.3)
        _hat(d, x, base, h, w, sw, ink, kind if rng.random() < 0.8 else rng.choice(["hat", "acc"]))
        if rng.random() < 0.3:                             # staccato dot under it
            r = sw * 0.9; d.ellipse([x + w / 2 - r, base + size * 0.15, x + w / 2 + r, base + size * 0.15 + 2 * r], fill=ink)
        x += w + size * rng.uniform(0.1, 0.9)
    if rng.random() < 0.15:                                # a fermata arc
        cx = size; d.arc([cx - size * 0.5, base - size * 1.2, cx + size * 0.5, base - size * 0.2], 180, 360, fill=ink, width=int(sw))
    im = _crop(rng, img)
    # (no stray line under it: a hat over a line is the Δ of a major seventh)
    return None if im is None else (synth.to_input(synth.augment(rng, im, line=False)), "")

def render_words(rng, fonts):
    path, cmap = _fonts(rng, fonts)
    txt = rng.choice(GUITAR_WORDS)
    if any(ord(c) not in cmap for c in txt if c not in " "): path, cmap = synth.SYS[0], None
    size = rng.randint(28, 56); font = ImageFont.truetype(path, size)
    img = Image.new("L", (size * (len(txt) + 4), size * 3), 255); d = ImageDraw.Draw(img)
    ink = rng.randint(0, 70); x, base = size // 2, int(size * 1.9)
    for ch in txt: x += synth._draw(d, (x, base), ch, font, ink)
    im = _crop(rng, img, rng.uniform(0.12, 0.3) if rng.random() < 0.5 else 0)
    return None if im is None else (synth.to_input(synth.augment(rng, im)), "")

def add_clutter(rng, a):
    """A chord crop (32-px uint8) with what a real crop catches under the baseline: rhythm-slash stems and beam
    fragments in the bottom 15 % (kept off the letters), or a fret grid's nut bar across the bottom rows."""
    a = a.astype(np.float32).copy(); H, W = a.shape; ink = rng.uniform(10, 90)
    kind = rng.choice(["stems", "beam", "nut"])
    if kind == "stems":
        for _ in range(rng.randint(1, 4)):
            x = rng.randint(0, W - 2); top = H - rng.randint(3, 6)
            a[top:, x:x + rng.choice([1, 1, 2])] = ink
    elif kind == "beam":
        x0 = rng.randint(0, max(1, W - 12)); L = rng.randint(8, max(9, W // 2)); y0 = H - rng.randint(2, 5); slope = rng.uniform(-0.2, 0.2)
        for x in range(x0, min(W, x0 + L)):
            y = int(round(y0 + slope * (x - x0)))
            a[max(0, y - 1):min(H, y + 1), x] = ink
    else:
        t = rng.randint(2, 4); y = H - t - rng.randint(0, 2)
        a[y:y + t, :] = ink
    return np.clip(a, 0, 255).astype(np.uint8)

STACK = [("#9", "b13"), ("b9", "b13"), ("#9", "#5"), ("b9", "#11"), ("#9", "b5"), ("b9", "#5"), ("#11", "b9"), ("b13", "#9")]

def render_stacked(rng, fonts):
    """Real Book: root + 7 + an alteration pair stacked in two tiers inside one box (top tier labelled first)."""
    path, cmap = _fonts(rng, fonts)
    size = rng.randint(40, 62); font = ImageFont.truetype(path, size)
    sfont = ImageFont.truetype(path, max(12, int(size * rng.uniform(0.4, 0.55))))
    root = rng.choice("ABCDEFG"); acc = rng.choices(["", "#", "b"], [60, 15, 25])[0]
    q = rng.choice(["7", "7", "13", "9"]) if rng.random() < 0.9 else "7"
    top, bot = rng.choice(STACK)
    img = Image.new("L", (size * 10, size * 3), 255); d = ImageDraw.Draw(img); ink = rng.randint(0, 60)
    base = int(size * 1.9); x = size // 2
    x += synth._draw(d, (x, base), root, font, ink)
    if acc: x += synth._draw(d, (x, base), acc, font, ink)
    cap = -font.getbbox(root, anchor="ls")[1]
    x += rng.randint(0, 3)
    x += synth._draw(d, (x, base - int(cap * rng.uniform(0.3, 0.5))), q, sfont, ink) + rng.randint(1, 4)
    scap = -sfont.getbbox("9", anchor="ls")[1]
    yt = base - cap + scap + rng.randint(-3, 2); yb = yt + scap + rng.randint(1, 5)        # two tiers spanning the root's height
    w1 = sum(sfont.getlength(c) for c in top); w2 = sum(sfont.getlength(c) for c in bot)
    xa = x + rng.uniform(-0.1, 0.1) * w1; xb = x + rng.uniform(-0.1, 0.1) * w2
    for ch in top: xa += synth._draw(d, (xa, yt), ch, sfont, ink)
    for ch in bot: xb += synth._draw(d, (xb, yb), ch, sfont, ink)
    im = _crop(rng, img)
    return None if im is None else (synth.to_input(synth.augment(rng, im)), root + acc + q + top + bot)

def render_diag_slash(rng, fonts):
    """A slash chord with a steep diagonal slash and a smaller bass dropped below the baseline (Real Book)."""
    path, cmap = _fonts(rng, fonts)
    size = rng.randint(40, 62); font = ImageFont.truetype(path, size)
    bfont = ImageFont.truetype(path, max(12, int(size * rng.uniform(0.55, 0.8))))
    root, acc, q, _ = synth.sample_label(rng)
    if not all(c in synth.CHARSET for c in q) or any(c in "Δ°ø" and ord(c) not in cmap for c in q): q = rng.choice(["", "m7", "7", "maj7", "m"])
    bass = rng.choice("ABCDEFG") + rng.choices(["", "#", "b"], [70, 12, 18])[0]
    img = Image.new("L", (size * 14, size * 3), 255); d = ImageDraw.Draw(img); ink = rng.randint(0, 60)
    base = int(size * 1.9); x = size // 2
    for ch in root + acc + q: x += synth._draw(d, (x, base), ch, font, ink)
    cap = -font.getbbox("C", anchor="ls")[1]; drop = int(cap * rng.uniform(0.25, 0.6))
    ang = math.radians(rng.uniform(55, 72)); top = base - cap * rng.uniform(0.6, 1.0); bot = base + drop
    sw = max(2, size * rng.uniform(0.04, 0.08)); x0 = x + rng.randint(0, 4); x1 = x0 + (bot - top) / math.tan(ang)
    synth_rb._stroke(d, [(x1, top), (x0, bot)], sw, ink)
    x = max(x0, x1) + rng.randint(1, 5)
    for ch in bass: x += synth._draw(d, (x, base + drop), ch, bfont, ink)
    im = _crop(rng, img)
    return None if im is None else (synth.to_input(synth.augment(rng, im)), root + acc + q + "/" + bass)

def render_extra(rng, fonts):
    k = rng.random()
    if k < 0.24: return render_nc(rng, fonts)
    if k < 0.40: return render_marks(rng, fonts)
    if k < 0.60: return render_words(rng, fonts)
    if k < 0.78:
        r = synth_rb.render_rb(rng, fonts) if rng.random() < 0.3 else synth.render(rng, fonts)
        return None if not r or not r[1] else (add_clutter(rng, r[0]), r[1])
    if k < 0.86: return render_stacked(rng, fonts)
    return render_diag_slash(rng, fonts)

if __name__ == "__main__":
    import os, sys
    rng = random.Random(int(sys.argv[1]) if len(sys.argv) > 1 else 1); F = synth.text_fonts()
    os.makedirs("extra_samples", exist_ok=True)
    for i in range(48):
        r = render_extra(rng, F)
        if r: Image.fromarray(r[0]).save(f"extra_samples/{i:02d}_{(r[1] or 'EMPTY').replace('/', '_')}.png")
