/* ============================================================================
 *  Drum-transcription (ADT) evaluation metrics — dev-only, Node. Not shipped.
 *  Work order WPO-ADT-001 §5. Pure functions over plain arrays, so the same code
 *  scores the E-GMD bench, the rendered-kit bench and unit tests.
 *
 *  Matching follows mir_eval: each reference event may match at most one estimate
 *  within ±window, maximum cardinality. For events on a line with one fixed window a
 *  greedy two-pointer sweep reaches the maximum (cross-checked against
 *  mir_eval.onset.f_measure by scripts/adt_mireval_check.py).
 * ========================================================================== */

/* Classes. 5-class = kick · snare · hihat · tom · cymbal (crash + ride + others),
 * the ADTOF / literature set. 7-class splits cymbal into crash and ride (the work
 * order's enum; "cymbal" then holds china / splash). */
export const CLASSES5 = ["kick", "snare", "hihat", "tom", "cymbal"];
export const CLASSES7 = ["kick", "snare", "hihat", "tom", "crash", "ride", "cymbal"];

/* General-MIDI / Roland TD-17 (E-GMD) note → 7-class. null = out of scope
 * (tambourine, cowbell, … — non-drum percussion, §2). */
export function gmToClass(n) {
  if (n === 35 || n === 36) return "kick";
  if (n === 37 || n === 38 || n === 39 || n === 40) return "snare";
  if (n === 22 || n === 26 || n === 42 || n === 44 || n === 46) return "hihat";
  if ([41, 43, 45, 47, 48, 50, 58].includes(n)) return "tom";
  if (n === 49 || n === 57) return "crash";
  if (n === 51 || n === 59 || n === 53) return "ride";
  if (n === 52 || n === 55) return "cymbal";
  return null;
}
export const to5 = (c) => (c === "crash" || c === "ride" ? "cymbal" : c);

/* Maximum matching of sorted-time events within ±win. Returns [[iRef, iEst], …]. */
export function matchEvents(ref, est, win) {
  const r = ref.map((t, i) => [t, i]).sort((a, b) => a[0] - b[0]);
  const e = est.map((t, i) => [t, i]).sort((a, b) => a[0] - b[0]);
  const out = []; let j = 0;
  for (const [t, i] of r) {
    while (j < e.length && e[j][0] < t - win) j++;
    if (j < e.length && Math.abs(e[j][0] - t) <= win) { out.push([i, e[j][1]]); j++; }
  }
  return out;
}

export function prf(tp, nRef, nEst) {
  const p = nEst ? tp / nEst : (nRef ? 0 : 1), r = nRef ? tp / nRef : 1;
  return { p, r, f: p + r ? (2 * p * r) / (p + r) : 0, tp, nRef, nEst };
}

/* Accumulates counts over tracks (micro-average, how ADT papers sum a test set) and
 * keeps per-track F for a macro view. ref/est events: { t, cls, vel? }. */
export function newTally(classes) {
  const z = () => ({ tp: 0, nRef: 0, nEst: 0 });
  return { classes, cls: Object.fromEntries(classes.map((c) => [c, z()])), all: z(), onset: z(),
    simul: { hit: 0, n: 0 }, vel: { abs: 0, n: 0, within: 0 }, ghost: { n: 0, hit: 0, flagged: 0, falseFlag: 0, nFlag: 0 },
    quant: { ok: 0, n: 0 }, tracks: [] };
}

/* Score one track. opts: { win (0.05), simulWin (0.03), ghostRatio (0.5), mapCls } */
export function scoreTrack(T, ref, est, opts = {}) {
  const win = opts.win ?? 0.05, simulWin = opts.simulWin ?? 0.03, map = opts.mapCls || ((c) => c);
  /* Mapping several GM notes to one class (closed + pedal hat, crash + splash) can leave two
   * same-class events at one instant; a transcriber can only report one. Merge same-class events
   * closer than `mergeWin` (30 ms, the usual practice) in BOTH lists, keeping the louder. */
  const merge = (xs) => {
    const out = [];
    for (const h of xs.slice().sort((a, b) => a.t - b.t)) {
      const prev = [...out].reverse().find((o) => o.cls === h.cls && h.t - o.t <= (opts.mergeWin ?? 0.03));
      if (prev) { if ((h.vel ?? 0) > (prev.vel ?? 0)) prev.vel = h.vel; continue; }
      out.push({ ...h });
    }
    return out;
  };
  const R = merge(ref.map((h) => ({ ...h, cls: map(h.cls) })).filter((h) => T.classes.includes(h.cls)));
  const E = merge(est.map((h) => ({ ...h, cls: map(h.cls) })).filter((h) => T.classes.includes(h.cls)));
  const track = { cls: {}, ...(opts.keep ? { R: R.map((h) => [h.t, h.cls]), E: E.map((h) => [h.t, h.cls]) } : {}) };
  const matchedRef = new Map(); // ref index → est event (class-aware)
  for (const c of T.classes) {
    const ri = R.map((h, i) => [h, i]).filter(([h]) => h.cls === c), ei = E.filter((h) => h.cls === c);
    const m = matchEvents(ri.map(([h]) => h.t), ei.map((h) => h.t), win);
    for (const [a, b] of m) matchedRef.set(ri[a][1], ei[b]);
    const s = T.cls[c]; s.tp += m.length; s.nRef += ri.length; s.nEst += ei.length;
    track.cls[c] = prf(m.length, ri.length, ei.length);
  }
  T.all.tp += matchedRef.size; T.all.nRef += R.length; T.all.nEst += E.length;
  track.all = prf(matchedRef.size, R.length, E.length);
  // onset-only: class-agnostic, unique onsets (a kick+hat chord is one onset)
  const uniq = (xs) => { const s = xs.map((h) => h.t).sort((a, b) => a - b), o = []; for (const t of s) if (!o.length || t - o[o.length - 1] > 0.02) o.push(t); return o; };
  const ur = uniq(R), ue = uniq(E), mo = matchEvents(ur, ue, win);
  T.onset.tp += mo.length; T.onset.nRef += ur.length; T.onset.nEst += ue.length;
  track.onset = prf(mo.length, ur.length, ue.length);
  // simultaneous onsets: a ref hit with a ref hit of ANOTHER class within simulWin
  R.forEach((h, i) => {
    if (!R.some((o) => o !== h && o.cls !== h.cls && Math.abs(o.t - h.t) <= simulWin)) return;
    T.simul.n++; if (matchedRef.has(i)) T.simul.hit++;
  });
  // velocity: per-track least-squares est.vel → ref.vel over matched hits, then MAE in MIDI units
  const pairs = [...matchedRef.entries()].filter(([i, e]) => R[i].vel != null && e.vel != null).map(([i, e]) => [e.vel, R[i].vel]);
  if (pairs.length >= 3) {
    const n = pairs.length, mx = pairs.reduce((a, p) => a + p[0], 0) / n, my = pairs.reduce((a, p) => a + p[1], 0) / n;
    let sxy = 0, sxx = 0; for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) * (x - mx); }
    const a = sxx > 1e-9 ? sxy / sxx : 0, b = my - a * mx;
    const rmin = Math.min(...R.filter((h) => h.vel != null).map((h) => h.vel)), rmax = Math.max(...R.filter((h) => h.vel != null).map((h) => h.vel));
    let mae = 0;
    for (const [x, y] of pairs) {
      const yhat = Math.max(1, Math.min(127, a * x + b)), err = Math.abs(yhat - y);
      T.vel.abs += err; T.vel.n++; mae += err;
      if (rmax > rmin && err / (rmax - rmin) <= 0.1) T.vel.within++;
    }
    track.velMAE = mae / n;
  }
  // ghost notes: ref snares below ghostRatio × the track's median snare velocity
  const sn = R.map((h, i) => [h, i]).filter(([h]) => h.cls === "snare" && h.vel != null);
  if (sn.length) {
    const med = sn.map(([h]) => h.vel).sort((a, b) => a - b)[sn.length >> 1], thr = (opts.ghostRatio ?? 0.5) * med;
    for (const [h, i] of sn) {
      const e = matchedRef.get(i);
      if (h.vel < thr) { T.ghost.n++; if (e) { T.ghost.hit++; if (e.is_ghost) T.ghost.flagged++; } }
      else if (e && e.is_ghost) T.ghost.falseFlag++;
    }
    T.ghost.nFlag += E.filter((e) => e.cls === "snare" && e.is_ghost).length;
  }
  // quantisation: matched est slot (est grid) vs ref slot on the ref grid, ±1 slot
  if (opts.refSlot) for (const [i, e] of matchedRef) {
    if (e.slotAbs == null) continue;
    const rs = opts.refSlot(R[i].t); if (rs == null) continue;
    T.quant.n++; if (Math.abs(e.slotAbs - rs) <= 1) T.quant.ok++;
  }
  T.tracks.push(track);
  return track;
}

export function summary(T) {
  const out = { overall: prf(T.all.tp, T.all.nRef, T.all.nEst), onset: prf(T.onset.tp, T.onset.nRef, T.onset.nEst), cls: {} };
  for (const c of T.classes) out.cls[c] = prf(T.cls[c].tp, T.cls[c].nRef, T.cls[c].nEst);
  out.simulRecall = T.simul.n ? T.simul.hit / T.simul.n : null; out.simulN = T.simul.n;
  out.velMAE = T.vel.n ? T.vel.abs / T.vel.n : null; out.velWithin = T.vel.n ? T.vel.within / T.vel.n : null;
  out.ghostRecall = T.ghost.n ? T.ghost.hit / T.ghost.n : null; out.ghostFlagRecall = T.ghost.n ? T.ghost.flagged / T.ghost.n : null; out.ghostN = T.ghost.n;
  out.ghostFlagPrecision = T.ghost.nFlag ? T.ghost.flagged / T.ghost.nFlag : null;
  out.quant = T.quant.n ? T.quant.ok / T.quant.n : null;
  return out;
}

/* mir_eval.beat.f_measure equivalent: both sequences drop the first 5 s, ±70 ms. */
export function beatF(ref, est, win = 0.07, skip = 5) {
  const r = ref.filter((t) => t >= skip), e = est.filter((t) => t >= skip);
  if (!r.length || !e.length) return 0;
  const m = matchEvents(r, e, win).length; return prf(m, r.length, e.length).f;
}

/* 16-bit / 24-bit / float PCM WAV → mono Float32Array. */
export function readWav(buf) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 12, fmt = null, data = null;
  while (o + 8 <= buf.length) {
    const id = String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3]), sz = v.getUint32(o + 4, true);
    if (id === "fmt ") fmt = { tag: v.getUint16(o + 8, true), ch: v.getUint16(o + 10, true), sr: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
    else if (id === "data") data = [o + 8, sz];
    o += 8 + sz + (sz & 1);
  }
  const { ch, sr, bits, tag } = fmt, bps = bits >> 3, n = Math.floor(data[1] / (bps * ch)), x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < ch; c++) {
      const p = data[0] + (i * ch + c) * bps;
      s += tag === 3 ? v.getFloat32(p, true) : bits === 16 ? v.getInt16(p, true) / 32768 : bits === 24 ? ((v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16)) / 8388608) : v.getInt32(p, true) / 2147483648;
    }
    x[i] = s / ch;
  }
  return { x, sr };
}
