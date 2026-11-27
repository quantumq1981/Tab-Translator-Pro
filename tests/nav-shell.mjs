/* Redesign step 4 (2026-11-27): the four destinations — fast guards on the UI source. The behaviour (first launch on
 * Open, bar / rail geometry, Chart empty state, ways in → Chart, Listen, Library, Back to <song>, the wide inspector,
 * toasts above the bar, restore → Chart, Start fresh → Open) is checked in a real browser by bench/nav-e2e.mjs. */
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, "..");
const ui = fs.readFileSync(path.join(repo, "TabDecoderPro.tsx"), "utf8");
let passes = 0, failures = 0;
const expect = (c, m) => { if (c) passes++; else { failures++; console.log("FAIL:", m); } };
const between = (a, b) => { const i = ui.indexOf(a); return i < 0 ? "" : ui.slice(i, ui.indexOf(b, i + a.length)); };

// the map: 9 modes → 4 destinations, every mode reachable exactly once
const arr = (name) => { const m = new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]);\\n`).exec(ui); return m ? Function(`return ${m[1]}`)() : null; };
const work = arr("WORK_MODES"), listen = arr("LISTEN_MODES"), ways = arr("WAYS_IN"), tools = arr("LISTEN_TOOLS"), dests = arr("DESTINATIONS");
expect(JSON.stringify(dests.map((d) => d[0])) === '["open","chart","listen","library"]', "four destinations, in order: Open · Chart · Listen · Library");
expect(ways.map((w) => w[0]).sort().join() === work.slice().sort().join() && tools.map((t) => t[0]).join() === listen.join(), "every way in is a work mode and every Listen tool a Listen mode");
expect([...work, ...listen, "library"].sort().join() === "audio,library,live,lyrics,manual,pdf,scan,tuner,xml", "the nine old modes are all reachable, each once");
expect(ways.every((w) => w[2].length > 30) && tools.every((t) => t[2].length > 20), "each way in / tool says what it is for");
expect(ways.map((w) => w[1]).join("|") === "MusicXML / GP|Audio|PDF Chart|Scan|Manual|Lyrics" && tools.map((t) => t[1]).join("|") === "Live chords|Tuner", "the cards keep the old mode names as accessible names (links, docs and tests still find them)");
expect(!/role="tablist" aria-label="Mode"/.test(ui), "the 9-tab mode row is gone");

// state: `mode` still names the panel; the destination is a view over it
expect(/const \[openView, setOpenView\] = useState\(true\);/.test(ui) && /const \[workChosen, setWorkChosen\] = useState\(false\);/.test(ui), "first launch lands on Open; Chart is empty until a way in is chosen");
expect(/const dest = openView \? "open" : LISTEN_MODES\.includes\(mode\) \? "listen" : mode === "library" \? "library" : "chart";/.test(ui), "the destination is derived from mode + the Open view");
const eff = between("useEffect(() => {\n    if (WORK_MODES.includes(mode)) lastWork.current = mode;", "}, [mode]);");
expect(/if \(prevMode\.current === mode\) return;/.test(eff) && /setOpenView\(false\);/.test(eff) && /if \(!byNav && WORK_MODES\.includes\(mode\)\) setWorkChosen\(true\);/.test(eff), "any mode change by a way in (pick, restore, handoff, library) leaves Open for Chart; a bar switch doesn't count as a pick");
expect(/if \(goOpen\.current\) \{ goOpen\.current = false; setOpenView\(true\); return; \}/.test(eff) && /if \(mode !== "manual"\) goOpen\.current = true; setOpenView\(true\); setWorkChosen\(false\); setMode\("manual"\);/.test(ui), "Start fresh lands on Open");
expect(/setMode\(s0\.mode\); setWorkChosen\(true\); setOpenView\(false\);/.test(ui), "Start fresh's Undo returns to Chart");
const go = between("const go = (d) => {", "\n  };");
expect(/lastWork\.current/.test(go) && /lastListen\.current/.test(go) && /"library"/.test(go) && /navSwitch\.current = true/.test(go), "the bar returns Chart to the last way in and Listen to the last tool");
expect(/const workMode = WORK_MODES\.includes\(mode\) \? mode : lastWork\.current;/.test(ui) && /<OpenView C=\{C\} mode=\{workMode\}/.test(ui), "Open knows the song even when reached from Listen / Library");

// the bar / rail
expect(/<nav className="tdp-nav no-print" aria-label="Main">/.test(ui) && /aria-current=\{dest === d \? "page" : undefined\}/.test(ui), "a Main nav landmark; the current destination is aria-current=page (buttons, not tabs: no clash with the chart's 'Chart' view tab)");
expect(/\.tdp-nav\{position:fixed;left:0;right:0;bottom:0;/.test(ui) && /@media \(min-width:1024px\)\{\s*\.tdp-nav\{top:0;right:auto;bottom:0;width:84px;flex-direction:column;/.test(ui), "a bottom bar under 1024 px, a left rail from 1024 px (window width, not device)");
expect(/\.tdp-main\{padding-bottom:calc\(72px \+ env\(safe-area-inset-bottom,0px\)\);\}/.test(ui) && /\.tdp-main\{padding-bottom:0;margin-left:84px;\}/.test(ui), "the page makes room for the bar / rail (nothing hides under it)");
expect(/\.tdp-nav button\[aria-current="page"\] \.tdp-nav-icon\{background:/.test(ui), "the current destination is a pill as well as a colour (#12)");
expect(/@media \(max-width:1023px\)\{\.tdp-toasts\{bottom:calc\(80px/.test(ui), "toasts sit above the bar");
expect(/<NavIcon name=\{d\} \/>/.test(ui) && /function NavIcon\(/.test(ui) && !/fonts\.googleapis[^"]*Material/.test(ui), "inline SVG icons, no icon font");

// views
expect(/function OpenView\(/.test(ui) && /role="tablist" aria-label="Ways in"/.test(ui) && /data-continue/.test(ui) && /Back to <b>/.test(ui), "Open: ways in as cards + Back to <song>");
expect(/function ChartEmpty\(/.test(ui) && /data-chart-empty/.test(ui) && /Open a file/.test(ui), "Chart's empty state points to Open");
expect(/<SubTabs C=\{C\} label="Listen" items=\{LISTEN_TOOLS\}/.test(ui), "Listen: Live chords + Tuner as a tablist");
expect(/dest === "chart" && songTitle && <span data-song-title/.test(ui), "the song's name sits in the app bar on Chart");

// the wide inspector
const sheet = between("function ChordSheet(", "\n/* ---- ABC file naming");
expect(/const wide = useWide\(\);/.test(sheet) && /aria-modal="false"/.test(sheet) && /data-inspector className="tdp-inspector"/.test(sheet) && /width: 360/.test(sheet), "wide: the chord sheet is a 360 px non-modal inspector");
expect(/h\.classList\.add\("tdp-inspecting"\)/.test(sheet) && /html\.tdp-inspecting \.tdp-main\{margin-right:360px;\}/.test(ui), "…and the chart makes room for it");
expect(/if \(!wideRef\.current\) document\.body\.style\.overflow = "hidden";/.test(sheet) && /wideRef\.current\) return;\s+\/\/ focus trap/.test(sheet), "…with no scroll lock and no focus trap (the chart stays usable)");
expect(/function useWide\(\)/.test(ui) && /\(min-width: 1024px\)/.test(ui) && /addEventListener\("change"/.test(ui), "the size class follows the window (Split View) and updates live");

console.log(`nav-shell: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
