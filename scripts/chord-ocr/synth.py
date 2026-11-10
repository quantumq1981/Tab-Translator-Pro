"""Synthetic chord-symbol images for training a small CTC recogniser.

A label is the chord exactly as DRAWN (visual characters): root, accidental (♯/♭ drawn from a
music-capable font, or '#'/'b' typed), a suffix in one of the spellings fake books use
(maj7 / Maj7 / MA7 / Δ7 / M7, m7 / mi7 / min7 / -7, °7, ø7 …), often raised and smaller, and an
optional /bass. Accidental glyphs ♯ ♭ are labelled '#' 'b' (the canonical form; the shape is the
font's business). Normalisation to the engine's names happens after recognition."""
import glob, io, math, os, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from fontTools.ttLib import TTFont

H = 32
CHARSET = "ABCDEFG" + "abdgijlmnostuM" + "0123456789" + "#/()+-,Δ°ø^"
FONT_DIR = os.environ.get("CHORD_OCR_FONTS", "fonts")   # see fetch_fonts.sh
HOLDOUT = {"Kalam-Regular.ttf", "Schoolbell.ttf"}          # + Liberation Serif (system) = eval only
SYS = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
       "/usr/share/fonts/truetype/freefont/FreeSerif.ttf", "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
       "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"]
ACC_FONTS = [f for f in SYS[:4]] + [os.path.join(FONT_DIR, "PetalumaScript.otf")]

def _cmap(path):
    try: return set(TTFont(path, fontNumber=0).getBestCmap())
    except Exception: return set()

def text_fonts(holdout=False):
    fs = sorted(glob.glob(os.path.join(FONT_DIR, "*.tt*")) + glob.glob(os.path.join(FONT_DIR, "*.otf")))
    fs = [f for f in fs if (os.path.basename(f) in HOLDOUT) == holdout]
    if not holdout: fs += [f for f in SYS if os.path.exists(f)]
    return [(f, _cmap(f)) for f in fs]

# quality spellings: (weight, [visual variants])
QUAL = [
    (30, [""]), (16, ["m", "mi", "min", "-"]), (14, ["7"]), (14, ["m7", "mi7", "min7", "-7"]),
    (12, ["maj7", "Maj7", "MA7", "Δ7", "M7", "ma7", "Δ"]), (5, ["maj9", "Δ9", "MA9", "Maj9"]),
    (6, ["9"]), (4, ["13"]), (5, ["m9", "mi9", "-9"]), (4, ["m11", "mi11", "-11"]),
    (6, ["m7b5", "ø7", "ø", "mi7b5", "m7(b5)", "-7b5", "mi7(b5)"]), (5, ["dim7", "°7", "o7"]), (3, ["dim", "°", "o"]),
    (6, ["7sus4", "7sus", "7(sus4)"]), (5, ["sus4", "sus"]), (2, ["sus2"]), (3, ["add9", "(add9)", "add2"]),
    (4, ["6"]), (3, ["m6", "mi6", "-6"]), (2, ["6/9", "69", "6(9)"]), (3, ["aug", "+", "(#5)"]),
    (4, ["7b9", "7(b9)"]), (3, ["7#9", "7(#9)"]), (2, ["7#5", "+7", "7(#5)", "7+"]), (2, ["7b5", "7(b5)"]),
    (2, ["7#11", "7(#11)"]), (2, ["13b9", "13(b9)"]), (2, ["9sus4", "9sus"]), (2, ["m(maj7)", "mMaj7", "-Δ7", "mi(ma7)"]),
    (2, ["7alt", "alt"]), (1, ["5"]), (1, ["maj7#11", "Δ7(#11)", "maj7(#11)"]), (1, ["7b9b13", "7(b9,b13)"]),
]
_QW = [w for w, _ in QUAL]

def sample_label(rng):
    root = rng.choice("ABCDEFG")
    acc = rng.choices(["", "#", "b"], [62, 16, 22])[0]
    q = rng.choice(rng.choices(QUAL, _QW)[0][1])
    bass = ""
    if rng.random() < 0.14:
        bass = "/" + rng.choice("ABCDEFG") + rng.choices(["", "#", "b"], [70, 12, 18])[0]
    return root, acc, q, bass

def _draw(draw, xy, s, font, fill):
    draw.text(xy, s, font=font, fill=fill, anchor="ls")
    return draw.textlength(s, font=font)

# things printed above a staff that are NOT chords: the recogniser must read them as nothing ("")
NON_CHORDS = ["Melody", "Verse", "Chorus", "Intro", "Bridge", "Outro", "Coda", "Fine", "Swing", "Medium Swing", "Ballad",
              "Bossa", "Latin", "Funk", "Piano", "Guitar", "Vocal", "Solo", "rit.", "a tempo", "D.S. al Coda", "D.C. al Fine",
              "To Coda", "Fine", "x2", "Repeat", "Tacet", "Slowly", "Moderately", "Freely", "Even 8ths", "Straight", "Shuffle",
              "Head", "Vamp", "Break", "Interlude", "the", "and", "love", "you", "night", "Ah", "Oh", "yeah", "baby"]

def render_other(rng, fonts):
    """A bar number (labelled with its digits), or a word / tempo mark (labelled empty)."""
    path, cmap = rng.choice(fonts)
    kind = rng.random()
    if kind < 0.55:
        txt = str(rng.choice([rng.randint(1, 9), rng.randint(10, 99), rng.randint(10, 99), rng.randint(100, 240)])); label = txt
    elif kind < 0.75:
        bpm = str(rng.randint(40, 260)); txt = rng.choice(["= " + bpm, "♩ = " + bpm, "♩= " + bpm, "q = " + bpm, "J = " + bpm]); label = ""
    else:
        txt = rng.choice(NON_CHORDS); label = ""
    size = rng.randint(28, 56)
    font = ImageFont.truetype(path, size)
    gfont = ImageFont.truetype(SYS[0], size)              # ♩ from DejaVu
    img = Image.new("L", (size * (len(txt) + 4), size * 3), 255)
    d = ImageDraw.Draw(img); ink = rng.randint(0, 70); x, base = size // 2, int(size * 1.9)
    for ch in txt: x += _draw(d, (x, base), ch, gfont if ch == "♩" or ord(ch) not in cmap else font, ink)
    if rng.random() < 0.5:                                   # italic (bar numbers usually are)
        sh = rng.uniform(0.15, 0.3); img = img.transform(img.size, Image.AFFINE, (1, sh, -sh * img.size[1] / 2, 0, 1, 0), resample=Image.BILINEAR, fillcolor=255)
    a = np.asarray(img); ys, xs = np.nonzero(a < 200)
    if len(xs) == 0: return None
    pad = rng.randint(2, 12)
    im = img.crop((max(0, xs.min() - pad), max(0, ys.min() - pad), min(a.shape[1], xs.max() + pad), min(a.shape[0], ys.max() + pad)))
    return to_input(augment(rng, im)), label

def render(rng, fonts, label=None):
    """→ (grey uint8 image H×W, label string)."""
    if label is None and rng.random() < 0.14: return render_other(rng, fonts)
    path, cmap = rng.choice(fonts)
    root, acc, q, bass = label or sample_label(rng)
    # glyph availability in the text font
    if any(ord(c) not in cmap for c in q if c in "Δ°ø"):
        q = {"Δ": "maj", "°": "dim", "ø": "m7b5"}.get(q[:1], "") + q[1:] if q[:1] in "Δ°ø" else q.replace("Δ", "maj").replace("°", "dim").replace("ø", "m7b5")
    size = rng.randint(34, 60)
    font = ImageFont.truetype(path, size)
    sup = rng.random() < 0.45                                    # raised, smaller suffix
    sfont = ImageFont.truetype(path, int(size * rng.uniform(0.6, 0.8))) if sup else font
    rise = int(size * rng.uniform(0.15, 0.4)) if sup else 0
    W = size * 14
    img = Image.new("L", (W, size * 3), 255)
    d = ImageDraw.Draw(img)
    ink = rng.randint(0, 70)
    x, base = size // 2, int(size * 1.9)
    x += _draw(d, (x, base), root, font, ink)

    def accidental(a, x, big):
        if not a: return x
        if rng.random() < 0.55:                                  # music glyph ♯ ♭
            g = {"#": "♯", "b": "♭"}[a]
            af = rng.choice(ACC_FONTS)
            f2 = ImageFont.truetype(af, int(size * rng.uniform(0.7, 1.0) * (1 if big else 0.85)))
            r2 = -int(size * rng.uniform(0.0, 0.35))
            return x + _draw(d, (x + rng.randint(-2, 3), base + r2), g, f2, ink) + rng.randint(0, 3)
        f2 = font if (big or rng.random() < 0.5) else sfont
        return x + _draw(d, (x, base - (rng.randint(0, size // 4) if rng.random() < 0.3 else 0)), a, f2, ink)
    x = accidental(acc, x, True)
    lab_q = q
    if q:
        x += rng.randint(-1, 4)
        for ch in q:                                              # suffix, flats/sharps in it typed
            x += _draw(d, (x, base - rise), ch, sfont, ink)
    if bass:
        x += rng.randint(1, 6)
        x += _draw(d, (x, base), "/", font, ink)
        x += _draw(d, (x, base), bass[1], font, ink)
        x = accidental(bass[2:], x, True)
    label = root + acc + lab_q + bass
    a = np.asarray(img)
    ys, xs = np.nonzero(a < 200)
    if len(xs) == 0: return None
    pad = rng.randint(2, 12)
    y0, y1 = max(0, ys.min() - pad), min(a.shape[0], ys.max() + pad)
    x0, x1 = max(0, xs.min() - pad), min(a.shape[1], xs.max() + pad)
    im = img.crop((x0, y0, x1, y1))
    if rng.random() < 0.15:
        sh = rng.uniform(0.1, 0.25); im = im.transform(im.size, Image.AFFINE, (1, sh, -sh * im.size[1] / 2, 0, 1, 0), resample=Image.BILINEAR, fillcolor=255)
    im = augment(rng, im)
    return to_input(im), label

def augment(rng, im):
    if rng.random() < 0.5: im = im.rotate(rng.uniform(-3, 3), resample=Image.BILINEAR, expand=True, fillcolor=255)
    if rng.random() < 0.3: im = im.filter(ImageFilter.MinFilter(3))              # bolder strokes
    elif rng.random() < 0.15: im = im.filter(ImageFilter.MaxFilter(3))
    # downscale (low resolution phone / scan), then back
    s = rng.uniform(0.4, 1.0)
    w, h = im.size
    im = im.resize((max(4, int(w * s)), max(4, int(h * s))), Image.BILINEAR)
    if rng.random() < 0.5: im = im.filter(ImageFilter.GaussianBlur(rng.uniform(0.2, 0.9)))
    a = np.asarray(im, dtype=np.float32)
    lo, hi = rng.uniform(0, 80), rng.uniform(170, 255)                           # contrast / paper tone
    a = lo + (hi - lo) * a / 255.0
    a += np.random.default_rng(rng.getrandbits(32)).normal(0, rng.uniform(0, 12), a.shape)
    if rng.random() < 0.25:                                                       # a staff line / stray stroke below
        y = int(a.shape[0] * rng.uniform(0.85, 1.0)) - 1
        t = 1 + rng.randint(0, 1)
        a[y:y + t, :] = np.minimum(a[y:y + t, :], rng.uniform(20, 90))
    im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    if rng.random() < 0.4:
        b = io.BytesIO(); im.save(b, "JPEG", quality=rng.randint(25, 85)); im = Image.open(io.BytesIO(b.getvalue())).convert("L")
    return im

def to_input(im, maxw=256):
    w, h = im.size
    nw = max(8, min(maxw, int(round(w * H / h))))
    return np.asarray(im.resize((nw, H), Image.BILINEAR), dtype=np.uint8)

if __name__ == "__main__":
    rng = random.Random(1)
    F = text_fonts()
    print(len(F), "training fonts;", len(text_fonts(True)), "held out")
    os.makedirs("synth_samples", exist_ok=True)
    for i in range(24):
        r = render(rng, F)
        if r: Image.fromarray(r[0]).save(f"synth_samples/{i:02d}_{r[1].replace('/', '_')}.png")
