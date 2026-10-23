# Audio → TAB engine: review of the proposal, tool decisions, build plan

Review of *"High-Fidelity Audio-to-TAB Engine for TabTranslator Pro: Integration-Ready
Architecture (revised)"*, checked against this repo's invariants and the tools this
environment can reach. Written 2026-10-23. Every number below was measured or looked up in
this session. Anything not measured is labelled as a hypothesis.

---

## 1. Verdict

**The architecture is sound and the papers it cites are real.** I checked each one:

| Cited work | Status | What it gives us |
|---|---|---|
| TART (arXiv 2609.11904, Sep 2026) | Real. Its HF paper page links **no models, datasets or Spaces**. | The 4-stage pipeline and the zero-shot targets (81.35 F50, 71.8 string-fret Tab F1, 54.08 end-to-end Tab F1) |
| Noise2Fret (arXiv 2608.30854) | Real (diffusion model; 5 playability losses) | The loss terms. We use them as DP costs, not as training losses (§3) |
| Fretting-Transformer (arXiv 2506.14223) | Real (T5 MIDI→tab). No linked weights | The learned Stage 3 lineage |
| Pitch-validity constrained decoding (arXiv 2607.26440) | Real | Masking invalid string/fret candidates. A DP gets this for free |
| GuitarSet | **CC-BY 4.0, on HF** (`jhartquist/guitarset`, v1.1.0, errata fixed) | The real-audio benchmark this repo has never had |
| Guitar transcription weights (Riley et al., arXiv 2402.15258 / GAPS 2408.08653) | **MIT, on HF** (`xavriley/midi-transcription-models`: `guitar-gaps.pth` 99 MB fp32) | A Stage 1–2 model that ships with a usable licence. State of the art zero-shot on GuitarSet, and the same lineage as TART's Stage 1 |
| MERT (`m-a-p/MERT-v1-95M` / `-330M`) | **CC-BY-NC-4.0** (non-commercial) | See conflict 2 |

**Five parts of the proposal conflict with how this app is built.** Each one has a better
alternative:

1. **"Cloud (CUDA) does string-fret, quantization, final export; cloud finalization
   mandatory before export."** The whole app family is zero-server, client-side,
   iOS-Safari-first and hosted on GitHub Pages. A required cloud step would undo that. →
   **The browser is the product.** A cloud lane can only ever be an opt-in extra or a
   dev-time oracle. It must never be a gate.
2. **MERT as a third encoder stream.** It is non-commercial, and 95M–330M parameters is
   roughly 380 MB–1.3 GB in fp32. A 13 MB SCNet already got the iPhone tab killed before the
   low-memory work (CLAUDE.md, #109–#112). → **MERT stays out of the shipped path.** At most
   it is a dev-time teacher for distillation, if the licence fits the owner's plans.
3. **"MusicXML → AlphaTab normalization layer + AlphaTex fallback."** This app doesn't render
   with AlphaTab. The sibling `chord-sheet-maker` does. And `.gp` (GP7/8) is a ZIP of GPIF
   XML that we already parse (`parseGPIF`, `gpUnzip`). → **Write AlphaTex and `.gp`
   directly**, string and technique included. A format that carries the string explicitly has
   no string-visualisation artifacts, so the normalisation layer isn't needed.
4. **Demucs v4.** htdemucs weights are research-only, and that is why SCNet was shipped
   instead (CLAUDE.md, v2.1). The real gap is that no openly licensed model separates guitar
   from keys. → Keep SCNet for 4 stems. A user can still import guitar stems from Moises or
   AudioPod (see §2).
5. **"Joint training objective across stages."** This container has no torch, no GPU and no
   annotated guitar audio. → **We already own a large, exact fingering corpus**: 78 Guitar Pro
   files, giving **281 standard-tuned tracks and 151,248 notes with written string+fret**. The
   parsers also already read the technique bytes (bend, slide, hammer, harmonic, palm mute,
   dead note) and currently throw them away. That is the training and evaluation substrate
   (§3).

---

## 2. Connectors, skills and plugins: which to use

### Use

| Tool | Role in this build | Status here |
|---|---|---|
| **Hugging Face connector** (`hf_fs`, `hub_repo_details`) | Model/dataset discovery and licence checks. Used in this review: GuitarSet licence, xavriley weights, MERT licence, TART has no released weights | Works (authenticated read) |
| **`huggingface-skills:hf-cli`** | Download GuitarSet; publish our converted ONNX models to the owner's HF repo (pinned revision + SHA-256, same pattern as SCNet) | **Works without a token for public repos.** `pip install --user huggingface_hub` → `~/.local/bin/hf` (v2.3.0); `huggingface.co`, its Xet CDN and PyPI are all reachable. Anonymous `hf download` of `xavriley/midi-transcription-models` and `jhartquist/guitarset` was verified. A token (`HF_TOKEN`, write scope) is only needed to **upload**. The containers are ephemeral, so add the install to the environment's setup script. The plugin's own MCP server needs authorization, but it duplicates the claude.ai Hugging Face connector, which works |
| **`huggingface-skills:hf-mem`** | Estimate model memory **before** adopting it. iOS memory is the constraint that has broken things before | Same as above |
| **`huggingface-skills:transformers-js`** | Only if the learned Stage 3 (T5) earns its place: browser seq2seq on WASM/WebGPU | Same ORT/WebKit caveats as SCNet (§5) |
| **`huggingface-skills:huggingface-datasets`** | Inspect GuitarSet/EGDB splits and schema without downloading | — |
| **`huggingface-skills:huggingface-spaces` / `-zerogpu`** | **Optional** cloud lane: convert `guitar-gaps.pth` → ONNX (needs torch), or serve a heavy teacher model for dev comparisons. Never in the shipped path | Needs HF auth |
| **Firecrawl research** (`firecrawl_research_*`) | Literature verification (used above); next for technique-classification and string-timbre papers | Works |
| **AudioPod connector** (`separate_stems` 6stem incl. **guitar**, `audio_to_midi` guitar) | **Dev-time oracle only**, like PyGuitarPro was for GP3/4/5: a second opinion on real songs. Not shippable: it's server-side, spends credits, takes URLs only, and its key would leak from a static page | The claude.ai connector works (it is routed through Anthropic's MCP proxy). The `audiopod` **plugin** connects straight to `mcp.audiopod.ai:443`, which the environment's network policy denies (proxy 403). The fix is to add that host under Allowed domains, or to skip it and use the connector |
| **Play Sheet Music** | Listen to exported tab/ABC (it already validated ABC in this repo) | Works |
| **GitHub MCP** | PRs per stage | Works |
| **`/code-review`** skill | Before each stage merges | — |

### Not relevant to this build

SEO and marketing (Ahrefs, Semrush, Ubersuggest, OpenSEO, OpenRush), messaging (Bird, Gmail,
Calendar), commerce (Shopify, Stripe, PayPal), Airtable, Jotform, Notion, Yelp, TinyFish,
Google Drive/Docs. **Vercel**, Netlify and Replit would only matter if the owner chose to
host a cloud lane (Netlify and Replit also need authorization). **Magic Patterns** could
mock up the correction UI, but the UI there is small and follows the existing `ChordReview`
pattern. **`audiorective`** is not needed: the app has its own Web Audio glue.

---

## 3. Where this goes beyond the proposal

### 3.1 The corpus is the oracle

Every GP track gives two kinds of ground truth:

- **Audio-free Stage 3 ground truth.** Strip the fingering, re-finger the pitches, and
  compare to what the transcriber wrote.
- **End-to-end ground truth.** Render the track through the bench's Karplus–Strong guitar
  (`tests/bench/lib.mjs`) and you have audio with exact string, fret and technique labels. This
  is the proposal's "tablature-first synthesis", and the renderer already exists.

**Measured today** (`node tests/bench/fingering.mjs`, even files = dev, odd = test; the
heuristic was not tuned):

| Split | Tracks | Notes | Lowest-fret | Viterbi DP (span ≤ 4, hand-move cost) |
|---|---|---|---|---|
| dev | 135 | 71,289 | 60.5 % | 66.9 % |
| test | 146 | 79,959 | 50.4 % | **58.1 %** |

This is the P0 baseline the proposal asks for, reproducible in 1–2 minutes, with no
download. The metric is the share of notes that land on the written string. Note that it is
not GuitarSet Tab F1, because the corpus mixes jazz heads, comping and rock. Every Stage 3
idea is now one number to move on the held-out half.

### 3.2 Stage 3: the DP is the oracle, a model is the second opinion

This follows the contract `arbitrateChord` already uses. The rule-based layer is the oracle
and the test oracle, and the model can only win when the oracle is unsure.

- **Pure-JS Viterbi** over per-event fretboard shapes, in `engine.tsx`, headless-tested.
  Hand span is a **hard constraint** (shapes that exceed it are never states), which is what
  the proposal itself requires. Pitch validity holds by construction. The Noise2Fret terms
  become **costs**, not losses: positional distance, string crossing, open-string preference,
  fret height, and circle-of-fifths distance between hand positions. All of them are
  tunable on the dev half.
- **Learned priors from the corpus at zero runtime cost.** Bigram statistics of
  (Δposition, Δstring, shape class) mined from the 281 tracks become a transition table. It is
  small enough to embed, the same way `CHORD_CLASSIFIER` is.
- **Learned second opinion** (Fretting-Transformer-style T5 via transformers.js) only if it
  beats the tuned DP on the held-out half by a margin that justifies its size. That has to be
  measured before it is built.
- **Personalization** is an additive per-user cost table, filled from corrections the user
  makes in a review UI and stored in `localStorage`/OPFS. It is explainable and has no
  retraining loop. This is the proposal's "linear correction on the logits", expressed in DP
  terms.

### 3.3 Audio-conditioned string evidence without a large model (hypothesis, to measure)

The same pitch on different strings differs physically: string gauge, partial decay and
inharmonicity. If per-note spectral features separate the candidate strings, they become an
**emission term in the same DP**, and that is the audio conditioning. GuitarSet records a
**hexaphonic pickup, one channel per string**, so the hypothesis can be tested on real audio.
The current Karplus–Strong renderer does **not** model string-specific timbre, so this can't
be measured on the synthetic bench. GuitarSet is the gate.

### 3.4 Techniques: capture them, don't infer them

`_gpReadNoteEffects`, `_gpReadBend` and the GP5 note reader already consume the bend, slide,
hammer/pull, harmonic, palm-mute and dead-note bytes in order to stay aligned. Keeping those
flags is the same zero-alignment-risk change the tuplet work made. It gives (a) labels for a
technique classifier, (b) technique-aware tab export, and (c) the conditioning the proposal
wants for Stage 3.

### 3.5 Stage 1–2 model: MIT weights, on the worker infrastructure we already have

The candidate is `guitar-gaps.pth` (99 MB fp32). **Assumption, not measured:** int8 ONNX
should come to roughly a quarter of that. It would run through the existing stem-worker
path, which already has the pinned ORT 1.23.2 plain WASM build, the SHA-256 check, Cache API
caching, the WASM-memory cap, the crash rail and the WebKit rules. basic-pitch, already
shipped, stays the fallback. Converting the weights needs torch, which means either an HF
Space/Job or the owner's machine.

---

## 4. Build plan (re-sequenced for this repo)

Each step is additive, keeps `npm test` green, and must leave the validated corpus
byte-identical.

| Phase | Deliverable | Gate (measured, held-out) | Needs |
|---|---|---|---|
| **P0a** ✅ | `tests/bench/fingering.mjs`, the corpus fingering benchmark | Baseline recorded: **58.1 %** test | — |
| **P0b** | `fingerScore(score, opts)` in `engine.tsx`: tuned Viterbi + corpus transition priors. Gives audio and ML charts a `{tab}` block (the "Stage E" CLAUDE.md lists as not built) | Beat 58.1 % on test; target ≥ 70 % | Nothing external |
| **P0c** | Technique flags captured in GP3/4/5/GPIF parsers → `event.tech` | Corpus guards stay byte-identical | Nothing external |
| **P0d** | `scoreToAlphaTex` + `scoreToGP` (GPIF zip via `CompressionStream`) exporters carrying string + technique | Round-trip through our own `parseGPIF`; opens in chord-sheet-maker's AlphaTab | Nothing external |
| **P1** | GuitarSet harness (`tests/bench/guitarset.mjs`): Tab F1, string-fret F1, a noisy variant from day one | Report basic-pitch + DP end-to-end Tab F1 (the proposal's P0 baseline, on real audio) | Nothing external. Anonymous `hf download` works |
| **P2** | Stage 1: `guitar-gaps` → int8 ONNX in the worker | ≥ 80 % F50 zero-shot on GuitarSet; fits the iPhone memory envelope | torch for the conversion, **in this container**: the PyPI build is reachable (~3 GB with its CUDA libraries; 30 GB free). Allowing `download.pytorch.org` gives the ~200 MB CPU build instead. No cloud needed. A write token is only needed to publish the ONNX to HF; otherwise it is vendored same-origin like `models/scnet-compact/` |
| **P3** | Audio string evidence (§3.3) as a DP emission; tab review UI that reuses `ChordReview` + personalization table | String-fret Tab F1 ≥ 70 % zero-shot (TART's level) | GuitarSet hex channels |
| **P4** | Technique classifier (small, on note-aligned segments, trained on rendered + GuitarSet audio); learned Stage 3 only if §3.2 shows it pays | ≥ 75 % technique accuracy; < 10 % F1 drop on the noisy variant | A training environment |

---

## 5. Constraints carried over (don't relearn them)

- iOS memory: model weights are rarely what kills the tab. The activation working set is
  (CLAUDE.md, low-memory SCNet). Measure peak RSS on a 4-minute song before shipping a model.
- WebKit: plain WASM only, ORT 1.23.2, no WebGPU (microsoft/onnxruntime#33426 and #26827).
- No `accept` filter on uploads (iOS UTI greying).
- Downbeats: pure-DSP downbeat detection was measured and does not work. The beat-aware
  quantizer the proposal wants needs a learned downbeat model. It is not a heuristic to bolt on.

## 6. Owner decisions (answered 2026-10-23)

1. **Cloud lane: not now.** The owner builds on iPad/iOS. A Linux laptop comes later for
   publishing and monetising. Every phase above therefore runs in this container or on the
   device, and the cloud lane stays a future option, never a dependency.
2. **Commercial intent: yes** (the app will be monetised). **MERT (CC-BY-NC-4.0) is excluded
   entirely, even as a dev-time teacher.** Every adopted model must carry a commercial-use
   licence: MIT (`xavriley`, SCNet weights), Apache-2.0 (basic-pitch), CC-BY-4.0 data
   (GuitarSet, with attribution).
3. **Hugging Face token: optional.** Reading public models and datasets needs none. A
   write-scoped token in the environment's Network secrets / environment variables
   (`HF_TOKEN`) is only for publishing converted models to the owner's HF account.
