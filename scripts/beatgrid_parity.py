"""Muscriptor v0.4.0 (MIT) reference outputs for the beat-grid port in engine.tsx → tests/fixtures/beatgrid-parity.json.
Dev-only. Runs Muscriptor's own functions (lifted out of utils/beats.py + utils/midi.py by name, so no torch or model
is needed) on seeded synthetic beat sequences with missed/extra beats, drift and jitter.
usage: git clone https://github.com/muscriptor/muscriptor && git -C muscriptor checkout v0.4.0
       python -I scripts/beatgrid_parity.py muscriptor/muscriptor/utils tests/fixtures/beatgrid-parity.json"""
import ast, json, math, sys, dataclasses, numpy as np
M, OUT = sys.argv[1], sys.argv[2]
ns = {"Onsets": object, "np": np, "math": math, "dataclasses": dataclasses, "logger": __import__("logging").getLogger("x")}
for f, names in [(M + "/beats.py", ["fit_tempo","regularized_beats","infer_beats_per_bar","get_onsets_phase","get_phase_with_subdivision"]),
                 (M + "/midi.py", ["smoothed_beats","rescaled_beats","nearest","_extrapolated"])]:
    src = open(f).read(); tree = ast.parse(src)
    for node in tree.body:
        if isinstance(node, ast.Assign) and all(isinstance(t, ast.Name) and t.id.isupper() for t in node.targets) and "Grid(" not in ast.unparse(node):
            exec(compile(ast.Module([node], []), f, "exec"), ns)
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names + ["Timeline"]:
            exec(compile(ast.Module([node], []), f, "exec"), ns)
rng = np.random.default_rng(7)
cases = []
for k in range(14):
    n = int(rng.integers(12, 80)); period = float(rng.uniform(0.3, 0.9))
    drift = float(rng.uniform(-0.002, 0.002))
    b = np.cumsum(period * (1 + drift * np.arange(n)) + rng.normal(0, 0.01, n))
    if k % 3 == 0: b = np.delete(b, [5, 9])          # missed beats
    if k % 4 == 0: b = np.sort(np.append(b, b[7] + 0.05))  # extra beat
    db = b[::4][:]
    onsets = (b[:-1, None] + np.array([0, 0.5])[None, :] * np.diff(b)[:, None]).ravel() + 0.012 + rng.normal(0, 0.004, (len(b)-1)*2) if len(b) > 1 else np.array([])
    rb = ns["regularized_beats"](b)
    bpm, res = ns["fit_tempo"](rb)
    tl = ns["Timeline"](rb, np.arange(len(rb)) - 0.0)
    simp = tl.simplified(0.025, 4)
    phases = ns["get_onsets_phase"](onsets, rb)
    subs = {s: ns["get_phase_with_subdivision"](phases, s) for s in (1,2,3,4,6,8,12,16,24)}
    cases.append(dict(beats=b.tolist(), downbeats=db.tolist(), onsets=onsets.tolist(), reg=rb.tolist(), bpm=bpm, res=res,
        smooth=ns["smoothed_beats"](rb).tolist(), x2=ns["rescaled_beats"](rb, 2, float(rb[3])).tolist(), half=ns["rescaled_beats"](rb, 0.5, float(rb[3])).tolist(),
        meter=ns["infer_beats_per_bar"](rb, db), simpT=simp.times.tolist(), simpP=simp.positions.tolist(),
        tempo=simp.tempo_changes(480), subs={str(k): v for k, v in subs.items()}))
json.dump(cases, open(OUT, "w"), separators=(",", ":"))
print(len(cases), "cases ->", OUT)
