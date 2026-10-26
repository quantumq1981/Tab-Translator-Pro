# Calibration recordings — what to record, and why

The benches score the engine on **synthetic** renders (chords) and on **GuitarSet** (one acoustic
guitar, standard tuning, 6 players). Both are cleaner and narrower than real use. Recordings made to
this protocol become ground truth for the parts of the pipeline that are least measured today.
Every set below has its answer key built in, so nothing needs annotating by hand.

## Format (all sets)

- **WAV or AIFF, uncompressed**, 44.1 or 48 kHz, 24-bit if possible. Not MP3/AAC — lossy codecs
  smear exactly the high partials that tell strings apart.
- **Mono, one instrument per file.** If you can, record **two takes at once**: DI (straight from
  the guitar or an amp sim) and a mic. They measure different things.
- No effects except the normal amp tone. A count-in (4 clicks) at the start helps alignment.
- File name: `<set>_<instrument>_<tuning>_<capo>_<take>.wav`, e.g. `S1_strat_halfDown_capo0_t1.wav`.
  Add a line in a `NOTES.txt` beside them: guitar, pickups, string gauge, mic.

## S1 — "play the tab as written" (the most valuable set)

Pick a GP file already in this repo (e.g. Blue Sky, Sweet Child O' Mine, Peg's guitar part) and
play one part **exactly as the tab shows it**: same strings, same frets, same tuning, to a click at
the file's tempo. The GP file is then the answer key for every note: pitch, onset, **string**, fret.

Measures: Guitar → Tab note accuracy AND string accuracy on your own guitars — the number
(Tab F1 ~58–62 on GuitarSet) we most need to raise.

- 3–5 parts, 30–90 s each. Mix rhythm (chords) and lead (single notes, bends, slides).
- At least one part in **half step down** and one in **Drop D** (Sweet Child, Schism/Sledgehammer).

## S2 — one string at a time (string fingerprints)

For each string, low E → high e: play frets **0, 3, 5, 7, 9, 12** as single notes, one every two
beats at ♩=60, let each ring. Then the same pitch on different strings, e.g. E4 as open e, B string
5th fret, G 9th, D 14th.

Measures: whether a string can be identified from the sound (thicker strings have more inharmonic,
duller partials). This is the training/check data for adding audio evidence to string choice
(today the string is chosen by playability alone).

## S3 — same riff, different tunings

One short riff (4–8 bars, open strings included) recorded in **standard, half step down, Drop D**,
and once in standard with a **capo at 2** (playing the same shapes).

Measures: tuning detection from audio. Today it uses pitch only (notes below standard's low E), which
can't see a half-step-down part that stays above E♭2; open strings ring differently from fretted
notes, which audio might catch.

## S4 — real chord comping

Comp the chord changes of 2–3 corpus songs (e.g. Peg, Confirmation, Blue Sky) on real guitar and,
if you have one, piano/keys, to a click: one strum or one chord per beat, using voicings you
normally play.

Measures: the audio chord decoder on real instruments (amp, fret noise, real rooms), where the
benchmark's 77–80 % comes from synthetic renders. Gives the guide-tone / template work real data.

## S5 — a real mix with known parts (optional)

If you have multitrack sessions of your own songs: the stems plus the mixdown. Measures stem
separation and charts-from-stems on real material.

## What happens with them

Each set gets a bench script (`tests/bench/`), dev/test split by take, the same way the GP corpus
and GuitarSet are used. Recordings stay out of the repo unless you want them committed; a local
path works.
