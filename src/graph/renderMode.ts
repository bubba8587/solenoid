import { useSyncExternalStore } from "react";
import { createNotifier } from "./storeKit";
import { supportsHtmlInCanvas } from "./htmlCanvasSupport";

// Which path draws the node/cable layer: "dom" is the permanent universal default,
// "html" (the experimental HTML-in-Canvas mode) is selectable only under
// supportsHtmlInCanvas(). These are the ONLY two renderers (author 2026-08-09).

export type RenderMode = "dom" | "html";

const LS_KEY = "solenoid.renderMode";

let _mode: RenderMode = "dom";
const { notify, subscribe, version } = createNotifier();

// Only "html" persists — "dom" clears the key.
function persist(m: RenderMode) {
  try { if (m === "html") localStorage.setItem(LS_KEY, "html"); else localStorage.removeItem(LS_KEY); }
  catch { /* ignore */ }
}

export const renderModeStore = {
  get: (): RenderMode => _mode,
  set: (v: RenderMode) => { if (_mode === v) return; _mode = v; persist(v); notify(); },
  subscribe,
  version,
};

/** Restores "html" only if the API is still available this run. */
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
