"""Dev-only BASELINE: Magenta Onsets & Frames DRUMS (E-GMD checkpoint) on the E-GMD subset.
Not shipped. Work order WPO-ADT-001 §5 (baseline requirement) — see docs/DRUM-TRANSCRIPTION.md.

Setup (Python 3.13, CPU):
    python3 -m venv tfv && tfv/bin/pip install tensorflow-cpu tf_slim "tf_keras~=2.21.0" note_seq \
        librosa mido soundfile audioop-lts mir_eval pretty_midi
    tfv/bin/pip install --no-deps magenta==2.1.4
    curl -O https://storage.googleapis.com/magentadata/models/onsets_frames_transcription/e-gmd_checkpoint.zip
    unzip e-gmd_checkpoint.zip -d oaf
Run:
    TF_USE_LEGACY_KERAS=1 tfv/bin/python -I scripts/oaf_drums_baseline.py <subset_dir> <out.json> <oaf_dir>/model.ckpt-569400
Score:
    cd tests && node bench/adt.mjs --data <subset_dir> --variant file --est <out.json>

Magenta 2.1.4 predates TF 2.16: tf.estimator, tensorflow_probability and sox are stubbed (only
the graph-building code is used), and tf_keras's legacy layers are aliased for tf_slim.
"""
import sys, types, json, numpy as np, soundfile as sf, librosa
import importlib
try:
    import tf_keras.src.legacy_tf_layers as _l; sys.modules['tf_keras.legacy_tf_layers']=_l
    for _n in ['base','convolutional','core','normalization','pooling','variable_scope_shim']:
        try: sys.modules['tf_keras.legacy_tf_layers.'+_n]=importlib.import_module('tf_keras.src.legacy_tf_layers.'+_n)
        except Exception as e: print('alias',_n,e)
except Exception as e: print('alias fail',e)
import tensorflow as tf
import tensorflow.compat.v1 as v1
if not hasattr(v1, "estimator"):
    est = types.ModuleType("tensorflow.compat.v1.estimator"); est.ModeKeys = types.SimpleNamespace(TRAIN="train", EVAL="eval", PREDICT="infer")
    sys.modules["tensorflow.compat.v1.estimator"] = est; v1.estimator = est
v1.disable_eager_execution()
import importlib.abc
class _Stub(types.ModuleType):
    def __getattr__(self, k):
        if k.startswith('__'): raise AttributeError(k)
        return _Stub(k)
    def __call__(self,*a,**k): return _Stub('x')
for _m in ['tensorflow_probability','tensorflow_probability.distributions','sox']: sys.modules[_m]=_Stub(_m)
from magenta.models.onsets_frames_transcription import configs, model_tpu
hp = configs.CONFIG_MAP["drums"].hparams
DATA, OUT = sys.argv[1], sys.argv[2]
truth = json.load(open(DATA + "/truth.json"))
g = tf.Graph()
with g.as_default():
    spec = v1.placeholder(tf.float32, [1, None, hp.spec_n_bins, 1]); length = v1.placeholder(tf.int32, [1])
    fr, on, off, vel = model_tpu.build_model(spec, length, hp, is_training=False)
    onp = tf.sigmoid(on)
    sess = v1.Session(graph=g)
    saver = v1.train.Saver(); saver.restore(sess, sys.argv[3])
fps = hp.sample_rate / hp.spec_hop_length
out = []
for o in truth:
    y, sr = sf.read(DATA + "/" + o["audio"], dtype="float32")
    if y.ndim > 1: y = y.mean(1)
    if sr != hp.sample_rate: y = librosa.resample(y, orig_sr=sr, target_sr=hp.sample_rate)
    m = librosa.feature.melspectrogram(y=y, sr=hp.sample_rate, hop_length=hp.spec_hop_length, fmin=hp.spec_fmin, n_mels=hp.spec_n_bins, htk=hp.spec_mel_htk).astype(np.float32)
    m = librosa.power_to_db(m).T
    P, V = sess.run([onp, vel], {spec: m[None, :, :, None], length: [m.shape[0]]})
    P, V = P[0], V[0]
    ev = []
    for k in range(P.shape[1]):
        a = P[:, k] > hp.predict_onset_threshold
        for t in np.nonzero(a & ~np.concatenate([[False], a[:-1]]))[0]:
            ev.append([round(t / fps, 4), 21 + k, int(np.clip(V[t, k] * hp.velocity_scale + hp.velocity_bias, 1, 127))])
    out.append({"audio": o["audio"], "notes": sorted(ev)})
    print(o["audio"], len(ev), len(o["notes"]), flush=True)
json.dump(out, open(OUT, "w"))
