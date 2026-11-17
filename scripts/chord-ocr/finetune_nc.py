"""Continue training a SHIPPED reader with the 2026-11-15 additions (synth_extra.py): N.C. as a new reading (two
new output classes, "N" and "."), guitar-book text and articulation marks as negatives, crops with stems / beams /
a nut bar, stacked alterations and diagonal slash chords. The start point is the shipped int8 ONNX recovered by
from_onnx.py (its new classes start silent), so the reader keeps what it knew: the original mix (synth.py, plus the
hand-copied share, synth_rb.py) continues alongside, and a distillation term holds the new net to the shipped one's
output on those original-mix images (KL, weight DISTILL) — the hand-copied reader's Real Book accuracy was measured
on pages that are not in the repo, so drift away from it can't be re-measured; this keeps it small.
Usage: finetune_nc.py <steps> <out.pt> <base.pt>   env EXTRA (0.25), RB_SHARE (0.3), RB_NEG (0.2), LR (2e-4), DISTILL (0.5)
Run from the rendered corpus folder (crops/index.json, for the dev check every 250 steps)."""
import copy, math, os, random, sys, time
import numpy as np, torch, torch.nn as nn
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import synth, synth_rb, synth_extra
from train import Net, evaluate, load_eval, IDX
torch.set_num_threads(4)
EXTRA = float(os.environ.get("EXTRA", "0.25")); SHARE = float(os.environ.get("RB_SHARE", "0.3")); NEG = float(os.environ.get("RB_NEG", "0.2"))

class Mix(torch.utils.data.IterableDataset):
    def __iter__(s):
        wi = torch.utils.data.get_worker_info()
        rng = random.Random(7919 * (wi.id if wi else 0) + int(time.time() * 1000) % 100000)
        fonts = synth.text_fonts(); hand = synth_rb.hand_fonts(fonts)[0]
        while True:
            extra = rng.random() < EXTRA
            if extra: r = synth_extra.render_extra(rng, fonts)
            elif rng.random() < SHARE: r = synth.render_other(rng, hand) if rng.random() < NEG else synth_rb.render_rb(rng, fonts)
            else: r = synth.render(rng, fonts)
            if r and all(c in IDX for c in r[1]): yield r[0], r[1], extra

def collate(b):
    W = max(x.shape[1] for x, _, _ in b); W = int(math.ceil(W / 4) * 4)
    X = np.zeros((len(b), 1, 32, W), np.float32)
    for i, (x, _, _) in enumerate(b): X[i, 0, :, :x.shape[1]] = 1 - x / 255.0
    labs = [l for _, l, _ in b]
    tg = torch.tensor([IDX[c] for l in labs for c in l], dtype=torch.long); ln = torch.tensor([len(l) for l in labs], dtype=torch.long)
    return torch.from_numpy(X), tg, ln, torch.tensor([0.0 if e else 1.0 for _, _, e in b])

def bn_eval(net):
    for m in net.modules():
        if isinstance(m, nn.BatchNorm2d): m.eval()

if __name__ == "__main__":
    steps, out, base = int(sys.argv[1]), sys.argv[2], sys.argv[3]
    net = Net(); net.load_state_dict(torch.load(base, map_location="cpu")); net.train(); bn_eval(net)
    teacher = copy.deepcopy(net).eval()
    for p in teacher.parameters(): p.requires_grad_(False)
    dev = load_eval("dev")
    a0, _ = evaluate(net, dev); bn_eval(net); print(f"base dev exact {100*a0:.1f}%", flush=True)
    dl = torch.utils.data.DataLoader(Mix(), batch_size=48, num_workers=3, collate_fn=collate, prefetch_factor=4)
    lr = float(os.environ.get("LR", "2e-4")); lam = float(os.environ.get("DISTILL", "0.5"))
    opt = torch.optim.AdamW(net.parameters(), lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, lr, total_steps=steps, pct_start=0.1)
    ctc = nn.CTCLoss(zero_infinity=True); t0 = time.time(); run = 0
    for step, (X, tg, ln, keep) in enumerate(dl):
        lp = net(X).log_softmax(-1)
        T = torch.full((X.shape[0],), lp.shape[1], dtype=torch.long)
        loss = ctc(lp.transpose(0, 1), tg, T, ln)
        if lam > 0 and keep.sum() > 0:
            with torch.no_grad(): tp = teacher(X).log_softmax(-1)
            kl = (tp.exp() * (tp - lp)).sum(-1).mean(-1)                 # per image, over its frames
            loss = loss + lam * (kl * keep).sum() / keep.sum()
        opt.zero_grad(); loss.backward(); nn.utils.clip_grad_norm_(net.parameters(), 5); opt.step(); sched.step()
        run = loss.item() if step == 0 else 0.98 * run + 0.02 * loss.item()
        if (step + 1) % 250 == 0 or step + 1 == steps:
            acc, bad = evaluate(net, dev); bn_eval(net)
            print(f"step {step+1} loss {run:.3f} dev exact {100*acc:.1f}%  {time.time()-t0:.0f}s  {' '.join(bad[:6])}", flush=True)
            torch.save(net.state_dict(), out.replace(".pt", f"_{step+1}.pt"))
        if step + 1 >= steps: break
    torch.save(net.state_dict(), out)
