"""GuitarSet (Xi et al. 2018, CC-BY 4.0) → one <track>.wav (mono mic, 16 kHz) + <track>.json
(annotated notes with string, player, style, tempo) per track, for tests/bench/guitarset.mjs,
fingering.mjs --gs and guitar-e2e.mjs. Dev-only.
usage: HF_HUB_DISABLE_XET=1 hf download jhartquist/guitarset --repo-type dataset --local-dir /tmp/gs
       python scripts/guitarset_extract.py /tmp/gs /tmp/gs_ex      (needs pyarrow, soundfile, librosa)"""
import sys, os, io, json, glob, numpy as np, pyarrow.parquet as pq, soundfile as sf, librosa
src, dst = sys.argv[1], sys.argv[2]; os.makedirs(dst, exist_ok=True)
n = 0
for f in sorted(glob.glob(os.path.join(src, "data/train/*.parquet"))):
    t = pq.read_table(f, columns=["track_id", "player", "style", "tempo_bpm", "duration_s", "audio_mono_mic", "notes"]).to_pylist()
    for r in t:
        a = r["audio_mono_mic"]
        y, sr = sf.read(io.BytesIO(a["bytes"]), dtype="float32", always_2d=True)
        y = y.mean(axis=1)
        y16 = librosa.resample(y, orig_sr=sr, target_sr=16000, res_type="soxr_hq")
        sf.write(os.path.join(dst, r["track_id"] + ".wav"), y16, 16000, subtype="PCM_16")
        json.dump({k: r[k] for k in ["track_id", "player", "style", "tempo_bpm", "duration_s", "notes"]}, open(os.path.join(dst, r["track_id"] + ".json"), "w"))
        n += 1
    print(f, n, flush=True)
print("tracks", n)
