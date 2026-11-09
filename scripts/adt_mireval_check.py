"""Dev-only: check tests/bench/adt-metrics.mjs against mir_eval.

    node tests/bench/adt.mjs --data <dir> --variant base --dump est.json
    python3 scripts/adt_mireval_check.py est.json

Recomputes every track's per-class onset F with mir_eval.onset.f_measure (±50 ms) on the same
(merged) event lists and reports the largest difference from the JS harness.
"""
import json, sys
import numpy as np, mir_eval
D = json.load(open(sys.argv[1])); worst = 0.0; n = 0
for tr in D:
    for c, fjs in tr["f"].items():
        r = np.array(sorted(t for t, k in tr["ref"] if k == c)); e = np.array(sorted(t for t, k in tr["est"] if k == c))
        if not len(r) and not len(e): continue
        f = mir_eval.onset.f_measure(r, e, window=0.05)[0] if len(r) and len(e) else 0.0
        worst = max(worst, abs(f - fjs)); n += 1
print(f"{n} track×class scores · max |mir_eval − harness| = {worst:.2e}")
sys.exit(0 if worst < 1e-9 else 1)
