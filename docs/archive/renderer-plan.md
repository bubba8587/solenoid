# Renderer plan — FINALIZED (2026-06-24)

The settled outline for the one remaining zoom-at-scale lever, so there's no
question when we proceed. Background: `performance-hardening.md` "FINAL VERDICT"
proved dense-graph zoom is at the **DOM-compositing floor** — content reduction
AND render-resolution scaling both measured negligible, so the cost is the
browser compositing the ~5k-element DOM/SVG layer tree during the transform, and
no CSS/content trick moves it. The only lever left is to stop rendering the
graph as DOM. This doc fixes *what* we swap to, *how*, and the platform reality
that constrains it.

## The target — unchanged in shape, now with a hard safety rule

**Render the node/cable layer to a `<canvas>` via WebGPU, with a WebGL2 fallback,
hybrid: GPU geometry for cables + node bodies (LOD when zoomed out), and DOM kept
only for the node you're actively editing.** (The kookie-flow / Rete `lod-gpu`
pattern — *"interactive widgets stay in DOM where they belong."*)

You do NOT pick Vulkan/DX12. You write to **WebGPU** (browser API) or **`wgpu`**
(Rust) — one codebase that dispatches to Vulkan/DX12/Metal/WebGPU. WebGPU-in-the-
webview keeps the whole React/Vite/Tauri stack and lifts to native `wgpu` later if
ever needed; raw Vulkan throws away the browser path for 10–100× the code on a 2-D
instanced-quad workload. (Full reasoning lived in the perf doc; not repeated.)

### THE design rule (cheap insurance; load-bearing only off-Windows)
**The canvas renderer is a runtime-feature-gated ENHANCEMENT, never a hard
replacement. The rete DOM renderer stays as the universal fallback, permanently.**
At startup we probe for a working GPU-backed context (`navigator.gpu` →
`requestAdapter()`, else a real WebGL2 context that isn't software). Only on success
do we light up the canvas layer; on failure (or by user setting) we stay on DOM.
For the **current Windows-only target this rule is belt-and-suspenders** — WebView2
is Chromium, so WebGL2 is solid and the probe always passes. It becomes *load-bearing*
the day Linux desktop ships (the WebKitGTK hazard below), so we build it in from the
start rather than retrofit it.

## Platform capability matrix (target = Windows-only, for now)

**Current desktop target is Windows ONLY** (author, 2026-06-24) — so the actionable
row is WebView2, and the rest is forward-looking. Researched 2026-06-24 against primary
sources (Tauri/wry issues, WebKit/Chromium/WebKitGTK release notes, caniuse, gpuweb
wiki). Tauri does not bundle a renderer — it uses the OS webview — so GPU capability is
per-platform and NOT uniform:

| Platform / webview | WebGL2 | WebGPU | Notes |
|---|---|---|---|
| **Web demo** (Chrome/Edge/Safari/FF) | solid | shipping (Chromium ≥113 default-on; Safari 26+) | The perf demo lives here — **best case.** This is also what the author eyeballs on Vercel. |
| **Windows** WebView2 (Chromium) | reliable, default-on (Edge ≥79) | available but behind `--enable-unsafe-webgpu` via `additionalBrowserArgs` (Windows-only flag API) | Best desktop case. Practical baseline = WebGL2; WebGPU = opt-in experimental. |
| **macOS 26+** WKWebView | fine | on by default, OS-bound (macOS/iOS 26 Tahoe); *"works out of the box"* per Tauri maintainer | WebGPU availability tracks the OS version, not an app setting. ≤ macOS 15 has no WebGPU. |
| **Linux** WebKitGTK | **genuinely flaky** | **absent** (no `navigator.gpu` through 2.50) | **The weak spot — see below.** |

**The Linux hazard (the reason for the safety rule).** WebGL2 inside WebKitGTK is
documented as unreliable, not just un-accelerated:
- [tauri#6559](https://github.com/tauri-apps/tauri/issues/6559) (OPEN, `status: upstream`): three.js/MapLibre/globe.gl render a **blank canvas** or spam `WebGL: context lost`, **especially on NVIDIA + X11**. Reproduces in plain Epiphany (same WebKitGTK), so it's upstream, not Tauri. Still confirmed Dec 2025; one reporter's "workaround" is *"use CEF or Electron instead."*
- The standard Linux blank-window mitigations — `WEBKIT_DISABLE_DMABUF_RENDERER=1`, `WEBKIT_DISABLE_COMPOSITING_MODE=1` ([tauri#9394](https://github.com/tauri-apps/tauri/issues/9394), maintainer-endorsed) — work by **disabling GPU acceleration**. So on a flaky Linux box a canvas renderer could fall to *software* and be **slower than the DOM path**. Hence: feature-gate, and treat "WebGL2 context is software or lost" as a fallback-to-DOM signal.
- WebGPU on Linux/WebKitGTK: no path exists. Tauri maintainer, asked about cross-OS WebGPU: *"for WebGPU across OS we're better off with electron?"* → **"yes."** ([tauri#6381](https://github.com/tauri-apps/tauri/issues/6381), closed not-planned.)

Net: the web demo and Windows/macOS desktop are good targets for an in-webview GPU
renderer; **Linux desktop is the corner the safety rule exists to cover.**

## Shell: Tauri vs Electron — DECIDED, stay Tauri (2026-06-24)

We chose Tauri early, before the renderer direction and most later decisions; the
Linux-WebKitGTK GPU hazard above is the one fact that could have justified revisiting.
It doesn't — **because the current desktop target is Windows only, and on Windows Tauri's
webview IS Chromium (WebView2).** So Tauri gives the *identical* GPU rendering Electron
would (same WebGL2, same WebGPU, same DevTools) at a fraction of the footprint, while
keeping the **Rust backend first-class** (Tauri's main process is Rust; in Electron the
main process is Node and Rust is bolted on via napi-rs or a sidecar). The whole
Tauri-vs-Electron GPU argument is a Linux/old-macOS argument — moot while we ship Windows.

- **Electron's only real edge** is uniform Chromium across all three OSes (so the renderer
  "just works" on Linux too, and the dev/prod webview gap closes). That edge is worth its
  ~100–150MB footprint **only if** we commit to Linux/macOS desktop with the GPU renderer live.
- **"We want a Rust backend" is NOT a tiebreaker** — Electron can host Rust (napi-rs / sidecar).
  Tauri just does it more cleanly. So the decision rests on the rendering/footprint axis, above.
- **Revisit trigger (one decision, shared with the native-`wgpu` escape hatch):** the moment
  we both (a) commit to shipping Linux (or pre-26 macOS) desktop **and** (b) greenlight the GPU
  renderer there. Until both hold, switching is all cost (rewrite the `src-tauri` shell, lose
  footprint, second-class the Rust backend) for zero realized benefit — the frontend/renderer
  is portable either way, so nothing is lost by deciding later.
- **Quieter Tauri tax to watch:** the three-webview dev/prod gap (verify on Vercel/Chrome, ship
  WebView2). Negligible on Windows-only since WebView2 ≈ Chrome; would grow if we add OSes.

## Scope — what changes, what doesn't

Rete v2 is modular. The swap replaces the **render + area** layer only:
- **Replace** (~21 plugin-coupled files): `rete-react-plugin` node/connection rendering, the `ConnectionComponent`/cable SVG layer, socket-position measurement, pan/zoom + selection + drag hit-testing currently owned by `rete-area-plugin`.
- **Keep, untouched**: the `NodeEditor` + `ClassicPreset` node model, `DataflowEngine` (compute), and ALL domain logic — value model, formula engine (`excelFormula.ts`), the ~150 node `data()` computations, persistence, groups/standoffs/conduits *logic* (their rendering is what moves). The React node *components* get rehosted off rete's render contract (DOM only for the active node).

## Phased outline (each phase shippable, DOM fallback intact throughout)

0. **De-risk harness.** Render-mode store (`dom` | `canvas`, persisted, default `dom`) + a GPU feature-probe. A no-op transparent canvas overlay that mirrors rete's pan/zoom transform exactly — proves the coordinate math before drawing anything real. No visual change yet.
1. **Cables → one canvas/WebGL layer** (highest value, most isolated). Cables are the bulk of the ~5k elements and already a clean subsystem (`cablePaths.ts` geometry is reusable as-is; only the SVG emit in `ConnectionComponent` is replaced). This is the deferred "D3 chunked shared-SVG cable layer" generalized to canvas. May move the needle alone; nodes stay DOM.
2. **Node bodies → canvas geometry at LOD.** Zoomed out, draw instanced quads + MSDF text for node bodies; swap to the real DOM React component near 1:1 zoom and for the active/selected node. This is the compositing win — far fewer DOM layers to transform.
3. **Selection / drag / hit-testing on canvas** (spatial index), retiring the remaining `rete-area-plugin` interaction paths.

Greenlight Phase 0/1 when zoom-at-scale is a real blocker, not a stress-test
annoyance. Phases 2–3 only if 1 doesn't suffice.

## The escape hatch, if Linux-desktop GPU ever becomes a hard requirement
If big-graph performance on **Linux desktop specifically** must be guaranteed (not
just "degrade gracefully to DOM"), the in-webview approach can't deliver it —
WebKitGTK won't. Options, both large, neither needed while the DOM fallback covers
Linux: (a) **native `wgpu`** — render the graph surface in a native window composited
with the webview (reuses the WebGPU shaders/geometry from this plan); (b) **Electron**
— guaranteed cross-platform Chromium GPU, the Tauri maintainer's own recommendation
for cross-OS WebGPU, at the cost of leaving Tauri. Record-only; do not pursue unless
Linux-desktop perf is escalated to a hard requirement.

## Open verification (do before Phase 1, cheap)
- A Chrome/DevTools perf trace during a zoom on the dense graph, confirming **Composite
  Layers / Update Layer Tree** dominates the frame (not Recalculate Style alone, which
  *would* be cuttable in DOM = recoverable headroom; not React commit time).
- Confirm the GPU probe correctly detects *software* WebGL2 (e.g. SwiftShader / the
  Linux comp-mode-off fallback) and routes those to the DOM fallback — software canvas
  must NOT be chosen over DOM.
