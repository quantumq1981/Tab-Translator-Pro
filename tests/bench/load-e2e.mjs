/* Boot-time benchmark: assemble the site from <repo> exactly as pages.yml does, serve it gzip-compressed
 * (like GitHub Pages) with a per-request latency, and time the boot in headless Chromium under a mobile-ish
 * network + CPU throttle (perf audit 2026-11-26, docs/PERF-AUDIT-2026-11-26.md).
 *   node bench/load-e2e.mjs [repo checkout = this repo] [label] [runs = 5]     env LAT=<ms RTT> DOWN=<bit/s>
 * Compare two revisions by passing a git worktree of the older one (it needs tests/node_modules linked). */
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import http from "node:http"; import zlib from "node:zlib";
import { execFileSync } from "node:child_process"; import { createRequire } from "node:module";
const here = path.dirname(new URL(import.meta.url).pathname);
const [repoArg, label = "this checkout", runsArg] = process.argv.slice(2); const repo = path.resolve(repoArg || path.join(here, "..", "..")); const RUNS = +(runsArg || 5);
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("/opt/node-tools/node_modules/playwright");
const yml = fs.readFileSync(path.join(repo, ".github/workflows/pages.yml"), "utf8");
const start = yml.indexOf("- name: Assemble site"), runAt = yml.indexOf("run: |", start);
const body = []; for (const ln of yml.slice(runAt + 6).split("\n").slice(1)) { if (ln.trim() && !/^ {10}/.test(ln)) break; body.push(ln.slice(10)); }
const site = fs.mkdtempSync(path.join(os.tmpdir(), "ttp-lb-"));
execFileSync("bash", ["-euo", "pipefail", "-c", body.join("\n").replace(/_site\b/g, site)], { cwd: repo, env: { ...process.env, GITHUB_SHA: "bench000deadbeef" }, stdio: "pipe" });
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".wasm": "application/wasm" };
const gz = new Map();
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"), f = path.join(site, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname));
  fs.readFile(f, (e, d) => {
    if (e) { res.statusCode = 404; res.end(); return; }
    const ext = path.extname(f); res.setHeader("content-type", MIME[ext] || "application/octet-stream"); res.setHeader("cache-control", "no-store");
    if (/\.(html|js|mjs|json)$/.test(ext)) { if (!gz.has(f)) gz.set(f, zlib.gzipSync(d, { level: 6 })); res.setHeader("content-encoding", "gzip"); d = gz.get(f); }
    res.end(d);
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const res = [];
for (let i = 0; i < RUNS; i++) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route((u) => !u.href.startsWith(origin), (r) => r.abort()); // fonts etc.: not part of the comparison
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  // "Regular 4G"-ish mobile: 170 ms RTT, 9 Mbit/s down; CPU 4× slower (a mid-range phone)
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: +(process.env.LAT || 170), downloadThroughput: +(process.env.DOWN || 9e6) / 8, uploadThroughput: 1.5e6 / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  let bytes = 0, reqs = 0; const urls = [];
  cdp.on("Network.loadingFinished", (e) => { bytes += e.encodedDataLength; reqs++; });
  cdp.on("Network.requestWillBeSent", (e) => urls.push(e.request.url.replace(origin, "")));
  const t0 = Date.now();
  await page.goto(origin + "/", { waitUntil: "commit" });
  await page.getByRole("button", { name: "MusicXML / GP" }).waitFor({ timeout: 120000 });
  const tApp = Date.now() - t0;
  const fcp = await page.evaluate(() => (performance.getEntriesByName("first-contentful-paint")[0] || {}).startTime || null);
  await page.waitForTimeout(1500); // let idle/background loads land, then count
  res.push({ tApp, fcp: Math.round(fcp), bytes, reqs, pdf: urls.some((u) => /pdf\.min\.mjs/.test(u)) });
  await ctx.close();
}
await browser.close(); server.close(); fs.rmSync(site, { recursive: true, force: true });
const med = (k) => { const v = res.map((r) => r[k]).sort((a, b) => a - b); return v[v.length >> 1]; };
console.log(JSON.stringify({ label, runs: RUNS, median: { firstPaintMs: med("fcp"), appReadyMs: med("tApp"), kbTransferred: Math.round(med("bytes") / 1024), requests: med("reqs") }, pdfjsAtBoot: res[0].pdf, all: res }));
