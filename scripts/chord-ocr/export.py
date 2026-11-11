"""Export the chord-symbol recogniser: PyTorch checkpoint → ONNX (opset 17, dynamic width), checked
against PyTorch, then optionally weight-only int8 (per-output-row scale + DequantizeLinear, activations
fp32 — the scheme the guitar model uses). Prints max |Δ| and the SHA-256 to pin in chord-ocr-core.js.
Usage: export.py <ckpt.pt> <out.onnx> [--int8]"""
import hashlib, os, sys, tempfile
import numpy as np, onnx, onnxruntime as ort, torch
from onnx import helper, numpy_helper
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train import Net

def sha(p): return hashlib.sha256(open(p, "rb").read()).hexdigest()

def int8(src, dst):
    m = onnx.load(src); g = m.graph; inits, deq = [], []
    for init in g.initializer:
        a = numpy_helper.to_array(init)
        if a.dtype != np.float32 or a.size < 1024 or a.ndim < 2: inits.append(init); continue
        flat = a.reshape(a.shape[0], -1); sc = np.abs(flat).max(axis=1) / 127.0; sc[sc == 0] = 1e-12
        q = np.clip(np.round(flat / sc[:, None]), -127, 127).astype(np.int8).reshape(a.shape)
        inits += [numpy_helper.from_array(q, init.name + "_q"), numpy_helper.from_array(sc.astype(np.float32), init.name + "_s"),
                  numpy_helper.from_array(np.zeros(a.shape[0], np.int8), init.name + "_z")]
        deq.append(helper.make_node("DequantizeLinear", [init.name + "_q", init.name + "_s", init.name + "_z"], [init.name], axis=0))
    del g.initializer[:]; g.initializer.extend(inits); old = list(g.node); del g.node[:]; g.node.extend(deq + old)
    onnx.checker.check_model(m); onnx.save(m, dst)

def main():
    ckpt, out = sys.argv[1], sys.argv[2]
    net = Net(); net.load_state_dict(torch.load(ckpt, map_location="cpu")); net.eval()
    xs = [torch.rand(1, 1, 32, w) for w in (40, 120, 256)]
    with torch.no_grad(): refs = [net(x).numpy() for x in xs]
    with tempfile.TemporaryDirectory() as t:
        fp = os.path.join(t, "fp32.onnx")
        torch.onnx.export(net, (xs[1],), fp, input_names=["image"], output_names=["logits"], opset_version=17,
                          dynamic_axes={"image": {0: "batch", 3: "width"}, "logits": {0: "batch", 1: "frames"}}, dynamo=False)
        target = fp
        if "--int8" in sys.argv: target = os.path.join(t, "w8.onnx"); int8(fp, target)
        s = ort.InferenceSession(target)
        d = max(float(np.abs(s.run(None, {"image": x.numpy()})[0] - r).max()) for x, r in zip(xs, refs))
        os.replace(target, out)
    print(f"{out}: {os.path.getsize(out) / 1e6:.2f} MB, max |Δ logits| vs PyTorch {d:.2e}, SHA-256 {sha(out)}")

if __name__ == "__main__": main()
