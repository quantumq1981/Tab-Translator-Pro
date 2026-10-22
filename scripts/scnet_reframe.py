# SCNet at a shorter fixed time window — the phone ("low-memory") separator model.
#
#   python3 -I scripts/scnet_reframe.py scnet.int8.onnx 120 models/scnet-compact/scnet-f120.int8.onnx
#
# Input: the pinned upstream file (huggingface.co/audiojs/scnet, revision
# e71bcdb42bce1d62b7fae25ba90fcbcf90f73f46, scnet.int8.onnx, SHA-256 98228931…0845). It takes a
# FIXED 476-frame (11 s) spectrogram, and one model run needs ~1.3 GB of activations — more than an
# iPhone Safari tab is allowed, so iOS kills the page a few % into the first split.
#
# SCNet's time-axis block is an ORTHONORMAL rfft / irfft written as MatMuls with fixed DFT matrices
# (no learned values — this script checks they reproduce to < 1e-6 before touching anything), plus
# shape constants that bake in 476 frames and 239 rfft bins. Regenerating those four matrices for F
# frames and patching the shapes re-instantiates the SAME network for a shorter window; every learned
# weight is untouched. Activation memory scales with F. Measured (CLAUDE.md, v2.1 → "Phones"):
# F=120 (2.8 s) peaks ~0.65 GB per run vs ~1.8 GB, for ~2 dB less SDR per stem.
# Deterministic: the same input + F always produce the same bytes (the app pins the output SHA-256).
import onnx, numpy as np, sys, hashlib
from onnx import numpy_helper
src, F, dst = sys.argv[1], int(sys.argv[2]), sys.argv[3]
UPSTREAM_SHA256 = "98228931494151762a1c4ab1ec7899a894b1f81fd4a509921a9d2f9bacc50845"
got = hashlib.sha256(open(src, "rb").read()).hexdigest()
assert got == UPSTREAM_SHA256, f"{src} is not the pinned upstream SCNet (sha256 {got})"
assert F % 2 == 0 and 8 <= F <= 476, "F must be even, 8..476"
T = 476
def fwd(N):   # [N, N/2+1]: x @ C = Re, x @ S = Im of rfft(x, norm="ortho")
    n = np.arange(N)[:, None]; k = np.arange(N // 2 + 1)[None, :]
    return np.cos(2*np.pi*n*k/N)/np.sqrt(N), -np.sin(2*np.pi*n*k/N)/np.sqrt(N)
def inv(N):   # [N/2+1, N]: Re @ C + Im @ S = irfft(X, n=N, norm="ortho")
    k = np.arange(N // 2 + 1)[:, None]; n = np.arange(N)[None, :]
    c = np.where((k == 0) | (k == N // 2), 1.0, 2.0)
    return c*np.cos(2*np.pi*k*n/N)/np.sqrt(N), -c*np.sin(2*np.pi*k*n/N)/np.sqrt(N)
m = onnx.load(src); g = m.graph
fC, fS = fwd(T); iC, iS = inv(T); FC, FS = fwd(F); IC, IS = inv(F)
dft = {}
for t in g.initializer:
    if tuple(t.dims) in ((T, T//2+1), (T//2+1, T)):
        a = numpy_helper.to_array(t).astype(np.float64)
        for name, ref, new in (("fwd cos", fC, FC), ("fwd sin", fS, FS), ("inv cos", iC, IC), ("inv sin", iS, IS)):
            if ref.shape == a.shape and np.abs(a - ref).max() < 1e-6:
                dft[t.name] = (name, np.abs(a - ref).max(), new)
assert len(dft) == 4, f"expected 4 DFT matrices, matched {len(dft)}: {list(dft)}"
for k, (nm, err, _) in dft.items(): print(f"  {k}: {nm} reproduced, max err {err:.1e}")
n = 0
def fix(a):
    global n
    if a.dtype.kind not in "iu" or a.size > 16: return None
    v = a.flatten().tolist()
    if T not in v and T // 2 + 1 not in v: return None
    b = a.copy(); b[a == T] = F; b[a == T // 2 + 1] = F // 2 + 1; n += 1; return b
for i, t in enumerate(g.initializer):
    if t.name in dft:
        g.initializer[i].CopyFrom(numpy_helper.from_array(dft[t.name][2].astype(np.float32), t.name)); continue
    b = fix(numpy_helper.to_array(t))
    if b is not None: g.initializer[i].CopyFrom(numpy_helper.from_array(b, t.name))
for nd in g.node:
    if nd.op_type == "Constant":
        for at in nd.attribute:
            if at.name == "value":
                b = fix(numpy_helper.to_array(at.t))
                if b is not None: at.t.CopyFrom(numpy_helper.from_array(b, at.t.name))
g.input[0].type.tensor_type.shape.dim[3].dim_value = F
del g.value_info[:]
onnx.checker.check_model(m); onnx.save(m, dst); print(f"F={F}: 4 DFT matrices regenerated, {n} shape constants patched → {dst}")
