# Score ↔ recording link — notation and audio read together

*2026-11-06. Code: `engine.tsx` block "SCORE ↔ RECORDING LINK", `TabDecoderPro.tsx` `ScoreLinkPanel`.
Benches: `tests/bench/scorelink.mjs` (synthetic, known truth), `tests/bench/link-real.mjs` (a real
record + its score), `tests/bench/link-e2e.mjs` (the real app). Guards: `tests/score-link.mjs`.*

## Why

The notation paths (C–G: MusicXML · Guitar Pro 3–8 · GPX · Power Tab · MIDI) know **what** is played —
exact pitches, bars, meter, sections — and nothing about **when** a real recording plays it. The audio
paths know **when**, and can only guess **what**. They were completely separate. With a recording AND
an accurate score, the chart built from the pair is better than either alone:

| | audio alone | score alone | score + recording (linked) |
|---|---|---|---|
| chord names | ~77 % root on clean stems, ~55 % on a full mix | exact (if the file is right) | the score's, unless the recording clearly plays something else |
| bar lines / tempo | beat tracker (bar 1 often guessed) | the score's ♩, nothing about the record | the score's bars on the recording's own tempo map |
| sections | detected (heuristic names) | written | written, at the recording's times |
| wrong bars in the file | — | copied | overruled by clear audio, listed for review |
| a capo / transposed file | — | wrong key | detected and reported (12 transpositions searched) |

## How (pure engine, worker-safe)

1. **`scoreLinkParts`** — every part of the file (one parse each), drum kits out (the parser's new
   `drum` flag: GP7/8 `InstrumentSet` drumKit, GP6 `Instrument ref="drmkt"`, GP3/4/5 track flag 0x01;
   or a drum name / all-zero tuning). A chordal part (≥ 1.8 notes per onset) weighs 1, a single line
   0.35. Voices stay in for the alignment, not for the chord prior.
2. **`linkScoreToAudio`** — recording: NNLS treble + bass chroma (the v2 front-end), beat-synchronous;
   score: sounding notes per quarter. **Semi-global DTW with one BEAT per step** (`linkBeatDTW`):
   unmatched recording beats (intro, outro, fade) and unmatched score beats each cost a fixed skip,
   one-beat-to-two steps a penalty. Candidate grids: the tracker's beats rescaled to the score's
   quarter (×½, ×⅔, ×1, ×1.5, ×2, every phase) **and** a uniform grid at the score's ♩; the 3 best
   transpositions by pitch-class histogram are aligned on each; the **lowest total path cost** wins.
   Then a **fine pass** (`_linkRefine`) at the 0.1 s frame rate inside ±1 quarter of that path, and
   linked quarters **snap** onto a tracked beat within 120 ms (onset precision).
3. **The chord HMM with the score as evidence** (`analyzeAudioWithScore` → `transcribeChordsV2`
   `opts.scorePrior` → `_scorePriorBonus`): the v2 decoder runs on the score's beats; each segment's
   score chroma (comping parts, bass from the lowest instrumental note, **let-ring carry** so an
   arpeggio reads its chord) is named by the **recognition oracle** — the same rules every imported
   chart is named with — and that state gets `scoreWeight`, every other state 70 % of its relative
   template match. Events carry `scoreSymbol` / `agree`; a disagreement goes to the **review list**
   with the score's chord as the first alternative (`fromScore`).
4. **`linkedChartScore`** — the result on the score's bars (performance order: `unrollRepeatOrder`
   plays |: :| twice with 1st/2nd endings), sections from the score, `audioOffset` = bar 1 in the
   record, a tempo map simplified to the fewest bar-line changes within 100 ms, a timeline. Playback,
   🎧 Check by ear, practice loops and every exporter (CSMPN `Tempo Map:`, MusicXML, MIDI, ABC…) follow
   the record; the Chord Sheet Maker Pro handoff carries it.

Also built on the way: **Harmony (all parts) for Guitar Pro / GPX / Power Tab** (`_harmonyOfParts`; it
existed only for MusicXML/MIDI), drum kits flagged by every GP parser.

## Measured

### Synthetic, known truth — `node bench/scorelink.mjs --split dev|test`

Each corpus comp part rendered with a **tempo warp the score does not know** (±6 % sine over 12 bars,
one bar 20 % slower), 60 s from the first chord, under clean / 20 dB noise / drum+bass bleed. The
linker gets the bars the recording plays ±2 bars of slack. Truth = the notated harmony named in the
Pro vocabulary (MIREX-style); synthetic, so deltas are the read.

**Dev split (14 songs × 3 conditions), root / majmin / sevenths %:**

| | root | majmin | sevenths |
|---|---|---|---|
| audio alone (v2, Pro names — the shipped default) | 77.7 | 77.7 | 72.6 |
| linked, exact score, weight 0.3 (Balanced) | **88.1** | **87.4** | **86.3** |
| linked, score with **20 % of bars wrong**, 0.3 | 85.6 | 85.2 | 82.3 |
| linked, score with **40 % of bars wrong**, 0.3 | 81.4 | 80.2 | 76.4 |
| the 20 %-wrong score copied blindly | 72.3 | 72.3 | 71.7 |
| exact score trusted fully (weight 50) | 89.2 | 88.6 | 87.5 |
| exact score written 3 semitones up | 86.2 (transposition found 42/42) | | |

Weights: 0.15 → exact 86.2 / 20 %-wrong 84.4; **0.3 → 88.1 / 85.6**; 0.6 → 88.8 / 80.8 (40 %-wrong
drops to 71.0). 0.3 is the default ("Balanced"): within a point of trusting a right file, and it still
beats copying a file a fifth wrong by 13 points. "Score" (1.0) is for a transcription you know is
right; "Recording" (0.15) for a live take or another arrangement.

**Test split (held out, 14 other songs × 3 conditions) — the number to quote:**

| | root | majmin | sevenths |
|---|---|---|---|
| audio alone | 75.3 | 76.3 | 69.7 |
| linked, exact score, Balanced (0.3) | **83.0** | **82.7** | **80.4** |
| linked, 20 % of bars wrong, 0.3 | 80.1 | 79.6 | 76.6 |
| linked, 40 % of bars wrong, 0.3 | 78.7 | 78.5 | 74.6 |
| the 20 %-wrong score copied blindly | 67.4 | 66.5 | 64.9 |
| exact score trusted fully | 84.4 | 84.2 | 82.0 |

Weights on held-out: 0.15 → 79.5 / 78.7 (exact / 20 %-wrong); 0.3 → 83.0 / 80.1; 0.6 → 84.4 / 77.5.
Same ordering as dev, smaller margins; 0.3 remains the balance. Alignment ≤ 150 ms on 88.1 % of bar
lines (median 35 ms); transposition found 42/42.

Alignment (dev, exact score, bar lines inside the excerpt): median **37 ms**, p90 177 ms, ≤ 70 ms
71 %, ≤ 150 ms **88 %** — before the fine pass / uniform grid / cost selection it was median 41 ms,
p90 592 ms, ≤ 150 ms 69 %. Most of the median is a ~35 ms systematic offset between the tracker's
beat and the notated onset in the renderer.

### A real record — Al Jarreau, "We're in This Love Together" (owner's MP3 + Guitar Pro 7 file)

`node bench/link-real.mjs --score <gp> --audio <mp3>`: 4 tracks (jazz guitar lead, nylon comping,
bass, drums — the kit now flagged and left out), 73 bars at ♩=80, 3:46 of audio.

- Link: same key, match **0.75** vs 0.58 at the best wrong key; ♩ ≈ 79 (score says 80); score bars
  1–73 ↔ 0:00–3:41 of the record (the fade is left outside); the song's modulation from B♭ to C is
  followed; 2.3 s on this container.
- Against the score's own harmony read on the link's clock (root / majmin / exact name):

| | root | majmin | exact |
|---|---|---|---|
| audio alone | 60.4 | 69.3 | 40.6 |
| linked, Recording (0.15) | 84.2 | 83.5 | 71.7 |
| linked, **Balanced (0.3)** | **91.9** | **92.0** | **89.1** — 19 chords to review |
| linked, Score (1.0) | 97.6 | 97.5 | 97.1 |

This "truth" is the score itself, so it says how close the linked chart stays to the file while the
audio still gets a vote, not that the file is right. The 19 review rows are where the record and the
file disagree; tapping 📄 score takes the file's chord.

### The real app — `node bench/link-e2e.mjs --deps <dir> --score <gp> --audio <mp3>`

Headless Chromium, 390 px: MusicXML/GP panel → upload the GP → **🎧 Link a recording →** → the Audio
panel opens with the score attached → upload the MP3 → linked in one pass (28 s for the whole flow on
this container), readout, chart on the score's bars, 📄 score rows in review, one-tap commit, Chords
follow → Score (agreement 94 → 100 %), Unlink back to the recording alone, no overflow, no console
errors — 11/11.

## What this does not do (honest limits)

- **A wrong score is only partly rescued.** With 40 % of bars wrong the linked chart (81 %) still
  beats the audio alone (78 %) and the file (≈ 55 %), but it is not the truth. The review list is where
  that gets fixed.
- **Form changes the score doesn't write** (an extra chorus, a cut verse, D.S. al coda) are not jumps
  the aligner can take — it is monotonic. `|: :|` and 1st/2nd endings are unrolled; anything else, edit
  the file or expect the unmatched part to be skipped or squeezed.
- **Very different tempo markings** (a score at 120 for a 98 record) fall back on the tracker grids;
  a ×⅔/×1.5 ratio is handled, an arbitrary one only through DTW steps.
- **Recording-side quality still matters**: drum/bass bleed costs ~5 points even with the score
  (alignment); a full mix links (the Jarreau record is one) but the review list is longer.
- Memory: beat-level DTW is beats × beats (a 6-minute song at 120 bpm ≈ 720² cells) — capped at
  6 M cells with a clear message.

## Follow-ons (not built — in order of value)

1. **Lyrics from a score with lyrics**: MusicXML lyrics are per NOTE, so a linked score gives
   syllable-level timing for free (WO-3 is line-level from audio alone).
2. ~~Guitar → Tab with a linked score~~ — **built 2026-11-07**, see below.
3. ~~Stems × score parts~~ — **built 2026-11-07**, see below.
4. **Play-along on the better aligner**: ChartPanel's 🎯 Auto-align (the older event-level DTW) can
   use `linkScoreToAudio` and get the fine pass + transposition search.
5. **Personal calibration**: every linked pair is labelled training data for the audio decoder on the
   owner's own music (thresholds, template weights) — the honest route past the audio-only ceiling.
6. **Family**: Chord Sheet Maker Pro playing the recording with the chart needs the audio to cross
   apps — too big for localStorage; the planned OPFS handoff (Wave 1 #4) is the carrier.

---

## Built 2026-11-07 — stems × score parts

*Code: `engine.tsx` block "STEMS × SCORE PARTS" (`scorePartRole`, `matchStemsToParts`,
`compareStemsToScore`), `TabDecoderPro.tsx` `StemsVsScore` in the stems panel. Bench:
`tests/bench/stemscore.mjs` (rendered parts, known differences), `tests/bench/stemscore-real.mjs`
(a real record split by the app's own separator — `tests/bench/split-file.mjs`). Guards: `tests/score-tab.mjs`.*

A split recording and a linked score both say what each instrument does. Each stem is matched to its
score part(s) — bass ↔ bass, drums ↔ drums, vocals ↔ voices, the separator's "other" stem ↔ every guitar
and keys part (by the parser's drum flag, the part's name, then its tuning) — and compared bar by bar on
the link's clock:

| stem | compared as | agreement |
|---|---|---|
| bass, vocals | pitch-class timelines (50 ms) of the stem's notes vs the part's | time both sound the same pitch class ÷ time either sounds (octave-blind) |
| guitar / keys / other | the stem's chroma vs the parts' duration-weighted chroma per bar (in the app: the stem's own chord chart, since the audio is handed to the worker while charting) | cosine |
| drums | kick / snare / cymbal hits vs the part's General-MIDI notes (Guitar Pro's own articulations above 90 mapped too), ±60 ms after a local re-alignment | mean of the three drums' F-measures; a kick heard as a snare at the right time is half credit |

A bar **differs** when it is below the floor for its kind (lines 0.5, harmony 0.7, drums 0.5) and
clearly below the stem's own typical agreement (median − 0.15), so a leaky stem that reads lower
everywhere doesn't flag every bar. The stem tabs carry the score part names.

**Measured — rendered stems with known differences** (`stemscore.mjs`, 8 songs with comp + bass + drum
parts; the score given to the comparator has 20 % of each part's bars wrong — bass +5 semitones, comp
+3, snares moved to kicks an eighth later — while the "recording" plays the original):

| stem | agreement, correct bars | agreement, wrong bars | wrong bars flagged | precision | false flags |
|---|---|---|---|---|---|
| bass | 0.88 | 0.05 | **100 %** | 90 % | 3.5 % |
| guitar/keys (stem audio) | 0.90 | 0.37 | **96.7 %** | 87.9 % | 3.4 % |
| guitar/keys (stem chord chart — the app's path) | 0.88 | 0.34 | 93.3 % | 75.7 % | 7.6 % |
| drums | 0.74 | 0.37 | 45.9 % | 45.9 % | 17.4 % |

With every stem leaking the others at −12 dB: bass 100 % / 74 %, guitar/keys 96.7 % / 65.9 %, drums
53.8 % / 51.2 % (recall / precision). **Drums are a rough guide only**: the drum transcriber alone
scores 90–100 % on these parts, but it confuses kick and snare often enough that per-bar flags are about
a coin toss — the UI says so ("listen before trusting a flag").

**A real record** (Al Jarreau, the MP3 split by the app's own SCNet — full model, 3:46 in 180 s in Node
— against the Guitar Pro file): bass stem ↔ "Electric Bass (finger)" **72 %**, 3 bars differ; guitar/keys
stem ↔ both guitar parts **86 %**, 5 bars differ; drums ↔ "Drums" 39 %; vocals: no part in the file.
There is no ground truth here — the numbers say how closely each player follows the transcription.

Bench gotcha (recorded so nobody re-derives it): the bench's renderer plays bars **as written** while
the link unrolls repeats; pass `unroll: false` to both (as `scorelink.mjs` does) or every song with
`|: :|` reads as misaligned.
