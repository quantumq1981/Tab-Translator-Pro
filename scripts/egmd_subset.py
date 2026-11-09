"""Dev-only: build the E-GMD evaluation subset for tests/bench/adt.mjs (work order WPO-ADT-001).

E-GMD (Expanded Groove MIDI Dataset v1.0.0, Magenta; Callender, Hawthorne & Engel 2020) is
CC BY 4.0: 444 h of a human drummer on a Roland TD-17, rendered through 43 sampled kits, audio
sample-aligned with MIDI that carries velocities. The archive is 96 GB, so this reads ONLY the
chosen files out of it with HTTP range requests (the zip's central directory, then each entry).

    pip install mido soundfile
    python3 -I scripts/egmd_subset.py <out_dir> [--dev 30] [--test 30] [--seed 7]

Writes <out_dir>/<wav + midi files> and <out_dir>/truth.json:
  [{ split: "dev"|"test", id, kit, bpm, audio, sr, dur, notes: [[t, gm, vel]], beats: [t] }]
dev = E-GMD "validation" split, test = "test". ONE kit per performance (the same take
re-rendered through another kit is not scored twice), kits spread, 6–40 s takes.
"""
import argparse, collections, csv, io, json, os, random, urllib.request, zipfile

BASE = "https://storage.googleapis.com/magentadata/datasets/e-gmd/v1.0.0/"


class RangeFile(io.RawIOBase):
    """A read-only, seekable view of a remote file through HTTP Range requests."""
    def __init__(self, url):
        self.url, self.pos = url, 0
        self.size = int(urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=60).headers["Content-Length"])
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos
    def readinto(self, b):
        if self.pos >= self.size or not len(b): return 0
        end = min(self.size, self.pos + len(b)) - 1
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{end}"})
        data = urllib.request.urlopen(req, timeout=120).read()
        b[:len(data)] = data; self.pos += len(data)
        return len(data)


def pick(rows, split, n, rnd):
    rows = [r for r in rows if r["split"] == split and 6 <= float(r["duration"]) <= 40]
    by_id = collections.defaultdict(list)
    for r in rows: by_id[r["id"]].append(r)
    ids = sorted(by_id); rnd.shuffle(ids)
    kits, out = collections.Counter(), []
    for i in ids:
        c = sorted(by_id[i], key=lambda r: (kits[r["kit_name"]], r["audio_filename"]))[0]
        kits[c["kit_name"]] += 1; out.append(c)
        if len(out) >= n: break
    return out


def midi_truth(path):
    import mido
    m = mido.MidiFile(path); tpb = m.ticks_per_beat
    notes, beats, t, tick, tempo, nb = [], [], 0.0, 0, 500000, 0
    for msg in mido.merge_tracks(m.tracks):
        if msg.time:
            end = tick + msg.time
            while nb * tpb <= end:
                beats.append(round(t + (nb * tpb - tick) * tempo / 1e6 / tpb, 4)); nb += 1
            t += msg.time * tempo / 1e6 / tpb; tick = end
        if msg.type == "set_tempo": tempo = msg.tempo
        if msg.type == "note_on" and msg.velocity > 0: notes.append([round(t, 4), msg.note, msg.velocity])
    return notes, beats


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("out"); ap.add_argument("--dev", type=int, default=30)
    ap.add_argument("--test", type=int, default=30); ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args(); os.makedirs(a.out, exist_ok=True)
    rows = list(csv.DictReader(io.TextIOWrapper(urllib.request.urlopen(BASE + "e-gmd-v1.0.0.csv", timeout=120), "utf-8")))
    rnd = random.Random(a.seed)
    chosen = [("dev", r) for r in pick(rows, "validation", a.dev, rnd)] + [("test", r) for r in pick(rows, "test", a.test, rnd)]
    z = zipfile.ZipFile(io.BufferedReader(RangeFile(BASE + "e-gmd-v1.0.0.zip"), buffer_size=1 << 20))
    index = {i.filename.split("/", 1)[-1]: i for i in z.infolist()}
    import soundfile as sf
    truth = []
    for split, r in chosen:
        for name in (r["midi_filename"], r["audio_filename"]):
            p = os.path.join(a.out, name)
            if not os.path.exists(p):
                os.makedirs(os.path.dirname(p), exist_ok=True)
                with open(p, "wb") as f: f.write(z.read(index[name]))
        notes, beats = midi_truth(os.path.join(a.out, r["midi_filename"]))
        info = sf.info(os.path.join(a.out, r["audio_filename"]))
        truth.append(dict(split=split, id=r["id"], kit=r["kit_name"], bpm=int(r["bpm"]), style=r["style"],
                          ts=r["time_signature"], audio=r["audio_filename"], sr=info.samplerate, dur=info.duration,
                          notes=notes, beats=[b for b in beats if b <= info.duration + 0.01]))
        print(split, r["audio_filename"], len(notes), flush=True)
    json.dump(truth, open(os.path.join(a.out, "truth.json"), "w"))
    print({s: sum(1 for t in truth if t["split"] == s) for s in ("dev", "test")})


if __name__ == "__main__":
    main()
