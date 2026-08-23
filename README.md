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

## Vocal harmony → standard-notation score (SATB)

The **Audio 🎵** mode can turn an isolated vocal stem into a readable, multi-staff
vocal arrangement:

1. Upload an isolated vocal stem (a single mixed vocal, or a pre-separated stem).
2. Tap **🎼 Voices (ML)** to run the pluggable note model (Spotify `basic-pitch`)
   — this transcribes the actual sung notes, not just chord names.
3. Choose a **Split** (2 / 3 / 4 voices). The engine's SATB heuristic assigns each
   note to a voice by pitch register (voice 1 = highest = lead).
4. Tap **⬇ Vocal score (MusicXML)** (or **⬇ ABC**) to download **all voices at
   once** as a single multi-staff score:
   - The **lead vocal is the top staff**, backing voices below in descending
     register (`Soprano/Lead`, `Alto`, `Tenor`, `Bass`).
   - Real standard notation — notes, rests, barlines, time signature, key
     signature, and a visible voice label above each staff.
   - `divisions=480`, one `<part>`/staff per voice, aligned barlines.
   - Opens cleanly in **MuseScore / Sibelius / Finale** (any MusicXML reader).

A sample output is committed at
[`docs/samples/vocal_score.musicxml`](docs/samples/vocal_score.musicxml)
(lead + two backing harmony voices) with an ABC companion.

**Honest limits.** Note detection quality depends on the model + stem isolation;
the voice split is register-based (rare genuine voice crossings show as swaps — fix
with ✎ Edit); and the notation grid is quantised to the integer beat grid (which
keeps the MusicXML valid — finer sub-beat quantisation is future work). See
`docs/ML-NOTES.md` and `CLAUDE.md`.
