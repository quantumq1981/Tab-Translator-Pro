/* @audio/neural-separate@0.7.0 (+ @audio/neural-runtime@0.2.0, @audio/resample-sinc@1.3.0, fourier-transform@2.5.1)
 * — all MIT — bundled by esbuild for the browser; onnxruntime-web@1.30.0 imported from jsDelivr.
 * Vendored VERBATIM (bundled, not modified). See vendor/NOTICE-neural-separate.txt. */
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// node_modules/@audio/neural-separate/roformer.js
var roformer_exports = {};
__export(roformer_exports, {
  default: () => roformer,
  engine: () => engine,
  gpu: () => gpu
});
async function gpu() {
  let adapter = await globalThis.navigator?.gpu?.requestAdapter({ powerPreference: "high-performance" }).catch(() => null);
  if (!adapter || adapter.info?.isFallbackAdapter || !["subgroups", "chromium-experimental-subgroup-matrix"].every((f) => adapter.features.has(f))) return null;
  let cfg = [...adapter.info.subgroupMatrixConfigs ?? []];
  if (!cfg.some((c) => c.componentType === "f32" && c.M === 8 && c.N === 8 && c.K === 8)) return null;
  return adapter.requestDevice({
    requiredFeatures: ["subgroups", "chromium-experimental-subgroup-matrix"],
    requiredLimits: { maxComputeWorkgroupStorageSize: 32768, maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize, maxBufferSize: adapter.limits.maxBufferSize }
  }).catch(() => null);
}
async function engine(meta, bytes, device) {
  device ?? (device = await gpu());
  if (!device) return null;
  let rf = await roformer(device, meta, bytes), { freqs: F, frames: T } = meta;
  return {
    inputs: [{ name: "mix_spec", dims: [1, 4, F, T], type: "float32" }],
    outputs: [{ name: "stems_spec", dims: [1, 4, F, T], type: "float32" }],
    backend: "roformer",
    async run(feeds) {
      return { stems_spec: { data: await rf.run(feeds.mix_spec.data), dims: [1, 4, F, T], type: "float32" } };
    },
    free() {
      device.destroy();
    }
  };
}
async function roformer(device, meta, bytes) {
  const { frames: T, freqs: F, channels: S, dim: D, heads: H, depth, bands: B, groups } = meta;
  const DH = 64, FF = 1536, MH = 1536, Tp = Math.ceil(T / TILE) * TILE, QKV = 3 * H * DH, QKVG = Math.ceil((QKV + H) / TILE) * TILE;
  const COLS = F * S * 2, LT = Math.ceil(T / 16) * 16, LF = Math.ceil(B / 16) * 16;
  const pad16 = (w) => Math.ceil(w / 16) * 16;
  const G = groups.map(([b0, b1, W2]) => ({ b0, b1, n: b1 - b0, W: W2, Wp: pad16(W2) }));
  const view = (n) => {
    const t = meta.tensors[n], len = t.shape.reduce((a, b) => a * b, 1);
    return t.type === "float16" ? new Float16Array(bytes.buffer, bytes.byteOffset + t.offset, len) : t.type === "int32" ? new Int32Array(bytes.buffer, bytes.byteOffset + t.offset, len) : new Float32Array(bytes.buffer, bytes.byteOffset + t.offset, len);
  };
  const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  const buf = (n, type = "f32") => device.createBuffer({ size: Math.max(16, n * 4), usage });
  const upload = (data) => {
    const b = device.createBuffer({ size: Math.max(16, data.byteLength), usage, mappedAtCreation: true });
    new data.constructor(b.getMappedRange()).set(data);
    b.unmap();
    return b;
  };
  const f32 = (a) => a instanceof Float32Array ? a : Float32Array.from(a);
  const padded = (a, batch, K, N, Kp, Np, place = (k, n) => k * Np + n) => {
    const o = new Float32Array(batch * Kp * Np);
    for (let b = 0; b < batch; b++) for (let k = 0; k < K; k++) for (let n = 0; n < N; n++) o[b * Kp * Np + place(k, n)] = a[(b * K + k) * N + n];
    return o;
  };
  const W = { split: [], splitB: [], splitIdx: [], m2: [], m2B: [] };
  for (const [g, gr] of G.entries()) {
    W.split.push(upload(padded(view(`split_w.${g}`), gr.n, gr.W, D, gr.Wp, D)));
    W.splitB.push(upload(f32(view(`split_b.${g}`))));
    const idx = view(`si${g}`), pi = new Int32Array(gr.n * gr.Wp).fill(COLS);
    for (let j = 0; j < gr.n; j++) for (let e = 0; e < gr.W; e++) pi[j * gr.Wp + e] = idx[j * gr.W + e];
    W.splitIdx.push(upload(pi));
    const w = view(`m2_w.${g}`), b = view(`m2_b.${g}`), Wp = gr.Wp, wo = new Float32Array(gr.n * MH * 2 * Wp), bo = new Float32Array(gr.n * 2 * Wp);
    for (let j = 0; j < gr.n; j++) {
      for (let k = 0; k < MH; k++) for (let e = 0; e < gr.W; e++) {
        wo[(j * MH + k) * 2 * Wp + e] = w[(j * MH + k) * 2 * gr.W + e];
        wo[(j * MH + k) * 2 * Wp + Wp + e] = w[(j * MH + k) * 2 * gr.W + gr.W + e];
      }
      for (let e = 0; e < gr.W; e++) {
        bo[j * 2 * Wp + e] = b[j * 2 * gr.W + e];
        bo[j * 2 * Wp + Wp + e] = b[j * 2 * gr.W + gr.W + e];
      }
    }
    W.m2.push(upload(wo));
    W.m2B.push(upload(bo));
  }
  W.mw = [0, 1].map((i) => upload(f32(view(`mw.${i}`))));
  W.mb = [0, 1].map((i) => upload(f32(view(`mb.${i}`))));
  W.blocks = [];
  for (let d = 0; d < depth; d++) for (let k = 0; k < 2; k++) {
    const p = `blocks.${d}.${k}.`, a = p + "layers.0.0.", f = p + "layers.0.1.";
    W.blocks.push({
      out: upload(f32(view(p + "out"))),
      qkvg: upload(padded(view(a + "qkvg"), 1, D, QKV + H, D, QKVG)),
      gb: upload(f32(view(a + "gb"))),
      wo: upload(f32(view(a + "wo"))),
      w1: upload(f32(view(f + "w1"))),
      b1: upload(f32(view(f + "b1"))),
      w2: upload(f32(view(f + "w2"))),
      b2: upload(f32(view(f + "b2")))
    });
  }
  const rope = (k) => {
    const c = view(`blocks.0.${k}.layers.0.0.cos`), s = view(`blocks.0.${k}.layers.0.0.sin`);
    return [upload(f32(c)), upload(f32(s))];
  };
  const [cosT, sinT] = rope(0), [cosF, sinF] = rope(1);
  const i1 = view("i1"), i2 = view("i2"), wt = view("wt"), gofs = [], cols = [];
  let mOff = 0, cOff = 0;
  for (const gr of G) {
    gofs.push(mOff);
    cols.push(cOff);
    mOff += gr.n * Tp * gr.Wp;
    cOff += gr.n * gr.W;
  }
  const src = (c) => {
    if (c >= cOff) return [0, 0, 0];
    let g = cols.findLastIndex((o) => o <= c), gr = G[g], r = c - cols[g], j = Math.floor(r / gr.W), e = r % gr.W;
    return [gofs[g] + j * Tp * gr.Wp + e, gr.Wp, 1];
  };
  const map = new Uint32Array(COLS * 8);
  for (let o = 0; o < COLS; o++) map.set([...src(i1[o]), ...src(i2[o])], o * 8);
  const maskMap = upload(map);
  const maskWt = upload(Float32Array.from({ length: COLS }, (_, o) => wt[o]));
  const E = buf(Tp * (COLS + 1)), X = buf(B * Tp * D), XN = buf(B * Tp * D), Y = buf(B * Tp * QKVG);
  const att = Math.max(B * H * LT, T * H * LF) * DH;
  const Qb = buf(att), Kb = buf(att), Vb = buf(att), Ob = buf(att), Gt = buf(B * Tp * H), Z = buf(B * Tp * H * DH);
  const FFH = buf(B * Tp * FF), H2 = buf(B * Tp * MH), Mg = buf(mOff), OUT = buf(4 * F * T);
  const splitA = G.map((gr) => buf(gr.n * Tp * gr.Wp)), glu = G.map((gr) => buf(gr.n * Tp * 2 * gr.Wp)), scratch = buf(4);
  const pipes = /* @__PURE__ */ new Map();
  const pipe = (key, code) => pipes.get(key) ?? pipes.set(key, device.createComputePipeline({ layout: "auto", compute: { module: device.createShaderModule({ code }), entryPoint: "main" } })).get(key);
  const uni = (...v) => {
    const b = device.createBuffer({ size: Math.ceil(v.length / 4) * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(b, 0, new Uint32Array(v.map((x) => typeof x === "number" && !Number.isInteger(x) ? new Uint32Array(new Float32Array([x]).buffer)[0] : x)));
    return b;
  };
  const steps = [];
  const step = (p, bindings, grid) => steps.push([p, device.createBindGroup({ layout: p.getBindGroupLayout(0), entries: bindings.map((b, i) => ({ binding: i, resource: { buffer: b } })) }), grid]);
  const HEAD = `enable subgroups;
enable chromium_experimental_subgroup_matrix;
`;
  const MM = (ep) => pipe("mm" + ep, HEAD + `
@group(0) @binding(0) var<storage, read> A: array<f32>;
@group(0) @binding(1) var<storage, read> Bm: array<f32>;
@group(0) @binding(2) var<storage, read_write> C: array<f32>;
@group(0) @binding(3) var<storage, read> bias: array<f32>;
struct P { M: u32, N: u32, K: u32, a0: u32, sa: u32, b0: u32, sb: u32, c0: u32, sc: u32, ldc: u32, bias0: u32, sbias: u32 }
@group(0) @binding(4) var<uniform> p: P;
var<workgroup> tile: array<f32, 1024>;
@compute @workgroup_size(32)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(subgroup_invocation_id) lane: u32) {
  _ = bias[0];   // bound whether read or not: the layout is the module's own
  let r0 = wg.y * 32u; let n0 = wg.x * 32u; let b = wg.z;
  let ab = p.a0 + b * p.sa + r0 * p.K; let bb = p.b0 + b * p.sb + n0;
  ${[0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => `var c${i}${j}: subgroup_matrix_result<f32, 8, 8>;`).join(" ")).join("\n  ")}
  for (var k = 0u; k < p.K; k += 8u) {
    ${[0, 1, 2, 3].map((i) => `let a${i} = subgroupMatrixLoad<subgroup_matrix_left<f32, 8, 8>>(&A, ab + ${i * 8}u * p.K + k, false, p.K);`).join("\n    ")}
    ${[0, 1, 2, 3].map((j) => `let b${j} = subgroupMatrixLoad<subgroup_matrix_right<f32, 8, 8>>(&Bm, bb + k * p.N + ${j * 8}u, false, p.N);`).join("\n    ")}
    ${[0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => `c${i}${j} = subgroupMatrixMultiplyAccumulate(a${i}, b${j}, c${i}${j});`).join(" ")).join("\n    ")}
  }
  ${[0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => `subgroupMatrixStore(&tile, ${i * 8 * 32 + j * 8}u, c${i}${j}, false, 32u);`).join(" ")).join("\n  ")}
  workgroupBarrier();
  for (var e = lane; e < 1024u; e += 32u) {
    let r = r0 + e / 32u; let n = n0 + e % 32u;
    if (r < p.M && n < p.N) {
      var v = tile[e];
      ${ep.includes("b") ? "v += bias[p.bias0 + b * p.sbias + n];" : ""}
      ${ep.includes("g") ? "v = 0.5 * v * (1.0 + erf_(v * 0.7071067811865476));" : ep.includes("t") ? "v = tanh(v);" : ""}
      let o = p.c0 + b * p.sc + r * p.ldc + n;
      ${ep.includes("r") ? "C[o] += v;" : "C[o] = v;"}
    }
  }
}
fn erf_(x: f32) -> f32 {   // Abramowitz & Stegun 7.1.26 is 1.5e-7; GELU's own float32 erf is as close
  let t = 1.0 / (1.0 + 0.3275911 * abs(x));
  let y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x);
  return select(-y, y, x >= 0.0);
}`);
  const mm = (ep, A, Bm, C, bias, { M, N, K, batch = 1, a0 = 0, sa = 0, b0 = 0, sb = 0, c0 = 0, sc = 0, ldc = N, bias0 = 0, sbias = 0 }) => step(MM(ep), [A, Bm, C, bias ?? maskWt, uni(M, N, K, a0, sa, b0, sb, c0, sc, ldc, bias0, sbias)], [N / 32, M / 32, batch]);
  const NORM = (scaled) => pipe("norm" + scaled, HEAD + `
@group(0) @binding(0) var<storage, read_write> x: array<f32>;
@group(0) @binding(1) var<storage, read_write> y: array<f32>;
@group(0) @binding(2) var<storage, read> g: array<f32>;
struct P { rows: u32, n: u32 }
@group(0) @binding(3) var<uniform> p: P;
@compute @workgroup_size(32)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(subgroup_invocation_id) lane: u32) {
  _ = g[0]; _ = y[0];
  let r = wg.x + wg.y * 65535u;
  if (r >= p.rows) { return; }
  var s = 0.0;
  for (var i = lane; i < p.n; i += 32u) { let v = x[r * p.n + i]; s += v * v; }
  let k = 1.0 / max(sqrt(subgroupAdd(s)), 1e-12);
  for (var i = lane; i < p.n; i += 32u) { ${scaled ? "x[r * p.n + i] = x[r * p.n + i] * k * g[i];" : "y[r * p.n + i] = x[r * p.n + i] * k;"} }
}`);
  const grid1 = (n) => [Math.min(n, 65535), Math.ceil(n / 65535), 1];
  const norm = (x, y, rows2, n, g) => step(NORM(!!g), [x, g ? scratch : y, g ?? maskWt, uni(rows2, n)], grid1(rows2));
  const SPLIT = pipe("split", HEAD + `
@group(0) @binding(0) var<storage, read> E: array<f32>;
@group(0) @binding(1) var<storage, read> idx: array<i32>;
@group(0) @binding(2) var<storage, read_write> A: array<f32>;
struct P { Wp: u32, Tp: u32, T: u32, cols: u32 }
@group(0) @binding(3) var<uniform> p: P;
@compute @workgroup_size(32)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(subgroup_invocation_id) lane: u32) {
  let t = wg.x; let j = wg.y;
  var s = 0.0;
  for (var e = lane; e < p.Wp; e += 32u) { let v = select(0.0, E[t * (p.cols + 1u) + u32(idx[j * p.Wp + e])], t < p.T); s += v * v; }
  let k = 1.0 / max(sqrt(subgroupAdd(s)), 1e-12);
  for (var e = lane; e < p.Wp; e += 32u) {
    let v = select(0.0, E[t * (p.cols + 1u) + u32(idx[j * p.Wp + e])], t < p.T);
    A[(j * p.Tp + t) * p.Wp + e] = v * k;
  }
}`);
  const ROPE = pipe("rope", HEAD + `
@group(0) @binding(0) var<storage, read> Yq: array<f32>;
@group(0) @binding(1) var<storage, read_write> Q: array<f32>;
@group(0) @binding(2) var<storage, read_write> K: array<f32>;
@group(0) @binding(3) var<storage, read_write> V: array<f32>;
@group(0) @binding(4) var<storage, read_write> Gt: array<f32>;
@group(0) @binding(5) var<storage, read> cs: array<f32>;
@group(0) @binding(6) var<storage, read> sn: array<f32>;
@group(0) @binding(7) var<storage, read> gb: array<f32>;
struct P { time: u32, Tp: u32, T: u32, L: u32, ld: u32 }
@group(0) @binding(8) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) li: vec3u) {
  let t = wg.x; let band = wg.y; let h = wg.z; let d = li.x;
  if (t >= p.T) { return; }
  let r = band * p.Tp + t;
  var seq = band; var pos = t;
  if (p.time == 0u) { seq = t; pos = band; }
  let o = ((seq * ${H}u + h) * p.L + pos) * 64u + d;
  let y = r * p.ld + h * 64u;
  let rot = select(Yq[y + d - 32u], -Yq[y + d + 32u], d < 32u);
  let rk = select(Yq[y + ${H * DH}u + d - 32u], -Yq[y + ${H * DH}u + d + 32u], d < 32u);
  Q[o] = Yq[y + d] * cs[pos * 64u + d] + rot * sn[pos * 64u + d];
  K[o] = Yq[y + ${H * DH}u + d] * cs[pos * 64u + d] + rk * sn[pos * 64u + d];
  V[o] = Yq[y + ${2 * H * DH}u + d];
  if (d == 0u) { Gt[r * ${H}u + h] = 1.0 / (1.0 + exp(-(Yq[r * p.ld + ${QKV}u + h] + gb[h]))); }
}`);
  const MERGE = pipe("merge", HEAD + `
@group(0) @binding(0) var<storage, read> O: array<f32>;
@group(0) @binding(1) var<storage, read> Gt: array<f32>;
@group(0) @binding(2) var<storage, read_write> Zb: array<f32>;
struct P { time: u32, Tp: u32, T: u32, L: u32 }
@group(0) @binding(3) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_id) li: vec3u) {
  let t = wg.x; let band = wg.y; let h = wg.z; let d = li.x;
  let r = band * p.Tp + t;
  if (t >= p.T) { Zb[r * ${H * DH}u + h * 64u + d] = 0.0; return; }
  var seq = band; var pos = t;
  if (p.time == 0u) { seq = t; pos = band; }
  Zb[r * ${H * DH}u + h * 64u + d] = O[((seq * ${H}u + h) * p.L + pos) * 64u + d] * Gt[r * ${H}u + h];
}`);
  const BR = 16, BC = 32, SG = 4, I2 = [0, 1], J4 = [0, 1, 2, 3], D8 = [...Array(8).keys()];
  const scores = `${I2.map((i) => J4.map((j) => `var s${i}_${j}: subgroup_matrix_result<f32, 8, 8>;`).join(" ")).join("\n    ")}
    for (var k = 0u; k < 8u; k++) {
      ${I2.map((i) => `let q${i} = subgroupMatrixLoad<subgroup_matrix_left<f32, 8, 8>>(&Q, base + (r0 + ${i * 8}u) * 64u + k * 8u, false, 64u);`).join("\n      ")}
      ${J4.map((j) => `let k${j} = subgroupMatrixLoad<subgroup_matrix_right<f32, 8, 8>>(&K, base + (c0 + ${j * 8}u) * 64u + k * 8u, true, 64u);`).join("\n      ")}
      ${I2.map((i) => J4.map((j) => `s${i}_${j} = subgroupMatrixMultiplyAccumulate(q${i}, k${j}, s${i}_${j});`).join(" ")).join("\n      ")}
    }
    ${I2.map((i) => J4.map((j) => `subgroupMatrixStore(&S[sg], ${i * 8 * BC + j * 8}u, s${i}_${j}, false, ${BC}u);`).join(" ")).join("\n    ")}
    workgroupBarrier();`;
  const ATT = pipe("att", HEAD + `
@group(0) @binding(0) var<storage, read> Q: array<f32>;
@group(0) @binding(1) var<storage, read> K: array<f32>;
@group(0) @binding(2) var<storage, read> V: array<f32>;
@group(0) @binding(3) var<storage, read_write> O: array<f32>;
struct P { n: u32, np: u32 }
@group(0) @binding(4) var<uniform> p: P;
var<workgroup> S: array<array<f32, ${BR * BC}>, ${SG}>;
var<workgroup> Ow: array<array<f32, ${BR * 64}>, ${SG}>;
@compute @workgroup_size(${32 * SG})
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(subgroup_id) sg: u32, @builtin(subgroup_invocation_id) lane: u32) {
  let b = wg.y;
  let r0 = (wg.x * ${SG}u + sg) * ${BR}u;
  let base = b * p.np * 64u;
  let row = lane / 2u; let half = (lane % 2u) * ${BC / 2}u;    // two lanes a row, 16 columns each
  var mx = -1e30;
  for (var c0 = 0u; c0 < p.n; c0 += ${BC}u) {
    ${scores}
    for (var j = 0u; j < ${BC / 2}u; j++) { if (c0 + half + j < p.n) { mx = max(mx, S[sg][row * ${BC}u + half + j]); } }
    workgroupBarrier();
  }
  mx = max(mx, subgroupShuffleXor(mx, 1u));
  var l = 0.0;
  ${I2.map((i) => D8.map((t) => `var o${i}_${t}: subgroup_matrix_result<f32, 8, 8>;`).join(" ")).join("\n  ")}
  for (var c0 = 0u; c0 < p.n; c0 += ${BC}u) {
    ${scores}
    for (var j = 0u; j < ${BC / 2}u; j++) {
      let at = row * ${BC}u + half + j;
      let e = select(0.0, exp(S[sg][at] - mx), c0 + half + j < p.n);
      S[sg][at] = e; l += e;
    }
    workgroupBarrier();
    ${I2.map((i) => J4.map((j) => `let p${i}_${j} = subgroupMatrixLoad<subgroup_matrix_left<f32, 8, 8>>(&S[sg], ${i * 8 * BC + j * 8}u, false, ${BC}u);`).join(" ")).join("\n    ")}
    ${D8.map((t) => J4.map((j) => `let v${j}_${t} = subgroupMatrixLoad<subgroup_matrix_right<f32, 8, 8>>(&V, base + (c0 + ${j * 8}u) * 64u + ${t * 8}u, false, 64u);`).join(" ") + "\n    " + I2.map((i) => J4.map((j) => `o${i}_${t} = subgroupMatrixMultiplyAccumulate(p${i}_${j}, v${j}_${t}, o${i}_${t});`).join(" ")).join(" ")).join("\n    ")}
    workgroupBarrier();
  }
  l += subgroupShuffleXor(l, 1u);
  ${I2.map((i) => D8.map((t) => `subgroupMatrixStore(&Ow[sg], ${i * 8 * 64 + t * 8}u, o${i}_${t}, false, 64u);`).join(" ")).join("\n  ")}
  workgroupBarrier();
  // lane pairs hold their row's sum; each lane writes half its row
  for (var d = 0u; d < 32u; d++) {
    let r = r0 + row;
    if (r < p.n) { O[base + r * 64u + half * 2u + d] = Ow[sg][row * 64u + half * 2u + d] / l; }
  }
}`);
  const GLU = pipe("glu", HEAD + `
@group(0) @binding(0) var<storage, read> Yg: array<f32>;
@group(0) @binding(1) var<storage, read_write> Mo: array<f32>;
struct P { rows: u32, Wp: u32, at: u32 }
@group(0) @binding(2) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gi: vec3u) {
  let i = gi.x + gi.y * 65535u * 64u;
  if (i >= p.rows * p.Wp) { return; }
  let r = i / p.Wp; let e = i % p.Wp;
  Mo[p.at + i] = Yg[r * 2u * p.Wp + e] / (1.0 + exp(-Yg[r * 2u * p.Wp + p.Wp + e]));
}`);
  const MASK = pipe("mask", HEAD + `
@group(0) @binding(0) var<storage, read> Mo: array<f32>;
@group(0) @binding(1) var<storage, read> map: array<u32>;
@group(0) @binding(2) var<storage, read> wt: array<f32>;
@group(0) @binding(3) var<storage, read> E: array<f32>;
@group(0) @binding(4) var<storage, read_write> Out: array<f32>;
struct P { T: u32, F: u32, cols: u32 }
@group(0) @binding(5) var<uniform> p: P;
fn mask(t: u32, o: u32) -> f32 {
  let a = map[o * 8u]; let sa = map[o * 8u + 1u]; let on1 = map[o * 8u + 2u];
  let b = map[o * 8u + 3u]; let sb = map[o * 8u + 4u]; let on2 = map[o * 8u + 5u];
  var v = 0.0;
  if (on1 == 1u) { v += Mo[a + t * sa]; }
  if (on2 == 1u) { v += Mo[b + t * sb]; }
  return v * wt[o];
}
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gi: vec3u) {
  let t = gi.x; let fs = gi.y;          // fs = f\xB7S + s
  if (t >= p.T) { return; }
  let f = fs / ${S}u; let s = fs % ${S}u;
  let o = fs * 2u;
  let er = E[t * (p.cols + 1u) + o]; let ei = E[t * (p.cols + 1u) + o + 1u];
  let mr = mask(t, o); let mi = mask(t, o + 1u);
  Out[((s * 2u) * p.F + f) * p.T + t] = er * mr - ei * mi;
  Out[((s * 2u + 1u) * p.F + f) * p.T + t] = er * mi + ei * mr;
}`);
  for (const [g, gr] of G.entries()) {
    step(SPLIT, [E, W.splitIdx[g], splitA[g], uni(gr.Wp, Tp, T, COLS)], [Tp, gr.n, 1]);
    mm("b", splitA[g], W.split[g], X, W.splitB[g], { M: Tp, N: D, K: gr.Wp, batch: gr.n, sa: Tp * gr.Wp, sb: gr.Wp * D, c0: gr.b0 * Tp * D, sc: Tp * D, sbias: D });
  }
  for (const [i, w] of W.blocks.entries()) {
    const time = i % 2 === 0, L = time ? LT : LF, n = time ? T : B, seqs = time ? B : T;
    norm(X, XN, B * Tp, D);
    mm("", XN, w.qkvg, Y, null, { M: B * Tp, N: QKVG, K: D });
    step(ROPE, [Y, Qb, Kb, Vb, Gt, time ? cosT : cosF, time ? sinT : sinF, w.gb, uni(time ? 1 : 0, Tp, T, L, QKVG)], [Tp, B, H]);
    step(ATT, [Qb, Kb, Vb, Ob, uni(n, L)], [Math.ceil(L / (BR * SG)), seqs * H, 1]);
    step(MERGE, [Ob, Gt, Z, uni(time ? 1 : 0, Tp, T, L)], [Tp, B, H]);
    mm("r", Z, w.wo, X, null, { M: B * Tp, N: D, K: H * DH });
    norm(X, XN, B * Tp, D);
    mm("bg", XN, w.w1, FFH, w.b1, { M: B * Tp, N: FF, K: D });
    mm("br", FFH, w.w2, X, w.b2, { M: B * Tp, N: D, K: FF });
    norm(X, X, B * Tp, D, w.out);
  }
  mm("bt", X, W.mw[0], FFH, W.mb[0], { M: Tp, N: MH, K: D, batch: B, sa: Tp * D, sb: D * MH, sc: Tp * MH, sbias: MH });
  mm("bt", FFH, W.mw[1], H2, W.mb[1], { M: Tp, N: MH, K: MH, batch: B, sa: Tp * MH, sb: MH * MH, sc: Tp * MH, sbias: MH });
  for (const [g, gr] of G.entries()) {
    mm("b", H2, W.m2[g], glu[g], W.m2B[g], { M: Tp, N: 2 * gr.Wp, K: MH, batch: gr.n, a0: gr.b0 * Tp * MH, sa: Tp * MH, sb: MH * 2 * gr.Wp, sc: Tp * 2 * gr.Wp, sbias: 2 * gr.Wp });
    const n = gr.n * Tp * gr.Wp;
    step(GLU, [glu[g], Mg, uni(gr.n * Tp, gr.Wp, gofs[g])], [Math.min(Math.ceil(n / 64), 65535), Math.ceil(n / 64 / 65535), 1]);
  }
  step(MASK, [Mg, maskMap, maskWt, E, OUT, uni(T, F, COLS)], [Math.ceil(T / 64), F * S, 1]);
  const zero = device.createCommandEncoder();
  for (const b of [Qb, Kb, Vb]) zero.clearBuffer(b);
  device.queue.submit([zero.finish()]);
  const stage = new Float32Array(Tp * (COLS + 1)), read = device.createBuffer({ size: 4 * F * T * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  return {
    steps: steps.length,
    async run(spec) {
      stage.fill(0);
      for (let s = 0; s < S; s++) for (let c = 0; c < 2; c++) for (let f = 0; f < F; f++) {
        const plane = ((s * 2 + c) * F + f) * T, col = (f * S + s) * 2 + c;
        for (let t = 0; t < T; t++) stage[t * (COLS + 1) + col] = spec[plane + t];
      }
      device.queue.writeBuffer(E, 0, stage);
      const e = device.createCommandEncoder(), pass = e.beginComputePass();
      for (const [p, bg, grid] of steps) {
        pass.setPipeline(p);
        pass.setBindGroup(0, bg);
        pass.dispatchWorkgroups(...grid);
      }
      pass.end();
      e.copyBufferToBuffer(OUT, 0, read, 0, 4 * F * T * 4);
      device.queue.submit([e.finish()]);
      await read.mapAsync(GPUMapMode.READ);
      const out = new Float32Array(read.getMappedRange().slice(0));
      read.unmap();
      return out;
    }
  };
}
var TILE;
var init_roformer = __esm({
  "node_modules/@audio/neural-separate/roformer.js"() {
    TILE = 32;
  }
});

// node_modules/fourier-transform/index.js
var TWO_PI = 6.283185307179586;
var cache = /* @__PURE__ */ new Map();
var lastN = 0;
var lastEntry = null;
function init(N) {
  const half = N >>> 1;
  const x = new Float64Array(N);
  const spectrum = new Float64Array(half);
  const im = new Float64Array(half + 1);
  const re = x.subarray(0, half + 1);
  const complex = [re, im];
  const bSi = 2 / N;
  const bits = 31 - Math.clz32(N);
  const perm = new Uint32Array(N);
  for (let i = 0; i < N; i++) {
    let rev = 0, v = i;
    for (let j = 0; j < bits; j++) {
      rev = rev << 1 | v & 1;
      v >>= 1;
    }
    perm[i] = rev;
  }
  let total = 0, n2 = 2, nn = half;
  const stages = [];
  while (nn = nn >>> 1) {
    n2 = n2 << 1;
    const n8 = n2 >>> 3;
    const count = n8 > 1 ? n8 - 1 : 0;
    stages.push({ offset: total, count });
    total += count;
  }
  const tw = new Float64Array(total << 2);
  n2 = 2;
  nn = half;
  let si = 0;
  while (nn = nn >>> 1) {
    n2 = n2 << 1;
    const n8 = n2 >>> 3;
    const e = TWO_PI / n2;
    const off = stages[si].offset << 2;
    for (let j = 1; j < n8; j++) {
      const a = j * e;
      const s = Math.sin(a), c = Math.cos(a);
      const idx = off + (j - 1 << 2);
      tw[idx] = c;
      tw[idx + 1] = s;
      tw[idx + 2] = 4 * c * (c * c - 0.75);
      tw[idx + 3] = 4 * s * (0.75 - s * s);
    }
    si++;
  }
  const entry = { x, spectrum, complex, bSi, tw, stages, perm };
  cache.set(N, entry);
  return entry;
}
function getEntry(N) {
  if (N === lastN) return lastEntry;
  const entry = cache.get(N) || init(N);
  lastN = N;
  lastEntry = entry;
  return entry;
}
function transform(input) {
  const N = input.length;
  if (N < 2 || N & N - 1) throw Error("Input length must be a power of 2 (>= 2).");
  const entry = getEntry(N);
  const { x, tw, stages, perm } = entry;
  for (let i = 0; i < N; i++) x[i] = input[perm[i]];
  for (let ix = 0, id = 4; ix < N; id *= 4) {
    for (let i0 = ix; i0 < N; i0 += id) {
      const t = x[i0] - x[i0 + 1];
      x[i0] += x[i0 + 1];
      x[i0 + 1] = t;
    }
    ix = 2 * (id - 1);
  }
  let n2 = 2, nn = N >>> 1, si = 0;
  while (nn = nn >>> 1) {
    let ix = 0;
    n2 = n2 << 1;
    let id = n2 << 1;
    const n4 = n2 >>> 2;
    const n8 = n2 >>> 3;
    do {
      if (n4 !== 1) {
        for (let i0 = ix; i0 < N; i0 += id) {
          let i1 = i0, i2 = i1 + n4, i3 = i2 + n4, i4 = i3 + n4;
          let t1 = x[i3] + x[i4];
          x[i4] -= x[i3];
          x[i3] = x[i1] - t1;
          x[i1] += t1;
          i1 += n8;
          i2 += n8;
          i3 += n8;
          i4 += n8;
          t1 = x[i3] + x[i4];
          let t2 = x[i3] - x[i4];
          t1 = -t1 * Math.SQRT1_2;
          t2 *= Math.SQRT1_2;
          const st1 = x[i2];
          x[i4] = t1 + st1;
          x[i3] = t1 - st1;
          x[i2] = x[i1] - t2;
          x[i1] += t2;
        }
      } else {
        for (let i0 = ix; i0 < N; i0 += id) {
          const i1 = i0, i3 = i1 + 2, i4 = i3 + 1;
          const t1 = x[i3] + x[i4];
          x[i4] -= x[i3];
          x[i3] = x[i1] - t1;
          x[i1] += t1;
        }
      }
      ix = (id << 1) - n2;
      id = id << 2;
    } while (ix < N);
    const { offset, count } = stages[si];
    for (let j = 0; j < count; j++) {
      const ti = offset + j << 2;
      const cc1 = tw[ti], ss1 = tw[ti + 1], cc3 = tw[ti + 2], ss3 = tw[ti + 3];
      ix = 0;
      id = n2 << 1;
      do {
        for (let i0 = ix; i0 < N; i0 += id) {
          const i1 = i0 + j + 1;
          const i2 = i1 + n4;
          const i3 = i2 + n4;
          const i4 = i3 + n4;
          const i5 = i0 + n4 - j - 1;
          const i6 = i5 + n4;
          const i7 = i6 + n4;
          const i8 = i7 + n4;
          let t2 = x[i7] * cc1 - x[i3] * ss1;
          let t1 = x[i7] * ss1 + x[i3] * cc1;
          let t4 = x[i8] * cc3 - x[i4] * ss3;
          let t3 = x[i8] * ss3 + x[i4] * cc3;
          const st1 = t2 - t4;
          t2 += t4;
          t4 = st1;
          x[i8] = t2 + x[i6];
          x[i3] = t2 - x[i6];
          const st2 = t3 - t1;
          t1 += t3;
          t3 = st2;
          x[i4] = t3 + x[i2];
          x[i7] = t3 - x[i2];
          x[i6] = x[i1] - t1;
          x[i1] += t1;
          x[i2] = t4 + x[i5];
          x[i5] -= t4;
        }
        ix = (id << 1) - n2;
        id = id << 2;
      } while (ix < N);
    }
    si++;
  }
  return entry;
}
function fft(input, output) {
  const entry = transform(input);
  const N = input.length;
  const half = N >>> 1;
  const { x, complex } = entry;
  if (output) {
    const re = output[0], im2 = output[1];
    for (let k = 0; k <= half; k++) re[k] = x[k];
    im2[0] = 0;
    im2[half] = 0;
    for (let k = 1; k < half; k++) im2[k] = x[N - k];
    return output;
  }
  const im = complex[1];
  im[0] = 0;
  im[half] = 0;
  for (let k = 1; k < half; k++) im[k] = x[N - k];
  return complex;
}
function inverseTransform(N, entry) {
  const { x, tw, stages } = entry;
  const numStages = stages.length;
  let n2 = N << 1;
  for (let s = 0; s < numStages; s++) {
    n2 >>= 1;
    const n4 = n2 >>> 2;
    const n8 = n4 >>> 1;
    const si = numStages - 1 - s;
    let ix = 0, id = n2 << 1;
    do {
      for (let i0 = ix; i0 < N; i0 += id) {
        const i1 = i0, i2 = i1 + n4, i3 = i2 + n4, i4 = i3 + n4;
        let t1 = x[i1] - x[i3];
        x[i1] += x[i3];
        x[i2] += x[i2];
        x[i4] += x[i4];
        x[i3] = t1 - x[i4];
        x[i4] += t1;
      }
      ix = (id << 1) - n2;
      id <<= 2;
    } while (ix < N);
    if (n8 >= 1) {
      ix = 0;
      id = n2 << 1;
      do {
        for (let i0 = ix; i0 < N; i0 += id) {
          const j1 = i0 + n8, j2 = j1 + n4, j3 = j2 + n4, j4 = j3 + n4;
          let t1 = x[j1] - x[j2];
          x[j1] += x[j2];
          let t2 = x[j4] + x[j3];
          x[j2] = x[j4] - x[j3];
          t2 = -t2 * Math.SQRT2;
          t1 *= Math.SQRT2;
          x[j3] = t2 + t1;
          x[j4] = t2 - t1;
        }
        ix = (id << 1) - n2;
        id <<= 2;
      } while (ix < N);
    }
    const { offset, count } = stages[si];
    for (let j = 0; j < count; j++) {
      const ti = offset + j << 2;
      const cc1 = tw[ti], ss1 = tw[ti + 1], cc3 = tw[ti + 2], ss3 = tw[ti + 3];
      ix = 0;
      id = n2 << 1;
      do {
        for (let i0 = ix; i0 < N; i0 += id) {
          const i1 = i0 + j + 1;
          const i2 = i1 + n4;
          const i3 = i2 + n4;
          const i4 = i3 + n4;
          const i5 = i0 + n4 - j - 1;
          const i6 = i5 + n4;
          const i7 = i6 + n4;
          const i8 = i7 + n4;
          let t1 = x[i1] - x[i6];
          x[i1] += x[i6];
          let t2 = x[i5] - x[i2];
          x[i5] += x[i2];
          let t3 = x[i8] + x[i3];
          x[i6] = x[i8] - x[i3];
          let t4 = x[i4] + x[i7];
          x[i2] = x[i4] - x[i7];
          const t5 = t1 - t4;
          t1 += t4;
          t4 = t2 - t3;
          t2 += t3;
          x[i7] = t5 * ss1 - t4 * cc1;
          x[i3] = t5 * cc1 + t4 * ss1;
          x[i4] = t1 * cc3 - t2 * ss3;
          x[i8] = t1 * ss3 + t2 * cc3;
        }
        ix = (id << 1) - n2;
        id <<= 2;
      } while (ix < N);
    }
  }
  for (let ix = 0, id = 4; ix < N; id *= 4) {
    for (let i0 = ix; i0 < N; i0 += id) {
      const t = x[i0] - x[i0 + 1];
      x[i0] += x[i0 + 1];
      x[i0 + 1] = t;
    }
    ix = 2 * (id - 1);
  }
}
function ifft(re, im, output) {
  const bins = re.length;
  const N = bins - 1 << 1;
  if (N < 2 || N & N - 1) throw Error("Input must have N/2+1 bins where N is power of 2 (>= 2).");
  const entry = getEntry(N);
  const { x } = entry;
  const half = N >>> 1;
  x[0] = re[0];
  x[half] = re[half];
  for (let k = 1; k < half; k++) {
    x[k] = re[k];
    x[N - k] = im[k];
  }
  inverseTransform(N, entry);
  const { perm } = entry, inv = 1 / N;
  if (output && output.buffer !== x.buffer) {
    for (let i = 0; i < N; i++) output[i] = x[perm[i]] * inv;
    return output;
  }
  for (let i = 0; i < N; i++) {
    const j = perm[i];
    if (i < j) {
      const t = x[i];
      x[i] = x[j];
      x[j] = t;
    }
  }
  for (let i = 0; i < N; i++) x[i] *= inv;
  if (output) {
    for (let i = 0; i < N; i++) output[i] = x[i];
    return output;
  }
  return x;
}

// node_modules/@audio/resample-sinc/sinc.js
var HALF = 16;
var CAP = 1 << 18;
var sinc = (x) => x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
var gcd = (a, b) => b ? gcd(b, a % b) : a;
var taps = (scale) => Math.ceil(HALF / scale);
var tables = /* @__PURE__ */ new Map();
function phases(from, to) {
  let g = Number.isInteger(from) && Number.isInteger(to) ? gcd(from, to) : 0;
  if (!g) return null;
  let L = to / g, M = from / g, key = M + "/" + L, tab = tables.get(key);
  if (tab) return tab;
  let rate = from / to, scale = rate > 1 ? 1 / rate : 1, T = taps(scale), S = 2 * T;
  if (L * S > CAP) return null;
  let W = new Float64Array(L * S), J0 = new Int32Array(L), J1 = new Int32Array(L);
  for (let p = 0; p < L; p++) {
    let j0 = S, j1 = 0;
    for (let j = 0; j < S; j++) {
      let x = (j + 1 - T - p / L) * scale;
      if (Math.abs(x) >= HALF) continue;
      W[p * S + j] = sinc(x) * sinc(x / HALF);
      if (j < j0) j0 = j;
      j1 = j + 1;
    }
    J0[p] = j0;
    J1[p] = j1;
  }
  if (tables.size >= 8) tables.delete(tables.keys().next().value);
  tables.set(key, tab = { L, M, T, W, J0, J1 });
  return tab;
}
function resample(data, { from, to } = {}) {
  if (!(from > 0) || !(to > 0)) throw new RangeError("resample: from/to must be positive sample rates");
  if (from === to) return Float32Array.from(data);
  let rate = from / to;
  let len = data.length;
  let n = Math.round(len * to / from);
  let out = new Float32Array(n);
  let scale = rate > 1 ? 1 / rate : 1;
  let T = taps(scale);
  let tab = phases(from, to);
  if (tab) {
    let { L, M, W, J0, J1 } = tab, S = 2 * T;
    for (let i = 0, p = 0, base = 0; i < n; i++) {
      let lo = base + 1 - T, o = p * S - lo, sum = 0, w = 0;
      for (let j = Math.max(0, lo + J0[p]), e = Math.min(len, lo + J1[p]); j < e; j++) {
        let k = W[o + j];
        sum += data[j] * k;
        w += k;
      }
      out[i] = w !== 0 ? sum / w : 0;
      if ((p += M) >= L) {
        let q = Math.floor(p / L);
        base += q;
        p -= q * L;
      }
    }
    return out;
  }
  let A = new Float64Array(2 * T), B = new Float64Array(2 * T), C = new Float64Array(2 * T), D = new Float64Array(2 * T);
  for (let j = 0, t = 1 - T; t <= T; t++, j++) {
    let a = Math.PI * scale * t;
    A[j] = Math.sin(a);
    B[j] = Math.cos(a);
    C[j] = Math.sin(a / HALF);
    D[j] = Math.cos(a / HALF);
  }
  let K = HALF / (Math.PI * Math.PI);
  for (let i = 0; i < n; i++) {
    let pos = i * rate;
    let base = Math.floor(pos), frac = pos - base;
    let f = Math.PI * scale * frac, sf = Math.sin(f), cf = Math.cos(f), sg = Math.sin(f / HALF), cg = Math.cos(f / HALF);
    let sum = 0, w = 0;
    for (let j = 0, t = 1 - T; t <= T; t++, j++) {
      let idx = base + t;
      if (idx < 0 || idx >= len) continue;
      let x = (t - frac) * scale;
      if (Math.abs(x) >= HALF) continue;
      let k = Math.abs(x) < 1e-3 ? sinc(x) * sinc(x / HALF) : (A[j] * cf - B[j] * sf) * (C[j] * cg - D[j] * sg) * K / (x * x);
      sum += data[idx] * k;
      w += k;
    }
    out[i] = w !== 0 ? sum / w : 0;
  }
  return out;
}

// node_modules/@audio/neural-runtime/ort-web.js
var isNode = false;
var runtimes = {
  wasm: () => import("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.wasm.min.mjs"),
  webgpu: () => import("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.webgpu.min.mjs"),
  webgl: () => import("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.webgl.min.mjs")
};

// node_modules/@audio/neural-runtime/runtime.js
function resolveBackend(want) {
  if (!want || want === "auto") return isNode ? "node" : "wasm";
  return want;
}
var NODE_EPS = /* @__PURE__ */ new Set(["webgpu", "coreml"]);
var runtimeOf = (backend) => isNode && NODE_EPS.has(backend) ? "node" : backend;
var ortCache = /* @__PURE__ */ new Map();
function getOrt(backend) {
  if (isNode && backend !== "node")
    throw new Error(`neural-runtime: backend '${backend}' needs a browser (onnxruntime-web) \u2014 Node runs backend 'node' (onnxruntime-node), and 'webgpu' and 'coreml' as its providers`);
  if (!isNode && backend === "node")
    throw new Error(`neural-runtime: backend 'node' needs Node.js (onnxruntime-node) \u2014 in a browser use 'wasm' or 'webgpu' (onnxruntime-web)`);
  if (!Object.hasOwn(runtimes, backend)) throw new Error(`neural-runtime: unknown backend '${backend}' (want 'auto', 'node', 'wasm', 'webgpu', or 'webgl')`);
  let p = ortCache.get(backend);
  if (!p) {
    p = runtimes[backend]().then((m) => m.default ?? m).catch((err) => {
      ortCache.delete(backend);
      let pkg = isNode ? "onnxruntime-node" : "onnxruntime-web";
      throw new Error(`neural-runtime: ${pkg} is required for backend '${backend}' \u2014 install it: npm install ${pkg} (${err.message})`);
    });
    ortCache.set(backend, p);
  }
  return p;
}
var TYPE_BY_CTOR = /* @__PURE__ */ new Map([
  [Float32Array, "float32"],
  [Int32Array, "int32"],
  [BigInt64Array, "int64"],
  [Uint8Array, "uint8"]
]);
function tensor(data, dims, type) {
  if (!dims) throw new Error("neural-runtime: tensor() needs dims");
  if (!type) {
    type = TYPE_BY_CTOR.get(data?.constructor);
    if (!type && Array.isArray(data) && data.every((v) => typeof v === "string")) type = "string";
    if (!type) throw new Error(`neural-runtime: tensor() can't infer a type for ${data?.constructor?.name ?? typeof data} \u2014 pass type explicitly`);
  }
  return { data, dims, type };
}
function toOrtTensor(ort, t) {
  if (!t || t.data == null || !t.dims || !t.type)
    throw new Error("neural-runtime: feed tensor needs { data, dims, type } \u2014 build it with tensor()");
  return new ort.Tensor(t.type, t.data, t.dims);
}
function fromOrtTensor(t) {
  return { data: t.data, dims: Array.from(t.dims), type: t.type };
}
function ioMeta(session, kind) {
  let names = session[kind + "Names"] || [], meta;
  try {
    meta = session[kind + "Metadata"];
  } catch {
  }
  if (!meta) return names.map((name) => ({ name }));
  return meta.map((m, i) => m.isTensor ? { name: m.name ?? names[i], dims: Array.from(m.shape), type: m.type } : { name: m.name ?? names[i] });
}
async function backends() {
  if (isNode) {
    let ort = await getOrt("node").catch(() => null), have = new Set((ort?.listSupportedBackends?.() ?? []).map((b) => b.name));
    return ["node", ...[...NODE_EPS].filter((b) => have.has(b))];
  }
  let list = ["wasm"], adapter = typeof navigator !== "undefined" && await navigator.gpu?.requestAdapter().catch(() => null);
  if (adapter && !adapter.info?.isFallbackAdapter && adapter.info?.architecture !== "swiftshader") list.push("webgpu");
  return list;
}
async function resolveBytes(model, opts) {
  if (model instanceof Uint8Array) return model;
  if (model instanceof ArrayBuffer) return new Uint8Array(model);
  if (typeof model === "string") return fetchModel(model, opts);
  throw new Error("neural-runtime: load() expects a URL string, Uint8Array, or ArrayBuffer");
}
async function load(model, opts = {}) {
  let bytes = await resolveBytes(model, opts);
  let backend = resolveBackend(opts.backend), runtime = runtimeOf(backend);
  let ort = await getOrt(runtime);
  if (opts.wasmPaths !== void 0 && ort.env?.wasm) ort.env.wasm.wasmPaths = opts.wasmPaths;
  if (opts.threads !== void 0 && ort.env?.wasm) ort.env.wasm.numThreads = opts.threads;
  if (opts.logLevel !== void 0 && ort.env) ort.env.logLevel = opts.logLevel;
  let sessionOpts = { ...opts.sessionOptions };
  let eps = opts.executionProviders ?? (backend === "node" ? void 0 : [backend]);
  if (eps) sessionOpts.executionProviders = eps;
  if (opts.graphOptimizationLevel) sessionOpts.graphOptimizationLevel = opts.graphOptimizationLevel;
  let session;
  try {
    session = await ort.InferenceSession.create(bytes, sessionOpts);
  } catch (err) {
    throw new Error(`neural-runtime: failed to load model \u2014 ${err.message}`);
  }
  let freed = false;
  let queue = Promise.resolve();
  return {
    inputs: ioMeta(session, "input"),
    outputs: ioMeta(session, "output"),
    backend,
    async run(feeds, outputNames) {
      if (freed) throw new Error("neural-runtime: run() called after free()");
      let ortFeeds = {};
      for (let k in feeds) ortFeeds[k] = toOrtTensor(ort, feeds[k]);
      let call = () => outputNames ? session.run(ortFeeds, outputNames) : session.run(ortFeeds);
      let p = queue.then(call, call);
      queue = p.then(() => {
      }, () => {
      });
      let raw = await p;
      let out = {};
      for (let k in raw) out[k] = fromOrtTensor(raw[k]);
      return out;
    },
    free() {
      if (freed) return;
      freed = true;
      session.release().catch(() => {
      });
    }
  };
}
async function readResponseBody(res, onLoaded) {
  let body = res.body;
  if (!body?.getReader) {
    let bytes = new Uint8Array(await res.arrayBuffer());
    onLoaded(bytes.length);
    return bytes;
  }
  let reader = body.getReader();
  let chunks = [], loaded = 0;
  for (; ; ) {
    let { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onLoaded(loaded);
  }
  let out = new Uint8Array(loaded), o = 0;
  for (let c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
async function readFileUrl(href) {
  let [{ readFileSync }, { fileURLToPath }] = await Promise.all([import("node:fs"), import("node:url")]);
  return new Uint8Array(readFileSync(fileURLToPath(href)));
}
async function cacheFile(url) {
  let [path, os, crypto] = await Promise.all([import("node:path"), import("node:os"), import("node:crypto")]);
  let dir = process.env.AUDIO_NEURAL_CACHE || path.join(os.homedir(), ".cache", "audiojs", "neural");
  let file = path.join(dir, crypto.createHash("sha256").update(url).digest("hex"));
  return { dir, file };
}
async function readCached(file) {
  let fs = await import("node:fs");
  if (!fs.existsSync(file) || !fs.existsSync(file + ".size")) return null;
  let expected = Number(fs.readFileSync(file + ".size", "utf8"));
  let bytes = fs.readFileSync(file);
  if (bytes.length !== expected) return null;
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
async function writeCached(dir, file, bytes) {
  let fs = await import("node:fs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, bytes);
  fs.writeFileSync(file + ".size", String(bytes.length));
}
async function fetchNode(url, { cache: cache2, progress, fetch: f }) {
  let dir, file;
  if (cache2) {
    ({ dir, file } = await cacheFile(url));
    let cached = await readCached(file);
    if (cached) {
      progress?.({ loaded: cached.length, total: cached.length });
      return cached;
    }
  }
  let res = await f(url);
  if (!res.ok) throw new Error(`neural-runtime: fetch failed for ${url}: ${res.status} ${res.statusText}`);
  let total = Number(res.headers.get("content-length")) || null;
  let bytes = await readResponseBody(res, (loaded) => progress?.({ loaded, total }));
  if (cache2) await writeCached(dir, file, bytes);
  return bytes;
}
async function fetchBrowser(url, { cache: cache2, progress, fetch: f }) {
  let store = cache2 && typeof caches !== "undefined" ? await caches.open("audio-neural") : null;
  if (store) {
    let hit = await store.match(url);
    if (hit) {
      let buf = new Uint8Array(await hit.arrayBuffer());
      progress?.({ loaded: buf.length, total: buf.length });
      return buf;
    }
  }
  let res = await f(url);
  if (!res.ok) throw new Error(`neural-runtime: fetch failed for ${url}: ${res.status} ${res.statusText}`);
  store?.put(url, res.clone()).catch((e) => console.warn(`neural-runtime: ${url} not cached (${e.message})`));
  let total = Number(res.headers.get("content-length")) || null;
  return readResponseBody(res, (loaded) => progress?.({ loaded, total }));
}
async function fetchModel(url, opts = {}) {
  let href = String(url);
  let { cache: cache2 = true, progress, fetch: fetchFn } = opts;
  if (href.startsWith("file://")) {
    if (!isNode) throw new Error("neural-runtime: file:// URLs are only readable in Node");
    let bytes = await readFileUrl(href);
    progress?.({ loaded: bytes.length, total: bytes.length });
    return bytes;
  }
  let f = fetchFn || globalThis.fetch;
  if (!f) throw new Error("neural-runtime: no fetch available in this environment \u2014 pass opts.fetch");
  return isNode ? fetchNode(href, { cache: cache2, progress, fetch: f }) : fetchBrowser(href, { cache: cache2, progress, fetch: f });
}
async function fetchJson(url, opts) {
  let bytes = await fetchModel(url, opts);
  return JSON.parse(new TextDecoder().decode(bytes));
}

// node_modules/@audio/neural-separate/separate.js
var PI2 = Math.PI * 2;
var isNode2 = globalThis.process?.release?.name === "node";
var hannCache = /* @__PURE__ */ new Map();
function hann(n) {
  let w = hannCache.get(n);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(PI2 * i / n);
    hannCache.set(n, w);
  }
  return w;
}
function reflectIndex(i, n) {
  if (n === 1) return 0;
  let period = 2 * (n - 1);
  i = (i % period + period) % period;
  return i < n ? i : period - i;
}
function rows(flat, bins) {
  let T = flat.length / bins, r = new Array(T);
  for (let t = 0; t < T; t++) r[t] = flat.subarray(t * bins, (t + 1) * bins);
  return r;
}
function stftFlat(x, n, hop, win, center) {
  let N = x.length, bins = (n >> 1) + 1, pad = center ? n >> 1 : 0;
  let T = center ? 1 + Math.floor(N / hop) : N < n ? 0 : 1 + Math.floor((N - n) / hop);
  let re = new Float64Array(T * bins), im = new Float64Array(T * bins), frame = new Float64Array(n);
  for (let m = 0; m < T; m++) {
    let pos = m * hop - pad;
    if (pos < 0 || pos + n > N) for (let i = 0; i < n; i++) frame[i] = (center ? x[reflectIndex(pos + i, N)] : x[pos + i] ?? 0) * win[i];
    else for (let i = 0; i < n; i++) frame[i] = x[pos + i] * win[i];
    let [r, j] = fft(frame);
    re.set(r, m * bins);
    im.set(j, m * bins);
  }
  return { re, im, T, bins };
}
function ola(re, im, out, t0, n, hop, win) {
  for (let m = 0; m < re.length; m++) {
    let f = ifft(re[m], im[m]);
    for (let i = 0, pos = (t0 + m) * hop; i < n; i++) out[pos + i] += f[i] * win[i];
  }
}
function envelope(T, n, hop, win) {
  let env = new Float64Array(T > 0 ? (T - 1) * hop + n : 0);
  for (let m = 0; m < T; m++) for (let i = 0; i < n; i++) env[m * hop + i] += win[i] * win[i];
  return env;
}
function olaFinish(out, env, n, center, length) {
  let pad = center ? n >> 1 : 0;
  length ?? (length = Math.max(0, out.length - 2 * pad));
  let result = new Float32Array(length);
  for (let i = 0, j = pad; i < length && j < out.length; i++, j++) if (env[j] > 1e-8) result[i] = out[j] / env[j];
  return result;
}
function wiener(Xr, Xi, V, T, bins, { iterations = 1, softmask = false, residual = false, eps = 1e-10, scaleFactor = 10 } = {}) {
  let C = Xr.length, S0 = V.length, S = S0 + (residual ? 1 : 0), TB = T * bins;
  let k = 1;
  if (iterations > 0) {
    let maxPow = 0;
    for (let c = 0; c < C; c++) {
      let xr = Xr[c], xi = Xi[c];
      for (let i = 0; i < TB; i++) {
        let p = xr[i] * xr[i] + xi[i] * xi[i];
        if (p > maxPow) maxPow = p;
      }
    }
    k = 1 / Math.max(1, Math.sqrt(maxPow) / scaleFactor);
  }
  let Yr = Array.from({ length: S }, () => Array.from({ length: C }, () => new Float64Array(TB)));
  let Yi = Array.from({ length: S }, () => Array.from({ length: C }, () => new Float64Array(TB)));
  let a = new Float64Array(TB), b = new Float64Array(TB);
  for (let c = 0; c < C; c++) {
    let xr = Xr[c], xi = Xi[c];
    if (softmask) {
      a.fill(eps);
      for (let j = 0; j < S0; j++) {
        let v = V[j][c];
        for (let i = 0; i < TB; i++) a[i] += v[i];
      }
      for (let j = 0; j < S0; j++) {
        let v = V[j][c], yr = Yr[j][c], yi = Yi[j][c];
        for (let i = 0; i < TB; i++) {
          let r = v[i] / a[i] * k;
          yr[i] = r * xr[i];
          yi[i] = r * xi[i];
        }
      }
    } else {
      for (let i = 0; i < TB; i++) {
        let m = Math.sqrt(xr[i] * xr[i] + xi[i] * xi[i]);
        a[i] = (m > 0 ? xr[i] / m : 1) * k;
        b[i] = m > 0 ? xi[i] / m * k : 0;
      }
      for (let j = 0; j < S0; j++) {
        let v = V[j][c], yr = Yr[j][c], yi = Yi[j][c];
        for (let i = 0; i < TB; i++) {
          yr[i] = v[i] * a[i];
          yi[i] = v[i] * b[i];
        }
      }
    }
    if (residual) {
      let rr = Yr[S0][c], ri = Yi[S0][c];
      for (let i = 0; i < TB; i++) {
        rr[i] = xr[i] * k;
        ri[i] = xi[i] * k;
      }
      for (let j = 0; j < S0; j++) {
        let yr = Yr[j][c], yi = Yi[j][c];
        for (let i = 0; i < TB; i++) {
          rr[i] -= yr[i];
          ri[i] -= yi[i];
        }
      }
    }
  }
  if (iterations > 0) em(Yr, Yi, Xr, Xi, T, bins, iterations, eps, k);
  return { Yr, Yi };
}
function em(Yr, Yi, Xr, Xi, T, bins, iterations, eps, k) {
  let S = Yr.length, C = Xr.length, TB = T * bins;
  let pairs = [];
  for (let c1 = 0; c1 < C; c1++) for (let c2 = c1; c2 < C; c2++) pairs.push([c1, c2]);
  let V = Array.from({ length: S }, () => new Float64Array(TB));
  let Rr = Array.from({ length: S }, () => pairs.map(() => new Float64Array(bins)));
  let Ri = Array.from({ length: S }, () => pairs.map(() => new Float64Array(bins)));
  let w = new Float64Array(bins), sqrtEps = Math.sqrt(eps);
  for (let iter = 0; iter < iterations; iter++) {
    for (let j = 0; j < S; j++) {
      let v = V[j];
      v.fill(0);
      for (let c = 0; c < C; c++) {
        let yr = Yr[j][c], yi = Yi[j][c];
        for (let i = 0; i < TB; i++) v[i] += yr[i] * yr[i] + yi[i] * yi[i];
      }
      for (let i = 0; i < TB; i++) v[i] /= C;
      w.fill(eps);
      for (let o = 0; o < TB; o += bins) for (let f = 0; f < bins; f++) w[f] += v[o + f];
      pairs.forEach(([c1, c2], p) => {
        let ar = Yr[j][c1], ai = Yi[j][c1], br = Yr[j][c2], bi = Yi[j][c2], rr = Rr[j][p], ri = Ri[j][p];
        rr.fill(0);
        ri.fill(0);
        for (let o = 0; o < TB; o += bins) for (let f = 0, i = o; f < bins; f++, i++) {
          rr[f] += ar[i] * br[i] + ai[i] * bi[i];
          ri[f] += ai[i] * br[i] - ar[i] * bi[i];
        }
        for (let f = 0; f < bins; f++) {
          rr[f] /= w[f];
          ri[f] /= w[f];
        }
      });
    }
    let out = iter === iterations - 1 ? 1 / k : 1;
    if (C === 2) apply2(Yr, Yi, Xr, Xi, V, Rr, Ri, TB, bins, sqrtEps, k, out);
    else applyN(Yr, Yi, Xr, Xi, V, Rr, Ri, pairs, TB, bins, sqrtEps, k, out);
  }
}
function apply2(Yr, Yi, Xr, Xi, V, Rr, Ri, TB, bins, sqrtEps, xs, ys) {
  let S = V.length, P = new Float64Array(bins * S * 4), VP = new Float64Array(TB * S), YP = new Float64Array(TB * S * 4);
  for (let j = 0; j < S; j++) {
    let r00 = Rr[j][0], r01r = Rr[j][1], r01i = Ri[j][1], r11 = Rr[j][2], v = V[j];
    for (let f = 0, q = j * 4; f < bins; f++, q += S * 4) {
      P[q] = r00[f];
      P[q + 1] = r01r[f];
      P[q + 2] = r01i[f];
      P[q + 3] = r11[f];
    }
    for (let i = 0, q = j; i < TB; i++, q += S) VP[q] = v[i];
  }
  let [x0r, x1r] = Xr, [x0i, x1i] = Xi;
  for (let o = 0; o < TB; o += bins) for (let f = 0, i = o; f < bins; f++, i++) {
    let a = sqrtEps, d = sqrtEps, br = 0, bi = 0, pb = f * S * 4, vb = i * S;
    for (let j = 0, q = pb; j < S; j++, q += 4) {
      let v = VP[vb + j];
      a += v * P[q];
      br += v * P[q + 1];
      bi += v * P[q + 2];
      d += v * P[q + 3];
    }
    let det = a * d - br * br - bi * bi, k = det !== 0 ? 1 / det : 0;
    let xr0 = x0r[i] * xs, xi0 = x0i[i] * xs, xr1 = x1r[i] * xs, xi1 = x1i[i] * xs;
    let w0r = (d * xr0 - br * xr1 + bi * xi1) * k, w0i = (d * xi0 - br * xi1 - bi * xr1) * k;
    let w1r = (a * xr1 - br * xr0 - bi * xi0) * k, w1i = (a * xi1 - br * xi0 + bi * xr0) * k;
    for (let j = 0, q = pb, y = vb * 4; j < S; j++, q += 4, y += 4) {
      let v = VP[vb + j] * ys, p = P[q], qr = P[q + 1], qi = P[q + 2], s = P[q + 3];
      YP[y] = v * (p * w0r + qr * w1r - qi * w1i);
      YP[y + 1] = v * (p * w0i + qr * w1i + qi * w1r);
      YP[y + 2] = v * (qr * w0r + qi * w0i + s * w1r);
      YP[y + 3] = v * (qr * w0i - qi * w0r + s * w1i);
    }
  }
  for (let j = 0; j < S; j++) {
    let y0r = Yr[j][0], y0i = Yi[j][0], y1r = Yr[j][1], y1i = Yi[j][1];
    for (let i = 0, y = j * 4; i < TB; i++, y += S * 4) {
      y0r[i] = YP[y];
      y0i[i] = YP[y + 1];
      y1r[i] = YP[y + 2];
      y1i[i] = YP[y + 3];
    }
  }
}
function applyN(Yr, Yi, Xr, Xi, V, Rr, Ri, pairs, TB, bins, sqrtEps, xs, ys) {
  let S = V.length, C = Xr.length, CC = C * C;
  let cr = new Float64Array(CC), ci = new Float64Array(CC), ir = new Float64Array(CC), ii = new Float64Array(CC);
  let sr = new Float64Array(2 * CC), si = new Float64Array(2 * CC), wr = new Float64Array(C), wi = new Float64Array(C);
  let rr = new Float64Array(CC), ri = new Float64Array(CC);
  let full = (j, f) => pairs.forEach(([c1, c2], p) => {
    rr[c1 * C + c2] = Rr[j][p][f];
    ri[c1 * C + c2] = Ri[j][p][f];
    rr[c2 * C + c1] = Rr[j][p][f];
    ri[c2 * C + c1] = -Ri[j][p][f];
  });
  for (let o = 0; o < TB; o += bins) for (let f = 0, i = o; f < bins; f++, i++) {
    cr.fill(0);
    ci.fill(0);
    for (let j = 0; j < S; j++) {
      let v = V[j][i];
      full(j, f);
      for (let k = 0; k < CC; k++) {
        cr[k] += v * rr[k];
        ci[k] += v * ri[k];
      }
    }
    for (let c = 0; c < C; c++) cr[c * C + c] += sqrtEps;
    complexInverse(cr, ci, ir, ii, C, sr, si);
    for (let c1 = 0; c1 < C; c1++) {
      let ar = 0, ai = 0;
      for (let c2 = 0; c2 < C; c2++) {
        let gr = ir[c1 * C + c2], gi = ii[c1 * C + c2], xr = Xr[c2][i] * xs, xi = Xi[c2][i] * xs;
        ar += gr * xr - gi * xi;
        ai += gr * xi + gi * xr;
      }
      wr[c1] = ar;
      wi[c1] = ai;
    }
    for (let j = 0; j < S; j++) {
      let v = V[j][i] * ys;
      full(j, f);
      for (let c1 = 0; c1 < C; c1++) {
        let ar = 0, ai = 0;
        for (let c2 = 0; c2 < C; c2++) {
          let gr = rr[c1 * C + c2], gi = ri[c1 * C + c2];
          ar += gr * wr[c2] - gi * wi[c2];
          ai += gr * wi[c2] + gi * wr[c2];
        }
        Yr[j][c1][i] = v * ar;
        Yi[j][c1][i] = v * ai;
      }
    }
  }
}
function complexInverse(Are, Aim, outRe, outIm, n, re, im) {
  let m = n * 2;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      re[i * m + j] = Are[i * n + j];
      im[i * m + j] = Aim[i * n + j];
    }
    for (let j = n; j < m; j++) {
      re[i * m + j] = 0;
      im[i * m + j] = 0;
    }
    re[i * m + n + i] = 1;
  }
  for (let col = 0; col < n; col++) {
    let piv = col, best = re[col * m + col] ** 2 + im[col * m + col] ** 2;
    for (let r = col + 1; r < n; r++) {
      let mag = re[r * m + col] ** 2 + im[r * m + col] ** 2;
      if (mag > best) {
        best = mag;
        piv = r;
      }
    }
    if (piv !== col) for (let k = 0; k < m; k++) {
      let tr = re[col * m + k];
      re[col * m + k] = re[piv * m + k];
      re[piv * m + k] = tr;
      let ti = im[col * m + k];
      im[col * m + k] = im[piv * m + k];
      im[piv * m + k] = ti;
    }
    let pr = re[col * m + col], pi = im[col * m + col];
    let d = pr * pr + pi * pi || 1e-300;
    for (let k = 0; k < m; k++) {
      let vr = re[col * m + k], vi = im[col * m + k];
      re[col * m + k] = (vr * pr + vi * pi) / d;
      im[col * m + k] = (vi * pr - vr * pi) / d;
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      let fr = re[r * m + col], fi = im[r * m + col];
      if (fr === 0 && fi === 0) continue;
      for (let k = 0; k < m; k++) {
        let vr = re[col * m + k], vi = im[col * m + k];
        re[r * m + k] -= fr * vr - fi * vi;
        im[r * m + k] -= fr * vi + fi * vr;
      }
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    outRe[i * n + j] = re[i * m + n + j];
    outIm[i * n + j] = im[i * m + n + j];
  }
}
var DEMUCS = ["drums", "bass", "other", "vocals"];
var SCNET = { modelType: "complex", sampleRate: 44100, targets: DEMUCS, n: 4096, hop: 1024, window: "ones", normalized: true, segment: 485100, frames: 476 };
var MRX = {
  modelType: "multires",
  sampleRate: 44100,
  targets: ["dialogue", "music", "effects"],
  sources: ["music", "dialogue", "effects"],
  windows: [1024, 2048, 8192],
  hop: 256,
  loudness: -27,
  mono: true,
  chunk: 20,
  script: "export-mrx.py"
};
var TIGER = {
  modelType: "complex",
  sampleRate: 44100,
  targets: ["dialogue", "music", "effects"],
  sources: ["dialogue", "music", "effects"],
  n: 2048,
  hop: 512,
  window: "hann",
  normalized: false,
  segment: 529200,
  frames: 1034,
  step: 1 / 3,
  fade: 0,
  pad: "zero",
  standardize: false,
  mono: true,
  script: "export-tiger.py"
};
var MEL = {
  modelType: "complex",
  sampleRate: 44100,
  targets: ["vocals"],
  sources: ["vocals"],
  n: 2048,
  hop: 441,
  window: "hann",
  normalized: false,
  segment: 352800,
  frames: 801,
  step: 0.5,
  standardize: false,
  gpu: true,
  script: "export-roformer.py",
  // roformer.js's tensors, for a browser whose GPU has subgroup matrices: the engine runs in onnxruntime's place
  engine: { meta: "mel-roformer.engine.json", bin: "mel-roformer.engine.bin", sha256: "140fedcd9d03a8f918b235688c69f4dfdd86b08f9d430277659c095688a026ff" }
};
var ROOM = {
  modelType: "complex",
  sampleRate: 44100,
  targets: ["dry"],
  sources: ["dry"],
  n: 2048,
  hop: 512,
  window: "hann",
  normalized: false,
  segment: 384e3,
  frames: 751,
  step: 0.5,
  standardize: false,
  mono: true,
  gpu: true,
  script: "export-roformer.py"
};
var FILES = {
  "scnet-large": { file: "scnet-large.int8.onnx", repo: "audiojs/scnet-large", sha256: "b2dc586a1e0e6c0afe4915e9057ea29111397b7bbf589edc3d85de91de79cd72" },
  scnet: { file: "scnet.int8.onnx", repo: "audiojs/scnet", sha256: "98228931494151762a1c4ab1ec7899a894b1f81fd4a509921a9d2f9bacc50845" },
  mrx: { file: "mrx.int8.onnx", repo: "audiojs/mrx", sha256: "d876c92d224f5d8cd2207d528b23369da895a6de71fb24132416fcb16f9f8424" },
  tiger: { file: "tiger.int8.onnx", repo: "audiojs/tiger-dnr", sha256: "2189859ac7e89cf4d9d284c6f393e737aaa2b3233ed7ee424ad622012bce7bca" },
  // float16 weights, float32 compute: half the download; int8 (259 MB) ran slower on WebGPU and 10 dB further from float32
  "mel-roformer": { file: "mel-roformer.fp16.onnx", repo: "audiojs/mel-roformer", sha256: "adcbbb826f12453fbb86652b503242d565a9c81cdef1bca2fe0e54752eba91ef" },
  // float16 weights, float32 compute: 60 MB, its output 49 dB from the export's
  "dereverb-room": { file: "dereverb-room.fp16.onnx", repo: "audiojs/dereverb-room", sha256: "99797e086a71d1cb57d50f3b5be93dcb7c89c49d1537c60487a488a24aaee9ee" }
};
var REVISIONS = {
  "scnet-large": "95f22d9e68f6cab78aef358f1a0de248d4edf805",
  scnet: "e71bcdb42bce1d62b7fae25ba90fcbcf90f73f46",
  mrx: "dedc823a0bea2ed085d19e8b7f32589d35169ee8",
  tiger: "1c959ab7ff8794dc5663b104ba301687ab95d2ab",
  "mel-roformer": "c1aba02c00a0bee852d6754fe6ede8164f90a4b3",
  "dereverb-room": "b4c2d14da9f2199099656195b06fd8253fd16e1d"
};
var hosted = (name) => models[name].repo && REVISIONS[name] ? `https://huggingface.co/${models[name].repo}/resolve/${REVISIONS[name]}/${models[name].file}` : null;
var models = {
  umxhq: { modelType: "openunmix", sampleRate: 44100, targets: ["vocals", "drums", "bass", "other"], perTarget: true },
  htdemucs: { modelType: "hybrid", sampleRate: 44100, targets: DEMUCS },
  htdemucs_ft: { modelType: "hybrid", sampleRate: 44100, targets: DEMUCS, perTarget: true },
  // SCNet-large and SCNet (starrytong/SCNet, MIT weights) as scripts/export-scnet.py exports them
  "scnet-large": { ...SCNET, ...FILES["scnet-large"] },
  scnet: { ...SCNET, ...FILES.scnet },
  // MRX (merlresearch/cocktail-fork-separation, MIT weights) as scripts/export-mrx.py exports it: dialogue, music
  // and effects of a soundtrack (Divide and Remaster)
  mrx: { ...MRX, ...FILES.mrx },
  // TIGER (JusperLee/TIGER, Apache-2.0 weights): the same three stems, three band-split models, about 50 times MRX's time
  tiger: { ...TIGER, ...FILES.tiger },
  // Mel-Band RoFormer (Kimberley Jensen's vocals model, MIT weights) as scripts/export-roformer.py exports it for the GPU
  "mel-roformer": { ...MEL, ...FILES["mel-roformer"] },
  // anvuew's room de-reverb (BS-RoFormer, GPL-3.0 weights) as scripts/export-roformer.py exports it: a voice in a room
  // in, the voice dry out
  "dereverb-room": { ...ROOM, ...FILES["dereverb-room"] }
};
async function cacheDir() {
  if (process.env.AUDIO_NEURAL_CACHE) return process.env.AUDIO_NEURAL_CACHE;
  let [path, os] = await Promise.all([import("node:path"), import("node:os")]);
  return path.join(os.homedir(), ".cache", "audiojs", "neural");
}
async function weightsBase(opts, name) {
  let w = opts.weights;
  if (w == null && !isNode2) throw new Error(`neural-separate: model '${name}' needs opts.weights in the browser: the URL its files are served from (${name}/<file>.onnx)`);
  if (w == null) w = await cacheDir();
  if (/^[a-z][a-z0-9+.-]+:/i.test(w)) return w.endsWith("/") ? w : w + "/";
  if (!isNode2) throw new Error(`neural-separate: opts.weights must be a URL in the browser, got '${w}'`);
  let { pathToFileURL } = await import("node:url");
  return pathToFileURL(w.endsWith("/") ? w : w + "/").href;
}
async function local(graphs, name, opts) {
  let [fs, { fileURLToPath }] = await Promise.all([import("node:fs"), import("node:url")]);
  let file = (g) => typeof g.spec === "string" && g.spec.startsWith("file:") ? fileURLToPath(g.spec) : null;
  let here = (g) => !file(g) || fs.existsSync(file(g)), p = models[name], why = "";
  let whole = (g) => ({ ...g, spec: g.spec.replace(/[^/]*$/, `${name}.onnx`), sha256: null });
  if (p.file) graphs = await Promise.all(graphs.map(async (g) => {
    if (!file(g)) return g;
    let cached = opts.weights == null;
    if (here(g) && (!cached || await sha256(fs.readFileSync(file(g))) === p.sha256)) return { ...g, sha256: null };
    if (here(whole(g))) return whole(g);
    if (cached && hosted(name)) try {
      return { ...g, spec: await fetched(name, file(g)), sha256: null };
    } catch (e) {
      why = ` (${e.message})`;
    }
    return { ...g, sha256: null };
  }));
  let missing = graphs.filter((g) => !here(g)).map(file);
  if (!missing.length) return graphs;
  let script = p.script ?? { hybrid: "export-htdemucs.py", complex: "export-scnet.py" }[p.modelType] ?? "export-openunmix.py";
  throw new Error(`neural-separate: ${name} weights not found: ${missing.join(", ")}${why}. Produce them with python3 node_modules/@audio/neural-separate/scripts/${script} --model ${name}` + (p.file ? ` (and scripts/compact.py --model ${name} for ${p.file})` : "") + `, or pass opts.weights: a URL or directory holding ${name}/<file>.onnx`);
}
var KEEP = 6e4;
var kept = null;
function engineSession(opts, p) {
  let name = opts.model, key = `${name}:${opts.weights ?? ""}:${p.engine.sha256}`;
  if (kept?.key === key) {
    clearTimeout(kept.timer);
    return kept.session;
  }
  kept?.session.then((s) => s?.drop());
  let mine = { key, timer: null };
  mine.session = makeEngine(opts, p, name).then((s) => s && {
    ...s,
    drop: s.free,
    free() {
      clearTimeout(mine.timer);
      mine.timer = setTimeout(() => {
        if (kept === mine) kept = null;
        s.free();
      }, KEEP);
    }
  });
  return (kept = mine).session;
}
async function makeEngine(opts, p, name) {
  let { engine: engine2, gpu: gpu2 } = await Promise.resolve().then(() => (init_roformer(), roformer_exports)), device = await gpu2();
  if (!device) return null;
  try {
    let base = opts.weights != null ? `${await weightsBase(opts, name)}${name}/` : `https://huggingface.co/${p.repo}/resolve/${REVISIONS[name]}/`;
    let [meta, bytes] = await Promise.all([fetchJson(base + p.engine.meta), checked(base + p.engine.bin, p.engine.sha256)]);
    return await engine2(meta, bytes, device);
  } catch (e) {
    device.destroy();
    console.warn(`neural-separate: ${name}'s own engine stands aside (${e.message})`);
    return null;
  }
}
async function fetched(name, dest) {
  let [fs, path, { pathToFileURL }] = await Promise.all([import("node:fs"), import("node:path"), import("node:url")]);
  let bytes = await checked(hosted(name), models[name].sha256, { cache: false });
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest + ".part", bytes);
  fs.renameSync(dest + ".part", dest);
  return pathToFileURL(dest).href;
}
async function resolveModel(opts) {
  let model = opts.model;
  if (model == null) throw new Error("neural-separate: opts.model is required (preset name | url | bytes | {target: url, ...} | {url, targets})");
  let want = opts.targets;
  let pick = (names) => want ? names.filter((n) => want.includes(n)) : names;
  if (typeof model === "string" && Object.hasOwn(models, model)) {
    let p = models[model], url = !isNode2 && opts.weights == null && hosted(model), base = url ? "" : await weightsBase(opts, model);
    if (want) {
      for (let t of want) if (!p.targets.includes(t)) throw new Error(`neural-separate: ${model} has no target '${t}' (has ${p.targets.join(", ")})`);
    }
    let targets = pick(p.targets);
    let sources = p.sources ?? (p.modelType === "hybrid" || p.modelType === "complex" ? DEMUCS : null);
    let graphs2 = p.perTarget ? targets.map((t) => ({ spec: `${base}${model}/${t}.onnx`, sources: sources ?? [t], keep: [t] })) : [{ spec: url || `${base}${model}/${p.file ?? `${model}.onnx`}`, sources: sources ?? p.targets, keep: targets, sha256: p.sha256 }];
    if (isNode2) graphs2 = await local(graphs2, model, opts);
    return { graphs: graphs2, modelType: p.modelType, sampleRate: p.sampleRate, targets, preset: p };
  }
  let graphs;
  if (typeof model === "string" || model instanceof Uint8Array) graphs = [{ spec: model, sources: ["stem"], keep: ["stem"] }];
  else if (model.url != null && Array.isArray(model.targets)) graphs = [{ spec: model.url, sources: model.targets, keep: pick(model.targets) }];
  else {
    let names = Object.keys(model);
    if (!names.length) throw new Error("neural-separate: opts.model target map is empty");
    graphs = pick(names).map((t) => {
      let g = model[t];
      return g?.url != null && Array.isArray(g.targets) ? { spec: g.url, sources: g.targets, keep: [t] } : { spec: g, sources: [t], keep: [t] };
    });
  }
  graphs = graphs.filter((g) => g.keep.length);
  if (!graphs.length) throw new Error(`neural-separate: none of targets ${want} is in the model`);
  return { graphs, modelType: opts.modelType ?? "openunmix", sampleRate: null, targets: graphs.flatMap((g) => g.keep) };
}
var sessionOptions = { enableCpuMemArena: false, enableMemPattern: false };
function loader(opts, preset) {
  let device = opts.device ?? (preset?.gpu ? backends().then((b) => b.includes("webgpu") ? "webgpu" : void 0) : void 0);
  let own = !opts.device && !opts.session && preset?.engine && !isNode2 ? engineSession(opts, preset) : null;
  return async (g) => {
    if (opts.session) return opts.session(g.spec, opts);
    let s = own && await own;
    if (s) return s;
    let spec = g.sha256 && !g.spec.startsWith("file:") ? await checked(g.spec, g.sha256) : g.spec;
    return load(spec, { backend: await device, sessionOptions, wasmPaths: opts.wasmPaths });
  };
}
async function checked(url, hash, opts) {
  let bytes = await fetchModel(url, opts), hex = await sha256(bytes);
  if (hex !== hash) throw new Error(`neural-separate: ${url} has SHA-256 ${hex}, expected ${hash}: a partial or altered download (clear the 'audio-neural' cache), or another build of the file`);
  return bytes;
}
async function sha256(bytes) {
  let subtle = globalThis.crypto?.subtle ?? (await import("node:crypto")).webcrypto.subtle;
  return Array.from(new Uint8Array(await subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
}
function outputOf(session, out, i = 0) {
  let name = session.outputs?.[i]?.name;
  if (name && out[name]) return out[name];
  let vals = Object.values(out);
  if (!vals[i]) throw new Error(`neural-separate: model returned ${vals.length} output(s), expected at least ${i + 1}`);
  return vals[i];
}
async function overlapAdd(N, C, starts, size, weight, run, progress) {
  let outputs = null, wsum = new Float64Array(N);
  for (let i = 0; i < starts.length; i++) {
    let start = starts[i], len = Math.min(size, N - start);
    progress?.({ chunk: i + 1, totalChunks: starts.length });
    let res = await run(start, len);
    if (!outputs) {
      outputs = {};
      for (let name in res) outputs[name] = Array.from({ length: C }, () => new Float64Array(N));
    }
    let w = new Float64Array(len);
    for (let k = 0; k < len; k++) {
      w[k] = weight(k, len);
      wsum[start + k] += w[k];
    }
    for (let name in res) for (let c = 0; c < C; c++) {
      let src = res[name][c], dst = outputs[name][c];
      for (let k = 0; k < len; k++) dst[start + k] += src[k] * w[k];
    }
  }
  let result = {};
  for (let name in outputs) result[name] = outputs[name].map((ch) => {
    let out = new Float32Array(N);
    for (let i = 0; i < N; i++) if (wsum[i] > 0) out[i] = ch[i] / wsum[i];
    return out;
  });
  return result;
}
function crossfadeChunks(N, rate, opts) {
  let chunkSec = opts.chunk ?? 30, overlapSec = opts.overlap ?? 2;
  if (overlapSec >= chunkSec) throw new Error("neural-separate: opts.overlap must be smaller than opts.chunk");
  let size = Math.max(1, Math.round(chunkSec * rate));
  let ov = Math.max(0, Math.round(overlapSec * rate));
  let starts = [0];
  if (N > size) {
    starts = [];
    for (let s = 0; s < N; s += size - ov) {
      starts.push(s);
      if (s + size >= N) break;
    }
  }
  let weight = (k, len) => Math.min(1, (k + 0.5) / ov, (len - k - 0.5) / ov);
  return { starts, size, weight: ov ? weight : () => 1 };
}
var slice = (channels, start, len) => channels.map((ch) => ch.subarray(start, start + len));
function packSpectral(mix, T, bins) {
  let C = mix.length, data = new Float32Array(C * bins * T);
  mix.forEach(({ re, im }, c) => {
    for (let t = 0, base = c * bins * T; t < T; t++) for (let f = 0, i = t * bins; f < bins; f++, i++) data[base + f * T + t] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  });
  return tensor(data, [1, C, bins, T], "float32");
}
function estimate(data, base, mag, C, T, bins, t0, t1, mask) {
  return Array.from({ length: C }, (_, c) => {
    let v = new Float64Array((t1 - t0) * bins), b = base + c * bins * T, m = c * bins * T;
    if (mask) for (let f = 0; f < bins; f++) for (let t = t0, i = f; t < t1; t++, i += bins) v[i] = data[b + f * T + t] * mag[m + f * T + t];
    else for (let f = 0; f < bins; f++) for (let t = t0, i = f; t < t1; t++, i += bins) v[i] = data[b + f * T + t];
    return v;
  });
}
async function separateSpectral(channels, rate, opts, graphs, modelType, load2) {
  let n = opts.n ?? 4096, hop = opts.hop ?? 1024, win = hann(n);
  let iterations = opts.wiener ?? 1;
  let W = opts.wienerWindow ?? 300;
  let names = graphs.flatMap((g) => g.keep);
  let residual = names.length === 1 && iterations > 0;
  let wopts = { iterations, softmask: opts.softmask ?? false, eps: opts.eps, residual };
  let sessions = [];
  try {
    for (let g of graphs) sessions.push(await load2(g));
    let C = channels.length, N = channels[0].length;
    let { starts, size, weight } = crossfadeChunks(N, rate, opts);
    return await overlapAdd(N, C, starts, size, weight, async (start, len) => {
      let mix = slice(channels, start, len).map((x) => stftFlat(x, n, hop, win, true));
      let { T, bins } = mix[0];
      let input = packSpectral(mix, T, bins);
      let raw = {};
      for (let i = 0; i < graphs.length; i++) {
        let s = sessions[i], out = outputOf(s, await s.run({ [s.inputs?.[0]?.name ?? "input"]: input }));
        for (let name of graphs[i].keep) raw[name] = { data: out.data, base: graphs[i].sources.indexOf(name) * C * bins * T };
      }
      let acc = names.map(() => Array.from({ length: C }, () => new Float64Array((T - 1) * hop + n)));
      for (let t0 = 0; t0 < T; t0 += W) {
        let t1 = Math.min(T, t0 + W), view = (x) => x.subarray(t0 * bins, t1 * bins);
        let V = names.map((name) => estimate(raw[name].data, raw[name].base, input.data, C, T, bins, t0, t1, modelType === "mask"));
        let { Yr, Yi } = wiener(mix.map((m) => view(m.re)), mix.map((m) => view(m.im)), V, t1 - t0, bins, wopts);
        names.forEach((_, j) => {
          for (let c = 0; c < C; c++) ola(rows(Yr[j][c], bins), rows(Yi[j][c], bins), acc[j][c], t0, n, hop, win);
        });
      }
      let env = envelope(T, n, hop, win), res = {};
      names.forEach((name, j) => {
        res[name] = acc[j].map((o) => olaFinish(o, env, n, true, len));
      });
      return res;
    }, opts.progress);
  } finally {
    for (let s of sessions) s.free?.();
  }
}
function normalize(channels) {
  let C = channels.length, N = channels[0].length, mono = new Float64Array(N), mean = 0, sq = 0;
  for (let x of channels) for (let i = 0; i < N; i++) mono[i] += x[i] / C;
  for (let i = 0; i < N; i++) mean += mono[i];
  mean /= N;
  for (let i = 0; i < N; i++) sq += (mono[i] - mean) ** 2;
  let std = Math.sqrt(sq / Math.max(1, N - 1)) + 1e-8;
  return {
    norm: channels.map((x) => Float32Array.from(x, (v) => (v - mean) / std)),
    back: (ch) => {
      for (let i = 0; i < ch.length; i++) ch[i] = ch[i] * std + mean;
      return ch;
    },
    scale: (ch) => {
      for (let i = 0; i < ch.length; i++) ch[i] *= std;
      return ch;
    }
  };
}
async function hybridSegment(session, mix, want, n, hop) {
  let C = mix.length, L = mix[0].length, win = hann(n);
  let le = Math.ceil(L / hop), pad = (hop >> 1) * 3, F = n >> 1, bins = F + 1, scale = 1 / Math.sqrt(n);
  let spec = new Float32Array(C * 2 * F * le), wave = new Float32Array(C * L);
  mix.forEach((x, c) => {
    let padded = new Float64Array(le * hop + 2 * pad);
    for (let i = 0; i < padded.length; i++) padded[i] = x[reflectIndex(i - pad, L)];
    let { re, im } = stftFlat(padded, n, hop, win, true);
    let zr = spec.subarray(2 * c * F * le), zi = spec.subarray((2 * c + 1) * F * le);
    for (let f = 0, k = 0; f < F; f++) for (let t = 0, i = 2 * bins + f; t < le; t++, i += bins, k++) {
      zr[k] = re[i] * scale;
      zi[k] = im[i] * scale;
    }
    wave.set(x, c * L);
  });
  let inputs = session.inputs ?? [{ name: "mix" }, { name: "mix_spec" }];
  let out = await session.run({ [inputs[0].name]: tensor(wave, [1, C, L], "float32"), [inputs[1].name]: tensor(spec, [1, 2 * C, F, le], "float32") });
  let zs = outputOf(session, out, 0).data, xt = outputOf(session, out, 1).data;
  let T = le + 4, len = hop * le + 2 * pad, unscale = Math.sqrt(n), env = envelope(T, n, hop, win);
  return want.map((s) => Array.from({ length: C }, (_, c) => {
    let re = new Float64Array(T * bins), im = new Float64Array(T * bins), b = (s * 2 * C + 2 * c) * F * le;
    for (let f = 0, k = b; f < F; f++) for (let t = 0, i = 2 * bins + f; t < le; t++, i += bins, k++) {
      re[i] = zs[k] * unscale;
      im[i] = zs[k + F * le] * unscale;
    }
    let out2 = new Float64Array((T - 1) * hop + n);
    ola(rows(re, bins), rows(im, bins), out2, 0, n, hop, win);
    let x = olaFinish(out2, env, n, true, len);
    let y = new Float32Array(L), tb = (s * C + c) * L;
    for (let i = 0; i < L; i++) y[i] = x[pad + i] + xt[tb + i];
    return y;
  }));
}
async function separateHybrid(channels, rate, opts, graphs, load2) {
  let n = opts.n ?? 4096, hop = opts.hop ?? 1024;
  let C = channels.length, N = channels[0].length, { norm, back } = normalize(channels);
  let result = {};
  for (let g of graphs) {
    let session = await load2(g);
    try {
      let L = session.inputs?.[0]?.dims?.[2];
      L = typeof L === "number" && L > 0 ? L : opts.segment ?? 343980;
      let stride = Math.floor(0.75 * L);
      let starts = [];
      for (let s = 0; s < N; s += stride) starts.push(s);
      let half = L >> 1, tri = (k) => (k < half ? k + 1 : L - k) / half;
      let keep = g.keep.map((name) => g.sources.indexOf(name));
      let out = await overlapAdd(N, C, starts, L, tri, async (start, len) => {
        let from = start - (L - len >> 1);
        let seg = norm.map((x) => {
          let s = new Float32Array(L), a = Math.max(0, from);
          s.set(x.subarray(a, Math.min(N, from + L)), a - from);
          return s;
        });
        let stems = await hybridSegment(session, seg, keep, n, hop);
        let off = L - len >> 1, res = {};
        g.keep.forEach((name, i) => {
          res[name] = stems[i].map((ch) => ch.subarray(off, off + len));
        });
        return res;
      }, opts.progress);
      for (let name in out) result[name] = out[name].map(back);
    } finally {
      session.free?.();
    }
  }
  return result;
}
async function complexSegment(session, seg, want, n, hop, win, scale, T) {
  let C = seg.length, L = seg[0].length, F = (n >> 1) + 1, spec = new Float32Array(2 * C * F * T);
  seg.forEach((x, c) => {
    let padded = new Float64Array(Math.max(L, (T - 1) * hop));
    padded.set(x);
    let { re, im } = stftFlat(padded, n, hop, win, true);
    let zr = spec.subarray(2 * c * F * T), zi = spec.subarray((2 * c + 1) * F * T);
    for (let f = 0, k = 0; f < F; f++) for (let t = 0, i = f; t < T; t++, i += F, k++) {
      zr[k] = re[i] * scale;
      zi[k] = im[i] * scale;
    }
  });
  let name = session.inputs?.[0]?.name ?? "mix_spec";
  let z = outputOf(session, await session.run({ [name]: tensor(spec, [1, 2 * C, F, T], "float32") })).data;
  let env = envelope(T, n, hop, win);
  return want.map((s) => Array.from({ length: C }, (_, c) => {
    let re = new Float64Array(T * F), im = new Float64Array(T * F), b = 2 * (s * C + c) * F * T;
    for (let f = 0, k = b; f < F; f++) for (let t = 0, i = f; t < T; t++, i += F, k++) {
      re[i] = z[k] / scale;
      im[i] = z[k + F * T] / scale;
    }
    let out = new Float64Array((T - 1) * hop + n);
    ola(rows(re, F), rows(im, F), out, 0, n, hop, win);
    return olaFinish(out, env, n, true, L);
  }));
}
async function separateComplex(channels, rate, opts, graphs, load2, p) {
  let n = opts.n ?? p?.n ?? 4096, hop = opts.hop ?? p?.hop ?? 1024;
  let win = (opts.window ?? p?.window) === "ones" ? new Float64Array(n).fill(1) : hann(n), scale = opts.normalized ?? p?.normalized ?? true ? 1 / Math.sqrt(n) : 1;
  let C = channels.length, N = channels[0].length, zero = (opts.pad ?? p?.pad) === "zero";
  let { norm, scale: back } = opts.standardize ?? p?.standardize ?? true ? normalize(channels) : { norm: channels, scale: (c) => c };
  let result = {};
  for (let g of graphs) {
    let session = await load2(g);
    try {
      let T = session.inputs?.[0]?.dims?.[3];
      T = typeof T === "number" && T > 0 ? T : opts.frames ?? p?.frames;
      let L = opts.segment ?? p?.segment ?? (T - 1) * hop, step = Math.max(1, Math.floor(L * (opts.step ?? p?.step ?? 0.25)));
      let border = L - step, wide = border > 0 && (zero || N > 2 * border);
      let x = wide ? norm.map((c) => Float32Array.from({ length: N + 2 * border }, (_, i) => zero ? i < border || i >= border + N ? 0 : c[i - border] : c[reflectIndex(i - border, N)])) : norm;
      let M = x[0].length, fade = Math.floor(L * (opts.fade ?? p?.fade ?? 0.1)), starts = [];
      for (let s = 0; ; s += step) {
        starts.push(s);
        if (s + L >= M) break;
      }
      let keep = g.keep.map((name) => g.sources.indexOf(name));
      let acc = g.keep.map(() => Array.from({ length: C }, () => new Float64Array(M))), wsum = new Float64Array(M);
      for (let k = 0; k < starts.length; k++) {
        let start = starts[k], len = Math.min(L, M - start), reflect = !zero && len > L / 2;
        opts.progress?.({ chunk: k + 1, totalChunks: starts.length });
        let seg = x.map((c) => {
          let s = new Float32Array(L);
          for (let i = 0; i < L; i++) s[i] = i < len ? c[start + i] : reflect ? c[start + reflectIndex(i, len)] : 0;
          return s;
        });
        let stems = p?.mono ? [] : await complexSegment(session, seg, keep, n, hop, win, scale, T);
        if (p?.mono) for (let c = 0; c < C; c++) (await complexSegment(session, [seg[c]], keep, n, hop, win, scale, T)).forEach((st, j) => (stems[j] ?? (stems[j] = []))[c] = st[0]);
        for (let i = 0; i < len; i++) {
          let w = 1;
          if (k > 0 && i < fade) w = i / (fade - 1);
          if (k < starts.length - 1 && i >= L - fade) w = Math.min(w, (L - 1 - i) / (fade - 1));
          wsum[start + i] += w;
          for (let j = 0; j < keep.length; j++) for (let c = 0; c < C; c++) acc[j][c][start + i] += stems[j][c][i] * w;
        }
      }
      g.keep.forEach((name, j) => {
        result[name] = acc[j].map((a) => back(Float32Array.from({ length: N }, (_, i) => wsum[i + (wide ? border : 0)] > 0 ? a[i + (wide ? border : 0)] / wsum[i + (wide ? border : 0)] : 0)));
      });
    } finally {
      session.free?.();
    }
  }
  return result;
}
async function separateMultires(channels, rate, opts, graphs, load2, p) {
  let windows = opts.windows ?? p?.windows, hop = opts.hop ?? p?.hop ?? 256;
  let C = channels.length, N = channels[0].length, result = {};
  for (let g of graphs) {
    let session = await load2(g);
    try {
      let { starts, size, weight } = crossfadeChunks(N, rate, { ...opts, chunk: opts.chunk ?? p?.chunk });
      Object.assign(result, await overlapAdd(N, C, starts, size, weight, async (start, len) => {
        let res = Object.fromEntries(g.keep.map((name) => [name, []]));
        for (let c = 0; c < C; c++) {
          let x = channels[c].subarray(start, start + len), feeds = {};
          let specs = windows.map((n, r) => {
            let { re, im, T, bins: F } = stftFlat(x, n, hop, hann(n), true), mag = new Float32Array(F * T), k = 1 / Math.sqrt(n);
            for (let t = 0, i = 0; t < T; t++) for (let f = 0; f < F; f++, i++) mag[f * T + t] = Math.hypot(re[i], im[i]) * k;
            feeds[session.inputs?.[r]?.name ?? `mag_${n}`] = tensor(mag, [1, F, T], "float32");
            return { re: Float32Array.from(re), im: Float32Array.from(im), T, F };
          });
          let out = await session.run(feeds), acc = g.keep.map(() => new Float64Array(len));
          specs.forEach(({ re, im, T, F }, r) => {
            let n = windows[r], m = outputOf(session, out, r).data, mr = new Float64Array(T * F), mi = new Float64Array(T * F);
            g.keep.forEach((name, j) => {
              let b = g.sources.indexOf(name) * F * T;
              for (let f = 0; f < F; f++) for (let t = 0, i = f, q = b + f * T; t < T; t++, i += F, q++) {
                mr[i] = re[i] * m[q];
                mi[i] = im[i] * m[q];
              }
              let o = new Float64Array((T - 1) * hop + n);
              ola(rows(mr, F), rows(mi, F), o, 0, n, hop, hann(n));
              let y = olaFinish(o, envelope(T, n, hop, hann(n)), n, true, len);
              for (let i = 0; i < len; i++) acc[j][i] += y[i];
            });
          });
          g.keep.forEach((name, j) => res[name].push(acc[j]));
        }
        return res;
      }, opts.progress));
    } finally {
      session.free?.();
    }
  }
  return result;
}
function lufs(channels, rate) {
  let shelf = (G2, Q, fc) => {
    let A = 10 ** (G2 / 40), w = 2 * Math.PI * fc / rate, al = Math.sin(w) / (2 * Q), c = Math.cos(w), r = 2 * Math.sqrt(A) * al;
    return [A * (A + 1 + (A - 1) * c + r), -2 * A * (A - 1 + (A + 1) * c), A * (A + 1 + (A - 1) * c - r), A + 1 - (A - 1) * c + r, 2 * (A - 1 - (A + 1) * c), A + 1 - (A - 1) * c - r];
  };
  let pass = (Q, fc) => {
    let w = 2 * Math.PI * fc / rate, al = Math.sin(w) / (2 * Q), c = Math.cos(w);
    return [(1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al];
  };
  let filters = [shelf(4, 1 / Math.sqrt(2), 1500), pass(0.5, 38)], N = channels[0].length, T = 0.4, step = 0.25;
  let even = (v) => {
    let f = Math.floor(v), d = v - f;
    return d > 0.5 || d === 0.5 && f % 2 ? f + 1 : f;
  };
  let blocks = even((N / rate - T) / (T * step)) + 1;
  if (!(blocks > 0)) return -Infinity;
  let z = new Float64Array(blocks), G = [1, 1, 1, 1.41, 1.41];
  channels.forEach((x, c) => {
    let y = Float64Array.from(x);
    for (let [b0, b1, b2, a0, a1, a2] of filters) {
      b0 /= a0;
      b1 /= a0;
      b2 /= a0;
      a1 /= a0;
      a2 /= a0;
      let z1 = 0, z2 = 0;
      for (let i = 0; i < N; i++) {
        let v = y[i], o = b0 * v + z1;
        z1 = b1 * v - a1 * o + z2;
        z2 = b2 * v - a2 * o;
        y[i] = o;
      }
    }
    for (let j = 0; j < blocks; j++) {
      let lo = Math.trunc(T * (j * step) * rate), hi = Math.min(N, Math.trunc(T * (j * step + 1) * rate)), s = 0;
      for (let i = lo; i < hi; i++) s += y[i] * y[i];
      z[j] += (G[c] ?? 1) * s / (T * rate);
    }
  });
  let L = (v) => -0.691 + 10 * Math.log10(v), mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
  let abs = [...z].filter((v) => L(v) >= -70);
  if (!abs.length) return -Infinity;
  let rel = L(mean(abs)) - 10, gated = [...z].filter((v) => L(v) > rel && L(v) > -70);
  return gated.length ? L(mean(gated)) : -Infinity;
}
async function separateWaveform(channels, rate, opts, graphs, load2) {
  let C = channels.length, N = channels[0].length;
  let { starts, size, weight } = crossfadeChunks(N, rate, opts);
  let result = {};
  for (let g of graphs) {
    let session = await load2(g);
    try {
      let out = await overlapAdd(N, C, starts, size, weight, async (start, len) => {
        let data = new Float32Array(C * len);
        slice(channels, start, len).forEach((ch, c) => data.set(ch, c * len));
        let y = outputOf(session, await session.run({ [session.inputs?.[0]?.name ?? "input"]: tensor(data, [1, C, len], "float32") })).data;
        let res = {};
        for (let name of g.keep) {
          let s = g.sources.indexOf(name);
          res[name] = Array.from({ length: C }, (_, c) => y.subarray((s * C + c) * len, (s * C + c + 1) * len));
        }
        return res;
      }, opts.progress);
      Object.assign(result, out);
    } finally {
      session.free?.();
    }
  }
  return result;
}
function normalizeAudio(audio, opts) {
  let channelData, sampleRate;
  if (Array.isArray(audio)) {
    channelData = audio;
    sampleRate = opts.sampleRate;
  } else if (audio && audio.channelData) {
    channelData = audio.channelData;
    sampleRate = audio.sampleRate ?? opts.sampleRate;
  } else throw new Error("neural-separate: audio must be Float32Array[] or { channelData, sampleRate }");
  if (!sampleRate) throw new Error("neural-separate: sampleRate is required (opts.sampleRate, or audio.sampleRate)");
  if (!channelData.length) throw new Error("neural-separate: audio has no channels");
  return { channelData, sampleRate };
}
function fitLength(arr, len) {
  if (arr.length === len) return arr;
  let out = new Float32Array(len);
  out.set(arr.subarray(0, Math.min(len, arr.length)));
  return out;
}
async function separate(audio, opts = {}) {
  if (opts.dtype && opts.dtype !== "float32") throw new Error(`neural-separate: dtype '${opts.dtype}' not supported: only 'float32' tensor marshalling is implemented`);
  let { channelData, sampleRate: rate } = normalizeAudio(audio, opts);
  let { graphs, modelType, sampleRate: modelRate, targets, preset } = await resolveModel(opts);
  if (channelData.length === 1 && !preset?.mono) channelData = [channelData[0], channelData[0]];
  let empty = () => channelData.map(() => new Float32Array(0));
  if (!channelData[0].length) return { stems: Object.fromEntries(targets.map((t) => [t, empty()])), sampleRate: rate, residual: empty() };
  let targetRate = opts.targetRate ?? modelRate ?? rate;
  let proc = targetRate !== rate ? channelData.map((c) => resample(c, { from: rate, to: targetRate })) : channelData;
  let load2 = loader(opts, preset);
  let level = preset?.loudness == null ? -Infinity : lufs(proc, targetRate), gain = Number.isFinite(level) ? 10 ** ((preset.loudness - level) / 20) : 1;
  if (gain !== 1) proc = proc.map((c) => c.map((v) => v * gain));
  let stemsAtRate = modelType === "hybrid" ? await separateHybrid(proc, targetRate, opts, graphs, load2) : modelType === "complex" ? await separateComplex(proc, targetRate, opts, graphs, load2, preset) : modelType === "multires" ? await separateMultires(proc, targetRate, opts, graphs, load2, preset) : modelType === "waveform" ? await separateWaveform(proc, targetRate, opts, graphs, load2) : await separateSpectral(proc, targetRate, opts, graphs, modelType, load2);
  let N = channelData[0].length;
  let stems = {};
  for (let name of targets) stems[name] = stemsAtRate[name].map((c) => {
    if (gain !== 1) c = Float32Array.from(c, (v) => v / gain);
    return fitLength(targetRate !== rate ? resample(c, { from: targetRate, to: rate }) : c, N);
  });
  let residual = channelData.map((c, ci) => {
    let r = Float32Array.from(c);
    for (let name of targets) {
      let s = stems[name][ci];
      for (let i = 0; i < N; i++) r[i] -= s[i];
    }
    return r;
  });
  return { stems, sampleRate: rate, residual };
}
export {
  REVISIONS,
  models,
  separate
};
