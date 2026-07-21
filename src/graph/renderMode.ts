import { useSyncExternalStore } from "react";
import { createNotifier } from "./storeKit";
import type { GpuCapability } from "./gpuProbe";
import { supportsHtmlInCanvas } from "./htmlCanvasSupport";

// Render-mode store — which path draws the node/cable layer:
//   • "dom"    — the permanent rete DOM/SVG renderer (universal fallback, default).
//   • "html"   — the HTML-in-Canvas renderer (capture the real cards → a mip pyramid of
//                ImageBitmaps → drawImage). The CURRENT canvas direction; perf-validated.
//   • "canvas" — the PARKED hand-rolled WGSL/Pixi GPU layer (gpu*Renderer, CableCanvas,
//                NodeCanvas, RenderOverlay). Shelved; console-only; not persisted.
//
// This is the runtime feature-gate from the renderer plan: the canvas renderer is always
// an ENHANCEMENT, never a hard replacement; DOM is the universal fallback. Whether "html"
// is even SELECTABLE is gated by `supportsHtmlInCanvas()` (the Chrome flag); "canvas" is
// console-only (parked). Module-level singleton (like gridSnapStore) so the renderer can
// read it without the main React tree.

export type RenderMode = "dom" | "canvas" | "html";

const LS_KEY = "solenoid.renderMode";

let _mode: RenderMode = "dom";
const { notify, subscribe, version } = createNotifier();

// Only "html" persists — it's the supported, validated direction the author opts into and
// expects to survive reload. "canvas" (parked WGSL) stays session-only; "dom" clears the key.
function persist(m: RenderMode) {
  try { if (m === "html") localStorage.setItem(LS_KEY, "html"); else localStorage.removeItem(LS_KEY); }
  catch { /* ignore */ }
}

export const renderModeStore = {
  get: (): RenderMode => _mode,
  set: (v: RenderMode) => { if (_mode === v) return; _mode = v; persist(v); notify(); },
  // Legacy console hook toggles the PARKED WGSL layer (dom <-> canvas); session-only.
  toggle: () => { _mode = _mode === "dom" ? "canvas" : "dom"; persist(_mode); notify(); },
  subscribe,
  version,
};

/** Startup init. Restore "html" if it was the saved choice AND the API is available
 *  (the Chrome flag may be off this run) — else DOM. Never restore the parked "canvas". */
export function initRenderMode() {
  let restored: RenderMode = "dom";
  try {
    if (localStorage.getItem(LS_KEY) === "html" && supportsHtmlInCanvas()) restored = "html";
  } catch { /* ignore */ }
  _mode = restored;
  if (restored !== "html") persist("dom"); // clear a stale/unsupported key
}

export function useRenderMode(): RenderMode {
  return useSyncExternalStore(renderModeStore.subscribe, renderModeStore.get);
}

// ─── GPU capability (set once by the startup probe) ─────────────────────────────
// Held here so the Settings UI can gate the canvas toggle on whether a real
// GPU-backed context exists — the canvas renderer must not be SELECTABLE on a
// machine that only has software/no acceleration (it would be slower than DOM).
let _cap: GpuCapability | null = null;
const capN = createNotifier();
export const gpuCapabilityStore = {
  get: (): GpuCapability | null => _cap,
  set: (c: GpuCapability) => { _cap = c; capN.notify(); },
  subscribe: capN.subscribe,
  version: capN.version,
};

// Console hook so the author can flip the canvas cable layer on the build with no
// UI yet: `__solenoidCanvasCables()` toggles dom <-> canvas and logs the new mode.
if (typeof window !== "undefined") {
  (window as unknown as { __solenoidCanvasCables?: () => string }).__solenoidCanvasCables =
    () => { renderModeStore.toggle(); return renderModeStore.get(); };
}
