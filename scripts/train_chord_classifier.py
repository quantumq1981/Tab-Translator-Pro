#!/usr/bin/env python3
"""Train the chord-QUALITY "second opinion" classifier — dependency-free.

Roadmap Wave 3 #10, Phase 2 step 2: a STRONGER model behind the unchanged seam.
The rule-based engine (`QUALITIES`) is the ORACLE; this is a confidence-gated
second opinion consulted only when the engine is unsure (rootless / partial /
noisy voicings).

Upgrades vs Phase 1:
  * architecture: linear softmax  ->  a small 2-layer MLP (tanh hidden, softmax out).
    Nonlinear capacity separates the overlapping templates (dim/dim7/m7b5, 6/maj7…).
  * vocabulary: 8 -> 14 well-separated qualities.

Still dependency-free ON PURPOSE (no numpy/sklearn/torch in this container, no pip):
hand-rolled forward + backprop in stdlib only, seeded, re-runnable to reproduce the
weights. The JS side (`classifyChromaQuality`) mirrors this exact forward pass — a
pure matmul, immune to the COOP/COEP WASM-thread wall on GitHub Pages — so a real
.onnx of the SAME shape swaps in later behind the unchanged arbiter.

Run:  python3 scripts/train_chord_classifier.py  > scripts/chord-classifier.json
"""
import json, math, random

SEED = 7
random.seed(SEED)

# class -> (engine QUALITIES suffix, root-relative pitch classes present)
QUALITIES = [
    ("maj",    "",      [0, 4, 7]),
    ("min",    "m",     [0, 3, 7]),
    ("dom7",   "7",     [0, 4, 7, 10]),
    ("maj7",   "maj7",  [0, 4, 7, 11]),
    ("min7",   "m7",    [0, 3, 7, 10]),
    ("dim",    "dim",   [0, 3, 6]),
    ("aug",    "aug",   [0, 4, 8]),
    ("sus4",   "sus4",  [0, 5, 7]),
    ("maj6",   "6",     [0, 4, 7, 9]),
    ("min6",   "m6",    [0, 3, 7, 9]),
    ("m7b5",   "m7♭5", [0, 3, 6, 10]),
    ("dim7",   "dim7",  [0, 3, 6, 9]),
    ("sus2",   "sus2",  [0, 2, 7]),
    ("7sus4",  "7sus4", [0, 5, 7, 10]),
]
K, D, H = len(QUALITIES), 12, 16
N_PER_CLASS = 160
EPOCHS = 300
LR = 0.4
L2 = 1e-4
MOM = 0.85


def maxnorm(x):
    m = max(x) or 1.0
    return [v / m for v in x]


def synth(tones):
    """A noisy, root-relative weighted-chroma sample for a chord with `tones`."""
    x = [random.uniform(0.0, 0.15) for _ in range(D)]            # background noise
    for t in tones:
        x[t] += random.uniform(0.55, 1.0)                        # chord-tone energy
    drop = [t for t in tones if t != 0]
    if drop and random.random() < 0.30:                          # omit a non-root tone
        x[random.choice(drop)] *= random.uniform(0.0, 0.25)
    if random.random() < 0.25:                                   # a spurious/ringing tone
        nonc = [p for p in range(D) if p not in tones]
        x[random.choice(nonc)] += random.uniform(0.25, 0.55)
    return maxnorm(x)


def build(n_per):
    X, Y = [], []
    for ci, (_, _, tones) in enumerate(QUALITIES):
        for _ in range(n_per):
            X.append(synth(tones)); Y.append(ci)
    return X, Y


# ---- model: x(12) -> tanh(W1 x + b1) (H) -> W2 h + b2 (K) -> softmax ----------
def xavier(fin, fout):
    r = math.sqrt(6.0 / (fin + fout))
    return [[random.uniform(-r, r) for _ in range(fin)] for _ in range(fout)]


W1 = xavier(D, H); b1 = [0.0] * H
W2 = xavier(H, K); b2 = [0.0] * K
vW1 = [[0.0] * D for _ in range(H)]; vb1 = [0.0] * H
vW2 = [[0.0] * H for _ in range(K)]; vb2 = [0.0] * K


def forward(x):
    a1 = [sum(W1[j][i] * x[i] for i in range(D)) + b1[j] for j in range(H)]
    h = [math.tanh(v) for v in a1]
    z = [sum(W2[k][j] * h[j] for j in range(H)) + b2[k] for k in range(K)]
    m = max(z); e = [math.exp(v - m) for v in z]; s = sum(e)
    return h, [v / s for v in e]


X, Y = build(N_PER_CLASS)
N = len(X)
for ep in range(EPOCHS):
    gW1 = [[0.0] * D for _ in range(H)]; gb1 = [0.0] * H
    gW2 = [[0.0] * H for _ in range(K)]; gb2 = [0.0] * K
    for x, y in zip(X, Y):
        h, p = forward(x)
        dz = [p[k] - (1.0 if k == y else 0.0) for k in range(K)]      # softmax-CE grad
        for k in range(K):
            gb2[k] += dz[k]
            row = gW2[k]
            for j in range(H):
                row[j] += dz[k] * h[j]
        dh = [sum(dz[k] * W2[k][j] for k in range(K)) for j in range(H)]
        da1 = [dh[j] * (1.0 - h[j] * h[j]) for j in range(H)]         # tanh'
        for j in range(H):
            gb1[j] += da1[j]
            row = gW1[j]
            for i in range(D):
                row[i] += da1[j] * x[i]
    for k in range(K):
        vb2[k] = MOM * vb2[k] - LR * gb2[k] / N
        b2[k] += vb2[k]
        for j in range(H):
            vW2[k][j] = MOM * vW2[k][j] - LR * (gW2[k][j] / N + L2 * W2[k][j])
            W2[k][j] += vW2[k][j]
    for j in range(H):
        vb1[j] = MOM * vb1[j] - LR * gb1[j] / N
        b1[j] += vb1[j]
        for i in range(D):
            vW1[j][i] = MOM * vW1[j][i] - LR * (gW1[j][i] / N + L2 * W1[j][i])
            W1[j][i] += vW1[j][i]

# ---- held-out accuracy (fresh synth, different seed) -------------------------
random.seed(SEED + 100)
Xh, Yh = build(200)
correct = sum(1 for x, y in zip(Xh, Yh) if max(range(K), key=lambda k: forward(x)[1][k]) == y)
# canonical (clean) per-class check
clean_ok = 0
for ci, (_, _, tones) in enumerate(QUALITIES):
    cx = maxnorm([1.0 if p in tones else 0.0 for p in range(D)])
    if max(range(K), key=lambda k: forward(cx)[1][k]) == ci:
        clean_ok += 1

rnd = lambda v: round(v, 5)
out = {
    "_comment": "code-gen'd by scripts/train_chord_classifier.py (Wave 3 #10 Phase 2). "
                "2-layer MLP brain (tanh hidden, softmax out) for the chord-quality "
                "second opinion. Engine QUALITIES stays the oracle; consulted only when "
                "the engine is unsure. Input = max-normalised ROOT-RELATIVE 12-d chroma.",
    "seed": SEED, "arch": "mlp", "hidden": H, "norm": "max",
    "heldout_accuracy": round(correct / len(Xh), 4),
    "canonical_correct": f"{clean_ok}/{K}",
    "classes": [s for _, s, _ in QUALITIES],
    "names":   [n for n, _, _ in QUALITIES],
    "W1": [[rnd(v) for v in row] for row in W1], "b1": [rnd(v) for v in b1],
    "W2": [[rnd(v) for v in row] for row in W2], "b2": [rnd(v) for v in b2],
}
print(json.dumps(out, indent=2))
