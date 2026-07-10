// Whether the canvas is currently far enough zoomed out that node cards should
// swap to a simplified representation (Settings toggle "semanticZoom", gated on a
// raw CSS-scale threshold — SEMANTIC_ZOOM_SCALE below — so it fires at the same
// APPARENT zoom on every display, which is what body-text legibility depends on).
// Canvas.tsx recomputes this on every pan/zoom event and on the setting toggling;
// NodeShell reads it to add a CSS class.
import { createNotifier } from "./storeKit";
import { settingsStore } from "./settingsStore";

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

// Semantic zoom: below this CSS scale a node body's detail (labels, literal
// fields, values) is too small to read, so we hide it and keep the card frame +
// title + socket dots as clean overview landmarks (scope-features #40). Gated on
// the RAW CSS scale, NOT the mip level: the old code used
// computeIdealMipLevel(scale·dpr) ≥ 4, which (a) only fired below ~6% zoom on a
// dpr-1 display and ~3% on a dpr-2 laptop — so far out the body is already
// sub-pixel and hiding it does nothing visible ("semantic zoom doesn't do
// anything") — and (b) folded in dpr, so it triggered at a DIFFERENT apparent zoom
// per display. Apparent size is what legibility depends on, and dpr is a texture-
// resolution concern that belongs to the mip renderer, not here. 0.3 ≈ a card
// drawn at ~30% (a ~200px card → ~60px): body text unreadable, card still a clear
// block — conservative (far-overview only) but actually reachable and visible.
const SEMANTIC_ZOOM_SCALE = 0.3;
export function syncSemanticZoomFor(scale: number): void {
  semanticZoomStore.set(settingsStore.get("semanticZoom") && scale <= SEMANTIC_ZOOM_SCALE);
}
