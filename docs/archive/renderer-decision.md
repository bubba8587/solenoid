# Renderer decision — adopt a retained-mode GPU 2-D engine (Pixi), demote Rete to headless model (2026-06-26)

> **UPDATE 2026-06-27 — implementation refined to HTML-in-Canvas (native), and PERF-VALIDATED.**
> The retained-mode-canvas diagnosis below stands, but the chosen *implementation* moved from
> reproducing cards on the GPU (Pixi + MSDF + scrape) to the browser's native **HTML-in-Canvas**
> (`captureElementImage` → a mip pyramid of `ImageBitmap`s → `drawImage`), which draws the REAL DOM
> cards — zero fidelity/scrape work. Validated in `HtmlCanvasSpike.tsx`: 280 nodes, fully zoomed out
> (every card in one frame), crispest quality → **165fps (refresh-capped), 0.1–0.5ms draw** (10–30×
> headroom; closed at the author's ≤~300-node target). The unlock was proper **mipmapping** —
> rasterize once at 1.5×, pixel-downscale the levels; NOT re-rasterizing the DOM at fractional CSS
> zoom (which bloats scrollbars/fixed-size widgets). Remaining work is the non-perf port (editing,
> drag, ribbon-cable parity); the one external risk is the `chrome://flags/#canvas-draw-element` flag
> reaching stable Chrome / WebView2 (~late 2026). The Pixi spike stays as comparison/fallback. Full
> account: dev-notes 2026-06-27.

> **Supersedes the renderer direction in `renderer-plan.md`.** The *diagnosis* in
> `performance-hardening.md` ("FINAL VERDICT") stands and is corroborated by the
> React Flow and Rete maintainers — the dense-graph zoom cost is the browser
> compositing the ~5k-element DOM/SVG layer tree, and no CSS/content trick moves
> it. What changes here is the **implementation** of the escape, after an outside
> review of how every shipped high-performance node/cell/shape canvas actually
> renders. The hand-rolled WGSL path (WS4) is parked permanently in favour of this.

## TL;DR

1. **Stop hand-rolling WGSL.** The WS4 work (`gpuCableRenderer.ts`, `gpuNodeRenderer.ts`,
   the rounded-rect SDF shader, `nodeInstances.ts`, `cableTessellate.ts`, the
   hit-test grid) is rebuilding *Figma's* renderer alone. Nobody doing a 2-D
   instanced-quad node canvas writes their own shading language — they adopt a
   mature retained-mode 2-D GPU engine. **Adopt [PixiJS v8](https://pixijs.com).**
   It ships a **WebGPU renderer with automatic WebGL2 fallback**, which *also
   dissolves the entire Linux/WebKitGTK fallback problem* `renderer-plan.md`
   agonises over — Pixi picks the best working backend per platform; we keep the
   feature-gate as belt-and-suspenders. Off the shelf it gives us everything in
   the WS4 backlog: instanced batching, `BitmapText` with **MSDF** fonts,
   `pixi-viewport` (pan/zoom/pinch), the v8 culling API (frustum culling), and a
   scene graph. This is what **Rete's own maintainer** uses (`lod-gpu` =
   Pixi.js) and what **Quadratic** (a cell-heavy app with the same "thousands of
   little boxes with text" shape) chose over HTML.

2. **Stop hiding Rete's DOM nodes.** The WS4 blocker — "the LOD swap loops rete's
   per-node `ResizeObserver`" — is not a bug to engineer around. It is the
   architecture rejecting the model. The fast node editors **never hide DOM
   nodes, because they never create them.** Every node is a GPU object at every
   zoom level; the DOM holds *exactly one* element — the input you are currently
   typing into (the "hidden `<textarea>` / floating editor" pattern, stated
   verbatim by kookie-flow and used by Figma and Monaco). No per-node DOM ⇒ no
   `ResizeObserver` storm ⇒ no LOD-hide crash. The whole class of bug disappears.

3. **Keep Rete, headless.** Rete v2 is modular. Keep `NodeEditor` +
   `ClassicPreset` (the node *model*), the entire `DataflowEngine` (compute), the
   ~150 node `data()` computations, the value model, `excelFormula.ts`,
   persistence, and the groups/standoffs/conduits *logic*. **Drop the render +
   area + connection + minimap plugins** (`rete-react-plugin`,
   `rete-area-plugin`, `rete-connection-plugin`, `rete-render-utils`,
   `rete-minimap-plugin`) — Pixi + pixi-viewport replaces that layer wholesale.

## The architecture everyone converges on

Every scaled canvas app — Quadratic (spreadsheet, PixiJS), kookie-flow (node
graph, WebGL), Figma (custom C++/WASM), Rete `lod-gpu` (Pixi) — makes the *same
five decisions*:

| Decision | Why |
|---|---|
| One GPU canvas, retained scene graph | one composited layer instead of ~5k |
| Instanced / batched geometry | thousands of cards/cables in a few draw calls |
| **MSDF text** | crisp labels across 0.01×–10× zoom, glyph-atlas batched |
| Spatial-index hit-test + frustum cull | O(log n) picking; draw only what's on screen |
| **DOM only for the one active editor** | native keyboard/IME/clipboard, zero per-node DOM |

kookie-flow hits **10,000 entities at 80–120 fps during aggressive pan/zoom**
with exactly this structure — which is the stated requirement.

## What you give up (be honest)

- **The CSS node cards die** — every gradient, shadow, the half-pixel-tuned
  socket dots, the 2-line-title clamp becomes GPU draw code. This is the biggest
  hidden cost (art-direction work), and it's unavoidable once you leave the DOM.
- **Text editing / IME** goes through the floating-input pattern (solved, but you
  build it).
- **Accessibility / DOM-testability** of the graph surface drops to ~zero (canvas
  is opaque to screen readers and DOM queries). Acceptable for a single-user
  visual tool.
- **MSDF atlas pipeline** — generate an atlas for the app fonts once
  (`msdf-bmfont-xml`). Pixi v8 can also auto-generate dynamic bitmap fonts.

## The de-risking path (validate the *architecture*, not just fund it)

What's been expensive in WS4 isn't money — it's that every blind attempt crashed
and cost a revert. Fix that by validating in a throwaway *before* the rete-removal:

0. **Spike — DONE (2026-06-26), beyond the original scope.** Behind a buried menu
   item (Edit ▸ "Renderer spike (Pixi)"). It started as the synthetic stress test
   and grew into a real proof: a **Synthetic** mode (N grid cards 500–10k, the perf
   ceiling) AND a **My graph** mode that snapshots the LIVE rete graph onto the GPU
   — faithful cards (scraped title/value + kind colour + real socket positions), the
   app's real cable router, group rects — with multi-touch pinch, selection, a
   floating-`<input>` double-click rename (the hidden-input pattern, persisted via
   `node.label` + `processGraph`), live drags persisted via `area.translate`, a
   **Benchmark** (orbit+zoom → avg/worst fps), and two A/B toggles (BitmapText↔Text,
   LOD/Cull on/off). The pure core (`src/graph/pixi/`: camera, card layout,
   spatial-index picker, cable-geom) is unit-tested (~30 tests) since Pixi rendering
   can only be eyeballed on the Vercel deploy. pixi.js dynamic-imports (code-split
   out of the main bundle). It answers the one question WS4 never could — "does
   nodes-on-GPU hold fps at scale, on real devices?" — with zero rete entanglement
   to crash. **Remaining = the real port (steps 1–6 below) + an MSDF atlas.**
1. **Port cables first** (most isolated; `cablePaths.ts` geometry is reusable).
2. **Port node bodies** to Pixi cards + MSDF text.
3. **Hit-test / drag / selection** on a spatial index (quadtree).
4. **The floating DOM editor** for the active field.
5. **Minimap** as a second tiny Pixi view (or a downscaled render).
6. Delete `gpu*Renderer.ts` / WGSL / SDF / tessellator once Pixi covers them.

Each phase behind the existing render-mode flag, DOM fallback intact throughout.

## One cheap check still worth doing (20 min)

`renderer-plan.md` flagged it and it was never done: a **Chrome DevTools
Performance trace** of a zoom on the dense graph, confirming the dominant frame
bucket is **Composite Layers / Update Layer Tree** (not **Recalculate Style**,
which *is* cuttable). Content-reduction being negligible already argues it's
compositing; the trace turns strong inference into measured fact before the port.

## Sources

- React Flow [#4711](https://github.com/xyflow/xyflow/issues/4711) / [#5117](https://github.com/xyflow/xyflow/issues/5117) (maintainers: "limits of browser compositing"; "use a webgl/canvas renderer").
- Rete [`lod-gpu`](https://retejs.org/examples/lod-gpu/) (Pixi.js) — Rete's own scale answer.
- [kookie-flow](https://github.com/KushagraDhawan1997/kookie-flow) — WebGL node graph, hidden-textarea editing, 10k @ 80–120fps.
- [Quadratic — why WebGL over HTML](https://www.quadratichq.com/blog/building-a-high-performance-spreadsheet-renderer-why-we-chose-webgl-over-html) (PixiJS + MSDF + pixi-viewport).
- [Figma rendering powered by WebGPU](https://www.figma.com/blog/figma-rendering-powered-by-webgpu/); [tldraw #8314 overlays→canvas](https://github.com/tldraw/tldraw/issues/8314).
- [PixiJS v8](https://pixijs.com/blog/pixi-v8-launches); [pixi-viewport](https://www.npmjs.com/package/pixi-viewport); [BitmapText/MSDF](https://pixijs.download/dev/docs/scene.BitmapText.html); [v8 culling](https://www.richardfu.net/optimizing-rendering-with-pixijs-v8-a-deep-dive-into-the-new-culling-api/).
