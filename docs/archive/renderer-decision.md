# Renderer decision — HTML-in-Canvas, Rete headless (2026-06-26/27)

The condensed decision record. The original also pitched adopting **PixiJS** as the GPU
engine (reproducing cards on the GPU with MSDF text); that pitch is DROPPED here — the
pixi renderer is deprecated (author 2026-07-19), the live answer is native
HTML-in-Canvas. What's kept is the diagnosis, the validated implementation, and the
headless-Rete architecture. Full original + the Pixi comparison are in git history.

## The escape (diagnosis)
The dense-graph zoom cost is the browser compositing the ~5k-element DOM/SVG layer tree,
and no CSS/content trick moves it — the "FINAL VERDICT" in `performance-hardening.md`,
corroborated by the React Flow and Rete maintainers. The only real lever is to leave the
DOM for the node/cable layer.

## The chosen implementation — native HTML-in-Canvas, PERF-VALIDATED (2026-06-27)
Not reproducing cards on the GPU (scrape + MSDF) — the browser's native **HTML-in-Canvas**
(`captureElementImage` → a mip pyramid of `ImageBitmap`s → `drawImage`), which draws the
REAL DOM cards, so zero fidelity/scrape work.

- **The unlock was proper mipmapping** — rasterize once at **1.5×**, pixel-downscale the
  levels. Do **NOT** re-rasterize the DOM at fractional CSS zoom (that bloats
  scrollbars / fixed-size widgets).
- **Validation** (`HtmlCanvasSpike.tsx`): 280 nodes, fully zoomed out (every card in one
  frame), crispest quality → **165fps (refresh-capped), 0.1–0.5ms draw** — 10–30×
  headroom, closed at the author's ≤~300-node target.
- **The one external risk:** the `chrome://flags/#canvas-draw-element` flag reaching
  stable Chrome / WebView2 (~late 2026). Until then it's gated; the desktop build enables
  the Blink flag via `additionalBrowserArgs`.

## The architecture — keep Rete, headless
Rete v2 is modular. Keep `NodeEditor` + `ClassicPreset` (the node *model*), the entire
`DataflowEngine` (compute), the ~150 node `data()` computations, the value model,
`excelFormula.ts`, persistence, and the groups/standoffs/conduits *logic*. The renderer
change swaps the render/area layer only. **The DOM holds exactly one live element at a
time — the field you're actively editing** (the floating-input pattern); everything else
draws from the canvas. This is also why per-node `ResizeObserver` storms stop mattering.

## Sources
- React Flow [#4711](https://github.com/xyflow/xyflow/issues/4711) / [#5117](https://github.com/xyflow/xyflow/issues/5117) — maintainers: "limits of browser compositing"; "use a webgl/canvas renderer".
- Rete [`lod-gpu`](https://retejs.org/examples/lod-gpu/); [Quadratic — WebGL over HTML](https://www.quadratichq.com/blog/building-a-high-performance-spreadsheet-renderer-why-we-chose-webgl-over-html); [Figma WebGPU](https://www.figma.com/blog/figma-rendering-powered-by-webgpu/); [tldraw #8314 overlays→canvas](https://github.com/tldraw/tldraw/issues/8314).
