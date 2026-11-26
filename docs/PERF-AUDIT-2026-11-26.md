# Load-performance audit — 2026-11-26

Scope: what the browser downloads, parses and runs **before the app is usable** on the deployed GitHub
Pages site (the `pages.yml` assembly + `scripts/build_app.mjs` output, not the repo served as-is).
Everything that loads only when a button is pressed (ML models, ONNX Runtime, alphaTab, svguitar,
`data/chords.json`) was checked too and is listed separately: it does not affect first load.

---

## Result

Measured with `tests/bench/load-e2e.mjs`: the site assembled exactly as `pages.yml` does, served
**gzip-compressed** (as GitHub Pages serves it), headless Chromium at 390 × 844, CPU throttled 4×,
third-party hosts blocked (web fonts are cosmetic and excluded from both runs), cache off. Median of runs.

| profile | metric | before (`7b42e41`) | after | change |
|---|---|---|---|---|
| 4G-ish: 170 ms RTT, 9 Mbit/s (5 runs) | first paint (splash) | 520 ms | **252 ms** | −52 % |
| | app ready (mode tabs on screen) | 1,666 ms | **1,144 ms** | −31 % |
| | bytes transferred at boot | 629 KB | **349 KB** | −44 % |
| | requests at boot | 15 | 14 | −1 |
| slow 3G: 400 ms RTT, 1.6 Mbit/s (3 runs) | first paint | 1,216 ms | **496 ms** | −59 % |
| | app ready | 4,880 ms | **2,871 ms** | −41 % |
| | PDF.js downloaded at boot | yes | **no** | |

Re-run: `cd tests && node bench/load-e2e.mjs` (this checkout) or
`node bench/load-e2e.mjs <worktree of another commit> <label>` (link `tests/node_modules` into it first);
`LAT=<ms> DOWN=<bit/s>` set the network profile.

---

## Findings, ranked by impact on initial load

| # | finding | cost at boot (gzipped unless noted) | status |
|---|---|---|---|
| 1 | Deployed JS keeps every source comment and line break | engine.js 303 KB + app.js 151 KB; ~480 KB of raw text parsed for nothing | **fixed (1)** |
| 2 | Serial discovery of the four app modules | 2 extra round trips before the largest file (engine.js) starts | **fixed (2)** |
| 3 | PDF.js imported on every launch, used only by PDF Chart / Scan | 114 KB + parsing 398 KB | **fixed (3)** |
| 4 | React loaded as parser-blocking `<script>` in `<head>`; splash CSS after it; 7 model-glue modules in the boot module's execution queue | first paint waits for 143 KB of React; the boot module waits for 7 extra modules | **fixed (4)** |
| 5 | Web fonts requested by an `@import` inside React-rendered CSS | font CSS + font files discovered only after ~1.4 MB of JS ran → late font swap / layout shift; one unused weight (IBM Plex Mono 500) | **fixed (5)** |
| 6 | No code splitting: app.js holds every mode (Scan, Audio, Library, Lyrics …), engine.js every parser | most of the 280 KB the app still downloads isn't needed by the Manual tab it opens on | open — the next lever, needs a refactor (below) |
| 7 | No Service Worker: every visit revalidates everything (Pages sends `max-age=600`) | repeat visits on a slow link pay the round trips again | open (Roadmap Wave 1 #5) |
| 8 | `build/session-store.js` ships with its comments | 13 KB raw / 4.5 KB | open — trivial, not worth a separate code path |
| 9 | `engine.tsx` and `TabDecoderPro.tsx` are copied to `_site` but the deployed page never loads them | deploy size only (1.4 MB), no load cost | open — kept so the repo-served dev path and the deployed path stay identical |
| 10 | Unused CSS | the app has ~40 lines of global CSS; every rule is used except the `pulse` keyframe (1 rule) | negligible — no change |

Checked and **not** a first-load problem (all are loaded on demand, and already lazy):
ONNX Runtime WASM 11.9 MB, the ML models (4.9–25 MB each), alphaTab 1.1 MB + sound font, svguitar
337 KB (unminified UMD — a candidate for minification when the voicing modal is next touched),
`data/chords.json` 1.2 MB (already minified JSON; 126 KB gzipped), basic-pitch / TF.js from esm.sh.
The worker that runs parsers off-thread imports the same `build/engine.js` URL, so it reuses the HTTP
cache; it only starts on the first off-thread call.

---

## The five changes

### 1. Deploy build without comments or layout whitespace — `scripts/build_app.mjs`

**What:** the deploy-time Babel transform now runs with `compact: true, comments: false` (a licence
comment — `/*! …`, `@license`, `@preserve` — would be kept). Same presets, same plugins; identifiers
are not renamed, so stack traces and the worker RPC (which calls engine exports **by name**) are
unchanged.

**Why:** the sources are documentation-heavy by design (≈ 40 % of `engine.tsx` is comments), and the
deploy shipped them verbatim. Every launch downloaded them and every launch made the JS engine
tokenize them.

| file | before raw / gz | after raw / gz |
|---|---|---|
| build/engine.js | 814 KB / 303 KB | 532 KB / **175 KB** |
| build/app.js | 566 KB / 151 KB | 357 KB / **104 KB** |

**Not done, deliberately:** identifier mangling (terser/esbuild). It would save more, but it is a new
build dependency and the app has code paths that rely on names (RPC by export name); comments and
whitespace are removable with zero semantic risk using the Babel already pinned in `tests/`.

### 2. `modulepreload` for the app's modules — `scripts/build_app.mjs`

**What:** when the build stamps `index.html`, it now inserts
`<link rel="modulepreload" href="./build/{engine,app,session-store,react-shim}.js?v=<stamp>">` right
after the stamp. The URLs are the exact stamped ones the page imports, so the preloaded copy is the
one used.

**Why:** the boot chain was strictly serial: HTML → React → boot module runs → `import(app.js)` →
app.js downloaded and parsed → only then are its static imports (`engine.js`, the largest file) found.
Preloading starts all four with the HTML. Browsers without `modulepreload` (Safari < 17) ignore the
hint and behave exactly as before.

### 3. PDF.js on demand — `TabDecoderPro.tsx`

**What:** `loadPdfJs()` (module-level, memoised, retries after a failure) imports the vendored PDF.js
4.10.38 the first time something needs it: the PDF Chart or Scan tab opens, or a decode handoff /
session restore / library open needs to read a PDF (each of those already waited on `pdfReady`; they
now also ask for it). `openPdfDocument` — the single, hardened PDF opener — awaits it, so no read can
reach an unloaded library. Every security property of the audit is unchanged (`isEvalSupported:
false`, `enableXfa: false`, one `getDocument(` call).

**Why:** it was imported on mount in every mode — 114 KB gzipped plus parsing 398 KB — although the
app opens on the Manual tab and most sessions (Audio, Guitar Pro, Lyrics, Tuner …) never read a PDF.

**Bug caught while verifying:** the first version only gated the button. `tests/bench/deployed-e2e.mjs`
chooses a PDF the instant the tab opens and got an unloaded PDF.js; that is why the wait now lives in
`openPdfDocument` itself. Opening the PDF tab costs one short same-origin fetch the first time.

### 4. Non-blocking boot scripts and an instant splash — `index.html`

**What:**
- the splash `<style>` moved ahead of every script;
- React and ReactDOM load with `defer` (deferred classic scripts and module scripts execute in
  document order, so React is in place before the boot module runs — same order as before);
- the seven optional model-glue modules (`note-model.js`, `stem-model.js`, `guitar-model.js`,
  `drum-model.js`, `chord-ocr-model.js`, `beat-model.js`, `tab-view.js`) are `async`.

**Why:** two synchronous scripts in `<head>` (143 KB) blocked parsing, so not even the dark background
and the "loading engine…" splash could paint until React had downloaded and run. And because non-async
module scripts execute in document order, the boot module waited for all seven glue modules too —
although each one only installs a `window.TTP_*` function the UI reads when a button is pressed
(checked: none is read during render or at module top level).

### 5. Web fonts from `<head>`, non-blocking, one weight lighter — `index.html`, `TabDecoderPro.tsx`

**What:** the Google Fonts `@import` was removed from the app's CSS. `<head>` now preconnects to
`fonts.googleapis.com` and `fonts.gstatic.com` and loads the stylesheet with
`media="print" onload="this.media='all'"` (never render-blocking; `display=swap` keeps the system
monospace until the font lands; a `<noscript>` copy for no-JS). IBM Plex Mono weight **500** was
dropped — no text in the app uses it (Plex weights in use: 400, 600, and 700, which was never requested
and is synthesised by the browser, as before; Space Mono 400 + 700 kept).

**Why:** an `@import` inside a `<style>` that React renders is discovered only after the whole app has
downloaded and run, so the font files started last and swapped in late (a visible text reflow on slow
links). This also shaves one font file per subset. The fonts remain cosmetic and third-party, as the
2026-11-18 audit already allows; the app works identically with them blocked (the e2e blocks them).

---

## Verification

- `npm test` — all 15 suites pass. New guards in `tests/pdfjs-vendored.mjs` ("load-time rails"): deployed
  modules carry no comments, all four modules are preloaded at their stamped URLs, React is `defer`,
  splash CSS precedes every script, no parser-blocking external script, the glue modules are `async`,
  fonts come from `<head>` non-blocking (none from the app CSS), PDF.js is on demand and every PDF path
  asks for it. The existing per-module `index.html` checks now expect `async`.
- `tests/bench/deployed-e2e.mjs` (real app, every non-site request blocked): app starts on the prebuilt
  path, Path A reads Blue Sky (165 bars) through the on-demand PDF.js, Scan renders a PDF page, a Guitar
  Pro file opens, the drum model runs, no console errors.
- `tests/bench/load-e2e.mjs` — the numbers in the table above.

## Next lever (not built)

Finding 6. Split `app.js` by mode with `React.lazy` + dynamic `import()` (Scan, Audio + stems, Library,
Lyrics, Live chords, Tuner each become their own chunk), and give the engine a thin boot entry that the
Manual tab needs. It is the largest remaining saving but touches the "one engine module" invariant
(the worker imports the same engine URL) and the build's import rewriting, so it deserves its own
change with its own measurements.
