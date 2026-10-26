# Usage: python -I eval.py <renderDir> <model.onnx> <mel-filterbank.bin>  — see README.md
#        python -I eval.py --dump <wavDir> <outDir> <model.onnx> <mel-filterbank.bin>
#        (writes <track>.beats.json = { beats, downbeats } per 22.05 kHz <track>.wav, for beatgrid.mjs --learned)
import json, os, sys, time, resource, numpy as np, soundfile as sf, onnxruntime as ort
DUMP = sys.argv[1] == "--dump"
if DUMP: _, _, WAVS, OUT, MODEL, FBF = sys.argv[:6]
else: S = sys.argv[1]; MODEL = sys.argv[2]; FBF = sys.argv[3]
FB = np.fromfile(FBF, dtype=np.float32).reshape(513, 128)
def logmel(x):
    n, hop = 1024, 441
    x = np.pad(x, (n // 2, n // 2), mode="reflect")
    win = 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(n) / n)            # periodic Hann
    frames = 1 + (len(x) - n) // hop
    idx = np.arange(n)[None, :] + hop * np.arange(frames)[:, None]
    mag = np.abs(np.fft.rfft(x[idx] * win, axis=1)) / np.sqrt(n)
    return np.log1p(1000 * (mag @ FB)).astype(np.float32)
sess = ort.InferenceSession(MODEL, providers=["CPUExecutionProvider"])
iname = sess.get_inputs()[0].name
def track(x):
    sp = logmel(x); T = len(sp); C, B = 1500, 6
    starts = np.arange(-B, T - B, C - 2 * B)
    if T > C - 2 * B: starts[-1] = T - (C - B)
    beat = np.full(T, -1000.0); down = np.full(T, -1000.0)
    for s in reversed(starts):                                   # keep_first
        ch = sp[max(s, 0):min(s + C, T)]
        ch = np.pad(ch, ((max(0, -s), max(0, C - len(ch) - max(0, -s))), (0, 0)))   # pad to 1500 (static graphs)
        b, d = sess.run(None, {iname: ch[None]})
        b, d = b.reshape(-1), d.reshape(-1)
        lo, hi = s + B, min(s + C - B, T)
        beat[max(lo,0):hi] = b[B + max(0, -lo):B + (hi - lo)]; down[max(lo,0):hi] = d[B + max(0,-lo):B + (hi - lo)]
    def peaks(l):
        pad = np.pad(l, 3, constant_values=-1000); mx = np.max(np.lib.stride_tricks.sliding_window_view(pad, 7), axis=1)
        fr = np.nonzero((l == mx) & (l > 0))[0]
        out = []
        for f in fr:
            if out and f - out[-1] <= 1: continue
            out.append(f)
        return np.array(out) / 50.0
    bt, dt = peaks(beat), peaks(down)
    if len(bt): dt = np.unique([bt[np.argmin(np.abs(bt - d))] for d in dt])
    return bt, dt
def fmeasure(ref, est, tol=0.07):
    ref, est = np.asarray(ref), np.asarray(est)
    if not len(ref) or not len(est): return 0.0
    used = set(); hit = 0
    for r in ref:
        j = np.argmin(np.abs(est - r))
        if abs(est[j] - r) <= tol and j not in used: used.add(j); hit += 1
    p, rc = hit / len(est), hit / len(ref); return 0 if hit == 0 else 2 * p * rc / (p + rc)
def bpb(beats, downs):
    if len(downs) < 3 or len(beats) < 2: return None
    idx = np.abs(downs[:, None] - beats[None, :]).argmin(1); c = np.diff(idx); c = c[c >= 2]
    if not len(c): return None
    v, t = np.unique(c, return_counts=True); return int(v[t.argmax()]) if t.max() / len(c) >= 0.9 else None
def tempo(b): 
    if len(b) < 3: return None
    s = np.polyfit(np.arange(len(b)), b, 1)[0]; return 60 / s
if DUMP:
    os.makedirs(OUT, exist_ok=True); t_all = dur_all = 0
    for f in sorted(os.listdir(WAVS)):
        if not f.endswith(".wav"): continue
        x, sr = sf.read(os.path.join(WAVS, f), dtype="float32"); assert sr == 22050
        if x.ndim > 1: x = x.mean(axis=1)
        t0 = time.perf_counter(); bt, dt = track(x); t_all += time.perf_counter() - t0; dur_all += len(x) / sr
        json.dump({"beats": [float(v) for v in bt], "downbeats": [float(v) for v in dt]}, open(os.path.join(OUT, f[:-4] + ".beats.json"), "w"))
    print("dumped; realtime factor %.3f, peak RSS %d MB" % (t_all / max(dur_all, 1e-9), resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024))
    sys.exit(0)
truth = json.load(open(S + "/truth.json")); rows = []; t_all = 0; dur_all = 0
for m in truth:
    x, sr = sf.read(f"{S}/{m['name']}.wav", dtype="float32"); assert sr == 22050
    t0 = time.perf_counter(); bt, dt = track(x); el = time.perf_counter() - t0; t_all += el; dur_all += len(x) / sr
    ref_b, ref_d = np.array(m["beats"]), np.array(m["downbeats"])
    ours = m["ours"]; ob = np.array(ours.get("beats") or [])
    rows.append(dict(name=m["name"], cond=m["cond"], bpm=m["bpm"], bt_bpm=tempo(bt), ours_bpm=ours.get("bpm"),
        beatF=fmeasure(ref_b, bt), oursBeatF=fmeasure(ref_b, ob), downF=fmeasure(ref_d, dt), bpb=bpb(bt, dt), refBpb=round(len(ref_b) / max(1, len(ref_d)))))
for r in rows: print({k: (round(v, 3) if isinstance(v, float) else v) for k, v in r.items()})
for cond in ("drums", "nodrums"):
    rr = [r for r in rows if r["cond"] == cond]
    print(cond, "beatF %.3f oursBeatF %.3f downF %.3f meterRight %d/%d" % (np.mean([r["beatF"] for r in rr]), np.mean([r["oursBeatF"] for r in rr]), np.mean([r["downF"] for r in rr]), sum(r["bpb"] == r["refBpb"] for r in rr), len(rr)))
print("realtime factor %.3f (%.1fs for %.1fs), peak RSS %d MB" % (t_all / dur_all, t_all, dur_all, resource.getrusage(resource.RUSAGE_SELF).ru_maxrss // 1024))
