#!/usr/bin/env python3
"""Train the chord-QUALITY "second opinion" classifier — dependency-free.

Why this exists (Roadmap Wave 3 #10): the rule-based engine (`QUALITIES`) is the
ORACLE and works on a binary 12-bit pitch-class SET, where it is deterministic and
near-optimal. A probabilistic classifier adds value only on a *weighted / noisy*
chroma (duration-weighted, tones partial or missing) — exactly the engine's honest
limits. So this trains a small multinomial logistic regression (a single linear
layer: `logits = W·x + b`, then softmax) over ROOT-RELATIVE 12-d chroma profiles.

The output is just the weight matrix `W` (K×12) + bias `b` (K) as JSON. That is the
"mathematical brain" — a pure-JS matmul+softmax reproduces it exactly (no ONNX
runtime, no WASM threads, immune to the COOP/COEP wall on GitHub Pages). When a real
`.onnx` is trained later, only the inner matmul in `classifyChromaQuality` swaps; the
weights here are the testable, iOS-safe bridge.

Dependency-free ON PURPOSE: this container has no numpy/sklearn and can't pip-install,
and keeping it stdlib-only means anyone can re-run it to reproduce the weights.

Run:  python3 scripts/train_chord_classifier.py  > scripts/chord-classifier.json
"""
import json, math, random

SEED = 42
random.seed(SEED)

# class label -> (engine QUALITIES suffix, root-relative pitch classes present)
QUALITIES = [
    ("maj",  "",     [0, 4, 7]),
    ("min",  "m",    [0, 3, 7]),
    ("dom7", "7",    [0, 4, 7, 10]),
    ("maj7", "maj7", [0, 4, 7, 11]),
    ("min7", "m7",   [0, 3, 7, 10]),
    ("dim",  "dim",  [0, 3, 6]),
    ("aug",  "aug",  [0, 4, 8]),
    ("sus4", "sus4", [0, 5, 7]),
]
K, D = len(QUALITIES), 12
N_PER_CLASS = 220
EPOCHS = 240
LR = 0.5
L2 = 1e-3


def maxnorm(x):
    m = max(x) or 1.0
    return [v / m for v in x]


def synth(tones):
    """A noisy, root-relative weighted-chroma sample for a chord with `tones`."""
    x = [random.uniform(0.0, 0.15) for _ in range(D)]          # background noise
    for t in tones:
        x[t] += random.uniform(0.55, 1.0)                       # chord-tone energy
    # dropout: sometimes a non-root chord tone is missing (e.g. omitted 5th)
    drop = [t for t in tones if t != 0]
    if drop and random.random() < 0.30:
        x[random.choice(drop)] *= random.uniform(0.0, 0.25)
    # spurious: sometimes a passing/ringing non-chord tone
    if random.random() < 0.25:
        nonc = [p for p in range(D) if p not in tones]
        x[random.choice(nonc)] += random.uniform(0.25, 0.55)
    return maxnorm(x)


# ---- dataset --------------------------------------------------------------
X, Y = [], []
for ci, (_, _, tones) in enumerate(QUALITIES):
    for _ in range(N_PER_CLASS):
        X.append(synth(tones)); Y.append(ci)

# ---- model: W[K][D], b[K]; full-batch softmax regression via GD -----------
W = [[0.0] * D for _ in range(K)]
b = [0.0] * K


def forward(x):
    z = [sum(W[k][j] * x[j] for j in range(D)) + b[k] for k in range(K)]
    m = max(z)
    e = [math.exp(zk - m) for zk in z]
    s = sum(e)
    return [ek / s for ek in e]


N = len(X)
for ep in range(EPOCHS):
    gW = [[0.0] * D for _ in range(K)]
    gb = [0.0] * K
    for x, y in zip(X, Y):
        p = forward(x)
        for k in range(K):
            d = p[k] - (1.0 if k == y else 0.0)               # softmax CE gradient
            gb[k] += d
            wk, xk = gW[k], x
            for j in range(D):
                wk[j] += d * xk[j]
    for k in range(K):
        b[k] -= LR * gb[k] / N
        for j in range(D):
            W[k][j] -= LR * (gW[k][j] / N + L2 * W[k][j])      # + L2 weight decay

# ---- report accuracy on freshly-synth'd held-out samples ------------------
correct = 0; total = 0
random.seed(SEED + 1)
for ci, (_, _, tones) in enumerate(QUALITIES):
    for _ in range(200):
        p = forward(synth(tones))
        if p.index(max(p)) == ci:
            correct += 1
        total += 1

rnd = lambda v: round(v, 5)
out = {
    "_comment": "code-gen'd by scripts/train_chord_classifier.py (Wave 3 #10). "
                "Pure matmul+softmax brain for the chord-quality second opinion. "
                "Engine QUALITIES stays the oracle; this is consulted only when the "
                "engine is unsure. Input = max-normalised ROOT-RELATIVE 12-d chroma.",
    "seed": SEED,
    "heldout_accuracy": round(correct / total, 4),
    "classes": [s for _, s, _ in QUALITIES],     # engine QUALITIES suffixes ("" = major)
    "names":   [n for n, _, _ in QUALITIES],
    "norm": "max",
    "W": [[rnd(v) for v in row] for row in W],
    "b": [rnd(v) for v in b],
}
print(json.dumps(out, indent=2))
