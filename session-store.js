/* ==========================================================================
 *  SESSION + LIBRARY BYTE STORE — browser glue with INJECTED backends
 *  (audit 2026-11-18 C2, M1, m1, m10; see docs/AUDIT-2026-11-18.md)
 *
 *  Holds every rule for where an opened file's bytes are kept, so the rules can be unit-tested
 *  against mocks of each browser (tests/session-store.mjs) instead of only on a phone:
 *
 *  · OPFS write support is checked BEFORE a file handle is created. Safari/iOS 15.2–18.x have
 *    getDirectory/getFileHandle but no FileSystemFileHandle.createWritable (that is Safari 26+);
 *    the old code created the handle first, leaving a zero-length file that was then read back in
 *    place of the localStorage / IndexedDB copy. Reads also treat a 0-byte file as absent, and
 *    an empty byte array is never saved.
 *  · Bytes are saved FIRST; the caller writes the session metadata afterwards with the
 *    { size, hash } this store returns. Starting a save removes the old metadata, so a tab killed
 *    mid-save leaves "nothing to restore", never metadata describing different bytes.
 *  · When one store accepts the bytes, the copy in the other store is removed; when none does,
 *    both stale copies go. A read with an expected { size, hash } only returns bytes that match.
 *  · Library records are matched on a content hash (m1), not filename + length.
 *
 *  Plain ES (no TS/JSX): index.html serves it to the UI at a no-cache Blob URL, like engine.tsx. */

export const SESS_META = "ttp:session:v1";        // localStorage: small UI-state JSON
export const SESS_BIN_LS = "ttp:session:bin:v1";  // localStorage: base64 bytes (fallback only)
export const SESS_BIN_OPFS = "session.bin";       // OPFS: raw file bytes (preferred)
export const SESS_BIN_IDB = "__session__";        // IndexedDB "files" key (Safari < 26)
export const RESTORE_INFLIGHT = "ttp:restore:inflight"; // set while a restore parses; see M2.3
/* WebKit counts ~2 bytes per character against a ~5 MB per-origin localStorage quota that every app
 * on quantumq1981.github.io shares (handoffs included); base64 adds a third. 1.2 MB of raw bytes is
 * ~3.2 MB of quota — leaves room for the csm:handoff:v1 envelope (m3). */
export const SESS_LS_MAX = 1_200_000;

const isBytes = (b) => !!b && typeof b.length === "number" && b.length > 0;

export function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToBytes(b64) {
  const bin = atob(b64), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

/* FNV-1a 32 over the bytes + the length: the fallback when crypto.subtle is missing (insecure
 * origin, old engine). Prefixed so the two kinds never compare equal by accident. */
function fnv1a(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return "fnv1a:" + h.toString(16).padStart(8, "0");
}
export async function contentHash(bytes, subtle) {
  const s = subtle === undefined ? (typeof crypto !== "undefined" && crypto.subtle ? crypto.subtle : null) : subtle;
  if (s && typeof s.digest === "function") {
    try {
      const d = new Uint8Array(await s.digest("SHA-256", bytes));
      let hex = ""; for (let i = 0; i < d.length; i++) hex += d[i].toString(16).padStart(2, "0");
      return "sha256:" + hex;
    } catch (_) { /* fall through */ }
  }
  return fnv1a(bytes);
}

/* Does this engine let the main thread write an OPFS file? (Safari 26+, Chromium 86+, Firefox 111+.) */
function defaultCanWriteOpfs() {
  try { return typeof FileSystemFileHandle !== "undefined" && typeof FileSystemFileHandle.prototype.createWritable === "function"; }
  catch (_) { return false; }
}
function defaultRoot() {
  try {
    if (typeof navigator === "undefined" || !navigator.storage || !navigator.storage.getDirectory) return Promise.resolve(null);
    return navigator.storage.getDirectory().catch(() => null);
  } catch (_) { return Promise.resolve(null); }
}

/* backends (all optional; defaults are the browser's):
 *   root()        → Promise<FileSystemDirectoryHandle|null>   OPFS root
 *   canWriteOpfs  → boolean | () => boolean                   main-thread createWritable available?
 *   ls            → Storage-like { getItem, setItem, removeItem }
 *   files         → { put(id, bytes), get(id), del(id) }      IndexedDB "files" store (library fallback)
 *   subtle        → SubtleCrypto-like (null = use the FNV fallback)
 *   lsMax         → largest raw file put in localStorage
 *   persist()     → navigator.storage.persist (asked once, when the library first saves a file) */
export function createSessionStore(backends = {}) {
  const root = backends.root || defaultRoot;
  const canWrite = () => { const c = backends.canWriteOpfs; return typeof c === "function" ? !!c() : c === undefined ? defaultCanWriteOpfs() : !!c; };
  const ls = backends.ls !== undefined ? backends.ls : (typeof localStorage !== "undefined" ? localStorage : null);
  const files = backends.files || null;
  const lsMax = backends.lsMax || SESS_LS_MAX;
  const hashOf = (b) => contentHash(b, backends.subtle);
  const lsGet = (k) => { try { return ls ? ls.getItem(k) : null; } catch (_) { return null; } };
  const lsDel = (k) => { try { if (ls) ls.removeItem(k); } catch (_) { /* nothing to do */ } };
  const lsSet = (k, v) => { if (!ls) return false; try { ls.setItem(k, v); return true; } catch (_) { return false; } };

  async function dirFor(sub) {
    const r = await root(); if (!r) return null;
    if (!sub) return r;
    try { return await r.getDirectoryHandle(sub, { create: true }); } catch (_) { return null; }
  }
  // write only where createWritable exists; never leave an empty file behind
  async function opfsWrite(sub, name, bytes) {
    if (!canWrite()) return false;
    const dir = await dirFor(sub); if (!dir) return false;
    try {
      const fh = await dir.getFileHandle(name, { create: true });
      if (typeof fh.createWritable !== "function") { try { await dir.removeEntry(name); } catch (_) { /* absent */ } return false; }
      const w = await fh.createWritable();
      await w.write(bytes); await w.close();
      return true;
    } catch (_) {
      try { await dir.removeEntry(name); } catch (_) { /* absent */ } // a half-written file must not shadow the fallback
      return false;
    }
  }
  async function opfsRead(sub, name) {
    const dir = await dirFor(sub); if (!dir) return null;
    try {
      const f = await (await dir.getFileHandle(name)).getFile();
      if (!f || !f.size) return null;                   // a 0-byte file is "absent" (stray from Safari < 26)
      const u = new Uint8Array(await f.arrayBuffer());
      return u.length ? u : null;
    } catch (_) { return null; }
  }
  async function opfsDel(sub, name) {
    const dir = await dirFor(sub); if (!dir) return;
    try { await dir.removeEntry(name); } catch (_) { /* absent */ }
  }
  const matches = (bytes, want, h) => !want || (bytes.length === want.size && (!want.hash || h === want.hash));

  /* ---- session ----
   * Byte stores, in order: OPFS (quota-free) → IndexedDB "files" under SESS_BIN_IDB (Safari < 26:
   * no createWritable, and IndexedDB doesn't eat the origin-wide localStorage quota the handoffs
   * need) → base64 in localStorage (last resort, small files only). */
  const idbDel = async (k) => { if (files) { try { await files.del(k); } catch (_) { /* absent */ } } };
  async function dropSessionCopies(except) {
    if (except !== "opfs") await opfsDel(null, SESS_BIN_OPFS);
    if (except !== "idb") await idbDel(SESS_BIN_IDB);
    if (except !== "ls") lsDel(SESS_BIN_LS);
  }
  // → { where: "opfs" | "idb" | "ls" | "none", size, hash }. Removes the old metadata first (see header).
  async function saveSessionFile(bytes) {
    if (!isBytes(bytes)) return { where: "none", size: 0, hash: "" };
    lsDel(SESS_META);
    const hash = await hashOf(bytes);
    let where = "none";
    if (await opfsWrite(null, SESS_BIN_OPFS, bytes)) where = "opfs";
    else if (files) { try { await files.put(SESS_BIN_IDB, bytes); where = "idb"; } catch (_) { /* next */ } }
    if (where === "none" && bytes.length <= lsMax && lsSet(SESS_BIN_LS, bytesToB64(bytes))) where = "ls";
    await dropSessionCopies(where);                         // "none": every stale copy goes too
    return { where, size: bytes.length, hash };
  }
  function saveSessionMeta(meta) {
    try { return lsSet(SESS_META, JSON.stringify(meta)); } catch (_) { return false; }
  }
  function readSessionMeta() {
    try { const r = lsGet(SESS_META); const m = r ? JSON.parse(r) : null; return m && typeof m === "object" ? m : null; } catch (_) { return null; }
  }
  /* → { bytes, verified } | null. With want = { size, hash } (from the metadata) only matching bytes
   * are "verified"; non-matching bytes come back verified:false so the caller can open the file
   * WITHOUT its edits. want absent (a session saved before this binding existed) → "legacy". */
  async function readSessionFile(want) {
    const cands = [];
    const o = await opfsRead(null, SESS_BIN_OPFS); if (o) cands.push(o);
    if (files) { try { const v = await files.get(SESS_BIN_IDB); if (v && v.byteLength !== 0) cands.push(v instanceof Uint8Array ? v : new Uint8Array(v)); } catch (_) { /* absent */ } }
    const b = lsGet(SESS_BIN_LS);
    if (b) { try { const u = b64ToBytes(b); if (u.length) cands.push(u); } catch (_) { /* corrupt */ } }
    if (!cands.length) return null;
    if (!want || typeof want.size !== "number") return { bytes: cands[0], verified: "legacy" };
    for (const c of cands) { const h = want.hash ? await hashOf(c) : ""; if (matches(c, want, h)) return { bytes: c, verified: true }; }
    return { bytes: cands[0], verified: false };
  }
  async function clearSession() {
    lsDel(SESS_META); lsDel(RESTORE_INFLIGHT);
    await dropSessionCopies(null);
  }

  /* ---- the restore-in-flight marker (M2.3) ---- */
  const markRestore = (filename) => lsSet(RESTORE_INFLIGHT, JSON.stringify({ filename: String(filename || ""), at: Date.now() }));
  const clearRestoreMark = () => lsDel(RESTORE_INFLIGHT);
  const restoreMark = () => { try { const r = lsGet(RESTORE_INFLIGHT); return r ? JSON.parse(r) : null; } catch (_) { return { filename: "" }; } };

  /* ---- project library files ---- */
  let askedPersist = false;
  async function projectFilePut(id, bytes) {
    if (!isBytes(bytes)) return null;
    let where = null;
    if (await opfsWrite("projects", id + ".bin", bytes)) {
      where = "opfs";
      if (files) { try { await files.del(id); } catch (_) { /* absent */ } }
    } else if (files) {
      try { await files.put(id, bytes); where = "idb"; } catch (_) { where = null; }
      if (where) await opfsDel("projects", id + ".bin");
    }
    if (where && !askedPersist) {                                              // m10: ask the browser to keep the library
      askedPersist = true;
      try {
        const p = backends.persist || (typeof navigator !== "undefined" && navigator.storage && navigator.storage.persist ? () => navigator.storage.persist() : null);
        if (p) await p();
      } catch (_) { /* best effort */ }
    }
    return where;
  }
  // want = { size, hash } from the record (optional): only matching bytes are returned
  async function projectFileGet(id, want) {
    const cands = [];
    const o = await opfsRead("projects", id + ".bin"); if (o) cands.push(o);
    if (files) { try { const v = await files.get(id); if (v && v.byteLength !== 0) { const u = v instanceof Uint8Array ? v : new Uint8Array(v); if (u.length) cands.push(u); } } catch (_) { /* absent */ } }
    if (!want || typeof want.size !== "number") return cands[0] || null;
    for (const c of cands) { const h = want.hash ? await hashOf(c) : ""; if (matches(c, want, h)) return c; }
    return null;
  }
  async function projectFileDel(id) {
    await opfsDel("projects", id + ".bin");
    if (files) { try { await files.del(id); } catch (_) { /* absent */ } }
  }

  /* One-shot cleanup of the zero-length files Safari < 26 left behind (C2). Returns how many went. */
  async function removeEmptyFiles() {
    let n = 0;
    const sweep = async (dir) => {
      if (!dir || typeof dir.entries !== "function") return;
      const empty = [];
      try {
        for await (const [name, h] of dir.entries()) {
          if (!h || h.kind !== "file" || !/\.bin$/.test(name)) continue;
          try { const f = await h.getFile(); if (!f.size) empty.push(name); } catch (_) { /* unreadable */ }
        }
      } catch (_) { return; }
      for (const name of empty) { try { await dir.removeEntry(name); n++; } catch (_) { /* gone */ } }
    };
    await sweep(await dirFor(null));
    await sweep(await dirFor("projects"));
    return n;
  }

  return {
    hashOf, saveSessionFile, saveSessionMeta, readSessionMeta, readSessionFile, clearSession,
    markRestore, clearRestoreMark, restoreMark,
    projectFilePut, projectFileGet, projectFileDel, removeEmptyFiles,
  };
}
