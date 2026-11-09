"""Export our SMT implementation to ONNX as two graphs:
 enc: image (1,1,H,W) -> cross K/V for every layer, precomputed once per system
 dec: one token + its position + the self-attention cache -> logits + the grown cache
Parity is checked against our PyTorch model's full-recompute decoding (smt_model.SMT.step; see the parity notes in docs/OMR-PLAN.md)."""
import sys, os, time, json, numpy as np, torch, torch.nn.functional as F, pyarrow.parquet as pq
from smt_model import load, prep, gt_tokens
torch.set_num_threads(4)
m, c = load("smt-w/config.json", "smt-w/model.safetensors")
NL, H, DH = c["num_dec_layers"], 4, c["d_model"] // 4

class Enc(torch.nn.Module):
    def __init__(s, m): super().__init__(); s.m = m
    def forward(s, x):
        raw, pos = s.m.encode(x)                          # (S,1,C)
        ks, vs = [], []
        for L in s.m.decoder.decoder.layers:
            a = L.cross_attention
            ks.append(a.lk(pos)[:, 0].reshape(-1, H, DH).permute(1, 0, 2))   # (H,S,DH)
            vs.append(a.lv(raw)[:, 0].reshape(-1, H, DH).permute(1, 0, 2))
        return torch.stack(ks), torch.stack(vs)            # (NL,H,S,DH)

class Dec(torch.nn.Module):
    def __init__(s, m): super().__init__(); s.m = m
    def forward(s, token, step, crossK, crossV, pastK, pastV):
        d = s.m.decoder
        x = d.embedding(token)[0] + d.positional_1D.pe[step[0]:step[0] + 1][0]   # (1,C)
        nk, nv = [], []
        for i, L in enumerate(d.decoder.layers):
            a = L.input_attention
            q = a.lq(x).reshape(H, 1, DH)
            k = torch.cat([pastK[i], a.lk(x).reshape(H, 1, DH)], 1)
            v = torch.cat([pastV[i], a.lv(x).reshape(H, 1, DH)], 1)
            nk.append(k); nv.append(v)
            o = torch.bmm(F.softmax(torch.bmm(q, k.transpose(1, 2)), -1), v).reshape(1, -1)
            x = L.norm1(x + a.out_proj(o))
            ca = L.cross_attention
            q = ca.lq(x).reshape(H, 1, DH)
            o = torch.bmm(F.softmax(torch.bmm(q, crossK[i].transpose(1, 2)), -1), crossV[i]).reshape(1, -1)
            x = L.norm2(x + ca.out_proj(o))
            x = L.norm3(x + L.ffNet(x))
        logits = F.linear(torch.relu(x), d.out_layer.weight[:, :, 0], d.out_layer.bias)
        return logits, torch.stack(nk), torch.stack(nv)

enc, dec = Enc(m).eval(), Dec(m).eval()
x = torch.rand(1, 1, 256, 640)
with torch.no_grad():
    cK, cV = enc(x)
    pK = torch.zeros(NL, H, 0, DH); pV = torch.zeros(NL, H, 0, DH)
    tok = torch.tensor([[c["w2i"]["<bos>"]]]); st = torch.tensor([0])
    lg, nK, nV = dec(tok, st, cK, cV, pK, pV)
os.makedirs("smt-onnx", exist_ok=True)
torch.onnx.export(enc, (x,), "smt-onnx/smt-enc.onnx", input_names=["image"], output_names=["crossK", "crossV"],
    dynamic_axes={"image": {2: "h", 3: "w"}, "crossK": {2: "s"}, "crossV": {2: "s"}}, opset_version=17, dynamo=False)
pK1 = nK; pV1 = nV
torch.onnx.export(dec, (tok, torch.tensor([1]), cK, cV, pK1, pV1), "smt-onnx/smt-dec.onnx",
    input_names=["token", "step", "crossK", "crossV", "pastK", "pastV"], output_names=["logits", "presentK", "presentV"],
    dynamic_axes={"crossK": {2: "s"}, "crossV": {2: "s"}, "pastK": {2: "n"}, "pastV": {2: "n"}, "presentK": {2: "n1"}, "presentV": {2: "n1"}},
    opset_version=17, dynamo=False)
for f in ["smt-enc.onnx", "smt-dec.onnx"]: print(f, round(os.path.getsize("smt-onnx/" + f) / 1e6, 1), "MB")
