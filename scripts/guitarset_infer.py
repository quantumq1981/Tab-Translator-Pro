"""Run a Kong-CRNN ONNX guitar model over GuitarSet (mic, 16 kHz); write notes + mir_eval note F1.
usage: guitarset_infer.py <pti checkout> <model.onnx> <gs_ex dir> <out dir> [--noise-db N] [--limit K] [--every M]"""
import sys, os, json, glob, time, argparse, numpy as np, soundfile as sf, onnxruntime as ort, mir_eval
ap = argparse.ArgumentParser(); ap.add_argument("pti"); ap.add_argument("model"); ap.add_argument("gs"); ap.add_argument("out")
ap.add_argument("--noise-db", type=float, default=None); ap.add_argument("--limit", type=int, default=0); ap.add_argument("--every", type=int, default=1)
a = ap.parse_args(); sys.path.insert(0, a.pti)
from piano_transcription_inference.utilities import RegressionPostProcessor
os.makedirs(a.out, exist_ok=True)
so = ort.SessionOptions(); so.intra_op_num_threads = 4
sess = ort.InferenceSession(a.model, so, providers=["CPUExecutionProvider"])
names = [o.name for o in sess.get_outputs()]
SEG = 160000
def deframe(x):
    if x.shape[0] == 1: return x[0]
    x = x[:, :-1, :]; n, L, _ = x.shape
    y = [x[0, : int(L * .75)]] + [x[i, int(L * .25): int(L * .75)] for i in range(1, n - 1)] + [x[-1, int(L * .25):]]
    return np.concatenate(y, 0)
def run(audio):
    L = len(audio); pad = int(np.ceil(L / SEG)) * SEG - L
    x = np.concatenate([audio, np.zeros(pad, np.float32)])
    segs = [x[p:p + SEG] for p in range(0, len(x) - SEG + 1, SEG // 2)]
    outs = {n: [] for n in names}
    for s in segs:
        r = sess.run(None, {"audio": s[None].astype(np.float32)})
        for n, v in zip(names, r): outs[n].append(v[0])
    od = {n: deframe(np.stack(v))[: L // 160 + 1] for n, v in outs.items()}
    pp = RegressionPostProcessor(100, classes_num=88, onset_threshold=0.3, offset_threshold=0.3, frame_threshold=0.1, pedal_offset_threshold=0.2)
    notes, _ = pp.output_dict_to_midi_events(od)
    return notes
rng = np.random.default_rng(0)
files = sorted(glob.glob(os.path.join(a.gs, "*.wav")))[:: a.every]
if a.limit: files = files[: a.limit]
P, R, F, t0, dur = [], [], [], time.time(), 0
for f in files:
    tid = os.path.basename(f)[:-4]
    y, sr = sf.read(f, dtype="float32"); dur += len(y) / sr
    if a.noise_db is not None:
        p = np.mean(y ** 2); y = y + rng.standard_normal(len(y)).astype(np.float32) * np.sqrt(p / 10 ** (a.noise_db / 10))
    op = os.path.join(a.out, tid + ".json")
    if os.path.exists(op):
        est = [{"onset_time": e["onset"], "offset_time": e["offset"], "midi_note": e["midi"], "velocity": e["velocity"]} for e in json.load(open(op))]
    else:
        est = run(y)
    gt = json.load(open(f[:-4] + ".json"))["notes"]
    if not os.path.exists(op): json.dump([{"onset": float(e["onset_time"]), "offset": float(e["offset_time"]), "midi": int(e["midi_note"]), "velocity": int(e["velocity"])} for e in est], open(os.path.join(a.out, tid + ".json"), "w"))
    ri = np.array([[max(0.0, n["onset_s"]), max(n["offset_s"], max(0.0, n["onset_s"]) + 0.01)] for n in gt]); rp = np.array([440 * 2 ** ((n["midi"] - 69) / 12) for n in gt])
    if est:
        ei = np.array([[max(0.0, e["onset_time"]), max(e["offset_time"], max(0.0, e["onset_time"]) + 0.01)] for e in est]); ep = np.array([440 * 2 ** ((e["midi_note"] - 69) / 12) for e in est])
        p_, r_, f_, _ = mir_eval.transcription.precision_recall_f1_overlap(ri, rp, ei, ep, onset_tolerance=0.05, offset_ratio=None)
    else: p_ = r_ = f_ = 0.0
    P.append(p_); R.append(r_); F.append(f_)
print(json.dumps({"tracks": len(files), "audio_s": round(dur), "wall_s": round(time.time() - t0), "P": round(100 * np.mean(P), 2), "R": round(100 * np.mean(R), 2), "F50": round(100 * np.mean(F), 2)}))
