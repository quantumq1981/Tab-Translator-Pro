import sys, time, json, numpy as np, onnxruntime as ort, pyarrow.parquet as pq, torch
from smt_model import prep, gt_tokens
c = json.load(open("smt-w/config.json")); i2w = {int(k): v for k, v in c["i2w"].items()}; w2i = c["w2i"]
RATIO = float(next((a.split("=")[1] for a in sys.argv if a.startswith("--ratio=")), "1.0"))
d = sys.argv[1] if len(sys.argv) > 1 else "smt-onnx"; N = int(sys.argv[2]) if len(sys.argv) > 2 else 20
so = ort.SessionOptions(); so.intra_op_num_threads = int(sys.argv[4]) if len(sys.argv) > 4 else 1; so.inter_op_num_threads = 1
E = ort.InferenceSession(f"{d}/smt-enc.onnx", so); D = ort.InferenceSession(f"{d}/smt-dec.onnx", so)
def ed(a, b):
    dd = list(range(len(b)+1))
    for i, x in enumerate(a, 1):
        p, dd[0] = dd[0], i
        for j, y in enumerate(b, 1): p, dd[j] = dd[j], min(dd[j]+1, dd[j-1]+1, p + (x != y))
    return dd[-1]
t = pq.read_table(sys.argv[3] if len(sys.argv) > 3 else "gs-test.parquet"); step = t.num_rows // N
errs = toks = 0; run = 0; errs2 = toks2 = 0; per = []; te = []; tdtok = []; outs = []
for k in range(N):
    r = t.slice(k*step, 1).to_pylist()[0]
    x = prep(r["image"]["bytes"], RATIO).numpy(); gt = gt_tokens(r["transcription"])
    t0 = time.time(); cK, cV = E.run(None, {"image": x}); t1 = time.time()
    pK = np.zeros((8, 4, 0, 64), np.float32); pV = pK.copy(); tok = w2i["<bos>"]; out = []
    for s in range(int(c["maxlen"]) - 1):
        lg, pK, pV = D.run(None, {"token": np.array([[tok]], np.int64), "step": np.array([s], np.int64), "crossK": cK, "crossV": cV, "pastK": pK, "pastV": pV})
        tok = int(lg.argmax())
        if i2w[tok] == "<eos>": break
        out.append(i2w[tok])
    t2 = time.time(); te.append(t1-t0); tdtok.append((t2-t1)/max(1, len(out)+1))
    e = ed(out, gt); errs += e; toks += len(gt); outs.append(out); per.append(e/len(gt))
    if len(out) >= int(c["maxlen"]) - 2: run += 1
    else: errs2 += e; toks2 += len(gt)
    if "-v" in sys.argv: print(k, x.shape[2:], len(out), len(gt), round(100*e/len(gt),1))
print(f"runaways {run}/{N}; SER without runaways {100*errs2/max(1,toks2):.2f}%; median per-system SER {100*np.median(per):.2f}%")
print(f"{d}: SER {100*errs/toks:.2f}% over {N} systems; encoder {np.mean(te):.2f}s, decoder {1000*np.mean(tdtok):.1f} ms/token (1 thread)")
json.dump(outs, open(f"{d}/outs.json", "w"))
