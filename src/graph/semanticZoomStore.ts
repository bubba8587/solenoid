// Whether the canvas is currently far enough zoomed out that node cards should
// swap to a simplified representation (Settings toggle "semanticZoom", gated on
// a mip level from computeIdealMipLevel — see htmlCanvasRenderer.ts — not a raw
// zoom-scale threshold, so "far" means the same thing here as it does to the
// HTML-in-Canvas renderer's own LOD). Canvas.tsx recomputes this on every pan/
// zoom event and on the setting toggling; NodeShell reads it to add a CSS class.
import { createNotifier } from "./storeKit";

let _far = false;
const { notify, subscribe, version } = createNotifier();

export const semanticZoomStore = {
  get: (): boolean => _far,
  set(v: boolean) {
    if (_far === v) return;
    _far = v;
    notify();
  },
  version,
  subscribe,
};

// A root-level class (same pattern as settingsStore's PERF_CLASS_MAP) so plain
// CSS — not a React subscription in every node component — does the swap.
subscribe(() => {
  if (typeof document === "undefined") return; // node/test env
  document.documentElement.classList.toggle("solenoid-semantic-zoom", _far);
});
