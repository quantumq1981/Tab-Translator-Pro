# Path A — headless smoke test

This directory exercises **"the one untested link"** described in
[`../CLAUDE.md`](../CLAUDE.md): the in-browser PDF.js extraction in
`extractTokens()`. It runs the full Path A pipeline — *real PDF →
tokens → string/column/measure geometry → chord recognition → one-chord-per-bar
chart* — without a browser, and asserts the documented Blue Sky validation.

The app itself (`TabDecoderPro.tsx`) stays **zero-dependency**. These dev-only
deps live here.

## How it stays faithful

- The engine + parser functions are **loaded out of `TabDecoderPro.tsx`**, not
  copied, so the test cannot drift from the shipped code.
- `extractTokens()` is reproduced with **`pdfjs-dist@3.11.174`** — the exact
  version the app loads from the CDN (`pdf.min.js` 3.11.174). PDF.js's
  `getTextContent()` item `.str` + `.transform` is the stable public text API and
  is identical between the CDN and npm builds, so the tokens here match the
  browser's.

## Run

```sh
cd tests
npm install
npm test            # asserts 165 bars, verse E|A|A|E, V (B), C#m/F#m7 bridge
npm run tokens      # dump the raw extractTokens() stream (page, x, y, val)
```

`npm run tokens` is the first thing to reach for if a real PDF yields odd bars:
dump the stream and diff it against the reference behaviour in `CLAUDE.md`
before touching parser logic.

## What this does NOT cover (still genuinely browser-only)

The extraction *algorithm and coordinate math* are now covered. The residual
browser glue this can't reach:

- loading `pdf.min.js` from the cdnjs CDN (network / connector policy) and
  setting `GlobalWorkerOptions.workerSrc`;
- the `<input type=file>` → `File.arrayBuffer()` read;
- the PDF.js **web worker** path (this harness runs on the main thread).

Smoke-test those on real hardware. Everything downstream of the token stream is
proven here against the real file.
