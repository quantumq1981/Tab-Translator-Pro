# Tab-Translator-Pro
An intelligent guitar tab-to-chord translator that instantly turns fret numbers and custom tunings into precise musical harmony.
Tab Decoder Pro is a lightweight, high-precision utility that translates raw guitar tablature directly into accurate chord symbols. Powered by the TabTranslator Engine, the app uses a custom 12-bit harmonic bitmasking algorithm to analyze fret positions, capo offsets, and alternate tunings locally on your device. It bypasses heavy, resource-intensive audio processing to deliver lightning-fast, offline chord and inversion recognition with zero external dependencies.

## Live app

Hosted on GitHub Pages: **https://quantumq1981.github.io/Tab-Translator-Pro/**

It's a zero-build static page — `index.html` fetches the single-file React
component (`TabDecoderPro.tsx`) and transpiles it in the browser, with
dependencies loaded from a CDN at runtime (the same pattern the PDF mode already
uses for PDF.js). Pushes to `main` redeploy via `.github/workflows/pages.yml`.

**One-time setup:** in the repo's **Settings → Pages → Build and deployment**,
set **Source** to **GitHub Actions**. The workflow handles every deploy after
that.
