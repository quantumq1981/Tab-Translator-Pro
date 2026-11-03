
Executive summary of TTP and work order roadmap

Tab Translator Pro already has the strongest recognition core in this comparison: exact Guitar Pro / Power Tab / MusicXML parsing, a derived chord vocabulary, beat_this downbeats, tempo maps, guitar CRNN string assignment, SATB voice-leading, CSMPN/CSML handoff, and a genuinely local/private architecture. What it lacks is the workbench and learning layer that the leading consumer apps compete on: note-level correction, practice loops, lyrics timing, instrument-wide voicings, drum/piano notation, a project library, and print/share. Those are the gaps worth closing — not another recognition model.

The recommendation is seven work orders, ordered by user-visible leverage:

1. WO-1 — Note-level correction editor (piano roll + tab grid + spectrogram)
2. WO-2 — Practice & real-time coach (loop/speed/pitch/metronome, live chord detection, mic practice)
3. WO-3 — Lyric alignment & chord-over-lyrics performance sheet
4. WO-4 — Instrument coverage (piano/ukulele/mandolin voicings, arrangement levels)
5. WO-5 — Drum & piano notation; complete all-parts deliverables
6. WO-6 — Project library, setlists, print/PDF, share
7. WO-7 — Audio technique detection + automatic tuning/capo detection

All are additive to engine.tsx and can be made opt-in so the validated corpus stays byte-identical.

---

Competitive snapshot

Capability Who does it well today Tab Translator Pro today Gap
Note-level score/tab editing Klangio (browser notation editor, edit notes/rhythm/tempo/key before export); Songscription (editor + “Annie” AI edit assistant); Soundslice (full notation/tab editor); AnthemScore (spectrogram note add/remove, velocity) Chord-symbol edit (overrides), chord review, tempo/bar/meter corrections; no note editing High
Practice loop / slow-down / pitch / metronome Soundslice (slow without pitch, drag-to-loop, click-to-seek); Capo (slow, loop, restart from any note); Moises (speed, pitch, smart metronome, count-in); Chordify (slow, loop) Score synth playback, reference-audio sync, check-by-ear; no loop/speed/pitch/metronome on the recording High
Real-time mic chord detection Chord AI (mic/streaming, real-time chords); Chordify Premium Plus live chord detection + chord trainer LiveTuner is monophonic pitch only; no polyphonic live chords Medium
Lyric timing / karaoke / chord-over-lyrics Chord AI (lyrics recognition + karaoke-like alignment); Moises (AI lyric transcription, synced); Song Master (synced lyrics, external karaoke window); Chordify Chords & Lyrics view Lyrics import strips chords; live ASR capture; Perform Lyrics handoff; no timestamps, no chord-over-lyrics High
Piano / ukulele / mandolin diagrams Chordify (guitar, piano, ukulele, mandolin); Chord AI (guitar + ukulele chord-position library) Guitar voicings only (10k shapes, standard tuning) Medium
Drum notation Klangio (drum parts to notation); Songscription (drum transcription) NMF drum pattern + GM MIDI; no drum notation/tab Medium
Piano transcription / grand staff Klangio (piano part, instrument-specific notation); Songscription (piano + automatic piano fingering) basic-pitch voices; no piano hand split/grand-staff export High
Simultaneous multi-instrument transcription Klangio Studio (piano, guitar, bass, drums, vocals, strings, winds, synth in one pass); Songscription “multiple instruments” 4-stem SCNet (vocals/drums/bass/other) + per-stem charts; no guitar/keys split Medium
Song library / catalog / setlists Chordify (36M catalog, personal library); Moises (collaborative setlists) Single-session restore via OPFS + ttp:session:v1; no library/search/setlists Medium
PDF / print Chordify PDF printout; Klangio PDF export; Songscription PDF File exports (MusicXML, MIDI, ABC, AlphaTex, CSMPN/CSML); no print view; alphaTab print() is iOS-hostile Medium
Audio technique detection Capo (spectrogram shows bends, slides, vibrato); Guitar2Tabs (distorted electric guitar, playable tab) Techniques captured from GP bytes only; audio tabs carry no tech Medium
Automatic tuning / capo detection Song Master (analyzes tuning); Capo (chord boxes, capo) Manual tuning/capo select + score-based suggestion; no audio tuning detection Low–Medium
URL import (YouTube/TikTok/Instagram) Songscription, Klangio, Chordify Deliberately none (ToS/DRM, zero-server) Non-goal
Photo/PDF score scanning (OMR) Klangio Scan2Notes, Songscription Path B explicitly out of scope Non-goal
DAW plugin / API Klangio VST3/AU + API Web-only Non-goal

Where TTP is already ahead of the field: exact GP3/4/5, GPX, GP7/8, PTB and MusicXML parsing; CSMPN/CSML native handoff; chord-vocabulary controls (Pro/Basic/Full/Lite); beat_this downbeats and tempo maps; SATB voice-leading with choral engraving; guitar CRNN with string assignment; and fully local/private processing. None of the audio-first competitors match the file-format fidelity.

---

Work orders

WO-1 — Note-level correction editor (piano roll + tab + spectrogram)

Priority: P0 · Effort: L (6–8 weeks) · Owner: engine + UI

Why. This is the single biggest trust gap. Audio and ML tabs are good but not perfect — measured note F1 ~86%, Tab F1 ~58–62% on GuitarSet, with solos worst because string choice is the bottleneck. Today the user can fix a chord symbol but cannot fix a wrong note, a wrong string, a bad duration, or a merged strum. Klangio, Songscription, Soundslice and AnthemScore all treat correction as a first-class feature; Songscription even exposes an AI edit assistant.

Scope.

· Engine (pure, engine.tsx):
  · Introduce a serializable ScoreEdit layer rather than mutating parsed scores:
    ```ts
    type EditOp =
      | { t:"note.add"; bar; voice; onsetTicks; durTicks; midi; string?; fret? }
      | { t:"note.remove"; id }
      | { t:"note.move"; id; midi?; onsetTicks? }
      | { t:"note.dur"; id; durTicks }
      | { t:"note.string"; id; engIdx; fret }
      | { t:"note.tech"; id; tech; bends? }
      | { t:"symbol.lock"; bar; beat; symbol }   // keep chord label when notes change
    ```
  · applyScoreEdits(score, edit): Score — non-mutating, idempotent, stable note IDs. It must run after parseScore/polyNotesToScore/fingerScore and before respellScore, simplifyScore, arrangeScore, and every exporter.
  · Stable note identity: add event.notes[] with { id, midi, string?, fret?, tech?, bend? } when a score enters the editor; keep event.midis/frets as the compatibility projection so existing exporters are untouched.
  · Re-recognition rule: when notes change, re-run recognise from the edited midis unless symbol.locked is set. This preserves the “engine is the oracle” contract.
  · scoreToBeatGrid(score) / beatGridToScore(grid) for the editor’s 16th-grid model; reuse _voiceNotationMeasures and _noteValuesFromTicks for duration spelling.
· UI (TabDecoderPro.tsx):
  · New NoteEditorView (view === "edit"), three synchronized panes:
    1. Piano roll (SVG): x = time, y = pitch, note rectangles draggable; velocity lane optional.
    2. Tab grid (6 lines, fret numbers): string reassignment by vertical drag; fret edit on tap.
    3. Spectrogram underlay (optional): _fft frames rendered as a canvas behind the piano roll, with the current note highlighted — AnthemScore-style evidence for manual correction.
  · Tools: select, draw, erase, drag pitch/time, snap 1/8 · 1/16 · triplet, duration palette, tie/split, “auto-finger this chord” (fingerScore), technique tag, velocity.
  · Undo/redo command stack; edits are small and serializable.
· Persistence: store ScoreEdit in the project record (ttp:project:v1 or extended ttp:session:v1), re-apply after re-parse. Do not store only the derived score.
· Guardrails: the parsed source is never mutated; full vocabulary and validated corpus tests stay byte-identical when no edit is present; transposeScore still drops position-specific frets (edits that carry frets must be invalidated or re-fingered on transpose).

Acceptance.

· npm test: apply/undo/no-mutation; edited pitch/onset survives scoreToAlphaTex → alphaTab parse → re-import; chord symbol re-recognized after a note change unless locked; a score with edit = null is byte-identical to today.
· E2E (headless Chromium): open a GuitarSet solo tab, move 5 wrong notes to the correct string/fret, export AlphaTex, re-import, assert 100% of edited pitches; reload the page and confirm edits restore from OPFS.
· Bench: measure edit-to-export latency < 150 ms for a 400-event score.

Risk. The editor is the largest UI build. Ship it first for audio/ML tabs (where correction matters most), then enable it for GP/XML charts once the note-ID layer is stable.

---

WO-2 — Practice & real-time coach

Priority: P0 · Effort: M (3–4 weeks) · Owner: engine DSP + UI

Why. TTP has playback and check-by-ear, but no woodshed loop. Soundslice, Capo, Moises and Chordify all own the “slow it down, loop two bars, play along” workflow. Chord AI and Chordify also offer real-time mic chord detection and a chord trainer. This is the highest-retention feature TTP can add without touching recognition.

Scope.

· Engine (pure):
  · timeStretch(pcm, sr, rate, {pitchSemitones}) — WSOLA in the engine worker (or a phase vocoder if quality demands). Rate 0.5–1.25, pitch preservation within ±5 cents; optional pitch shift via resample + WSOLA.
  · loopRegion(beats, {startBar, endBar, meter}) → snapped loop points; countIn(beats, bars) → pre-roll click samples.
  · clickTrack(beats, {meter, bpm, accentDownbeat}) → mono PCM / WAV.
  · practiceCompare(expected, micFrames) → { hits, misses, extras, timingOffsets, score }. For monophonic parts use detectPitch; for chords compare pcmToChroma against expected chord tones.
  · LiveChordTracker: push(frame, t) → { symbol, confidence, alternatives, stableFor }, with median smoothing over 3–5 frames, hysteresis (change only when the new chord wins two consecutive frames and confidence exceeds the old by 0.05), min hold 0.4 s, and resolveChordVocabulary("chart").
· UI:
  · PracticePlayer: loop region drag on the waveform or bar ruler, speed 50–125%, pitch ±6 semitones, metronome toggle, count-in 1–2 bars, A/B loop, “wait for me” mode (pause at each note until the mic hears the correct pitch).
  · LiveChords mode: big current chord, next-chord preview, confidence bar, 8-bar history, capo/transpose, optional chord trainer (show target chord → listen → score).
  · Wire the mic path through the existing LiveTuner permission/cleanup pattern; keep the engine pure.
· Persistence: loop region, speed, practice mode per project.
· Guardrails: the practice player must not alter the score; playScore remains the authoritative synth; scoreEventTimes remains the timing authority.

Acceptance.

· WSOLA: a 1 s 440 Hz tone at 0.6× yields a 1.667 s buffer with the spectral peak within ±5 cents; a stereo music loop at 0.5× has no audible pitch shift (spot-check).
· Loop scheduling: a 2-bar loop at 100 bpm repeats within ±10 ms of the beat grid; count-in is exactly one bar.
· Live tracker: 16 bars of C–G–Am–F at 100–140 bpm → 16/16 labels, ≤ 1 spurious change, latency ≤ 300 ms; noise → no chord.
· practiceCompare: synthetic C-major scale with 10% wrong notes → correct hit/miss counts; mic e2e with a fake device as in the LiveTuner e2e.

Risk. iOS Safari AudioWorklet + mic contention (LiveTuner already handles the “release the meter stream” case). If time-stretch quality is insufficient, fall back to <audio> playbackRate + preservesPitch for the original file and document the stem limitation.

---

WO-3 — Lyric alignment & chord-over-lyrics performance sheet

Priority: P0 · Effort: M–L (3 weeks) · Owner: engine alignment + UI

Why. TTP already parses and strips lyrics, and captures them with ASR. But the output is a lyrics-only sheet, not a timed performance sheet. Chord AI does karaoke-like alignment, Moises transcribes and syncs lyrics, Song Master has a karaoke window, and Chordify now has a Chords & Lyrics view. This is also the natural bridge to CSMP’s Perform Lyrics stage.

Scope.

· Engine (pure):
  · alignLyrics(parsedLyrics, score, vocalEvidence):
    · Segment the vocal stem into voiced phrases with RMS energy + spectral flux (reuse pcmToChroma framing or detectPitch clarity).
    · Estimate syllables per line with a language-aware heuristic (Intl.Segmenter + vowel-group counting); fall back to word count.
    · Align lines to voiced phrases with a constrained DTW or a proportional-duration model, then snap line starts to the nearest beat/downbeat from the beat grid.
    · Output LyricMap = { lines:[{ text, section, startSec, endSec, startBar, startBeat, endBar, endBeat, confidence }] }.
  · lyricsToLRC(map); scoreToChordProWithLyrics(score, map) (chords above lyric lines); scoreToLyricsSheet(score, map).
  · If no vocal stem exists, align to the chart’s section boundaries + bar grid with lower confidence and expose “manual nudge.”
· UI:
  · LyricsSheetView in ChartPanel: chords above lyric lines, current line highlighted during playback, tap a line to seek, drag a line boundary to adjust, “Auto-align” button.
  · Export: LRC, ChordPro with inline chords, TXT, and print (WO-6).
  · Extend the csm:lyrics:v1 envelope with optional timing so CSMP’s Perform Lyrics can auto-scroll.
· Validation: synthetic vocal with known phrase boundaries → median line-start error ≤ 0.5 s / ≤ 1 beat; real stems manual spot-check; LRC parses in a standard player; ChordPro round-trips through parseLyrics.

Risk. Sung syllables are not cleanly separated; line-level alignment is the honest ceiling. Do not promise word-level karaoke. Expose confidence and manual nudge.

---

WO-4 — Instrument coverage: piano/ukulele/mandolin voicings + arrangement levels

Priority: P1 · Effort: M (3 weeks) · Owner: engine + data + UI

Why. Chordify shows guitar, piano, ukulele and mandolin diagrams; Chord AI ships a guitar/ukulele chord-position library. TTP’s voicing modal is guitar-only. Songscription also offers piano covers in five levels and automatic piano fingering — an “arrangement level” feature TTP can approximate deterministically.

Scope.

· Engine:
  · INSTRUMENTS descriptor: guitar 6 (EADGBE), bass 4/5, ukulele 4 (GCEA), mandolin 4 (GDAE), piano (keyboard).
  · voicingsForInstrument(symbol, instrument, { capo, tuning, maxFret, handSpan }) — reuse parseChordSymbolForVoicings, voicingFormula, enumerateChordGrips; add per-instrument string count/tuning.
  · pianoVoicings(formula, { handSpan:9, previousVoicing }) — root position, inversions, open voicings, shells; rank by voice-leading distance to the previous chord.
  · arrangementLevels(score, "beginner" | "intermediate" | "advanced"):
    · beginner: triads only, root position, no extensions, quarters-only rhythm, transpose to an easy key.
    · intermediate: 7ths, shell voicings, inversions, straight eighths.
    · advanced: full Pro vocabulary, slash chords, extensions, the current arrangeScore templates.
    · Reuse respellScore, simplifyScore, arrangeScore, fingerScore; never mutate the source.
  · scoreToPianoMusicXML(score, { hands }) for grand staff (see WO-5).
· UI: instrument picker in ChordVoicingModal (Guitar · Piano · Ukulele · Mandolin · Bass), left-handed toggle, capo selector, “next chord” animation, keyboard view. Arrangement level chips in ChartPanel.
· Validation: every QUALITIES suffix has ≥ 6 playable shapes per instrument; piano voicings within a 9th; diagrams sound correct via playScore; arrangement levels are idempotent and export.

Risk. Piano voicing “taste” is subjective; rank by voice-leading and expose alternatives rather than claiming one correct fingering. Ukulele/mandolin grips are small enough to enumerate exhaustively.

---

WO-5 — Drum & piano notation; complete all-parts deliverables

Priority: P1 · Effort: L (4–5 weeks) · Owner: engine + UI

Why. Klangio and Songscription both output drum and piano parts; Klangio specifically advertises instrument-specific notation including drums and piano. TTP’s chartsFromStems already produces a drum pattern and GM MIDI, but no drum notation, and its all-parts zip has no drum staff or piano grand staff.

Scope.

· Drums:
  · Expand transcribeDrums templates: kick, snare, closed hat, open hat, ride, crash, high/mid/low tom, rim, clap. Semi-adaptive NMF with 10–12 templates; velocity from component energy; ghost notes below 0.4 local peak dropped (existing rule).
  · drumHitsToMusicXML(hits, { meter, bpm }) — percussion clef, <unpitched>, GM instrument mapping, two voices (hands/feet).
  · drumHitsToAsciiTab(hits) — 16th grid with HH / SD / BD / T1 / T2 / T3 / CR / RD rows.
  · Optional AlphaTex percussion if alphaTab 1.8 supports it; otherwise MusicXML + MIDI + text tab.
· Piano:
  · pianoScoreFromNotes(notes) — split hands by an adaptive hinge pitch (k-means or median with a C4 prior), assign voices, preserve note lengths.
  · Use the existing TTP_NOTE_MODEL (basic-pitch) on the piano/“other” stem; if the “other” stem contains guitar + keys, offer “import a piano stem” and note the limitation.
  · scoreToPianoMusicXML — treble + bass staves, one <part> with two staves or two parts with a bracket; reuse _voiceNotationMeasures for rhythm.
· All-parts zip: add drums.musicxml, drums.txt, drums.mid, piano.musicxml, and a full_score.musicxml that includes them.
· R&D spike (separate, time-boxed): evaluate a 6-stem split (guitar vs keys) behind a flag. Do a license audit first; do not ship NC weights. If it passes, the piano path becomes much cleaner.

Acceptance. Rendered-kit drum F1 per class ≥ 0.85; MusicXML opens in MuseScore/music21 with zero errors; drum tab matches the MIDI; piano score has two staves and correct pitches; all-parts zip re-imports through parseScoreZip.

Risk. Drum transcription from a real mix is harder than from a rendered kit — report synthetic and real numbers separately, as the existing benches do.

---

WO-6 — Project library, setlists, print/PDF, share

Priority: P1 · Effort: M (3 weeks) · Owner: UI + persistence

Why. Today the app restores exactly one session. Chordify has a personal library and 36M-song catalog; Moises has collaborative setlists; Song Master has playlists; Chordify and Klangio both ship PDF printouts. A local library is the zero-server substitute for a catalog and a major retention feature.

Scope.

· Persistence: IndexedDB ttp:projects with { id, title, artist, createdAt, updatedAt, sourceKind, duration, key, bpm, tags, thumbnail }; audio bytes in OPFS keyed by project id. Migrate ttp:session:v1 into a project record (one-shot).
· UI: Home/recent screen with search, tags, sort, duplicate, delete, “Open project,” “New from file.” Setlist view with ordered project IDs and per-item transpose/capo; “Play set” advances to the next chart.
· Project bundle: exportProjectBundle(project) → zip (manifest JSON, score.json or source bytes, edits.json, audio bytes); importProjectBundle. Reuse zipStore/crc32.
· Print/PDF: PrintView with @media print CSS for Chart, Grid, Tab (alphaTab SVG), and Lyrics; A4/Letter, margins, page numbers, chord diagrams, page breaks at section boundaries. Use window.print() first (iOS “Save as PDF” / share sheet); add pdf-lib only if true PDF bytes are required.
· Share: navigator.share({ files }) for .musicxml, .mid, .alphatex, .pdf, .csmpn; fall back to download.

Acceptance. 200 projects searchable < 100 ms; bundle round-trips audio + edits; print e2e via headless Chromium page.pdf() asserts page count, header, and no clipped tab; setlist transpose persists.

Risk. OPFS quota and eviction; feature-detect as the existing session code does. iOS share-sheet behavior is device-only — smoke-test on hardware.

---

WO-7 — Audio technique detection + automatic tuning/capo detection

Priority: P2 · Effort: M–L (3 weeks) · Owner: engine DSP + UI

Why. Capo shows bends, slides and vibrato in the spectrogram; Guitar2Tabs markets distorted-electric-guitar transcription; Song Master analyzes tuning. TTP captures techniques only from GP bytes, and its tuning/capo detection is a score-based suggestion, not audio-based. This directly improves Tab F1, which is bottlenecked by string choice.

Scope.

· Techniques (pure):
  · pitchTrack(pcm, sr, { hop }) → per-frame f0 + clarity (YIN).
  · detectNoteTechniques(note, pitchTrack, spectralFrames):
    · bend: |Δf| ≥ 1 semitone, monotonic over ≥ 50 ms; store bends in quarter-tones.
    · vibrato: detrended f0 zero-crossings at 4–8 Hz, depth > 20 cents, duration > 150 ms.
    · slide: glide ≥ 2 semitones into/out of the note over 60–200 ms.
    · hammer/pull: legato transition with no spectral-flux onset peak, gap < 80 ms, interval ≤ 7 semitones.
    · palm mute: low spectral centroid + fast decay.
    · harmonic: missing fundamental / octave ambiguity.
    · ghost/dead: low energy, short, noisy.
  · Attach tech/bends to transcribeGuitar notes and polyNotesToScore; transposeScore already drops them.
· Tuning/capo:
  · detectTuningAndCapo(score, pcm) — for each GUITAR_TUNINGS × capo 0–7, score fingerSequence cost + open-string chroma evidence; return ranked candidates with confidence.
  · Auto-apply only when the margin over standard is large; otherwise show “Detected: Drop D (82%) — Apply.”
· UI: technique badges in the tab/editor; tuning suggestion line with Apply/Undo; include techniques in AlphaTex.
· Validation: synthetic bends/slides/vibrato at known rates; GP corpus rendered in Drop D/DADGAD/open G → detector picks the correct tuning ≥ 80% with no false positives on standard; owner spot-check on real recordings.

Risk. Technique detection from polyphonic audio is genuinely hard; scope it to the guitar CRNN’s monophonic note stream first, not arbitrary mixes. Report precision/recall separately.

---

Quick wins (≤ 1 week each, ship alongside the work orders)

· Expose MIDI import in the UI. parseMidiFile already exists; add .mid to the file picker and route to the MIDI panel. Songscription imports MIDI/MusicXML; this closes a small but visible gap.
· Left-handed chord diagrams. One transform flag in the SVG renderer.
· Nashville Number System toggle. Reuse romanFor and scale-degree mapping; useful for session players.
· Fix the 390 px mode-tab overflow. Documented in CLAUDE.md; a CSS wrap/scroll fix.
· Print stylesheet for the existing chart. A subset of WO-6 that can ship first.
· “Lock chord symbol” in Edit mode. Prevents re-recognition from overwriting a user’s chosen symbol when notes change.
· Export click-track WAV from the beat grid (subset of WO-2).
· Copy chart as image (SVG → canvas → PNG) for sharing in chat.
· Auto-save project metadata on every edit (extends the existing session rails).

---

Deliberate non-goals (do not build)

1. YouTube/Spotify/SoundCloud URL ripping. Songscription, Klangio and Chordify offer it, but it conflicts with the zero-server, ToS-respecting design. Keep the existing stance; instead support iOS share-sheet file import and “record tab audio” on desktop.
2. Cloud transcription / accounts / subscription catalog. The value proposition is local and private; a 36M-song catalog requires licensing and a server.
3. NC-licensed models (MERT, Muscriptor weights). The owner will monetize; keep the existing rule.
4. Photo/PDF OMR (Path B). Klangio Scan2Notes and Songscription accept photos/PDFs, but OMR is a separate pipeline and must not be bolted onto Path A.
5. Real-time stem separation during playback. The SCNet working set is already the phone-memory peak; streaming separation would make it worse.
6. DAW plugin / hosted API. Klangio ships a VST3/AU plugin; that is a different product surface. MIDI/file export covers the DAW workflow.

---

Suggested sequence

Release train 1 (trust + retention):

· WO-1 note editor (audio/ML tabs first)
· WO-2 practice player (2a: loop/speed/metronome; 2b: live chords + mic practice)
· WO-3 lyric alignment

Release train 2 (breadth + workflow):

· WO-4 voicings + arrangement levels
· WO-6 library/setlists/print
· WO-5 drums + piano
· WO-7 techniques + tuning/capo

Every work order should keep npm test green and the validated corpus byte-identical when the feature is off. The engine stays the oracle; the new features are a workbench around it. That is the gap the consumer apps have exploited, and it is the gap TTP can close without weakening the recognition core it already owns.