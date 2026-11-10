"""Train the chord-symbol CTC recogniser on synthetic images; eval on the verovio crops (unseen
renderer + Liberation Serif, a held-out font)."""
import json, math, os, random, sys, time
import numpy as np, torch, torch.nn as nn, torch.nn.functional as F
from PIL import Image
import synth
torch.set_num_threads(4)
C = synth.CHARSET; IDX = {c: i + 1 for i, c in enumerate(C)}           # 0 = CTC blank

class Net(nn.Module):
    def __init__(s, nc=len(C) + 1):
        super().__init__()
        def blk(i, o, pool): return [nn.Conv2d(i, o, 3, padding=1), nn.BatchNorm2d(o), nn.ReLU()] + ([nn.MaxPool2d(pool)] if pool else [])
        s.cnn = nn.Sequential(*blk(1, 32, 2), *blk(32, 64, 2), *blk(64, 96, None), *blk(96, 96, (2, 1)),
                              *blk(96, 128, None), *blk(128, 128, (2, 1)), nn.Conv2d(128, 128, (2, 1)), nn.ReLU())
        s.rnn = nn.GRU(128, 96, bidirectional=True, batch_first=True)
        s.out = nn.Linear(192, nc)
    def forward(s, x):                       # x (B,1,32,W) in [0,1], ink = 1
        f = s.cnn(x).squeeze(2).transpose(1, 2)   # (B, W/4, 128)
        return s.out(s.rnn(f)[0])                  # (B, T, nc) logits

def norm_label(t): return t.replace("♯", "#").replace("♭", "b")

class Synth(torch.utils.data.IterableDataset):
    def __init__(s, seed): s.seed = seed
    def __iter__(s):
        wi = torch.utils.data.get_worker_info()
        rng = random.Random(s.seed * 1000 + (wi.id if wi else 0) + int(time.time()))
        fonts = synth.text_fonts()
        while True:
            r = synth.render(rng, fonts)
            if r and all(c in IDX for c in r[1]): yield r

def collate(b):
    W = max(x.shape[1] for x, _ in b); W = int(math.ceil(W / 4) * 4)
    X = np.zeros((len(b), 1, 32, W), np.float32)
    for i, (x, _) in enumerate(b): X[i, 0, :, :x.shape[1]] = 1 - x / 255.0
    labs = [l for _, l in b]
    tg = torch.tensor([IDX[c] for l in labs for c in l], dtype=torch.long); ln = torch.tensor([len(l) for l in labs], dtype=torch.long)
    return torch.from_numpy(X), tg, ln, labs

def decode(lp):
    out = []
    for seq in lp.argmax(-1).tolist():
        s, prev = [], 0
        for k in seq:
            if k != prev and k: s.append(C[k - 1])
            prev = k
        out.append("".join(s))
    return out

def load_eval(split=None):
    idx = json.load(open("crops/index.json")); xs = []
    for it in idx:
        if split and it["split"] != split: continue
        im = Image.open("crops/" + it["crop"]).convert("L")
        xs.append((synth.to_input(im), norm_label(it["text"])))
    return xs

def evaluate(net, data, bs=64):
    net.eval(); ok = 0; bad = []
    with torch.no_grad():
        for i in range(0, len(data), bs):
            X, _, _, labs = collate(data[i:i + bs])
            for g, w in zip(decode(net(X).log_softmax(-1)), labs):
                ok += g == w
                if g != w and len(bad) < 25: bad.append(f"{w}→{g}")
    net.train(); return ok / len(data), bad

if __name__ == "__main__":
    steps, out = int(sys.argv[1]), sys.argv[2]
    net = Net(); print(sum(p.numel() for p in net.parameters()), "params")
    if len(sys.argv) > 3: net.load_state_dict(torch.load(sys.argv[3], map_location="cpu")); print("fine-tuning from", sys.argv[3])
    dev = load_eval("dev")
    dl = torch.utils.data.DataLoader(Synth(1), batch_size=48, num_workers=3, collate_fn=collate, prefetch_factor=4)
    opt = torch.optim.AdamW(net.parameters(), 2e-3, weight_decay=1e-4)
    lr = float(os.environ.get("LR", "2e-3"))
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, lr, total_steps=steps, pct_start=0.05)
    ctc = nn.CTCLoss(zero_infinity=True); t0 = time.time(); best = 0; run = 0
    for step, (X, tg, ln, _) in enumerate(dl):
        lp = net(X).log_softmax(-1)
        T = torch.full((X.shape[0],), lp.shape[1], dtype=torch.long)
        loss = ctc(lp.transpose(0, 1), tg, T, ln)
        opt.zero_grad(); loss.backward(); nn.utils.clip_grad_norm_(net.parameters(), 5); opt.step(); sched.step()
        run = 0.98 * run + 0.02 * loss.item()
        if (step + 1) % 500 == 0 or step + 1 == steps:
            acc, bad = evaluate(net, dev)
            print(f"step {step+1} loss {run:.3f} dev exact {100*acc:.1f}%  {time.time()-t0:.0f}s  {' '.join(bad[:10])}", flush=True)
            if acc >= best: best = acc; torch.save(net.state_dict(), out)
        if step + 1 >= steps: break
