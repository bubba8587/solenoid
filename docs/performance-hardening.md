# Solenoid — Performance Hardening (investigation 2026-06-24)

> Investigation into *architectural* performance, not FPS tricks. Trigger: the
> Personal Finance seed (140 nodes / 135 cables — not large) takes a couple
> seconds to load, stutters on pan/zoom even when nothing moves, and **crashes
> the tab** when you select-all + copy-paste it into itself. Goal: robustness
> and scaling headroom, not micro-tuning.

Combines a codebase diagnosis (load path, pan/zoom path, paste crash) with
external research on how Rete v2 / React Flow / tldraw / Excalidraw / HyperFormula
harden at scale. Sources are inline as URLs.

---

## The one-sentence diagnosis

All three symptoms share one root: **Solenoid recomputes-all and renders-all with
no dirty-tracking, and outside the load path it has no batching gate on bulk
mutation** — so every edit recomputes the whole graph, every bulk add recomputes
it once *per item*, and the cable layer does O(cables²) work tied to render. The
fix is incremental, gated recompute — which Rete v2 already supports more than we
use.

---

## Root cause A — `processGraph()` is recompute-all + render-all

`process.ts` `processGraph()`:
1. `_engine.reset()` — **full** cache wipe (every node recomputes next fetch).
2. `await _engine.fetch(node.id)` for sink nodes — pull-based, memoized per node.
3. `await _area.update("node", node.id)` for **every** node, sequentially.

So one call = re-fetch the world + re-render the world, N sequential `area.update`
awaits. Called on every edit, and (see C) once per cable during paste.

**What Rete already gives us that we don't use** (verified in installed source,
`node_modules/rete-engine/rete-engine.esm.js`, and
https://raw.githubusercontent.com/retejs/engine/main/src/dataflow-engine.ts):

- `engine.reset(nodeId)` does a **targeted** invalidation — it deletes that node's
  cache entry and recurses along **outgoing** connections (its downstream
  dependents). *(Note: the JSDoc says "predecessors" but the code resets
  successors — the code is right for edit-invalidation; trust the code.)* We call
  the argument-less `reset()` (wipe all) instead.
- Adding/removing a connection does **not** invalidate the engine cache at all
  (the DataflowEngine pipe only listens to `nodecreated`/`noderemoved`). So bulk
  wiring is free on the engine side; the cost we see is self-inflicted by our
  Canvas pipe (root cause C).

**Investments:**
- **A1 (small, high value):** targeted invalidation — on a single-node edit, call
  `engine.reset(editedNodeId)` and re-fetch only affected sinks, instead of
  `reset()` + fetch-all. Untouched branches stop recomputing. Payoff scales with
  graph width.
- **A2 (small):** render only dirty nodes — track which node *values* changed and
  `area.update` only those, not all N. Today a one-cell edit re-renders 140 nodes.
- **A3 (medium, biggest payoff):** **early cutoff** (salsa-rs / Adapton pattern,
  https://github.com/salsa-rs/salsa, http://matthewhammer.org/adapton/adapton-pldi2014.pdf):
  after recomputing a node, if its output equals the cached value, stop
  invalidating its dependents. Turns "edit a value that doesn't change a filtered
  result" into a near no-op down a deep chain.
- **A4 (small):** coalesce edit bursts (slider drag, multi-cell paste) into one
  settle — HyperFormula's `suspendEvaluation`/`resumeEvaluation`
  (https://hyperformula.handsontable.com/guide/performance.html).

Prior art: HyperFormula, a mature spreadsheet engine, concluded **incremental
dependency-graph recalc was the high-value win** and that worker/GPU parallelism
was *not* worth shipping by default (https://github.com/handsontable/hyperformula/discussions/566,
issue #812). Strong prior: do dirty-recompute first.

---

## Root cause B — load is ~415 sequential awaits + a recompute at the end

`persistence.ts` `rebuildGraph()`:
- Node loop: `await editor.addNode` + `await area.translate` per node = **2N** awaits
  (~280 for PF), each gated on the prior node's DOM mount/layout settling.
- Connection loop: `await editor.addConnection` per cable (~135 awaits).
- One `processGraph()` at the end (correctly gated — see C).
- The **cinematic reveal** (`loadReveal.ts`) adds staged fade-in on top — but
  **author confirms load is slow even when the cinematic doesn't run** (browser
  reload / most doc loads snap, no reveal). So the reveal is NOT the load cost;
  the build loop + the final render-all ARE. (Earlier "skip the reveal" idea
  retracted — it isn't the bottleneck.)

The per-node cost is **render**, not compute: each `addNode` makes the area plugin
create the node's DOM + emit a render; each node is its own React root, so there's
no cross-node batching (rete-react-plugin renders one root per node — this is
inherent, https://retejs.org/docs/best-practices/performance/). Socket positions
are then measured from the DOM (`getDOMSocketPosition` + `MeasuredSocketRow`
`useLayoutEffect`), a forced reflow per row.

**Investments:**
- **B1 (small):** parallelize the build — collect `addNode`/`translate` promises and
  `Promise.all` them instead of 2N sequential awaits (the community-blessed import
  pattern, https://github.com/retejs/rete/discussions/621). Removes serialization;
  does **not** remove per-node DOM render cost.
- **B2 (small):** the final `processGraph()` re-renders **all** N nodes via a
  sequential `await area.update` loop (`process.ts`). On first load every node is
  new so this is unavoidable, but the loop is serial — batch it / drop the per-node
  await.
- **B3 (medium):** the real floor is N separate React roots + N socket-measure
  reflows at mount (`getDOMSocketPosition` + `MeasuredSocketRow` `useLayoutEffect`
  per row — a forced reflow each). Memoization doesn't help *first* mount; the lever
  is doing fewer synchronous layout reads (batch socket measurement into one
  read/write pass instead of per-row interleaved). The per-node React root is
  inherent to rete-react-plugin and not removable without swapping renderers.
- **(retracted) skip the cinematic reveal** — author confirms it doesn't fire on
  most loads yet load is still slow, so it was never the cost.

---

## Root cause C — paste isn't gated → O(N²) settle → the crash

**Verified.** `copyPaste.ts` `pasteClipboard()` (lines 121–193) adds every node and
every connection in a loop, then calls `processGraph()` **once** at the end (line
192) — which *looks* correct. But it never wraps the loop in
`beginGraphRebuild()`/`endGraphRebuild()`. So every `await editor.addConnection()`
(line 179) fires the `connectioncreated` pipe in `Canvas.tsx` (line 2272), whose
body runs **only when `!isGraphRebuilding()`**:

```
reconcileFcTypes(editor, area);   // scan every FC × every cable
bumpConnectionVersion();
rescanMismatches();               // nested loop over cables
processGraph();                   // FULL recompute + render-all
syncGroupCollapse(editor, area);
```

The load path avoids all of this because `rebuildGraph` *does* wrap itself in the
gate (`persistence.ts:202/235`) — that's the whole point of the gate, and a code
comment at `Canvas.tsx:2261` literally explains it. Paste (and any other bulk
mutation that doesn't set the flag) is the odd one out.

Doubling PF → ~280 nodes / ~270 cables, with `processGraph()` (≈O(N) fetch +
render-all) fired ~135 times + `rescanMismatches()` growing O(cables²) → tens of
thousands of full re-renders synchronously on the main thread → **tab freeze /
crash**. It's a compute-blowup freeze, not primarily OOM.

**Investments:**
- **C1 (small, fixes the crash — do first):** wrap `pasteClipboard`'s add loops in
  `beginGraphRebuild()` / `endGraphRebuild()`, exactly like `rebuildGraph`. Turns
  paste from O(N²) → O(N): one settle at the end. This is the single
  highest-ROI change in the whole investigation.
- **C2 (small, robustness):** audit **all** bulk-mutation entry points for the gate
  (paste, duplicate, undo/redo restore, drag-drop multi-add, programmatic group
  ops). Anything that adds >1 node/cable in a loop must hold the gate. Consider a
  `withGraphRebuild(fn)` helper so it can't be forgotten.
- **C3 (small, last-resort safety):** chunk very large adds across animation frames
  (yield to the event loop every K items) so a pathological paste degrades to "slow"
  instead of "crashed tab." Belt-and-suspenders on top of C1.

---

## Root cause D — pan/zoom (NOTE: the "paint-bound" framing below was later DISPROVEN — see FINAL VERDICT)

Verified two ways. (1) rete applies pan/zoom as a **single CSS `transform` on one
holder div** — zero React, no per-node re-render
(https://raw.githubusercontent.com/retejs/area-plugin/main/src/area.ts). (2) A code
trace of the idle-pan path confirms **no JS re-render happens**: the `translated`/
`zoomed` pipe (`Canvas.tsx:2529`) only calls `syncBackground()` (DOM-write only);
`ConnectionComponent`'s store subscriptions are silent when nothing changes; and
`getCablePath()` is behind a per-cable path-solve cache keyed on geometry
(`ConnectionComponent.tsx:134`), so it doesn't re-solve on pan. **The "our code
re-renders on pan" hypothesis is exonerated.**

So the in-viewport stutter is **browser paint/composite of the visible vector
content** (cables especially) when the holder transforms. This is exactly why the
author's note holds: **viewport culling didn't help — the cost is the *visible*
cables, which you can't cull.**

**Most of the tractable levers here are already done** (kept from the 2026-06-19
canvas session — dev-notes "Canvas cable layer"): per-connection path-solve cache,
**bounded per-cable SVG bbox** (was 9999×9999 → content box, ~100× less layer
memory, lets the compositor cache cable textures instead of repainting), narrowed
socket-hover subscription, gesture hover-gate, rAF lasso/standoff throttle,
**box-shadow dropped during pan** (`canvas.css` `--panning`), **flow-bead animation
paused during pan**, transient drag-layer GPU promotion, and a zoom-time
`will-change` on the holder. The obvious cheap wins are spent.

**What's left for pan/zoom — small, worth trying, diminishing:**
- **D1 (small):** set `will-change: transform` on the holder during a **plain pan**
  too, not just zoom — today the pipe comment says "a plain pan needs nothing"
  (`Canvas.tsx:2533`), but xyflow found holder promotion gave "buttery smooth pan"
  (https://github.com/xyflow/xyflow/discussions/4617). One-line experiment; watch
  layer-memory on huge graphs.
- **D2 (small, only if a profiler shows it):** drop the selected-Conduit
  `filter: drop-shadow` (`conduit.css:42`) during pan, like box-shadow already is — a
  GPU-expensive filter that repaints the selected node each frame.
- **D3 (medium — the one "different plan" not yet tried):** collapse the **N
  per-cable `<svg>` wrappers into ONE shared SVG** (paths keyed by connection id).
  Keeps SVG rendering, so **no anti-aliasing colour shift** — the exact thing that
  killed the canvas attempt — while cutting the composite-layer/element count from
  ~135 to 1. Friction: rete mounts each connection as its own React component, so
  this means rendering the cable layer ourselves from one component subscribed to all
  connections, bypassing the per-connection preset. **Profile first** to confirm pan
  is composite-layer-bound (many small layers) vs repaint-bound — the fix differs and
  I won't guess.

**Honest bottom line on pan/zoom:** at ~140 nodes the cheap and medium DOM/SVG levers
are essentially exhausted. Past D1–D3, the only remaining lever is a fundamental
renderer change (canvas/WebGL for the *whole* canvas, not just cables) — which fights
Solenoid's interactive-DOM identity and the "cables never change appearance" rule.
**Pan/zoom has the least headroom of the three symptoms; spend the "larger
investment" energy on the crash (C) and the compute model (A), which are tractable
and not yet attempted.**

---

## Root cause E — scaling levers, and the two that were ALREADY TRIED

To make hundreds→thousands robust *eventually* (not today's bottleneck):

- **E1 — Viewport culling — TRIED, didn't help; LOD already partly in place.** The
  author reports a prior culling attempt didn't move the needle, because the cost is
  in-viewport (root cause D). A CSS **LOD** path already exists (`canvas.css`
  `--lod1`/`--lod2` hide node interiors via `visibility:hidden` at low zoom). Full
  off-screen `display:none` culling (tldraw-style,
  https://tldraw.dev/sdk-features/performance; rete LOD example
  https://retejs.org/examples/lod) only helps the *mount/DOM-count* ceiling, which
  per the author is **not** the current bottleneck. Revisit only if profiling at much
  higher node counts shows cost scaling with total (not visible) count. Caveats
  remain: no help to initial load; defeated when zoomed out (React Flow issue #3883).
- **E2 — LOD placeholders (medium).** Extend `--lod2` toward true placeholder
  rectangles below a zoom threshold for the zoomed-out case. Low priority given E1.
- **E3 — Canvas cable overlay — TRIED AND REVERTED (2026-06-19, `cableCanvas.ts`;
  dev-notes "Canvas cable layer").** Idle cables drawn as `Path2D` on one canvas (same
  geometry `ConnectionComponent` published); selected/hover/flow stayed SVG. **Reverted
  for three reasons a retry MUST beat:** (1) *no reliable win* — canvas is immediate-mode
  and full-clears, redrawing **every** visible cable each frame, while SVG only
  re-rasterizes cables that **changed**; for a few-cables-move gesture it was a wash or
  worse (canvas only wins when nearly everything repaints at once). (2) *appearance
  shift* — canvas vs SVG anti-alias a thin semi-transparent stroke differently → visible
  colour shift on layer toggle, violating the hard "cables never change appearance" rule.
  (3) a sync bug double-painting during the async React swap. **Preconditions for any
  retry:** dirty-region / partial redraw (never full-clear per frame), an AA match (or go
  canvas-only so there's no toggle), decoupled swap. **D3 (single shared SVG) is the
  lower-risk cousin** — same "fewer layers" goal without the colour-shift trap.
  Industry says canvas earns its keep only far past Solenoid's scale: tldraw is migrating
  overlays SVG→canvas (https://github.com/tldraw/tldraw/issues/8314); Cytoscape canvas
  hits 3 FPS at ~3k nodes/68k edges vs tens of thousands on WebGL
  (https://blog.js.cytoscape.org/2025/01/13/webgl-preview/).
- **E4 — Web Worker compute offload (large) — subsumed by the roadmap.** Phase-2 moves
  the relational engine to **Polars in the Tauri/Rust backend**, off the JS main thread —
  that is the real E4 for frames. Don't build a throwaway JS-worker engine (Comlink,
  https://github.com/GoogleChromeLabs/comlink) Polars will replace.

There is **no drop-in Pixi/WebGL renderer for rete** (retejs org has no pixi repo); any
GPU move is custom. ComfyUI/LiteGraph went canvas→DOM for node-UX richness — the
opposite direction — a caution that canvasing the *nodes* fights Solenoid's thesis.

---

## Implemented 2026-06-24 (branch claude/mobile-function-reference-ux-lzk3r6)

Shipped as isolated, revertable commits:
- **C1** — gate paste's connection loop (the crash fix) + a registered `bulkSettle`.
- **C2** — `withGraphRebuild()` helper + dirty-flag; gate undo/redo bulk settles.
- **B1** — parallelize the load build loop (`Promise.all` add+translate).
- **B2** — de-serialize `processGraph`'s node render loop.
- **A1+A2** — `processGraph(changedNodeId?)` targeted reset + render the downstream
  cone only; wired at InlineInputs + the slider. `processTargeted.test.ts` guards the
  cone. Opt-in, so every un-migrated call site keeps the full-reset behavior.
- **A3** — early-cutoff within the cone (render only nodes whose output changed +
  fed sinks).
- **D1** — GPU-promote the holder during a plain desktop pan (`onViewportActivity`).
- **D2** — drop the selected-Conduit drop-shadow filter during pan.

Follow-up round (after author tested the first batch — paste still hung, zoom choppy
on a duplicated graph, no probes wanted):
- **C1b** — gate + parallelize paste's NODE loop. The first fix gated only the
  *connection* loop; the node loop was still ungated+sequential, so each addNode fired
  the live "absorb into containing group" sweep (O(nodes) each) → O(N²) — the remaining
  hang. Now the whole paste is gated (pasted nodes keep their copied membership) and
  mounts run concurrently.
- **C1c** — paste renders only the pasted nodes. Additive `bulkSettle(renderOnly)` /
  `processGraph(_, renderOnly)` mode: a paste is a self-contained copy, so skip the
  engine reset (originals keep caches) and re-render only the new set — halves the
  final settle on paste-into-self.
- **D2b** — drop node shadows / conduit filter / flow beads during WHEEL zoom too. The
  `--panning` class is added on pointerdown, which wheel-zoom never fires, so every
  visible node repainted its (expensive) box-shadow each zoom frame. onViewportActivity
  now toggles a `--zooming` class the same drop rules match.
- Zoom on a dense ~280-node graph remains partly limited by the holder layer
  (collapsed members are `visibility:hidden`, so they keep layout extent + DOM count).
  The one structural lever left is `display:none`-on-collapse + a forced socket
  re-measure on expand — risky (touches the socket-measurement invariants), deferred
  unless it proves necessary in normal-size use.

Second follow-up round (author tested the deploy):
- **REVERTED D1 + D2b.** Author: cables/nodes look significantly worse panning/zooming
  — border thickness + opacity change (thin vector strokes resampled when the holder is
  rasterized to a GPU texture) — with NO actual perf gain. The original code
  deliberately did NOT promote the holder on pan (its own comment: the holder exceeds
  the GPU max texture and tiles/re-rasterizes). D1 overrode that on external advice and
  reintroduced exactly that artifact. Reverted both, restoring the author's tuned
  zoom-only promotion. **Lesson: the holder-promotion design was already tuned; don't
  re-litigate it from generic web advice.** Pan/zoom perf on a dense graph is at the
  DOM/SVG floor; no safe JS/CSS lever found — the real levers (culling, canvas,
  display:none-collapse) are tried/reverted/deferred.
- **Bulk DELETE gated** (was never gated — same O((nodes+cables) × nodes) hang as paste/
  undo). `deleteSelected` now wraps its removal in begin/endGraphRebuild and runs one
  ordered settle (forgetNode → rebuildGroupMembership → bulkSettle → restoreSettledPushes).
- **Bulk paste** confirmed by author as significantly better (C1b/C1c).
- **D3 — DEFERRED (profile-gated, author decision 2026-06-24).** A chunked shared-SVG
  cable layer is a large rewrite of the 735-line ConnectionComponent (ribbons, angles,
  hover/selection, flow, rete's per-connection `useConnection`) and "cables must not
  change appearance" is a hard rule that already killed the canvas attempt. D1 (holder
  promotion) likely captured most of the pan-paint win, leaving D3's benefit as mostly
  DOM-element-count reduction. Revisit ONLY if a profiler trace on the real build, AFTER
  D1, still shows the cable layer as the pan bottleneck. Then prefer the
  groups-first chunk (both ends in one group → one SVG) as the smallest step.

## Recommended sequencing (revised after author's notes: culling tried, canvas
## reverted, load slow without the cinematic)

The two symptoms with real, untried headroom are the **crash** and the **compute /
load model**. Pan/zoom is paint-bound and its cheap+medium levers are already spent
or reverted — so it's deprioritized, not because it doesn't matter but because the
ROI is now low.

1. **C1** — gate `pasteClipboard` (fixes the crash). Tiny diff, eliminates a whole
   class of "bulk op melts the tab." Highest ROI in the whole investigation.
2. **C2** — sweep every bulk-mutation site for the gate; add a `withGraphRebuild()`
   helper so it can't be forgotten.
3. **A1 + A2** — targeted `engine.reset(id)` + render-only-dirty. The core "stop
   recomputing/rendering the world on every edit" hardening; also caps post-load
   edit cost.
4. **B1 + B2** — parallelize the build loop + de-serialize the final render-all.
   This is the load fix (the cinematic was never the cost — author confirmed).
5. **A3** — early cutoff (stop propagating an unchanged value), once A1/A2's
   dirty-set exists.
6. **D1** — try holder `will-change` on plain pan (one-line experiment). **D2/D3
   only after a profiler trace** on the real Vercel build decides composite-bound vs
   repaint-bound — I won't guess, and the cheap pan wins are already in.
7. **E1/E2/E3** — culling, LOD, canvas: **mostly closed.** E1 tried (didn't help),
   E3 tried+reverted; revisit only with the documented preconditions and at much
   higher scale than today.
8. **E4** — subsumed by the Polars/Tauri Phase-2 engine; don't pre-build a JS worker.

Items 1–5 are "real hardening" (no crashes, edits/loads don't touch the world) and
are mostly small-to-medium — **all shipped and confirmed.** The dirty-set (A1→A2→A3)
was the biggest bet and it landed. Pan/zoom was the *hardest* — and per the **FINAL
VERDICT** it turned out to be at the renderer floor (not paint-bound as guessed here);
every CSS/content/resolution lever measured negligible, leaving only a renderer swap.

## Non-obvious facts worth keeping
- `engine.reset(nodeId)` invalidates **downstream successors**, not predecessors
  (code vs. its own JSDoc). This is what makes A1 a small change rather than new
  machinery.
- Adding a connection does **not** touch the engine cache — all per-cable cost
  during paste is our `connectioncreated` pipe, not Rete.
- rete pan/zoom is one CSS transform with zero React per frame — so pan stutter is
  our cable layer / layer paint, not rete re-rendering nodes.

---

# FINAL VERDICT — the empirical close-out (2026-06-24)

After the hardening above, the author tested everything on the real Vercel deploy
(desktop + mobile) across many rounds. This section supersedes the earlier *guesses*
about pan/zoom (esp. root cause D's "paint-bound" framing — **disproven below**) with
what the experiments actually showed. **Read this before touching pan/zoom again.**

## What actually shipped and stuck (the real wins)
The whole arc's value is here, and it's permanent:
- **The hangs were genuine O(N²) bugs, now fixed.** Paste (C1/C1b/C1c), bulk **delete**,
  and **undo/redo** all fired the per-event `connectioncreated`/`noderemoved` settle
  (FC reconcile + mismatch rescan + a FULL `processGraph` + group/collapse rebuild) once
  *per item* — O((nodes+cables) × nodes). All now gated via `withGraphRebuild` /
  `begin/endGraphRebuild` + one ordered settle. This was the bulk of the felt improvement.
- **Targeted recompute** (A1/A2/A3): `processGraph(changedNodeId?)` resets + renders only
  the downstream cone for single-node value edits (wired at InlineInputs + slider).
- **Load** parallelized (B1/B2). **Pan** improved (un-promoted-path quality drops via
  `--panning`: box-shadow, AA, flow-pause — see below).
- **Settings ▸ Performance toggles** (kept as escape hatches): Direct cables, Reduce
  transparency, Hide grid, Hide minimap, Reduce chrome. (All measured **negligible** on
  the dense graph — see ledger — but harmless and available.)

## The zoom ledger — every lever, and its measured result
The question was "why is mid-zoom choppy on a dense (~280-node) graph." Tested, in order:

| Lever | Result |
|---|---|
| Delete the heavy visual (recharts) nodes | **negligible** |
| Cable suspension during gesture | negligible (and unacceptable) |
| Direct/straight cables (skip router + ribbons) | **negligible** |
| Opaque cables (kill alpha blending) | **negligible** |
| Hide dot-grid background | negligible (already optimized prior) |
| Hide minimap | **negligible** |
| Reduce chrome / drop all shadows | **negligible** |
| Gesture AA-drop (`shape/text-rendering: optimizeSpeed`) | helps ONLY on **un-promoted** paths (pan, mobile pinch); nothing on promoted desktop zoom |
| Box-shadow/flow drops on wheel zoom (`--zooming`) | **WORSE on desktop** — see reverts |
| Render-resolution scaling (½/¼ → up to 16× smaller bitmap) | **did NOT help** |

## The conclusion (proven, not theorized)
Two independent axes of *rendering* cost were each driven toward zero and **neither
mattered**: *how much* gets painted (content reduction → negligible) and *how many
pixels* get rasterized (resolution scaling → no help). Therefore the dense-graph zoom
cost is **not in painting or rasterizing** the holder at all. It is the browser's
per-frame work to **composite the layer structure** — managing the transform of a
single ~5,000-element DOM layer — which is independent of paint AND raster resolution,
and which **no CSS / content / transform trick can touch.** That is the **DOM/rete
renderer floor**, now established by experiment.

**Why the two promising tricks failed (so they're not retried):**
- *AA / shadow drops on desktop zoom:* desktop zoom **promotes** the holder (rasterize
  once → bitmap-scale), so content is NOT re-rastered per frame — drops save nothing,
  and toggling the class forces extra re-rasters + a box-shadow transition → **worse**.
  Quality drops belong on the **un-promoted** paths only (`--panning`).
- *Resolution scaling:* the browser chooses a promoted layer's raster scale from its
  **effective on-screen size** (it accounts for ancestor transforms), so a parent
  counter-scale is "corrected for" — it rasterizes at the real displayed scale anyway.
  **DOM has no true render-resolution knob; only `<canvas>`/WebGL does** (explicit
  backing-store size). The "choppy at certain levels" symptom is the browser
  re-rasterizing the (large) promoted holder bitmap at scale thresholds for sharpness.

## Reverted experiments — DO NOT re-attempt without a new mechanism
- **D1** (holder GPU-promotion on plain **pan**): resampled borders (thickness/opacity
  shift), no gain. The holder is intentionally un-promoted on pan.
- **D2b / `--zooming`** (quality drops on desktop wheel zoom): made promoted desktop
  zoom **worse** (above).
- **Mobile holder promotion**: tiles/flickers — the holder (bbox × DPR) exceeds the
  mobile GPU max texture. Confirmed on-device.
- **Resolution scaling**: no effect (above).

## The only remaining lever: a renderer swap → FINALIZED in `renderer-plan.md`
**Target = WebGPU (TS, in the Tauri webview) with a WebGL2 fallback; hybrid (GPU geometry +
DOM kept only for the actively-edited node).** Desktop-primary does NOT change this — Tauri
renders through the OS webview, so the DOM compositing floor is identical on desktop; the
escape is still off the DOM, not out of the webview. Not raw Vulkan/DX12 (you'd write to
`wgpu`/WebGPU regardless). **The full finalized plan — the hard "feature-gate, DOM stays the
universal fallback" rule, the per-platform GPU capability matrix (the key 2026-06-24 finding:
WebGL2 itself is FLAKY in Tauri's Linux WebKitGTK webview, and WebGPU is absent there — so the
renderer must never be a hard replacement), the kept-vs-replaced scope, and the phased outline
(cables-to-canvas first) — is in `archive/renderer-plan.md` (parked; the live renderer is HTML-in-canvas).**

Everything short of replacing the **render + area** layer is exhausted. A custom
**WebGPU/WebGL** renderer for the node/cable layer is the only thing that gives real
draw + resolution control (and true instancing). Scope (from "how much we depend on
rete"): rete v2 is modular — you can replace the render + area plugins (~21
plugin-coupled files) while keeping the core `NodeEditor` + `ClassicPreset` node model,
the `DataflowEngine`, and ALL domain logic (value model, formula engine, ~150 node
computations). It's a **bounded but major** project (reimplement socket layout, cable
drawing, pan/zoom, selection, drag; rehost node components off rete's render contract).
**Greenlight only when zoom-at-scale is a real blocker, not a stress-test annoyance.**
Pairs naturally with the roadmap's Phase-2 Polars/Tauri move (which already decouples
the frame engine).

## External corroboration — the maintainers of Rete AND React Flow say the same thing
(2026-06-24 web research into how other large DOM node-graph projects hit this.) The
"compositing floor" conclusion above is **not** Solenoid-specific — it's the documented
consensus, confirmed at the maintainer level for both libraries. Three independent
primary sources:

- **React Flow / xyflow core dev (`peterkogo`)**, [xyflow#4711](https://github.com/xyflow/xyflow/issues/4711):
  *"I am hitting almost 120 fps with 300 nodes on screen... **most of it is spent on
  layerizing 300 overlapping dom nodes**... you are hitting the **limits of what browser
  compositing is capable** on your machine."* And, naming our per-frame style cost:
  *"Transforming the viewport and the nodes might not cause reflows, but **styles are
  recalculated every frame.**"*
- **React Flow co-founder (`moklick`)**, [xyflow#5117](https://github.com/xyflow/xyflow/issues/5117):
  *"React Flow is not made for apps like this. **You would need to use a webgl/canvas
  based renderer** if you want to render so many nodes."*
- **Rete maintainer (`Ni55aN`)**: the official answer to "thousands of nodes" is
  [`retejs.org/examples/lod-gpu`](https://retejs.org/examples/lod-gpu/) — the simplified
  LOD nodes are drawn in **Pixi.js (WebGL)**. Rete's own scale escape hatch leaves the DOM.

**Why this confirms we didn't quit early.** The cheaper DOM-level fixes everyone
recommends attack *different* bottlenecks than ours, and our experiments already excluded
all of them: re-render storms (`React.memo`/`editor.silent` — our hang bugs, already
gated), node-count culling (`onlyRenderVisibleElements`/BVH — content reduction was
negligible for us), and per-node style/paint cost (drop `backdrop-filter`/shadows, fixed
sizes — content + resolution reduction negligible). None of those touch *compositing the
existing layer tree during the transform*, which is exactly our floor. (Note: Rete's
content-LOD seems to contradict our "content negligible" finding but doesn't — LOD swaps
the whole node DOM subtree for ONE GPU rect, cutting *element/layer count*; our collapse
kept the subtrees. Same conclusion, other side: it's the number of composited elements,
not their richness.)

**The one cheap check worth doing before greenlighting the swap:** a Chrome perf trace
during a zoom, to confirm the dominant frame cost is **Composite Layers / Update Layer
Tree** — not **Recalculate Style** alone (that one *is* cuttable via simpler selectors /
fewer DOM nodes = recoverable headroom) and not React commit time. Also glance at the
compositor **layer count** (every `will-change`/`transform`/`opacity` element is its own
layer; too many *causes* the cost). Our reverted holder-promotion experiments already
brushed this, so a trace should just confirm Composite dominates — at which point the DOM
fixes are genuinely tapped out.

**The pragmatic shape of the swap is HYBRID, not full canvas.** The pattern everyone
converges on — and it fits our existing Rete/React node components — is WebGL/canvas for
cables + node-body geometry/LOD, with **DOM kept only for the node you're actively
editing**. Stated almost verbatim by [kookie-flow](https://github.com/KushagraDhawan1997/kookie-flow)
(WebGL React-Flow-API lib): *"Interactive widgets stay in DOM where they belong...
10,000 entities at 80–120fps during aggressive pan/zoom."* Same path:
[`@infinit-canvas/react`](https://www.npmjs.com/package/@infinit-canvas/react) (OffscreenCanvas +
workers, 5000+ nodes/60fps), Rete's `lod-gpu`, and even **tldraw — which chose DOM
deliberately — is now [migrating overlays to canvas](https://github.com/tldraw/tldraw/issues/8314)**
*"to eliminate per-overlay DOM nodes and their individual CSS transforms, and reduce
layout/paint overhead."* That's DOM-compositing cost in their words, after years of
DOM-first.

Other sources: [Rete perf doc](https://retejs.org/docs/best-practices/performance/) ·
[React Flow perf doc](https://reactflow.dev/learn/advanced-use/performance) ·
[xyflow#4239 virtualization RFC](https://github.com/xyflow/xyflow/issues/4239) ·
[retejs/rete#221](https://github.com/retejs/rete/issues/221) (users choke at 40–70 nodes,
but mostly re-render storms, not compositing).

## Standing guidance
- Dense-graph **zoom is at the floor**; do not chase it with CSS/content/transform
  tweaks — they're all measured negligible. Only the renderer swap moves it.
- Quality drops (`--panning`) are correct on **un-promoted** paths; never add them to
  the **promoted** desktop-zoom path.
- The mobile holder can't be promoted (texture limit); mobile zoom is gracefully
  degraded, not fixable without the renderer swap.
