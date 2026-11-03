/* Shared harness for the workbench e2e benches: serves the repo, boots the REAL app in headless
 * Chromium with React + Babel served locally from --deps (the sandbox blocks esm.sh / unpkg; build
 * recipe in bench/README.md), and collects console errors. */
import fs from "node:fs"; import path from "node:path"; import http from "node:http";
import { createRequire } from "node:module";
import * as L from "./lib.mjs";

export const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".tsx": "text/plain", ".json": "application/json", ".woff2": "font/woff2", ".onnx": "application/octet-stream" };
export async function startApp({ deps = arg("deps"), width = 820, height = 1180, launchArgs = [], context = {} } = {}) {
  if (!deps) { console.error("--deps <dir> is required"); process.exit(2); }
  const require = createRequire(import.meta.url);
  const { chromium } = require(arg("playwright", "/opt/node-tools/node_modules/playwright"));
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    const f = path.join(L.repo, decodeURIComponent(u.pathname === "/" ? "/index.html" : u.pathname));
    if (!f.startsWith(L.repo)) { res.statusCode = 403; res.end(); return; }
    fs.readFile(f, (e, data) => { if (e) { res.statusCode = 404; res.end(); return; } res.setHeader("content-type", MIME[path.extname(f)] || "application/octet-stream"); res.end(data); });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: arg("chromium", "/opt/pw-browsers/chromium"), args: launchArgs });
  const ctx = await browser.newContext({ viewport: { width, height }, acceptDownloads: true, ...context });
  const ALL = fs.readFileSync(path.join(deps, "all.mjs"), "utf8"), BABEL = fs.readFileSync(path.join(deps, "babel.min.js"));
  const js = (body) => ({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body });
  // routes registered LATER win in Playwright: the blanket abort goes first
  await ctx.route(/^https:\/\/(cdnjs\.cloudflare\.com|fonts\.googleapis\.com)\//, (r) => r.abort());
  await ctx.route("https://esm.sh/__e2e/all.mjs", (r) => r.fulfill(js(ALL)));
  await ctx.route(/^https:\/\/esm\.sh\/react@18\.3\.1(\?.*)?$/, (r) => r.fulfill(js('export * from "/__e2e/all.mjs"; export { React as default } from "/__e2e/all.mjs";')));
  await ctx.route(/^https:\/\/esm\.sh\/react-dom@18\.3\.1\/client.*/, (r) => r.fulfill(js('import { createRoot, hydrateRoot } from "/__e2e/all.mjs"; export { createRoot, hydrateRoot }; export default { createRoot, hydrateRoot };')));
  await ctx.route("https://unpkg.com/@babel/standalone@7.25.6/babel.min.js", (r) => r.fulfill({ ...js(""), body: BABEL }));
  const page = await ctx.newPage();
  const logs = [];
  page.on("console", (m) => { if (m.type() === "error") logs.push(`[error] ${m.text()}`); });
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(origin + "/"); await page.waitForTimeout(400);
  const steps = [];
  const ok = (name, cond, extra) => { steps.push({ name, ok: !!cond, ...(extra !== undefined ? { extra } : {}) }); console.log(cond ? "OK  " : "FAIL", name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ""); };
  const errors = () => logs.filter((l) => !/fonts\.googleapis|ERR_FAILED|net::|\[BABEL\] Note|W:onnxruntime/.test(l));
  const close = async () => { await browser.close(); server.close(); };
  return { page, ctx, browser, origin, ok, steps, errors, close, repo: L.repo };
}
