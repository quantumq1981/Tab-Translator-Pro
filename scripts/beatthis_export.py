"""beatthis_export.py — rebuild models/beat-this/beat_this_final0.w8.onnx from the official checkpoint.

Dev-only. Nothing here ships except the .onnx and the feature fixture it writes.

Source (all MIT, © 2024 Institute of Computational Perception, JKU Linz):
  * model code: github.com/CPJKU/beat_this @ b95c8ab0c58c2d9fcfd40508ae8dffbc05ac4f5c (v1.1.0+)
  * weights: final0.ckpt (81,058,141 bytes, SHA-256 8c328b45…8331). The official host
    (cloud.cp.jku.at) is not reachable from the build container; the file was taken from two
    independent Hugging Face re-uploads (oulianov/beat_this, teamup-tech/Beat-This-weights),
    which are byte-identical to each other. The checksum is asserted below.

Steps:
  0. Slice the TIME-directed attention (`slice_time_attention`): the frontend's three partial
     transformers attend over all 1500 frames separately for each of 32 / 16 / 8 frequency rows,
     and the six main layers over 16 heads — each a 1500 × 1500 score matrix. One
     scaled_dot_product_attention over all of them at once is what made one window need ~1 GB
     of WASM memory (enough to get an iPhone tab killed next to a decoded song). The same
     attention, one (batch × head) slice at a time, gives the SAME logits (int8 output
     bit-identical to the unsliced export) at ~half the memory (onnxruntime-web 1.23.2, Node,
     one 1500-frame window: 1,008 → 502 MB peak RSS; same run time; session creation 0.9 → 3.8 s).
  1. Export the model's fixed 1500-frame window (30 s at 50 frames/s) to ONNX, opset 17:
     log-mel spectrogram [1, 1500, 128] in → beat and downbeat logits [1, 1500] out. The
     spectrogram is NOT in the graph — engine.tsx `beatThisLogMel` computes it (an STFT op in
     onnxruntime-web is not worth the risk), and step 3 checks that it matches torchaudio.
  2. Weight-only int8, exactly as scripts/guitar_crnn_export.py (per-output-channel scale +
     DequantizeLinear; activations stay fp32). Checked against PyTorch on real audio.
  3. Write tests/fixtures/beatthis-features.json: a test signal, its torchaudio log-mel frames
     and a few filterbank rows, so `npm test` can hold the JS front end to beat_this's own.

Usage (Python with torch, torchaudio, einops, rotary-embedding-torch, onnx, onnxruntime, numpy, soundfile;
pass `-` as the fixture to rebuild only the model — torchaudio is then not needed):
  git clone https://github.com/CPJKU/beat_this /tmp/bt && git -C /tmp/bt checkout b95c8ab0c58c2d9fcfd40508ae8dffbc05ac4f5c
  HF_HUB_DISABLE_XET=1 hf download oulianov/beat_this final0.ckpt --local-dir /tmp/btck
  python scripts/beatthis_export.py /tmp/bt /tmp/btck/final0.ckpt models/beat-this/beat_this_final0.w8.onnx \\
      tests/fixtures/beatthis-features.json [some.wav …]

The committed file's SHA-256 is pinned in beat-model-core.js; the bytes depend on the torch /
onnx versions (built with torch 2.14.1, onnx 1.23.2, rotary-embedding-torch 0.9.1), so a rebuild must re-pin it.
"""
import json
import os
import sys
import tempfile

import numpy as np
import onnx
import onnxruntime as ort
import torch
from onnx import helper, numpy_helper

CKPT_SHA256 = "8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331"
CHUNK = 1500


def sha256(path):
    import hashlib
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


class SlicedAttend(torch.nn.Module):
    """beat_this's Attend (scaled_dot_product_attention, no dropout at inference), computed `group`
    (batch × head) slices at a time, so only one slice's score matrix is alive at once."""

    def __init__(self, group=1):
        super().__init__()
        self.group = group

    def forward(self, q, k, v):
        import torch.nn.functional as F
        b, h = q.shape[0], q.shape[1]
        qf, kf, vf = q.flatten(0, 1), k.flatten(0, 1), v.flatten(0, 1)
        outs = [F.scaled_dot_product_attention(qf[i:i + self.group], kf[i:i + self.group], vf[i:i + self.group])
                for i in range(0, b * h, self.group)]
        return torch.cat(outs, 0).unflatten(0, (b, h))


def slice_time_attention(model):
    """Every attention over the time axis → SlicedAttend (frequency attention is short: ≤ 32 tokens)."""
    from beat_this.model.beat_tracker import PartialFTTransformer
    n = 0
    for m in model.modules():
        if isinstance(m, PartialFTTransformer):
            m.attnT.attend = SlicedAttend()
            n += 1
    for attn, _ff in model.transformer_blocks.layers:
        attn.attend = SlicedAttend()
        n += 1
    assert n == 9, f"expected 3 frontend + 6 main time attentions, patched {n}"
    print(f"sliced {n} time-directed attentions (one batch × head score matrix at a time)")


def export_fp32(model, out):
    class Wrap(torch.nn.Module):
        def __init__(self, inner):
            super().__init__()
            self.inner = inner

        def forward(self, spect):
            p = self.inner(spect)
            return p["beat"], p["downbeat"]

    w = Wrap(model).eval()
    x = torch.randn(1, CHUNK, 128).abs() * 3
    with torch.no_grad():
        ref = w(x)
    # The time axis is dynamic: beat_this runs a piece shorter than 30 s as ONE shorter chunk
    # (split_piece), and zero-padding it to 1500 frames would change what the attention sees.
    torch.onnx.export(w, (x,), out, input_names=["spect"], output_names=["beat", "downbeat"], opset_version=17, dynamo=False,
                      dynamic_axes={"spect": {1: "frames"}, "beat": {1: "frames"}, "downbeat": {1: "frames"}})
    assert not model.training, "export left the model in training mode"
    sess = ort.InferenceSession(out, providers=["CPUExecutionProvider"])
    for n in (CHUNK, 1129, 64):
        xn = x[:, :n]
        with torch.no_grad():
            rn = w(xn)
        got = sess.run(None, {"spect": xn.numpy()})
        err = max(float(np.abs(a - r.numpy()).max()) for a, r in zip(got, rn))
        assert err < 1e-3, f"fp32 ONNX disagrees with PyTorch at {n} frames (max |Δ| {err})"
        print(f"fp32 ONNX matches PyTorch at {n} frames (max |Δ| logit {err:.2e})")


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


def beats_of(spect2frames_fn, spect):
    """beat_this's own split_predict_aggregate + minimal post-processing over a spectrogram."""
    from beat_this.inference import split_predict_aggregate
    from beat_this.model.postprocessor import Postprocessor
    with torch.inference_mode():
        p = split_predict_aggregate(spect=spect, chunk_size=CHUNK, overlap_mode="keep_first", border_size=6, model=spect2frames_fn)
    return Postprocessor("minimal")(p["beat"].float(), p["downbeat"].float())


def main():
    bt_dir, ckpt, out, fixture, *wavs = sys.argv[1:]
    got = sha256(ckpt)
    assert got == CKPT_SHA256, f"final0.ckpt SHA-256 {got} ≠ pinned {CKPT_SHA256}"
    sys.path.insert(0, bt_dir)
    if fixture == "-":                      # model only: torchaudio is used for audio I/O + the fixture, not the model
        try:
            import torchaudio  # noqa: F401
        except ImportError:
            import unittest.mock
            sys.modules["torchaudio"] = unittest.mock.MagicMock()
    from beat_this.inference import load_model
    model = load_model(ckpt, "cpu")
    slice_time_attention(model)

    with tempfile.TemporaryDirectory() as tmp:
        fp32 = os.path.join(tmp, "beat_this_final0.onnx")
        export_fp32(model, fp32)
        weight_only_int8(fp32, out)
    if fixture == "-":
        return
    from beat_this.preprocessing import LogMelSpect
    lm = LogMelSpect()

    # the JS front end's reference: a chirp + clicks, its torchaudio log-mel, and filterbank rows
    sr = 22050
    t = np.arange(int(sr * 1.5)) / sr
    sig = (0.3 * np.sin(2 * np.pi * (110 + 400 * t) * t) + 0.2 * (np.mod(t, 0.5) < 0.004)).astype(np.float32)
    mel = lm(torch.tensor(sig)).numpy()
    fb = lm.spect_class.mel_scale.fb.numpy()                                # [513, 128]
    json.dump({"sr": sr, "signal": [round(float(v), 7) for v in sig], "frames": [0, 10, 37, 74],
               "logmel": {str(i): [float(v) for v in mel[i]] for i in (0, 10, 37, 74)},
               "nFrames": int(mel.shape[0]), "fbRows": {str(k): [float(v) for v in fb[k]] for k in (0, 5, 40, 200, 512)}},
              open(fixture, "w"), separators=(",", ":"))
    print(f"feature fixture → {fixture} ({mel.shape[0]} frames)")

    # int8 vs PyTorch on real recordings (same beats within one frame, or say how many differ)
    if wavs:
        import soundfile as sf
        sess = ort.InferenceSession(out, providers=["CPUExecutionProvider"])

        def onnx_model(chunk):
            b, d = sess.run(None, {"spect": chunk.numpy().astype(np.float32)})
            return {"beat": torch.tensor(b), "downbeat": torch.tensor(d)}

        same_b = tot_b = same_d = tot_d = 0
        for wp in wavs:
            x, wsr = sf.read(wp, dtype="float32")
            if x.ndim > 1:
                x = x.mean(axis=1)
            assert wsr == sr, "pass 22.05 kHz wavs"
            spect = lm(torch.tensor(x))
            bt, dt = beats_of(model, spect)
            bq, dq = beats_of(onnx_model, spect)
            for ref, est, kind in ((bt, bq, "b"), (dt, dq, "d")):
                hit = sum(1 for r in ref if len(est) and np.min(np.abs(np.asarray(est) - r)) <= 0.021)
                if kind == "b":
                    same_b += hit; tot_b += max(len(ref), len(est))
                else:
                    same_d += hit; tot_d += max(len(ref), len(est))
        print(f"int8 vs PyTorch on {len(wavs)} recordings: beats {same_b}/{tot_b} within one frame, downbeats {same_d}/{tot_d}")


if __name__ == "__main__":
    main()
