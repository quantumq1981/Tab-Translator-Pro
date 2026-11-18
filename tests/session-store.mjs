/* SESSION STORE suite — audit 2026-11-18 C2 / M1 / m1 / m3 / m10 (docs/AUDIT-2026-11-18.md).
 * Behavioural tests of session-store.js against mocks of each browser, not presence checks:
 *   · Safari / iOS 15.2–18.x: OPFS getDirectory + getFileHandle exist, createWritable does NOT;
 *   · Safari 26 / Chromium: full OPFS;
 *   · OPFS that starts failing mid-session; a localStorage that runs out of quota;
 *   · a tab killed between the bytes write and the metadata write;
 *   · the stray zero-length files the old code left on Safari < 26.
 * The audit's proof (old code: "save → ls, read → 0 bytes"; "file B's metadata over file A's
 * bytes") is reproduced first against a faithful copy of the old helpers, so the mocks are known
 * to model the failure, then the new store is run through the same steps. */
import { webcrypto } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
if (!globalThis.btoa) globalThis.btoa = (s) => Buffer.from(s, "latin1").toString("base64");
if (!globalThis.atob) globalThis.atob = (b) => Buffer.from(b, "base64").toString("latin1");
const S = await import(path.join(repo, "session-store.js"));

let failures = 0, passes = 0;
const expect = (cond, msg) => { if (cond) passes++; else { failures++; console.error("FAIL:", msg); } };
const section = (name) => console.log(`\n— ${name}`);
const bytesOf = (n, seed) => { const u = new Uint8Array(n); for (let i = 0; i < n; i++) u[i] = (i * 31 + seed * 7 + (i >> 8)) & 255; return u; };
const same = (a, b) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

/* ---------- mocks ---------- */
class MockFile { constructor(b) { this._b = b; this.size = b.length; } async arrayBuffer() { return this._b.slice().buffer; } }
function mockOpfs({ writable = true } = {}) {
  const ctl = { failWrites: false, writable };
  const mkDir = () => {
    const files_ = new Map(); // name → { kind, bytes | dir }
    const fileHandle = (name) => {
      const h = { kind: "file", name, async getFile() { const e = files_.get(name); if (!e) throw new Error("NotFoundError"); return new MockFile(e.bytes); } };
      if (ctl.writable) h.createWritable = async () => {
        if (ctl.failWrites) throw new Error("NoModificationAllowedError");
        let buf = new Uint8Array(0);
        return { async write(b) { if (ctl.failWrites) throw new Error("QuotaExceededError"); buf = new Uint8Array(b); }, async close() { files_.get(name).bytes = buf; } };
      };
      return h;
    };
    const dir = {
      kind: "directory", _m: files_,
      async getFileHandle(name, opts = {}) {
        if (!files_.has(name)) { if (!opts.create) throw new Error("NotFoundError"); files_.set(name, { kind: "file", bytes: new Uint8Array(0) }); }
        return fileHandle(name);
      },
      async getDirectoryHandle(name, opts = {}) {
        if (!files_.has(name)) { if (!opts.create) throw new Error("NotFoundError"); files_.set(name, { kind: "directory", dir: mkDir() }); }
        return files_.get(name).dir;
      },
      async removeEntry(name) { if (!files_.delete(name)) throw new Error("NotFoundError"); },
      async *entries() { for (const [n, e] of [...files_]) yield [n, e.kind === "file" ? fileHandle(n) : e.dir]; },
    };
    return dir;
  };
  const rootDir = mkDir();
  return { ctl, root: async () => rootDir, rootDir, file: (sub, name) => { const d = sub ? rootDir._m.get(sub) : { dir: rootDir }; const e = d && d.dir._m.get(name); return e ? e.bytes : undefined; } };
}
function mockLS(quotaChars = Infinity) {
  const m = new Map();
  const used = () => [...m].reduce((a, [k, v]) => a + k.length + v.length, 0);
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { const prev = m.get(k); m.set(k, String(v)); if (used() > quotaChars) { if (prev === undefined) m.delete(k); else m.set(k, prev); const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; } },
    removeItem: (k) => { m.delete(k); },
  };
}
function mockFiles({ fail = false } = {}) {
  const m = new Map();
  return { m, put: async (k, v) => { if (fail) throw new Error("IDB blocked"); m.set(k, new Uint8Array(v)); }, get: async (k) => (m.has(k) ? m.get(k) : undefined), del: async (k) => { m.delete(k); } };
}

/* ---------- the OLD helpers (verbatim logic from TabDecoderPro.tsx @ 1c84ce1) ---------- */
function oldHelpers({ root, ls }) {
  const SESS_META = "ttp:session:v1", SESS_BIN_LS = "ttp:session:bin:v1", SESS_LS_MAX = 3_000_000;
  const _opfsWrite = async (bytes) => { const dir = await root(); if (!dir) return false; try { const fh = await dir.getFileHandle("session.bin", { create: true }); if (typeof fh.createWritable !== "function") return false; const w = await fh.createWritable(); await w.write(bytes); await w.close(); return true; } catch (_) { return false; } };
  const _opfsRead = async () => { const dir = await root(); if (!dir) return null; try { const fh = await dir.getFileHandle("session.bin"); const f = await fh.getFile(); return new Uint8Array(await f.arrayBuffer()); } catch (_) { return null; } };
  return {
    async saveSessionFile(bytes) { try { const ok = await _opfsWrite(bytes); if (ok) { ls.removeItem(SESS_BIN_LS); return "opfs"; } if (bytes.length <= SESS_LS_MAX) { ls.setItem(SESS_BIN_LS, S.bytesToB64(bytes)); return "ls"; } return "none"; } catch (_) { return "none"; } },
    async readSessionFile() { const o = await _opfsRead(); if (o) return o; const b = ls.getItem(SESS_BIN_LS); return b ? S.b64ToBytes(b) : null; },
    saveMeta: (m) => ls.setItem(SESS_META, JSON.stringify(m)),
  };
}

section("the mocks reproduce the audit's failures with the OLD helpers");
{
  const o = mockOpfs({ writable: false }), ls = mockLS(), old = oldHelpers({ root: o.root, ls });
  const A = bytesOf(5000, 1);
  expect((await old.saveSessionFile(A)) === "ls", "old code on Safari 18: save falls back to localStorage");
  const got = await old.readSessionFile();
  expect(got && got.length === 0, `old code on Safari 18: read returns the empty OPFS file (0 bytes), got ${got && got.length}`);
}
{
  const o = mockOpfs(), ls = mockLS(), old = oldHelpers({ root: o.root, ls });
  const A = bytesOf(4000, 1), B = bytesOf(6000, 2);
  await old.saveSessionFile(A); o.ctl.failWrites = true;
  expect((await old.saveSessionFile(B)) === "ls", "old code: OPFS fails for B, falls back to localStorage");
  expect(same(await old.readSessionFile(), A), "old code: B's save is read back as A's bytes (M1)");
}

const c = webcrypto.subtle;

section("C2 · Safari / iOS 15.2–18.x (no createWritable)");
{
  const o = mockOpfs({ writable: false }), ls = mockLS(), files = mockFiles();
  const st = S.createSessionStore({ root: o.root, canWriteOpfs: false, ls, files, subtle: c });
  const A = bytesOf(5000, 1);
  const r = await st.saveSessionFile(A);
  expect(r.where === "idb" && r.size === 5000 && /^sha256:[0-9a-f]{64}$/.test(r.hash), `saved to IndexedDB with a SHA-256 binding, got ${JSON.stringify({ ...r, hash: r.hash.slice(0, 12) })}`);
  expect(o.file(null, "session.bin") === undefined, "no zero-length session.bin is created");
  expect(!ls.m.has(S.SESS_BIN_LS), "nothing goes to the shared localStorage quota when IndexedDB works");
  const got = await st.readSessionFile({ size: r.size, hash: r.hash });
  expect(got && got.verified === true && same(got.bytes, A), "read back: the same bytes, verified");
}
{ // createWritable claimed but missing on the handle (detection lies): no empty file left behind
  const o = mockOpfs({ writable: false }), files = mockFiles();
  const st = S.createSessionStore({ root: o.root, canWriteOpfs: true, ls: mockLS(), files, subtle: c });
  const r = await st.saveSessionFile(bytesOf(100, 3));
  expect(r.where === "idb" && o.file(null, "session.bin") === undefined, "a handle without createWritable is removed again, bytes go to IndexedDB");
}
{ // a library left by the old code: stray 0-byte OPFS files, the real bytes in localStorage / IndexedDB
  const o = mockOpfs({ writable: false }), ls = mockLS(), files = mockFiles();
  await (await o.root()).getFileHandle("session.bin", { create: true });
  const proj = await (await o.root()).getDirectoryHandle("projects", { create: true });
  await proj.getFileHandle("p1.bin", { create: true });
  const A = bytesOf(3000, 4), P = bytesOf(7000, 5);
  ls.setItem(S.SESS_BIN_LS, S.bytesToB64(A)); files.m.set("p1", P);
  const st = S.createSessionStore({ root: o.root, canWriteOpfs: false, ls, files, subtle: c });
  const legacy = await st.readSessionFile();
  expect(legacy && legacy.verified === "legacy" && same(legacy.bytes, A), "an old session (no binding) restores from localStorage, not the empty OPFS file");
  expect(same(await st.projectFileGet("p1"), P), "an old project restores from IndexedDB, not the empty OPFS file");
  expect((await st.projectFileGet("p1", { size: 7000 })) && (await st.projectFileGet("p1", { size: 1 })) === null, "a record's size is checked when given");
  expect((await st.removeEmptyFiles()) === 2 && o.file(null, "session.bin") === undefined && o.file("projects", "p1.bin") === undefined, "the two stray empty files are removed");
  expect(same(await st.projectFileGet("p1"), P), "…and the real bytes are untouched");
}
{ // empty bytes are never saved and never displace a good copy
  const files = mockFiles(), st = S.createSessionStore({ root: async () => null, ls: mockLS(), files, subtle: c });
  const A = bytesOf(900, 6), r = await st.saveSessionFile(A);
  const e = await st.saveSessionFile(new Uint8Array(0));
  expect(e.where === "none" && same((await st.readSessionFile({ size: r.size, hash: r.hash })).bytes, A), "saving 0 bytes is refused and leaves the last good copy");
  expect((await st.projectFilePut("x", new Uint8Array(0))) === null && !files.m.has("x"), "a project with 0 bytes is not stored");
}

section("Safari 26 / Chromium (full OPFS)");
{
  const o = mockOpfs(), ls = mockLS(), files = mockFiles();
  ls.setItem(S.SESS_BIN_LS, "AAAA"); files.m.set(S.SESS_BIN_IDB, bytesOf(10, 9));
  const st = S.createSessionStore({ root: o.root, canWriteOpfs: true, ls, files, subtle: c });
  const A = bytesOf(20000, 7), r = await st.saveSessionFile(A);
  expect(r.where === "opfs" && same(o.file(null, "session.bin"), A), "saved to OPFS");
  expect(!ls.m.has(S.SESS_BIN_LS) && !files.m.has(S.SESS_BIN_IDB), "the copies in the other stores are removed");
  expect(same((await st.readSessionFile({ size: r.size, hash: r.hash })).bytes, A), "read back verified");
  expect((await st.projectFilePut("p", A)) === "opfs" && same(await st.projectFileGet("p", { size: A.length }), A), "library files live in OPFS too");
}

section("M1 · metadata and bytes cannot describe different files");
{ // OPFS works for A, then fails for B
  const o = mockOpfs(), ls = mockLS(), files = mockFiles();
  const st = S.createSessionStore({ root: o.root, canWriteOpfs: true, ls, files, subtle: c });
  const A = bytesOf(4000, 1), B = bytesOf(6000, 2);
  const ra = await st.saveSessionFile(A); st.saveSessionMeta({ v: 1, filename: "A.gp", file: { size: ra.size, hash: ra.hash }, overrides: { "1.0": "A7" } });
  o.ctl.failWrites = true;
  const rb = await st.saveSessionFile(B);
  expect(rb.where === "idb" && o.file(null, "session.bin") === undefined, "B falls back to IndexedDB and A's OPFS copy is removed");
  expect(st.readSessionMeta() === null, "starting B's save removed A's metadata (A's edits can't land on B)");
  const got = await st.readSessionFile({ size: rb.size, hash: rb.hash });
  expect(got.verified === true && same(got.bytes, B), "B's binding reads B, not A");
}
{ // localStorage holds A, then B is too big for any store
  const ls = mockLS(), st = S.createSessionStore({ root: async () => null, ls, files: null, lsMax: 5000, subtle: c });
  const A = bytesOf(3000, 1), B = bytesOf(9000, 2);
  const ra = await st.saveSessionFile(A);
  expect(ra.where === "ls", "A fits in localStorage");
  st.saveSessionMeta({ v: 1, filename: "A.gp", file: { size: ra.size, hash: ra.hash } });
  const rb = await st.saveSessionFile(B);
  expect(rb.where === "none" && !ls.m.has(S.SESS_BIN_LS) && st.readSessionMeta() === null, "B fits nowhere: A's bytes AND A's metadata are gone");
  expect((await st.readSessionFile({ size: rb.size, hash: rb.hash })) === null, "nothing restores (never A under B's name)");
}
{ // quota exceeded in localStorage behaves like "too big"
  const st = S.createSessionStore({ root: async () => null, ls: mockLS(3000), files: null, subtle: c });
  expect((await st.saveSessionFile(bytesOf(4000, 1))).where === "none", "a localStorage quota error is a clean 'none'");
}
{ // a tab killed after the bytes were written, before the metadata: no metadata → no restore
  const files = mockFiles(), ls = mockLS(), st = S.createSessionStore({ root: async () => null, ls, files, subtle: c });
  const A = bytesOf(1000, 1), ra = await st.saveSessionFile(A);
  st.saveSessionMeta({ v: 1, filename: "A.gp", file: { size: ra.size, hash: ra.hash } });
  await st.saveSessionFile(bytesOf(1000, 2)); // "killed" here
  expect(st.readSessionMeta() === null, "killed between writes: no metadata survives to mis-describe the bytes");
}
{ // metadata from somewhere else (an older build, a sibling app) over different bytes → verified:false
  const files = mockFiles(), st = S.createSessionStore({ root: async () => null, ls: mockLS(), files, subtle: c });
  const ra = await st.saveSessionFile(bytesOf(1000, 1));
  files.m.set(S.SESS_BIN_IDB, bytesOf(1000, 2)); // same size, different content
  const got = await st.readSessionFile({ size: ra.size, hash: ra.hash });
  expect(got && got.verified === false, "same size, different content: returned unverified (the UI opens it without edits)");
}

section("m1 · content hash; m10 · persistent storage");
{
  const a = await S.contentHash(bytesOf(500, 1), c), b = await S.contentHash(bytesOf(500, 2), c);
  expect(a !== b && a === (await S.contentHash(bytesOf(500, 1), c)), "SHA-256: equal for equal bytes, different for same-length different bytes");
  const fa = await S.contentHash(bytesOf(500, 1), null), fb = await S.contentHash(bytesOf(500, 2), null);
  expect(/^fnv1a:/.test(fa) && fa !== fb && fa !== a, "no SubtleCrypto: an FNV-1a fallback that never equals a SHA-256 value");
  let asked = 0;
  const st = S.createSessionStore({ root: async () => null, ls: mockLS(), files: mockFiles(), persist: async () => { asked++; return true; }, subtle: c });
  await st.projectFilePut("a", bytesOf(10, 1)); await st.projectFilePut("b", bytesOf(10, 2));
  expect(asked === 1, `the library asks for persistent storage once, got ${asked}`);
}

section("M2.3 · restore-in-flight marker");
{
  const ls = mockLS(), st = S.createSessionStore({ root: async () => null, ls, files: null, subtle: c });
  expect(st.restoreMark() === null, "no marker at first");
  st.markRestore("song.gpx");
  expect(st.restoreMark() && st.restoreMark().filename === "song.gpx", "the marker names the file being restored");
  st.clearRestoreMark();
  expect(st.restoreMark() === null, "cleared after the restore finishes");
  st.markRestore("x"); await st.clearSession();
  expect(st.restoreMark() === null && st.readSessionMeta() === null, "Start fresh clears the marker and the session");
}

section("UI uses the store (no second copy of the storage rules)");
{
  const ui = fs.readFileSync(path.join(repo, "TabDecoderPro.tsx"), "utf8");
  const html = fs.readFileSync(path.join(repo, "index.html"), "utf8");
  const pages = fs.readFileSync(path.join(repo, ".github/workflows/pages.yml"), "utf8");
  expect(/from\s*"\.\/session-store\.js"/.test(ui) && /createSessionStore\(/.test(ui), "the UI imports session-store.js");
  expect(!/getFileHandle|createWritable|getDirectory\(\)/.test(ui), "the UI has no OPFS code of its own left");
  expect(/session-store\.js/.test(html) && /cp[^\n]*session-store\.js[^\n]*_site/.test(pages), "the loader serves it and the deploy ships it");
  expect(/!bytes \|\| !bytes\.length/.test(ui), "an empty project/session file is rejected before it is opened");
}

console.log(`\nsession-store: ${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
