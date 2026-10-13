# Tab-Translator-Pro
An intelligent guitar tab-to-chord translator that instantly turns fret numbers and custom tunings into precise musical harmony.
Tab Decoder Pro is a lightweight, high-precision utility that translates raw guitar tablature directly into accurate chord symbols. Powered by the TabTranslator Engine, the app uses a custom 12-bit harmonic bitmasking algorithm to analyze fret positions, capo offsets, and alternate tunings locally on your device. It bypasses heavy, resource-intensive audio processing to deliver lightning-fast, offline chord and inversion recognition with zero external dependencies.

## Live app

Hosted on GitHub Pages: **https://quantumq1981.github.io/Tab-Translator-Pro/**

It's a zero-build static page — `index.html` fetches the single-file React
component (`TabDecoderPro.tsx`) and transpiles it in the browser, with
dependencies loaded from a CDN at runtime (the same pattern the PDF mode already
uses for PDF.js). Pushes to `main` redeploy via `.github/workflows/pages.yml`.

The workflow enables Pages itself (`configure-pages` with `enablement: true`),
so no manual Settings toggle is required. If your org/repo policy blocks that,
set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**
once and re-run the workflow.

## Vocal harmony → rehearsal-ready vocal score

The **Audio 🎵** mode turns an isolated vocal stem into a readable choral score —
one staff per sung part — plus rehearsal MIDI:

1. Upload an isolated vocal stem (a single mixed vocal, or a pre-separated stem).
   Set the song's real **♩=** and, optionally, run **🔎 Detect sections**.
2. Tap **🎼 Voices (ML)** to run the note model (Spotify `basic-pitch`) — the actual
   sung notes, not chord names. **Sensitivity** (Lead / Balanced / Full harmony)
   re-thresholds instantly if quiet backing voices are under-detected.
3. **Split** is pre-set to the number of parts the stem actually sings. Notes are
   assigned to parts by **voice leading** (each singer's line stays continuous;
   a melody sung alone stays on one staff), not just by register.
4. In the **📄 Vocal score** panel choose how parts are named — **Range**
   (Soprano / Alto / Tenor / Baritone / Bass from each line's tessitura), **Lead +
   harmonies** (lead on the top staff), or **Voice 1–N** — the **Key** (auto-detected
   from the notes, overridable) and **Rhythm** (1/8 readable · 1/16 detailed, Legato).
   A range check flags notes outside each part's comfortable range.
5. Download:
   - **⬇ Vocal score (MusicXML)** — a bracketed choir system (barlines broken between
     staves), part names + abbreviations, tenor in treble-8vb / low parts in bass clef,
     key-aware spelling with proper accidentals, beat-aware note values and ties,
     sections as boxed rehearsal marks with double bars, 4 bars per system, final
     barline, a Choir-Aahs playback instrument per part. Opens in **MuseScore /
     Sibelius / Finale / Dorico**; extract individual parts there.
   - **⬇ ABC** / **⧉ Copy ABC** — the same score as multi-voice ABC notation 2.1 (UTF-8,
     `%abc-2.1` header, pitches written against the key signature). iPhone/iPad/Mac treat
     a `.abc` file as the unrelated *Alembic* 3D format, so on Apple devices it saves as
     `.abc.txt` (the ABC standard's own `.txt` fallback); a toggle switches to `.abc`.
   - **⬇ Rehearsal MIDI** — one named track per part; **⬇ Learning track** — every part
     audible with the selected part loud and centred.

Samples: [`docs/samples/vocal_score.musicxml`](docs/samples/vocal_score.musicxml)
(lead + two harmonies, verse → chorus) and, generated end-to-end from a real 3-part
isolated-vocal recording ("25 or 6 to 4"),
[`docs/samples/25or6to4-vocal.musicxml`](docs/samples/25or6to4-vocal.musicxml)
(+ `.abc`, `-rehearsal.mid`).

**Honest limits.** Note detection quality depends on the model + stem isolation;
voices can't cross inside a chord and a part singing alone far outside its usual
register can land on a neighbouring staff (fix with ✎ Edit); no lyrics; no downbeat
detection on vocals — set ♩= / meter and sections. See `docs/ML-NOTES.md`
and `CLAUDE.md`.
