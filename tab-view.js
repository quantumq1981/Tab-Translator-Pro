/* ==========================================================================
 * tab-view.js — browser-only glue that publishes window.TTP_TAB_VIEW, the
 * renderer behind ChartPanel's "Tab" view and the "open a saved .alphatex" panel.
 * It draws the AlphaTex the engine exports (scoreToAlphaTex) as real notation +
 * tablature and plays it, with alphaTab 1.8.4 (MPL-2.0) vendored same-origin in
 * vendor/alphatab-1.8.4/ — its render worker and audio worklet must be same-origin,
 * which a CDN copy would not be.
 *
 * Contract:
 *   window.TTP_TAB_VIEW.mount(element, tex, { profile, scale, onState, onPlayer })
 *     → Promise<{ setTex(tex), setProfile(p), playPause(), stop(), setSpeed(x), destroy() }>
 *   profile: "tab" (tab only) · "score-tab" (standard notation over tab, the default)
 *   onState({ phase: "loading" | "rendering" | "ready" | "error", message?, bars? })
 *   onPlayer({ ready, playing, posSec, endSec, loading? })
 *
 * Same lazy pattern as note-model.js / stem-model.js: nothing is fetched at boot.
 * The first mount loads ~1.1 MB of library, the 313 KB Bravura music font and the
 * 977 KB sound font (~2.4 MB, then HTTP-cached). Any failure is reported through
 * onState({ phase: "error" }) — never thrown at boot.
 *
 * DEVICE-ONLY seam (like PDF.js and Web Audio): npm test asserts the contracts
 * (vendored files + pins, lazy load, deploy list); tests/bench/tab-view-e2e.mjs
 * renders and plays it in headless Chromium; a real iPhone/iPad is the last check.
 * ========================================================================== */
const BASE = new URL("./vendor/alphatab-1.8.4/", import.meta.url).href;

let _lib = null;
const lib = () => _lib || (_lib = import(/* @vite-ignore */ BASE + "alphaTab.mjs").catch((e) => { _lib = null; throw e; }));

// The player draws its cursor and highlights with these classes (alphaTab ships no stylesheet).
function injectCss() {
  if (typeof document === "undefined" || document.getElementById("ttp-alphatab-css")) return;
  const s = document.createElement("style");
  s.id = "ttp-alphatab-css";
  s.textContent = [
    ".at-cursor-bar{background:rgba(255,200,0,.18)}",
    ".at-cursor-beat{background:rgba(232,140,30,.9);width:3px}",
    ".at-selection div{background:rgba(64,120,255,.12)}",
    ".at-highlight *{fill:#c25a00;stroke:#c25a00}",
  ].join("");
  document.head.appendChild(s);
}

function settingsFor(at, opts) {
  const profile = opts.profile === "tab" ? at.StaveProfile.Tab : at.StaveProfile.ScoreTab;
  return {
    core: {
      engine: "svg",
      useWorkers: true,
      fontDirectory: BASE + "font/",
      smuflFontSources: new Map([["woff2", BASE + "font/Bravura.woff2"], ["woff", BASE + "font/Bravura.woff"]]),
    },
    display: { layoutMode: at.LayoutMode.Page, staveProfile: profile, scale: opts.scale || 1 },
    player: {
      playerMode: at.PlayerMode.EnabledSynthesizer,
      soundFont: BASE + "soundfont/sonivox.sf3",
      scrollElement: opts.scrollElement || "html,body",
      enableCursor: true,
      enableUserInteraction: true,
    },
  };
}

async function mount(el, tex, opts = {}) {
  const onState = opts.onState || (() => {});
  const onPlayer = opts.onPlayer || (() => {});
  if (!el) throw new Error("no element to draw the tab in");
  onState({ phase: "loading" });
  let at;
  try { at = await lib(); }
  catch (e) {
    onState({ phase: "error", message: "Couldn't load the tab renderer (" + ((e && e.message) || "network error") + "). Check the connection and try again." });
    throw e;
  }
  injectCss();
  const api = new at.AlphaTabApi(el, settingsFor(at, opts));
  const player = { ready: false, playing: false, posSec: 0, endSec: 0 };
  const emit = (p) => { Object.assign(player, p); onPlayer({ ...player }); };
  api.error.on((e) => onState({ phase: "error", message: (e && e.message) || String(e) }));
  api.renderStarted.on(() => onState({ phase: "rendering" }));
  api.renderFinished.on(() => {
    let bars = 0;
    try { bars = api.score ? api.score.masterBars.length : 0; } catch (_) { /* score shape changed */ }
    onState({ phase: "ready", bars });
  });
  api.soundFontLoad.on((e) => emit({ loading: e && e.total ? e.loaded / e.total : 0 }));
  api.playerReady.on(() => emit({ ready: true, loading: 1 }));
  api.playerStateChanged.on((e) => emit({ playing: !!(e && e.state === 1) }));
  api.playerPositionChanged.on((e) => emit({ posSec: (e.currentTime || 0) / 1000, endSec: (e.endTime || 0) / 1000 }));
  const load = (t) => { try { api.tex(String(t || "")); } catch (e) { onState({ phase: "error", message: (e && e.message) || String(e) }); } };
  load(tex);
  return {
    setTex: load,
    setProfile(p) {
      api.settings.display.staveProfile = p === "tab" ? at.StaveProfile.Tab : at.StaveProfile.ScoreTab;
      api.updateSettings();
      api.render();
    },
    playPause() { api.playPause(); },
    stop() { api.stop(); },
    setSpeed(x) { api.playbackSpeed = Math.max(0.25, Math.min(2, +x || 1)); },
    destroy() { try { api.destroy(); } catch (_) { /* already gone */ } },
  };
}

try {
  if (typeof window !== "undefined") window.TTP_TAB_VIEW = { mount, base: BASE, version: "1.8.4" };
} catch (_) { /* never wedge boot */ }
