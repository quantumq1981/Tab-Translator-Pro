"""guitar_crnn_export.py — rebuild models/guitar-crnn/guitar-gaps.w8.onnx from the pinned upstream weights.

Dev-only. Nothing here ships except the .onnx it writes.

Source (all MIT):
  * weights: Hugging Face xavriley/midi-transcription-models @ b7bec65a2b860aca72856b0feef58b5df407b777,
    file guitar-gaps.pth (SHA-256 65483e7c0e340a90415b15b520687587698c8c728f5fa470a205f13ee45c6513) —
    Riley et al.'s guitar retraining (GAPS, arXiv 2408.08653) of
  * the model: Kong et al.'s Regress_onset_offset_frame_velocity_CRNN, from
    github.com/xavriley/piano_transcription_inference @ 7568dc7f78b625e40cf9776e2806d164006610e3.

Steps:
  1. Export the fixed 10 s / 16 kHz graph to ONNX (opset 17) — the window the reference
     inference uses. It matches PyTorch to ≤ 3e-6. (Gotcha: export the wrapper in eval mode —
     torch.onnx.export restores the module's original mode afterwards, and a fresh Module is in
     training mode, which turns dropout back on for anything run in PyTorch after the export.)
  2. Weight-only int8: every float initializer with ≥ 4096 elements and ≥ 2 dims becomes int8 +
     a per-output-channel scale + DequantizeLinear (ORT folds it at session load; activations
     stay fp32). 98.4 MB of fp32 weights → a 25.0 MB file. Do NOT use onnxruntime's
     quantize_dynamic: int8 activations destroyed the model (GuitarSet note F1 0.55 %).

Usage (Python with torch, torchlibrosa, onnx, onnxruntime, numpy, huggingface_hub):
  HF_HUB_DISABLE_XET=1 hf download xavriley/midi-transcription-models guitar-gaps.pth \\
      --revision b7bec65a2b860aca72856b0feef58b5df407b777 --local-dir /tmp/xav
  git clone https://github.com/xavriley/piano_transcription_inference /tmp/pti && \\
      git -C /tmp/pti checkout 7568dc7f78b625e40cf9776e2806d164006610e3
  python scripts/guitar_crnn_export.py /tmp/pti /tmp/xav/guitar-gaps.pth models/guitar-crnn/guitar-gaps.w8.onnx

The committed file's SHA-256 is pinned in guitar-model-core.js; the bytes depend on the torch /
onnx versions (built with torch 2.14.1, onnx 1.23.2), so a rebuild must re-pin it.
"""
import os
import sys
import tempfile

import numpy as np
import onnx
import onnxruntime as ort
import torch
from onnx import helper, numpy_helper

PTH_SHA256 = "65483e7c0e340a90415b15b520687587698c8c728f5fa470a205f13ee45c6513"
SEGMENT = 160000
HEADS = ["reg_onset_output", "reg_offset_output", "frame_output", "velocity_output"]


def sha256(path):
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def export_fp32(pti_dir, pth, out):
    sys.path.insert(0, pti_dir)
    from piano_transcription_inference.models import Regress_onset_offset_frame_velocity_CRNN
    m = Regress_onset_offset_frame_velocity_CRNN(frames_per_second=100, classes_num=88)
    sd = torch.load(pth, map_location="cpu", weights_only=False)
    res = m.load_state_dict(sd.get("model", sd), strict=False)
    assert not res.missing_keys and not res.unexpected_keys, res
    m.eval()

    class Wrap(torch.nn.Module):
        def __init__(self, inner):
            super().__init__()
            self.inner = inner

        def forward(self, x):
            d = self.inner(x)
            return tuple(d[n] for n in HEADS)

    x = torch.randn(1, SEGMENT) * 0.1
    # The wrapper must be in eval mode too: torch.onnx.export restores the exported module's
    # ORIGINAL mode afterwards, and a fresh Module starts in training mode — which would flip
    # the inner CRNN back to training (dropout on) for anything run in PyTorch after export.
    w = Wrap(m).eval()
    with torch.no_grad():
        ref = m(x)
    torch.onnx.export(w, (x,), out, input_names=["audio"], output_names=HEADS, opset_version=17, dynamo=False)
    assert not m.training, "export left the CRNN in training mode"
    got = ort.InferenceSession(out, providers=["CPUExecutionProvider"]).run(None, {"audio": x.numpy()})
    err = max(float(np.abs(a - ref[n].numpy()).max()) for a, n in zip(got, HEADS))
    assert err < 1e-4, f"fp32 ONNX disagrees with PyTorch (max |Δ| {err})"
    print(f"fp32 ONNX matches PyTorch (max |Δ| {err:.2e})")


def weight_only_int8(src, dst):
    m = onnx.load(src)
    g = m.graph
    inits, deq, n_q = [], [], 0
    for init in g.initializer:
        a = numpy_helper.to_array(init)
        if a.dtype != np.float32 or a.size < 4096 or a.ndim < 2:
            inits.append(init)
            continue
        flat = a.reshape(a.shape[0], -1)
        scale = np.abs(flat).max(axis=1) / 127.0
        scale[scale == 0] = 1e-12
        q = np.clip(np.round(flat / scale[:, None]), -127, 127).astype(np.int8).reshape(a.shape)
        qn, sn, zn = init.name + "_q", init.name + "_s", init.name + "_z"
        inits += [numpy_helper.from_array(q, qn), numpy_helper.from_array(scale.astype(np.float32), sn),
                  numpy_helper.from_array(np.zeros(a.shape[0], np.int8), zn)]
        deq.append(helper.make_node("DequantizeLinear", [qn, sn, zn], [init.name], axis=0))
        n_q += 1
    del g.initializer[:]
    g.initializer.extend(inits)
    old = list(g.node)
    del g.node[:]
    g.node.extend(deq + old)
    onnx.checker.check_model(m)
    onnx.save(m, dst)
    print(f"weight-only int8: {n_q} tensors → {os.path.getsize(dst) / 1e6:.1f} MB, SHA-256 {sha256(dst)}")


def main():
    pti_dir, pth, out = sys.argv[1:4]
    got = sha256(pth)
    assert got == PTH_SHA256, f"guitar-gaps.pth SHA-256 {got} ≠ pinned {PTH_SHA256}"
    with tempfile.TemporaryDirectory() as tmp:
        fp32 = os.path.join(tmp, "guitar-gaps.onnx")
        export_fp32(pti_dir, pth, fp32)
        weight_only_int8(fp32, out)


if __name__ == "__main__":
    main()
