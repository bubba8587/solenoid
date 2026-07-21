# Renderer plan — the safety rules that survived (2026-06-24)

This was the finalized WebGPU/WebGL2 swap outline. The phased build outline (cables→canvas
first, then node bodies at LOD, then hit-testing) is DROPPED — the renderer that actually
shipped is HTML-in-Canvas (`renderer-decision.md`). What's kept are the three durable
constraints that outlive the specific plan: the feature-gate safety rule, the Linux
WebKitGTK hazard, and the Tauri-vs-Electron decision. Full outline in git history.

## THE design rule (implemented in src/main.tsx)
**The canvas renderer is a runtime-feature-gated ENHANCEMENT, never a hard replacement.
The rete DOM renderer stays as the universal fallback, permanently.** At startup, probe
for a working GPU-backed context (`navigator.gpu` → `requestAdapter()`, else a real
WebGL2 context that isn't software). Only on success do we light up the canvas layer; on
failure (or by user setting) we stay on DOM. Crucially, detect *software* WebGL2
(SwiftShader / the Linux comp-mode-off fallback) and **route software → DOM** — a software
canvas must NOT be chosen over the DOM path. On Windows (WebView2 = Chromium) this is
belt-and-suspenders; it becomes load-bearing the day Linux desktop ships.

## The Linux WebKitGTK hazard (the reason the rule exists)
Tauri uses the OS webview, so GPU capability is per-platform, NOT uniform. Linux WebKitGTK
is the weak spot: WebGL2 is genuinely flaky and WebGPU is absent (no `navigator.gpu`
through 2.50).
- [tauri#6559](https://github.com/tauri-apps/tauri/issues/6559) (OPEN, `status: upstream`):
  three.js/MapLibre render a **blank canvas** or spam `WebGL: context lost`, especially on
  NVIDIA + X11. Reproduces in plain Epiphany, so it's upstream, not Tauri.
- The standard blank-window mitigations (`WEBKIT_DISABLE_DMABUF_RENDERER=1`,
  `WEBKIT_DISABLE_COMPOSITING_MODE=1`, [tauri#9394](https://github.com/tauri-apps/tauri/issues/9394))
  work by **disabling GPU acceleration** — so a Linux canvas renderer could fall to
  *software* and be slower than DOM. Hence the "software → DOM" gate.
- WebGPU on Linux/WebKitGTK: no path exists. Tauri maintainer, on cross-OS WebGPU:
  *"for WebGPU across OS we're better off with electron?"* → **"yes."**
  ([tauri#6381](https://github.com/tauri-apps/tauri/issues/6381), closed not-planned.)

Web demo + Windows/macOS 26+ desktop are good in-webview GPU targets; Linux desktop is the
corner the safety rule covers.

## Shell: Tauri vs Electron — DECIDED, stay Tauri (2026-06-24)
The Linux-WebKitGTK GPU hazard is the one fact that could justify revisiting the early
Tauri choice. It doesn't — **the current desktop target is Windows only, and on Windows
Tauri's webview IS Chromium (WebView2)**, giving the identical GPU rendering Electron would
(same WebGL2/WebGPU/DevTools) at a fraction of the footprint, while keeping the Rust
backend first-class. The whole Tauri-vs-Electron GPU argument is a Linux/old-macOS
argument, moot while we ship Windows.
- **Electron's only real edge** is uniform Chromium across all three OSes — worth its
  ~100–150MB footprint only if we commit to Linux/macOS desktop with the GPU renderer live.
- **"We want a Rust backend" is NOT a tiebreaker** — Electron can host Rust (napi-rs /
  sidecar); Tauri just does it more cleanly.
- **Revisit trigger** (shared with the native-`wgpu` escape hatch): the moment we both
  (a) commit to shipping Linux (or pre-26 macOS) desktop **and** (b) greenlight the GPU
  renderer there. Until both hold, switching is all cost for zero realized benefit — the
  frontend/renderer is portable either way, so nothing is lost by deciding later.
