# Muscriptor v0.4.0 — review and integration plan (2026-10-25)

Source: `github.com/muscriptor/muscriptor`, tag `v0.4.0` (commit `8a1ef88`, 2026-10-20), read in full
(`v0.3.0..v0.4.0` = 15 commits). Paper: arXiv 2607.08168. Measurements: `tests/bench/beatthis/`.

---

## 1. What v0.4.0 actually is

| Claim to check | Finding (from the code) |
|---|---|
| "Stem splitter" | **There is none.** No separation model or code in the repo. The per-instrument outputs come from a **multi-instrument transcription model** that writes one MIDI track per instrument group (MT3-style program tokens). |
| "~10 documents per instrument in a zip" | Server-side **MuseScore 4 CLI** engraving (`utils/sheets.py`): `score.mid` + `score.musicxml` + `full_score.pdf` + one PDF per part + a `_tab.pdf` for each fretted part (MuseScore staves retyped as tablature). The server zips them (ZIP_STORED); the web UI unzips with `fflate`. |
| Transcription model | Decoder-only transformer over mel frames, **5 s chunks, ≤ 2000 tokens each, decoded strictly in order** (the "prelude forcing" of notes held across a chunk boundary needs batch size 1). small 103 M params (`model.safetensors` = **412 MB** fp32) · medium 307 M (default) · large 1.4 B. Optional hard instrument constraint (masks other programs' tokens). |
| What's new in v0.4 | (a) `--format sheets` + the sheets zip (#76/#78); (b) **quantise before engraving** — MuseScore's own MIDI quantiser is "not that great and isn't really configurable" (#93); (c) **tempo corrections + quantised MIDI export** (#114: `--bpm`, `--beats-per-bar`, `--first-downbeat`, `--beat-scale 2/0.5`, `--quantize --grid --quantize-strength`, `--fill-gaps`, `--trim-leading-bars`); (d) **a tempo map that follows the performance** (#115). (b)–(d) all depend on a learned **beat + downbeat tracker**, `beat_this`. |

## 2. The licence wall (decides most of this)

| Part | Licence | Can we ship it? |
|---|---|---|
| Muscriptor code | MIT | Yes — port algorithms with attribution. |
| **Muscriptor weights** | **CC BY-NC 4.0**, gated on HF | **No.** The owner's standing rule (set when MERT was rejected): no non-commercial licence anywhere, not even as a teacher. |
| `beat_this` code + weights (CPJKU) | **MIT** (its README: "the code and the published model weights are released under the MIT license"; some training data is not, "up to the user to assess") | **Yes.** |

Even without the licence, the transcription model would not fit the platform: a 412 MB fp32 autoregressive decoder, ≤ 2000 sequential steps per 5 s, on single-thread WASM on an iPhone (no COOP/COEP on Pages). The owner's phone tests used **muscriptor.kyutai.org** (their GPU server). That is fine for personal use. Building a feature on their service would break zero-server, and whether NC terms reach the *outputs* is a legal question this review does not answer.

**So the integration is three things: (A) the MIT beat/downbeat tracker, (B) Muscriptor's MIT post-processing algorithms, ported to `engine.tsx`, and (C) their output UX (the per-instrument zip, stereo-split playback) rebuilt client-side on what we already have.**

---

## 3. Measured: `beat_this` vs our `detectBeats` (synthetic, read the caveats)

9 GP songs rendered by the bench synths (comp + bass, ± a kick-snare-hat kit), 45 s each, truth = the GP bar lines. Mean F-measure at ±70 ms. ONNX Runtime **native, multi-threaded CPU**, 4-core container (not WASM).

| | beat F with drums | beat F no drums | downbeat F (drums / none) | meter right (drums / none) | speed | peak RSS |
|---|---|---|---|---|---|---|
| our `detectBeats` | **0.826** | 0.581 | — (no downbeats) | — | — | — |
| beat_this **small0** (10.4 MB) | 0.684 | 0.624 | 0.456 / 0.540 | 4/9 · 0/9 | 0.051× RT | 1495 MB |
| beat_this **final0** (190.6 MB) | 0.646 | **0.723** | **0.464 / 0.622** | **5/9** · 1/9 | 0.071× RT | 838 MB |

What this does and does not show:
- **No drums (an isolated guitar/keys/vocal stem — our main input): final0 +14 points over our tracker.** It fixed two tempos we read at the wrong rate (Peg, true 117: ours 78, final0 120; Black Cow, true 92: ours 146, final0 91), got two more closer, and misread one we got right (If This Is It, true 98: ours 98, final0 70).
- **With drums, our tracker wins.** On 2/9 kit mixes final0 locked **half a beat off** (Grapevine: −0.25 s on a 0.52 s beat). The synthetic kit has identical beats 1 and 3, so a downbeat reading of "beat 3" is honestly ambiguous there.
- **Downbeats are the real gain**: we have none (pure-DSP downbeats were measured as near-chance and reverted, see CLAUDE.md). final0 gives 0.46–0.62 downbeat F on out-of-distribution synthetic audio; for 4/4 with correct beats, chance is ≈ 0.25.
- **Caveat:** Karplus–Strong guitar + a synthetic kit are far outside beat_this's training data (real recordings). **Gate before shipping: real recordings with annotated beats** (GuitarSet's JAMS carry beat positions; plus a few full mixes the owner annotates). Speed on iPhone WASM is unmeasured: the musetric card says WASM is ~12× slower than WebGPU on its hardware, and our pinned ORT 1.23.2 path is single-threaded.
- Both ONNX files are third-party conversions (the official weights host is blocked here). For production, **export from the official checkpoint ourselves**, pin its SHA-256, int8-weight-quantise it like the guitar CRNN, and verify parity against torch.

---

## 4. Integration plan — Tab Translator Pro (recognise)

Ranked by value ÷ risk. Every item is additive; `npm test` stays the contract.

### P1 — Learned beats + downbeats (`beat_this`) as an opt-in second tracker
- Same rails as the guitar CRNN: `beat-model.js` → module Worker → core; Cache API + SHA-256; the **pinned ORT 1.23.2 plain WASM build** (#33426); `capWasmMemory`; nothing downloads until first use.
- Engine (pure, headless-tested): `beatThisFeatures(pcm22k)`, `beatThisWindows`, `beatThisPeaks` (minimal post-processor), plus Muscriptor's `regularized_beats`, `fit_tempo` (least-squares, not median IBI), `infer_beats_per_bar` (**write no meter unless 90 % of bars agree** — a wrong meter is worse than none).
- Consumers: `analyzeAudioChordsV2` beat grid, `audioEventsToScore` (bar 1 = first downbeat instead of t = 0), `detectSections` (boundaries snap to downbeats — fixes the documented "a beat or two off"), the vocal score, Guitar → Tab.
- **Fallback, never replacement:** if the model is missing, errors, or `infer_beats_per_bar` returns null, use today's `detectBeats`. With drums present, keep our tracker's beats and take only the **downbeat phase** from the model, until real-audio numbers say otherwise.
- Start with **small0** (10 MB) for the phone path; final0 only if the real-audio gate shows a clear gain.

### P2 — Port Muscriptor's beat-grid post-processing (pure JS, no model, MIT)
These help today with our existing tracker:
1. **`estimate_onset_delay`**: put each note onset on a circle at its position within the beat, average the unit vectors over the subdivisions 1, 2, 3, 4, 6, 8, 12, 16 and 24, and take the subdivision with the highest concentration |R|. This gives (a) the systematic lag of the transcription against the grid (correct it when |R| ≥ 0.5, ≥ 40 onsets and |lag| ≤ 40 ms) and (b) **whether the line is straight or triplet**. Use (b) to auto-pick the vocal score's 1/8 · 1/16 · triplet grid (today a manual chip) and to decide `tuplet:3` for Guitar → Tab.
2. **`regularized_beats`**: put back beats the tracker missed and drop extra ones, measured against the median spacing. It stops a single dropout from halving the tempo map.
3. **Steadiness test**: residual of the tempo fit ≤ 5 % of a beat → one tempo, else a tempo map.
4. **Tempo map** (`smoothed_beats` = Savitzky–Golay over 9 beats; `Timeline.simplified` = the fewest tempo changes that keep every beat within 25 ms, changes only on bar lines). Wire it into `scoreToMidi` (tempo metas), `scoreToMusicXML` (`<sound tempo>` per measure) and `scoreEventTimes`. Then a rubato recording's bars stay on the music instead of drifting off a fixed ♩=.
5. **Quantise with `strength`** (partial snap keeps the feel), **`fill_gaps`** (we have `legatoBeats` on the vocal path only — generalise it to every note export) and **`trim_leading_bars`**.

### P3 — Timing corrections in the Audio panel (Muscriptor's "Tempo & bars" panel)
- **×2 / ÷2 tempo** buttons (`rescaled_beats`, which keeps the bar lines' phase) — the single most common tracker error.
- **"Bar 1 starts here"** (set the first downbeat at the playhead, or nudge ±1 beat) and a beats-per-bar override.
- These fix downbeats by hand without any model. They also fix the model's half-beat lock seen above. Ship before P1.

### P4 — "⬇ All parts (zip)" — the deliverable the owner liked, built client-side
- After **✂ Split this mix into stems**, `chartsFromStems` already gives one chart per instrument. Add one button that writes a zip with, per part: `NN_<instrument>.musicxml`, `.mid`, `.alphatex` (the fretted ones), `.csmpn`, plus `full_score.musicxml` (multi-part) and `score.mid` (format 1, one named track per part, GM drums on ch.10 from `drumHitsToMidi`).
- Zip writer: ~60 lines, **STORED (no compression) + CRC32**, the same layout Muscriptor uses; no dependency (we already read zips with `DecompressionStream`). Download as one `.zip`; iOS Files opens it.
- PDFs: alphaTab can render each track. Per-part PDF files need a print path that isn't a popup (iOS-hostile, see the Tab viewer notes). Phase 2: a per-part **Print** button in the Tab view.

### P5 — Stereo-split "check by ear" playback
Original recording hard left, synthesis of the chart/tab hard right (`StereoPannerNode`; −6 dB on a stereo source, as `audio.ts` does), plus a crossfade slider. It is the fastest way to hear a wrong chord or a wrong bar line. Browser-only, about 40 lines on the existing reference-audio player.

### P6 — Import Muscriptor's own outputs (license-clean bridge) — ✅ built 2026-10-25
The owner already gets Muscriptor zips from the hosted site. Let Tab Translator **read** them: accept a `.zip` (read each entry → existing MusicXML parser, part picker = Muscriptor's instruments) and add **Standard MIDI File import** (Tab Translator has none; CSMP's `midiImport.js` is the starting point). Muscriptor's MIDI carries the tempo map, the time signature and one named track per program. Then Tab Translator re-chords, re-fingers (`fingerScore`) and hands the chart to CSMP. We parse files the user chose to produce; we don't call their service.

### Rejected — do not re-derive
- Shipping or distilling Muscriptor weights (CC BY-NC). Calling muscriptor.kyutai.org from the app (zero-server, ToS, availability).
- Porting the MuseScore engraving path (a native app; no browser build).
- Muscriptor's instrument conditioning / prelude forcing (specific to their model).

---

## 5. Other improvement areas found in the CLAUDE.md review (both repos)

Still open, by the docs' own accounts, most valuable first:
1. **Downbeats** (P1/P3 above) — the root of the "boundaries a beat off", "bars start at t = 0" and "notation is busy" limits, all three documented.
2. **Wave 1 #4**: `_reparseScore` buffers to OPFS, and the CSMP handoff to `opfs:handoff:v1` (stops MusicXML > 1.5 MB being dropped).
3. **Wave 1 #5**: Service Worker offline for Tab Translator. CSMP already has `sw.js`. Tab Translator must cache the in-browser Babel/React/PDF.js toolchain; consider a precompile-at-deploy step.
4. **Persistence gaps**: transpose (`semis`) and the Manual-tab textarea are not saved; `_reparseScore` still runs on the main thread.
5. **Audio chord charts carry no `{tab}`.** Run `fingerScore` on them, as Guitar → Tab already does, so CSMP gets real chord diagrams.
6. **Guitar → Tab P3/P4**: audio string evidence and a technique classifier. String choice is the bottleneck: Tab F1 ~58–62 against note F1 ~86.
7. **CSMP**: consolidate `midiImport.recognizeChord` onto `ChordTheory.recognizeChordFromPcs`; deep-read the notes of MusicXML piano lead sheets; scale-degree enharmonic spelling.
8. **Device checks still pending** (both repos list them): SCNet on the first-gen iPad Pro, guitar CRNN first-tap load, the Tab viewer, the voicing modal, and the CSMP ABC suite on iOS.

## 6. Suggested order

P3 (manual tempo/bar fixes, no model) → P2 (onset delay + grid choice + tempo map) → P5 (stereo check) → P4 (all-parts zip) → P1 (beat_this, behind the real-audio gate) → P6 (Muscriptor/MIDI import).
P2–P5 touch only MIT-ported algorithms and our own code, and each one is useful alone.

## 7. Update 2026-10-25 — P6 built against the owner's real Muscriptor file

`Saddle_Up_MSTFix_sheets.zip` (Muscriptor v0.4): 5 parts, no chord symbols, MIDI with no meter or key.
Both apps now open the zip (and its `.mid`) on a **Harmony** reading — every pitched part except voice
and drums, from the notes' real lengths — named with the Pro vocabulary and spelled for the key:
F minor, `Fm9 | Bbm9 | Fm7 | Bbm7 | Eb/F | Bbm7 | Db | Bb7/Ab | …` (was `C#maj7` piano-only / `C7b9/Bb`
whole-bar). Chord Sheet Maker Pro gets it through its vendored copy of this engine. Details: CLAUDE.md
"Muscriptor zip + MIDI import, Harmony reading, key spelling".

## 8. Update 2026-10-25 — P1–P5 built

All five remaining items shipped the same day; details and measurements in CLAUDE.md
"Beat grid, tempo map, learned downbeats, check by ear, All parts".

| Item | What shipped | Measured |
|---|---|---|
| P2 | Muscriptor's beat-grid post-processing in `engine.tsx` (`audioBeatTimeline` + helpers); every audio chart on one timeline; tempo map in playback, MIDI, MusicXML, ABC, AlphaTex, CSMPN | = Muscriptor's Python to float noise (14 cases); GuitarSet beat F 38.9 → 41.9 (fixed ♩= → timeline) |
| P3 | Tempo & bars panel (follow / fixed, ±, ÷2 ×2, meter, bar line nudges, Bar 1 here) in the audio and stems panels | ×2/÷2 recovers up to 58.3 beat F |
| P1 | beat_this final0, exported from the official checkpoint (`scripts/beatthis_export.py`), int8 22.5 MB, on the pinned ORT 1.23.2 rails; on demand | **Real-audio gate passed** on GuitarSet held-out solos: beat F 46.9 → 75.6, downbeat F 54.1; padding short pieces as trained: +6.3 beat F |
| P5 | 🎧 Check by ear: recording left / chart right, or a balance mix, on the recording's clock | browser-verified |
| P4 | ⬇ All parts (zip) + → Chord Sheet Maker Pro (all parts) via an optional `parts[]` in `csm:handoff:v1` | browser-verified across both apps |

Remaining: device checks (beat_this speed and memory on iPhone/iPad); beat_this on full mixes with drums
is only measured synthetically; the canonical `chord-sheet-maker/docs/HANDOFF-CONTRACT.md` needs the
`parts[]` note (documented here and in Chord Sheet Maker Pro).
