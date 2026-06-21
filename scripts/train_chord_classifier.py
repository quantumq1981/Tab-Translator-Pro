#!/usr/bin/env python3
"""Train the chord-QUALITY "second opinion" classifier — dependency-free.

Roadmap Wave 3 #10 (Phase 3): push the pure-JS brain as far as it goes WITHIN the
iOS/no-terminal envelope — the rule-based engine (`QUALITIES`) stays the ORACLE; this
is a confidence-gated second opinion consulted only when the engine is unsure.

This pass:
  * vocabulary 14 -> 22, matching the engine's recognizable qualities (adds the
    9ths/altered/add9/6-9/m(maj7) family).
  * a wider 2-layer MLP (tanh hidden, softmax out) for the extra capacity those
    overlapping 5-note templates need.
  * more REALISTIC augmentation: overtone bleed (a note's 5th/major-3rd partials
    leak energy into the chroma, like an audio-derived profile) + partial voicings
    + spurious tones + per-sample gain — so the model is robust on messy input.

Dependency-free ON PURPOSE (no numpy/sklearn/torch here, no pip): hand-rolled
forward + backprop (momentum) in stdlib only, seeded, re-runnable. The JS side
(`classifyChromaQuality`) mirrors this exact forward pass — pure matmul, immune to the
COOP/COEP WASM-thread wall on GitHub Pages — so a real .onnx of the SAME shape swaps in
later behind the unchanged arbiter (if a heavy model ever justifies a runtime).

Run:  python3 scripts/train_chord_classifier.py  > scripts/chord-classifier.json
"""
import json, math, random

SEED = 11
random.seed(SEED)

# class -> (engine QUALITIES suffix, root-relative pitch classes present)
QUALITIES = [
    ("maj",    "",        [0, 4, 7]),
    ("min",    "m",       [0, 3, 7]),
    ("dom7",   "7",       [0, 4, 7, 10]),
    ("maj7",   "maj7",    [0, 4, 7, 11]),
    ("min7",   "m7",      [0, 3, 7, 10]),
    ("dim",    "dim",     [0, 3, 6]),
    ("aug",    "aug",     [0, 4, 8]),
    ("sus4",   "sus4",    [0, 5, 7]),
    ("sus2",   "sus2",    [0, 2, 7]),
    ("maj6",   "6",       [0, 4, 7, 9]),
    ("min6",   "m6",      [0, 3, 7, 9]),
    ("m7b5",   "m7♭5",   [0, 3, 6, 10]),
    ("dim7",   "dim7",    [0, 3, 6, 9]),
    ("7sus4",  "7sus4",   [0, 5, 7, 10]),
    ("add9",   "add9",    [0, 2, 4, 7]),
    ("mMaj7",  "m(maj7)", [0, 3, 7, 11]),
    ("six9",   "6/9",     [0, 2, 4, 7, 9]),
    ("dom9",   "9",       [0, 2, 4, 7, 10]),
    ("min9",   "m9",      [0, 2, 3, 7, 10]),
    ("maj9",   "maj9",    [0, 2, 4, 7, 11]),
    ("dom7b9", "7♭9",    [0, 1, 4, 7, 10]),
    ("dom7s9", "7♯9",    [0, 3, 4, 7, 10]),
]
K, D, H = len(QUALITIES), 12, 28
N_PER_CLASS = 150
EPOCHS = 320
LR = 0.5
L2 = 1e-4
MOM = 0.9


def maxnorm(x):
    m = max(x) or 1.0
    return [v / m for v in x]


def synth(tones):
    """A noisy, root-relative weighted-chroma sample (audio-ish profile)."""
    x = [random.uniform(0.0, 0.12) for _ in range(D)]            # background noise
    for t in tones:
        e = random.uniform(0.55, 1.0)
        x[t] += e
        if random.random() < 0.5:                                # overtone bleed: 5th
            x[(t + 7) % D] += e * random.uniform(0.05, 0.22)
        if random.random() < 0.3:                                # overtone bleed: maj 3rd
            x[(t + 4) % D] += e * random.uniform(0.04, 0.16)
    drop = [t for t in tones if t != 0]
    if drop and random.random() < 0.30:                          # omit a non-root tone
        x[random.choice(drop)] *= random.uniform(0.0, 0.25)
    if random.random() < 0.22:                                   # a spurious/ringing tone
        nonc = [p for p in range(D) if p not in tones]
        x[random.choice(nonc)] += random.uniform(0.2, 0.5)
    return maxnorm(x)


def build(n_per, seed=None):
    if seed is not None:
        random.seed(seed)
    X, Y = [], []
    for ci, (_, _, tones) in enumerate(QUALITIES):
        for _ in range(n_per):
            X.append(synth(tones)); Y.append(ci)
    return X, Y


def xavier(fin, fout):
    r = math.sqrt(6.0 / (fin + fout))
    return [[random.uniform(-r, r) for _ in range(fin)] for _ in range(fout)]


W1 = xavier(D, H); b1 = [0.0] * H
W2 = xavier(H, K); b2 = [0.0] * K
vW1 = [[0.0] * D for _ in range(H)]; vb1 = [0.0] * H
vW2 = [[0.0] * H for _ in range(K)]; vb2 = [0.0] * K


def forward(x):
    h = [0.0] * H
    for j in range(H):
        row = W1[j]; s = b1[j]
        for i in range(D):
            s += row[i] * x[i]
        h[j] = math.tanh(s)
    z = [0.0] * K
    for k in range(K):
        row = W2[k]; s = b2[k]
        for j in range(H):
            s += row[j] * h[j]
        z[k] = s
    m = max(z); e = [math.exp(v - m) for v in z]; tot = sum(e)
    return h, [v / tot for v in e]


X, Y = build(N_PER_CLASS)
N = len(X)
for ep in range(EPOCHS):
    gW1 = [[0.0] * D for _ in range(H)]; gb1 = [0.0] * H
    gW2 = [[0.0] * H for _ in range(K)]; gb2 = [0.0] * K
    for x, y in zip(X, Y):
        h, p = forward(x)
        dz = [p[k] - (1.0 if k == y else 0.0) for k in range(K)]
        for k in range(K):
            gb2[k] += dz[k]; row = gW2[k]; dzk = dz[k]
            for j in range(H):
                row[j] += dzk * h[j]
        for j in range(H):
            s = 0.0
            for k in range(K):
                s += dz[k] * W2[k][j]
            da = s * (1.0 - h[j] * h[j])
            gb1[j] += da; row = gW1[j]
            for i in range(D):
                row[i] += da * x[i]
    for k in range(K):
        vb2[k] = MOM * vb2[k] - LR * gb2[k] / N; b2[k] += vb2[k]
        r2, gr2, vr2 = W2[k], gW2[k], vW2[k]
        for j in range(H):
            vr2[j] = MOM * vr2[j] - LR * (gr2[j] / N + L2 * r2[j]); r2[j] += vr2[j]
    for j in range(H):
        vb1[j] = MOM * vb1[j] - LR * gb1[j] / N; b1[j] += vb1[j]
        r1, gr1, vr1 = W1[j], gW1[j], vW1[j]
        for i in range(D):
            vr1[i] = MOM * vr1[i] - LR * (gr1[i] / N + L2 * r1[i]); r1[i] += vr1[i]

# ---- held-out accuracy + per-class canonical (clean template) check ----------
Xh, Yh = build(150, seed=SEED + 100)
correct = sum(1 for x, y in zip(Xh, Yh) if max(range(K), key=lambda k: forward(x)[1][k]) == y)
clean_ok, fails = 0, []
for ci, (nm, _, tones) in enumerate(QUALITIES):
    cx = maxnorm([1.0 if p in tones else 0.0 for p in range(D)])
    pred = max(range(K), key=lambda k: forward(cx)[1][k])
    if pred == ci:
        clean_ok += 1
    else:
        fails.append(f"{nm}->{QUALITIES[pred][0]}")

import sys
print(f"heldout={correct/len(Xh):.4f} canonical={clean_ok}/{K} fails={fails}", file=sys.stderr)

rnd = lambda v: round(v, 5)
out = {
    "_comment": "code-gen'd by scripts/train_chord_classifier.py (Wave 3 #10). 2-layer MLP "
                "(tanh hidden, softmax) chord-quality second opinion. Engine QUALITIES stays "
                "the oracle; consulted only when unsure. Input = max-normalised ROOT-RELATIVE "
                "12-d chroma. Pure-JS forward in classifyChromaQuality mirrors this exactly.",
    "seed": SEED, "arch": "mlp", "hidden": H, "norm": "max",
    "heldout_accuracy": round(correct / len(Xh), 4),
    "canonical_correct": f"{clean_ok}/{K}",
    "classes": [s for _, s, _ in QUALITIES],
    "names":   [n for n, _, _ in QUALITIES],
    "W1": [[rnd(v) for v in row] for row in W1], "b1": [rnd(v) for v in b1],
    "W2": [[rnd(v) for v in row] for row in W2], "b2": [rnd(v) for v in b2],
}
print(json.dumps(out, indent=2))
