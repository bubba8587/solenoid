import { useSyncExternalStore } from "react";
import { createNotifier } from "./storeKit";
import type { GpuCapability } from "./gpuProbe";
import { supportsHtmlInCanvas } from "./htmlCanvasSupport";

// Which path draws the node/cable layer: "dom" is the permanent universal fallback,
// "html" is selectable only under supportsHtmlInCanvas(), "canvas" (WGSL) is parked.

export type RenderMode = "dom" | "canvas" | "html";

const LS_KEY = "solenoid.renderMode";

let _mode: RenderMode = "dom";
const { notify, subscribe, version } = createNotifier();

// Only "html" persists — the parked "canvas" stays session-only, "dom" clears the key.
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

/** Restores "html" only if the API is still available this run; never the parked "canvas". */
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

// Set once by the startup probe: the canvas renderer must not be SELECTABLE without a
// real GPU-backed context (software rasterization is slower than DOM).
let _cap: GpuCapability | null = null;
const capN = createNotifier();
export const gpuCapabilityStore = {
  get: (): GpuCapability | null => _cap,
  set: (c: GpuCapability) => { _cap = c; capN.notify(); },
  subscribe: capN.subscribe,
  version: capN.version,
};

// Console hook for the parked canvas layer, which has no UI.
if (typeof window !== "undefined") {
  (window as unknown as { __solenoidCanvasCables?: () => string }).__solenoidCanvasCables =
    () => { renderModeStore.toggle(); return renderModeStore.get(); };
}
