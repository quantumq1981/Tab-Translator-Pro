"""Shipped int8 ONNX → train.Net state (BatchNorm set to identity: the ONNX has it folded into the convs).
Verifies the PyTorch net reproduces the ONNX logits. Usage: from_onnx.py <model.onnx> <out.pt>"""
import os, sys, numpy as np, onnx, onnxruntime as ort, torch
from onnx import numpy_helper
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train import Net
m = onnx.load(sys.argv[1]); I = {i.name: numpy_helper.to_array(i) for i in m.graph.initializer}
def deq(n):
    if n in I: return I[n].astype(np.float32)
    q, s = I[n + "_q"].astype(np.float32), I[n + "_s"]
    return q * s.reshape((-1,) + (1,) * (q.ndim - 1))
net = Net(); sd = net.state_dict()
convs = [("onnx::Conv_228", "onnx::Conv_229"), ("onnx::Conv_231", "onnx::Conv_232"), ("onnx::Conv_234", "onnx::Conv_235"),
         ("onnx::Conv_237", "onnx::Conv_238"), ("onnx::Conv_240", "onnx::Conv_241"), ("onnx::Conv_243", "onnx::Conv_244")]
conv_idx = [i for i, l in enumerate(net.cnn) if isinstance(l, torch.nn.Conv2d)]
for (wn, bn), ci in zip(convs, conv_idx[:6]):
    sd[f"cnn.{ci}.weight"] = torch.tensor(deq(wn)); sd[f"cnn.{ci}.bias"] = torch.tensor(deq(bn))
    b = ci + 1; eps = net.cnn[b].eps
    sd[f"cnn.{b}.weight"] = torch.ones_like(sd[f"cnn.{b}.weight"]); sd[f"cnn.{b}.bias"] = torch.zeros_like(sd[f"cnn.{b}.bias"])
    sd[f"cnn.{b}.running_mean"] = torch.zeros_like(sd[f"cnn.{b}.running_mean"]); sd[f"cnn.{b}.running_var"] = torch.full_like(sd[f"cnn.{b}.running_var"], 1 - eps)
sd["cnn.22.weight"] = torch.tensor(deq("cnn.22.weight")); sd["cnn.22.bias"] = torch.tensor(deq("cnn.22.bias"))
# GRU: ONNX gates z r h  →  PyTorch r z n ; W (2,3H,in), R (2,3H,H), B (2,6H) = [Wb | Rb]
W, R, B = deq("onnx::GRU_288"), deq("onnx::GRU_289"), deq("onnx::GRU_287"); H = 96
re = lambda a: np.concatenate([a[H:2 * H], a[:H], a[2 * H:]], 0)
for d, suf in ((0, ""), (1, "_reverse")):
    sd["rnn.weight_ih_l0" + suf] = torch.tensor(re(W[d])); sd["rnn.weight_hh_l0" + suf] = torch.tensor(re(R[d]))
    sd["rnn.bias_ih_l0" + suf] = torch.tensor(re(B[d][:3 * H])); sd["rnn.bias_hh_l0" + suf] = torch.tensor(re(B[d][3 * H:]))
sd["out.weight"] = torch.tensor(deq("onnx::MatMul_290").T.copy()); sd["out.bias"] = torch.tensor(deq("out.bias"))
net.load_state_dict(sd); net.eval()
s = ort.InferenceSession(sys.argv[1]); d = 0
for wdt in (40, 120, 256):
    x = np.random.rand(1, 1, 32, wdt).astype(np.float32)
    with torch.no_grad(): d = max(d, float(np.abs(net(torch.tensor(x)).numpy() - s.run(None, {"image": x})[0]).max()))
print("max |Δ logits| PyTorch vs shipped ONNX:", d)
torch.save(net.state_dict(), sys.argv[2])
