"""Run the SHIPPED guitar CRNN (models/guitar-crnn/guitar-gaps.w8.onnx) over GuitarSet and save its raw,
deframed outputs (onset / offset / frame / velocity, [frames x 88] at 100 fps) as float16 per track, for
tests/bench/scoretab.mjs — which runs the JS post-processor (crnnNotesFromOutputs) and the score-informed
recovery on them, exactly as the app does. Dev-only.

usage: python -I scripts/guitarset_activations.py <model.onnx> <gs_ex dir> <out dir> [--every M]
  <gs_ex dir> = scripts/guitarset_extract.py output (<track>.wav 16 kHz mono + <track>.json).
  Writes <out>/<track>.f16: [onset | offset | frame | velocity] concatenated, each frames*88 halves;
  <out>/<track>.json: {"frames": N, "classes": 88, "heads": [...]}."""
import sys, os, json, glob, argparse, numpy as np, soundfile as sf, onnxruntime as ort

ap = argparse.ArgumentParser(); ap.add_argument("model"); ap.add_argument("gs"); ap.add_argument("out"); ap.add_argument("--every", type=int, default=1); ap.add_argument("--reverse", action="store_true")
a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
so = ort.SessionOptions(); so.intra_op_num_threads = 4
sess = ort.InferenceSession(a.model, so, providers=["CPUExecutionProvider"])
names = [o.name for o in sess.get_outputs()]
SEG = 160000

def deframe(x):                         # Kong's deframe: keep the middle half of each 50 %-overlapped window
    if x.shape[0] == 1: return x[0]
    x = x[:, :-1, :]; n, L, _ = x.shape
    y = [x[0, : int(L * .75)]] + [x[i, int(L * .25): int(L * .75)] for i in range(1, n - 1)] + [x[-1, int(L * .25):]]
    return np.concatenate(y, 0)

heads = ["onset", "offset", "frame", "velocity"]
want = {"onset": "reg_onset_output", "offset": "reg_offset_output", "frame": "frame_output", "velocity": "velocity_output"}
files = sorted(glob.glob(os.path.join(a.gs, "*.wav")))[:: a.every]
if a.reverse: files = files[::-1]
for i, f in enumerate(files):
    tid = os.path.splitext(os.path.basename(f))[0]
    dst = os.path.join(a.out, tid + ".f16")
    if os.path.exists(dst): continue
    audio, sr = sf.read(f, dtype="float32"); assert sr == 16000
    L = len(audio); pad = int(np.ceil(L / SEG)) * SEG - L
    x = np.concatenate([audio, np.zeros(pad, np.float32)])
    segs = [x[p:p + SEG] for p in range(0, len(x) - SEG + 1, SEG // 2)]
    outs = {n: [] for n in names}
    for s in segs:
        r = sess.run(None, {sess.get_inputs()[0].name: s[None].astype(np.float32)})
        for n, v in zip(names, r): outs[n].append(v[0])
    frames = L // 160 + 1
    od = {n: deframe(np.stack(v))[:frames] for n, v in outs.items()}
    arr = np.concatenate([od[want[h]].astype(np.float16).ravel() for h in heads])
    arr.tofile(dst)
    json.dump({"frames": int(od[names[0]].shape[0]), "classes": 88, "heads": heads, "outputs": names}, open(os.path.join(a.out, tid + ".json"), "w"))
    if i % 20 == 0: print(i, len(files), tid, flush=True)
print("done", len(files))
