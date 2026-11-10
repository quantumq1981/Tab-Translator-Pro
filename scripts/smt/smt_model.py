"""Our own implementation of the Sheet Music Transformer (SMT, Rios-Vila et al.), written from
the MIT-licensed source of antoniorv6/SMT so the published weights load into code we wrote.
No code from the SMT repository is imported or executed: only torch and transformers'
ConvNextModel (PyPI). Phase 0 of docs/OMR-PLAN.md.

The weights (antoniorv6/smt-camera-grandstaff @ 9c1355631fbddc297d3d10fe4e6e5d3b5d3126b7, MIT)
were trained with the SEPTEMBER 2024 decoder (SMT commits fdeb7c3 / d25acd4), not the current
refactor: lq/lk/lv attention with NO 1/sqrt(d) scaling, ReLU + 1x1 Conv1d output layer. Loading
uses strict=True, which is how that was found (the current names don't match the checkpoint)."""
import json, math, re, sys, time
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F
from safetensors.torch import load_file
from transformers import ConvNextConfig, ConvNextModel

class PE2D(nn.Module):
    def __init__(s, dim, h_max, w_max):
        super().__init__()
        pe = torch.zeros((dim, h_max, w_max))
        div = torch.exp(-torch.arange(0., dim // 2, 2) / dim * torch.log(torch.tensor(1e4))).unsqueeze(1)
        w_pos = torch.arange(0., w_max) * div
        h_pos = torch.arange(0., h_max) * div
        pe[:dim // 2:2] = torch.sin(h_pos).unsqueeze(2).repeat(1, 1, w_max)
        pe[1:dim // 2:2] = torch.cos(h_pos).unsqueeze(2).repeat(1, 1, w_max)
        pe[dim // 2::2] = torch.sin(w_pos).unsqueeze(1).repeat(1, h_max, 1)
        pe[dim // 2 + 1::2] = torch.cos(w_pos).unsqueeze(1).repeat(1, h_max, 1)
        s.register_buffer("pe", pe, persistent=False)
    def forward(s, x): return x + s.pe[:, :x.size(-2), :x.size(-1)]

class PE1D(nn.Module):
    def __init__(s, dim, len_max):
        super().__init__()
        pe = torch.zeros((len_max, dim))
        div = torch.exp(-torch.arange(0., dim, 2) / dim * torch.log(torch.tensor(1e4)))
        pos = torch.arange(0., len_max).unsqueeze(1) * div
        pe[:, ::2] = torch.sin(pos); pe[:, 1::2] = torch.cos(pos)
        s.register_buffer("pe", pe, persistent=False)
    def forward(s, x, start=0): return x + s.pe[start:start + x.size(-2)]

class MHA(nn.Module):
    """The Sept-2024 SMT attention (fdeb7c3 / d25acd4), which these weights were trained with:
    lq/lk/lv/out_proj, 4 heads, and NO 1/sqrt(d) scaling of q·k (the scale factor is defined there
    but never applied — reproduced as is, since the weights learned with it)."""
    def __init__(s, d, h=4):
        super().__init__()
        s.h, s.dh = h, d // h
        s.lq, s.lk, s.lv, s.out_proj = (nn.Linear(d, d) for _ in range(4))
    def forward(s, query, key, value, causal=False):           # (L, B, C) layout, as the original
        T, b, c = query.shape; S = key.shape[0]
        q = s.lq(query).reshape(T, b * s.h, s.dh).transpose(0, 1)
        k = s.lk(key).reshape(S, b * s.h, s.dh).transpose(0, 1)
        v = s.lv(value).reshape(S, b * s.h, s.dh).transpose(0, 1)
        w = torch.bmm(q, k.transpose(1, 2))
        if causal:
            m = torch.triu(torch.ones(T, S, dtype=torch.bool), diagonal=1 + (S - T))
            w = w.masked_fill(m.unsqueeze(0), float("-inf"))
        o = torch.bmm(F.softmax(w, dim=-1), v).transpose(0, 1).reshape(T, b, c)
        return s.out_proj(o)

class Layer(nn.Module):
    def __init__(s, d, ff):
        super().__init__()
        s.input_attention, s.cross_attention = MHA(d), MHA(d)
        s.ffNet = nn.Sequential(nn.Linear(d, ff), nn.ReLU(), nn.Dropout(0.0), nn.Linear(ff, d))
        s.norm1, s.norm2, s.norm3 = nn.LayerNorm(d), nn.LayerNorm(d), nn.LayerNorm(d)
    def forward(s, t, mem_k, mem_v):
        t = s.norm1(t + s.input_attention(t, t, t, causal=True))
        t = s.norm2(t + s.cross_attention(t, mem_k, mem_v))
        return s.norm3(t + s.ffNet(t))

class Stack(nn.Module):
    def __init__(s, n, d, ff):
        super().__init__(); s.layers = nn.ModuleList([Layer(d, ff) for _ in range(n)])

class Dec(nn.Module):
    def __init__(s, n, d, ff, maxlen, vocab):
        super().__init__()
        s.decoder = Stack(n, d, ff)
        s.embedding = nn.Embedding(vocab, d)
        s.positional_1D = PE1D(d, maxlen)
        s.out_layer = nn.Conv1d(d, vocab, kernel_size=1)

class SMT(nn.Module):
    def __init__(s, c):
        super().__init__()
        s.encoder = ConvNextModel(ConvNextConfig(num_channels=c["in_channels"], num_stages=3, hidden_sizes=[64, 128, 256], depths=[3, 3, 9]))
        s.decoder = Dec(c["num_dec_layers"], c["d_model"], c["dim_ff"], int(c["maxlen"]), c["out_categories"])
        # the encoder downsamples 16x; the 2024 code built the table at full pixel size, but entry (h, w)
        # depends only on h, w and dim, so the reachable slice is identical
        s.pos2D = PE2D(c["d_model"], 32, c["maxw"] // 16 + 1)   # 32 rows = images up to 512 px tall
    def encode(s, x):
        e = s.encoder(pixel_values=x).last_hidden_state
        e2 = s.pos2D(e)
        # memory as (S, B, C): key = with 2D position, value = raw features
        return torch.flatten(e, 2, 3).permute(2, 0, 1), torch.flatten(e2, 2, 3).permute(2, 0, 1)
    def step(s, raw, pos, tokens):                               # tokens (B, L) → logits of the last token
        x = s.decoder.positional_1D(s.decoder.embedding(tokens)).permute(1, 0, 2)   # (L, B, C)
        for L in s.decoder.decoder.layers: x = L(x, pos, raw)
        h = torch.relu(x[-1])                                     # (B, C)
        return F.linear(h, s.decoder.out_layer.weight[:, :, 0], s.decoder.out_layer.bias)

def load(cfg_path, w_path):
    c = json.load(open(cfg_path))
    m = SMT(c).eval()
    sd = load_file(w_path)
    missing, unexpected = m.load_state_dict(sd, strict=True)
    return m, c

def prep(img_bytes, ratio=1.0):
    """SMT's prepare_data: width x ratio (capped at 3056), height max(h, 256) x ratio, grayscale, [0, 1]."""
    from PIL import Image
    import io, math
    im = Image.open(io.BytesIO(img_bytes)).convert("L")
    w, h = im.size
    nw = math.ceil(3056 * ratio) if w > 3056 else math.ceil(w * ratio)
    nh = math.ceil(max(h, 256) * ratio)
    if (nw, nh) != (w, h): im = im.resize((nw, nh), Image.BILINEAR)
    a = np.asarray(im, dtype=np.float32) / 255.0
    return torch.from_numpy(a)[None, None]

def gt_tokens(tr):
    gt = tr.strip("\n ")
    gt = re.sub(r'(?<=\=)\d+', '', gt)
    gt = gt.replace(" ", " <s> ").replace("·", "").replace("\t", " <t> ").replace("\n", " <b> ")
    return gt.split(" ")
