import os, sys, numpy as np, onnx
from onnx import numpy_helper, helper
def weight_only_int8(src, dst):   # same scheme as scripts/guitar_crnn_export.py (per-row scale + DequantizeLinear)
    m = onnx.load(src); g = m.graph; inits, deq = [], []
    for init in g.initializer:
        a = numpy_helper.to_array(init)
        if a.dtype != np.float32 or a.size < 4096 or a.ndim < 2: inits.append(init); continue
        flat = a.reshape(a.shape[0], -1); scale = np.abs(flat).max(axis=1) / 127.0; scale[scale == 0] = 1e-12
        q = np.clip(np.round(flat / scale[:, None]), -127, 127).astype(np.int8).reshape(a.shape)
        qn, sn, zn = init.name + "_q", init.name + "_s", init.name + "_z"
        inits += [numpy_helper.from_array(q, qn), numpy_helper.from_array(scale.astype(np.float32), sn), numpy_helper.from_array(np.zeros(a.shape[0], np.int8), zn)]
        deq.append(helper.make_node("DequantizeLinear", [qn, sn, zn], [init.name], axis=0))
    del g.initializer[:]; g.initializer.extend(inits); old = list(g.node); del g.node[:]; g.node.extend(deq + old)
    onnx.checker.check_model(m); onnx.save(m, dst); print(dst, round(os.path.getsize(dst) / 1e6, 1), "MB")
for f in ["smt-enc.onnx", "smt-dec.onnx"]: weight_only_int8("smt-onnx/" + f, "smt-onnx-w8/" + f)
