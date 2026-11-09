"""Export Magenta Onsets & Frames DRUMS (E-GMD checkpoint) to ONNX for the browser.

Source: magenta/magenta (Apache-2.0), models/onsets_frames_transcription, config "drums";
checkpoint e-gmd_checkpoint.zip (model.ckpt-569400), trained on E-GMD (CC BY 4.0).
Callender, Hawthorne & Engel, "Improving Perceptual Quality of Drum Transcription with the
Expanded Groove MIDI Dataset", 2020.

Only the heads the app uses are exported: onset probabilities and velocities (the frame and
offset networks are pruned when the graph is frozen; so is the
`length` input, which the onset and velocity stacks never read). Input = the log-mel spectrogram the
model was trained on (engine.tsx `oafDrumLogMel` computes it in JS).

    input  spec   float32 [1, T, 250, 1]   (power_to_db of a 250-band HTK mel, hop 512 @ 44.1 kHz)
    output onset_probs float32 [1, T, 88]  (sigmoid; MIDI pitch = 21 + index)
           velocity    float32 [1, T, 88]  (× 127 = MIDI velocity)

Steps: build the graph from Magenta's own code (model_tpu.build_model), restore, freeze,
tf2onnx (opset 17), check against TensorFlow on a real recording, then WEIGHT-ONLY int8
(per-output-channel scale + DequantizeLinear; activations stay fp32 — ORT's dynamic
quantisation was measured to destroy the guitar CRNN, so it is not used here either).

    (environment as in scripts/oaf_drums_baseline.py, plus: pip install tf2onnx onnx onnxruntime)
    TF_USE_LEGACY_KERAS=1 python -I scripts/oaf_drums_export.py <ckpt_prefix> <check.wav> <out_dir>
"""
import hashlib, os, sys, types, importlib

# ---- Magenta 2.1.4 on TF 2.21: the shims scripts/oaf_drums_baseline.py documents ----
try:
    import tf_keras.src.legacy_tf_layers as _l
    sys.modules["tf_keras.legacy_tf_layers"] = _l
    for _n in ["base", "convolutional", "core", "normalization", "pooling", "variable_scope_shim"]:
        sys.modules["tf_keras.legacy_tf_layers." + _n] = importlib.import_module("tf_keras.src.legacy_tf_layers." + _n)
except Exception as e:
    print("tf_keras alias:", e)
import numpy as np
import tensorflow as tf
import tensorflow.compat.v1 as v1
if not hasattr(v1, "estimator"):
    est = types.ModuleType("tensorflow.compat.v1.estimator")
    est.ModeKeys = types.SimpleNamespace(TRAIN="train", EVAL="eval", PREDICT="infer")
    sys.modules["tensorflow.compat.v1.estimator"] = est; v1.estimator = est
class _Stub(types.ModuleType):
    def __getattr__(self, k):
        if k.startswith("__"): raise AttributeError(k)
        return _Stub(k)
    def __call__(self, *a, **k): return _Stub("x")
for _m in ["tensorflow_probability", "tensorflow_probability.distributions", "sox"]: sys.modules[_m] = _Stub(_m)
v1.disable_eager_execution()
v1.disable_control_flow_v2()   # TF1 while-loops + TensorArrays: tf2onnx rewrites those into ONNX LSTM ops
from magenta.models.onsets_frames_transcription import configs, model_tpu
import librosa, soundfile as sf, onnx, onnxruntime as ort
from onnx import helper, numpy_helper
import tf2onnx

HP = configs.CONFIG_MAP["drums"].hparams


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()


def log_mel(path):
    y, sr = sf.read(path, dtype="float32")
    if y.ndim > 1: y = y.mean(1)
    if sr != HP.sample_rate: y = librosa.resample(y, orig_sr=sr, target_sr=HP.sample_rate)
    m = librosa.feature.melspectrogram(y=y, sr=HP.sample_rate, hop_length=HP.spec_hop_length, fmin=HP.spec_fmin,
                                       n_mels=HP.spec_n_bins, htk=HP.spec_mel_htk).astype(np.float32)
    return librosa.power_to_db(m).T.astype(np.float32)


def freeze(ckpt):
    g = tf.Graph()
    with g.as_default():
        spec = v1.placeholder(tf.float32, [1, None, HP.spec_n_bins, 1], name="spec")
        length = v1.placeholder(tf.int32, [1], name="length")
        _frame, onset, _off, vel = model_tpu.build_model(spec, length, HP, is_training=False)
        tf.identity(tf.sigmoid(onset), name="onset_probs_out"); tf.identity(vel, name="velocity_out")
        sess = v1.Session(graph=g); v1.train.Saver().restore(sess, ckpt)
        gd = v1.graph_util.convert_variables_to_constants(sess, g.as_graph_def(), ["onset_probs_out", "velocity_out"])
    return sess, gd


def weight_only_int8(src, dst):
    m = onnx.load(src); g = m.graph
    # the output-channel axis depends on the consumer: MatMul B is [in, out] (axis 1), an ONNX
    # LSTM's W/R are [dirs, 4H, in] (axis 1), a Conv kernel is [out, in, kh, kw] (axis 0)
    axis_of = {}
    for n in g.node:
        if n.op_type == "MatMul" and len(n.input) > 1: axis_of[n.input[1]] = 1
        elif n.op_type == "LSTM":
            for k in (1, 2): axis_of[n.input[k]] = 1
        elif n.op_type == "Conv" and len(n.input) > 1: axis_of[n.input[1]] = 0
    inits, deq, n_q = [], [], 0
    for init in g.initializer:
        a = numpy_helper.to_array(init)
        if a.dtype != np.float32 or a.size < 4096 or a.ndim < 2 or init.name not in axis_of:
            inits.append(init); continue
        ax = axis_of[init.name]
        mv = np.moveaxis(a, ax, 0); flat = mv.reshape(mv.shape[0], -1)
        scale = np.abs(flat).max(axis=1) / 127.0; scale[scale == 0] = 1e-12
        shape = [1] * a.ndim; shape[ax] = -1
        q = np.clip(np.round(a / scale.reshape(shape)), -127, 127).astype(np.int8)
        qn, sn, zn = init.name + "_q", init.name + "_s", init.name + "_z"
        inits += [numpy_helper.from_array(q, qn), numpy_helper.from_array(scale.astype(np.float32), sn),
                  numpy_helper.from_array(np.zeros(len(scale), np.int8), zn)]
        deq.append(helper.make_node("DequantizeLinear", [qn, sn, zn], [init.name], axis=ax)); n_q += 1
    del g.initializer[:]; g.initializer.extend(inits)
    old = list(g.node); del g.node[:]; g.node.extend(deq + old)
    onnx.checker.check_model(m); onnx.save(m, dst)
    return n_q


def onsets(P, thr=0.5):
    a = P > thr
    return {(int(t), int(k)) for t, k in zip(*np.nonzero(a & ~np.concatenate([np.zeros((1, a.shape[1]), bool), a[:-1]], 0)))}


def main():
    ckpt, wav, out = sys.argv[1:4]; os.makedirs(out, exist_ok=True)
    sess, gd = freeze(ckpt)
    x = log_mel(wav)[None, :, :, None]; L = np.array([x.shape[1]], np.int32)
    g = sess.graph
    P_tf, V_tf = sess.run([g.get_tensor_by_name("onset_probs_out:0"), g.get_tensor_by_name("velocity_out:0")], {"spec:0": x, "length:0": L})
    fp32 = os.path.join(out, "oaf-drums.fp32.onnx")
    tf2onnx.convert.from_graph_def(gd, input_names=["spec:0"], output_names=["onset_probs_out:0", "velocity_out:0"],
                                   opset=17, output_path=fp32)
    m = onnx.load(fp32)
    print("ops:", sorted({n.op_type for n in m.graph.node}))
    def run(p, xx, LL):
        s = ort.InferenceSession(p, providers=["CPUExecutionProvider"])
        return s.run(None, {s.get_inputs()[0].name: xx})
    P1, V1 = run(fp32, x, L)
    e = float(np.abs(P1 - P_tf).max()); ev = float(np.abs(V1 - V_tf).max())
    print(f"fp32 ONNX vs TF: max |Δ onset prob| {e:.2e}, |Δ velocity| {ev:.2e}, {os.path.getsize(fp32)/1e6:.1f} MB")
    assert e < 1e-3 and ev < 1e-3, "fp32 ONNX disagrees with TensorFlow"
    q8 = os.path.join(out, "oaf-drums.w8.onnx")
    n = weight_only_int8(fp32, q8)
    P2, V2 = run(q8, x, L)
    ref, got = onsets(P_tf[0]), onsets(P2[0])
    print(f"weight-only int8: {n} tensors → {os.path.getsize(q8)/1e6:.1f} MB · max |Δ onset prob| {np.abs(P2-P_tf).max():.3f} · "
          f"onsets TF {len(ref)} / int8 {len(got)} / same frame+pitch {len(ref & got)} · SHA-256 {sha256(q8)}")
    # a shorter input must work too (dynamic time axis)
    P3, _ = run(q8, x[:, :300], np.array([300], np.int32)); assert P3.shape[1] == 300


if __name__ == "__main__":
    main()
