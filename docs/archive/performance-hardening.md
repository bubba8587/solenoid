# Performance hardening — the final zoom verdict

> **PARTIALLY SUPERSEDED (2026-07-24) — read the "choppy zoom BAND" open problem in
> `../dev-notes.md` first.** The author has since observed that zoom chop is *not*
> monotonic: a specific INTERIOR range of camera scales is choppier than both very close
> and very far zoom. Every lever in the ledger below was measured without knowing a band
> existed, so an ablation that reads "negligible" here may simply have been run outside
> it. The conclusion that DOM compositing is a floor may still hold — but the ledger's
> negative results are *unconfirmed inside the band*, not foreclosed. The "Reverted
> experiments — DO NOT re-attempt" list is unaffected and still binding.

This is the condensed close-out of the 2026-06 perf-hardening arc. The root-cause A–E
bug-fix history (paste/delete/undo O(N²) settle fixes, targeted recompute, load
parallelization, pan quality drops) is DROPPED — those wins shipped and live in the
code + dev-notes history. What remains here is the empirically-proven **final verdict on
dense-graph zoom**, kept because it forecloses whole classes of "let me try tweaking X"
retries. The full original is in git history.

---

# FINAL VERDICT — the empirical close-out (2026-06-24)

After the hardening, the author tested everything on the real Vercel deploy (desktop +
mobile) across many rounds. This supersedes the earlier *guesses* about pan/zoom (esp.
the "paint-bound" framing — **disproven below**) with what the experiments actually
showed. **Read this before touching pan/zoom again.**

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

## The only remaining lever: a renderer swap
Everything short of replacing the **render + area** layer is exhausted. The live answer
that shipped is **HTML-in-canvas** (the `html` render mode) — see
`renderer-decision.md` / `renderer-plan.md`. Desktop-primary does NOT change this: Tauri
renders through the OS webview, so the DOM compositing floor is identical on desktop; the
escape is off the DOM, not out of the webview. Scope (from "how much we depend on rete"):
rete v2 is modular — the render + area plugins (~21 plugin-coupled files) can be replaced
while keeping the core `NodeEditor` + `ClassicPreset` node model, the `DataflowEngine`,
and ALL domain logic (value model, formula engine, ~150 node computations). Bounded but
major. **Greenlight only when zoom-at-scale is a real blocker, not a stress-test annoyance.**

## External corroboration — the maintainers of Rete AND React Flow say the same thing
(2026-06-24 web research.) The "compositing floor" conclusion is **not** Solenoid-specific
— it's the documented consensus, confirmed at the maintainer level for both libraries:

- **React Flow / xyflow core dev (`peterkogo`)**, [xyflow#4711](https://github.com/xyflow/xyflow/issues/4711):
  *"I am hitting almost 120 fps with 300 nodes on screen... **most of it is spent on
  layerizing 300 overlapping dom nodes**... you are hitting the **limits of what browser
  compositing is capable** on your machine."* And: *"Transforming the viewport and the
  nodes might not cause reflows, but **styles are recalculated every frame.**"*
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
sizes — negligible). None of those touch *compositing the existing layer tree during the
transform*, which is exactly our floor. (Rete's content-LOD seems to contradict our
"content negligible" finding but doesn't — LOD swaps the whole node DOM subtree for ONE
GPU rect, cutting *element/layer count*; our collapse kept the subtrees. Same conclusion,
other side: it's the number of composited elements, not their richness.)

**The one cheap check worth doing before greenlighting the swap:** a Chrome perf trace
during a zoom, to confirm the dominant frame cost is **Composite Layers / Update Layer
Tree** — not **Recalculate Style** alone (that one *is* cuttable) and not React commit
time. Also glance at the compositor **layer count**. Our reverted holder-promotion
experiments already brushed this, so a trace should just confirm Composite dominates.

**The pragmatic shape of the swap is HYBRID, not full canvas** — WebGL/canvas for cables +
node-body geometry/LOD, with **DOM kept only for the node you're actively editing**. Same
path as [kookie-flow](https://github.com/KushagraDhawan1997/kookie-flow),
[`@infinit-canvas/react`](https://www.npmjs.com/package/@infinit-canvas/react), Rete's
`lod-gpu`, and **tldraw — which chose DOM deliberately — now
[migrating overlays to canvas](https://github.com/tldraw/tldraw/issues/8314)** *"to
eliminate per-overlay DOM nodes and their individual CSS transforms."* That's
DOM-compositing cost in their words, after years of DOM-first.

Other sources: [Rete perf doc](https://retejs.org/docs/best-practices/performance/) ·
[React Flow perf doc](https://reactflow.dev/learn/advanced-use/performance) ·
[xyflow#4239 virtualization RFC](https://github.com/xyflow/xyflow/issues/4239) ·
[retejs/rete#221](https://github.com/retejs/rete/issues/221).

## Standing guidance
- Dense-graph **zoom is at the floor**; do not chase it with CSS/content/transform
  tweaks — they're all measured negligible. Only the renderer swap moves it.
- Quality drops (`--panning`) are correct on **un-promoted** paths; never add them to
  the **promoted** desktop-zoom path.
- The mobile holder can't be promoted (texture limit); mobile zoom is gracefully
  degraded, not fixable without the renderer swap.
