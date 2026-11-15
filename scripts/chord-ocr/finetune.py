"""Fine-tune the shipped recogniser (from_onnx.py → base.pt) on the original synthetic mix (synth.py) plus a
share of hand-copied Real Book style chords (synth_rb.py). BatchNorm stays identity (the ONNX has it folded
into the convolutions) and frozen. The checkpoint is chosen on the dev crops of the rendered corpus (the
engraved accuracy must not drop). Usage: finetune.py <steps> <out.pt> <base.pt>   env RB_SHARE (0.3), RB_NEG (0.2), LR (5e-4)"""
import os, random, sys, time
import torch, torch.nn as nn
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import synth, synth_rb
from train import Net, collate, evaluate, load_eval, IDX
torch.set_num_threads(4)
SHARE = float(os.environ.get("RB_SHARE", "0.3")); NEG = float(os.environ.get("RB_NEG", "0.2"))

class Mix(torch.utils.data.IterableDataset):
    def __iter__(s):
        wi = torch.utils.data.get_worker_info()
        rng = random.Random(7919 * (wi.id if wi else 0) + int(time.time() * 1000) % 100000)
        fonts = synth.text_fonts(); hand = synth_rb.hand_fonts(fonts)[0]
        while True:
            if rng.random() < SHARE:
                # the hand-copied branch keeps the negatives too — bar numbers labelled with their digits, words /
                # tempo marks labelled empty — in the hand fonts; without them a "6" or "8" at a system's start was
                # read "G" / "B" on engraved pages
                r = synth.render_other(rng, hand) if rng.random() < NEG else synth_rb.render_rb(rng, fonts)
            else: r = synth.render(rng, fonts)
            if r and all(c in IDX for c in r[1]): yield r

def bn_eval(net):
    for m in net.modules():
        if isinstance(m, nn.BatchNorm2d): m.eval()

if __name__ == "__main__":
    steps, out, base = int(sys.argv[1]), sys.argv[2], sys.argv[3]
    net = Net(); net.load_state_dict(torch.load(base, map_location="cpu")); net.train(); bn_eval(net)
    dev = load_eval("dev")
    a0, _ = evaluate(net, dev); bn_eval(net); print(f"base dev exact {100*a0:.1f}%", flush=True)
    dl = torch.utils.data.DataLoader(Mix(), batch_size=48, num_workers=3, collate_fn=collate, prefetch_factor=4)
    lr = float(os.environ.get("LR", "5e-4"))
    opt = torch.optim.AdamW(net.parameters(), lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, lr, total_steps=steps, pct_start=0.1)
    ctc = nn.CTCLoss(zero_infinity=True); t0 = time.time(); run = 0
    for step, (X, tg, ln, _) in enumerate(dl):
        lp = net(X).log_softmax(-1)
        T = torch.full((X.shape[0],), lp.shape[1], dtype=torch.long)
        loss = ctc(lp.transpose(0, 1), tg, T, ln)
        opt.zero_grad(); loss.backward(); nn.utils.clip_grad_norm_(net.parameters(), 5); opt.step(); sched.step()
        run = loss.item() if step == 0 else 0.98 * run + 0.02 * loss.item()
        if (step + 1) % 250 == 0 or step + 1 == steps:
            acc, bad = evaluate(net, dev); bn_eval(net)
            print(f"step {step+1} loss {run:.3f} dev exact {100*acc:.1f}%  {time.time()-t0:.0f}s  {' '.join(bad[:6])}", flush=True)
            torch.save(net.state_dict(), out.replace(".pt", f"_{step+1}.pt"))
        if step + 1 >= steps: break
    torch.save(net.state_dict(), out)
